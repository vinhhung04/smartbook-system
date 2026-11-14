import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { AlertTriangle, BookOpen, FileText, LogOut, PackageCheck, RefreshCw, Truck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/ui";
import { authService } from "@/services/auth";
import { getApiErrorMessage } from "@/services/api";
import { supplierAccountService } from "@/services/supplier-account";
import { purchaseOrderStatusLabel } from "@/lib/purchase-order-status";
import type { SupplierPortalOrder, SupplierPortalShortageReport } from "@/services/supplier-portal";
import { numberInputValue, zeroFieldProps } from "@/lib/number-input";
import { AIChatbot } from "@/components/ai-chatbot";
import { SupplierOrderDocuments, SupplierOrderResponsePanel } from "@/components/procurement/supplier-order-documents";
import { DISCREPANCY_TYPE_LABEL, SUPPLIER_PROPOSAL_LABEL, supplierResponseMeta } from "@/lib/procurement-document-status";

type InvoiceLines = Record<string, number>;

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function statusTone(status: string) {
  if (["RECEIVED", "RESOLVED", "SUPPLIER_CONFIRMED", "ACKNOWLEDGED"].includes(status)) return "bg-emerald-50 text-emerald-700 border-emerald-200";
  if (["SHORTAGE_REPORTED", "OPEN", "SENT_TO_SUPPLIER"].includes(status)) return "bg-amber-50 text-amber-700 border-amber-200";
  if (["CANCELLED", "REJECTED"].includes(status)) return "bg-rose-50 text-rose-700 border-rose-200";
  return "bg-slate-50 text-slate-700 border-slate-200";
}

function sumOrder(order: SupplierPortalOrder | null) {
  const items = order?.purchase_order.items || [];
  return {
    ordered: items.reduce((sum, item) => sum + item.ordered_qty, 0),
    received: items.reduce((sum, item) => sum + item.received_qty, 0),
    remaining: items.reduce((sum, item) => sum + item.remaining_qty, 0),
    invoiced: (order?.invoices || []).reduce((sum, invoice) => sum + invoice.items.reduce((lineSum, item) => lineSum + item.invoiced_qty, 0), 0),
    shortage: (order?.shortage_reports || [])
      .filter((report) => !["RESOLVED", "CANCELLED"].includes(report.status))
      .reduce((sum, report) => sum + report.items.reduce((lineSum, item) => lineSum + item.shortage_qty, 0), 0),
  };
}

export function SupplierAccountPage() {
  const navigate = useNavigate();
  const [supplierName, setSupplierName] = useState("");
  const [orders, setOrders] = useState<SupplierPortalOrder[]>([]);
  const [selectedPoId, setSelectedPoId] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [working, setWorking] = useState(false);
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [deliveryNumber, setDeliveryNumber] = useState("");
  const [invoiceDate, setInvoiceDate] = useState(todayIso());
  const [expectedDate, setExpectedDate] = useState(todayIso());
  const [note, setNote] = useState("");
  const [carrierName, setCarrierName] = useState("");
  const [delivererName, setDelivererName] = useState("");
  const [proposals, setProposals] = useState<Record<string, { action: string; note: string }>>({});
  const [lines, setLines] = useState<InvoiceLines>({});
  const [redeliveryReportId, setRedeliveryReportId] = useState("");
  const [cannotReason, setCannotReason] = useState("");
  const [confirmState, setConfirmState] = useState<{
    open: boolean; title: string; description?: string;
    variant: "default" | "destructive"; onConfirm: () => Promise<void>;
  }>({ open: false, title: "", variant: "default", onConfirm: async () => {} });
  const openConfirm = (title: string, description: string, variant: "default" | "destructive", action: () => Promise<void>) =>
    setConfirmState({ open: true, title, description, variant, onConfirm: action });

  const selectedOrder = useMemo(
    () => orders.find((order) => order.purchase_order.id === selectedPoId) || orders[0] || null,
    [orders, selectedPoId],
  );

  const totals = useMemo(() => sumOrder(selectedOrder), [selectedOrder]);
  const openShortages = useMemo(
    () => (selectedOrder?.shortage_reports || []).filter((report) => ["OPEN", "SENT_TO_SUPPLIER", "ACKNOWLEDGED"].includes(report.status)),
    [selectedOrder],
  );
  const selectedShortage = openShortages.find((report) => report.id === redeliveryReportId) || openShortages[0] || null;

  async function load() {
    try {
      setIsLoading(true);
      setError("");
      const response = await supplierAccountService.getOrders();
      const nextOrders = response.data.orders || [];
      setSupplierName(response.data.supplier?.name || "");
      setOrders(nextOrders);
      setSelectedPoId((current) => current || nextOrders[0]?.purchase_order.id || "");
    } catch (loadError) {
      setError(getApiErrorMessage(loadError, "Không tải được tài khoản nhà cung cấp"));
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    if (!selectedOrder) return;
    const defaults: InvoiceLines = {};
    for (const item of selectedOrder.purchase_order.items) {
      defaults[item.id] = item.remaining_qty;
    }
    setLines(defaults);
    // The formal invoice is issued separately (Chứng từ dùng chung); this optional field only
    // references it when the supplier already has one.
    setInvoiceNumber("");
    setDeliveryNumber(`DN-${selectedOrder.purchase_order.po_number}-${Date.now().toString().slice(-5)}`);
    setRedeliveryReportId(openShortages[0]?.id || "");
  }, [selectedOrder, openShortages]);

  async function logout() {
    await authService.logout();
    navigate("/login");
  }

  function setLineQty(itemId: string, value: number, max: number) {
    setLines((current) => ({
      ...current,
      [itemId]: Math.max(0, Math.min(max, Number.isFinite(value) ? value : 0)),
    }));
  }

  async function submitInvoice(redeliveryReport?: SupplierPortalShortageReport) {
    if (!selectedOrder) return;
    if (!deliveryNumber.trim()) return toast.error("Số phiếu giao hàng là bắt buộc");

    const sourceItems = redeliveryReport?.items || selectedOrder.purchase_order.items;
    const payloadItems = sourceItems
      .map((item) => {
        const purchaseOrderItemId = "purchase_order_item_id" in item ? item.purchase_order_item_id : item.id;
        const poItem = selectedOrder.purchase_order.items.find((orderItem) => orderItem.id === purchaseOrderItemId);
        const shortageMax = "shortage_qty" in item ? item.shortage_qty : null;
        const defaultQty = shortageMax ?? 0;
        const rawQty = Math.max(0, Number(lines[purchaseOrderItemId] ?? defaultQty));
        const qty = shortageMax == null ? rawQty : Math.min(rawQty, shortageMax);
        return {
          purchase_order_item_id: purchaseOrderItemId,
          invoiced_qty: qty,
          unit_cost: poItem?.unit_cost || 0,
        };
      })
      .filter((item) => item.invoiced_qty > 0);

    if (payloadItems.length === 0) return toast.error("Phải có ít nhất một dòng hàng");
    const title = redeliveryReport ? "Tạo phiếu giao bù" : "Gửi phiếu giao hàng";
    const desc = redeliveryReport ? "Xác nhận tạo phiếu giao bù?" : "Xác nhận gửi phiếu giao hàng này cho kho SmartBook?";
    openConfirm(title, desc, "default", async () => {
      try {
        setWorking(true);
        const payload = {
          ...(invoiceNumber.trim() ? { invoice_number: invoiceNumber.trim() } : {}),
          delivery_number: deliveryNumber.trim(),
          carrier_name: carrierName.trim() || undefined,
          deliverer_name: delivererName.trim() || undefined,
          invoice_date: invoiceDate,
          expected_delivery_date: expectedDate,
          supplier_note: note.trim(),
          ...(redeliveryReport ? { source_shortage_report_id: redeliveryReport.id, redelivery: true } : {}),
          items: payloadItems,
        };
        if (redeliveryReport) {
          await supplierAccountService.createRedeliveryInvoice(selectedOrder.purchase_order.id, redeliveryReport.id, payload);
        } else {
          await supplierAccountService.createInvoice(selectedOrder.purchase_order.id, payload);
        }
        toast.success(redeliveryReport ? "Đã gửi phiếu giao bù" : "Đã gửi phiếu giao hàng");
        setNote("");
        setConfirmState((s) => ({ ...s, open: false }));
        await load();
      } catch (submitError) {
        toast.error(getApiErrorMessage(submitError, "Gửi thất bại"));
      } finally { setWorking(false); }
    });
  }

  function acknowledge(reportId: string) {
    if (!selectedOrder) return;
    openConfirm("Ghi nhận báo cáo thiếu hàng", "Xác nhận bạn đã nhận được thông báo thiếu hàng này?", "default", async () => {
      try {
        setWorking(true);
        await supplierAccountService.acknowledgeShortage(selectedOrder.purchase_order.id, reportId);
        toast.success("Đã ghi nhận báo cáo thiếu hàng");
        setConfirmState((s) => ({ ...s, open: false }));
        await load();
      } catch (ackError) {
        toast.error(getApiErrorMessage(ackError, "Ghi nhận thất bại"));
      } finally { setWorking(false); }
    });
  }

  async function propose(reportId: string) {
    if (!selectedOrder) return;
    const proposal = proposals[reportId];
    if (!proposal?.action) return toast.error("Chọn phương án xử lý");
    try {
      setWorking(true);
      await supplierAccountService.proposeShortageAction(selectedOrder.purchase_order.id, reportId, proposal.action, proposal.note.trim() || undefined);
      toast.success("Đã gửi đề xuất xử lý chênh lệch");
      await load();
    } catch (proposeError) {
      toast.error(getApiErrorMessage(proposeError, "Gửi đề xuất thất bại"));
    } finally {
      setWorking(false);
    }
  }

  async function cannotFulfill(reportId: string) {
    if (!selectedOrder) return;
    if (!cannotReason.trim()) return toast.error("Vui lòng nhập lý do không thể cung cấp hàng");
    try {
      setWorking(true);
      await supplierAccountService.cannotFulfillShortage(selectedOrder.purchase_order.id, reportId, cannotReason.trim());
      toast.success("Đã gửi thông báo không thể cung cấp");
      setCannotReason("");
      await load();
    } catch (cannotError) {
      toast.error(getApiErrorMessage(cannotError, "Cập nhật thất bại"));
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-950">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-[8px] bg-sky-50 text-sky-700">
              <BookOpen className="h-5 w-5" />
            </div>
            <div>
              <p className="text-[12px] font-semibold uppercase tracking-wide text-slate-500">SmartBook · Tài khoản nhà cung cấp</p>
              <h1 className="text-[20px] font-bold">{supplierName || "Nhà cung cấp"}</h1>
            </div>
          </div>
          <Button variant="outline" onClick={() => void logout()}>
            <LogOut className="mr-2 h-4 w-4" /> Đăng xuất
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6">
        <div className="mb-5 flex items-start gap-3 rounded-[8px] border border-amber-200 bg-amber-50 p-4 text-[13px] text-amber-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <p>Nhà cung cấp phản hồi đơn hàng, phát hành hóa đơn và phiếu giao hàng. Việc kiểm nhận, lập phiếu nhập kho và ghi sổ kho do nhân viên kho SmartBook thực hiện; kết quả được chia sẻ lại ở mục Chứng từ dùng chung.</p>
        </div>

        {isLoading ? (
          <div className="rounded-[8px] border border-slate-200 bg-white p-8 text-[13px] text-slate-500">Đang tải đơn hàng...</div>
        ) : error ? (
          <div className="rounded-[8px] border border-rose-200 bg-white p-8">
            <p className="text-[14px] font-semibold text-rose-700">{error}</p>
            <Button className="mt-4" variant="outline" onClick={() => void load()}><RefreshCw className="mr-2 h-4 w-4" /> Thử lại</Button>
          </div>
        ) : orders.length === 0 ? (
          <div className="rounded-[8px] border border-slate-200 bg-white p-10 text-center">
            <Truck className="mx-auto mb-3 h-8 w-8 text-slate-400" />
            <h2 className="text-[16px] font-semibold">Chưa có đơn hàng nào</h2>
            <p className="mt-1 text-[13px] text-slate-500">Đơn hàng sẽ hiện ở đây khi SmartBook gửi đơn mua hàng cho tài khoản này.</p>
          </div>
        ) : selectedOrder ? (
          <div className="grid gap-5 lg:grid-cols-[320px_minmax(0,1fr)]">
            <aside className="min-w-0 space-y-3">
              {orders.map((order) => (
                <button
                  key={order.purchase_order.id}
                  onClick={() => setSelectedPoId(order.purchase_order.id)}
                  className={`w-full rounded-[8px] border bg-white p-4 text-left transition ${selectedOrder.purchase_order.id === order.purchase_order.id ? "border-sky-300 ring-2 ring-sky-100" : "border-slate-200 hover:border-slate-300"}`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-[14px] font-semibold">{order.purchase_order.po_number}</p>
                    <Badge className={statusTone(order.purchase_order.status)}>{purchaseOrderStatusLabel(order.purchase_order.status)}</Badge>
                  </div>
                  <p className="mt-2 text-[12px] text-slate-500">{order.purchase_order.warehouse?.name || "Kho"} - {order.dispatch.dispatch_number}</p>
                </button>
              ))}
            </aside>

            <section className="min-w-0 space-y-5">
              <div className="rounded-[8px] border border-slate-200 bg-white p-5">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="text-[12px] font-semibold uppercase text-slate-500">Đơn mua hàng</p>
                    <h2 className="text-[24px] font-bold">{selectedOrder.purchase_order.po_number}</h2>
                    <p className="text-[13px] text-slate-500">Kho: {selectedOrder.purchase_order.warehouse?.name || "-"} | Dự kiến giao: {selectedOrder.purchase_order.expected_date ? new Date(selectedOrder.purchase_order.expected_date).toLocaleDateString("vi-VN") : "-"}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Badge className={statusTone(selectedOrder.purchase_order.status)}>{purchaseOrderStatusLabel(selectedOrder.purchase_order.status)}</Badge>
                    <Badge className={statusTone(selectedOrder.dispatch.status)}>{purchaseOrderStatusLabel(selectedOrder.dispatch.status)}</Badge>
                    {supplierResponseMeta(selectedOrder.purchase_order.supplier_response_status) ? (
                      <Badge className={statusTone(selectedOrder.purchase_order.supplier_response_status || "")}>{supplierResponseMeta(selectedOrder.purchase_order.supplier_response_status)?.label}</Badge>
                    ) : null}
                  </div>
                </div>
                <div className="mt-5 grid gap-3 sm:grid-cols-5">
                  {[
                    ["Đã đặt", totals.ordered],
                    ["Đã nhận", totals.received],
                    ["Còn lại", totals.remaining],
                    ["Đã lập phiếu giao", totals.invoiced],
                    ["Thiếu chưa xử lý", totals.shortage],
                  ].map(([label, value]) => (
                    <div key={label} className="rounded-[8px] border border-slate-100 bg-slate-50 p-3">
                      <p className="text-[11px] font-semibold uppercase text-slate-500">{label}</p>
                      <p className="mt-1 text-[20px] font-bold">{value}</p>
                    </div>
                  ))}
                </div>
              </div>

              <SupplierOrderResponsePanel key={`resp-${selectedOrder.purchase_order.id}`} order={selectedOrder} onChanged={load} />

              <SupplierOrderDocuments key={`docs-${selectedOrder.purchase_order.id}-${selectedOrder.invoices.length}-${selectedOrder.purchase_order.status}`} order={selectedOrder} />

              <div className="rounded-[8px] border border-slate-200 bg-white p-5">
                <div className="mb-4 flex items-center gap-2">
                  <FileText className="h-4 w-4 text-sky-700" />
                  <h3 className="text-[16px] font-semibold">Lập phiếu giao hàng</h3>
                </div>
                <p className="-mt-2 mb-3 text-[12px] text-slate-500">Mỗi đợt giao một phiếu. Một đơn có thể giao nhiều đợt; hóa đơn chính thức phát hành riêng ở mục Chứng từ dùng chung.</p>
                <div className="grid gap-3 sm:grid-cols-3">
                  <label className="space-y-1 text-[12px] font-medium text-slate-600">Số phiếu giao hàng (bắt buộc)
                    <input value={deliveryNumber} onChange={(event) => setDeliveryNumber(event.target.value)} className="block w-full rounded-[8px] border border-slate-200 px-3 py-2 text-[13px] font-normal text-slate-950" />
                  </label>
                  <label className="space-y-1 text-[12px] font-medium text-slate-600">Ngày lập phiếu
                    <input type="date" value={invoiceDate} onChange={(event) => setInvoiceDate(event.target.value)} className="block w-full rounded-[8px] border border-slate-200 px-3 py-2 text-[13px] font-normal text-slate-950" />
                  </label>
                  <label className="space-y-1 text-[12px] font-medium text-slate-600">Ngày giao dự kiến
                    <input type="date" value={expectedDate} onChange={(event) => setExpectedDate(event.target.value)} className="block w-full rounded-[8px] border border-slate-200 px-3 py-2 text-[13px] font-normal text-slate-950" />
                  </label>
                  <label className="space-y-1 text-[12px] font-medium text-slate-600">Đơn vị vận chuyển
                    <input value={carrierName} onChange={(event) => setCarrierName(event.target.value)} className="block w-full rounded-[8px] border border-slate-200 px-3 py-2 text-[13px] font-normal text-slate-950" />
                  </label>
                  <label className="space-y-1 text-[12px] font-medium text-slate-600">Người giao
                    <input value={delivererName} onChange={(event) => setDelivererName(event.target.value)} className="block w-full rounded-[8px] border border-slate-200 px-3 py-2 text-[13px] font-normal text-slate-950" />
                  </label>
                  <label className="space-y-1 text-[12px] font-medium text-slate-600">Số hóa đơn tham chiếu (nếu đã có)
                    <input value={invoiceNumber} onChange={(event) => setInvoiceNumber(event.target.value)} className="block w-full rounded-[8px] border border-slate-200 px-3 py-2 text-[13px] font-normal text-slate-950" />
                  </label>
                </div>
                <textarea value={note} onChange={(event) => setNote(event.target.value)} className="mt-3 min-h-20 w-full rounded-[8px] border border-slate-200 px-3 py-2 text-[13px]" placeholder="Ghi chú của nhà cung cấp" />
                <div className="mt-4 overflow-x-auto">
                  <table className="w-full min-w-[760px] text-[13px]">
                    <thead className="bg-slate-50 text-left text-[11px] uppercase text-slate-500">
                      <tr>
                        <th className="px-3 py-2">Sách</th>
                        <th className="px-3 py-2">SKU</th>
                        <th className="px-3 py-2">Đặt</th>
                        <th className="px-3 py-2">Đã nhận</th>
                        <th className="px-3 py-2">Còn lại</th>
                        <th className="px-3 py-2">SL giao đợt này</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedOrder.purchase_order.items.map((item) => (
                        <tr key={item.id} className="border-b border-slate-100">
                          <td className="px-3 py-2 font-medium">{item.title || item.variant_id}</td>
                          <td className="px-3 py-2 text-slate-500">{item.sku || item.isbn13 || "-"}</td>
                          <td className="px-3 py-2">{item.ordered_qty}</td>
                          <td className="px-3 py-2">{item.received_qty}</td>
                          <td className="px-3 py-2">{item.remaining_qty}</td>
                          <td className="px-3 py-2">
                            <input type="number" aria-label={`Số lượng giao — ${item.title || item.variant_id}`} min={0} max={item.remaining_qty} {...zeroFieldProps} value={lines[item.id] || 0} onChange={(event) => setLineQty(item.id, Number(numberInputValue(event)), item.remaining_qty)} className="w-24 rounded-[8px] border border-slate-200 px-2 py-1" />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <Button className="mt-4" onClick={() => void submitInvoice()} disabled={working || totals.remaining <= 0}>
                  <PackageCheck className="mr-2 h-4 w-4" /> Gửi phiếu giao hàng
                </Button>
              </div>

              <div className="rounded-[8px] border border-slate-200 bg-white p-5">
                <h3 className="text-[16px] font-semibold">Chênh lệch khi nhận hàng</h3>
                {openShortages.length === 0 ? (
                  <p className="mt-3 text-[13px] text-slate-500">Không có báo cáo thiếu hàng nào đang mở.</p>
                ) : (
                  <div className="mt-4 space-y-4">
                    {openShortages.map((report) => (
                      <div key={report.id} className="rounded-[8px] border border-slate-200 p-4">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <p className="text-[13px] font-semibold">{DISCREPANCY_TYPE_LABEL[report.discrepancy_type || "SHORTAGE"] || "Chênh lệch"} · {report.id.slice(0, 8)}</p>
                            <p className="text-[12px] text-slate-500">{report.reason || "Không có lý do"}</p>
                          </div>
                          <Badge className={statusTone(report.status)}>{purchaseOrderStatusLabel(report.status)}</Badge>
                        </div>
                        <div className="mt-3 grid gap-2 sm:grid-cols-2">
                          {report.items.map((item) => (
                            <div key={item.id} className="rounded-[8px] bg-amber-50 p-3 text-[13px] text-amber-900">
                              <span className="font-semibold">{item.title || item.variant_id}</span> - {(DISCREPANCY_TYPE_LABEL[item.discrepancy_type || "SHORTAGE"] || "thiếu").toLowerCase()} {item.shortage_qty}
                            </div>
                          ))}
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <Button size="sm" variant="outline" onClick={() => void acknowledge(report.id)} disabled={working}>Ghi nhận</Button>
                          <Button size="sm" variant="outline" onClick={() => setRedeliveryReportId(report.id)}>Dùng để giao bù</Button>
                        </div>
                        {report.supplier_proposed_action ? (
                          <p className="mt-2 text-[12px] text-slate-600">Đề xuất đã gửi: <span className="font-medium">{SUPPLIER_PROPOSAL_LABEL[report.supplier_proposed_action] || report.supplier_proposed_action}</span>{report.supplier_response_note ? ` — ${report.supplier_response_note}` : ""}</p>
                        ) : null}
                        <div className="mt-3 grid gap-2 sm:grid-cols-[200px_minmax(0,1fr)_auto]">
                          <label className="text-[12px] font-medium text-slate-600">Phương án xử lý
                            <select
                              value={proposals[report.id]?.action || ""}
                              onChange={(event) => setProposals((current) => ({ ...current, [report.id]: { action: event.target.value, note: current[report.id]?.note || "" } }))}
                              className="mt-1 block w-full rounded-[8px] border border-slate-200 px-2 py-2 text-[13px] font-normal text-slate-950"
                            >
                              <option value="">— Chọn —</option>
                              {Object.entries(SUPPLIER_PROPOSAL_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                            </select>
                          </label>
                          <label className="text-[12px] font-medium text-slate-600">Ghi chú
                            <input
                              value={proposals[report.id]?.note || ""}
                              onChange={(event) => setProposals((current) => ({ ...current, [report.id]: { action: current[report.id]?.action || "", note: event.target.value } }))}
                              className="mt-1 block w-full rounded-[8px] border border-slate-200 px-3 py-2 text-[13px] font-normal text-slate-950"
                            />
                          </label>
                          <Button size="sm" className="self-end" onClick={() => void propose(report.id)} disabled={working}>Gửi đề xuất</Button>
                        </div>
                      </div>
                    ))}
                    {selectedShortage ? (
                      <div className="rounded-[8px] border border-sky-200 bg-sky-50 p-4">
                        <p className="text-[14px] font-semibold">Tạo phiếu giao bù cho chênh lệch {selectedShortage.id.slice(0, 8)}</p>
                        <div className="mt-3 space-y-2">
                          {selectedShortage.items.map((item) => (
                            <label key={item.id} className="flex items-center justify-between gap-3 text-[13px]">
                              <span>{item.title || item.variant_id}</span>
                              <input type="number" min={0} max={item.shortage_qty} value={Math.min(Number(lines[item.purchase_order_item_id] ?? item.shortage_qty), item.shortage_qty)} onChange={(event) => setLineQty(item.purchase_order_item_id, Number(event.target.value), item.shortage_qty)} className="w-24 rounded-[8px] border border-slate-200 px-2 py-1" />
                            </label>
                          ))}
                        </div>
                        <Button className="mt-4" onClick={() => void submitInvoice(selectedShortage)} disabled={working}>
                          <Truck className="mr-2 h-4 w-4" /> Gửi phiếu giao bù
                        </Button>
                        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                          <input value={cannotReason} onChange={(event) => setCannotReason(event.target.value)} className="flex-1 rounded-[8px] border border-slate-200 px-3 py-2 text-[13px]" placeholder="Lý do nếu không thể cung cấp" />
                          <Button variant="outline" onClick={() => void cannotFulfill(selectedShortage.id)} disabled={working}>Không thể cung cấp</Button>
                        </div>
                      </div>
                    ) : null}
                  </div>
                )}
              </div>

              <div className="rounded-[8px] border border-slate-200 bg-white p-5">
                <h3 className="text-[16px] font-semibold">Các đợt giao hàng</h3>
                {selectedOrder.invoices.length === 0 ? (
                  <p className="mt-3 text-[13px] text-slate-500">Chưa gửi phiếu giao hàng nào.</p>
                ) : (
                  <div className="mt-4 overflow-x-auto">
                    <table className="w-full min-w-[760px] text-[13px]">
                      <thead className="bg-slate-50 text-left text-[11px] uppercase text-slate-500">
                        <tr>
                          <th className="px-3 py-2">Phiếu giao</th>
                          <th className="px-3 py-2">Số tham chiếu</th>
                          <th className="px-3 py-2">Trạng thái</th>
                          <th className="px-3 py-2">SL</th>
                          <th className="px-3 py-2">Phiếu nhập</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedOrder.invoices.map((invoice) => (
                          <tr key={invoice.id} className="border-b border-slate-100">
                            <td className="px-3 py-2 font-medium">{invoice.delivery_number || invoice.invoice_number}</td>
                            <td className="px-3 py-2">{invoice.delivery_number && invoice.invoice_number !== invoice.delivery_number ? invoice.invoice_number : "-"}</td>
                            <td className="px-3 py-2"><Badge className={statusTone(invoice.status)}>{purchaseOrderStatusLabel(invoice.status)}</Badge></td>
                            <td className="px-3 py-2">{invoice.items.reduce((sum, item) => sum + item.invoiced_qty, 0)}</td>
                            <td className="px-3 py-2">{invoice.goods_receipts?.map((receipt) => `${receipt.receipt_number} (${purchaseOrderStatusLabel(receipt.status)})`).join(", ") || "-"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </section>
          </div>
        ) : null}
      </main>
      <ConfirmDialog
        open={confirmState.open}
        onOpenChange={(open) => setConfirmState((s) => ({ ...s, open }))}
        title={confirmState.title}
        description={confirmState.description}
        variant={confirmState.variant}
        onConfirm={confirmState.onConfirm}
        loading={working}
      />
      {/* Phase F: Supplier Assistant - reads only this supplier's own orders (ai-service supplier.orders). */}
      <AIChatbot />
    </div>
  );
}
