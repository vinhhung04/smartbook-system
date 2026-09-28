import { useCallback, useEffect, useMemo, useState } from "react";
import { NavLink, useNavigate, useParams } from "react-router";
import { AlertCircle, ArrowLeft, ClipboardCheck, Info, RefreshCw, Truck, UserCheck } from "lucide-react";
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
import { SectionCard } from "@/components/ui/section-card";
import { StatusBadge } from "@/components/status-badge";
import { PageHeader } from "@/components/ui/page-header";
import { LoadingOverlay, SkeletonTableRow } from "@/components/ui/loading-state";
import { FilterBar } from "@/components/ui/filter-bar";
import { SegmentedControl } from "@/components/ui/segmented-control";
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

function formatCurrency(value: number) {
  return `${Number(value || 0).toLocaleString("vi-VN")} VND`;
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

  const statusOptions = STATUS_OPTIONS.map((option) => ({
    value: option.value,
    label: `${option.label} (${option.value === "ALL" ? rows.length : rows.filter((row) => row.status === option.value).length})`,
  }));
  const waitingCount = rows.filter((row) => RECEIVABLE_STATUSES.includes(row.status)).length;

  return (
    <PageWrapper className="space-y-6">
      <FadeItem>
        <PageHeader
          icon={Truck}
          title="Giao hàng nhà cung cấp"
          description={waitingCount > 0 ? `${waitingCount} hóa đơn đang chờ nhận hàng` : "Hóa đơn, phiếu giao hàng, giao lại và phiếu nhận nháp"}
          iconBg="bg-gradient-to-br from-sky-100 to-blue-50 dark:from-sky-500/20 dark:to-blue-500/10"
          iconColor="text-sky-600 dark:text-sky-400"
          actions={
            <Button variant="outline" size="sm" onClick={() => void load()} loading={loading}>
              <RefreshCw className="h-3.5 w-3.5" /> Làm mới
            </Button>
          }
        />
      </FadeItem>

      <FadeItem>
        <div className="space-y-3">
          <FilterBar
            searchValue={search}
            onSearchChange={setSearch}
            searchPlaceholder="Tìm hóa đơn, PO, nhà cung cấp, kho..."
            showSearchClear
            filters={
              <>
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
                    {warehouses.map((warehouse) => <SelectItem key={warehouse.id} value={warehouse.id}>{warehouse.code} - {warehouse.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </>
            }
          />
          <div className="max-w-full overflow-x-auto">
            <SegmentedControl
              options={statusOptions}
              value={status}
              onChange={setStatus}
              layoutId="supplier-delivery-status"
              gradientClassName="from-sky-600 to-blue-600"
              className="w-max"
            />
          </div>
        </div>
      </FadeItem>

      <FadeItem>
        <SectionCard noPadding>
          <div className="overflow-x-auto">
            <Table className="table-fixed">
              <TableHeader>
                <TableRow className="bg-muted/30 hover:bg-muted/30">
                  {[
                    { label: "Hóa đơn", className: "" },
                    { label: "Đã nhận / SL", className: "hidden w-[150px] sm:table-cell" },
                    { label: "Dự kiến", className: "hidden w-[110px] md:table-cell" },
                    { label: "Trạng thái", className: "hidden w-[160px] sm:table-cell" },
                    { label: "Thao tác", className: "w-[130px] text-right" },
                  ].map((heading) => (
                    <TableHead key={heading.label} className={cn("px-4 text-[11px] uppercase tracking-wider text-muted-foreground", heading.className)}>{heading.label}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <SkeletonTableRow columns={5} rows={5} />
                ) : pagedRows.length === 0 ? (
                  <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={5} className="whitespace-normal py-12">
                      <EmptyState
                        variant={rows.length === 0 ? "no-data" : "no-results"}
                        title={rows.length === 0 ? "Chưa có giao hàng" : "Không tìm thấy hóa đơn phù hợp"}
                        description={rows.length === 0 ? "Hóa đơn và phiếu giao hàng từ nhà cung cấp sẽ hiển thị ở đây." : "Thử đổi từ khóa hoặc bộ lọc."}
                      />
                    </TableCell>
                  </TableRow>
                ) : pagedRows.map((row) => {
                  const totalQty = row.items.reduce((sum, item) => sum + Number(item.invoiced_qty || 0), 0);
                  const acceptedQty = row.items.reduce((sum, item) => sum + Number(item.accepted_qty || 0), 0);
                  const receivedPct = totalQty > 0 ? Math.min(100, Math.round((acceptedQty / totalQty) * 100)) : 0;
                  const canReceive = RECEIVABLE_STATUSES.includes(row.status);
                  const place = [row.supplier_name, row.warehouse_code || row.warehouse_name].filter(Boolean).join(" · ");
                  return (
                    <TableRow key={row.id}>
                      <TableCell className="px-4 py-3 align-top">
                        <NavLink to={`/supplier-deliveries/${row.id}`} title={row.invoice_number} className="block truncate text-[13px] font-semibold text-indigo-600 hover:text-indigo-800 dark:text-indigo-400 dark:hover:text-indigo-300">{row.invoice_number}</NavLink>
                        <p className="truncate text-[12px] text-muted-foreground" title={place || undefined}>{place || "-"}</p>
                        <p className="truncate text-[12px] text-muted-foreground">
                          {row.delivery_number ? `Giao ${row.delivery_number}` : null}
                          {row.delivery_number && row.purchase_order_id ? " · " : null}
                          {row.purchase_order_id ? (
                            <>PO <NavLink to={`/purchase-orders/${row.purchase_order_id}`} className="text-indigo-600 dark:text-indigo-400">{row.po_number || row.purchase_order_id}</NavLink></>
                          ) : null}
                        </p>
                        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 sm:hidden">
                          <StatusBadge label={supplierDeliveryStatusLabel(row.status)} variant={getStatusVariant("purchaseOrder", row.status)} dot />
                          <span className="text-[12px]"><span className="font-semibold">{acceptedQty}</span><span className="text-muted-foreground">/{totalQty}</span></span>
                        </div>
                      </TableCell>
                      <TableCell className="hidden px-4 py-3 align-top sm:table-cell">
                        <p className="text-[13px]"><span className="font-semibold">{acceptedQty}</span><span className="text-muted-foreground"> / {totalQty}</span></p>
                        <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-muted" role="img" aria-label={`Đã nhận ${receivedPct}%`}>
                          <div className="h-full rounded-full bg-emerald-500" style={{ width: `${receivedPct}%` }} />
                        </div>
                      </TableCell>
                      <TableCell className="hidden px-4 py-3 align-top text-[12px] text-muted-foreground md:table-cell">{formatDate(row.expected_delivery_date)}</TableCell>
                      <TableCell className="hidden px-4 py-3 align-top sm:table-cell"><StatusBadge label={supplierDeliveryStatusLabel(row.status)} variant={getStatusVariant("purchaseOrder", row.status)} dot /></TableCell>
                      <TableCell className="px-4 py-3 text-right align-top">
                        <Button size="sm" variant={canReceive ? "default" : "outline"} disabled={!canReceive} onClick={() => navigate(`/supplier-deliveries/${row.id}`)}>
                          <ClipboardCheck className="h-3.5 w-3.5" /> {canReceive ? "Nhận hàng" : "Đã đóng"}
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between px-5 py-3 border-t border-border text-[12px] text-muted-foreground">
              <span>Trang {page} / {totalPages}</span>
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
            </div>
          )}
        </SectionCard>
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

  const meta = [
    invoice.supplier_name,
    invoice.warehouse_code || invoice.warehouse_name ? `Kho ${invoice.warehouse_code || invoice.warehouse_name}` : null,
    invoice.expected_delivery_date ? `Dự kiến ${formatDate(invoice.expected_delivery_date)}` : null,
  ].filter(Boolean);

  return (
    <PageWrapper className="space-y-5">
      <FadeItem>
        <header className="space-y-3">
          <NavLink to="/supplier-deliveries" className="inline-flex items-center gap-1.5 text-[13px] font-medium text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Giao hàng nhà cung cấp
          </NavLink>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-[20px] font-semibold tracking-tight text-foreground">
                  Hóa đơn <span className="font-mono">{invoice.invoice_number}</span>
                </h1>
                <StatusBadge label={supplierDeliveryStatusLabel(invoice.status)} variant={getStatusVariant("purchaseOrder", invoice.status)} dot />
              </div>
              <p className="mt-1 text-[13px] text-muted-foreground">
                {meta.join(" · ")}
                {invoice.purchase_order_id ? (
                  <> · PO <NavLink to={`/purchase-orders/${invoice.purchase_order_id}`} className="font-mono text-indigo-600 hover:underline dark:text-indigo-400">{invoice.po_number || invoice.purchase_order_id}</NavLink></>
                ) : null}
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={() => void load()} loading={loading}>
              <RefreshCw className="h-3.5 w-3.5" /> Làm mới
            </Button>
          </div>
        </header>
      </FadeItem>

      <FadeItem>
        <section aria-labelledby="reconcile-title" className="overflow-hidden rounded-xl border border-border bg-card">
          <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-b border-border px-5 py-3.5">
            <h2 id="reconcile-title" className="text-[14px] font-semibold text-foreground">Đối chiếu hóa đơn với PO</h2>
            <p className="text-[13px] text-muted-foreground">
              Sẽ nhận <span className="font-semibold text-foreground">{totals.planned.toLocaleString("vi-VN")}</span> cuốn
              {totals.amount > 0 ? <> · ước tính <span className="font-semibold text-foreground">{formatCurrency(totals.amount)}</span></> : null}
            </p>
          </div>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/30 hover:bg-muted/30">
                  {[
                    { label: "Sách", className: "min-w-[220px]" },
                    { label: "Đặt trên PO", className: "text-right" },
                    { label: "Đã nhận trước", className: "text-right" },
                    { label: "PO còn lại", className: "text-right" },
                    { label: "NCC giao", className: "text-right" },
                    { label: "Sẽ nhận", className: "text-right" },
                    { label: "Chênh lệch", className: "" },
                  ].map((heading) => (
                    <TableHead key={heading.label} className={cn("px-4 text-[12px] font-medium text-muted-foreground", heading.className)}>{heading.label}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {lines.map(({ item, invoiced, remaining, willReceive, over, short }) => (
                  <TableRow key={item.id}>
                    <TableCell className="px-4 py-3 align-top">
                      <p className="max-w-[320px] truncate text-[13px] font-medium" title={item.title || undefined}>{item.title || "-"}</p>
                      <p className="font-mono text-[12px] text-muted-foreground">{item.isbn13 || item.sku || item.variant_id}</p>
                    </TableCell>
                    <TableCell className="px-4 py-3 text-right align-top text-[13px] tabular-nums text-muted-foreground">{item.ordered_qty}</TableCell>
                    <TableCell className="px-4 py-3 text-right align-top text-[13px] tabular-nums text-muted-foreground">{item.previously_received_qty}</TableCell>
                    <TableCell className="px-4 py-3 text-right align-top text-[13px] tabular-nums">{remaining}</TableCell>
                    <TableCell className="px-4 py-3 text-right align-top text-[13px] font-medium tabular-nums">{invoiced}</TableCell>
                    <TableCell className="px-4 py-3 text-right align-top text-[14px] font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">{willReceive}</TableCell>
                    <TableCell className="px-4 py-3 align-top">
                      {over > 0 ? (
                        <>
                          <StatusBadge label={`Giao vượt ${over}`} variant="danger" />
                          <p className="mt-1 max-w-[220px] text-[12px] leading-4 text-muted-foreground">{over} cuốn vượt PO sẽ không nhập kho</p>
                        </>
                      ) : short > 0 ? (
                        <>
                          <StatusBadge label={`Giao thiếu ${short}`} variant="warning" />
                          <p className="mt-1 max-w-[220px] text-[12px] leading-4 text-muted-foreground">PO vẫn chờ {short} cuốn sau lần giao này</p>
                        </>
                      ) : (
                        <StatusBadge label="Khớp PO" variant="success" />
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {totals.over > 0 || totals.short > 0 ? (
            <div className="space-y-2 border-t border-border px-5 py-3.5 text-[13px]">
              {totals.over > 0 ? (
                <p className="flex items-start gap-2 text-foreground">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-500" aria-hidden="true" />
                  NCC giao vượt {totals.over} cuốn so với số PO còn lại. Phiếu nhập chỉ nhận tối đa số còn lại trên PO; phần vượt không được nhập kho.
                </p>
              ) : null}
              {totals.short > 0 ? (
                <p className="flex items-start gap-2 text-foreground">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" aria-hidden="true" />
                  Hóa đơn này giao thiếu {totals.short} cuốn so với PO còn lại. Phần thiếu vẫn mở trên PO để nhận ở lần giao sau.
                </p>
              ) : null}
            </div>
          ) : null}
        </section>
      </FadeItem>

      <FadeItem>
        {canReceive ? (
          <section aria-labelledby="assign-title" className="rounded-xl border border-border bg-card p-5">
            <div className="flex items-start gap-3">
              <UserCheck className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
              <div>
                <h2 id="assign-title" className="text-[14px] font-semibold text-foreground">Giao kiểm đếm cho nhân viên kho</h2>
                <p className="mt-1 max-w-[70ch] text-[13px] text-muted-foreground">
                  Hệ thống tạo phiếu nhập nháp với số "Sẽ nhận" ở trên. Nhân viên kho đếm thực tế trên phiếu; tồn kho chỉ tăng khi quản lý duyệt phiếu.
                </p>
              </div>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="assign-staff" className="mb-1.5 block text-[12px] font-medium text-foreground">Nhân viên kiểm đếm</label>
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
                <label htmlFor="receipt-note" className="mb-1.5 block text-[12px] font-medium text-foreground">Ghi chú phiếu nhập</label>
                <Input id="receipt-note" type="text" value={note} onChange={(e) => setNote(e.target.value)} />
              </div>
            </div>
            <div className="mt-4 flex justify-end">
              <Button onClick={() => void createAndAssign()} disabled={!selectedStaffId || totals.planned <= 0} loading={saving} data-testid="goods-receipt-submit">
                <ClipboardCheck className="h-4 w-4" />
                Tạo phiếu nhập {totals.planned} cuốn và giao việc
              </Button>
            </div>
          </section>
        ) : (
          <p className="flex items-start gap-2 rounded-xl border border-border bg-muted/30 px-5 py-4 text-[13px] text-muted-foreground">
            <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            Hóa đơn ở trạng thái "{supplierDeliveryStatusLabel(invoice.status)}" nên không tạo thêm phiếu nhập được.
          </p>
        )}
      </FadeItem>
    </PageWrapper>
  );
}
