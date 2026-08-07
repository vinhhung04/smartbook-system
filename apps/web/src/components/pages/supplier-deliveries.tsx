import { useEffect, useMemo, useState } from "react";
import { NavLink, useNavigate, useParams } from "react-router";
import { AlertCircle, ArrowLeft, Boxes, ClipboardCheck, Clock, DollarSign, Info, PackageCheck, RefreshCw, Truck, UserCheck, Warehouse } from "lucide-react";
import { toast } from "sonner";
import { supplierDeliveryService, type SupplierDeliveryDetail } from "@/services/supplier-delivery";
import { goodsReceiptService } from "@/services/goods-receipt";
import { userService, type WarehouseStaffOption } from "@/services/user";
import { getApiErrorMessage } from "@/services/api";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { SectionCard } from "@/components/ui/section-card";
import { StatusBadge } from "@/components/status-badge";
import { PageHeader } from "@/components/ui/page-header";
import { LoadingOverlay, SkeletonCard, SkeletonTableRow } from "@/components/ui/loading-state";
import { StatCard } from "@/components/ui/stat-card";
import { FilterBar } from "@/components/ui/filter-bar";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";

function formatDate(value?: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString("vi-VN");
}

function formatCurrency(value: number) {
  return `${Number(value || 0).toLocaleString("vi-VN")} VND`;
}

function statusVariant(status: string) {
  if (["RECEIVED", "RESOLVED"].includes(status)) return "success";
  if (["SUBMITTED", "PARTIALLY_RECEIVED", "SHORTAGE_REPORTED"].includes(status)) return "warning";
  if (["CANCELLED", "REJECTED"].includes(status)) return "danger";
  return "neutral";
}

const STATUS_OPTIONS = [
  { value: "ALL", label: "Tất cả" },
  { value: "SUBMITTED", label: "Đã gửi" },
  { value: "PARTIALLY_RECEIVED", label: "Nhận một phần" },
  { value: "SHORTAGE_REPORTED", label: "Báo thiếu hàng" },
  { value: "RECEIVED", label: "Đã nhận" },
  { value: "CANCELLED", label: "Đã hủy" },
];

export function SupplierDeliveriesPage() {
  const { id } = useParams();
  return id ? <SupplierDeliveryDetailView id={id} /> : <SupplierDeliveryListView />;
}

function SupplierDeliveryListView() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<SupplierDeliveryDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("ALL");
  const [search, setSearch] = useState("");

  const load = async () => {
    try {
      setLoading(true);
      const response = await supplierDeliveryService.getAll(status === "ALL" ? undefined : { status });
      setRows(Array.isArray(response.data) ? response.data : []);
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Không tải được danh sách giao hàng"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  const filteredRows = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return rows;
    return rows.filter((row) =>
      [row.invoice_number, row.delivery_number, row.po_number, row.supplier_name, row.warehouse_name, row.warehouse_code]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query)),
    );
  }, [rows, search]);

  const summary = useMemo(() => {
    const canReceiveCount = rows.filter((row) => ["SUBMITTED", "PARTIALLY_RECEIVED", "SHORTAGE_REPORTED"].includes(row.status)).length;
    const receivedCount = rows.filter((row) => row.status === "RECEIVED").length;
    const shortageCount = rows.filter((row) => row.status === "SHORTAGE_REPORTED").length;
    return { total: rows.length, canReceiveCount, receivedCount, shortageCount };
  }, [rows]);

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
      <PageHeader
        icon={Truck}
        title="Giao hàng nhà cung cấp"
        description="Hóa đơn, phiếu giao hàng, giao lại và phiếu nhận nháp"
        iconBg="bg-gradient-to-br from-sky-100 to-blue-50 dark:from-sky-500/20 dark:to-blue-500/10"
        iconColor="text-sky-600 dark:text-sky-400"
        actions={
          <Button variant="outline" size="sm" onClick={() => void load()} loading={loading}>
            <RefreshCw className="h-3.5 w-3.5" /> Làm mới
          </Button>
        }
      />

      {!loading && rows.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard label="Tổng hóa đơn" value={summary.total} icon={Boxes} variant="primary" animateValue />
          <StatCard label="Chờ nhận hàng" value={summary.canReceiveCount} icon={Clock} variant="warning" animateValue />
          <StatCard label="Đã nhận" value={summary.receivedCount} icon={PackageCheck} variant="success" animateValue />
          <StatCard label="Báo thiếu hàng" value={summary.shortageCount} icon={AlertCircle} variant="danger" animateValue />
        </div>
      )}

      <SectionCard>
        <FilterBar
          searchValue={search}
          onSearchChange={setSearch}
          searchPlaceholder="Tìm hóa đơn, PO, nhà cung cấp, kho..."
          filters={
            <SegmentedControl
              options={STATUS_OPTIONS}
              value={status}
              onChange={setStatus}
              layoutId="supplier-delivery-status"
              gradientClassName="from-sky-600 to-blue-600"
              className="overflow-x-auto"
            />
          }
        />
      </SectionCard>

      <SectionCard noPadding>
        {/* Mobile cards (< md) */}
        {loading ? (
          <div className="grid gap-3 p-4 sm:grid-cols-2 md:hidden">
            {Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} lines={2} />)}
          </div>
        ) : filteredRows.length === 0 ? (
          <div className="md:hidden">
            <EmptyState variant="no-data" title="Chưa có giao hàng" description="Hóa đơn và phiếu giao hàng từ nhà cung cấp sẽ hiển thị ở đây." className="py-12" />
          </div>
        ) : (
          <div className="grid gap-3 p-4 sm:grid-cols-2 md:hidden">
            {filteredRows.map((row) => {
              const totalQty = row.items.reduce((sum, item) => sum + Number(item.invoiced_qty || 0), 0);
              const acceptedQty = row.items.reduce((sum, item) => sum + Number(item.accepted_qty || 0), 0);
              const canReceive = ["SUBMITTED", "PARTIALLY_RECEIVED", "SHORTAGE_REPORTED"].includes(row.status);
              return (
                <div key={row.id} className="rounded-lg border border-border bg-card p-4 flex flex-col gap-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <NavLink to={`/supplier-deliveries/${row.id}`} className="block truncate text-[13px] font-semibold text-indigo-600 hover:text-indigo-800 dark:text-indigo-400 dark:hover:text-indigo-300">
                        {row.invoice_number}
                      </NavLink>
                      <p className="truncate text-[11px] text-muted-foreground">{row.delivery_number || "-"}</p>
                    </div>
                    <StatusBadge label={row.status} variant={statusVariant(row.status)} dot />
                  </div>
                  <p className="truncate text-[12px] text-muted-foreground">
                    {row.supplier_name || "-"} · {row.warehouse_code || row.warehouse_name || "-"}
                  </p>
                  {row.purchase_order_id && (
                    <p className="truncate text-[12px] text-muted-foreground">
                      PO: <NavLink to={`/purchase-orders/${row.purchase_order_id}`} className="text-indigo-600 dark:text-indigo-400">{row.po_number || row.purchase_order_id}</NavLink>
                    </p>
                  )}
                  <div className="flex items-center justify-between text-[12px]">
                    <span className="text-muted-foreground">Dự kiến {formatDate(row.expected_delivery_date)}</span>
                    <span><span className="font-semibold">{acceptedQty}</span><span className="text-muted-foreground">/{totalQty}</span></span>
                  </div>
                  <Button size="sm" variant={canReceive ? "default" : "outline"} disabled={!canReceive} onClick={() => navigate(`/supplier-deliveries/${row.id}`)} className="w-full">
                    <ClipboardCheck className="h-3.5 w-3.5" /> {canReceive ? "Nhận hàng" : "Đã đóng"}
                  </Button>
                </div>
              );
            })}
          </div>
        )}

        {/* Desktop table (>= md) */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                {["Hóa đơn", "PO", "NCC / Kho", "Dự kiến", "SL / Đã nhận", "Trạng thái", "Thao tác"].map((heading) => (
                  <th key={heading} className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground whitespace-nowrap">{heading}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <SkeletonTableRow columns={7} rows={5} />
              ) : filteredRows.length === 0 ? (
                <tr><td colSpan={7}><EmptyState variant="no-data" title="Chưa có giao hàng" description="Hóa đơn và phiếu giao hàng từ nhà cung cấp sẽ hiển thị ở đây." className="py-12" /></td></tr>
              ) : filteredRows.map((row) => {
                const totalQty = row.items.reduce((sum, item) => sum + Number(item.invoiced_qty || 0), 0);
                const acceptedQty = row.items.reduce((sum, item) => sum + Number(item.accepted_qty || 0), 0);
                const canReceive = ["SUBMITTED", "PARTIALLY_RECEIVED", "SHORTAGE_REPORTED"].includes(row.status);
                return (
                  <tr key={row.id} className="border-b border-border last:border-0 hover:bg-muted/30">
                    <td className="px-4 py-3.5 max-w-[170px]">
                      <NavLink to={`/supplier-deliveries/${row.id}`} title={row.invoice_number} className="block truncate text-[13px] font-semibold text-indigo-600 hover:text-indigo-800 dark:text-indigo-400 dark:hover:text-indigo-300">{row.invoice_number}</NavLink>
                      <div className="truncate text-[11px] text-muted-foreground" title={row.delivery_number || undefined}>{row.delivery_number || "-"}</div>
                    </td>
                    <td className="px-4 py-3.5 max-w-[150px]">
                      {row.purchase_order_id ? <NavLink to={`/purchase-orders/${row.purchase_order_id}`} title={row.po_number || row.purchase_order_id || undefined} className="block truncate text-[13px] text-indigo-600 dark:text-indigo-400">{row.po_number || row.purchase_order_id}</NavLink> : "-"}
                    </td>
                    <td className="px-4 py-3.5 max-w-[170px]">
                      <p className="truncate text-[13px] font-medium text-foreground" title={row.supplier_name || undefined}>{row.supplier_name || "-"}</p>
                      <p className="truncate text-[11px] text-muted-foreground" title={row.warehouse_name || undefined}>{row.warehouse_code || row.warehouse_name || "-"}</p>
                    </td>
                    <td className="px-4 py-3.5 text-[12px] text-muted-foreground whitespace-nowrap">{formatDate(row.expected_delivery_date)}</td>
                    <td className="px-4 py-3.5 text-[13px] whitespace-nowrap"><span className="font-semibold">{acceptedQty}</span><span className="text-muted-foreground">/{totalQty}</span></td>
                    <td className="px-4 py-3.5"><StatusBadge label={row.status} variant={statusVariant(row.status)} dot /></td>
                    <td className="px-4 py-3.5">
                      <Button size="sm" variant={canReceive ? "default" : "outline"} disabled={!canReceive} onClick={() => navigate(`/supplier-deliveries/${row.id}`)}>
                        <ClipboardCheck className="h-3.5 w-3.5" /> {canReceive ? "Nhận hàng" : "Đã đóng"}
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </SectionCard>
    </div>
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

  const load = async () => {
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
  };

  useEffect(() => { void load(); }, [id]);

  useEffect(() => {
    userService.getWarehouseStaff()
      .then((res) => setWarehouseStaff(Array.isArray(res.data) ? res.data : []))
      .catch(() => {});
  }, []);

  // Quantities are taken directly from invoice — staff will verify physically
  const totals = useMemo(() => {
    if (!invoice) return { planned: 0, amount: 0, shortage: 0 };
    return invoice.items.reduce(
      (acc, item) => {
        const qty = Math.min(Number(item.invoiced_qty || 0), Number(item.remaining_qty || 0));
        acc.planned += qty;
        acc.amount += qty * Number(item.unit_cost || 0);
        acc.shortage += Math.max(0, Number(item.invoiced_qty || 0) - Number(item.remaining_qty || 0));
        return acc;
      },
      { planned: 0, amount: 0, shortage: 0 },
    );
  }, [invoice]);

  const canReceive = invoice ? ["SUBMITTED", "PARTIALLY_RECEIVED", "SHORTAGE_REPORTED"].includes(invoice.status) : false;

  const createAndAssign = async () => {
    if (!invoice) return;
    if (!selectedStaffId) return toast.error("Vui lòng chọn nhân viên kho để giao phiếu");

    const items = invoice.items
      .map((item) => ({
        invoice_item_id: item.id,
        purchase_order_item_id: item.purchase_order_item_id,
        variant_id: item.variant_id,
        delivered_qty: Math.min(Number(item.invoiced_qty || 0), Number(item.remaining_qty || 0)),
        unit_cost: item.unit_cost,
        location_id: null,
        note: Number(item.invoiced_qty || 0) > Number(item.remaining_qty || 0) ? "Số lượng hóa đơn vượt PO còn lại" : null,
      }))
      .filter((item) => item.delivered_qty > 0);

    if (items.length === 0) return toast.error("Không có mục hàng nào để tạo phiếu");

    try {
      setSaving(true);
      // Step 1: Create draft goods receipt from invoice
      const response = await supplierDeliveryService.createGoodsReceiptFromInvoice(invoice.id, {
        warehouse_id: invoice.warehouse_id || "",
        note,
        items,
      });
      const receiptId = response.data.id;
      const receiptNumber = response.data.receipt_number;

      // Step 2: Assign to selected warehouse staff
      await goodsReceiptService.assign(receiptId, selectedStaffId);

      const staffName = warehouseStaff.find((s) => s.id === selectedStaffId)?.full_name
        || warehouseStaff.find((s) => s.id === selectedStaffId)?.username
        || "nhân viên";

      toast.success(`Đã tạo phiếu ${receiptNumber} và giao cho ${staffName}`);
      navigate(`/orders/${receiptId}`);
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Tạo và giao phiếu thất bại"));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="p-6 lg:p-8 max-w-7xl mx-auto"><LoadingOverlay /></div>;
  }

  if (!invoice) {
    return <div className="p-6 lg:p-8 max-w-7xl mx-auto"><EmptyState variant="no-data" title="Không tìm thấy phiếu giao hàng" description="Phiếu này có thể đã bị xóa." /></div>;
  }

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
      <div className="relative overflow-hidden rounded-xl border border-border bg-card p-4">
        <div className="absolute top-0 left-0 right-0 h-[3px] bg-gradient-to-r from-sky-500 to-blue-500" />
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-3 min-w-0">
            <Button variant="outline" size="sm" asChild>
              <NavLink to="/supplier-deliveries">
                <ArrowLeft className="h-3.5 w-3.5" /> Quay lại
              </NavLink>
            </Button>
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 bg-gradient-to-br from-sky-100 to-blue-50 dark:from-sky-500/20 dark:to-blue-500/10`}>
              <Truck className="w-[18px] h-[18px] text-sky-600 dark:text-sky-400" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-[15px] font-semibold tracking-tight">Phiếu xuất nhà cung cấp</h1>
                <StatusBadge label={invoice.status} variant={statusVariant(invoice.status)} dot />
              </div>
              <p className="mt-0.5 text-[12px] text-muted-foreground">
                {invoice.po_number || "-"} · {invoice.supplier_name || "-"} · Hóa đơn {invoice.invoice_number}
              </p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => void load()} loading={saving}>
            <RefreshCw className="h-3.5 w-3.5" /> Làm mới
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <StatCard label="Kho nhận" value={invoice.warehouse_code || invoice.warehouse_name || "-"} icon={Warehouse} variant="primary" />
        <StatCard label="Ngày giao dự kiến" value={formatDate(invoice.expected_delivery_date)} icon={Clock} variant="info" />
        <StatCard label="Số lượng sẽ nhận" value={totals.planned} icon={Boxes} variant="success" animateValue />
        <StatCard label="Giá trị ước tính" value={formatCurrency(totals.amount)} icon={DollarSign} variant="default" />
      </div>

      {/* Items from invoice — quantities auto-filled, staff will verify physically */}
      <SectionCard title="Danh sách hàng theo phiếu NCC" noPadding>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                {["Sách", "Lịch sử PO (đặt · đã nhận · còn lại)", "NCC xuất", "Sẽ nhận", "Trạng thái"].map((heading) => (
                  <th key={heading} className="px-5 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground whitespace-nowrap">{heading}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {invoice.items.map((item) => {
                const willReceive = Math.min(Number(item.invoiced_qty || 0), Number(item.remaining_qty || 0));
                const hasShortage = Number(item.invoiced_qty || 0) < Number(item.remaining_qty || 0);
                const overPo = Number(item.invoiced_qty || 0) > Number(item.remaining_qty || 0);
                const rowStatus = overPo ? "QUÁ PO" : hasShortage ? "THIẾU" : "ĐỦ";
                const rowVariant = overPo ? "danger" : hasShortage ? "warning" : "success";
                return (
                  <tr key={item.id} className="border-b border-border last:border-0 hover:bg-muted/20">
                    <td className="px-5 py-3.5 max-w-[220px]">
                      <p className="truncate text-[13px] font-semibold" title={item.title || undefined}>{item.title || "-"}</p>
                      <p className="truncate font-mono text-[11px] text-muted-foreground">{item.isbn13 || item.sku || item.variant_id}</p>
                    </td>
                    <td className="px-5 py-3.5 text-[12px] text-muted-foreground whitespace-nowrap">
                      {item.ordered_qty} · {item.previously_received_qty} · <span className="font-medium text-foreground">{item.remaining_qty}</span>
                    </td>
                    <td className="px-5 py-3.5 text-[13px] font-semibold text-indigo-700 dark:text-indigo-400 whitespace-nowrap">{item.invoiced_qty}</td>
                    <td className="px-5 py-3.5 whitespace-nowrap">
                      <span className="rounded-md bg-emerald-50 border border-emerald-200 px-2 py-1 text-[12px] font-semibold text-emerald-700 dark:bg-emerald-500/10 dark:border-emerald-500/20 dark:text-emerald-400">{willReceive}</span>
                    </td>
                    <td className="px-5 py-3.5"><StatusBadge label={rowStatus} variant={rowVariant} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </SectionCard>

      {totals.shortage > 0 && (
        <Alert className="border-amber-200 bg-amber-50 dark:border-amber-500/20 dark:bg-amber-500/10">
          <AlertCircle className="text-amber-600 dark:text-amber-400" />
          <AlertDescription className="text-amber-800 dark:text-amber-300">
            Một số mục NCC xuất ít hơn PO còn lại. Hệ thống sẽ tự tạo báo cáo thiếu hàng.
          </AlertDescription>
        </Alert>
      )}

      <Alert className="border-sky-100 bg-sky-50 dark:border-sky-500/20 dark:bg-sky-500/10">
        <Info className="text-sky-600 dark:text-sky-400" />
        <AlertDescription className="text-sky-800 dark:text-sky-300">
          Tồn kho chỉ tăng sau khi manager <strong>duyệt phiếu</strong>. Phiếu tạo ra sẽ ở trạng thái DRAFT để nhân viên kho kiểm đếm thực tế trước khi duyệt.
        </AlertDescription>
      </Alert>

      {canReceive && (
        <SectionCard title="Giao phiếu kiểm đếm cho nhân viên kho" icon={UserCheck}>
          <div className="space-y-4 p-1">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="flex-1">
                <label className="mb-1.5 block text-[12px] font-medium text-muted-foreground">Nhân viên kho thực hiện kiểm đếm</label>
                <Select value={selectedStaffId || "none"} onValueChange={(v) => setSelectedStaffId(v === "none" ? "" : v)}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Chọn nhân viên kho" />
                  </SelectTrigger>
                  <SelectContent>
                    {warehouseStaff.map((staff) => (
                      <SelectItem key={staff.id} value={staff.id}>
                        {staff.full_name || staff.username || staff.email}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex-1">
                <label className="mb-1.5 block text-[12px] font-medium text-muted-foreground">Ghi chú phiếu nhập</label>
                <Input
                  type="text"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  className="h-auto py-2"
                />
              </div>
            </div>

            <div className="flex justify-end">
              <Button
                onClick={() => void createAndAssign()}
                disabled={!selectedStaffId || totals.planned <= 0}
                loading={saving}
              >
                <ClipboardCheck className="h-4 w-4" />
                Tạo phiếu và giao cho nhân viên
              </Button>
            </div>
          </div>
        </SectionCard>
      )}
    </div>
  );
}
