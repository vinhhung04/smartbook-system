import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from "react";
import {
  AlertTriangle, ArrowLeftRight, CheckCircle2, ClipboardCheck, ClipboardList, Hand, Hourglass,
  Inbox, Link2, MapPinned, PackageCheck, RefreshCw, Search, ShoppingCart, Truck,
} from "lucide-react";
import { NavLink, useNavigate } from "react-router";
import { toast } from "sonner";
import { PageWrapper, FadeItem } from "../motion-utils";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/status-badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BlockError } from "@/components/pages/dashboard/panel";
import { ListFooter, QueueTabs, RowsSkeleton } from "@/components/ops/ops-kit";
import { elapsedSince, formatDateTime, darkFieldClass } from "@/components/ops/ops-utils";
import { cn } from "@/components/ui/utils";
import { getApiErrorMessage } from "@/services/api";
import { authService } from "@/services/auth";
import { canAccess, ROUTE_ACCESS } from "@/lib/rbac";
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

// One grey glyph per kind of work, read beside its label; colour stays for status and the next action.
const TASK_TYPE_ICON: Record<string, ComponentType<{ className?: string }>> = {
  RECEIVING: Inbox,
  PUTAWAY: MapPinned,
  PICKING: PackageCheck,
  OUTBOUND: Truck,
  TRANSFER_RECEIVING: ArrowLeftRight,
  PURCHASE_REQUEST: ShoppingCart,
  EXCEPTION_REPORT: AlertTriangle,
  STAFF_TASK: ClipboardCheck,
};

// Task types the exception-report API accepts; the report button is offered only for these.
const REPORTABLE_TYPES = ["RECEIVING", "PUTAWAY", "PICKING", "OUTBOUND"];

const PAGE_SIZE = 10;
const PANEL_ID = "warehouse-task-list";
const ALL = "ALL";

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

type RelatedEntity = { ref_number: string; details?: string } | null;

function getRelatedEntityDisplay(task: MyWarehouseTask | AvailableWarehouseTask): RelatedEntity {
  return (task as MyWarehouseTask & { related_entity_display?: RelatedEntity }).related_entity_display ?? null;
}

function sortByTime(list: MyWarehouseTask[], key: "created_at" | "completed_at", direction: "asc" | "desc") {
  return [...list].sort((a, b) => {
    const ta = new Date(a[key] || a.created_at || 0).getTime();
    const tb = new Date(b[key] || b.created_at || 0).getTime();
    return direction === "asc" ? ta - tb : tb - ta;
  });
}

function warehouseLabel(task: MyWarehouseTask | AvailableWarehouseTask) {
  const available = task as AvailableWarehouseTask;
  if (available.task_type === "transfer" && available.from_warehouse_name && available.to_warehouse_name) {
    return `${available.from_warehouse_name} → ${available.to_warehouse_name}`;
  }
  return task.warehouse || "Chưa rõ kho";
}

const VIEW_HINT: Record<View, string> = {
  todo: "Task chờ lâu nhất ở đầu hàng đợi",
  available: "Nhận task để chuyển nó vào mục Cần làm",
  waiting: "Yêu cầu và báo cáo bạn gửi, chờ quản lý xử lý",
  done: "Đã xong, đã hủy hoặc đã chuyển cho người khác",
};

const actionLinkClass = "inline-flex h-10 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-3.5 text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 sm:h-8 sm:min-w-[7.5rem]";
const primaryLinkClass = cn(actionLinkClass, "bg-primary text-primary-foreground hover:bg-primary/90");
const outlineLinkClass = cn(actionLinkClass, "border border-border bg-card text-foreground hover:bg-muted");

export function MyWarehouseTasksPage() {
  const navigate = useNavigate();
  const currentUser = authService.getCurrentUser();
  const canOpenPurchaseRequests = canAccess(currentUser, ROUTE_ACCESS.purchaseRequestSelf);
  const canOpenExceptionReports = canAccess(currentUser, ROUTE_ACCESS.exceptionReportSelf);

  const [tasks, setTasks] = useState<MyWarehouseTask[]>([]);
  const [availableTasks, setAvailableTasks] = useState<AvailableWarehouseTask[]>([]);
  const [putawayReady, setPutawayReady] = useState<Map<string, PutawayReceiptSummary> | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadedAt, setLoadedAt] = useState<Date | null>(null);
  const [view, setView] = useState<View>("todo");
  const [activeType, setActiveType] = useState(ALL);
  const [activeWarehouse, setActiveWarehouse] = useState(ALL);
  const [searchQuery, setSearchQuery] = useState("");
  const [claimingId, setClaimingId] = useState<string | null>(null);
  const claimInFlight = useRef(false);
  const [page, setPage] = useState(1);

  // First load shows the skeleton; a refresh keeps the rows on screen and only spins the button.
  const loadTasks = useCallback(async (mode: "initial" | "refresh" = "refresh") => {
    if (mode === "initial") setLoading(true); else setRefreshing(true);
    try {
      const [response, availableResponse, readyReceipts] = await Promise.all([
        myWarehouseTaskService.getMyTasks(),
        myWarehouseTaskService.getAvailableTasks(),
        // Only used to tell finished putaway receipts apart; the page still works without it.
        putawayService.getReadyReceipts().catch(() => null),
      ]);
      setTasks(Array.isArray(response.data) ? response.data : []);
      setAvailableTasks(Array.isArray(availableResponse.data) ? availableResponse.data : []);
      setPutawayReady(Array.isArray(readyReceipts) ? new Map(readyReceipts.map((receipt) => [receipt.id, receipt])) : null);
      setLoadError(null);
      setLoadedAt(new Date());
    } catch (error) {
      const message = getApiErrorMessage(error, "Không tải được công việc kho");
      setLoadError(message);
      if (mode === "refresh") toast.error(message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { void loadTasks("initial"); }, [loadTasks]);

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

  const typeCounts = useMemo(() => {
    const map: Record<string, number> = {};
    for (const task of viewTasks) map[task.type] = (map[task.type] ?? 0) + 1;
    return map;
  }, [viewTasks]);

  const warehouseOptions = useMemo(
    () => [...new Set(viewTasks.map((task) => task.warehouse).filter((name): name is string => Boolean(name)))].sort(),
    [viewTasks],
  );

  const filtered = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return viewTasks.filter((task) => {
      if (activeType !== ALL && task.type !== activeType) return false;
      if (activeWarehouse !== ALL && task.warehouse !== activeWarehouse) return false;
      if (!query) return true;
      const related = getRelatedEntityDisplay(task);
      return [task.title, task.warehouse, TASK_TYPE_LABELS[task.type], related?.ref_number]
        .filter(Boolean).join(" ").toLowerCase().includes(query);
    });
  }, [viewTasks, activeType, activeWarehouse, searchQuery]);

  const isFiltering = activeType !== ALL || activeWarehouse !== ALL || searchQuery.trim() !== "";
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  useEffect(() => { setPage(1); }, [view, activeType, activeWarehouse, searchQuery]);
  useEffect(() => { setPage((current) => Math.min(current, totalPages)); }, [totalPages]);
  useEffect(() => {
    // Drop a filter that has nothing left in the newly selected view.
    if (activeType !== ALL && !typeCounts[activeType]) setActiveType(ALL);
    if (activeWarehouse !== ALL && !warehouseOptions.includes(activeWarehouse)) setActiveWarehouse(ALL);
  }, [activeType, typeCounts, activeWarehouse, warehouseOptions]);

  const handleReportException = (task: MyWarehouseTask) => {
    const params = new URLSearchParams({ task_id: task.id, task_type: task.type, task_warehouse: task.warehouse ?? "" });
    if (task.warehouse_id) params.set("warehouse_id", task.warehouse_id);
    void navigate(`/my-exception-reports?${params.toString()}`);
  };

  const handleClaimTask = async (task: AvailableWarehouseTask) => {
    // A ref, not state: a fast double click lands before React re-renders the disabled button.
    if (claimInFlight.current) return;
    claimInFlight.current = true;
    setClaimingId(task.id);
    try {
      await myWarehouseTaskService.claimTask(task.claim_endpoint);
      toast.success(`Đã nhận ${task.title}`, {
        description: "Task đã chuyển sang mục Cần làm.",
        action: { label: "Xem Cần làm", onClick: () => setView("todo") },
      });
      await loadTasks();
    } catch (error: unknown) {
      const apiError = error as { response?: { status?: number } };
      if (apiError?.response?.status === 409) {
        toast.error("Task này vừa được nhân viên khác nhận. Danh sách đã được làm mới.");
        await loadTasks();
      } else {
        toast.error(getApiErrorMessage(error, "Không thể nhận task"));
      }
    } finally {
      claimInFlight.current = false;
      setClaimingId(null);
    }
  };

  const tabs: Array<{ key: View; label: string; count: number }> = [
    { key: "todo", label: "Cần làm", count: buckets.todo.length },
    { key: "available", label: "Có thể nhận", count: availableTasks.length },
    { key: "waiting", label: "Đang chờ duyệt", count: buckets.waiting.length },
    { key: "done", label: "Đã xong", count: buckets.done.length },
  ];

  // The oldest open task is the one to do next, but only while the queue is shown unfiltered.
  const nextTaskKey = view === "todo" && !isFiltering && page === 1 && paged[0] ? `${paged[0].type}:${paged[0].id}` : null;
  const queueOffset = (page - 1) * PAGE_SIZE;

  const putawayMeta = (task: MyWarehouseTask) => {
    const putaway = task.type === "PUTAWAY" ? putawayReady?.get(task.id) : undefined;
    return putaway ? `Còn ${putaway.remaining_quantity}/${putaway.total_quantity} cuốn cần cất` : null;
  };

  const renderMeta = (task: MyWarehouseTask | AvailableWarehouseTask, extra?: string | null) => {
    const TypeIcon = TASK_TYPE_ICON[task.type] ?? ClipboardList;
    const related = getRelatedEntityDisplay(task);
    return (
      <>
        <p className="mt-1 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[12px] text-muted-foreground">
          <TypeIcon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>{TASK_TYPE_LABELS[task.type] ?? task.type}</span>
          <span aria-hidden="true">·</span>
          <span className="truncate">{warehouseLabel(task)}</span>
          {extra ? <><span aria-hidden="true">·</span><span className="font-medium text-foreground">{extra}</span></> : null}
        </p>
        {related ? (
          <p className="mt-1 flex min-w-0 items-center gap-1 text-[12px] text-muted-foreground">
            <Link2 className="h-3 w-3 shrink-0" aria-hidden="true" />
            <span className="font-mono text-foreground">{related.ref_number}</span>
            {related.details ? <span className="truncate">· {related.details}</span> : null}
          </p>
        ) : null}
      </>
    );
  };

  const renderTaskRow = (task: MyWarehouseTask, position: number) => {
    const actionPath = getTaskActionPath(task, putawayReady);
    const isTodo = view === "todo";
    const isDone = view === "done";
    const isNext = `${task.type}:${task.id}` === nextTaskKey;
    const canReport = isTodo && REPORTABLE_TYPES.includes(task.type);
    const age = elapsedSince(task.created_at);
    const stamp = isDone
      ? (task.completed_at ? `Xong ${formatDateTime(task.completed_at)}` : "Đã đóng")
      : age ? `Chờ ${age.text}` : "—";

    return (
      <li
        key={`${task.type}:${task.id}`}
        className={cn("flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center sm:gap-4 sm:px-5", isNext && "bg-primary/[0.04] dark:bg-primary/[0.07]")}
      >
        {isTodo ? (
          <span className="hidden w-6 shrink-0 text-right text-[12px] tabular-nums text-muted-foreground sm:block" aria-hidden="true">{position}</span>
        ) : null}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className={cn("min-w-0 truncate font-mono font-semibold text-foreground", isNext ? "text-[14px]" : "text-[13px]")} title={task.title}>{task.title}</span>
            <StatusBadge label={getWarehouseTaskStatusLabel(task.status)} variant={getWarehouseTaskStatusVariant(task.status)} />
            {isNext ? <span className="rounded-md bg-primary/10 px-1.5 py-0.5 text-[11px] font-semibold text-primary">Làm tiếp</span> : null}
          </div>
          {renderMeta(task, putawayMeta(task))}
        </div>
        <div className="flex items-center gap-2 sm:shrink-0">
          <span
            className={cn("mr-auto whitespace-nowrap text-[12px] tabular-nums sm:mr-2 sm:w-32 sm:text-right", !isDone && age?.stale ? "font-medium text-amber-700 dark:text-amber-400" : "text-muted-foreground")}
            title={formatDateTime(isDone ? task.completed_at : task.created_at) ?? undefined}
          >
            {stamp}
          </span>
          {actionPath ? (
            <NavLink to={actionPath} className={isNext ? primaryLinkClass : outlineLinkClass}>
              {isTodo ? taskActionLabel(task.type) : "Xem"}
            </NavLink>
          ) : null}
          {canReport ? (
            <button
              type="button"
              onClick={() => handleReportException(task)}
              aria-label={`Báo cáo sự cố cho ${task.title}`}
              title="Báo cáo sự cố"
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:border-red-200 hover:bg-red-50 hover:text-red-700 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:hover:border-red-500/30 dark:hover:bg-red-500/10 dark:hover:text-red-400 sm:h-8 sm:w-8"
            >
              <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          ) : null}
        </div>
      </li>
    );
  };

  const renderAvailableRow = (task: AvailableWarehouseTask) => {
    const age = elapsedSince(task.created_at);
    const claiming = claimingId === task.id;
    const step = task.type === "PICKING"
      ? (task.is_repick ? `Lấy bổ sung cho ${task.parent_order_number ?? "đơn trước"}` : "Bước 1 của 2: lấy hàng")
      : task.type === "OUTBOUND" ? "Bước 2 của 2: xuất kho" : null;
    return (
      <li key={`avail:${task.type}:${task.id}`} className="flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center sm:gap-4 sm:px-5">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="min-w-0 truncate font-mono text-[13px] font-semibold text-foreground" title={task.title}>{task.title}</span>
            {task.is_repick ? <StatusBadge label="Lấy bổ sung" variant="warning" /> : null}
          </div>
          {renderMeta(task, step)}
        </div>
        <div className="flex items-center gap-2 sm:shrink-0">
          <span
            className={cn("mr-auto whitespace-nowrap text-[12px] tabular-nums sm:mr-2 sm:w-32 sm:text-right", age?.stale ? "font-medium text-amber-700 dark:text-amber-400" : "text-muted-foreground")}
            title={formatDateTime(task.created_at) ?? undefined}
          >
            {age ? `Chờ ${age.text}` : "—"}
          </span>
          <Button
            type="button"
            variant="outline"
            onClick={() => void handleClaimTask(task)}
            loading={claiming}
            disabled={claimingId !== null && !claiming}
            className="h-10 min-w-[7.5rem] text-[13px] sm:h-8"
            aria-label={`Nhận task ${task.title}`}
          >
            {claiming ? "Đang nhận…" : <><Hand className="h-3.5 w-3.5" aria-hidden="true" />Nhận task</>}
          </Button>
        </div>
      </li>
    );
  };

  const emptyState = () => {
    if (isFiltering) {
      return (
        <EmptyState
          icon={Search}
          title="Không có task khớp bộ lọc"
          description="Thử từ khóa khác hoặc bỏ bớt bộ lọc."
          action={<Button size="sm" variant="outline" onClick={() => { setSearchQuery(""); setActiveType(ALL); setActiveWarehouse(ALL); }}>Bỏ lọc</Button>}
        />
      );
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
      return <EmptyState icon={Hand} title="Không có task nào chờ người nhận" description="Lấy hàng, xuất kho và nhận chuyển kho chưa phân công sẽ hiện ở đây. Cất hàng luôn do quản lý giao trực tiếp." />;
    }
    if (view === "waiting") {
      return <EmptyState icon={Hourglass} title="Không có yêu cầu nào đang chờ" description="Yêu cầu mua hàng và báo cáo sự cố bạn gửi sẽ ở đây cho đến khi quản lý xử lý." />;
    }
    return <EmptyState icon={ClipboardList} title="Chưa có task hoàn tất" description="Task bạn làm xong sẽ được lưu ở đây." />;
  };

  const loadedLabel = loadedAt ? loadedAt.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" }) : null;
  const activeTab = tabs.find((tab) => tab.key === view)!;

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
            <>
              {loadedLabel ? <span className="hidden text-[12px] tabular-nums text-muted-foreground sm:inline">Cập nhật {loadedLabel}</span> : null}
              <Button type="button" variant="outline" size="sm" onClick={() => void loadTasks()} disabled={loading || refreshing}>
                <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin motion-reduce:animate-none")} />
                Làm mới
              </Button>
            </>
          }
        />
      </FadeItem>

      <FadeItem>
        <section aria-label="Hàng đợi công việc" className="min-w-0 rounded-xl border border-border bg-card">
          <QueueTabs label="Nhóm công việc" tabs={tabs} value={view} onChange={setView} panelId={PANEL_ID} loading={loading} />

          <div className="flex flex-col gap-2 border-b border-border px-4 py-3 sm:flex-row sm:flex-wrap sm:items-center sm:px-5">
            <div className="relative min-w-0 sm:w-72">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <input
                type="search"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Tìm mã task, kho, chứng từ…"
                aria-label="Tìm công việc"
                className="h-10 w-full rounded-md border border-input bg-input-background pl-9 pr-3 text-[14px] outline-none transition-[color,box-shadow] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:border-border dark:bg-muted/40 sm:h-9 sm:text-[13px]"
              />
            </div>
            <div className="flex gap-2">
              <Select value={activeType} onValueChange={setActiveType}>
                <SelectTrigger className={cn("h-10 min-w-0 flex-1 sm:h-9 sm:w-52 sm:flex-none", darkFieldClass)} aria-label="Lọc theo loại công việc">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>Mọi loại công việc ({viewTasks.length})</SelectItem>
                  {Object.keys(TASK_TYPE_LABELS).filter((type) => typeCounts[type]).map((type) => (
                    <SelectItem key={type} value={type}>{TASK_TYPE_LABELS[type]} ({typeCounts[type]})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {warehouseOptions.length > 1 ? (
                <Select value={activeWarehouse} onValueChange={setActiveWarehouse}>
                  <SelectTrigger className={cn("h-10 min-w-0 flex-1 sm:h-9 sm:w-44 sm:flex-none", darkFieldClass)} aria-label="Lọc theo kho">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL}>Mọi kho</SelectItem>
                    {warehouseOptions.map((name) => <SelectItem key={name} value={name}>{name}</SelectItem>)}
                  </SelectContent>
                </Select>
              ) : null}
            </div>
            <p className="hidden text-[12px] text-muted-foreground lg:ml-auto lg:block">{VIEW_HINT[view]}</p>
          </div>

          {view === "waiting" && (canOpenPurchaseRequests || canOpenExceptionReports) ? (
            <p className="flex flex-wrap gap-x-4 gap-y-1 border-b border-border px-4 py-2.5 text-[12px] text-muted-foreground sm:px-5">
              <span>Xem đầy đủ phản hồi của quản lý:</span>
              {canOpenPurchaseRequests ? <NavLink to="/my-purchase-requests" className="font-medium text-primary underline-offset-4 hover:underline">Yêu cầu mua hàng</NavLink> : null}
              {canOpenExceptionReports ? <NavLink to="/my-exception-reports" className="font-medium text-primary underline-offset-4 hover:underline">Báo cáo sự cố</NavLink> : null}
            </p>
          ) : null}

          <div id={PANEL_ID} role="tabpanel" aria-labelledby={`${PANEL_ID}-tab-${view}`} aria-busy={loading || refreshing}>
            <h2 className="sr-only">{activeTab.label}</h2>
            {loading ? (
              <RowsSkeleton rows={6} />
            ) : loadError && tasks.length === 0 && availableTasks.length === 0 ? (
              <div className="p-4 sm:p-5"><BlockError what="công việc kho của bạn" onRetry={() => void loadTasks("initial")} /></div>
            ) : paged.length === 0 ? (
              <div className="px-5 py-8">{emptyState()}</div>
            ) : (
              <ul className="divide-y divide-border">
                {view === "available"
                  ? (paged as AvailableWarehouseTask[]).map(renderAvailableRow)
                  : (paged as MyWarehouseTask[]).map((task, i) => renderTaskRow(task, queueOffset + i + 1))}
              </ul>
            )}
          </div>

          {!loading ? <ListFooter page={page} pageSize={PAGE_SIZE} total={filtered.length} noun="task" onPageChange={setPage} /> : null}
        </section>
      </FadeItem>
    </PageWrapper>
  );
}
