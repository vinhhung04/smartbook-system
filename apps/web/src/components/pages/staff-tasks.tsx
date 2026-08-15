import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "motion/react";
import { ClipboardList, Link2, Plus, RefreshCw, X, CheckCircle, PlayCircle } from "lucide-react";
import { toast } from "sonner";
import { NavLink } from "react-router";
import { SectionCard } from "@/components/ui/section-card";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/status-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { SkeletonTableRow } from "@/components/ui/loading-state";
import { getApiErrorMessage } from "@/services/api";
import {
  staffTaskService,
  type EntityOption,
  type StaffTask,
  type StaffTaskCreateInput,
} from "@/services/staff-tasks";
import { userService, type WarehouseStaffOption } from "@/services/user";
import { authService } from "@/services/auth";
import { canManageReceiving } from "@/lib/rbac";

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

  const load = useCallback(async (status?: string) => {
    setLoading(true);
    try {
      if (isManager) {
        const res = await staffTaskService.getAll(status && status !== "ALL" ? { status } : {});
        setTasks(Array.isArray(res.data) ? res.data : []);
      } else {
        const res = await staffTaskService.getMy(status && status !== "ALL" ? { status } : {});
        setTasks(Array.isArray(res.data) ? res.data : []);
      }
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Không tải được danh sách task"));
    } finally {
      setLoading(false);
    }
  }, [isManager]);

  useEffect(() => { void load(statusFilter); }, [load, statusFilter]);

  useEffect(() => {
    if (!isManager) return;
    void userService.getWarehouseStaff().then((res) => {
      setWarehouseStaff(Array.isArray(res.data) ? res.data : []);
    }).catch(() => {});
  }, [isManager]);

  const staffById = useMemo(() => {
    const map: Record<string, string> = {};
    for (const s of warehouseStaff) map[s.id] = s.full_name;
    return map;
  }, [warehouseStaff]);

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

  const colSpan = isManager ? 10 : 9;

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.24 }}
      >
        <PageHeader
          icon={ClipboardList}
          title={isManager ? "Giao việc nhân viên" : "Task được giao"}
          description={isManager ? "Tạo và theo dõi task giao cho nhân viên kho" : "Các task được quản lý giao cho bạn"}
          iconBg="bg-violet-100 dark:bg-violet-500/15"
          iconColor="text-violet-700 dark:text-violet-400"
          actions={
            <>
              <select
                className="rounded-md border border-border bg-background px-3 py-1.5 text-[13px]"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
              >
                {STATUS_FILTERS.map((s) => (
                  <option key={s} value={s}>
                    {s === "ALL" ? "Tất cả trạng thái" : s === "IN_PROGRESS" ? "Đang làm" : s === "DONE" ? "Hoàn thành" : s === "CANCELLED" ? "Đã hủy" : "Mới"}
                  </option>
                ))}
              </select>
              <Button type="button" variant="outline" size="sm" onClick={() => void load(statusFilter)} disabled={loading}>
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
      </motion.div>

      {/* Create form — Manager only */}
      {isManager && showForm && (
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
              <div className="lg:col-span-2">
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
                <label className="block text-[11px] font-semibold text-muted-foreground mb-1">Nhân viên được giao *</label>
                <select
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-[13px]"
                  value={form.assignee_user_id}
                  onChange={(e) => setForm((f) => ({ ...f, assignee_user_id: e.target.value }))}
                >
                  <option value="">Chọn nhân viên</option>
                  {warehouseStaff.map((s) => (
                    <option key={s.id} value={s.id}>{s.full_name}</option>
                  ))}
                </select>
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
                    className="rounded-md border border-border bg-background px-3 py-2 text-[13px] w-full sm:w-[210px] shrink-0"
                    value={form.related_entity_type ?? ""}
                    onChange={(e) => void handleEntityTypeChange(e.target.value)}
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
      )}

      <SectionCard noPadding>
        <div className="border-b border-border px-5 py-4">
          <h2 className="text-[15px] font-semibold">
            {isManager ? "Danh sách task đã giao" : "Task của tôi"}
          </h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px]">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                {[
                  "Tiêu đề",
                  "Liên kết",
                  "Loại",
                  "Độ ưu tiên",
                  ...(isManager ? ["Nhân viên"] : []),
                  "Trạng thái",
                  "Hạn",
                  "Tạo lúc",
                  "Hoàn tất",
                  "Thao tác",
                ].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <SkeletonTableRow columns={colSpan} rows={4} />
              ) : tasks.length === 0 ? (
                <tr>
                  <td colSpan={colSpan} className="px-5 py-10">
                    <EmptyState
                      icon={ClipboardList}
                      title="Chưa có task nào"
                      description={isManager ? "Tạo task để giao cho nhân viên kho." : "Quản lý chưa giao task nào cho bạn."}
                    />
                  </td>
                </tr>
              ) : tasks.map((task) => (
                <tr key={task.id} className="border-b border-border last:border-0 hover:bg-muted/30">
                  <td className="px-4 py-3 text-[13px] font-medium max-w-[180px]">
                    <span className="block truncate" title={task.title}>{task.title}</span>
                    {task.description && (
                      <span className="block truncate text-[11px] text-muted-foreground" title={task.description}>{task.description}</span>
                    )}
                  </td>

                  {/* Entity link column */}
                  <td className="px-4 py-3 max-w-[200px]">
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
                  </td>

                  <td className="px-4 py-3 text-[12px]">{TASK_TYPE_LABELS[task.task_type] || task.task_type}</td>
                  <td className="px-4 py-3">
                    <StatusBadge label={PRIORITY_OPTIONS.find((o) => o.value === task.priority)?.label || task.priority} variant={priorityVariant(task.priority)} dot />
                  </td>
                  {isManager && (
                    <td className="px-4 py-3 text-[12px] text-muted-foreground">
                      {staffById[task.assignee_user_id] || task.assignee_user_id.slice(0, 8)}
                    </td>
                  )}
                  <td className="px-4 py-3">
                    <StatusBadge label={task.status === "IN_PROGRESS" ? "Đang làm" : task.status === "DONE" ? "Hoàn thành" : task.status === "CANCELLED" ? "Đã hủy" : "Mới"} variant={statusVariant(task.status)} dot />
                  </td>
                  <td className="px-4 py-3 text-[12px] text-muted-foreground">{formatDate(task.due_date)}</td>
                  <td className="px-4 py-3 text-[12px] text-muted-foreground">{formatDate(task.created_at)}</td>
                  <td className="px-4 py-3 text-[12px] text-muted-foreground">{formatDate(task.completed_at)}</td>
                  <td className="px-4 py-3 text-[12px]">
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
                    {(isManager || task.status === "DONE" || task.status === "CANCELLED") && (
                      <span className="text-[11px] text-muted-foreground">-</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionCard>
    </div>
  );
}
