import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "motion/react";
import { ClipboardList, Link2, Plus, RefreshCw, X, CheckCircle, PlayCircle, UserRoundCog, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { NavLink } from "react-router";
import { PageWrapper, FadeItem } from "../motion-utils";
import { SectionCard } from "@/components/ui/section-card";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/status-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { SkeletonTableRow } from "@/components/ui/loading-state";
import { FilterBar } from "@/components/ui/filter-bar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Pagination, PaginationContent, PaginationEllipsis, PaginationItem, PaginationLink,
  PaginationNext, PaginationPrevious,
} from "@/components/ui/pagination";
import { cn } from "@/components/ui/utils";
import { getPaginationRange } from "@/lib/pagination";
import { getApiErrorMessage } from "@/services/api";
import {
  staffTaskService,
  type EntityOption,
  type StaffTask,
  type StaffTaskCreateInput,
  type StaffWorkloadRow,
} from "@/services/staff-tasks";
import { userService, type WarehouseStaffOption } from "@/services/user";
import { warehouseService, type Warehouse } from "@/services/warehouse";
import { authService } from "@/services/auth";
import { canManageReceiving } from "@/lib/rbac";
import { useAssignableStaff } from "@/hooks/useAssignableStaff";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const TASK_TYPE_OPTIONS = [
  { value: "GENERAL", label: "Tổng hợp" },
  { value: "CHECK_SHELF", label: "Kiểm kệ" },
  { value: "STOCK_CHECK", label: "Kiểm tồn kho" },
  { value: "LOW_STOCK_REVIEW", label: "Xem xét hàng sắp hết" },
  { value: "EXCEPTION_FOLLOW_UP", label: "Theo dõi sự cố" },
  { value: "REORDER_REVIEW", label: "Xem xét tái nhập" },
  { value: "RESERVATION_FOLLOW_UP", label: "Theo dõi đặt trước" },
  { value: "INVENTORY_AUDIT", label: "Kiểm kê kho" },
  { value: "OTHER", label: "Khác" },
];

const TASK_TYPE_LABELS: Record<string, string> = Object.fromEntries(TASK_TYPE_OPTIONS.map((o) => [o.value, o.label]));

const PRIORITY_OPTIONS = [
  { value: "LOW", label: "Thấp" },
  { value: "MEDIUM", label: "Trung bình" },
  { value: "HIGH", label: "Cao" },
  { value: "URGENT", label: "Khẩn cấp" },
];

const STATUS_FILTERS = ["ALL", "OPEN", "IN_PROGRESS", "DONE", "CANCELLED"];

const STATUS_FILTER_LABELS: Record<string, string> = {
  ALL: "Tất cả trạng thái",
  OPEN: "Mới",
  IN_PROGRESS: "Đang làm",
  DONE: "Hoàn thành",
  CANCELLED: "Đã hủy",
};

const PAGE_SIZE = 10;

const ENTITY_TYPE_OPTIONS = [
  { value: "EXCEPTION_REPORT", label: "Báo cáo sự cố" },
  { value: "PURCHASE_REQUEST", label: "Yêu cầu mua hàng" },
  { value: "OUTBOUND_ORDER", label: "Đơn xuất kho" },
  { value: "TRANSFER_ORDER", label: "Đơn chuyển kho" },
];

const ENTITY_TYPE_LABELS: Record<string, string> = Object.fromEntries(
  ENTITY_TYPE_OPTIONS.map((o) => [o.value, o.label]),
);

const TASK_TYPE_ACTION: Record<string, string> = {
  GENERAL: "Xử lý",
  CHECK_SHELF: "Kiểm kệ",
  STOCK_CHECK: "Kiểm tồn kho",
  LOW_STOCK_REVIEW: "Xem xét hàng sắp hết",
  EXCEPTION_FOLLOW_UP: "Xử lý sự cố",
  REORDER_REVIEW: "Xem xét tái nhập",
  RESERVATION_FOLLOW_UP: "Theo dõi đặt trước",
  INVENTORY_AUDIT: "Kiểm kê kho",
  OTHER: "Thực hiện",
};

function buildAutoTitle(taskType: string, entityType: string | null, option: EntityOption | null): string {
  if (!entityType || !option) return "";
  const action = TASK_TYPE_ACTION[taskType] ?? "Xử lý";
  return `${action}: ${option.ref_number} (${option.status})`;
}

function getEntityNavPath(entityType: string): string {
  if (entityType === "EXCEPTION_REPORT") return "/exception-reports";
  if (entityType === "PURCHASE_REQUEST") return "/purchase-requests";
  if (entityType === "OUTBOUND_ORDER") return "/outbound";
  if (entityType === "TRANSFER_ORDER") return "/picking";
  return "#";
}

function statusVariant(status: string): "success" | "warning" | "danger" | "info" | "neutral" | "cyan" {
  const s = status.toUpperCase();
  if (s === "DONE") return "success";
  if (s === "IN_PROGRESS") return "info";
  if (s === "OPEN") return "warning";
  if (s === "CANCELLED") return "danger";
  return "neutral";
}

function priorityVariant(priority: string): "success" | "warning" | "danger" | "info" | "neutral" | "cyan" {
  const p = priority.toUpperCase();
  if (p === "URGENT") return "danger";
  if (p === "HIGH") return "warning";
  if (p === "MEDIUM") return "info";
  return "neutral";
}

function formatDate(value: string | null | undefined) {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleString("vi-VN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

const ALL_WAREHOUSES = "ALL";
const OPEN_STATUSES = ["OPEN", "IN_PROGRESS"];

function ReassignDialog({ task, staffName, onClose, onDone }: {
  task: StaffTask | null;
  staffName: (id: string) => string;
  onClose: () => void;
  onDone: () => void;
}) {
  const { staff, loading, error } = useAssignableStaff(task?.warehouse_id ?? null);
  // remounted per task (key), so the choice never carries over to another task
  const [assigneeId, setAssigneeId] = useState("");
  const [saving, setSaving] = useState(false);

  const candidates = staff.filter((s) => s.id !== task?.assignee_user_id);
  const submit = async () => {
    if (!task || !assigneeId) return;
    setSaving(true);
    try {
      await staffTaskService.update(task.id, { assignee_user_id: assigneeId });
      toast.success("Đã giao lại task");
      onDone();
      onClose();
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Giao lại task thất bại"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={Boolean(task)} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Giao lại task</DialogTitle>
          <DialogDescription>
            {task ? `"${task.title}" đang giao cho ${staffName(task.assignee_user_id)}${task.warehouses ? ` tại ${task.warehouses.code}` : ""}.` : null}
          </DialogDescription>
        </DialogHeader>
        {!task?.warehouse_id ? (
          <p className="text-[13px] text-muted-foreground">Task cũ không gắn kho, không thể giao lại an toàn. Hãy hủy và tạo task mới có chọn kho.</p>
        ) : (
          <div className="space-y-2">
            <label htmlFor="reassign-assignee" className="block text-[11px] font-semibold text-muted-foreground">Nhân viên mới *</label>
            <select
              id="reassign-assignee"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-[13px]"
              value={assigneeId}
              onChange={(e) => setAssigneeId(e.target.value)}
              disabled={loading || candidates.length === 0}
            >
              <option value="">{loading ? "Đang tải nhân viên..." : candidates.length === 0 ? "Không có nhân viên khác nhận được việc ở kho này" : "Chọn nhân viên"}</option>
              {candidates.map((s) => (
                <option key={s.id} value={s.id}>{s.full_name} ({s.username})</option>
              ))}
            </select>
            {error ? <p role="alert" className="text-[12px] text-red-600 dark:text-red-400">{error}</p> : null}
            {task.status === "IN_PROGRESS" ? (
              <p className="text-[12px] text-muted-foreground">Task đang làm sẽ quay về trạng thái Mới cho người được giao lại.</p>
            ) : null}
          </div>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>Hủy</Button>
          <Button type="button" disabled={!assigneeId || saving} onClick={() => void submit()} className="bg-violet-600 hover:bg-violet-700">
            {saving ? "Đang lưu..." : "Giao lại"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function WorkloadPanel({ warehouse, staffName, refreshKey }: { warehouse: Warehouse; staffName: (id: string) => string; refreshKey: number }) {
  const requestKey = `${warehouse.id}:${refreshKey}`;
  const [result, setResult] = useState<{ key: string; rows: StaffWorkloadRow[]; error: string | null } | null>(null);

  useEffect(() => {
    let cancelled = false;
    staffTaskService.getWorkload(warehouse.id)
      .then((res) => { if (!cancelled) setResult({ key: requestKey, rows: Array.isArray(res.data) ? res.data : [], error: null }); })
      .catch((err) => { if (!cancelled) setResult({ key: requestKey, rows: [], error: getApiErrorMessage(err, "Không tải được khối lượng việc") }); });
    return () => { cancelled = true; };
  }, [warehouse.id, requestKey]);

  const current = result?.key === requestKey ? result : null;
  const rows = current?.rows ?? [];
  const error = current?.error ?? null;
  const loading = !current;

  const sorted = [...rows].sort((a, b) => (b.open + b.in_progress) - (a.open + a.in_progress));

  return (
    <SectionCard noPadding>
      <div className="border-b border-border px-5 py-4">
        <h2 className="text-[15px] font-semibold">Khối lượng việc tại {warehouse.code}</h2>
        <p className="text-[12px] text-muted-foreground">
          Đếm trực tiếp từ task giao việc của kho này, mỗi task tính một lần theo trạng thái hiện tại. Quá hạn nằm trong số Mới và Đang làm.
        </p>
      </div>
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/30 hover:bg-muted/30">
            {["Nhân viên", "Mới", "Đang làm", "Quá hạn", "Hoàn thành 7 ngày"].map((h) => (
              <TableHead key={h} className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{h}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading ? (
            <SkeletonTableRow columns={5} rows={3} />
          ) : error ? (
            <TableRow className="hover:bg-transparent">
              <TableCell colSpan={5} className="px-5 py-6 text-center text-[13px] text-red-600 dark:text-red-400">{error}</TableCell>
            </TableRow>
          ) : sorted.length === 0 ? (
            <TableRow className="hover:bg-transparent">
              <TableCell colSpan={5} className="px-5 py-6 text-center text-[13px] text-muted-foreground">Không có task đang mở hay vừa hoàn thành ở kho này.</TableCell>
            </TableRow>
          ) : sorted.map((row) => (
            <TableRow key={row.assignee_user_id}>
              <TableCell className="text-[13px] font-medium">{staffName(row.assignee_user_id)}</TableCell>
              <TableCell className="tabular-nums">{row.open}</TableCell>
              <TableCell className="tabular-nums">{row.in_progress}</TableCell>
              <TableCell className={cn("tabular-nums", row.overdue > 0 && "font-semibold text-red-600 dark:text-red-400")}>{row.overdue}</TableCell>
              <TableCell className="tabular-nums">{row.done_last_7_days}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </SectionCard>
  );
}

const BLANK_FORM: StaffTaskCreateInput & { related_entity_type: string | null; related_entity_id: string | null } = {
  title: "",
  description: "",
  task_type: "GENERAL",
  priority: "MEDIUM",
  assignee_user_id: "",
  warehouse_id: null,
  due_date: null,
  related_entity_type: null,
  related_entity_id: null,
};

export function StaffTasksPage() {
  const currentUser = authService.getCurrentUser();
  const isManager = canManageReceiving(currentUser);

  const [tasks, setTasks] = useState<StaffTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [warehouseStaff, setWarehouseStaff] = useState<WarehouseStaffOption[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(BLANK_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [updatingId, setUpdatingId] = useState("");
  const [entityOptions, setEntityOptions] = useState<EntityOption[]>([]);
  const [loadingEntityOptions, setLoadingEntityOptions] = useState(false);
  const [page, setPage] = useState(1);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [warehouseFilter, setWarehouseFilter] = useState(ALL_WAREHOUSES);
  const [reassignTask, setReassignTask] = useState<StaffTask | null>(null);
  const [workloadKey, setWorkloadKey] = useState(0);
  const { staff: formStaff, loading: formStaffLoading, error: formStaffError } = useAssignableStaff(showForm ? form.warehouse_id : null);

  const load = useCallback(async (status?: string) => {
    setLoading(true);
    try {
      if (isManager) {
        const res = await staffTaskService.getAll({
          ...(status && status !== "ALL" ? { status } : {}),
          ...(warehouseFilter !== ALL_WAREHOUSES ? { warehouse_id: warehouseFilter } : {}),
        });
        setTasks(Array.isArray(res.data) ? res.data : []);
        setWorkloadKey((v) => v + 1);
      } else {
        const res = await staffTaskService.getMy(status && status !== "ALL" ? { status } : {});
        setTasks(Array.isArray(res.data) ? res.data : []);
      }
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Không tải được danh sách task"));
    } finally {
      setLoading(false);
    }
  }, [isManager, warehouseFilter]);

  useEffect(() => { void load(statusFilter); }, [load, statusFilter]);

  useEffect(() => {
    setPage(1);
  }, [statusFilter, warehouseFilter]);

  useEffect(() => {
    if (!isManager) return;
    void userService.getWarehouseStaff().then((res) => {
      setWarehouseStaff(Array.isArray(res.data) ? res.data : []);
    }).catch(() => {});
    // the manager's own readable warehouses (inventory scopes the list)
    void warehouseService.getAll().then((rows) => {
      setWarehouses((Array.isArray(rows) ? rows : []).filter((w) => w.is_active !== false));
    }).catch(() => setWarehouses([]));
  }, [isManager]);

  const staffById = useMemo(() => {
    const map: Record<string, string> = {};
    for (const s of warehouseStaff) map[s.id] = s.full_name;
    for (const s of formStaff) map[s.id] = s.full_name;
    return map;
  }, [warehouseStaff, formStaff]);
  const staffName = useCallback((id: string) => staffById[id] || id.slice(0, 8), [staffById]);
  const selectedWarehouse = warehouses.find((w) => w.id === warehouseFilter) || null;

  // choosing (or changing) the warehouse resets everything that depended on it
  const handleFormWarehouseChange = (warehouseId: string) => {
    setForm((f) => ({ ...f, warehouse_id: warehouseId || null, assignee_user_id: "", related_entity_type: null, related_entity_id: null }));
    setEntityOptions([]);
  };

  const totalPages = Math.max(1, Math.ceil(tasks.length / PAGE_SIZE));

  const pagedTasks = useMemo(
    () => tasks.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [tasks, page],
  );

  useEffect(() => {
    setPage((current) => Math.min(current, totalPages));
  }, [totalPages]);

  const handleEntityTypeChange = async (entityType: string) => {
    setForm((f) => ({ ...f, related_entity_type: entityType || null, related_entity_id: null }));
    setEntityOptions([]);
    if (!entityType) return;
    setLoadingEntityOptions(true);
    try {
      const res = await staffTaskService.getEntityOptions(entityType, form.warehouse_id ?? undefined);
      setEntityOptions(Array.isArray(res.data) ? res.data : []);
    } catch {
      setEntityOptions([]);
    } finally {
      setLoadingEntityOptions(false);
    }
  };

  const handleEntitySelect = (entityId: string) => {
    const option = entityOptions.find((o) => o.id === entityId) ?? null;
    setForm((f) => {
      const newTitle = !f.title.trim() && option
        ? buildAutoTitle(f.task_type ?? "GENERAL", f.related_entity_type, option)
        : f.title;
      return { ...f, related_entity_id: entityId || null, title: newTitle };
    });
  };

  const handleCreate = async () => {
    if (!form.warehouse_id) { toast.error("Chọn kho trước khi giao việc"); return; }
    if (!form.title.trim()) { toast.error("Tiêu đề không được để trống"); return; }
    if (!form.assignee_user_id) { toast.error("Chọn nhân viên được giao"); return; }
    setSubmitting(true);
    try {
      await staffTaskService.create({
        ...form,
        description: form.description || null,
        warehouse_id: form.warehouse_id || null,
        due_date: form.due_date || null,
        related_entity_type: form.related_entity_type || null,
        related_entity_id: form.related_entity_id || null,
      });
      toast.success("Đã tạo task cho nhân viên");
      setShowForm(false);
      setForm(BLANK_FORM);
      setEntityOptions([]);
      void load(statusFilter);
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Tạo task thất bại"));
    } finally {
      setSubmitting(false);
    }
  };

  const handleUpdateStatus = async (id: string, status: "IN_PROGRESS" | "DONE") => {
    setUpdatingId(id);
    try {
      await staffTaskService.updateStatus(id, status);
      toast.success(status === "DONE" ? "Đã hoàn thành task" : "Đã bắt đầu thực hiện task");
      void load(statusFilter);
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Cập nhật trạng thái thất bại"));
    } finally {
      setUpdatingId("");
    }
  };

  const colSpan = isManager ? 11 : 9;

  return (
    <PageWrapper className="space-y-6">
      <FadeItem>
        <PageHeader
          icon={ClipboardList}
          title={isManager ? "Giao việc nhân viên" : "Task được giao"}
          description={isManager ? "Tạo và theo dõi task giao cho nhân viên kho" : "Các task được quản lý giao cho bạn"}
          iconBg="bg-violet-100 dark:bg-violet-500/15"
          iconColor="text-violet-700 dark:text-violet-400"
          actions={
            <>
              <Button type="button" variant="outline" size="sm" onClick={() => void load(statusFilter)} disabled={loading} aria-label="Làm mới">
                <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
                Làm mới
              </Button>
              {isManager && (
                <Button type="button" size="sm" onClick={() => setShowForm(!showForm)}
                  className="bg-violet-600 hover:bg-violet-700">
                  <Plus className="h-3.5 w-3.5" />
                  Tạo task
                </Button>
              )}
            </>
          }
        />
      </FadeItem>

      {/* Create form — Manager only */}
      {isManager && showForm && (
        <FadeItem>
        <motion.div
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.18 }}
        >
          <SectionCard>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-[14px] font-semibold">Tạo task mới</h2>
              <button type="button" onClick={() => { setShowForm(false); setForm(BLANK_FORM); setEntityOptions([]); }} aria-label="Đóng biểu mẫu" className="text-muted-foreground hover:text-foreground">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <div>
                <label htmlFor="task-warehouse" className="block text-[11px] font-semibold text-muted-foreground mb-1">Kho *</label>
                <select
                  id="task-warehouse"
                  data-testid="staff-task-warehouse"
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-[13px]"
                  value={form.warehouse_id ?? ""}
                  onChange={(e) => handleFormWarehouseChange(e.target.value)}
                >
                  <option value="">{warehouses.length ? "Chọn kho trước" : "Bạn chưa được phân công kho nào"}</option>
                  {warehouses.map((w) => (
                    <option key={w.id} value={w.id}>{w.code} · {w.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="task-assignee" className="block text-[11px] font-semibold text-muted-foreground mb-1">Nhân viên được giao *</label>
                <select
                  id="task-assignee"
                  data-testid="staff-task-assignee"
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-[13px] disabled:opacity-60"
                  value={form.assignee_user_id}
                  onChange={(e) => setForm((f) => ({ ...f, assignee_user_id: e.target.value }))}
                  disabled={!form.warehouse_id || formStaffLoading || formStaff.length === 0}
                  aria-describedby="task-assignee-hint"
                >
                  <option value="">
                    {!form.warehouse_id
                      ? "Chọn kho để xem nhân viên"
                      : formStaffLoading
                        ? "Đang tải nhân viên..."
                        : formStaff.length === 0
                          ? "Kho này chưa có nhân viên nhận được việc"
                          : "Chọn nhân viên"}
                  </option>
                  {formStaff.map((s) => (
                    <option key={s.id} value={s.id}>{s.full_name} ({s.username})</option>
                  ))}
                </select>
                <p id="task-assignee-hint" className={cn("mt-1 text-[11px]", formStaffError ? "text-red-600 dark:text-red-400" : "text-muted-foreground")}>
                  {formStaffError || "Chỉ nhân viên đang hoạt động có quyền thao tác ở kho này."}
                </p>
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-muted-foreground mb-1">Tiêu đề *</label>
                <input
                  type="text"
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-[13px]"
                  placeholder="Mô tả ngắn gọn việc cần làm..."
                  value={form.title}
                  onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-muted-foreground mb-1">Loại task</label>
                <select
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-[13px]"
                  value={form.task_type}
                  onChange={(e) => setForm((f) => ({ ...f, task_type: e.target.value as StaffTaskCreateInput["task_type"] }))}
                >
                  {TASK_TYPE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-muted-foreground mb-1">Độ ưu tiên</label>
                <select
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-[13px]"
                  value={form.priority}
                  onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value as StaffTaskCreateInput["priority"] }))}
                >
                  {PRIORITY_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-muted-foreground mb-1">Hạn hoàn thành</label>
                <input
                  type="datetime-local"
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-[13px]"
                  value={form.due_date ?? ""}
                  onChange={(e) => setForm((f) => ({ ...f, due_date: e.target.value || null }))}
                />
              </div>
              <div className="lg:col-span-3">
                <label className="block text-[11px] font-semibold text-muted-foreground mb-1">Mô tả chi tiết</label>
                <textarea
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-[13px] resize-none"
                  rows={2}
                  placeholder="Hướng dẫn cụ thể cho nhân viên (tùy chọn)..."
                  value={form.description ?? ""}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                />
              </div>

              {/* Entity Linking */}
              <div className="lg:col-span-3">
                <label className="block text-[11px] font-semibold text-muted-foreground mb-1">
                  Liên kết đến nghiệp vụ cụ thể
                  <span className="ml-1 font-normal text-muted-foreground/70">(tùy chọn — staff thấy chi tiết ngay trong task)</span>
                </label>
                <div className="flex gap-2 flex-wrap sm:flex-nowrap">
                  <select
                    className="rounded-md border border-border bg-background px-3 py-2 text-[13px] w-full sm:w-[210px] shrink-0 disabled:opacity-60"
                    value={form.related_entity_type ?? ""}
                    onChange={(e) => void handleEntityTypeChange(e.target.value)}
                    disabled={!form.warehouse_id}
                    title={form.warehouse_id ? undefined : "Chọn kho trước"}
                  >
                    <option value="">Không liên kết</option>
                    {ENTITY_TYPE_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                  {form.related_entity_type && (
                    <select
                      className="flex-1 min-w-0 rounded-md border border-border bg-background px-3 py-2 text-[13px]"
                      value={form.related_entity_id ?? ""}
                      onChange={(e) => handleEntitySelect(e.target.value)}
                      disabled={loadingEntityOptions}
                    >
                      <option value="">{loadingEntityOptions ? "Đang tải..." : "Chọn đối tượng..."}</option>
                      {entityOptions.map((opt) => (
                        <option key={opt.id} value={opt.id}>{opt.label}</option>
                      ))}
                    </select>
                  )}
                </div>
                {form.related_entity_type && form.related_entity_id && (
                  <p className="text-[11px] text-emerald-600 dark:text-emerald-400 mt-1.5">
                    ✓ Staff sẽ thấy chi tiết {ENTITY_TYPE_LABELS[form.related_entity_type] ?? form.related_entity_type} ngay trong task mà không cần chuyển trang.
                  </p>
                )}
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-3">
              <Button type="button" variant="outline" size="sm" onClick={() => { setShowForm(false); setForm(BLANK_FORM); setEntityOptions([]); }}>
                Hủy
              </Button>
              <Button type="button" size="sm" disabled={submitting} onClick={() => void handleCreate()}
                className="bg-violet-600 hover:bg-violet-700">
                {submitting ? "Đang tạo..." : "Tạo task"}
              </Button>
            </div>
          </SectionCard>
        </motion.div>
        </FadeItem>
      )}

      <FadeItem>
        <SectionCard noPadding>
          <div className="flex flex-col gap-3 border-b border-border px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="text-[15px] font-semibold">
              {isManager ? "Danh sách task đã giao" : "Task của tôi"}
            </h2>
            <FilterBar
              className="sm:w-auto"
              filters={(
                <div className="flex flex-wrap items-center gap-2">
                  {isManager && (
                    <Select value={warehouseFilter} onValueChange={setWarehouseFilter}>
                      <SelectTrigger className="w-[200px]" size="sm" aria-label="Lọc theo kho">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={ALL_WAREHOUSES}>Mọi kho của tôi</SelectItem>
                        {warehouses.map((w) => (
                          <SelectItem key={w.id} value={w.id}>{w.code} · {w.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                  <Select value={statusFilter} onValueChange={setStatusFilter}>
                    <SelectTrigger className="w-[170px]" size="sm" aria-label="Lọc theo trạng thái">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {STATUS_FILTERS.map((s) => (
                        <SelectItem key={s} value={s}>{STATUS_FILTER_LABELS[s]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            />
          </div>
          <div className="overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/30 hover:bg-muted/30">
                  {[
                    "Tiêu đề",
                    "Liên kết",
                    "Loại",
                    "Độ ưu tiên",
                    ...(isManager ? ["Kho", "Nhân viên"] : []),
                    "Trạng thái",
                    "Hạn",
                    "Tạo lúc",
                    "Hoàn tất",
                    "Thao tác",
                  ].map((h) => (
                    <TableHead key={h} className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{h}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <SkeletonTableRow columns={colSpan} rows={4} />
                ) : tasks.length === 0 ? (
                  <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={colSpan} className="whitespace-normal px-5 py-10">
                      <EmptyState
                        icon={ClipboardList}
                        title="Chưa có task nào"
                        description={isManager ? "Tạo task để giao cho nhân viên kho." : "Quản lý chưa giao task nào cho bạn."}
                      />
                    </TableCell>
                  </TableRow>
                ) : pagedTasks.map((task) => (
                  <TableRow key={task.id} className="hover:bg-muted/30">
                    <TableCell className="whitespace-normal text-[13px] font-medium max-w-[180px]">
                      <span className="block truncate" title={task.title}>{task.title}</span>
                      {task.description && (
                        <span className="block truncate text-[11px] text-muted-foreground" title={task.description}>{task.description}</span>
                      )}
                    </TableCell>

                    {/* Entity link column */}
                    <TableCell className="whitespace-normal max-w-[200px]">
                      {task.related_entity_type && task.related_entity_display ? (
                        <div className="space-y-1">
                          <NavLink
                            to={getEntityNavPath(task.related_entity_type)}
                            className="inline-flex items-center gap-1 rounded-md border border-indigo-100 bg-indigo-50 px-2 py-0.5 text-[11px] text-indigo-700 hover:bg-indigo-100 transition-colors dark:border-indigo-500/20 dark:bg-indigo-500/10 dark:text-indigo-400 dark:hover:bg-indigo-500/15"
                          >
                            <Link2 className="h-3 w-3 shrink-0" />
                            <span className="truncate max-w-[120px]">{task.related_entity_display.ref_number}</span>
                          </NavLink>
                          {task.related_entity_display.details && (
                            <p className="text-[10px] text-muted-foreground leading-tight line-clamp-2">
                              {task.related_entity_display.details}
                            </p>
                          )}
                        </div>
                      ) : (
                        <span className="text-[12px] text-muted-foreground">—</span>
                      )}
                    </TableCell>

                    <TableCell className="text-[12px]">{TASK_TYPE_LABELS[task.task_type] || task.task_type}</TableCell>
                    <TableCell>
                      <StatusBadge label={PRIORITY_OPTIONS.find((o) => o.value === task.priority)?.label || task.priority} variant={priorityVariant(task.priority)} dot />
                    </TableCell>
                    {isManager && (
                      <TableCell className="text-[12px] text-muted-foreground" title={task.warehouses?.name}>
                        {task.warehouses?.code || "—"}
                      </TableCell>
                    )}
                    {isManager && (
                      <TableCell className="whitespace-normal text-[12px] text-muted-foreground">
                        <span className="block">{staffName(task.assignee_user_id)}</span>
                        {task.assignee_can_work === false && OPEN_STATUSES.includes(task.status) ? (
                          <span
                            className="mt-1 inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-800 dark:bg-amber-500/10 dark:text-amber-300"
                            title="Nhân viên không còn quyền thao tác ở kho này hoặc đã bị khóa"
                          >
                            <AlertTriangle className="h-3 w-3" aria-hidden="true" /> Cần giao lại
                          </span>
                        ) : null}
                      </TableCell>
                    )}
                    <TableCell>
                      <StatusBadge label={task.status === "IN_PROGRESS" ? "Đang làm" : task.status === "DONE" ? "Hoàn thành" : task.status === "CANCELLED" ? "Đã hủy" : "Mới"} variant={statusVariant(task.status)} dot />
                    </TableCell>
                    <TableCell className="text-[12px] text-muted-foreground">{formatDate(task.due_date)}</TableCell>
                    <TableCell className="text-[12px] text-muted-foreground">{formatDate(task.created_at)}</TableCell>
                    <TableCell className="text-[12px] text-muted-foreground">{formatDate(task.completed_at)}</TableCell>
                    <TableCell className="text-[12px]">
                      {!isManager && task.status === "OPEN" && (
                        <Button type="button" size="sm" disabled={updatingId === task.id}
                          onClick={() => void handleUpdateStatus(task.id, "IN_PROGRESS")}
                          className="h-7 px-2 text-[11px] bg-blue-600 hover:bg-blue-700">
                          <PlayCircle className="h-3 w-3" /> Bắt đầu
                        </Button>
                      )}
                      {!isManager && task.status === "IN_PROGRESS" && (
                        <Button type="button" size="sm" disabled={updatingId === task.id}
                          onClick={() => void handleUpdateStatus(task.id, "DONE")}
                          className="h-7 px-2 text-[11px] bg-emerald-600 hover:bg-emerald-700">
                          <CheckCircle className="h-3 w-3" /> Hoàn thành
                        </Button>
                      )}
                      {isManager && OPEN_STATUSES.includes(task.status) && (
                        <Button type="button" size="sm" variant="outline"
                          onClick={() => setReassignTask(task)}
                          className="h-7 px-2 text-[11px]"
                          aria-label={`Giao lại task ${task.title}`}>
                          <UserRoundCog className="h-3 w-3" /> Giao lại
                        </Button>
                      )}
                      {(task.status === "DONE" || task.status === "CANCELLED") && (
                        <span className="text-[11px] text-muted-foreground">-</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {tasks.length > 0 && (
            <div className="flex flex-col gap-3 border-t border-border px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-[12px] text-muted-foreground">
                Hiển thị <span className="font-medium text-foreground">{pagedTasks.length}</span> / {tasks.length} task
              </p>
              {totalPages > 1 && (
                <Pagination className="mx-0 w-auto justify-end">
                  <PaginationContent>
                    <PaginationItem>
                      <PaginationPrevious
                        onClick={(event) => {
                          event.preventDefault();
                          setPage((current) => Math.max(1, current - 1));
                        }}
                        className={cn("cursor-pointer", page === 1 && "pointer-events-none opacity-50")}
                      />
                    </PaginationItem>
                    {getPaginationRange(page, totalPages).map((item) => (
                      <PaginationItem key={item}>
                        {typeof item === "number" ? (
                          <PaginationLink
                            isActive={item === page}
                            onClick={(event) => {
                              event.preventDefault();
                              setPage(item);
                            }}
                            className="cursor-pointer"
                          >
                            {item}
                          </PaginationLink>
                        ) : (
                          <PaginationEllipsis />
                        )}
                      </PaginationItem>
                    ))}
                    <PaginationItem>
                      <PaginationNext
                        onClick={(event) => {
                          event.preventDefault();
                          setPage((current) => Math.min(totalPages, current + 1));
                        }}
                        className={cn("cursor-pointer", page === totalPages && "pointer-events-none opacity-50")}
                      />
                    </PaginationItem>
                  </PaginationContent>
                </Pagination>
              )}
            </div>
          )}
        </SectionCard>
      </FadeItem>

      {isManager && selectedWarehouse ? (
        <FadeItem>
          <WorkloadPanel warehouse={selectedWarehouse} staffName={staffName} refreshKey={workloadKey} />
        </FadeItem>
      ) : null}

      {isManager ? (
        <ReassignDialog
          key={reassignTask?.id ?? "none"}
          task={reassignTask}
          staffName={staffName}
          onClose={() => setReassignTask(null)}
          onDone={() => void load(statusFilter)}
        />
      ) : null}
    </PageWrapper>
  );
}
