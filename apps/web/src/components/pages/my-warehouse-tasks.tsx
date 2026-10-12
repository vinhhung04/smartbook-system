import { useMemo, useEffect, useState, type ComponentType } from "react";
import {
  AlertTriangle, ArrowLeftRight, ArrowRight, CheckCircle2, ClipboardCheck, ClipboardList, Clock, Hand, Hourglass,
  Inbox, Link2, MapPinned, PackageCheck, RefreshCw, Search, ShoppingCart, Truck,
} from "lucide-react";
import { NavLink, useNavigate } from "react-router";
import { toast } from "sonner";
import { PageWrapper, FadeItem } from "../motion-utils";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/loading-state";
import { PageHeader } from "@/components/ui/page-header";
import { SectionCard } from "@/components/ui/section-card";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/status-badge";
import { FilterBar } from "@/components/ui/filter-bar";
import {
  Pagination, PaginationContent, PaginationEllipsis, PaginationItem, PaginationLink,
  PaginationNext, PaginationPrevious,
} from "@/components/ui/pagination";
import { cn } from "@/components/ui/utils";
import { getPaginationRange } from "@/lib/pagination";
import { getApiErrorMessage } from "@/services/api";
import { myWarehouseTaskService, type AvailableWarehouseTask, type MyWarehouseTask } from "@/services/my-warehouse-tasks";
import { putawayService, type PutawayReceiptSummary } from "@/services/putaway";
import { getWarehouseTaskStatusLabel, getWarehouseTaskStatusVariant } from "@/lib/status-registry";

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

const FILTER_CHIPS: Array<{ key: string; label: string }> = [
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

// Same color families the sidebar (nav-groups.ts) already uses for these features —
// goods receipts/purchase requests = indigo, putaway = violet, picking = emerald,
// outbound = sky, exception reports = red — so a task's accent always matches the
// color the rest of the app already trained the user to read as that feature.
const TASK_TYPE_ACCENT: Record<string, { icon: ComponentType<{ className?: string }>; border: string; iconBg: string; iconColor: string }> = {
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

type View = "todo" | "available" | "waiting" | "done";
type Bucket = Exclude<View, "available">;

const TERMINAL_STATUSES = new Set(["COMPLETED", "DONE", "CANCELLED", "RESOLVED", "RECEIVED", "REJECTED", "CONVERTED"]);
const AWAITING_DECISION = new Set(["PENDING", "REQUESTED", "PENDING_APPROVAL", "SUBMITTED", "OPEN", "ACKNOWLEDGED"]);

// Splits the API's flat task list into what the user has to do now, what is waiting
// on someone else (their own requests and reports), and what is finished.
function bucketOf(task: MyWarehouseTask, putawayReady: Map<string, PutawayReceiptSummary> | null): Bucket {
  const status = String(task.status || "").toUpperCase();
  if (TERMINAL_STATUSES.has(status)) return "done";
  if (task.type === "PUTAWAY") {
    // A posted receipt stays "PUTAWAY" forever in this feed; it only still needs work
    // while the putaway queue reports quantity left to shelve. Unknown → keep it visible.
    return !putawayReady || putawayReady.has(task.id) ? "todo" : "done";
  }
  if (task.type === "PURCHASE_REQUEST") return status === "APPROVED" ? "done" : "waiting";
  if (task.type === "EXCEPTION_REPORT") return AWAITING_DECISION.has(status) ? "waiting" : "done";
  return "todo";
}

function taskActionLabel(type: string) {
  const upper = String(type || "").toUpperCase();
  if (upper === "RECEIVING") return "Ghi nhận";
  if (upper === "PUTAWAY") return "Cất hàng";
  if (upper === "PICKING") return "Lấy hàng";
  if (upper === "OUTBOUND") return "Xác nhận xuất";
  if (upper === "TRANSFER_RECEIVING") return "Nhận hàng";
  if (upper === "PURCHASE_REQUEST") return "Xem yêu cầu";
  if (upper === "EXCEPTION_REPORT") return "Xem báo cáo";
  if (upper === "STAFF_TASK") return "Xem task";
  return "Thực hiện";
}

function formatDate(value: string | null | undefined) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function ageOf(value: string | null | undefined) {
  if (!value) return null;
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) return null;
  const minutes = Math.max(0, Math.round((Date.now() - time) / 60_000));
  if (minutes < 60) return { text: `${minutes} phút`, stale: false };
  const hours = Math.round(minutes / 60);
  if (hours < 24) return { text: `${hours} giờ`, stale: hours >= 8 };
  return { text: `${Math.round(hours / 24)} ngày`, stale: true };
}

function getTaskActionPath(task: MyWarehouseTask, putawayReady: Map<string, PutawayReceiptSummary> | null) {
  // Open the receipt directly while it still has stock to shelve; otherwise use the feed's path.
  if (task.type === "PUTAWAY" && putawayReady?.has(task.id)) return `/putaway/${task.id}`;
  if (task.action_path) return task.action_path;
  if (task.type === "RECEIVING") return `/orders/${task.id}`;
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

function sortByTime(list: MyWarehouseTask[], key: "created_at" | "completed_at", direction: "asc" | "desc") {
  return [...list].sort((a, b) => {
    const ta = new Date(a[key] || a.created_at || 0).getTime();
    const tb = new Date(b[key] || b.created_at || 0).getTime();
    return direction === "asc" ? ta - tb : tb - ta;
  });
}

function Pager({ page, totalPages, onChange }: { page: number; totalPages: number; onChange: (page: number) => void }) {
  if (totalPages <= 1) return null;
  return (
    <Pagination className="mx-0 w-auto justify-end">
      <PaginationContent>
        <PaginationItem>
          <PaginationPrevious
            onClick={(event) => { event.preventDefault(); onChange(Math.max(1, page - 1)); }}
            className={cn("cursor-pointer", page === 1 && "pointer-events-none opacity-50")}
          />
        </PaginationItem>
        {getPaginationRange(page, totalPages).map((item, i) => (
          <PaginationItem key={`${item}-${i}`}>
            {typeof item === "number" ? (
              <PaginationLink isActive={item === page} onClick={(event) => { event.preventDefault(); onChange(item); }} className="cursor-pointer">
                {item}
              </PaginationLink>
            ) : (
              <PaginationEllipsis />
            )}
          </PaginationItem>
        ))}
        <PaginationItem>
          <PaginationNext
            onClick={(event) => { event.preventDefault(); onChange(Math.min(totalPages, page + 1)); }}
            className={cn("cursor-pointer", page === totalPages && "pointer-events-none opacity-50")}
          />
        </PaginationItem>
      </PaginationContent>
    </Pagination>
  );
}

const primaryActionClass = "inline-flex h-8 shrink-0 items-center whitespace-nowrap gap-1.5 rounded-lg bg-emerald-600 px-3 text-[12px] font-semibold text-white hover:bg-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40 dark:bg-emerald-500 dark:text-emerald-950 dark:hover:bg-emerald-400";
const secondaryActionClass = "inline-flex h-8 shrink-0 items-center whitespace-nowrap gap-1.5 rounded-lg border border-border bg-background px-3 text-[12px] font-medium text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function MyWarehouseTasksPage() {
  const navigate = useNavigate();
  const [tasks, setTasks] = useState<MyWarehouseTask[]>([]);
  const [putawayReady, setPutawayReady] = useState<Map<string, PutawayReceiptSummary> | null>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<View>("todo");
  const [activeType, setActiveType] = useState("ALL");
  const [searchQuery, setSearchQuery] = useState("");
  const [availableTasks, setAvailableTasks] = useState<AvailableWarehouseTask[]>([]);
  const [claimingId, setClaimingId] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  const loadTasks = async () => {
    try {
      setLoading(true);
      const [response, availableResponse, readyReceipts] = await Promise.all([
        myWarehouseTaskService.getMyTasks(),
        myWarehouseTaskService.getAvailableTasks(),
        // Only used to tell finished putaway receipts apart; the page still works without it.
        putawayService.getReadyReceipts().catch(() => null),
      ]);
      setTasks(Array.isArray(response.data) ? response.data : []);
      setAvailableTasks(Array.isArray(availableResponse.data) ? availableResponse.data : []);
      setPutawayReady(Array.isArray(readyReceipts) ? new Map(readyReceipts.map((receipt) => [receipt.id, receipt])) : null);
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Không tải được công việc kho"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void loadTasks(); }, []);

  const buckets = useMemo(() => {
    const grouped: Record<Bucket, MyWarehouseTask[]> = { todo: [], waiting: [], done: [] };
    for (const task of tasks) grouped[bucketOf(task, putawayReady)].push(task);
    return {
      // Oldest first: the queue is worked in arrival order.
      todo: sortByTime(grouped.todo, "created_at", "asc"),
      waiting: sortByTime(grouped.waiting, "created_at", "asc"),
      done: sortByTime(grouped.done, "completed_at", "desc"),
    };
  }, [tasks, putawayReady]);

  const viewTasks: Array<MyWarehouseTask | AvailableWarehouseTask> = view === "available" ? availableTasks : buckets[view];

  const countsByType = useMemo(() => {
    const map: Record<string, number> = { ALL: viewTasks.length };
    for (const task of viewTasks) map[task.type] = (map[task.type] ?? 0) + 1;
    return map;
  }, [viewTasks]);

  const filtered = useMemo(() => {
    const base = activeType === "ALL" ? viewTasks : viewTasks.filter((task) => task.type === activeType);
    const query = searchQuery.trim().toLowerCase();
    if (!query) return base;
    return base.filter((task) => task.title.toLowerCase().includes(query) || (task.warehouse ?? "").toLowerCase().includes(query));
  }, [viewTasks, activeType, searchQuery]);

  const isFiltering = activeType !== "ALL" || searchQuery.trim() !== "";
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  useEffect(() => { setPage(1); }, [view, activeType, searchQuery]);
  useEffect(() => { setPage((current) => Math.min(current, totalPages)); }, [totalPages]);
  useEffect(() => {
    // Drop a type filter that has nothing left in the newly selected view.
    if (activeType !== "ALL" && !countsByType[activeType]) setActiveType("ALL");
  }, [activeType, countsByType]);

  const handleReportException = (task: MyWarehouseTask) => {
    const params = new URLSearchParams({ task_id: task.id, task_type: task.type, task_warehouse: task.warehouse ?? "" });
    if (task.warehouse_id) params.set("warehouse_id", task.warehouse_id);
    void navigate(`/my-exception-reports?${params.toString()}`);
  };

  const handleClaimTask = async (task: AvailableWarehouseTask) => {
    setClaimingId(task.id);
    try {
      await myWarehouseTaskService.claimTask(task.claim_endpoint);
      toast.success(`Đã nhận task ${task.title}. Task đã chuyển sang mục Cần làm.`);
      void loadTasks();
    } catch (error: unknown) {
      const apiError = error as { response?: { status?: number } };
      if (apiError?.response?.status === 409) {
        toast.error("Task này vừa được nhân viên khác nhận. Làm mới danh sách để xem task còn trống.");
      } else {
        toast.error(getApiErrorMessage(error, "Không thể nhận task"));
      }
    } finally {
      setClaimingId(null);
    }
  };

  const views: Array<{ key: View; label: string; count: number; icon: ComponentType<{ className?: string }>; tone: string }> = [
    { key: "todo", label: "Cần làm", count: buckets.todo.length, icon: ClipboardList, tone: "text-emerald-600 dark:text-emerald-400" },
    { key: "available", label: "Có thể nhận", count: availableTasks.length, icon: Hand, tone: "text-sky-600 dark:text-sky-400" },
    { key: "waiting", label: "Đang chờ duyệt", count: buckets.waiting.length, icon: Hourglass, tone: "text-amber-600 dark:text-amber-400" },
    { key: "done", label: "Đã xong", count: buckets.done.length, icon: CheckCircle2, tone: "text-muted-foreground" },
  ];

  // The oldest open task gets the spotlight only on the unfiltered first page of "Cần làm".
  const spotlight = view === "todo" && !isFiltering && page === 1 ? (paged[0] as MyWarehouseTask | undefined) : undefined;
  const listRows = spotlight ? paged.slice(1) : paged;
  const queueOffset = (page - 1) * PAGE_SIZE;

  const taskMeta = (task: MyWarehouseTask) => {
    const putaway = task.type === "PUTAWAY" ? putawayReady?.get(task.id) : undefined;
    return putaway ? `Còn ${putaway.remaining_quantity}/${putaway.total_quantity} cuốn cần cất` : null;
  };

  const renderTaskRow = (task: MyWarehouseTask, index: number) => {
    const actionPath = getTaskActionPath(task, putawayReady);
    const relatedEntity = getRelatedEntityDisplay(task);
    const accent = TASK_TYPE_ACCENT[task.type] ?? DEFAULT_ACCENT;
    const Icon = accent.icon;
    const isTodo = view === "todo";
    const isDone = view === "done";
    const canReport = isTodo && OPERATIONAL_TYPES.includes(task.type);
    const age = ageOf(task.created_at);
    const meta = taskMeta(task);
    return (
      <div key={`${task.type}:${task.id}`} className={cn("flex flex-col gap-3 px-4 py-3.5 transition-colors hover:bg-muted/30 sm:flex-row sm:items-center sm:gap-4", isDone && "opacity-80")}>
        <div className="flex min-w-0 flex-1 items-start gap-3">
          {isTodo ? (
            <span className="mt-0.5 w-5 shrink-0 text-right font-mono text-[11px] tabular-nums text-muted-foreground" aria-label={`Thứ tự ${index}`}>{index}</span>
          ) : null}
          <div className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg", accent.iconBg)}>
            <Icon className={cn("h-4 w-4", accent.iconColor)} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <p className="truncate font-mono text-[13px] font-medium text-foreground" title={task.title}>{task.title}</p>
              <StatusBadge label={getWarehouseTaskStatusLabel(task.status)} variant={getWarehouseTaskStatusVariant(task.status)} />
            </div>
            <p className="mt-0.5 truncate text-[12px] text-muted-foreground">
              {TASK_TYPE_LABELS[task.type] ?? task.type} · {task.warehouse || "-"}
              {meta ? <> · <span className="text-violet-700 dark:text-violet-400">{meta}</span></> : null}
            </p>
            {relatedEntity && (
              <p className="mt-0.5 flex items-center gap-1 text-[11px] text-indigo-700 dark:text-indigo-400">
                <Link2 className="h-3 w-3 shrink-0" aria-hidden="true" />
                <span className="font-mono font-medium">{relatedEntity.ref_number}</span>
                {relatedEntity.details ? <span className="truncate text-muted-foreground">· {relatedEntity.details}</span> : null}
              </p>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <span className={cn("mr-auto whitespace-nowrap text-[11px] tabular-nums sm:mr-0", !isDone && age?.stale ? "font-medium text-amber-700 dark:text-amber-400" : "text-muted-foreground")} title={formatDate(isDone ? task.completed_at : task.created_at)}>
            {isDone ? (task.completed_at ? `Xong ${formatDate(task.completed_at)}` : "Đã đóng") : age ? `Chờ ${age.text}` : "-"}
          </span>
          {actionPath ? (
            <NavLink to={actionPath} className={isTodo ? primaryActionClass : secondaryActionClass}>
              {isTodo ? taskActionLabel(task.type) : "Xem"}
            </NavLink>
          ) : null}
          {canReport && (
            <button
              type="button"
              onClick={() => handleReportException(task)}
              aria-label={`Báo cáo sự cố cho task ${task.title}`}
              title="Báo cáo sự cố cho task này"
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border text-muted-foreground transition-colors hover:border-red-200 hover:bg-red-50 hover:text-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:hover:border-red-500/20 dark:hover:bg-red-500/10 dark:hover:text-red-400"
            >
              <AlertTriangle className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>
    );
  };

  const renderSpotlight = (task: MyWarehouseTask) => {
    const actionPath = getTaskActionPath(task, putawayReady);
    const accent = TASK_TYPE_ACCENT[task.type] ?? DEFAULT_ACCENT;
    const Icon = accent.icon;
    const age = ageOf(task.created_at);
    const meta = taskMeta(task);
    const relatedEntity = getRelatedEntityDisplay(task);
    return (
      <div className={cn("flex flex-col gap-4 border-b border-l-4 border-border bg-emerald-50/50 px-5 py-4 dark:bg-emerald-500/5 sm:flex-row sm:items-center sm:justify-between", accent.border)}>
        <div className="flex min-w-0 items-start gap-3">
          <div className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl", accent.iconBg)}>
            <Icon className={cn("h-5 w-5", accent.iconColor)} />
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">Làm tiếp theo · {TASK_TYPE_LABELS[task.type] ?? task.type}</p>
            <div className="mt-0.5 flex flex-wrap items-center gap-2">
              <p className="truncate font-mono text-[15px] font-semibold text-foreground">{task.title}</p>
              <StatusBadge label={getWarehouseTaskStatusLabel(task.status)} variant={getWarehouseTaskStatusVariant(task.status)} dot />
            </div>
            <p className="mt-0.5 text-[12px] text-muted-foreground">
              {task.warehouse || "-"}
              {age ? <> · <span className={cn(age.stale && "font-medium text-amber-700 dark:text-amber-400")}>chờ {age.text}</span></> : null}
              {meta ? <> · <span className="text-violet-700 dark:text-violet-400">{meta}</span></> : null}
            </p>
            {relatedEntity && (
              <p className="mt-0.5 flex items-center gap-1 text-[11px] text-indigo-700 dark:text-indigo-400">
                <Link2 className="h-3 w-3 shrink-0" aria-hidden="true" />
                <span className="font-mono font-medium">{relatedEntity.ref_number}</span>
                {relatedEntity.details ? <span className="truncate text-muted-foreground">· {relatedEntity.details}</span> : null}
              </p>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {OPERATIONAL_TYPES.includes(task.type) && (
            <Button variant="ghost" size="sm" onClick={() => handleReportException(task)} className="text-muted-foreground hover:text-red-700">
              <AlertTriangle className="h-3.5 w-3.5" />Báo sự cố
            </Button>
          )}
          {actionPath ? (
            <NavLink to={actionPath} className={cn(primaryActionClass, "h-9 px-4 text-[13px]")}>
              {taskActionLabel(task.type)}
              <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </NavLink>
          ) : null}
        </div>
      </div>
    );
  };

  const emptyState = () => {
    if (isFiltering) {
      return <EmptyState icon={Search} title="Không tìm thấy task phù hợp" description="Thử đổi loại task hoặc từ khóa tìm kiếm khác." />;
    }
    if (view === "todo") {
      return (
        <EmptyState
          icon={CheckCircle2}
          title="Bạn đã làm hết việc"
          description={availableTasks.length > 0 ? `Đang có ${availableTasks.length} task chưa ai nhận.` : "Task mới do quản lý giao sẽ xuất hiện ở đây."}
          action={availableTasks.length > 0 ? <Button size="sm" onClick={() => setView("available")}><Hand className="h-3.5 w-3.5" />Xem task có thể nhận</Button> : undefined}
        />
      );
    }
    if (view === "available") {
      return <EmptyState icon={Hand} title="Không có task nào đang chờ người nhận" description="Lấy hàng, xuất kho và nhận chuyển kho chưa phân công sẽ hiện ở đây. Cất hàng luôn do quản lý giao trực tiếp." />;
    }
    if (view === "waiting") {
      return <EmptyState icon={Hourglass} title="Không có yêu cầu nào đang chờ" description="Yêu cầu mua hàng và báo cáo sự cố bạn gửi sẽ hiện ở đây cho đến khi quản lý xử lý." />;
    }
    return <EmptyState icon={ClipboardList} title="Chưa có task hoàn tất" description="Task bạn làm xong sẽ được lưu ở đây." />;
  };

  const sectionTitle = view === "todo" ? "Hàng đợi của bạn" : view === "available" ? "Task chưa ai nhận" : view === "waiting" ? "Đang chờ quản lý xử lý" : "Đã hoàn tất";
  const sectionSubtitle = view === "todo"
    ? "Task cũ nhất ở trên cùng — làm theo thứ tự từ trên xuống"
    : view === "available"
      ? "Nhận task để chuyển nó vào hàng đợi của bạn"
      : view === "waiting"
        ? "Yêu cầu mua hàng và báo cáo sự cố bạn đã gửi"
        : "Task đã xong, bị hủy hoặc đã chuyển cho người khác";

  return (
    <PageWrapper className="space-y-5">
      <FadeItem>
        <PageHeader
          icon={ClipboardList}
          title="Công việc kho của tôi"
          description="Nhận hàng, cất hàng, lấy hàng và xuất kho được giao cho bạn"
          iconBg="bg-emerald-100 dark:bg-emerald-500/15"
          iconColor="text-emerald-700 dark:text-emerald-400"
          actions={
            <Button type="button" variant="outline" size="sm" onClick={() => void loadTasks()} disabled={loading}>
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
              Làm mới
            </Button>
          }
        />
      </FadeItem>

      <FadeItem>
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4" role="tablist" aria-label="Nhóm công việc">
          {views.map((item) => {
            const active = view === item.key;
            const ItemIcon = item.icon;
            return (
              <button
                key={item.key}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setView(item.key)}
                className={cn(
                  "flex items-center gap-3 rounded-xl border bg-card px-4 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  active ? "border-foreground/20 shadow-sm ring-1 ring-foreground/10" : "border-border hover:bg-muted/40",
                )}
              >
                <ItemIcon className={cn("hidden h-5 w-5 shrink-0 sm:block", active ? item.tone : "text-muted-foreground/70")} />
                <div className="min-w-0">
                  <p className={cn("text-[22px] font-semibold leading-none tabular-nums", active ? "text-foreground" : item.count ? "text-foreground/80" : "text-muted-foreground/60")}>
                    {loading ? "–" : item.count}
                  </p>
                  <p className={cn("mt-1 text-[12px] leading-tight", active ? "font-medium text-foreground" : "text-muted-foreground")}>{item.label}</p>
                </div>
                {item.key === "available" && item.count > 0 && !active ? (
                  <span className="ml-auto h-2 w-2 shrink-0 rounded-full bg-sky-500" aria-label="có task mới" />
                ) : null}
              </button>
            );
          })}
        </div>
      </FadeItem>

      <FadeItem>
        <SectionCard noPadding title={sectionTitle} subtitle={sectionSubtitle}>
          <div className="border-t border-border px-4 py-3">
            <FilterBar
              searchValue={searchQuery}
              onSearchChange={setSearchQuery}
              searchPlaceholder="Tìm mã task, kho..."
              showSearchClear
              filters={
                <div className="max-w-full overflow-x-auto">
                  <div className="flex w-max items-center gap-1.5">
                    {FILTER_CHIPS.filter((chip) => chip.key === "ALL" || (countsByType[chip.key] ?? 0) > 0).map((chip) => {
                      const isActive = activeType === chip.key;
                      return (
                        <button
                          key={chip.key}
                          type="button"
                          onClick={() => setActiveType(chip.key)}
                          aria-pressed={isActive}
                          className={cn(
                            "flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                            isActive
                              ? "border-foreground/20 bg-foreground text-background"
                              : "border-border bg-card text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                          )}
                        >
                          {chip.label}
                          <span className="font-mono text-[11px] tabular-nums opacity-70">{countsByType[chip.key] ?? 0}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              }
            />
          </div>

          <div className="border-t border-border">
            {loading ? (
              <div>
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-4 border-b border-border p-4 last:border-b-0">
                    <Skeleton className="h-8 w-8 shrink-0 rounded-lg" />
                    <div className="flex-1 space-y-2">
                      <Skeleton className="h-4 w-56" />
                      <Skeleton className="h-3 w-32" />
                    </div>
                  </div>
                ))}
              </div>
            ) : paged.length === 0 ? (
              <div className="px-5 py-10">{emptyState()}</div>
            ) : view === "available" ? (
              <div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 xl:grid-cols-3">
                {(paged as AvailableWarehouseTask[]).map((task) => {
                  const accent = TASK_TYPE_ACCENT[task.type] ?? DEFAULT_ACCENT;
                  const Icon = accent.icon;
                  const age = ageOf(task.created_at);
                  const step = task.type === "PICKING"
                    ? (task.is_repick ? <>Bổ sung cho <span className="font-mono">{task.parent_order_number}</span></> : "Bước 1 · Lấy hàng")
                    : task.type === "OUTBOUND" ? "Bước 2 · Xuất kho" : TASK_TYPE_LABELS[task.type] ?? task.type;
                  return (
                    <div key={`avail:${task.type}:${task.id}`} className="flex flex-col gap-3 rounded-xl border border-dashed border-border bg-card p-4 transition-colors hover:border-sky-300 dark:hover:border-sky-500/40">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex min-w-0 items-center gap-2.5">
                          <div className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg", accent.iconBg)}>
                            <Icon className={cn("h-4 w-4", accent.iconColor)} />
                          </div>
                          <div className="min-w-0">
                            <p className="truncate font-mono text-[13px] font-medium text-foreground">{task.title}</p>
                            <p className="text-[11px] text-muted-foreground">{step}</p>
                          </div>
                        </div>
                        {task.is_repick && (
                          <span className="shrink-0 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 dark:bg-amber-500/15 dark:text-amber-400">Bổ sung</span>
                        )}
                      </div>
                      <div className="flex items-center justify-between gap-2 text-[12px] text-muted-foreground">
                        <span className="truncate">
                          {task.task_type === "transfer" && task.from_warehouse_name && task.to_warehouse_name
                            ? `${task.from_warehouse_name} → ${task.to_warehouse_name}`
                            : task.warehouse || "-"}
                        </span>
                        {age ? (
                          <span className={cn("flex shrink-0 items-center gap-1", age.stale && "font-medium text-amber-700 dark:text-amber-400")} title={formatDate(task.created_at)}>
                            <Clock className="h-3 w-3" aria-hidden="true" />{age.text}
                          </span>
                        ) : null}
                      </div>
                      <Button type="button" size="sm" onClick={() => void handleClaimTask(task)} disabled={claimingId === task.id} className="w-full">
                        <Hand className="h-3.5 w-3.5" />
                        {claimingId === task.id ? "Đang nhận..." : "Nhận task"}
                      </Button>
                    </div>
                  );
                })}
              </div>
            ) : (
              <>
                {spotlight ? renderSpotlight(spotlight) : null}
                <div className="divide-y divide-border">
                  {(listRows as MyWarehouseTask[]).map((task, i) => renderTaskRow(task, queueOffset + i + (spotlight ? 2 : 1)))}
                </div>
              </>
            )}
          </div>

          {!loading && filtered.length > 0 && (
            <div className="flex flex-col gap-3 border-t border-border px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-[12px] text-muted-foreground">
                Hiển thị {queueOffset + 1}–{Math.min(queueOffset + PAGE_SIZE, filtered.length)} trong {filtered.length} task
              </p>
              <Pager page={page} totalPages={totalPages} onChange={setPage} />
            </div>
          )}
        </SectionCard>
      </FadeItem>
    </PageWrapper>
  );
}
