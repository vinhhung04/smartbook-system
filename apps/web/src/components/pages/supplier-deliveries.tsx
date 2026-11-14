import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { NavLink, useNavigate, useParams } from "react-router";
import { AlertCircle, ArrowLeft, ClipboardCheck, Info, RefreshCw, Truck, UserCheck, X } from "lucide-react";
import { toast } from "sonner";
import {
  RECEIVABLE_DELIVERY_STATUSES,
  SUPPLIER_DELIVERY_STATUS_LABELS,
  supplierDeliveryService,
  supplierDeliveryStatusLabel,
  type SupplierDeliveryDetail,
} from "@/services/supplier-delivery";
import { goodsReceiptService } from "@/services/goods-receipt";
import { userService, type WarehouseStaffOption } from "@/services/user";
import { supplierService, type Supplier } from "@/services/supplier";
import { warehouseService, type Warehouse as WarehouseOption } from "@/services/warehouse";
import { getApiErrorMessage } from "@/services/api";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusBadge } from "@/components/status-badge";
import { PageHeader } from "@/components/ui/page-header";
import { LoadingOverlay } from "@/components/ui/loading-state";
import { RowsSkeleton } from "@/components/ops/ops-kit";
import { FilterBar } from "@/components/ui/filter-bar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { PageWrapper, FadeItem } from "@/components/motion-utils";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import {
  Pagination, PaginationContent, PaginationEllipsis, PaginationItem, PaginationLink,
  PaginationNext, PaginationPrevious,
} from "@/components/ui/pagination";
import { cn } from "@/components/ui/utils";
import { getPaginationRange } from "@/lib/pagination";
import { getStatusVariant } from "@/lib/status-registry";

function formatDate(value?: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString("vi-VN");
}

const STATUS_OPTIONS = [
  { value: "ALL", label: "Tất cả" },
  ...Object.entries(SUPPLIER_DELIVERY_STATUS_LABELS).map(([value, label]) => ({ value, label })),
];

const RECEIVABLE_STATUSES = RECEIVABLE_DELIVERY_STATUSES;

export function SupplierDeliveriesPage() {
  const { id } = useParams();
  return id ? <SupplierDeliveryDetailView id={id} /> : <SupplierDeliveryListView />;
}

function SupplierDeliveryListView() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<SupplierDeliveryDetail[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [warehouses, setWarehouses] = useState<WarehouseOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("ALL");
  const [search, setSearch] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 20;

  // Everything is loaded once and the status filter is applied here, so the per-status counts on
  // the filter stay correct (loading with ?status= made every other count read 0).
  const load = useCallback(async () => {
    try {
      setLoading(true);
      const [response, supplierRows, warehouseRows] = await Promise.all([
        supplierDeliveryService.getAll(),
        supplierService.getAll(),
        warehouseService.getAll(),
      ]);
      setRows(Array.isArray(response.data) ? response.data : []);
      setSuppliers(Array.isArray(supplierRows) ? supplierRows : []);
      setWarehouses(Array.isArray(warehouseRows) ? warehouseRows : []);
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Không tải được danh sách giao hàng"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setPage(1);
  }, [search, status, supplierId, warehouseId]);

  const filteredRows = useMemo(() => {
    let result = status === "ALL" ? rows : rows.filter((row) => row.status === status);
    if (supplierId) result = result.filter((row) => row.supplier_id === supplierId);
    if (warehouseId) result = result.filter((row) => row.warehouse_id === warehouseId);
    const query = search.trim().toLowerCase();
    if (query) {
      result = result.filter((row) =>
        [row.invoice_number, row.delivery_number, row.po_number, row.supplier_name, row.warehouse_name, row.warehouse_code]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(query)),
      );
    }
    return result;
  }, [rows, search, status, supplierId, warehouseId]);

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE));
  const pagedRows = filteredRows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const countBy = (pick: (row: SupplierDeliveryDetail) => string | null | undefined) => {
    const map = new Map<string, number>();
    for (const row of rows) { const key = pick(row); if (key) map.set(key, (map.get(key) ?? 0) + 1); }
    return map;
  };
  const statusCounts = countBy((row) => row.status);
  const supplierCounts = countBy((row) => row.supplier_id);
  const warehouseCounts = countBy((row) => row.warehouse_id);
  const waitingCount = rows.filter((row) => RECEIVABLE_STATUSES.includes(row.status)).length;
  const today = new Date(new Date().toDateString()).getTime();
  const isLate = (row: SupplierDeliveryDetail) => RECEIVABLE_STATUSES.includes(row.status) && Boolean(row.expected_delivery_date) && new Date(row.expected_delivery_date!).getTime() < today;
  const lateCount = rows.filter(isLate).length;
  const lede = loading
    ? "Hóa đơn, phiếu giao hàng, giao lại và phiếu nhận nháp."
    : rows.length === 0
      ? "Chưa có hóa đơn giao hàng nào từ nhà cung cấp."
      : waitingCount > 0
        ? `${waitingCount} hóa đơn chờ nhận hàng${[
            statusCounts.get("SUBMITTED") ? `${statusCounts.get("SUBMITTED")} chưa nhận` : null,
            statusCounts.get("PARTIALLY_RECEIVED") ? `${statusCounts.get("PARTIALLY_RECEIVED")} nhận một phần` : null,
          ].filter(Boolean).length ? ` (${[
            statusCounts.get("SUBMITTED") ? `${statusCounts.get("SUBMITTED")} chưa nhận` : null,
            statusCounts.get("PARTIALLY_RECEIVED") ? `${statusCounts.get("PARTIALLY_RECEIVED")} nhận một phần` : null,
          ].filter(Boolean).join(", ")})` : ""}${lateCount ? `, ${lateCount} đã quá ngày dự kiến` : ""}. ${statusCounts.get("RECEIVED") ?? 0} hóa đơn đã nhận đủ.`
        : `Không còn hóa đơn nào chờ nhận. ${statusCounts.get("RECEIVED") ?? 0} hóa đơn đã nhận đủ.`;
  const activeStatusLabel = status === "ALL" ? "Tất cả hóa đơn" : supplierDeliveryStatusLabel(status);
  const hasFilters = status !== "ALL" || Boolean(supplierId) || Boolean(warehouseId) || search.trim() !== "";
  const clearFilters = () => { setStatus("ALL"); setSupplierId(""); setWarehouseId(""); setSearch(""); };

  const railButton = (active: boolean, onClick: () => void, label: string, count: number, attention = false) => (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
        active ? "bg-primary/[0.08] text-primary" : "text-foreground hover:bg-muted/60",
      )}
    >
      <span className={cn("min-w-0 truncate text-[13px]", active ? "font-semibold" : "font-medium")} title={label}>{label}</span>
      <span
        className={cn(
          "min-w-6 shrink-0 rounded-full px-1.5 text-center text-[12px] tabular-nums",
          attention && count > 0 ? "bg-amber-100 font-semibold text-amber-800 dark:bg-amber-500/15 dark:text-amber-300" : active ? "text-primary" : "text-muted-foreground",
        )}
      >
        {loading ? "–" : count}
      </span>
    </button>
  );
  // Suppliers and warehouses that actually have deliveries, most deliveries first.
  const railSuppliers = suppliers.filter((s) => supplierCounts.has(s.id)).sort((a, b) => (supplierCounts.get(b.id) ?? 0) - (supplierCounts.get(a.id) ?? 0));
  const railWarehouses = warehouses.filter((w) => warehouseCounts.has(w.id)).sort((a, b) => (warehouseCounts.get(b.id) ?? 0) - (warehouseCounts.get(a.id) ?? 0));

  return (
    <PageWrapper className="space-y-6">
      <FadeItem>
        <PageHeader
          icon={Truck}
          title="Giao hàng nhà cung cấp"
          description={lede}
          actions={
            <Button variant="outline" size="sm" onClick={() => void load()} loading={loading}>
              <RefreshCw className="h-3.5 w-3.5" /> Làm mới
            </Button>
          }
        />
      </FadeItem>

      <FadeItem>
        {/* Named so the toolbar inside the list (its own container) can still ask whether the rail is showing. */}
        <div className="@container/page">
          <div className="grid grid-cols-1 items-start gap-4 @4xl/page:grid-cols-[232px_minmax(0,1fr)]">
            <nav aria-label="Lọc giao hàng" className="hidden max-h-[calc(100vh-7rem)] overflow-y-auto rounded-2xl border border-border bg-card p-3 @4xl/page:sticky @4xl/page:top-4 @4xl/page:block">
              <p className="px-3 pb-1.5 text-[12px] font-semibold text-muted-foreground">Trạng thái</p>
              <div role="group" aria-label="Lọc theo trạng thái">
                {STATUS_OPTIONS.map((option) => (
                  <div key={option.value}>
                    {railButton(status === option.value, () => setStatus(option.value), option.label, option.value === "ALL" ? rows.length : statusCounts.get(option.value) ?? 0, RECEIVABLE_STATUSES.includes(option.value))}
                  </div>
                ))}
              </div>
              {railSuppliers.length > 0 && (
                <div className="mt-3 border-t border-border pt-3" role="group" aria-label="Lọc theo nhà cung cấp">
                  <p className="px-3 pb-1.5 text-[12px] font-semibold text-muted-foreground">Nhà cung cấp</p>
                  {railButton(!supplierId, () => setSupplierId(""), "Tất cả nhà cung cấp", rows.length)}
                  {railSuppliers.map((s) => <div key={s.id}>{railButton(supplierId === s.id, () => setSupplierId(s.id), s.name, supplierCounts.get(s.id) ?? 0)}</div>)}
                </div>
              )}
              {railWarehouses.length > 0 && (
                <div className="mt-3 border-t border-border pt-3" role="group" aria-label="Lọc theo kho nhận">
                  <p className="px-3 pb-1.5 text-[12px] font-semibold text-muted-foreground">Kho nhận</p>
                  {railButton(!warehouseId, () => setWarehouseId(""), "Tất cả kho", rows.length)}
                  {railWarehouses.map((w) => <div key={w.id}>{railButton(warehouseId === w.id, () => setWarehouseId(w.id), `${w.code}, ${w.name}`, warehouseCounts.get(w.id) ?? 0)}</div>)}
                </div>
              )}
            </nav>
            <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:thin] @4xl/page:hidden" role="group" aria-label="Lọc theo trạng thái">
              {STATUS_OPTIONS.map((option) => {
                const active = status === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setStatus(option.value)}
                    aria-pressed={active}
                    className={cn(
                      "flex shrink-0 items-center gap-2 rounded-full border px-3.5 py-1.5 text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
                      active ? "border-primary/30 bg-primary/[0.08] font-semibold text-primary" : "border-border bg-card font-medium hover:bg-muted/60",
                    )}
                  >
                    <span className="whitespace-nowrap">{option.label}</span>
                    <span className="tabular-nums text-muted-foreground">{loading ? "–" : option.value === "ALL" ? rows.length : statusCounts.get(option.value) ?? 0}</span>
                  </button>
                );
              })}
            </div>

            <section aria-label="Danh sách hóa đơn giao hàng" className="@container min-w-0 overflow-hidden rounded-2xl border border-border bg-card">
              <div className="px-5 pb-1 pt-4">
                <h2 className="font-display text-[18px] font-semibold tracking-tight">{activeStatusLabel}</h2>
                <p className="mt-0.5 text-[13px] text-muted-foreground">Mới nhất ở trên. Mở hóa đơn để đối chiếu với PO và giao kiểm đếm.</p>
              </div>
              <div className="border-b border-border px-4 py-3">
                <FilterBar
                  searchValue={search}
                  onSearchChange={setSearch}
                  searchPlaceholder="Tìm hóa đơn, PO, nhà cung cấp, kho..."
                  showSearchClear
                  filters={
                    <>
                      {/* The rail lists suppliers and warehouses on wide screens; here they are selects. */}
                      <div className="flex flex-wrap gap-2 @4xl/page:hidden">
                        <Select value={supplierId || "__all__"} onValueChange={(v) => setSupplierId(v === "__all__" ? "" : v)}>
                          <SelectTrigger size="sm" className="w-[180px]" aria-label="Nhà cung cấp">
                            <SelectValue placeholder="Tất cả nhà cung cấp" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__all__">Tất cả nhà cung cấp</SelectItem>
                            {suppliers.map((supplier) => <SelectItem key={supplier.id} value={supplier.id}>{supplier.name}</SelectItem>)}
                          </SelectContent>
                        </Select>
                        <Select value={warehouseId || "__all__"} onValueChange={(v) => setWarehouseId(v === "__all__" ? "" : v)}>
                          <SelectTrigger size="sm" className="w-[180px]" aria-label="Kho nhận">
                            <SelectValue placeholder="Tất cả kho" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__all__">Tất cả kho</SelectItem>
                            {warehouses.map((warehouse) => <SelectItem key={warehouse.id} value={warehouse.id}>{warehouse.code}, {warehouse.name}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                      {hasFilters && (
                        <Button variant="ghost" size="sm" onClick={clearFilters} className="text-muted-foreground">
                          <X className="h-3.5 w-3.5" />Xóa lọc
                        </Button>
                      )}
                    </>
                  }
                />
              </div>

              {loading ? (
                <RowsSkeleton rows={6} />
              ) : pagedRows.length === 0 ? (
                <div className="px-5 py-12">
                  <EmptyState
                    variant={rows.length === 0 ? "no-data" : "no-results"}
                    title={rows.length === 0 ? "Chưa có giao hàng" : "Không tìm thấy hóa đơn phù hợp"}
                    description={rows.length === 0 ? "Hóa đơn và phiếu giao hàng từ nhà cung cấp sẽ hiển thị ở đây." : "Thử đổi từ khóa hoặc bộ lọc."}
                  />
                </div>
              ) : (
                <Table className="table-fixed">
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="pl-5 text-[12px] font-normal text-muted-foreground">Hóa đơn</TableHead>
                      <TableHead className="hidden w-[200px] text-[12px] font-normal text-muted-foreground @3xl:table-cell">Sách</TableHead>
                      <TableHead className="hidden w-[120px] text-[12px] font-normal text-muted-foreground @2xl:table-cell">Đã nhận</TableHead>
                      <TableHead className="hidden w-[104px] text-[12px] font-normal text-muted-foreground @4xl:table-cell">Dự kiến giao</TableHead>
                      <TableHead className="w-[124px] pr-5 text-right @2xl:w-[150px] text-[12px] font-normal text-muted-foreground">Trạng thái</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pagedRows.map((row) => {
                      const totalQty = row.items.reduce((sum, item) => sum + Number(item.invoiced_qty || 0), 0);
                      const acceptedQty = row.items.reduce((sum, item) => sum + Number(item.accepted_qty || 0), 0);
                      const receivedPct = totalQty > 0 ? Math.min(100, Math.round((acceptedQty / totalQty) * 100)) : 0;
                      const canReceive = RECEIVABLE_STATUSES.includes(row.status);
                      const late = isLate(row);
                      const firstTitle = row.items[0]?.title;
                      const books = firstTitle ? `${firstTitle}${row.items.length > 1 ? ` và ${row.items.length - 1} sách khác` : ""}` : `${row.items.length} mục hàng`;
                      return (
                        <TableRow key={row.id} className="hover:bg-muted/30">
                          <TableCell className="whitespace-normal py-3.5 pl-5 pr-3 align-top">
                            <NavLink to={`/supplier-deliveries/${row.id}`} title={row.invoice_number} className="block truncate font-mono text-[13px] font-semibold text-primary underline-offset-2 hover:underline">{row.invoice_number}</NavLink>
                            <p className="mt-0.5 truncate text-[13px] text-foreground" title={row.supplier_name || undefined}>{row.supplier_name || "-"}</p>
                            <p className="text-[12px] text-muted-foreground">
                              {[row.warehouse_code || row.warehouse_name, row.invoice_date ? `HĐ ngày ${formatDate(row.invoice_date)}` : null].filter(Boolean).join(", ")}
                            </p>
                            <p className="break-all text-[12px] text-muted-foreground">
                              {row.delivery_number ? <span className="font-mono">{row.delivery_number}</span> : null}
                              {row.delivery_number && row.purchase_order_id ? ", " : null}
                              {row.purchase_order_id ? (
                                <NavLink to={`/purchase-orders/${row.purchase_order_id}`} className="font-mono text-primary underline-offset-2 hover:underline">{row.po_number || row.purchase_order_id}</NavLink>
                              ) : null}
                            </p>
                            {/* Columns the container hides move here, so no field is dropped. */}
                            <p className="mt-1 line-clamp-2 text-[13px] text-foreground/80 @3xl:hidden" title={books}>{books}</p>
                            <p className="mt-1 text-[12px] tabular-nums text-muted-foreground @2xl:hidden">Đã nhận <span className="font-semibold text-foreground">{acceptedQty}</span>/{totalQty} cuốn</p>
                            {row.expected_delivery_date ? (
                              <p className={cn("text-[12px] tabular-nums @4xl:hidden", late ? "font-medium text-amber-800 dark:text-amber-300" : "text-muted-foreground")}>Dự kiến {formatDate(row.expected_delivery_date)}{late ? ", đã quá hạn" : ""}</p>
                            ) : null}
                          </TableCell>
                          <TableCell className="hidden whitespace-normal py-3.5 align-top @3xl:table-cell">
                            <p className="line-clamp-2 text-[13px] text-foreground" title={books}>{books}</p>
                          </TableCell>
                          <TableCell className="hidden py-3.5 align-top @2xl:table-cell">
                            <p className="text-[13px] tabular-nums"><span className="font-semibold">{acceptedQty}</span><span className="text-muted-foreground"> / {totalQty} cuốn</span></p>
                            <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-primary/10" role="img" aria-label={`Đã nhận ${receivedPct}%`}>
                              <div className="h-full rounded-full bg-primary" style={{ width: `${receivedPct}%` }} />
                            </div>
                          </TableCell>
                          <TableCell className={cn("hidden py-3.5 align-top text-[13px] tabular-nums @4xl:table-cell", late ? "font-medium text-amber-800 dark:text-amber-300" : "text-muted-foreground")}>
                            {formatDate(row.expected_delivery_date)}
                            {late ? <span className="block text-[12px]">Quá hạn</span> : null}
                          </TableCell>
                          <TableCell className="py-3.5 pr-5 text-right align-top">
                            <div className="flex flex-col items-end gap-2">
                              <StatusBadge label={supplierDeliveryStatusLabel(row.status)} variant={getStatusVariant("purchaseOrder", row.status)} dot />
                              {canReceive ? (
                                <Button size="sm" className="h-9 sm:h-8" onClick={() => navigate(`/supplier-deliveries/${row.id}`)}>
                                  <ClipboardCheck className="h-3.5 w-3.5" /> Nhận hàng
                                </Button>
                              ) : null}
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}

              {!loading && filteredRows.length > 0 && (
                <div className="flex flex-col gap-3 border-t border-border px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <span className="text-[13px] text-muted-foreground">
                    Hiển thị <span className="font-medium tabular-nums text-foreground">{(page - 1) * PAGE_SIZE + 1}–{(page - 1) * PAGE_SIZE + pagedRows.length}</span> trong {filteredRows.length} hóa đơn
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
              )}
            </section>
          </div>
        </div>
      </FadeItem>
    </PageWrapper>
  );
}

function SupplierDeliveryDetailView({ id }: { id: string }) {
  const navigate = useNavigate();
  const [invoice, setInvoice] = useState<SupplierDeliveryDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState("");
  const [warehouseStaff, setWarehouseStaff] = useState<WarehouseStaffOption[]>([]);
  const [selectedStaffId, setSelectedStaffId] = useState("");

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const response = await supplierDeliveryService.getById(id);
      setInvoice(response.data);
      setNote(`Nhận hàng theo hóa đơn NCC ${response.data.invoice_number}`);
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Không tải được chi tiết giao hàng"));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    userService.getWarehouseStaff()
      .then((res) => setWarehouseStaff(Array.isArray(res.data) ? res.data : []))
      .catch(() => {});
  }, []);

  // What each line will actually receive: never more than the PO still owes, never more than invoiced.
  const lines = useMemo(() => (invoice?.items || []).map((item) => {
    const invoiced = Number(item.invoiced_qty || 0);
    const remaining = Number(item.remaining_qty || 0);
    const willReceive = Math.min(invoiced, remaining);
    return { item, invoiced, remaining, willReceive, over: Math.max(0, invoiced - remaining), short: Math.max(0, remaining - invoiced) };
  }), [invoice]);

  const totals = useMemo(() => lines.reduce(
    (acc, line) => ({
      planned: acc.planned + line.willReceive,
      amount: acc.amount + line.willReceive * Number(line.item.unit_cost || 0),
      over: acc.over + line.over,
      short: acc.short + line.short,
    }),
    { planned: 0, amount: 0, over: 0, short: 0 },
  ), [lines]);

  const canReceive = invoice ? RECEIVABLE_STATUSES.includes(invoice.status) : false;

  const createAndAssign = async () => {
    if (!invoice) return;
    if (!selectedStaffId) return toast.error("Vui lòng chọn nhân viên kho để giao phiếu");

    const items = lines
      .map(({ item, willReceive, over }) => ({
        invoice_item_id: item.id,
        purchase_order_item_id: item.purchase_order_item_id,
        variant_id: item.variant_id,
        delivered_qty: willReceive,
        unit_cost: item.unit_cost,
        location_id: null,
        note: over > 0 ? "Số lượng hóa đơn vượt PO còn lại" : null,
      }))
      .filter((item) => item.delivered_qty > 0);

    if (items.length === 0) return toast.error("Không có mục hàng nào để tạo phiếu");

    try {
      setSaving(true);
      const response = await supplierDeliveryService.createGoodsReceiptFromInvoice(invoice.id, {
        warehouse_id: invoice.warehouse_id || "",
        note,
        items,
      });
      const receiptId = response.data.id;
      const receiptNumber = response.data.receipt_number;
      await goodsReceiptService.assign(receiptId, selectedStaffId);
      const staff = warehouseStaff.find((s) => s.id === selectedStaffId);
      toast.success(`Đã tạo phiếu ${receiptNumber} và giao cho ${staff?.full_name || staff?.username || "nhân viên"}`);
      navigate(`/orders/${receiptId}`);
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Tạo và giao phiếu thất bại"));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <PageWrapper><LoadingOverlay /></PageWrapper>;
  }

  if (!invoice) {
    return (
      <PageWrapper>
        <EmptyState variant="no-data" title="Không tìm thấy hóa đơn giao hàng" description="Hóa đơn này có thể đã bị xóa." />
      </PageWrapper>
    );
  }

  const facts: Array<{ label: string; value: ReactNode }> = [
    { label: "Nhà cung cấp", value: invoice.supplier_name || "-" },
    { label: "Kho nhận", value: invoice.warehouse_name ? `${invoice.warehouse_name}${invoice.warehouse_code ? ` (${invoice.warehouse_code})` : ""}` : invoice.warehouse_code || "-" },
    {
      label: "Đơn đặt hàng",
      value: invoice.purchase_order_id
        ? <NavLink to={`/purchase-orders/${invoice.purchase_order_id}`} className="font-mono text-primary underline-offset-2 hover:underline">{invoice.po_number || invoice.purchase_order_id}</NavLink>
        : "-",
    },
    { label: "Phiếu giao", value: invoice.delivery_number ? <span className="font-mono">{invoice.delivery_number}</span> : "-" },
    { label: "Ngày hóa đơn", value: formatDate(invoice.invoice_date) },
    { label: "Dự kiến giao", value: formatDate(invoice.expected_delivery_date) },
  ];
  const invoicedTotal = lines.reduce((sum, line) => sum + line.invoiced, 0);

  return (
    <PageWrapper className="space-y-5">
      <FadeItem>
        <header className="space-y-3">
          <NavLink to="/supplier-deliveries" className="-ml-1 inline-flex items-center gap-1.5 rounded px-1 text-[13px] text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" /> Giao hàng nhà cung cấp
          </NavLink>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[13px] text-muted-foreground">Hóa đơn nhà cung cấp</p>
              <div className="mt-0.5 flex flex-wrap items-center gap-2.5">
                <h1 className="break-all font-mono text-[22px] font-semibold tracking-tight text-foreground">{invoice.invoice_number}</h1>
                <StatusBadge label={supplierDeliveryStatusLabel(invoice.status)} variant={getStatusVariant("purchaseOrder", invoice.status)} dot />
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={() => void load()} loading={loading}>
              <RefreshCw className="h-3.5 w-3.5" /> Làm mới
            </Button>
          </div>
        </header>
      </FadeItem>

      <FadeItem>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 rounded-2xl border border-border bg-card p-5 sm:grid-cols-3 lg:grid-cols-6">
          {facts.map((fact) => (
            <div key={fact.label} className="min-w-0">
              <dt className="text-[12px] text-muted-foreground">{fact.label}</dt>
              <dd className="mt-0.5 break-words text-[13px] text-foreground">{fact.value}</dd>
            </div>
          ))}
          {invoice.supplier_note ? (
            <div className="col-span-full border-t border-border pt-3">
              <dt className="text-[12px] text-muted-foreground">Ghi chú của nhà cung cấp</dt>
              <dd className="mt-0.5 max-w-prose whitespace-pre-line text-[13px] text-foreground">{invoice.supplier_note}</dd>
            </div>
          ) : null}
        </dl>
      </FadeItem>

      <FadeItem>
        <dl className="grid grid-cols-1 divide-y divide-border rounded-2xl border border-border bg-card sm:grid-cols-3 sm:divide-x sm:divide-y-0">
          <div className="p-5">
            <dt className="text-[13px] text-muted-foreground">Sẽ nhận vào kho, cuốn</dt>
            <dd className="mt-1 font-display text-[30px] font-semibold leading-none tabular-nums text-foreground">{totals.planned.toLocaleString("vi-VN")}</dd>
            <dd className="mt-2 text-[12px] text-muted-foreground">Trên {invoicedTotal.toLocaleString("vi-VN")} cuốn nhà cung cấp giao.</dd>
          </div>
          <div className="p-5">
            <dt className="text-[13px] text-muted-foreground">Giá trị ước tính</dt>
            <dd className="mt-1 font-display text-[30px] font-semibold leading-none tabular-nums text-foreground">{totals.amount.toLocaleString("vi-VN")}</dd>
            <dd className="mt-2 text-[12px] text-muted-foreground">VND, theo giá vốn trên hóa đơn.</dd>
          </div>
          <div className="p-5">
            <dt className="text-[13px] text-muted-foreground">Lệch so với PO, cuốn</dt>
            <dd className={cn("mt-1 font-display text-[30px] font-semibold leading-none tabular-nums", totals.over > 0 ? "text-red-700 dark:text-red-400" : totals.short > 0 ? "text-amber-700 dark:text-amber-300" : "text-foreground")}>
              {totals.over > 0 ? `+${totals.over}` : totals.short > 0 ? `−${totals.short}` : "0"}
            </dd>
            <dd className="mt-2 text-[12px] text-muted-foreground">{totals.over > 0 ? "Giao vượt, phần vượt không nhập kho." : totals.short > 0 ? "Giao thiếu, PO còn chờ phần thiếu." : "Khớp số PO còn lại."}</dd>
          </div>
        </dl>
      </FadeItem>

      <FadeItem>
        <section aria-labelledby="reconcile-title" className="@container overflow-hidden rounded-2xl border border-border bg-card">
          <div className="px-5 pb-3 pt-4">
            <h2 id="reconcile-title" className="font-display text-[18px] font-semibold tracking-tight">Đối chiếu hóa đơn với PO</h2>
            <p className="mt-0.5 text-[13px] text-muted-foreground">Mỗi dòng nhận tối đa số PO còn lại và không quá số nhà cung cấp giao.</p>
          </div>
          <Table className="table-fixed">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="pl-5 text-[12px] font-normal text-muted-foreground">Sách</TableHead>
                <TableHead className="hidden w-[96px] text-right text-[12px] font-normal text-muted-foreground @3xl:table-cell">Đặt trên PO</TableHead>
                <TableHead className="hidden w-[104px] text-right text-[12px] font-normal text-muted-foreground @3xl:table-cell">Đã nhận trước</TableHead>
                <TableHead className="hidden w-[96px] text-right text-[12px] font-normal text-muted-foreground @2xl:table-cell">PO còn lại</TableHead>
                <TableHead className="w-[80px] text-right text-[12px] font-normal text-muted-foreground">NCC giao</TableHead>
                <TableHead className="w-[80px] text-right text-[12px] font-normal text-muted-foreground">Sẽ nhận</TableHead>
                <TableHead className="hidden w-[200px] pr-5 text-[12px] font-normal text-muted-foreground @4xl:table-cell">Chênh lệch</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lines.map(({ item, invoiced, remaining, willReceive, over, short }) => {
                const gap = over > 0
                  ? { label: `Giao vượt ${over}`, variant: "danger" as const, hint: `${over} cuốn vượt PO sẽ không nhập kho` }
                  : short > 0
                    ? { label: `Giao thiếu ${short}`, variant: "warning" as const, hint: `PO vẫn chờ ${short} cuốn sau lần giao này` }
                    : { label: "Khớp PO", variant: "success" as const, hint: null };
                return (
                  <TableRow key={item.id} className="hover:bg-muted/30">
                    <TableCell className="whitespace-normal py-3 pl-5 pr-3 align-top">
                      <p className="line-clamp-2 text-[14px] font-medium text-foreground" title={item.title || undefined}>{item.title || "-"}</p>
                      <p className="font-mono text-[12px] text-muted-foreground">{item.isbn13 || item.sku || item.variant_id}</p>
                      {/* Columns the container hides move here, so no field is dropped. */}
                      <p className="mt-1 text-[12px] tabular-nums text-muted-foreground @3xl:hidden">
                        PO đặt {item.ordered_qty}, đã nhận trước {item.previously_received_qty}<span className="@2xl:hidden">, còn lại {remaining}</span>
                      </p>
                      <div className="mt-1.5 @4xl:hidden">
                        <StatusBadge label={gap.label} variant={gap.variant} />
                        {gap.hint ? <p className="mt-1 text-[12px] leading-4 text-muted-foreground">{gap.hint}</p> : null}
                      </div>
                    </TableCell>
                    <TableCell className="hidden py-3 text-right align-top text-[13px] tabular-nums text-muted-foreground @3xl:table-cell">{item.ordered_qty}</TableCell>
                    <TableCell className="hidden py-3 text-right align-top text-[13px] tabular-nums text-muted-foreground @3xl:table-cell">{item.previously_received_qty}</TableCell>
                    <TableCell className="hidden py-3 text-right align-top text-[13px] tabular-nums @2xl:table-cell">{remaining}</TableCell>
                    <TableCell className="py-3 text-right align-top text-[13px] font-medium tabular-nums">{invoiced}</TableCell>
                    <TableCell className="py-3 text-right align-top text-[15px] font-semibold tabular-nums text-foreground">{willReceive}</TableCell>
                    <TableCell className="hidden whitespace-normal py-3 pr-5 align-top @4xl:table-cell">
                      <StatusBadge label={gap.label} variant={gap.variant} />
                      {gap.hint ? <p className="mt-1 text-[12px] leading-4 text-muted-foreground">{gap.hint}</p> : null}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          {totals.over > 0 || totals.short > 0 ? (
            <div className="space-y-2 border-t border-border px-5 py-3.5 text-[13px]">
              {totals.over > 0 ? (
                <p className="flex items-start gap-2 text-foreground">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-700 dark:text-red-400" aria-hidden="true" />
                  NCC giao vượt {totals.over} cuốn so với số PO còn lại. Phiếu nhập chỉ nhận tối đa số còn lại trên PO; phần vượt không được nhập kho.
                </p>
              ) : null}
              {totals.short > 0 ? (
                <p className="flex items-start gap-2 text-foreground">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700 dark:text-amber-300" aria-hidden="true" />
                  Hóa đơn này giao thiếu {totals.short} cuốn so với PO còn lại. Phần thiếu vẫn mở trên PO để nhận ở lần giao sau.
                </p>
              ) : null}
            </div>
          ) : null}
        </section>
      </FadeItem>

      <FadeItem>
        {canReceive ? (
          <section aria-labelledby="assign-title" className="rounded-2xl border border-border bg-card p-5">
            <h2 id="assign-title" className="font-display text-[18px] font-semibold tracking-tight">Giao kiểm đếm cho nhân viên kho</h2>
            <p className="mt-1 max-w-[70ch] text-[13px] text-muted-foreground">
              Hệ thống tạo phiếu nhập nháp với số "Sẽ nhận" ở trên. Nhân viên kho đếm thực tế trên phiếu; tồn kho chỉ tăng khi quản lý duyệt phiếu.
            </p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="assign-staff" className="mb-1.5 block text-[13px] font-medium text-foreground">Nhân viên kiểm đếm</label>
                <Select value={selectedStaffId || "none"} onValueChange={(v) => setSelectedStaffId(v === "none" ? "" : v)}>
                  <SelectTrigger id="assign-staff" className="w-full" data-testid="goods-receipt-assign-staff-select">
                    <SelectValue placeholder="Chọn nhân viên kho" />
                  </SelectTrigger>
                  <SelectContent>
                    {warehouseStaff.map((staff) => (
                      <SelectItem key={staff.id} value={staff.id}>{staff.full_name || staff.username || staff.email}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label htmlFor="receipt-note" className="mb-1.5 block text-[13px] font-medium text-foreground">Ghi chú phiếu nhập</label>
                <Input id="receipt-note" type="text" value={note} onChange={(e) => setNote(e.target.value)} />
              </div>
            </div>
            <div className="mt-4 flex flex-wrap items-center justify-end gap-3">
              {!selectedStaffId ? <p className="text-[12px] text-muted-foreground">Chọn nhân viên để tạo phiếu.</p> : null}
              <Button onClick={() => void createAndAssign()} disabled={!selectedStaffId || totals.planned <= 0} loading={saving} data-testid="goods-receipt-submit">
                <UserCheck className="h-4 w-4" />
                Tạo phiếu nhập {totals.planned} cuốn và giao việc
              </Button>
            </div>
          </section>
        ) : (
          <p className="flex items-start gap-2 rounded-2xl border border-border bg-muted/30 px-5 py-4 text-[13px] text-muted-foreground">
            <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            Hóa đơn ở trạng thái "{supplierDeliveryStatusLabel(invoice.status)}" nên không tạo thêm phiếu nhập được.
          </p>
        )}
      </FadeItem>
    </PageWrapper>
  );
}
