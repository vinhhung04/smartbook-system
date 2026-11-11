import { useCallback, useEffect, useId, useMemo, useState, type FormEvent } from "react";
import { AlertTriangle, CheckCircle2, ClipboardList, Link2, PlayCircle, Plus, RefreshCw, Search, UserRoundCog, X } from "lucide-react";
import { toast } from "sonner";
import { NavLink } from "react-router";
import { PageWrapper, FadeItem } from "../motion-utils";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/status-badge";
import { PriorityBadge } from "@/components/ui/priority-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { BlockEmpty, BlockError } from "@/components/pages/dashboard/panel";
import { ChoiceChips, Field, FormGroup, FormSheet, ListFooter, QueueTabs, RowsSkeleton } from "@/components/ops/ops-kit";
import { fieldAria, formatDateTime, nativeSelectClass, darkFieldClass } from "@/components/ops/ops-utils";
import { cn } from "@/components/ui/utils";
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
import { canAccess, canManageReceiving, ROUTE_ACCESS, type RouteAccessMeta } from "@/lib/rbac";
import { useAssignableStaff } from "@/hooks/useAssignableStaff";

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

// Older rows carry warehouse-flow types that predate the staff-task enum.
const TASK_TYPE_LABELS: Record<string, string> = {
  ...Object.fromEntries(TASK_TYPE_OPTIONS.map((o) => [o.value, o.label])),
  RECEIVING: "Tiếp nhận hàng",
  PUTAWAY: "Cất hàng",
  PICKING: "Lấy hàng",
  OUTBOUND: "Xuất kho",
};

const PRIORITY_OPTIONS: Array<{ value: NonNullable<StaffTaskCreateInput["priority"]>; label: string }> = [
  { value: "LOW", label: "Thấp" },
  { value: "MEDIUM", label: "Trung bình" },
  { value: "HIGH", label: "Cao" },
  { value: "URGENT", label: "Khẩn cấp" },
];

const STATUS_FILTERS = ["ALL", "OPEN", "IN_PROGRESS", "DONE", "CANCELLED"] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number];

const STATUS_LABELS: Record<string, string> = {
  ALL: "Tất cả",
  OPEN: "Mới",
  IN_PROGRESS: "Đang làm",
  DONE: "Hoàn thành",
  CANCELLED: "Đã hủy",
};

// Work in hand first, then new, then closed; the API's newest-first order is kept inside each group.
const STATUS_ORDER: Record<string, number> = { IN_PROGRESS: 0, OPEN: 1, DONE: 2, CANCELLED: 3 };

const PAGE_SIZE = 10;
const PANEL_ID = "staff-task-list";

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

// Where a linked record opens, and who may open it; the link is plain text for anyone else.
const ENTITY_ROUTES: Record<string, { path: string; access: RouteAccessMeta }> = {
  EXCEPTION_REPORT: { path: "/exception-reports", access: ROUTE_ACCESS.exceptionReportManage },
  PURCHASE_REQUEST: { path: "/purchase-requests", access: ROUTE_ACCESS.purchaseRequestManage },
  OUTBOUND_ORDER: { path: "/outbound", access: ROUTE_ACCESS.staffTaskProgress },
  TRANSFER_ORDER: { path: "/picking", access: ROUTE_ACCESS.staffTaskProgress },
};

function statusVariant(status: string): "success" | "warning" | "danger" | "info" | "neutral" {
  const s = status.toUpperCase();
  if (s === "DONE") return "success";
  if (s === "IN_PROGRESS") return "info";
  if (s === "OPEN") return "warning";
  return "neutral";
}

const ALL_WAREHOUSES = "ALL";
const OPEN_STATUSES = ["OPEN", "IN_PROGRESS"];

function isOverdue(task: StaffTask) {
  if (!task.due_date || !OPEN_STATUSES.includes(task.status)) return false;
  const due = new Date(task.due_date).getTime();
  return !Number.isNaN(due) && due < Date.now();
}

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
    if (!task || !assigneeId || saving) return;
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
    <Dialog open={Boolean(task)} onOpenChange={(open) => { if (!open && !saving) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Giao lại task</DialogTitle>
          <DialogDescription>
            {task ? `“${task.title}” đang giao cho ${staffName(task.assignee_user_id)}${task.warehouses ? ` tại ${task.warehouses.code}` : ""}.` : null}
          </DialogDescription>
        </DialogHeader>
        {!task?.warehouse_id ? (
          <p className="text-[13px] text-muted-foreground">Task cũ không gắn kho, không thể giao lại an toàn. Hãy hủy và tạo task mới có chọn kho.</p>
        ) : (
          <Field
            id="reassign-assignee"
            label="Nhân viên mới"
            required
            error={error}
            hint={task.status === "IN_PROGRESS" ? "Task đang làm sẽ quay về trạng thái Mới cho người được giao lại." : "Chỉ nhân viên đang hoạt động có quyền thao tác ở kho này."}
          >
            <select
              {...fieldAria("reassign-assignee", error, true)}
              className={nativeSelectClass}
              value={assigneeId}
              onChange={(e) => setAssigneeId(e.target.value)}
              disabled={loading || candidates.length === 0}
            >
              <option value="">{loading ? "Đang tải nhân viên…" : candidates.length === 0 ? "Không có nhân viên khác nhận được việc ở kho này" : "Chọn nhân viên"}</option>
              {candidates.map((s) => (
                <option key={s.id} value={s.id}>{s.full_name} ({s.username})</option>
              ))}
            </select>
          </Field>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={saving}>Hủy</Button>
          <Button type="button" disabled={!assigneeId} loading={saving} onClick={() => void submit()}>
            {saving ? "Đang lưu…" : "Giao lại"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function WorkloadPanel({ warehouse, staffName, refreshKey, activeAssignee, onPickAssignee }: {
  warehouse: Warehouse;
  staffName: (id: string) => string;
  refreshKey: number;
  activeAssignee: string | null;
  onPickAssignee: (id: string | null) => void;
}) {
  const requestKey = `${warehouse.id}:${refreshKey}`;
  const [result, setResult] = useState<{ key: string; rows: StaffWorkloadRow[]; error: string | null } | null>(null);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let cancelled = false;
    staffTaskService.getWorkload(warehouse.id)
      .then((res) => { if (!cancelled) setResult({ key: requestKey, rows: Array.isArray(res.data) ? res.data : [], error: null }); })
      .catch((err) => { if (!cancelled) setResult({ key: requestKey, rows: [], error: getApiErrorMessage(err, "Không tải được khối lượng việc") }); });
    return () => { cancelled = true; };
  }, [warehouse.id, requestKey, retry]);

  const current = result?.key === requestKey ? result : null;
  const rows = current?.rows ?? [];
  const error = current?.error ?? null;
  const loading = !current;

  const sorted = [...rows].sort((a, b) => (b.open + b.in_progress) - (a.open + a.in_progress));
  const numberHead = "h-10 px-3 text-right text-[12px] font-normal text-muted-foreground";

  return (
    <section aria-labelledby="workload-title" className="min-w-0 max-w-3xl rounded-xl border border-border bg-card">
      <div className="px-5 pt-4">
        <h2 id="workload-title" className="text-[15px] font-semibold text-foreground">Khối lượng việc tại {warehouse.code}</h2>
        <p className="mt-0.5 text-[13px] text-muted-foreground">
          Mỗi task tính một lần theo trạng thái hiện tại; quá hạn nằm trong số Mới và Đang làm. Chọn tên để lọc danh sách.
        </p>
      </div>
      <div className="px-2 pb-3 pt-2 sm:px-3">
        {loading ? (
          <RowsSkeleton rows={3} />
        ) : error ? (
          <BlockError what="khối lượng việc" onRetry={() => { setResult(null); setRetry((n) => n + 1); }} className="mx-2" />
        ) : sorted.length === 0 ? (
          <BlockEmpty className="mx-2">Không có task đang mở hay vừa hoàn thành ở kho này.</BlockEmpty>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="h-10 px-3 text-[12px] font-normal text-muted-foreground">Nhân viên</TableHead>
                <TableHead className={numberHead}>Mới</TableHead>
                <TableHead className={numberHead}>Đang làm</TableHead>
                <TableHead className={numberHead}>Quá hạn</TableHead>
                <TableHead className={numberHead}>Xong 7 ngày</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.map((row) => {
                const active = activeAssignee === row.assignee_user_id;
                return (
                  <TableRow key={row.assignee_user_id} className={cn(active && "bg-primary/5")}>
                    <TableCell className="px-3">
                      <button
                        type="button"
                        aria-pressed={active}
                        onClick={() => onPickAssignee(active ? null : row.assignee_user_id)}
                        className="rounded text-left text-[13px] font-medium text-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                      >
                        {staffName(row.assignee_user_id)}
                      </button>
                    </TableCell>
                    <TableCell className="px-3 text-right text-[13px] tabular-nums">{row.open}</TableCell>
                    <TableCell className="px-3 text-right text-[13px] tabular-nums">{row.in_progress}</TableCell>
                    <TableCell className={cn("px-3 text-right text-[13px] tabular-nums", row.overdue > 0 ? "font-semibold text-red-600 dark:text-red-400" : "text-muted-foreground")}>{row.overdue}</TableCell>
                    <TableCell className="px-3 text-right text-[13px] tabular-nums text-muted-foreground">{row.done_last_7_days}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </div>
    </section>
  );
}

type TaskForm = StaffTaskCreateInput & { related_entity_type: string | null; related_entity_id: string | null };
type FormErrors = Partial<Record<"warehouse" | "assignee" | "title" | "due", string>>;

const BLANK_FORM: TaskForm = {
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

function validateTask(form: TaskForm): FormErrors {
  const errors: FormErrors = {};
  if (!form.warehouse_id) errors.warehouse = "Chọn kho thực hiện.";
  if (!form.assignee_user_id) errors.assignee = "Chọn nhân viên được giao.";
  if (!form.title.trim()) errors.title = "Nhập tiêu đề công việc.";
  if (form.due_date && new Date(form.due_date).getTime() < Date.now()) errors.due = "Hạn hoàn thành phải sau thời điểm hiện tại.";
  return errors;
}

export function StaffTasksPage() {
  const currentUser = authService.getCurrentUser();
  const isManager = canManageReceiving(currentUser);
  const ids = useId();
  const fieldId = (name: string) => `${ids}-${name}`;

  const [tasks, setTasks] = useState<StaffTask[]>([]);
  const [serverTotal, setServerTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL");
  const [search, setSearch] = useState("");
  const [assigneeFilter, setAssigneeFilter] = useState<string | null>(null);
  const [warehouseStaff, setWarehouseStaff] = useState<WarehouseStaffOption[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<TaskForm>(BLANK_FORM);
  const [errors, setErrors] = useState<FormErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [updatingId, setUpdatingId] = useState("");
  const [entityOptions, setEntityOptions] = useState<EntityOption[]>([]);
  const [loadingEntityOptions, setLoadingEntityOptions] = useState(false);
  const [entityError, setEntityError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [warehouseFilter, setWarehouseFilter] = useState(ALL_WAREHOUSES);
  const [reassignTask, setReassignTask] = useState<StaffTask | null>(null);
  const [workloadKey, setWorkloadKey] = useState(0);
  const { staff: formStaff, loading: formStaffLoading, error: formStaffError } = useAssignableStaff(showForm ? form.warehouse_id : null);

  // Status stays a server filter: each list call returns at most 50 rows, so filtering
  // locally would hide older tasks of the chosen status.
  const load = useCallback(async (status: StatusFilter, mode: "initial" | "refresh") => {
    if (mode === "initial") setLoading(true); else setRefreshing(true);
    try {
      if (isManager) {
        const res = await staffTaskService.getAll({
          ...(status !== "ALL" ? { status } : {}),
          ...(warehouseFilter !== ALL_WAREHOUSES ? { warehouse_id: warehouseFilter } : {}),
        });
        setTasks(Array.isArray(res.data) ? res.data : []);
        setServerTotal(typeof res.total === "number" ? res.total : null);
        setWorkloadKey((v) => v + 1);
      } else {
        const res = await staffTaskService.getMy(status !== "ALL" ? { status } : {});
        setTasks(Array.isArray(res.data) ? res.data : []);
      }
      setLoadError(null);
    } catch (err) {
      const message = getApiErrorMessage(err, "Không tải được danh sách task");
      setLoadError(message);
      if (mode === "refresh") toast.error(message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [isManager, warehouseFilter]);

  useEffect(() => { void load(statusFilter, "initial"); }, [load, statusFilter]);
  const reload = () => void load(statusFilter, "refresh");

  useEffect(() => { setPage(1); }, [statusFilter, warehouseFilter, search, assigneeFilter]);
  useEffect(() => { setAssigneeFilter(null); }, [warehouseFilter]);

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
  const staffName = useCallback((id: string) => staffById[id] || "Nhân viên không rõ", [staffById]);
  const selectedWarehouse = warehouses.find((w) => w.id === warehouseFilter) || null;

  const visibleTasks = useMemo(() => {
    const query = search.trim().toLowerCase();
    const list = tasks.filter((task) => {
      if (assigneeFilter && task.assignee_user_id !== assigneeFilter) return false;
      if (!query) return true;
      return [task.title, task.description, staffById[task.assignee_user_id], task.warehouses?.code, task.related_entity_display?.ref_number, TASK_TYPE_LABELS[task.task_type]]
        .filter(Boolean).join(" ").toLowerCase().includes(query);
    });
    if (isManager) return list;
    return list
      .map((task, index) => ({ task, index }))
      .sort((a, b) => ((STATUS_ORDER[a.task.status] ?? 9) - (STATUS_ORDER[b.task.status] ?? 9)) || a.index - b.index)
      .map(({ task }) => task);
  }, [tasks, search, assigneeFilter, staffById, isManager]);

  const totalPages = Math.max(1, Math.ceil(visibleTasks.length / PAGE_SIZE));
  const pagedTasks = visibleTasks.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  useEffect(() => { setPage((current) => Math.min(current, totalPages)); }, [totalPages]);

  const openForm = () => {
    // Start the form in the warehouse the manager is already looking at.
    if (!form.warehouse_id && warehouseFilter !== ALL_WAREHOUSES) {
      setForm((f) => ({ ...f, warehouse_id: warehouseFilter }));
    }
    setShowForm(true);
  };

  const resetForm = () => {
    setForm(BLANK_FORM);
    setErrors({});
    setEntityOptions([]);
    setEntityError(null);
  };

  const updateForm = (patch: Partial<TaskForm>, clears?: keyof FormErrors) => {
    setForm((f) => ({ ...f, ...patch }));
    if (clears) setErrors((e) => ({ ...e, [clears]: undefined }));
  };

  // choosing (or changing) the warehouse resets everything that depended on it
  const handleFormWarehouseChange = (warehouseId: string) => {
    setForm((f) => ({ ...f, warehouse_id: warehouseId || null, assignee_user_id: "", related_entity_type: null, related_entity_id: null }));
    setErrors((e) => ({ ...e, warehouse: undefined }));
    setEntityOptions([]);
    setEntityError(null);
  };

  const handleEntityTypeChange = async (entityType: string) => {
    setForm((f) => ({ ...f, related_entity_type: entityType || null, related_entity_id: null }));
    setEntityOptions([]);
    setEntityError(null);
    if (!entityType) return;
    setLoadingEntityOptions(true);
    try {
      const res = await staffTaskService.getEntityOptions(entityType, form.warehouse_id ?? undefined);
      setEntityOptions(Array.isArray(res.data) ? res.data : []);
    } catch (err) {
      setEntityOptions([]);
      setEntityError(getApiErrorMessage(err, "Không tải được danh sách nghiệp vụ"));
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
    if (option) setErrors((e) => ({ ...e, title: undefined }));
  };

  const handleCreate = async (event: FormEvent) => {
    event.preventDefault();
    if (submitting) return;
    const found = validateTask(form);
    setErrors(found);
    const firstInvalid = (["warehouse", "assignee", "title", "due"] as const).find((key) => found[key]);
    if (firstInvalid) {
      document.getElementById(fieldId(firstInvalid))?.focus();
      return;
    }
    setSubmitting(true);
    try {
      await staffTaskService.create({
        ...form,
        title: form.title.trim(),
        description: form.description || null,
        warehouse_id: form.warehouse_id || null,
        due_date: form.due_date || null,
        related_entity_type: form.related_entity_type || null,
        related_entity_id: form.related_entity_id || null,
      });
      toast.success(`Đã giao việc cho ${staffName(form.assignee_user_id)}`);
      setShowForm(false);
      resetForm();
      reload();
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Tạo task thất bại"));
    } finally {
      setSubmitting(false);
    }
  };

  const handleUpdateStatus = async (task: StaffTask, status: "IN_PROGRESS" | "DONE") => {
    if (updatingId) return;
    setUpdatingId(task.id);
    try {
      await staffTaskService.updateStatus(task.id, status);
      toast.success(status === "DONE" ? `Đã hoàn thành “${task.title}”` : `Đã bắt đầu “${task.title}”`);
      reload();
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Cập nhật trạng thái thất bại"));
    } finally {
      setUpdatingId("");
    }
  };

  const renderEntity = (task: StaffTask) => {
    if (!task.related_entity_type || !task.related_entity_display) return null;
    const route = ENTITY_ROUTES[task.related_entity_type];
    const label = ENTITY_TYPE_LABELS[task.related_entity_type] ?? task.related_entity_type;
    const ref = <span className="font-mono">{task.related_entity_display.ref_number}</span>;
    return (
      <p className="mt-1 flex min-w-0 items-center gap-1 text-[12px] text-muted-foreground">
        <Link2 className="h-3 w-3 shrink-0" aria-hidden="true" />
        <span className="shrink-0">{label}</span>
        {route && canAccess(currentUser, route.access) ? (
          <NavLink to={route.path} className="shrink-0 rounded font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50">{ref}</NavLink>
        ) : <span className="shrink-0 text-foreground">{ref}</span>}
        {task.related_entity_display.details ? <span className="truncate" title={task.related_entity_display.details}>· {task.related_entity_display.details}</span> : null}
      </p>
    );
  };

  const renderDue = (task: StaffTask) => {
    const overdue = isOverdue(task);
    if (task.status === "DONE" && task.completed_at) {
      return <span className="text-muted-foreground" title={formatDateTime(task.completed_at) ?? undefined}>Xong {formatDateTime(task.completed_at)}</span>;
    }
    if (!task.due_date) return <span className="text-muted-foreground">Không hạn</span>;
    return (
      <span className={cn(overdue ? "font-medium text-red-600 dark:text-red-400" : "text-foreground")}>
        {overdue ? "Quá hạn · " : "Hạn "}{formatDateTime(task.due_date)}
      </span>
    );
  };

  const renderAction = (task: StaffTask, compact = false) => {
    const size = compact ? "h-10 sm:h-8" : "h-8";
    const busy = updatingId === task.id;
    if (!isManager && task.status === "OPEN") {
      return (
        <Button type="button" variant="outline" className={cn(size, "text-[13px]")} loading={busy} disabled={Boolean(updatingId) && !busy} onClick={() => void handleUpdateStatus(task, "IN_PROGRESS")} aria-label={`Bắt đầu ${task.title}`}>
          {!busy ? <PlayCircle className="h-3.5 w-3.5" aria-hidden="true" /> : null}Bắt đầu
        </Button>
      );
    }
    if (!isManager && task.status === "IN_PROGRESS") {
      return (
        <Button type="button" variant="outline" className={cn(size, "text-[13px]")} loading={busy} disabled={Boolean(updatingId) && !busy} onClick={() => void handleUpdateStatus(task, "DONE")} aria-label={`Hoàn thành ${task.title}`}>
          {!busy ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" aria-hidden="true" /> : null}Hoàn thành
        </Button>
      );
    }
    if (isManager && OPEN_STATUSES.includes(task.status)) {
      return (
        <Button type="button" variant="outline" className={cn(size, "text-[13px]")} onClick={() => setReassignTask(task)} aria-label={`Giao lại ${task.title}`}>
          <UserRoundCog className="h-3.5 w-3.5" aria-hidden="true" />Giao lại
        </Button>
      );
    }
    return null;
  };

  const showWarehouseColumn = isManager && warehouseFilter === ALL_WAREHOUSES;
  const reassignFlag = (task: StaffTask) => (task.assignee_can_work === false && OPEN_STATUSES.includes(task.status) ? (
    <span className="mt-1 inline-flex items-center gap-1 text-[12px] font-medium text-amber-700 dark:text-amber-400" title="Nhân viên không còn quyền thao tác ở kho này hoặc đã bị khóa">
      <AlertTriangle className="h-3 w-3" aria-hidden="true" />Cần giao lại
    </span>
  ) : null);

  const statusTabs = STATUS_FILTERS.map((key) => ({ key, label: STATUS_LABELS[key] }));
  const isFiltering = search.trim() !== "" || assigneeFilter !== null;
  const truncatedNote = isManager && serverTotal !== null && serverTotal > tasks.length
    ? `đang hiện ${tasks.length} task mới nhất trong ${serverTotal}`
    : undefined;

  const emptyState = isFiltering ? (
    <EmptyState
      icon={Search}
      title="Không có task khớp bộ lọc"
      description="Thử từ khóa khác hoặc bỏ lọc nhân viên."
      action={<Button size="sm" variant="outline" onClick={() => { setSearch(""); setAssigneeFilter(null); }}>Bỏ lọc</Button>}
    />
  ) : (
    <EmptyState
      icon={ClipboardList}
      title={statusFilter === "ALL" ? "Chưa có task nào" : `Không có task ${STATUS_LABELS[statusFilter].toLowerCase()}`}
      description={isManager ? "Giao việc để nhân viên kho thấy ngay trong danh sách của họ." : "Quản lý chưa giao task nào cho bạn ở trạng thái này."}
      action={isManager && statusFilter === "ALL" ? <Button size="sm" onClick={openForm}><Plus className="h-3.5 w-3.5" />Giao việc</Button> : undefined}
    />
  );

  return (
    <PageWrapper className="space-y-5">
      <FadeItem>
        <PageHeader
          icon={ClipboardList}
          title={isManager ? "Giao việc nhân viên" : "Task được giao"}
          description={isManager ? "Giao việc cho nhân viên kho, theo dõi tiến độ và giao lại khi cần" : "Việc quản lý giao cho bạn: bắt đầu khi nhận làm, đánh dấu hoàn thành khi xong"}
          iconBg="bg-violet-100 dark:bg-violet-500/15"
          iconColor="text-violet-700 dark:text-violet-400"
          actions={
            <>
              <Button type="button" variant="outline" size="sm" onClick={reload} disabled={loading || refreshing}>
                <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin motion-reduce:animate-none")} />
                Làm mới
              </Button>
              {isManager && (
                <Button type="button" size="sm" onClick={openForm}>
                  <Plus className="h-3.5 w-3.5" />
                  Giao việc
                </Button>
              )}
            </>
          }
        />
      </FadeItem>

      <FadeItem>
        <section aria-label={isManager ? "Task đã giao" : "Task của tôi"} className="min-w-0 rounded-xl border border-border bg-card">
          <QueueTabs label="Lọc theo trạng thái" tabs={statusTabs} value={statusFilter} onChange={setStatusFilter} panelId={PANEL_ID} />

          <div className="flex flex-col gap-2 border-b border-border px-4 py-3 sm:flex-row sm:flex-wrap sm:items-center sm:px-5">
            {isManager ? (
              <Select value={warehouseFilter} onValueChange={setWarehouseFilter}>
                <SelectTrigger className={cn("h-10 sm:h-9 sm:w-56", darkFieldClass)} aria-label="Lọc theo kho">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_WAREHOUSES}>Mọi kho tôi quản lý</SelectItem>
                  {warehouses.map((w) => (
                    <SelectItem key={w.id} value={w.id}>{w.code} · {w.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : null}
            <div className="relative min-w-0 sm:w-72">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={isManager ? "Tìm tiêu đề, nhân viên, chứng từ…" : "Tìm tiêu đề, chứng từ…"}
                aria-label="Tìm task"
                className="h-10 w-full rounded-md border border-input bg-input-background pl-9 pr-3 text-[14px] outline-none transition-[color,box-shadow] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:border-border dark:bg-muted/40 sm:h-9 sm:text-[13px]"
              />
            </div>
            {assigneeFilter ? (
              <span className="inline-flex h-9 w-fit items-center gap-1 rounded-md border border-primary/30 bg-primary/5 pl-3 pr-1 text-[13px] text-foreground">
                Nhân viên: <span className="font-medium">{staffName(assigneeFilter)}</span>
                <button type="button" onClick={() => setAssigneeFilter(null)} aria-label="Bỏ lọc nhân viên" className="inline-flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </span>
            ) : null}
          </div>

          <div id={PANEL_ID} role="tabpanel" aria-labelledby={`${PANEL_ID}-tab-${statusFilter}`} aria-busy={loading || refreshing}>
            {loading ? (
              <RowsSkeleton rows={5} />
            ) : loadError && tasks.length === 0 ? (
              <div className="p-4 sm:p-5"><BlockError what="danh sách task" onRetry={() => void load(statusFilter, "initial")} /></div>
            ) : pagedTasks.length === 0 ? (
              <div className="px-5 py-8">{emptyState}</div>
            ) : (
              <>
                {/* Desktop: a table that fits the canvas; secondary fields ride as sublines. */}
                <div className="hidden lg:block">
                  <Table className="table-fixed">
                    <TableHeader>
                      <TableRow className="hover:bg-transparent">
                        <TableHead className="h-10 w-auto pl-5 text-[12px] font-normal text-muted-foreground">Công việc</TableHead>
                        {isManager ? <TableHead className="h-10 w-[170px] text-[12px] font-normal text-muted-foreground">Nhân viên</TableHead> : null}
                        <TableHead className="h-10 w-[112px] text-[12px] font-normal text-muted-foreground">Ưu tiên</TableHead>
                        <TableHead className="h-10 w-[120px] text-[12px] font-normal text-muted-foreground">Trạng thái</TableHead>
                        <TableHead className="h-10 w-[190px] text-[12px] font-normal text-muted-foreground">Hạn</TableHead>
                        <TableHead className="h-10 w-[136px] pr-5 text-right text-[12px] font-normal text-muted-foreground"><span className="sr-only">Thao tác</span></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {pagedTasks.map((task) => (
                        <TableRow key={task.id} className="align-top hover:bg-muted/30">
                          <TableCell className="whitespace-normal py-3 pl-5">
                            <p className="truncate text-[13px] font-semibold text-foreground" title={task.title}>{task.title}</p>
                            <p className="mt-0.5 truncate text-[12px] text-muted-foreground" title={task.description ?? undefined}>
                              {TASK_TYPE_LABELS[task.task_type] || task.task_type}
                              {showWarehouseColumn && task.warehouses ? <> · <span title={task.warehouses.name}>{task.warehouses.code}</span></> : null}
                              {task.description ? <> · {task.description}</> : null}
                            </p>
                            {renderEntity(task)}
                          </TableCell>
                          {isManager ? (
                            <TableCell className="whitespace-normal py-3 text-[13px]">
                              <span className="block truncate text-foreground">{staffName(task.assignee_user_id)}</span>
                              {reassignFlag(task)}
                            </TableCell>
                          ) : null}
                          <TableCell className="py-3"><PriorityBadge priority={task.priority} /></TableCell>
                          <TableCell className="py-3"><StatusBadge label={STATUS_LABELS[task.status] ?? task.status} variant={statusVariant(task.status)} dot /></TableCell>
                          <TableCell className="whitespace-normal py-3 text-[12px] tabular-nums">
                            {renderDue(task)}
                            <span className="mt-0.5 block text-muted-foreground">Giao {formatDateTime(task.created_at)}</span>
                          </TableCell>
                          <TableCell className="py-3 pr-5 text-right">{renderAction(task)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>

                {/* Phone and tablet: two-line rows, every field kept, the one action on the right. */}
                <ul className="divide-y divide-border lg:hidden">
                  {pagedTasks.map((task) => (
                    <li key={task.id} className="px-4 py-3.5 sm:px-5">
                      <div className="flex items-start justify-between gap-3">
                        <p className="min-w-0 text-[14px] font-semibold text-foreground">{task.title}</p>
                        <PriorityBadge priority={task.priority} className="shrink-0" />
                      </div>
                      <p className="mt-1 text-[12px] text-muted-foreground">
                        {TASK_TYPE_LABELS[task.task_type] || task.task_type}
                        {isManager && task.warehouses ? <> · {task.warehouses.code}</> : null}
                        {isManager ? <> · {staffName(task.assignee_user_id)}</> : null}
                      </p>
                      {task.description ? <p className="mt-1 line-clamp-2 text-[12px] text-muted-foreground">{task.description}</p> : null}
                      {renderEntity(task)}
                      {isManager ? reassignFlag(task) : null}
                      <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-2">
                        <StatusBadge label={STATUS_LABELS[task.status] ?? task.status} variant={statusVariant(task.status)} dot />
                        <span className="text-[12px] tabular-nums">{renderDue(task)}</span>
                        <span className="ml-auto">{renderAction(task, true)}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>

          {!loading ? <ListFooter page={page} pageSize={PAGE_SIZE} total={visibleTasks.length} noun="task" onPageChange={setPage} note={truncatedNote} /> : null}
        </section>
      </FadeItem>

      {isManager ? (
        <FadeItem>
          {selectedWarehouse ? (
            <WorkloadPanel
              warehouse={selectedWarehouse}
              staffName={staffName}
              refreshKey={workloadKey}
              activeAssignee={assigneeFilter}
              onPickAssignee={setAssigneeFilter}
            />
          ) : (
            <BlockEmpty className="max-w-3xl">Chọn một kho ở bộ lọc phía trên để xem khối lượng việc của từng nhân viên.</BlockEmpty>
          )}
        </FadeItem>
      ) : null}

      {isManager ? (
        <ReassignDialog
          key={reassignTask?.id ?? "none"}
          task={reassignTask}
          staffName={staffName}
          onClose={() => setReassignTask(null)}
          onDone={reload}
        />
      ) : null}

      {isManager ? (
        <FormSheet
          open={showForm}
          onOpenChange={setShowForm}
          title="Giao việc cho nhân viên"
          description="Nhân viên thấy task ngay trong mục Task được giao. Nội dung đang nhập được giữ lại nếu bạn đóng bảng này."
          onSubmit={(e) => void handleCreate(e)}
          footer={(
            <>
              <Button type="button" variant="ghost" className="mr-auto px-2 sm:px-3" onClick={resetForm}>Xóa nội dung</Button>
              <Button type="button" variant="outline" onClick={() => setShowForm(false)}>Đóng</Button>
              <Button type="submit" loading={submitting}>{submitting ? "Đang giao…" : "Giao việc"}</Button>
            </>
          )}
        >
          <FormGroup title="Giao cho ai">
            <Field id={fieldId("warehouse")} label="Kho thực hiện" required error={errors.warehouse} hint={warehouses.length ? undefined : "Bạn chưa được phân công kho nào."}>
              <select
                {...fieldAria(fieldId("warehouse"), errors.warehouse, !warehouses.length)}
                data-testid="staff-task-warehouse"
                className={nativeSelectClass}
                value={form.warehouse_id ?? ""}
                onChange={(e) => handleFormWarehouseChange(e.target.value)}
              >
                <option value="">{warehouses.length ? "Chọn kho" : "Không có kho"}</option>
                {warehouses.map((w) => (
                  <option key={w.id} value={w.id}>{w.code} · {w.name}</option>
                ))}
              </select>
            </Field>
            <Field
              id={fieldId("assignee")}
              label="Nhân viên được giao"
              required
              error={errors.assignee || formStaffError}
              hint="Chỉ nhân viên đang hoạt động có quyền thao tác ở kho này. Đổi kho sẽ bỏ chọn nhân viên."
            >
              <select
                {...fieldAria(fieldId("assignee"), errors.assignee || formStaffError, true)}
                data-testid="staff-task-assignee"
                className={nativeSelectClass}
                value={form.assignee_user_id}
                onChange={(e) => updateForm({ assignee_user_id: e.target.value }, "assignee")}
                disabled={!form.warehouse_id || formStaffLoading || formStaff.length === 0}
              >
                <option value="">
                  {!form.warehouse_id
                    ? "Chọn kho trước"
                    : formStaffLoading
                      ? "Đang tải nhân viên…"
                      : formStaff.length === 0
                        ? "Kho này chưa có nhân viên nhận được việc"
                        : "Chọn nhân viên"}
                </option>
                {formStaff.map((s) => (
                  <option key={s.id} value={s.id}>{s.full_name} ({s.username})</option>
                ))}
              </select>
            </Field>
          </FormGroup>

          <FormGroup title="Nội dung công việc">
            <Field id={fieldId("type")} label="Loại công việc">
              <select
                id={fieldId("type")}
                className={nativeSelectClass}
                value={form.task_type}
                onChange={(e) => updateForm({ task_type: e.target.value as StaffTaskCreateInput["task_type"] })}
              >
                {TASK_TYPE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </Field>
            <Field id={fieldId("title")} label="Tiêu đề" required error={errors.title} hint="Ngắn gọn, nói rõ việc cần làm. Chọn nghiệp vụ liên quan bên dưới để điền tự động.">
              <Input
                {...fieldAria(fieldId("title"), errors.title, true)}
                className={cn("h-10", darkFieldClass)}
                placeholder="Ví dụ: Kiểm kệ A1 khu sách thiếu nhi"
                value={form.title}
                onChange={(e) => updateForm({ title: e.target.value }, "title")}
              />
            </Field>
            <Field id={fieldId("description")} label="Mô tả chi tiết" hint="Không bắt buộc.">
              <Textarea className={darkFieldClass}
                {...fieldAria(fieldId("description"), null, true)}
                rows={3}
                placeholder="Hướng dẫn cụ thể cho nhân viên"
                value={form.description ?? ""}
                onChange={(e) => updateForm({ description: e.target.value })}
              />
            </Field>
          </FormGroup>

          <FormGroup title="Ưu tiên và thời hạn">
            <div>
              <p id={fieldId("priority-label")} className="mb-1.5 text-[13px] font-medium text-foreground">Độ ưu tiên</p>
              <ChoiceChips
                labelledBy={fieldId("priority-label")}
                options={PRIORITY_OPTIONS}
                value={form.priority ?? "MEDIUM"}
                onChange={(value) => updateForm({ priority: value })}
              />
            </div>
            <Field id={fieldId("due")} label="Hạn hoàn thành" error={errors.due} hint="Không bắt buộc. Quá hạn sẽ được đánh dấu đỏ trong danh sách.">
              <Input
                {...fieldAria(fieldId("due"), errors.due, true)}
                type="datetime-local"
                className={cn("h-10 sm:w-64", darkFieldClass)}
                value={form.due_date ?? ""}
                onChange={(e) => updateForm({ due_date: e.target.value || null }, "due")}
              />
            </Field>
          </FormGroup>

          <FormGroup title="Nghiệp vụ liên quan" description="Không bắt buộc. Nhân viên thấy chi tiết chứng từ ngay trong task.">
            <Field id={fieldId("entity-type")} label="Loại nghiệp vụ" hint={form.warehouse_id ? undefined : "Chọn kho trước để xem chứng từ của kho đó."}>
              <select
                {...fieldAria(fieldId("entity-type"), null, !form.warehouse_id)}
                className={nativeSelectClass}
                value={form.related_entity_type ?? ""}
                onChange={(e) => void handleEntityTypeChange(e.target.value)}
                disabled={!form.warehouse_id}
              >
                <option value="">Không liên kết</option>
                {ENTITY_TYPE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </Field>
            {form.related_entity_type ? (
              <Field
                id={fieldId("entity")}
                label={ENTITY_TYPE_LABELS[form.related_entity_type] ?? "Chứng từ"}
                error={entityError}
                hint={!loadingEntityOptions && entityOptions.length === 0 ? "Kho này chưa có chứng từ loại này." : undefined}
              >
                <select
                  {...fieldAria(fieldId("entity"), entityError, !loadingEntityOptions && entityOptions.length === 0)}
                  className={nativeSelectClass}
                  value={form.related_entity_id ?? ""}
                  onChange={(e) => handleEntitySelect(e.target.value)}
                  disabled={loadingEntityOptions || entityOptions.length === 0}
                >
                  <option value="">{loadingEntityOptions ? "Đang tải…" : "Chọn chứng từ"}</option>
                  {entityOptions.map((opt) => (
                    <option key={opt.id} value={opt.id}>{opt.label}</option>
                  ))}
                </select>
              </Field>
            ) : null}
          </FormGroup>
        </FormSheet>
      ) : null}
    </PageWrapper>
  );
}
