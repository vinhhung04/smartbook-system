import { useEffect, useMemo, useState } from "react";
import { NavLink, useNavigate } from "react-router";
import { CheckSquare, ClipboardList, Plus, RefreshCw, X } from "lucide-react";
import { toast } from "sonner";
import { purchaseOrderService, type PurchaseOrderStatus, type PurchaseOrderSummary } from "@/services/purchase-order";
import { supplierService, type Supplier } from "@/services/supplier";
import { warehouseService, type Warehouse } from "@/services/warehouse";
import { getApiErrorMessage } from "@/services/api";
import { StatusBadge } from "@/components/status-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { SkeletonTableRow } from "@/components/ui/loading-state";
import { PageWrapper, FadeItem } from "@/components/motion-utils";
import { FilterBar } from "@/components/ui/filter-bar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import {
  Pagination, PaginationContent, PaginationEllipsis, PaginationItem, PaginationLink,
  PaginationNext, PaginationPrevious,
} from "@/components/ui/pagination";
import { Checkbox } from "@/components/ui/checkbox";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { cn } from "@/components/ui/utils";
import { getPaginationRange } from "@/lib/pagination";
import { authService } from "@/services/auth";
import { canAccess, ROUTE_ACCESS } from "@/lib/rbac";
import { getStatusVariant } from "@/lib/status-registry";
import { purchaseOrderStatusLabel } from "@/lib/purchase-order-status";

const VIEW_OPTIONS: { value: "all" | "my" | "approval"; label: string }[] = [
  { value: "all", label: "Tất cả" },
  { value: "my", label: "Của tôi" },
  { value: "approval", label: "Chờ duyệt" },
];

// The real PO happy path — draft through received. Off-ramp statuses (rejected,
// cancelled, shortage-reported) don't get force-fit onto this trail; they show
// only their status badge, since a linear trail would misrepresent them.
const STAGE_SEQUENCE: PurchaseOrderStatus[] = ["DRAFT", "PENDING_APPROVAL", "APPROVED", "SENT_TO_SUPPLIER", "SUPPLIER_CONFIRMED", "RECEIVED"];
const STAGE_OFF_RAMP = new Set(["REJECTED", "CANCELLED", "SHORTAGE_REPORTED"]);

/** Six segments for the happy path; filled up to the current stage, the last one amber while partly received. */
function PoStageTrack({ status }: { status: PurchaseOrderStatus }) {
  if (STAGE_OFF_RAMP.has(status)) return null;
  const isPartial = status === "PARTIALLY_RECEIVED";
  const currentIdx = isPartial ? 4 : STAGE_SEQUENCE.indexOf(status);
  return (
    <div className="flex w-24 gap-0.5" title={`Bước ${Math.min(currentIdx + 1, 6)}/6 của quy trình`} aria-hidden="true">
      {STAGE_SEQUENCE.map((stage, i) => {
        const tone = isPartial && i === 5 ? "bg-amber-500" : i <= currentIdx ? "bg-primary/70" : "bg-muted";
        return <span key={stage} className={`h-1 flex-1 rounded-full ${tone}`} />;
      })}
    </div>
  );
}

// Every status the list can filter by; counts are fetched for each.
const PIPELINE: { status: PurchaseOrderStatus; label: string; attention?: boolean }[] = [
  { status: "DRAFT", label: "Nháp" },
  { status: "PENDING_APPROVAL", label: "Chờ duyệt", attention: true },
  { status: "APPROVED", label: "Chờ gửi NCC", attention: true },
  { status: "SENT_TO_SUPPLIER", label: "Chờ NCC xác nhận" },
  { status: "SUPPLIER_CONFIRMED", label: "Chờ giao hàng" },
  { status: "PARTIALLY_RECEIVED", label: "Nhận một phần" },
  { status: "SHORTAGE_REPORTED", label: "Báo thiếu", attention: true },
  { status: "RECEIVED", label: "Đã nhận" },
];
const CLOSED: { status: PurchaseOrderStatus; label: string }[] = [
  { status: "REJECTED", label: "Bị từ chối" },
  { status: "CANCELLED", label: "Đã hủy" },
];
const COUNTED_STATUSES = [...PIPELINE, ...CLOSED].map((stage) => stage.status);
const STAGE_LABEL = new Map<string, string>([...PIPELINE, ...CLOSED].map((stage) => [stage.status, stage.label]));
const ATTENTION_STATUSES = PIPELINE.filter((stage) => stage.attention).map((stage) => stage.status);

// The status rail groups by who has to move next, not by pipeline order: what waits on us first.
const RAIL_GROUPS: { title: string; statuses: PurchaseOrderStatus[] }[] = [
  { title: "Cần xử lý", statuses: ATTENTION_STATUSES },
  { title: "Đang tiến hành", statuses: ["DRAFT", "SENT_TO_SUPPLIER", "SUPPLIER_CONFIRMED", "PARTIALLY_RECEIVED"] },
  { title: "Đã đóng", statuses: ["RECEIVED", "REJECTED", "CANCELLED"] },
];

const FINISHED_STATUSES = new Set(["RECEIVED", "REJECTED", "CANCELLED"]);

function nextStepHint(row: PurchaseOrderSummary): { text: string; attention: boolean } | null {
  const remaining = Math.max(0, Number(row.total_ordered_qty || 0) - Number(row.total_received_qty || 0));
  switch (row.status) {
    case "DRAFT": return { text: "Chưa gửi duyệt", attention: false };
    case "PENDING_APPROVAL": return { text: "Cần duyệt", attention: true };
    case "APPROVED": return { text: "Cần gửi cho NCC", attention: true };
    case "SENT_TO_SUPPLIER": return { text: "Chờ NCC xác nhận", attention: false };
    case "SUPPLIER_CONFIRMED": return { text: "Chờ NCC giao hàng", attention: false };
    case "PARTIALLY_RECEIVED": return { text: `Còn ${remaining} cuốn chưa nhận`, attention: false };
    case "SHORTAGE_REPORTED": return { text: "Cần xử lý báo thiếu", attention: true };
    case "REJECTED": return { text: "Cần sửa và gửi lại", attention: true };
    default: return null;
  }
}

function formatCurrency(value: number) {
  return `${Number(value || 0).toLocaleString("vi-VN")} VND`;
}

function formatDate(value?: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString("vi-VN");
}

function daysOverdue(row: PurchaseOrderSummary) {
  if (!row.expected_date || FINISHED_STATUSES.has(row.status)) return 0;
  const expected = new Date(row.expected_date);
  if (Number.isNaN(expected.getTime())) return 0;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  expected.setHours(0, 0, 0, 0);
  return Math.max(0, Math.round((today.getTime() - expected.getTime()) / 86_400_000));
}

export function PurchaseOrdersPage() {
  const navigate = useNavigate();
  const currentUser = authService.getCurrentUser();
  const canCreatePurchaseOrder = canAccess(currentUser, ROUTE_ACCESS.purchaseWrite);
  const [rows, setRows] = useState<PurchaseOrderSummary[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("ALL");
  const [supplierId, setSupplierId] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [view, setView] = useState<"all" | "my" | "approval">("all");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalRows, setTotalRows] = useState(0);
  const [counts, setCounts] = useState<Record<string, number> | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [confirmBulkApprove, setConfirmBulkApprove] = useState(false);
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const PAGE_SIZE = 20;

  const load = async () => {
    try {
      setLoading(true);
      const params: Record<string, string | number> = { view, page, pageSize: PAGE_SIZE };
      if (debouncedSearch.trim()) params.search = debouncedSearch.trim();
      if (status !== "ALL") params.status = status;
      if (supplierId) params.supplier_id = supplierId;
      if (warehouseId) params.warehouse_id = warehouseId;
      const [poResp, supplierRows, warehouseRows] = await Promise.all([
        purchaseOrderService.getAll(params),
        supplierService.getAll(),
        warehouseService.getAll(),
      ]);
      setRows(Array.isArray(poResp.data) ? poResp.data : []);
      setTotalRows(poResp.pagination?.total || 0);
      setTotalPages(Math.max(1, Math.ceil((poResp.pagination?.total || 0) / PAGE_SIZE)));
      setSuppliers(Array.isArray(supplierRows) ? supplierRows : []);
      setWarehouses(Array.isArray(warehouseRows) ? warehouseRows : []);
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Không tải được danh sách đơn đặt hàng"));
    } finally {
      setLoading(false);
    }
  };

  // Real totals across the whole system, independent of the row filters above —
  // counting only the current page's rows would be silently wrong under any
  // filter or on page 2+.
  const loadCounts = async () => {
    try {
      const results = await Promise.all(
        COUNTED_STATUSES.map((s) => purchaseOrderService.getAll({ status: s, page: 1, pageSize: 1 })),
      );
      const next: Record<string, number> = {};
      COUNTED_STATUSES.forEach((s, i) => { next[s] = results[i]?.pagination?.total || 0; });
      setCounts(next);
    } catch {
      // Non-critical — the pipeline just keeps its last known counts.
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, supplierId, warehouseId, view, page, debouncedSearch]);

  useEffect(() => {
    void loadCounts();
  }, []);

  // Debounce free-text search into a separate committed value instead of requiring
  // Enter — settles 400ms after typing stops, then resets to page 1 and (via the
  // debouncedSearch dependency above) triggers exactly one reload either way,
  // whether or not the page number itself actually changed.
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 400);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch]);

  const selectablePendingRows = useMemo(() => rows.filter((row) => row.status === "PENDING_APPROVAL"), [rows]);
  const allSelectableChecked = selectablePendingRows.length > 0 && selectablePendingRows.every((row) => selectedIds.has(row.id));
  const totalCount = counts ? Object.values(counts).reduce((sum, n) => sum + n, 0) : null;
  const hasFilters = status !== "ALL" || !!supplierId || !!warehouseId || !!search.trim() || view !== "all";

  const toggleRow = (id: string, checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id); else next.delete(id);
      return next;
    });
  };

  const toggleAllSelectable = (checked: boolean) => {
    setSelectedIds(checked ? new Set(selectablePendingRows.map((row) => row.id)) : new Set());
  };

  const selectStatus = (next: string) => {
    setStatus(next);
    setPage(1);
  };

  const clearFilters = () => {
    setStatus("ALL");
    setSupplierId("");
    setWarehouseId("");
    setSearch("");
    setView("all");
    setPage(1);
  };

  const handleBulkApprove = async () => {
    const ids = Array.from(selectedIds);
    const results = await Promise.allSettled(ids.map((id) => purchaseOrderService.approve(id)));
    const failed = results.filter((r) => r.status === "rejected").length;
    const succeeded = ids.length - failed;
    if (succeeded > 0) toast.success(`Đã duyệt ${succeeded} đơn.`);
    if (failed > 0) toast.error(`${failed} đơn duyệt thất bại.`);
    setSelectedIds(new Set());
    setConfirmBulkApprove(false);
    void load();
    void loadCounts();
  };

  // The header says what waits on us, in words, straight from the status counts.
  const lede = (() => {
    if (!counts || totalCount === null) return "Đang đếm đơn theo trạng thái...";
    const waiting = ATTENTION_STATUSES
      .filter((s) => (counts[s] ?? 0) > 0)
      .map((s) => `${counts[s]} đơn ${(STAGE_LABEL.get(s) || s).toLowerCase()}`);
    return waiting.length > 0
      ? `${totalCount} đơn. Cần xử lý: ${waiting.join(", ")}.`
      : `${totalCount} đơn. Không có đơn nào đang chờ xử lý.`;
  })();

  const railItem = (value: string, label: string, count: number | null, attention = false, compact = false) => {
    const active = status === value;
    return (
      <button
        key={value}
        type="button"
        onClick={() => selectStatus(value)}
        aria-pressed={active}
        className={cn(
          "flex items-center justify-between gap-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
          compact ? "shrink-0 rounded-full border px-3.5 py-1.5" : "w-full rounded-lg px-3 py-2",
          active
            ? compact ? "border-primary/30 bg-primary/[0.08] text-primary" : "bg-primary/[0.08] text-primary"
            : compact ? "border-border bg-card text-foreground hover:bg-muted/60" : "text-foreground hover:bg-muted/60",
        )}
      >
        <span className={cn("whitespace-nowrap text-[13px]", active ? "font-semibold" : "font-medium")}>{label}</span>
        <span
          className={cn(
            "min-w-6 rounded-full px-1.5 text-center text-[12px] tabular-nums",
            attention && count ? "bg-amber-100 font-semibold text-amber-800 dark:bg-amber-500/15 dark:text-amber-300" : active ? "text-primary" : "text-muted-foreground",
          )}
        >
          {count ?? "–"}
        </span>
      </button>
    );
  };

  return (
    <PageWrapper className="space-y-6">
      <FadeItem>
        <PageHeader
          icon={ClipboardList}
          title="Đơn đặt hàng"
          description={lede}
          actions={
            <>
              <Button variant="ghost" size="sm" onClick={() => { void load(); void loadCounts(); }} disabled={loading}>
                <RefreshCw className={`h-3.5 w-3.5 motion-reduce:animate-none ${loading ? "animate-spin" : ""}`} />
                Làm mới
              </Button>
              {canCreatePurchaseOrder ? (
                <Button asChild size="sm">
                  <NavLink to="/purchase-orders/new">
                    <Plus className="h-3.5 w-3.5" />
                    Tạo PO mới
                  </NavLink>
                </Button>
              ) : null}
            </>
          }
        />
      </FadeItem>

      <FadeItem>
        <div className="@container">
          <div className="grid grid-cols-1 items-start gap-4 @4xl:grid-cols-[220px_minmax(0,1fr)]">
            {/* Status rail: a sticky column when there is room, a row of chips when there is not. */}
            <nav aria-label="Lọc theo trạng thái" className="hidden rounded-2xl border border-border bg-card p-3 @4xl:sticky @4xl:top-4 @4xl:block">
              {railItem("ALL", "Tất cả đơn", totalCount)}
              {RAIL_GROUPS.map((group) => (
                <div key={group.title} className="mt-3 border-t border-border pt-3">
                  <p className="px-3 pb-1.5 text-[12px] font-semibold text-muted-foreground">{group.title}</p>
                  {group.statuses.map((s) =>
                    railItem(s, STAGE_LABEL.get(s) || s, counts?.[s] ?? null, ATTENTION_STATUSES.includes(s)),
                  )}
                </div>
              ))}
            </nav>
            <nav aria-label="Lọc theo trạng thái" className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:thin] @4xl:hidden">
              {railItem("ALL", "Tất cả", totalCount, false, true)}
              {RAIL_GROUPS.flatMap((group) => group.statuses).map((s) =>
                railItem(s, STAGE_LABEL.get(s) || s, counts?.[s] ?? null, ATTENTION_STATUSES.includes(s), true),
              )}
            </nav>

            <section aria-label="Danh sách đơn" className="@container min-w-0 overflow-hidden rounded-2xl border border-border bg-card">
              <div className="flex flex-wrap items-center justify-between gap-3 px-5 pb-1 pt-4">
                <h2 className="font-serif text-[18px] font-semibold tracking-tight">
                  {status === "ALL" ? "Tất cả đơn" : STAGE_LABEL.get(status) || status}
                </h2>
                <SegmentedControl
                  options={VIEW_OPTIONS}
                  value={view}
                  onChange={(v) => { setView(v); setPage(1); }}
                  layoutId="po-view-segmented"
                />
              </div>
              <div className="border-b border-border px-4 py-3">
                <FilterBar
                  searchValue={search}
                  onSearchChange={setSearch}
                  searchPlaceholder="Tìm mã PO, nhà cung cấp, kho"
                  filters={
                    <>
                      <Select value={supplierId || "__all__"} onValueChange={(v) => { setSupplierId(v === "__all__" ? "" : v); setPage(1); }}>
                        <SelectTrigger size="sm" className="w-[180px]" aria-label="Nhà cung cấp">
                          <SelectValue placeholder="Tất cả nhà cung cấp" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__all__">Tất cả nhà cung cấp</SelectItem>
                          {suppliers.map((supplier) => <SelectItem key={supplier.id} value={supplier.id}>{supplier.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      <Select value={warehouseId || "__all__"} onValueChange={(v) => { setWarehouseId(v === "__all__" ? "" : v); setPage(1); }}>
                        <SelectTrigger size="sm" className="w-[170px]" aria-label="Kho nhận">
                          <SelectValue placeholder="Tất cả kho" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__all__">Tất cả kho</SelectItem>
                          {warehouses.map((warehouse) => <SelectItem key={warehouse.id} value={warehouse.id}>{warehouse.code} - {warehouse.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      {hasFilters && (
                        <Button variant="ghost" size="sm" onClick={clearFilters} className="text-muted-foreground">
                          <X className="h-3.5 w-3.5" />Xóa lọc
                        </Button>
                      )}
                    </>
                  }
                />
              </div>

              <Table className="table-fixed">
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="w-10 pl-4">
                      {selectablePendingRows.length > 0 && (
                        <Checkbox checked={allSelectableChecked} onCheckedChange={(checked) => toggleAllSelectable(checked === true)} aria-label="Chọn tất cả đơn chờ duyệt" />
                      )}
                    </TableHead>
                    {[
                      { label: "Nhà cung cấp và đơn", className: "" },
                      { label: "Tiến trình", className: "hidden w-[168px] @xl:table-cell" },
                      { label: "Hẹn giao", className: "hidden w-[116px] @3xl:table-cell" },
                      { label: "Đã nhận", className: "hidden w-[132px] @2xl:table-cell" },
                      { label: "Giá trị", className: "hidden w-[120px] pr-5 text-right @5xl:table-cell" },
                    ].map((heading) => (
                      <TableHead key={heading.label} className={cn("px-3 text-[12px] font-medium text-muted-foreground", heading.className)}>{heading.label}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading ? (
                    <SkeletonTableRow columns={6} rows={5} />
                  ) : rows.length === 0 ? (
                    <TableRow className="hover:bg-transparent">
                      <TableCell colSpan={6} className="whitespace-normal py-12">
                        {hasFilters ? (
                          <EmptyState
                            variant="no-data"
                            title="Không có đơn phù hợp"
                            description="Thử bỏ bớt bộ lọc hoặc đổi từ khóa tìm kiếm"
                            action={<Button variant="outline" size="sm" onClick={clearFilters}><X className="h-3.5 w-3.5" />Xóa lọc</Button>}
                          />
                        ) : (
                          <EmptyState variant="no-data" title="Chưa có đơn đặt hàng" description="Tạo PO để bắt đầu quy trình phê duyệt và đối soát nhập hàng" />
                        )}
                      </TableCell>
                    </TableRow>
                  ) : rows.map((row) => {
                    const ordered = Number(row.total_ordered_qty) || 0;
                    const received = Number(row.total_received_qty) || 0;
                    const receivedPct = ordered > 0 ? Math.min(100, Math.round((received / ordered) * 100)) : 0;
                    const barTone = received > ordered ? "bg-red-500" : received > 0 && received < ordered ? "bg-amber-500" : "bg-emerald-500";
                    const warehouse = row.warehouse_code || row.warehouse_name;
                    const hint = nextStepHint(row);
                    const overdue = daysOverdue(row);
                    const selected = selectedIds.has(row.id);
                    return (
                      <TableRow
                        key={row.id}
                        onClick={() => navigate(`/purchase-orders/${row.id}`)}
                        className={cn("cursor-pointer", selected && "bg-primary/[0.06]")}
                      >
                        <TableCell className="pl-4 align-top pt-4" onClick={(event) => event.stopPropagation()}>
                          {row.status === "PENDING_APPROVAL" && (
                            <Checkbox checked={selected} onCheckedChange={(checked) => toggleRow(row.id, checked === true)} aria-label={`Chọn ${row.po_number}`} />
                          )}
                        </TableCell>
                        <TableCell className="px-3 py-3.5">
                          <p className="truncate text-[14px] font-semibold text-foreground" title={row.supplier_name || undefined}>{row.supplier_name || "Chưa có nhà cung cấp"}</p>
                          <p className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[12px] text-muted-foreground">
                            <NavLink
                              to={`/purchase-orders/${row.id}`}
                              onClick={(event) => event.stopPropagation()}
                              className="truncate rounded font-mono text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                            >
                              {row.po_number}
                            </NavLink>
                            {warehouse ? <span className="shrink-0">về {warehouse}</span> : null}
                          </p>
                          <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 @xl:hidden">
                            <StatusBadge label={purchaseOrderStatusLabel(row.status)} variant={getStatusVariant("purchaseOrder", row.status)} dot />
                            {hint && <span className={cn("text-[12px]", hint.attention ? "font-medium text-amber-700 dark:text-amber-400" : "text-muted-foreground")}>{hint.text}</span>}
                            <span className="text-[12px] tabular-nums text-muted-foreground">Nhận {received}/{ordered}</span>
                            {overdue > 0 && <span className="text-[12px] font-medium text-red-600 dark:text-red-400">Trễ {overdue} ngày</span>}
                          </div>
                        </TableCell>
                        <TableCell className="hidden px-3 py-3.5 @xl:table-cell">
                          <div className="flex flex-col items-start gap-1.5">
                            <StatusBadge label={purchaseOrderStatusLabel(row.status)} variant={getStatusVariant("purchaseOrder", row.status)} dot />
                            <PoStageTrack status={row.status} />
                            {hint && (
                              <span className={cn("max-w-full truncate text-[12px]", hint.attention ? "font-medium text-amber-700 dark:text-amber-400" : "text-muted-foreground")}>
                                {hint.text}
                              </span>
                            )}
                            {overdue > 0 && (
                              <span className="text-[12px] font-medium text-red-600 @3xl:hidden dark:text-red-400">Trễ {overdue} ngày</span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="hidden px-3 py-3.5 text-[13px] @3xl:table-cell">
                          {row.expected_date ? (
                            <>
                              <p className={cn("tabular-nums", overdue > 0 ? "font-semibold text-red-600 dark:text-red-400" : "text-foreground")}>{formatDate(row.expected_date)}</p>
                              {overdue > 0 && <p className="text-[12px] font-medium text-red-600 dark:text-red-400">Trễ {overdue} ngày</p>}
                            </>
                          ) : (
                            <p className="text-muted-foreground">Chưa hẹn</p>
                          )}
                          <p className="mt-0.5 text-[12px] tabular-nums text-muted-foreground">Đặt {formatDate(row.order_date)}</p>
                        </TableCell>
                        <TableCell className="hidden px-3 py-3.5 @2xl:table-cell">
                          <p className="text-[13px] font-semibold tabular-nums">
                            {received}<span className="font-normal text-muted-foreground"> / {ordered} cuốn</span>
                          </p>
                          <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-muted" role="img" aria-label={`Đã nhận ${receivedPct}%`}>
                            <div className={cn("h-full rounded-full", barTone)} style={{ width: `${receivedPct}%` }} />
                          </div>
                          <p className="mt-1 text-[12px] text-muted-foreground">{row.item_count} dòng sách</p>
                          <p className="text-[12px] tabular-nums text-muted-foreground @5xl:hidden">{formatCurrency(row.total_amount)}</p>
                        </TableCell>
                        <TableCell className={cn("hidden px-3 py-3.5 pr-5 text-right text-[13px] tabular-nums @5xl:table-cell", Number(row.total_amount) === 0 && "text-muted-foreground")}>
                          {formatCurrency(row.total_amount)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
              <div className="flex flex-col gap-2 border-t border-border px-5 py-3 text-[12.5px] text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
                <span aria-live="polite">
                  {totalRows > 0
                    ? `Hiển thị ${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, totalRows)} trong ${totalRows} đơn`
                    : "Không có đơn"}
                </span>
                {totalPages > 1 && (
                  <Pagination className="mx-0 w-auto justify-end">
                    <PaginationContent>
                      <PaginationItem>
                        <PaginationPrevious
                          onClick={(event) => { event.preventDefault(); if (page > 1) setPage(page - 1); }}
                          className={cn("cursor-pointer", page === 1 && "pointer-events-none opacity-50")}
                        />
                      </PaginationItem>
                      {getPaginationRange(page, totalPages).map((item, i) => (
                        <PaginationItem key={`${item}-${i}`}>
                          {typeof item === "number" ? (
                            <PaginationLink isActive={item === page} onClick={(event) => { event.preventDefault(); setPage(item); }} className="cursor-pointer">
                              {item}
                            </PaginationLink>
                          ) : (
                            <PaginationEllipsis />
                          )}
                        </PaginationItem>
                      ))}
                      <PaginationItem>
                        <PaginationNext
                          onClick={(event) => { event.preventDefault(); if (page < totalPages) setPage(page + 1); }}
                          className={cn("cursor-pointer", page === totalPages && "pointer-events-none opacity-50")}
                        />
                      </PaginationItem>
                    </PaginationContent>
                  </Pagination>
                )}
              </div>
            </section>
          </div>
        </div>
      </FadeItem>

      {selectedIds.size > 0 && (
        <div role="region" aria-label="Thao tác hàng loạt" className="sticky bottom-4 z-20 mx-auto flex w-fit max-w-full items-center gap-3 rounded-full border border-border bg-card py-2 pl-5 pr-2 text-[13px] shadow-[0_18px_40px_-22px_rgba(15,23,42,0.45)]">
          <span className="font-medium">Đã chọn {selectedIds.size} đơn chờ duyệt</span>
          <Button variant="ghost" size="sm" onClick={() => setSelectedIds(new Set())}>Bỏ chọn</Button>
          <Button size="sm" onClick={() => setConfirmBulkApprove(true)}>
            <CheckSquare className="h-3.5 w-3.5" />
            Duyệt {selectedIds.size} đơn
          </Button>
        </div>
      )}

      <ConfirmDialog
        open={confirmBulkApprove}
        onOpenChange={setConfirmBulkApprove}
        title="Duyệt hàng loạt?"
        description={`Duyệt ${selectedIds.size} đơn đặt hàng đã chọn? Hành động này không thể hoàn tác.`}
        confirmLabel="Duyệt"
        onConfirm={handleBulkApprove}
      />
    </PageWrapper>
  );
}
