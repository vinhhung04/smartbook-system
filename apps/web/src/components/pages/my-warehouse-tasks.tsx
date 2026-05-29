import { useEffect, useMemo, useState } from "react";
import { motion } from "motion/react";
import { AlertTriangle, ClipboardCheck, ClipboardList, Hand, Inbox, MapPinned, PackageCheck, RefreshCw, ShoppingCart, Truck } from "lucide-react";
import { NavLink, useNavigate } from "react-router";
import { toast } from "sonner";
import { EmptyState } from "@/components/ui/empty-state";
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

const TABS = [
  { key: "ALL", label: "Tất cả" },
  { key: "RECEIVING", label: "Tiếp nhận" },
  { key: "PUTAWAY", label: "Cất hàng" },
  { key: "PICKING", label: "Lấy hàng" },
  { key: "OUTBOUND", label: "Xuất kho" },
  { key: "TRANSFER_RECEIVING", label: "Nhận chuyển kho" },
  { key: "PURCHASE_REQUEST", label: "Yêu cầu mua" },
  { key: "EXCEPTION_REPORT", label: "Báo cáo sự cố" },
  { key: "STAFF_TASK", label: "Task được giao" },
];

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

export function MyWarehouseTasksPage() {
  const navigate = useNavigate();
  const [tasks, setTasks] = useState<MyWarehouseTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("ALL");
  const [availableTasks, setAvailableTasks] = useState<AvailableWarehouseTask[]>([]);
  const [loadingAvailable, setLoadingAvailable] = useState(true);
  const [claimingId, setClaimingId] = useState<string | null>(null);

  const counts = useMemo(() => ({
    receiving: tasks.filter((t) => t.type === "RECEIVING").length,
    putaway: tasks.filter((t) => t.type === "PUTAWAY").length,
    picking: tasks.filter((t) => t.type === "PICKING").length,
    outbound: tasks.filter((t) => t.type === "OUTBOUND").length,
    transferReceiving: tasks.filter((t) => t.type === "TRANSFER_RECEIVING").length,
    purchaseRequest: tasks.filter((t) => t.type === "PURCHASE_REQUEST").length,
    exceptionReport: tasks.filter((t) => t.type === "EXCEPTION_REPORT").length,
    staffTask: tasks.filter((t) => t.type === "STAFF_TASK").length,
  }), [tasks]);

  const filteredTasks = useMemo(() =>
    activeTab === "ALL" ? tasks : tasks.filter((t) => t.type === activeTab),
    [tasks, activeTab]
  );

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

  const summaryCards = [
    { label: "Tiếp nhận", value: counts.receiving, icon: Inbox, tone: "text-sky-700 bg-sky-50 border-sky-100", tab: "RECEIVING" },
    { label: "Cất hàng", value: counts.putaway, icon: MapPinned, tone: "text-violet-700 bg-violet-50 border-violet-100", tab: "PUTAWAY" },
    { label: "Lấy hàng", value: counts.picking, icon: PackageCheck, tone: "text-emerald-700 bg-emerald-50 border-emerald-100", tab: "PICKING" },
    { label: "Xuất kho", value: counts.outbound, icon: Truck, tone: "text-amber-700 bg-amber-50 border-amber-100", tab: "OUTBOUND" },
    { label: "Nhận hàng chuyển kho", value: counts.transferReceiving, icon: PackageCheck, tone: "text-teal-700 bg-teal-50 border-teal-100", tab: "TRANSFER_RECEIVING" },
    { label: "Yêu cầu mua hàng", value: counts.purchaseRequest, icon: ShoppingCart, tone: "text-orange-700 bg-orange-50 border-orange-100", tab: "PURCHASE_REQUEST" },
    { label: "Báo cáo sự cố", value: counts.exceptionReport, icon: AlertTriangle, tone: "text-red-700 bg-red-50 border-red-100", tab: "EXCEPTION_REPORT" },
    { label: "Task được giao", value: counts.staffTask, icon: ClipboardCheck, tone: "text-violet-700 bg-violet-50 border-violet-100", tab: "STAFF_TASK" },
  ];

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.24 }}
        className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"
      >
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-emerald-100 bg-emerald-50">
            <ClipboardList className="h-5 w-5 text-emerald-700" />
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Công việc kho của tôi</h1>
            <p className="mt-0.5 text-[12px] text-muted-foreground">Theo dõi các task nhận hàng, cất hàng, lấy hàng và xuất kho được giao</p>
          </div>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={() => void loadTasks()} disabled={loading || loadingAvailable}>
          <RefreshCw className={`h-3.5 w-3.5 ${(loading || loadingAvailable) ? "animate-spin" : ""}`} />
          Làm mới
        </Button>
      </motion.div>

      <div className="rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 text-[12px] text-sky-800">
        <span className="font-medium">Task của tôi:</span> các công việc bạn đã nhận hoặc được quản lý giao.{" "}
        <span className="font-medium">Có thể nhận:</span> các công việc thường chưa phân công, bạn có thể tự nhận để xử lý.
        Tạo đơn hàng, điều chỉnh tồn kho và các quyền quản trị thuộc về quản lý.
      </div>

      {/* Summary cards — clickable to filter */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
        {summaryCards.map((card) => (
          <SectionCard key={card.label}>
            <button
              type="button"
              className="w-full text-left"
              onClick={() => setActiveTab(activeTab === card.tab ? "ALL" : card.tab)}
            >
              <div className="flex items-center gap-3">
                <div className={`flex h-10 w-10 items-center justify-center rounded-lg border ${card.tone} ${activeTab === card.tab ? "ring-2 ring-offset-1 ring-indigo-400" : ""}`}>
                  <card.icon className="h-4 w-4" />
                </div>
                <div>
                  <p className="text-[12px] text-muted-foreground">{card.label}</p>
                  <p className="mt-1 text-2xl font-semibold">{card.value}</p>
                </div>
              </div>
            </button>
          </SectionCard>
        ))}
      </div>

      {/* Task của tôi */}
      <SectionCard noPadding>
        {/* Tab bar */}
        <div className="border-b border-border">
          <div className="flex items-center gap-1 overflow-x-auto px-4 pt-3 pb-0">
            {TABS.map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveTab(tab.key)}
                className={`shrink-0 px-3 py-2 text-[12px] font-medium rounded-t-lg border-b-2 transition-colors ${
                  activeTab === tab.key
                    ? "border-indigo-500 text-indigo-700 bg-indigo-50/60"
                    : "border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/40"
                }`}
              >
                {tab.label}
                {tab.key !== "ALL" && (
                  <span className={`ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] ${activeTab === tab.key ? "bg-indigo-100 text-indigo-700" : "bg-muted text-muted-foreground"}`}>
                    {tasks.filter((t) => t.type === tab.key).length}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[800px]">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                {["Loại", "Mã task", "Kho", "Trạng thái", "Tạo lúc", "Hoàn tất", "Thao tác"].map((header) => (
                  <th key={header} className="px-5 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-5 py-10 text-center text-sm text-muted-foreground">Đang tải công việc...</td>
                </tr>
              ) : filteredTasks.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-5 py-10">
                    <EmptyState
                      icon={ClipboardList}
                      title="Chưa có task được giao"
                      description="Nhân viên kho chỉ thao tác trên task đã được quản lý giao. Các nghiệp vụ tạo đơn, điều chuyển và điều chỉnh tồn kho không hiển thị tại đây."
                    />
                  </td>
                </tr>
              ) : filteredTasks.map((task) => {
                const actionPath = getTaskActionPath(task);
                const canReport = OPERATIONAL_TYPES.includes(task.type);
                return (
                  <tr key={`${task.type}:${task.id}`} className="border-b border-border last:border-0 hover:bg-muted/30">
                    <td className="px-5 py-3 text-[13px] font-medium">{TASK_TYPE_LABELS[task.type] ?? task.type}</td>
                    <td className="px-5 py-3 text-[12px] font-mono text-muted-foreground">{task.title}</td>
                    <td className="px-5 py-3 text-[13px] text-muted-foreground">{task.warehouse || "-"}</td>
                    <td className="px-5 py-3"><StatusBadge label={task.status} variant={taskStatusVariant(task.status)} dot /></td>
                    <td className="px-5 py-3 text-[12px] text-muted-foreground">{formatDate(task.created_at)}</td>
                    <td className="px-5 py-3 text-[12px] text-muted-foreground">{formatDate(task.completed_at)}</td>
                    <td className="px-5 py-3 text-[12px]">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {actionPath ? (
                          <NavLink
                            to={actionPath}
                            className="inline-flex items-center rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-[11px] font-semibold text-emerald-700 hover:bg-emerald-100"
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
                            className="inline-flex items-center gap-1 rounded-lg border border-red-200 bg-red-50 px-2 py-1.5 text-[11px] font-medium text-red-700 hover:bg-red-100 transition-colors"
                            title="Báo cáo sự cố cho task này"
                          >
                            <AlertTriangle className="h-3 w-3" />
                            Báo cáo
                          </button>
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

        <div className="overflow-x-auto">
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
              {loadingAvailable ? (
                <tr>
                  <td colSpan={6} className="px-5 py-10 text-center text-sm text-muted-foreground">Đang tải...</td>
                </tr>
              ) : availableTasks.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-5 py-10">
                    <EmptyState
                      icon={Hand}
                      title="Không có task nào đang chờ"
                      description="Hiện tại tất cả task đã được phân công hoặc chưa có task mới. Cất hàng (putaway) luôn cần manager phân công trực tiếp."
                    />
                  </td>
                </tr>
              ) : availableTasks.map((task) => (
                <tr key={`avail:${task.type}:${task.id}`} className="border-b border-border last:border-0 hover:bg-muted/30">
                  <td className="px-5 py-3 text-[13px] font-medium">{TASK_TYPE_LABELS[task.type] ?? task.type}</td>
                  <td className="px-5 py-3 text-[12px] font-mono text-muted-foreground">{task.title}</td>
                  <td className="px-5 py-3 text-[13px] text-muted-foreground">{task.warehouse || "-"}</td>
                  <td className="px-5 py-3"><StatusBadge label={task.status} variant={taskStatusVariant(task.status)} dot /></td>
                  <td className="px-5 py-3 text-[12px] text-muted-foreground">{formatDate(task.created_at)}</td>
                  <td className="px-5 py-3">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => void handleClaimTask(task)}
                      disabled={claimingId === task.id}
                      className="text-emerald-700 border-emerald-200 bg-emerald-50 hover:bg-emerald-100 text-[11px]"
                    >
                      {claimingId === task.id ? "Đang nhận..." : "Nhận task"}
                    </Button>
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
