import { useMemo, useEffect, useState } from "react";
import { motion } from "motion/react";
import { AlertTriangle, ArrowLeftRight, ClipboardCheck, ClipboardList, Hand, Inbox, Link2, MapPinned, PackageCheck, RefreshCw, Search, ShoppingCart, Truck, X } from "lucide-react";
import { NavLink, useNavigate } from "react-router";
import { toast } from "sonner";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { LoadingSpinner, SkeletonCard, SkeletonTableRow } from "@/components/ui/loading-state";
import { PageHeader } from "@/components/ui/page-header";
import { SectionCard } from "@/components/ui/section-card";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/status-badge";
import { getApiErrorMessage } from "@/services/api";
import { myWarehouseTaskService, type AvailableWarehouseTask, type MyWarehouseTask } from "@/services/my-warehouse-tasks";

const TASK_TYPE_LABELS: Record<string, string> = {
  RECEIVING: "Tiếp nhận hàng",
  PUTAWAY: "Cất hàng vào kho",
  PICKING: "Lấy hàng",
  OUTBOUND: "Xuất kho",
  TRANSFER_RECEIVING: "Nhận hàng chuyển kho",
  PURCHASE_REQUEST: "Yêu cầu mua hàng",
  EXCEPTION_REPORT: "Báo cáo sự cố",
  STAFF_TASK: "Task được giao",
};

const FILTER_CHIPS: Array<{ key: string; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { key: "ALL", label: "Tất cả", icon: ClipboardList },
  { key: "RECEIVING", label: "Tiếp nhận", icon: Inbox },
  { key: "PUTAWAY", label: "Cất hàng", icon: MapPinned },
  { key: "PICKING", label: "Lấy hàng", icon: PackageCheck },
  { key: "OUTBOUND", label: "Xuất kho", icon: Truck },
  { key: "TRANSFER_RECEIVING", label: "Nhận chuyển kho", icon: ArrowLeftRight },
  { key: "PURCHASE_REQUEST", label: "Yêu cầu mua", icon: ShoppingCart },
  { key: "EXCEPTION_REPORT", label: "Báo cáo sự cố", icon: AlertTriangle },
  { key: "STAFF_TASK", label: "Task được giao", icon: ClipboardCheck },
];

const CHIP_TONE: Record<string, { bg: string; text: string; border: string }> = {
  ALL: { bg: "bg-indigo-50 dark:bg-indigo-500/10", text: "text-indigo-700 dark:text-indigo-400", border: "border-indigo-200 dark:border-indigo-500/20" },
  RECEIVING: { bg: "bg-sky-50 dark:bg-sky-500/10", text: "text-sky-700 dark:text-sky-400", border: "border-sky-200 dark:border-sky-500/20" },
  PUTAWAY: { bg: "bg-violet-50 dark:bg-violet-500/10", text: "text-violet-700 dark:text-violet-400", border: "border-violet-200 dark:border-violet-500/20" },
  PICKING: { bg: "bg-emerald-50 dark:bg-emerald-500/10", text: "text-emerald-700 dark:text-emerald-400", border: "border-emerald-200 dark:border-emerald-500/20" },
  OUTBOUND: { bg: "bg-amber-50 dark:bg-amber-500/10", text: "text-amber-700 dark:text-amber-400", border: "border-amber-200 dark:border-amber-500/20" },
  TRANSFER_RECEIVING: { bg: "bg-teal-50 dark:bg-teal-500/10", text: "text-teal-700 dark:text-teal-400", border: "border-teal-200 dark:border-teal-500/20" },
  PURCHASE_REQUEST: { bg: "bg-orange-50 dark:bg-orange-500/10", text: "text-orange-700 dark:text-orange-400", border: "border-orange-200 dark:border-orange-500/20" },
  EXCEPTION_REPORT: { bg: "bg-red-50 dark:bg-red-500/10", text: "text-red-700 dark:text-red-400", border: "border-red-200 dark:border-red-500/20" },
  STAFF_TASK: { bg: "bg-fuchsia-50 dark:bg-fuchsia-500/10", text: "text-fuchsia-700 dark:text-fuchsia-400", border: "border-fuchsia-200 dark:border-fuchsia-500/20" },
};

const OPERATIONAL_TYPES = ["RECEIVING", "PUTAWAY", "PICKING", "OUTBOUND", "TRANSFER_RECEIVING"];

function taskActionLabel(type: string) {
  const upper = String(type || "").toUpperCase();
  if (upper === "RECEIVING") return "Ghi nhận";
  if (upper === "PUTAWAY") return "Thực hiện";
  if (upper === "PICKING") return "Thực hiện";
  if (upper === "OUTBOUND") return "Xác nhận";
  if (upper === "TRANSFER_RECEIVING") return "Nhận hàng";
  if (upper === "PURCHASE_REQUEST") return "Xem yêu cầu";
  if (upper === "EXCEPTION_REPORT") return "Xem báo cáo";
  if (upper === "STAFF_TASK") return "Xem task";
  return "Thực hiện";
}

function taskStatusVariant(status: string): "success" | "warning" | "danger" | "info" | "neutral" | "cyan" {
  const upper = String(status || "").toUpperCase();
  if (upper.includes("DONE") || upper.includes("COMPLETE") || upper.includes("POSTED") || upper.includes("RECEIVED")) return "success";
  if (upper.includes("PROGRESS") || upper.includes("PICKING")) return "info";
  if (upper.includes("PENDING") || upper.includes("READY") || upper.includes("APPROVED")) return "warning";
  if (upper.includes("CANCEL") || upper.includes("REJECT")) return "danger";
  return "neutral";
}

function formatDate(value: string | null | undefined) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("vi-VN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getTaskActionPath(task: MyWarehouseTask) {
  if (task.action_path) return task.action_path;
  if (task.type === "RECEIVING") return `/orders/${task.id}`;
  if (task.type === "PUTAWAY") return `/putaway/${task.id}`;
  if (task.type === "PICKING") return "/picking";
  if (task.type === "OUTBOUND") return "/outbound";
  if (task.type === "TRANSFER_RECEIVING") return "/transfer-receiving";
  if (task.type === "STAFF_TASK") return "/staff-tasks";
  return null;
}

function getRelatedEntityDisplay(task: MyWarehouseTask) {
  return (
    (task as MyWarehouseTask & { related_entity_display?: { ref_number: string; details?: string } | null })
      .related_entity_display ?? null
  );
}

export function MyWarehouseTasksPage() {
  const navigate = useNavigate();
  const [tasks, setTasks] = useState<MyWarehouseTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("ALL");
  const [searchQuery, setSearchQuery] = useState("");
  const [availableTasks, setAvailableTasks] = useState<AvailableWarehouseTask[]>([]);
  const [loadingAvailable, setLoadingAvailable] = useState(true);
  const [claimingId, setClaimingId] = useState<string | null>(null);

  const countsByType = useMemo(() => {
    const map: Record<string, number> = { ALL: tasks.length };
    for (const task of tasks) map[task.type] = (map[task.type] ?? 0) + 1;
    return map;
  }, [tasks]);

  const filteredTasks = useMemo(() => {
    const base = activeTab === "ALL" ? tasks : tasks.filter((t) => t.type === activeTab);
    const query = searchQuery.trim().toLowerCase();
    if (!query) return base;
    return base.filter(
      (t) => t.title.toLowerCase().includes(query) || (t.warehouse ?? "").toLowerCase().includes(query),
    );
  }, [tasks, activeTab, searchQuery]);

  const isFiltering = activeTab !== "ALL" || searchQuery.trim() !== "";

  const loadTasks = async () => {
    try {
      setLoading(true);
      setLoadingAvailable(true);
      const [response, availableResponse] = await Promise.all([
        myWarehouseTaskService.getMyTasks(),
        myWarehouseTaskService.getAvailableTasks(),
      ]);
      setTasks(Array.isArray(response.data) ? response.data : []);
      setAvailableTasks(Array.isArray(availableResponse.data) ? availableResponse.data : []);
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Không tải được công việc kho"));
    } finally {
      setLoading(false);
      setLoadingAvailable(false);
    }
  };

  useEffect(() => { void loadTasks(); }, []);

  const handleReportException = (task: MyWarehouseTask) => {
    const params = new URLSearchParams({ task_id: task.id, task_type: task.type, task_warehouse: task.warehouse ?? "" });
    if (task.warehouse_id) params.set("warehouse_id", task.warehouse_id);
    void navigate(`/my-exception-reports?${params.toString()}`);
  };

  const handleClaimTask = async (task: AvailableWarehouseTask) => {
    setClaimingId(task.id);
    try {
      await myWarehouseTaskService.claimTask(task.claim_endpoint);
      toast.success(`Đã nhận task ${task.title} thành công`);
      void loadTasks();
    } catch (error: unknown) {
      const apiError = error as { response?: { status?: number } };
      if (apiError?.response?.status === 409) {
        toast.error("Task này vừa được nhân viên khác nhận. Vui lòng làm mới danh sách.");
      } else {
        toast.error(getApiErrorMessage(error, "Không thể nhận task"));
      }
    } finally {
      setClaimingId(null);
    }
  };

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.24 }}
      >
        <PageHeader
          icon={ClipboardList}
          title="Công việc kho của tôi"
          description="Theo dõi các task nhận hàng, cất hàng, lấy hàng và xuất kho được giao"
          iconBg="bg-emerald-100 dark:bg-emerald-500/15"
          iconColor="text-emerald-700 dark:text-emerald-400"
          actions={
            <Button type="button" variant="outline" size="sm" onClick={() => void loadTasks()} disabled={loading || loadingAvailable}>
              <RefreshCw className={`h-3.5 w-3.5 ${(loading || loadingAvailable) ? "animate-spin" : ""}`} />
              Làm mới
            </Button>
          }
        />
      </motion.div>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 rounded-lg border border-sky-200 bg-sky-50 px-4 py-2.5 text-[12px] text-sky-800 dark:border-sky-500/20 dark:bg-sky-500/10 dark:text-sky-300">
        <span><span className="font-semibold">Task của tôi</span> — đã nhận hoặc được quản lý giao.</span>
        <span><span className="font-semibold">Có thể nhận</span> — công việc chưa phân công, bạn tự nhận để xử lý.</span>
      </div>

      {/* Filter chips — doubles as summary counts, single source of truth for the table below */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1">
        {FILTER_CHIPS.map((chip) => {
          const isActive = activeTab === chip.key;
          const tone = CHIP_TONE[chip.key];
          const count = countsByType[chip.key] ?? 0;
          return (
            <button
              key={chip.key}
              type="button"
              onClick={() => setActiveTab(chip.key)}
              className={`shrink-0 flex items-center gap-2 rounded-xl border px-3 py-2 text-[12px] font-medium cursor-pointer transition-colors ${
                isActive
                  ? `${tone.bg} ${tone.text} ${tone.border} shadow-sm`
                  : "border-border bg-card text-muted-foreground hover:bg-muted/50 hover:text-foreground"
              }`}
            >
              <span className={`flex h-6 w-6 items-center justify-center rounded-lg ${isActive ? "bg-white/70 dark:bg-black/20" : "bg-muted"}`}>
                <chip.icon className="h-3.5 w-3.5" />
              </span>
              {chip.label}
              <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${isActive ? "bg-white/70 dark:bg-black/20" : "bg-muted"}`}>
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Task của tôi */}
      <SectionCard
        noPadding
        icon={ClipboardList}
        title="Task của tôi"
        subtitle={`${filteredTasks.length}/${tasks.length} task${activeTab !== "ALL" ? ` · ${TASK_TYPE_LABELS[activeTab] ?? activeTab}` : ""}`}
        actions={
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Tìm mã task, kho..."
              className="h-8 w-40 sm:w-56 pl-8 pr-7 text-[12px]"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                aria-label="Xóa tìm kiếm"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        }
      >
        {/* Mobile cards (< md) */}
        {loading ? (
          <div className="grid gap-3 p-4 sm:grid-cols-2 md:hidden">
            {Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} lines={2} />)}
          </div>
        ) : filteredTasks.length === 0 ? (
          <div className="px-5 py-10 md:hidden">
            <EmptyState
              icon={isFiltering ? Search : ClipboardList}
              title={isFiltering ? "Không tìm thấy task phù hợp" : "Chưa có task được giao"}
              description={
                isFiltering
                  ? "Thử đổi bộ lọc hoặc từ khóa tìm kiếm khác."
                  : "Nhân viên kho chỉ thao tác trên task đã được quản lý giao."
              }
            />
          </div>
        ) : (
          <div className="grid gap-3 p-4 sm:grid-cols-2 md:hidden">
            {filteredTasks.map((task) => {
              const actionPath = getTaskActionPath(task);
              const canReport = OPERATIONAL_TYPES.includes(task.type);
              const relatedEntity = getRelatedEntityDisplay(task);
              return (
                <div key={`card:${task.type}:${task.id}`} className="rounded-lg border border-border bg-card p-4 flex flex-col gap-3 hover:bg-muted/20 transition-colors">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-[11px] text-muted-foreground uppercase tracking-wide">{TASK_TYPE_LABELS[task.type] ?? task.type}</p>
                      <p className="text-[13px] font-mono font-medium mt-0.5 truncate">{task.title}</p>
                    </div>
                    <StatusBadge label={task.status} variant={taskStatusVariant(task.status)} dot />
                  </div>
                  <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
                    <span className="truncate">{task.warehouse || "-"}</span>
                    <span>·</span>
                    <span className="shrink-0">{formatDate(task.created_at)}</span>
                  </div>
                  {relatedEntity && (
                    <div className="rounded border border-indigo-100 bg-indigo-50/70 px-2 py-1 dark:border-indigo-500/20 dark:bg-indigo-500/10">
                      <p className="flex items-center gap-1 text-[10px] font-medium text-indigo-700 dark:text-indigo-400">
                        <Link2 className="h-2.5 w-2.5 shrink-0" />
                        {relatedEntity.ref_number}
                      </p>
                      {relatedEntity.details && (
                        <p className="text-[10px] text-muted-foreground leading-tight mt-0.5">{relatedEntity.details}</p>
                      )}
                    </div>
                  )}
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {actionPath ? (
                      <NavLink
                        to={actionPath}
                        className="inline-flex items-center rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-[11px] font-semibold text-emerald-700 hover:bg-emerald-100 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-400 dark:hover:bg-emerald-500/15"
                      >
                        {taskActionLabel(task.type)}
                      </NavLink>
                    ) : (
                      <span className="text-[11px] text-muted-foreground">Không có thao tác</span>
                    )}
                    {canReport && (
                      <button
                        type="button"
                        onClick={() => handleReportException(task)}
                        className="inline-flex items-center gap-1 rounded-lg border border-red-200 bg-red-50 px-2 py-1.5 text-[11px] font-medium text-red-700 hover:bg-red-100 transition-colors dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-400 dark:hover:bg-red-500/15"
                        title="Báo cáo sự cố cho task này"
                      >
                        <AlertTriangle className="h-3 w-3" />
                        Báo cáo
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Desktop table (>= md) */}
        <div className="hidden md:block overflow-auto max-h-[560px]">
          <table className="w-full min-w-[800px]">
            <thead>
              <tr className="sticky top-0 z-10 border-b border-border bg-muted">
                {["Loại", "Mã task", "Kho", "Trạng thái", "Tạo lúc", "Hoàn tất", "Thao tác"].map((header) => (
                  <th key={header} className="px-5 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <SkeletonTableRow columns={7} rows={4} />
              ) : filteredTasks.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-5 py-10">
                    <EmptyState
                      icon={isFiltering ? Search : ClipboardList}
                      title={isFiltering ? "Không tìm thấy task phù hợp" : "Chưa có task được giao"}
                      description={
                        isFiltering
                          ? "Thử đổi bộ lọc hoặc từ khóa tìm kiếm khác."
                          : "Nhân viên kho chỉ thao tác trên task đã được quản lý giao. Các nghiệp vụ tạo đơn, điều chuyển và điều chỉnh tồn kho không hiển thị tại đây."
                      }
                    />
                  </td>
                </tr>
              ) : filteredTasks.map((task) => {
                const actionPath = getTaskActionPath(task);
                const canReport = OPERATIONAL_TYPES.includes(task.type);
                const relatedEntity = getRelatedEntityDisplay(task);
                return (
                  <tr key={`${task.type}:${task.id}`} className="border-b border-border last:border-0 hover:bg-muted/30">
                    <td className="px-5 py-3 text-[13px] font-medium">{TASK_TYPE_LABELS[task.type] ?? task.type}</td>
                    <td className="px-5 py-3 text-[12px] font-mono text-muted-foreground">{task.title}</td>
                    <td className="px-5 py-3 text-[13px] text-muted-foreground">{task.warehouse || "-"}</td>
                    <td className="px-5 py-3"><StatusBadge label={task.status} variant={taskStatusVariant(task.status)} dot /></td>
                    <td className="px-5 py-3 text-[12px] text-muted-foreground">{formatDate(task.created_at)}</td>
                    <td className="px-5 py-3 text-[12px] text-muted-foreground">{formatDate(task.completed_at)}</td>
                    <td className="px-5 py-3 text-[12px]">
                      <div className="flex flex-col gap-1.5">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {actionPath ? (
                            <NavLink
                              to={actionPath}
                              className="inline-flex items-center rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-[11px] font-semibold text-emerald-700 hover:bg-emerald-100 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-400 dark:hover:bg-emerald-500/15"
                            >
                              {taskActionLabel(task.type)}
                            </NavLink>
                          ) : (
                            <span className="text-muted-foreground">-</span>
                          )}
                          {canReport && (
                            <button
                              type="button"
                              onClick={() => handleReportException(task)}
                              className="inline-flex items-center gap-1 rounded-lg border border-red-200 bg-red-50 px-2 py-1.5 text-[11px] font-medium text-red-700 hover:bg-red-100 transition-colors dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-400 dark:hover:bg-red-500/15"
                              title="Báo cáo sự cố cho task này"
                            >
                              <AlertTriangle className="h-3 w-3" />
                              Báo cáo
                            </button>
                          )}
                        </div>
                        {relatedEntity && (
                          <div className="rounded border border-indigo-100 bg-indigo-50/70 px-2 py-1 dark:border-indigo-500/20 dark:bg-indigo-500/10">
                            <p className="flex items-center gap-1 text-[10px] font-medium text-indigo-700 dark:text-indigo-400">
                              <Link2 className="h-2.5 w-2.5 shrink-0" />
                              {relatedEntity.ref_number}
                            </p>
                            {relatedEntity.details && (
                              <p className="text-[10px] text-muted-foreground leading-tight mt-0.5">{relatedEntity.details}</p>
                            )}
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </SectionCard>

      {/* Có thể nhận */}
      <SectionCard noPadding>
        <div className="px-5 py-3.5 border-b border-border flex items-center gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-emerald-100 bg-emerald-50">
            <Hand className="h-4 w-4 text-emerald-700" />
          </div>
          <div>
            <p className="text-sm font-semibold">Công việc có thể tự nhận</p>
            <p className="text-[11px] text-muted-foreground">Lấy hàng, xuất kho, nhận chuyển kho chưa phân công — nhận task và bắt đầu ngay</p>
          </div>
        </div>

        {/* Mobile card layout */}
        {loadingAvailable ? (
          <div className="px-5 py-8 flex justify-center">
            <LoadingSpinner message="Đang tải..." />
          </div>
        ) : availableTasks.length === 0 ? (
          <div className="px-5 py-8">
            <EmptyState
              icon={Hand}
              title="Không có task nào đang chờ"
              description="Hiện tại tất cả task đã được phân công hoặc chưa có task mới. Cất hàng (putaway) luôn cần manager phân công trực tiếp."
            />
          </div>
        ) : (
          <>
            {/* Mobile cards (< md) */}
            <div className="grid gap-3 p-4 sm:grid-cols-2 md:hidden">
              {availableTasks.map((task) => (
                <div key={`avail-card:${task.type}:${task.id}`} className="rounded-lg border border-border bg-card p-4 flex flex-col gap-3 hover:bg-muted/20 transition-colors">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <p className="text-[11px] text-muted-foreground uppercase tracking-wide">{TASK_TYPE_LABELS[task.type] ?? task.type}</p>
                        {task.is_repick && (
                          <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-semibold text-amber-700 dark:bg-amber-500/15 dark:text-amber-400">Bổ sung</span>
                        )}
                      </div>
                      {task.type === "PICKING" && !task.is_repick && <p className="text-[10px] text-muted-foreground">Bước 1: Lấy hàng</p>}
                      {task.type === "PICKING" && task.is_repick && (
                        <p className="text-[10px] text-muted-foreground">Bổ sung cho <span className="font-mono">{task.parent_order_number}</span></p>
                      )}
                      {task.type === "OUTBOUND" && <p className="text-[10px] text-muted-foreground">Bước 2: Xuất kho</p>}
                      {task.type === "TRANSFER_RECEIVING" && <p className="text-[10px] text-muted-foreground">Nhận chuyển kho</p>}
                      <p className="text-[13px] font-mono font-medium mt-0.5 truncate">{task.title}</p>
                    </div>
                    <StatusBadge label={task.status} variant={taskStatusVariant(task.status)} dot />
                  </div>
                  <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
                    <span className="truncate">
                      {task.task_type === "transfer" && task.from_warehouse_name && task.to_warehouse_name
                        ? `${task.from_warehouse_name} → ${task.to_warehouse_name}`
                        : task.warehouse || "-"}
                    </span>
                    <span>·</span>
                    <span className="shrink-0">{formatDate(task.created_at)}</span>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => void handleClaimTask(task)}
                    disabled={claimingId === task.id}
                    className="w-full text-emerald-700 border-emerald-200 bg-emerald-50 hover:bg-emerald-100 text-[12px] dark:text-emerald-400 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:hover:bg-emerald-500/15"
                  >
                    {claimingId === task.id ? "Đang nhận..." : "Nhận task"}
                  </Button>
                </div>
              ))}
            </div>
            {/* Desktop table (>= md) */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full min-w-[700px]">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    {["Loại", "Mã task", "Kho", "Trạng thái", "Tạo lúc", "Thao tác"].map((header) => (
                      <th key={header} className="px-5 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                        {header}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {availableTasks.map((task) => (
                    <tr key={`avail:${task.type}:${task.id}`} className="border-b border-border last:border-0 hover:bg-muted/30">
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <p className="text-[13px] font-medium">{TASK_TYPE_LABELS[task.type] ?? task.type}</p>
                          {task.is_repick && (
                            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:bg-amber-500/15 dark:text-amber-400">
                              Bổ sung
                            </span>
                          )}
                        </div>
                        {task.type === "PICKING" && !task.is_repick && (
                          <p className="text-[11px] text-muted-foreground mt-0.5">Bước 1: Lấy hàng</p>
                        )}
                        {task.type === "PICKING" && task.is_repick && (
                          <p className="text-[11px] text-muted-foreground mt-0.5">
                            Bổ sung cho <span className="font-mono">{task.parent_order_number}</span>
                          </p>
                        )}
                        {task.type === "OUTBOUND" && (
                          <p className="text-[11px] text-muted-foreground mt-0.5">Bước 2: Xuất kho</p>
                        )}
                        {task.type === "TRANSFER_RECEIVING" && (
                          <p className="text-[11px] text-muted-foreground mt-0.5">Nhận chuyển kho</p>
                        )}
                      </td>
                      <td className="px-5 py-3 text-[12px] font-mono text-muted-foreground">{task.title}</td>
                      <td className="px-5 py-3 text-[13px] text-muted-foreground">
                        {task.task_type === "transfer" && task.from_warehouse_name && task.to_warehouse_name
                          ? `${task.from_warehouse_name} → ${task.to_warehouse_name}`
                          : task.warehouse || "-"}
                      </td>
                      <td className="px-5 py-3"><StatusBadge label={task.status} variant={taskStatusVariant(task.status)} dot /></td>
                      <td className="px-5 py-3 text-[12px] text-muted-foreground">{formatDate(task.created_at)}</td>
                      <td className="px-5 py-3">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => void handleClaimTask(task)}
                          disabled={claimingId === task.id}
                          className="text-emerald-700 border-emerald-200 bg-emerald-50 hover:bg-emerald-100 text-[11px] dark:text-emerald-400 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:hover:bg-emerald-500/15"
                        >
                          {claimingId === task.id ? "Đang nhận..." : "Nhận task"}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </SectionCard>
    </div>
  );
}
