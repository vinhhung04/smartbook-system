import { useMemo, useEffect, useState } from "react";
import { AlertTriangle, ArrowLeftRight, ClipboardCheck, ClipboardList, Hand, Inbox, Link2, MapPinned, PackageCheck, RefreshCw, Search, ShoppingCart, Truck } from "lucide-react";
import { NavLink, useNavigate } from "react-router";
import { toast } from "sonner";
import { PageWrapper, FadeItem } from "../motion-utils";
import { EmptyState } from "@/components/ui/empty-state";
import { LoadingSpinner, Skeleton } from "@/components/ui/loading-state";
import { PageHeader } from "@/components/ui/page-header";
import { SectionCard } from "@/components/ui/section-card";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/status-badge";
import { FilterBar } from "@/components/ui/filter-bar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Pagination, PaginationContent, PaginationEllipsis, PaginationItem, PaginationLink,
  PaginationNext, PaginationPrevious,
} from "@/components/ui/pagination";
import { cn } from "@/components/ui/utils";
import { getPaginationRange } from "@/lib/pagination";
import { getApiErrorMessage } from "@/services/api";
import { myWarehouseTaskService, type AvailableWarehouseTask, type MyWarehouseTask } from "@/services/my-warehouse-tasks";
import { getWarehouseTaskStatusVariant } from "@/lib/status-registry";

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

// Same color families the sidebar (nav-groups.ts) already uses for these features —
// goods receipts/purchase requests = indigo, putaway = violet, picking = emerald,
// outbound = sky, exception reports = red — so a task's accent always matches the
// color the rest of the app already trained the user to read as that feature.
const TASK_TYPE_ACCENT: Record<string, { icon: React.ComponentType<{ className?: string }>; border: string; iconBg: string; iconColor: string }> = {
  RECEIVING: { icon: Inbox, border: "border-l-indigo-400 dark:border-l-indigo-500/60", iconBg: "bg-indigo-50 dark:bg-indigo-500/15", iconColor: "text-indigo-600 dark:text-indigo-400" },
  PUTAWAY: { icon: MapPinned, border: "border-l-violet-400 dark:border-l-violet-500/60", iconBg: "bg-violet-50 dark:bg-violet-500/15", iconColor: "text-violet-600 dark:text-violet-400" },
  PICKING: { icon: PackageCheck, border: "border-l-emerald-400 dark:border-l-emerald-500/60", iconBg: "bg-emerald-50 dark:bg-emerald-500/15", iconColor: "text-emerald-600 dark:text-emerald-400" },
  OUTBOUND: { icon: Truck, border: "border-l-sky-400 dark:border-l-sky-500/60", iconBg: "bg-sky-50 dark:bg-sky-500/15", iconColor: "text-sky-600 dark:text-sky-400" },
  TRANSFER_RECEIVING: { icon: ArrowLeftRight, border: "border-l-teal-400 dark:border-l-teal-500/60", iconBg: "bg-teal-50 dark:bg-teal-500/15", iconColor: "text-teal-600 dark:text-teal-400" },
  PURCHASE_REQUEST: { icon: ShoppingCart, border: "border-l-amber-400 dark:border-l-amber-500/60", iconBg: "bg-amber-50 dark:bg-amber-500/15", iconColor: "text-amber-600 dark:text-amber-400" },
  EXCEPTION_REPORT: { icon: AlertTriangle, border: "border-l-red-400 dark:border-l-red-500/60", iconBg: "bg-red-50 dark:bg-red-500/15", iconColor: "text-red-600 dark:text-red-400" },
  STAFF_TASK: { icon: ClipboardCheck, border: "border-l-fuchsia-400 dark:border-l-fuchsia-500/60", iconBg: "bg-fuchsia-50 dark:bg-fuchsia-500/15", iconColor: "text-fuchsia-600 dark:text-fuchsia-400" },
};
const DEFAULT_ACCENT = { icon: ClipboardList, border: "border-l-border", iconBg: "bg-muted", iconColor: "text-muted-foreground" };

const OPERATIONAL_TYPES = ["RECEIVING", "PUTAWAY", "PICKING", "OUTBOUND", "TRANSFER_RECEIVING"];

const PAGE_SIZE = 10;

type MainView = "my" | "available";

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

function taskStatusVariant(status: string) {
  return getWarehouseTaskStatusVariant(status);
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
  const [mainView, setMainView] = useState<MainView>("my");
  const [activeTab, setActiveTab] = useState("ALL");
  const [searchQuery, setSearchQuery] = useState("");
  const [availableTasks, setAvailableTasks] = useState<AvailableWarehouseTask[]>([]);
  const [loadingAvailable, setLoadingAvailable] = useState(true);
  const [claimingId, setClaimingId] = useState<string | null>(null);
  const [myPage, setMyPage] = useState(1);
  const [availablePage, setAvailablePage] = useState(1);

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

  const myTotalPages = Math.max(1, Math.ceil(filteredTasks.length / PAGE_SIZE));

  const pagedTasks = useMemo(
    () => filteredTasks.slice((myPage - 1) * PAGE_SIZE, myPage * PAGE_SIZE),
    [filteredTasks, myPage],
  );

  const availableTotalPages = Math.max(1, Math.ceil(availableTasks.length / PAGE_SIZE));

  const pagedAvailableTasks = useMemo(
    () => availableTasks.slice((availablePage - 1) * PAGE_SIZE, availablePage * PAGE_SIZE),
    [availableTasks, availablePage],
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

  useEffect(() => {
    setMyPage(1);
  }, [activeTab, searchQuery]);

  useEffect(() => {
    setMyPage((current) => Math.min(current, myTotalPages));
  }, [myTotalPages]);

  useEffect(() => {
    setAvailablePage((current) => Math.min(current, availableTotalPages));
  }, [availableTotalPages]);

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
    <PageWrapper className="space-y-6">
      <FadeItem>
        <div className="rounded-xl border border-border bg-gradient-to-br from-primary/[0.06] to-transparent dark:from-primary/[0.09] p-5 shadow-[0_1px_4px_rgba(0,0,0,0.03)] dark:shadow-none">
          <p className="mb-2 font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-primary/70">
            Vận hành kho · Công việc
          </p>
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
        </div>
      </FadeItem>

      <FadeItem>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 rounded-lg border border-sky-200 bg-sky-50 px-4 py-2.5 text-[12px] text-sky-800 dark:border-sky-500/20 dark:bg-sky-500/10 dark:text-sky-300">
          <span><span className="font-semibold">Task của tôi</span> — đã nhận hoặc được quản lý giao.</span>
          <span><span className="font-semibold">Có thể nhận</span> — công việc chưa phân công, bạn tự nhận để xử lý.</span>
        </div>
      </FadeItem>

      <FadeItem>
        <Tabs value={mainView} onValueChange={(value) => setMainView(value as MainView)}>
          <TabsList className="w-full sm:w-fit">
            <TabsTrigger value="my">Task của tôi</TabsTrigger>
            <TabsTrigger value="available">Có thể nhận</TabsTrigger>
          </TabsList>

          <TabsContent value="my" className="mt-4 space-y-4">
            {/* Filter chips — doubles as summary counts, single source of truth for the queue below */}
            <div className="flex items-center gap-2 overflow-x-auto pb-1">
              {FILTER_CHIPS.map((chip) => {
                const isActive = activeTab === chip.key;
                const count = countsByType[chip.key] ?? 0;
                return (
                  <button
                    key={chip.key}
                    type="button"
                    onClick={() => setActiveTab(chip.key)}
                    className={cn(
                      "shrink-0 flex items-center gap-2 rounded-xl border px-3 py-2 text-[12px] font-medium cursor-pointer transition-colors",
                      isActive
                        ? "border-indigo-100 bg-card text-indigo-700 shadow-sm dark:border-indigo-500/20 dark:text-indigo-400"
                        : "border-border bg-card text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                    )}
                  >
                    <span className={cn("flex h-6 w-6 items-center justify-center rounded-lg", isActive ? "bg-indigo-50 dark:bg-indigo-500/15" : "bg-muted")}>
                      <chip.icon className="h-3.5 w-3.5" />
                    </span>
                    {chip.label}
                    <span className={cn(
                      "rounded-full px-1.5 py-0.5 font-mono text-[10px] font-semibold",
                      isActive ? "bg-indigo-50 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-400" : "bg-muted",
                    )}>
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Work queue — one task per row, numbered by queue position so "what's next" reads
                at a glance instead of being buried in a spreadsheet's columns. */}
            <SectionCard
              noPadding
              icon={ClipboardList}
              title="Task của tôi"
              subtitle={`${filteredTasks.length}/${tasks.length} task${activeTab !== "ALL" ? ` · ${TASK_TYPE_LABELS[activeTab] ?? activeTab}` : ""}`}
              actions={(
                <FilterBar
                  searchValue={searchQuery}
                  onSearchChange={setSearchQuery}
                  searchPlaceholder="Tìm mã task, kho..."
                  className="sm:w-auto"
                />
              )}
            >
              {loading ? (
                <div>
                  {Array.from({ length: 5 }).map((_, i) => (
                    <div key={i} className="flex items-center gap-4 border-b border-border p-4 last:border-b-0">
                      <Skeleton className="h-9 w-9 shrink-0 rounded-lg" />
                      <div className="flex-1 space-y-2">
                        <Skeleton className="h-3 w-24" />
                        <Skeleton className="h-4 w-56" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : pagedTasks.length === 0 ? (
                <div className="px-5 py-10">
                  <EmptyState
                    icon={isFiltering ? Search : ClipboardList}
                    title={isFiltering ? "Không tìm thấy task phù hợp" : "Chưa có task được giao"}
                    description={
                      isFiltering
                        ? "Thử đổi bộ lọc hoặc từ khóa tìm kiếm khác."
                        : "Nhân viên kho chỉ thao tác trên task đã được quản lý giao. Các nghiệp vụ tạo đơn, điều chuyển và điều chỉnh tồn kho không hiển thị tại đây."
                    }
                  />
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {pagedTasks.map((task, idx) => {
                    const actionPath = getTaskActionPath(task);
                    const canReport = OPERATIONAL_TYPES.includes(task.type);
                    const relatedEntity = getRelatedEntityDisplay(task);
                    const accent = TASK_TYPE_ACCENT[task.type] ?? DEFAULT_ACCENT;
                    const Icon = accent.icon;
                    const seq = (myPage - 1) * PAGE_SIZE + idx + 1;
                    return (
                      <div
                        key={`${task.type}:${task.id}`}
                        className={cn("flex items-start gap-4 border-l-4 bg-card p-4 hover:bg-muted/30 transition-colors", accent.border)}
                      >
                        <div className="flex shrink-0 flex-col items-center gap-1.5 pt-0.5">
                          <span className="font-mono text-[11px] font-semibold tabular-nums text-muted-foreground">
                            {String(seq).padStart(2, "0")}
                          </span>
                          <div className={cn("flex h-9 w-9 items-center justify-center rounded-lg", accent.iconBg)}>
                            <Icon className={cn("h-4 w-4", accent.iconColor)} />
                          </div>
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="text-[11px] text-muted-foreground uppercase tracking-wide">{TASK_TYPE_LABELS[task.type] ?? task.type}</p>
                              <p className="font-mono text-[13px] font-medium text-foreground truncate">{task.title}</p>
                            </div>
                            <StatusBadge label={task.status} variant={taskStatusVariant(task.status)} dot />
                          </div>
                          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-muted-foreground">
                            <span className="truncate">{task.warehouse || "-"}</span>
                            <span>·</span>
                            <span>Tạo {formatDate(task.created_at)}</span>
                            {task.completed_at && (
                              <>
                                <span>·</span>
                                <span>Hoàn tất {formatDate(task.completed_at)}</span>
                              </>
                            )}
                          </div>
                          {relatedEntity && (
                            <div className="mt-2 inline-flex flex-col rounded border border-indigo-100 bg-indigo-50/70 px-2 py-1 dark:border-indigo-500/20 dark:bg-indigo-500/10">
                              <p className="flex items-center gap-1 font-mono text-[10px] font-medium text-indigo-700 dark:text-indigo-400">
                                <Link2 className="h-2.5 w-2.5 shrink-0" />
                                {relatedEntity.ref_number}
                              </p>
                              {relatedEntity.details && (
                                <p className="text-[10px] text-muted-foreground leading-tight mt-0.5">{relatedEntity.details}</p>
                              )}
                            </div>
                          )}
                          <div className="mt-2.5 flex items-center gap-1.5 flex-wrap">
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
                      </div>
                    );
                  })}
                </div>
              )}

              {filteredTasks.length > 0 && (
                <div className="flex flex-col gap-3 border-t border-border px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-[12px] text-muted-foreground">
                    Hiển thị <span className="font-medium text-foreground">{pagedTasks.length}</span> / {filteredTasks.length} task
                  </p>
                  {myTotalPages > 1 && (
                    <Pagination className="mx-0 w-auto justify-end">
                      <PaginationContent>
                        <PaginationItem>
                          <PaginationPrevious
                            onClick={(event) => {
                              event.preventDefault();
                              setMyPage((current) => Math.max(1, current - 1));
                            }}
                            className={cn("cursor-pointer", myPage === 1 && "pointer-events-none opacity-50")}
                          />
                        </PaginationItem>
                        {getPaginationRange(myPage, myTotalPages).map((item) => (
                          <PaginationItem key={item}>
                            {typeof item === "number" ? (
                              <PaginationLink
                                isActive={item === myPage}
                                onClick={(event) => {
                                  event.preventDefault();
                                  setMyPage(item);
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
                              setMyPage((current) => Math.min(myTotalPages, current + 1));
                            }}
                            className={cn("cursor-pointer", myPage === myTotalPages && "pointer-events-none opacity-50")}
                          />
                        </PaginationItem>
                      </PaginationContent>
                    </Pagination>
                  )}
                </div>
              )}
            </SectionCard>
          </TabsContent>

          <TabsContent value="available" className="mt-4">
            {/* Open job board — a pool anyone can claim, not a personal ordered queue, so
                tickets are unnumbered and torn-edge (dashed) rather than the solid queue rows above. */}
            <SectionCard noPadding>
              <div className="px-5 py-3.5 border-b border-dashed border-border flex items-center gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-dashed border-emerald-200 bg-emerald-50 dark:border-emerald-500/30 dark:bg-emerald-500/10">
                  <Hand className="h-4 w-4 text-emerald-700 dark:text-emerald-400" />
                </div>
                <div>
                  <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Bảng việc mở</p>
                  <p className="text-sm font-semibold text-foreground">Công việc có thể tự nhận</p>
                  <p className="text-[11px] text-muted-foreground">Lấy hàng, xuất kho, nhận chuyển kho chưa phân công — nhận task và bắt đầu ngay</p>
                </div>
              </div>

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
                <div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3">
                  {pagedAvailableTasks.map((task) => {
                    const accent = TASK_TYPE_ACCENT[task.type] ?? DEFAULT_ACCENT;
                    const Icon = accent.icon;
                    return (
                      <div
                        key={`avail:${task.type}:${task.id}`}
                        className="flex flex-col gap-3 rounded-xl border border-dashed border-border bg-card p-4 transition-colors hover:border-emerald-300 dark:hover:border-emerald-500/40"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex min-w-0 items-center gap-2">
                            <div className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg", accent.iconBg)}>
                              <Icon className={cn("h-4 w-4", accent.iconColor)} />
                            </div>
                            <div className="min-w-0">
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
                            </div>
                          </div>
                          <StatusBadge label={task.status} variant={taskStatusVariant(task.status)} dot />
                        </div>
                        <p className="font-mono text-[13px] font-medium text-foreground truncate">{task.title}</p>
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
                    );
                  })}
                </div>
              )}

              {availableTasks.length > 0 && (
                <div className="flex flex-col gap-3 border-t border-border px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-[12px] text-muted-foreground">
                    Hiển thị <span className="font-medium text-foreground">{pagedAvailableTasks.length}</span> / {availableTasks.length} task
                  </p>
                  {availableTotalPages > 1 && (
                    <Pagination className="mx-0 w-auto justify-end">
                      <PaginationContent>
                        <PaginationItem>
                          <PaginationPrevious
                            onClick={(event) => {
                              event.preventDefault();
                              setAvailablePage((current) => Math.max(1, current - 1));
                            }}
                            className={cn("cursor-pointer", availablePage === 1 && "pointer-events-none opacity-50")}
                          />
                        </PaginationItem>
                        {getPaginationRange(availablePage, availableTotalPages).map((item) => (
                          <PaginationItem key={item}>
                            {typeof item === "number" ? (
                              <PaginationLink
                                isActive={item === availablePage}
                                onClick={(event) => {
                                  event.preventDefault();
                                  setAvailablePage(item);
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
                              setAvailablePage((current) => Math.min(availableTotalPages, current + 1));
                            }}
                            className={cn("cursor-pointer", availablePage === availableTotalPages && "pointer-events-none opacity-50")}
                          />
                        </PaginationItem>
                      </PaginationContent>
                    </Pagination>
                  )}
                </div>
              )}
            </SectionCard>
          </TabsContent>
        </Tabs>
      </FadeItem>
    </PageWrapper>
  );
}
