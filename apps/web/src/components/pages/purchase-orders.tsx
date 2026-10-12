import { Fragment, useEffect, useMemo, useState } from "react";
import { NavLink, useNavigate } from "react-router";
import { CheckSquare, ChevronRight, ClipboardList, Plus, RefreshCw, X } from "lucide-react";
import { toast } from "sonner";
import { purchaseOrderService, type PurchaseOrderStatus, type PurchaseOrderSummary } from "@/services/purchase-order";
import { supplierService, type Supplier } from "@/services/supplier";
import { warehouseService, type Warehouse } from "@/services/warehouse";
import { getApiErrorMessage } from "@/services/api";
import { StatusBadge } from "@/components/status-badge";
import { SectionCard } from "@/components/ui/section-card";
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
// only their status badge, since a linear dot trail would misrepresent them.
const STAGE_SEQUENCE: PurchaseOrderStatus[] = ["DRAFT", "PENDING_APPROVAL", "APPROVED", "SENT_TO_SUPPLIER", "SUPPLIER_CONFIRMED", "RECEIVED"];
const STAGE_OFF_RAMP = new Set(["REJECTED", "CANCELLED", "SHORTAGE_REPORTED"]);

function PoStageDots({ status }: { status: PurchaseOrderStatus }) {
  if (STAGE_OFF_RAMP.has(status)) return null;
  const isPartial = status === "PARTIALLY_RECEIVED";
  const currentIdx = isPartial ? 4 : STAGE_SEQUENCE.indexOf(status);
  return (
    <div className="flex items-center gap-1" title={`Tiến trình: ${purchaseOrderStatusLabel(isPartial ? "SUPPLIER_CONFIRMED" : status)}`} aria-hidden="true">
      {STAGE_SEQUENCE.map((stage, i) => {
        const tone = isPartial && i === 5 ? "bg-amber-500" : i <= currentIdx ? "bg-emerald-500" : "bg-muted";
        return <span key={stage} className={`h-1.5 w-1.5 rounded-full ${tone}`} />;
      })}
    </div>
  );
}

// Pipeline filter: the flow in order, then the statuses that leave it.
// `attention` marks stages where someone on our side has to act.
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

  const pipelineButton = (value: string, label: string, count: number | null, attention = false) => {
    const active = status === value;
    return (
      <button
        key={value}
        type="button"
        onClick={() => selectStatus(value)}
        aria-pressed={active}
        className={cn(
          "group relative flex flex-1 shrink-0 flex-col items-start rounded-lg border px-2.5 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          active
            ? "border-indigo-300 bg-indigo-50 text-indigo-700 dark:border-indigo-500/40 dark:bg-indigo-500/15 dark:text-indigo-300"
            : "border-transparent hover:border-border hover:bg-muted/50",
        )}
      >
        <span className={cn("text-[18px] font-semibold leading-tight tabular-nums", !active && (count ? "text-foreground" : "text-muted-foreground/60"))}>
          {count ?? "–"}
        </span>
        <span className={cn("flex items-center gap-1.5 whitespace-nowrap text-[11px]", active ? "font-medium" : "text-muted-foreground")}>
          {attention && !!count && <span className="h-1.5 w-1.5 rounded-full bg-amber-500" aria-label="cần xử lý" />}
          {label}
        </span>
      </button>
    );
  };

  return (
    <PageWrapper className="space-y-5">
      <FadeItem>
        <PageHeader
          icon={ClipboardList}
          title="Đơn đặt hàng"
          description="Lập đơn đặt hàng, phê duyệt và đối soát nhập hàng"
          iconBg="bg-gradient-to-br from-indigo-600 to-sky-600 shadow-lg shadow-indigo-500/20"
          iconColor="text-white"
          actions={
            <>
              <Button variant="outline" size="sm" onClick={() => { void load(); void loadCounts(); }} disabled={loading}>
                <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
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
        <div className="overflow-hidden rounded-xl border border-border bg-card shadow-[0_1px_2px_rgba(0,0,0,0.03),0_2px_8px_rgba(0,0,0,0.04)] dark:shadow-none">
          <div className="flex items-center gap-0.5 overflow-x-auto p-2 [scrollbar-width:thin]" role="group" aria-label="Lọc theo trạng thái">
            {pipelineButton("ALL", "Tất cả", totalCount)}
            <span className="mx-1 h-8 w-px shrink-0 bg-border" aria-hidden="true" />
            {PIPELINE.map((stage, i) => (
              <Fragment key={stage.status}>
                {i > 0 && <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground/40" aria-hidden="true" />}
                {pipelineButton(stage.status, stage.label, counts?.[stage.status] ?? null, stage.attention)}
              </Fragment>
            ))}
            <span className="mx-1 h-8 w-px shrink-0 bg-border" aria-hidden="true" />
            {CLOSED.map((stage) => pipelineButton(stage.status, stage.label, counts?.[stage.status] ?? null))}
          </div>
          <div className="border-t border-border px-4 py-3">
            <FilterBar
              searchValue={search}
              onSearchChange={setSearch}
              searchPlaceholder="Tìm mã PO, nhà cung cấp, kho..."
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
              actions={
                <SegmentedControl
                  options={VIEW_OPTIONS}
                  value={view}
                  onChange={(v) => { setView(v); setPage(1); }}
                  layoutId="po-view-segmented"
                />
              }
            />
          </div>
        </div>
      </FadeItem>

      <FadeItem>
        <SectionCard noPadding>
          <Table className="table-fixed">
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead className="w-10">
                  {selectablePendingRows.length > 0 && (
                    <Checkbox checked={allSelectableChecked} onCheckedChange={(checked) => toggleAllSelectable(checked === true)} aria-label="Chọn tất cả đơn chờ duyệt" />
                  )}
                </TableHead>
                {[
                  { label: "Đơn hàng", className: "" },
                  { label: "Trạng thái", className: "hidden w-[190px] sm:table-cell" },
                  { label: "Ngày", className: "hidden w-[150px] lg:table-cell" },
                  { label: "Nhận hàng", className: "hidden w-[150px] sm:table-cell" },
                  { label: "Tổng tiền", className: "hidden w-[140px] text-right xl:table-cell" },
                ].map((heading) => (
                  <TableHead key={heading.label} className={cn("px-3 text-[11px] uppercase tracking-wider text-muted-foreground", heading.className)}>{heading.label}</TableHead>
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
                    className={cn("cursor-pointer", selected && "bg-indigo-50/60 dark:bg-indigo-500/10")}
                  >
                    <TableCell onClick={(event) => event.stopPropagation()}>
                      {row.status === "PENDING_APPROVAL" && (
                        <Checkbox checked={selected} onCheckedChange={(checked) => toggleRow(row.id, checked === true)} aria-label={`Chọn ${row.po_number}`} />
                      )}
                    </TableCell>
                    <TableCell className="px-3 py-3">
                      <NavLink
                        to={`/purchase-orders/${row.id}`}
                        onClick={(event) => event.stopPropagation()}
                        className="block truncate rounded font-mono text-[13px] font-semibold text-indigo-600 hover:text-indigo-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:text-indigo-400 dark:hover:text-indigo-300"
                      >
                        {row.po_number}
                      </NavLink>
                      <p className="truncate text-[12px] text-foreground/80" title={row.supplier_name || undefined}>{row.supplier_name || "-"}</p>
                      <p className="truncate text-[11px] text-muted-foreground">
                        {warehouse ? `→ ${warehouse}` : null}
                        <span className="sm:hidden">{warehouse ? " · " : ""}Nhận {received}/{ordered} · {formatCurrency(row.total_amount)}</span>
                      </p>
                      <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 sm:hidden">
                        <StatusBadge label={purchaseOrderStatusLabel(row.status)} variant={getStatusVariant("purchaseOrder", row.status)} dot />
                        {hint && <span className={cn("text-[11px]", hint.attention ? "font-medium text-amber-700 dark:text-amber-400" : "text-muted-foreground")}>{hint.text}</span>}
                        {overdue > 0 && <span className="text-[11px] font-medium text-red-600 dark:text-red-400">Trễ {overdue} ngày</span>}
                      </div>
                    </TableCell>
                    <TableCell className="hidden px-3 py-3 sm:table-cell">
                      <div className="flex flex-col items-start gap-1.5">
                        <StatusBadge label={purchaseOrderStatusLabel(row.status)} variant={getStatusVariant("purchaseOrder", row.status)} dot />
                        <div className="flex items-center gap-2">
                          <PoStageDots status={row.status} />
                          {hint && (
                            <span className={cn("truncate text-[11px]", hint.attention ? "font-medium text-amber-700 dark:text-amber-400" : "text-muted-foreground")}>
                              {hint.text}
                            </span>
                          )}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="hidden px-3 py-3 text-[12px] lg:table-cell">
                      <p className="text-muted-foreground">Đặt {formatDate(row.order_date)}</p>
                      {row.expected_date ? (
                        <>
                          <p className={cn(overdue > 0 ? "font-medium text-red-600 dark:text-red-400" : "text-muted-foreground")}>Hẹn {formatDate(row.expected_date)}</p>
                          {overdue > 0 && (
                            <span className="mt-1 inline-flex rounded-full bg-red-50 px-1.5 py-px text-[10px] font-medium text-red-600 dark:bg-red-500/10 dark:text-red-400">Trễ {overdue} ngày</span>
                          )}
                        </>
                      ) : (
                        <p className="text-muted-foreground/70">Chưa hẹn ngày giao</p>
                      )}
                    </TableCell>
                    <TableCell className="hidden px-3 py-3 sm:table-cell">
                      <div className="flex items-baseline justify-between gap-2">
                        <p className="text-[13px] font-semibold tabular-nums">{received}<span className="font-normal text-muted-foreground"> / {ordered}</span></p>
                        <span className="text-[11px] text-muted-foreground">{row.item_count} dòng</span>
                      </div>
                      <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-muted" role="img" aria-label={`Đã nhận ${receivedPct}%`}>
                        <div className={cn("h-full rounded-full", barTone)} style={{ width: `${receivedPct}%` }} />
                      </div>
                      <p className="mt-1 font-mono text-[11px] text-muted-foreground xl:hidden">{formatCurrency(row.total_amount)}</p>
                    </TableCell>
                    <TableCell className={cn("hidden px-3 py-3 text-right font-mono text-[12px] tabular-nums xl:table-cell", Number(row.total_amount) === 0 && "text-muted-foreground")}>
                      {formatCurrency(row.total_amount)}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          <div className="flex flex-col gap-2 border-t border-border px-5 py-3 text-[12px] text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
            <span>
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
        </SectionCard>
      </FadeItem>

      {selectedIds.size > 0 && (
        <div className="sticky bottom-4 z-20 mx-auto flex w-fit max-w-full items-center gap-3 rounded-xl border border-border bg-card px-4 py-2.5 text-[13px] shadow-lg">
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
