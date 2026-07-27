import { useEffect, useMemo, useState } from "react";
import { NavLink, useNavigate, useParams } from "react-router";
import { AlertCircle, ArrowLeft, ClipboardCheck, FileText, RefreshCw, Search, Truck, UserCheck } from "lucide-react";
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
import { LoadingOverlay, SkeletonTableRow } from "@/components/ui/loading-state";

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

const statuses = ["ALL", "SUBMITTED", "PARTIALLY_RECEIVED", "SHORTAGE_REPORTED", "RECEIVED", "CANCELLED"];

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

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
      <PageHeader
        icon={Truck}
        title="Giao hàng nhà cung cấp"
        description="Hóa đơn, phiếu giao hàng, giao lại và phiếu nhận nháp"
        iconBg="bg-sky-50 dark:bg-sky-500/10"
        iconColor="text-sky-700 dark:text-sky-400"
        actions={
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> Làm mới
          </Button>
        }
      />

      <SectionCard>
        <div className="grid gap-3 md:grid-cols-[1fr_220px]">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Tìm hóa đơn, PO, nhà cung cấp, kho..."
              className="w-full rounded-lg border border-input bg-background py-2 pl-9 pr-3 text-[13px]"
            />
          </div>
          <select value={status} onChange={(event) => setStatus(event.target.value)} className="rounded-lg border border-input bg-background px-3 py-2 text-[13px]">
            {statuses.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        </div>
      </SectionCard>

      <SectionCard noPadding>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1080px]">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                {["Hóa đơn", "PO", "Nhà cung cấp", "Kho", "Dự kiến", "SL", "Đã nhận", "Trạng thái", "Thao tác"].map((heading) => (
                  <th key={heading} className="px-5 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{heading}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <SkeletonTableRow columns={9} rows={5} />
              ) : filteredRows.length === 0 ? (
                <tr><td colSpan={9}><EmptyState variant="no-data" title="Chưa có giao hàng" description="Hóa đơn và phiếu giao hàng từ nhà cung cấp sẽ hiển thị ở đây." className="py-12" /></td></tr>
              ) : filteredRows.map((row) => {
                const totalQty = row.items.reduce((sum, item) => sum + Number(item.invoiced_qty || 0), 0);
                const acceptedQty = row.items.reduce((sum, item) => sum + Number(item.accepted_qty || 0), 0);
                const canReceive = ["SUBMITTED", "PARTIALLY_RECEIVED", "SHORTAGE_REPORTED"].includes(row.status);
                return (
                  <tr key={row.id} className="border-b border-border last:border-0 hover:bg-muted/30">
                    <td className="px-5 py-3.5">
                      <NavLink to={`/supplier-deliveries/${row.id}`} className="text-[13px] font-semibold text-indigo-600 hover:text-indigo-800 dark:text-indigo-400 dark:hover:text-indigo-300">{row.invoice_number}</NavLink>
                      <div className="text-[11px] text-muted-foreground">{row.delivery_number || "-"}</div>
                    </td>
                    <td className="px-5 py-3.5">
                      {row.purchase_order_id ? <NavLink to={`/purchase-orders/${row.purchase_order_id}`} className="text-[13px] text-indigo-600 dark:text-indigo-400">{row.po_number || row.purchase_order_id}</NavLink> : "-"}
                    </td>
                    <td className="px-5 py-3.5 text-[13px]">{row.supplier_name || "-"}</td>
                    <td className="px-5 py-3.5 text-[13px]">{row.warehouse_code || row.warehouse_name || "-"}</td>
                    <td className="px-5 py-3.5 text-[12px] text-muted-foreground">{formatDate(row.expected_delivery_date)}</td>
                    <td className="px-5 py-3.5 text-[13px]">{totalQty}</td>
                    <td className="px-5 py-3.5 text-[13px]">{acceptedQty}</td>
                    <td className="px-5 py-3.5"><StatusBadge label={row.status} variant={statusVariant(row.status)} dot /></td>
                    <td className="px-5 py-3.5">
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
      <NavLink to="/supplier-deliveries" className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-3.5 w-3.5" /> Quay lại danh sách
      </NavLink>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight">Phiếu xuất nhà cung cấp</h1>
            <StatusBadge label={invoice.status} variant={statusVariant(invoice.status)} dot />
          </div>
          <p className="mt-1 text-[12px] text-muted-foreground">
            {invoice.po_number || "-"} · {invoice.supplier_name || "-"} · Hóa đơn {invoice.invoice_number}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={saving}>
          <RefreshCw className={`h-3.5 w-3.5 ${saving ? "animate-spin" : ""}`} /> Làm mới
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <SectionCard title="Kho nhận"><p className="text-[13px] font-medium">{invoice.warehouse_code || "-"} · {invoice.warehouse_name || ""}</p></SectionCard>
        <SectionCard title="Ngày giao dự kiến"><p className="text-[13px] font-medium">{formatDate(invoice.expected_delivery_date)}</p></SectionCard>
        <SectionCard title="Số lượng sẽ nhận"><p className="text-lg font-semibold">{totals.planned}</p></SectionCard>
        <SectionCard title="Giá trị ước tính"><p className="font-mono text-[13px] font-semibold">{formatCurrency(totals.amount)}</p></SectionCard>
      </div>

      {/* Items from invoice — quantities auto-filled, staff will verify physically */}
      <SectionCard title="Danh sách hàng theo phiếu NCC" noPadding>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px]">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                {["Tên sách", "ISBN/SKU", "SL đặt (PO)", "Đã nhận trước", "PO còn lại", "NCC xuất", "Sẽ nhận", "Trạng thái"].map((heading) => (
                  <th key={heading} className="px-5 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{heading}</th>
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
                    <td className="px-5 py-3.5 text-[13px] font-semibold">{item.title || "-"}</td>
                    <td className="px-5 py-3.5 font-mono text-[12px] text-muted-foreground">{item.isbn13 || item.sku || item.variant_id}</td>
                    <td className="px-5 py-3.5 text-[13px]">{item.ordered_qty}</td>
                    <td className="px-5 py-3.5 text-[13px]">{item.previously_received_qty}</td>
                    <td className="px-5 py-3.5 text-[13px] font-medium">{item.remaining_qty}</td>
                    <td className="px-5 py-3.5 text-[13px] font-semibold text-indigo-700 dark:text-indigo-400">{item.invoiced_qty}</td>
                    <td className="px-5 py-3.5">
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
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-4 text-[13px] text-amber-800 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          Một số mục NCC xuất ít hơn PO còn lại. Hệ thống sẽ tự tạo báo cáo thiếu hàng.
        </div>
      )}

      <div className="rounded-lg border border-sky-100 bg-sky-50 p-4 text-[13px] text-sky-800 dark:border-sky-500/20 dark:bg-sky-500/10 dark:text-sky-300">
        Tồn kho chỉ tăng sau khi manager <strong>duyệt phiếu</strong>. Phiếu tạo ra sẽ ở trạng thái DRAFT để nhân viên kho kiểm đếm thực tế trước khi duyệt.
      </div>

      {canReceive && (
        <SectionCard title="Giao phiếu kiểm đếm cho nhân viên kho" icon={UserCheck}>
          <div className="space-y-4 p-1">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="flex-1">
                <label className="mb-1.5 block text-[12px] font-medium text-muted-foreground">Nhân viên kho thực hiện kiểm đếm</label>
                <select
                  value={selectedStaffId}
                  onChange={(e) => setSelectedStaffId(e.target.value)}
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-[13px]"
                >
                  <option value="">-- Chọn nhân viên kho --</option>
                  {warehouseStaff.map((staff) => (
                    <option key={staff.id} value={staff.id}>
                      {staff.full_name || staff.username || staff.email}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex-1">
                <label className="mb-1.5 block text-[12px] font-medium text-muted-foreground">Ghi chú phiếu nhập</label>
                <input
                  type="text"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-[13px]"
                />
              </div>
            </div>

            <div className="flex justify-end">
              <Button
                onClick={() => void createAndAssign()}
                disabled={saving || !selectedStaffId || totals.planned <= 0}
                className="gap-2"
              >
                <ClipboardCheck className="h-4 w-4" />
                {saving ? "Đang tạo và giao..." : "Tạo phiếu và giao cho nhân viên"}
              </Button>
            </div>
          </div>
        </SectionCard>
      )}
    </div>
  );
}
