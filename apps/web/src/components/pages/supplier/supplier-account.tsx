import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { AlertTriangle, FileText, LogOut, PackageCheck, RefreshCw, Truck } from "lucide-react";
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
import { InvoiceFirstSteps, SupplierInvoiceDeliveryForm, SupplierOrderDocuments, SupplierOrderResponsePanel } from "@/components/procurement/supplier-order-documents";
import { invoiceFirstStage } from "@/lib/invoice-first-stage";
import { DISCREPANCY_TYPE_LABEL, SUPPLIER_PROPOSAL_LABEL, supplierResponseMeta } from "@/lib/procurement-document-status";
import { SupplierFigures, SupplierSection, SupplierShell, SupplierTabs } from "./supplier-shell";
import { SUPPLIER_INPUT } from "./supplier-status";

type InvoiceLines = Record<string, number>;
type OrderGroup = "waiting" | "delivering" | "shortage" | "done";
type AccountTab = "response" | "delivery" | "shortages" | "deliveries" | "documents";

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function statusTone(status: string) {
  if (["RECEIVED", "RESOLVED", "SUPPLIER_CONFIRMED", "ACKNOWLEDGED"].includes(status)) return "bg-primary/[0.05] text-primary border-primary/20";
  if (["SHORTAGE_REPORTED", "OPEN", "SENT_TO_SUPPLIER"].includes(status)) return "bg-amber-50 text-amber-700 border-amber-200";
  if (["CANCELLED", "REJECTED"].includes(status)) return "bg-red-50 text-red-700 border-red-200";
  return "bg-muted/40 text-foreground border-border";
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
  // View state only: which list filter and which detail tab are showing (null = the tab that fits the order).
  const [groupFilter, setGroupFilter] = useState<"all" | OrderGroup>("all");
  const [tab, setTab] = useState<AccountTab | null>(null);
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

  // Which pile an order sits in, for the list filter. Presentation only.
  const groupOf = (order: SupplierPortalOrder): OrderGroup => {
    const status = order.purchase_order.status;
    if (order.shortage_reports.some((report) => ["OPEN", "SENT_TO_SUPPLIER", "ACKNOWLEDGED"].includes(report.status)) || status === "SHORTAGE_REPORTED") return "shortage";
    if (status === "SENT_TO_SUPPLIER") return "waiting";
    if (["SUPPLIER_CONFIRMED", "PARTIALLY_RECEIVED"].includes(status)) return "delivering";
    return "done";
  };
  const groupCounts = orders.reduce<Record<string, number>>((acc, order) => {
    const group = groupOf(order);
    acc[group] = (acc[group] || 0) + 1;
    return acc;
  }, {});
  const visibleOrders = groupFilter === "all" ? orders : orders.filter((order) => groupOf(order) === groupFilter);
  // invoice-first orders open on whatever the next step needs (e.g. the invoice before any delivery)
  const nextStepTab = selectedOrder && selectedOrder.purchase_order.procurement_flow === "INVOICE_FIRST" ? invoiceFirstStage(selectedOrder)?.tab : null;
  const defaultTab: AccountTab = selectedOrder
    ? nextStepTab || ({ waiting: "response", shortage: "shortages", delivering: "delivery", done: "deliveries" } as const)[groupOf(selectedOrder)]
    : "response";
  const activeTab = tab ?? defaultTab;
  const [openInvoiceForm, setOpenInvoiceForm] = useState(false);
  const chooseOrder = (poId: string) => {
    setSelectedPoId(poId);
    setTab(null);
    setOpenInvoiceForm(false);
  };
  const goToStep = (next: AccountTab) => {
    setOpenInvoiceForm(next === "documents");
    setTab(next);
  };

  return (
    <SupplierShell
      supplierName={supplierName}
      access="Đăng nhập bằng tài khoản nhà cung cấp"
      actions={
        <>
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={isLoading || working} className="gap-2">
            <RefreshCw className={`h-3.5 w-3.5 motion-reduce:animate-none ${isLoading ? "animate-spin" : ""}`} /> Làm mới
          </Button>
          <Button variant="outline" size="sm" onClick={() => void logout()} className="gap-2">
            <LogOut className="h-3.5 w-3.5" /> Đăng xuất
          </Button>
        </>
      }
    >
      <div>
        <h1 className="font-display text-[28px] font-semibold leading-tight tracking-tight text-foreground">Đơn hàng của bạn</h1>
        <p className="mt-1 text-[14px] text-muted-foreground">
          {isLoading
            ? "Đang tải đơn hàng..."
            : `${orders.length} đơn: ${groupCounts.waiting || 0} chờ phản hồi, ${groupCounts.delivering || 0} đang giao, ${groupCounts.shortage || 0} có báo thiếu.`}
        </p>
      </div>

      {isLoading ? (
        <div className="rounded-2xl border border-border bg-card p-8 text-[13px] text-muted-foreground">Đang tải đơn hàng...</div>
      ) : error ? (
        <div className="rounded-2xl border border-red-200 bg-card p-8">
          <p className="text-[14px] font-semibold text-red-700">{error}</p>
          <Button className="mt-4" variant="outline" onClick={() => void load()}><RefreshCw className="mr-2 h-4 w-4" /> Thử lại</Button>
        </div>
      ) : orders.length === 0 ? (
        <div className="rounded-2xl border border-border bg-card p-10 text-center">
          <Truck className="mx-auto mb-3 h-8 w-8 text-muted-foreground" aria-hidden="true" />
          <h2 className="font-display text-[18px] font-semibold">Chưa có đơn hàng nào</h2>
          <p className="mt-1 text-[13px] text-muted-foreground">Đơn hàng sẽ hiện ở đây khi SmartBook gửi đơn mua hàng cho tài khoản này.</p>
        </div>
      ) : selectedOrder ? (
        <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[300px_minmax(0,1fr)]">
          <aside aria-label="Danh sách đơn" className="min-w-0 rounded-2xl border border-border bg-card lg:sticky lg:top-4">
            <div className="border-b border-border p-3">
              <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5 [scrollbar-width:thin] lg:flex-wrap" role="group" aria-label="Lọc đơn theo tình trạng">
                {([
                  ["all", "Tất cả", orders.length],
                  ["waiting", "Chờ phản hồi", groupCounts.waiting || 0],
                  ["delivering", "Đang giao", groupCounts.delivering || 0],
                  ["shortage", "Báo thiếu", groupCounts.shortage || 0],
                  ["done", "Đã xong", groupCounts.done || 0],
                ] as const).map(([key, label, count]) => (
                  <button
                    key={key}
                    type="button"
                    aria-pressed={groupFilter === key}
                    onClick={() => setGroupFilter(key)}
                    className={`shrink-0 rounded-full border px-3 py-1 text-[12px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${
                      groupFilter === key ? "border-primary/30 bg-primary/[0.08] font-semibold text-primary" : "border-border bg-card font-medium text-foreground hover:bg-muted/60"
                    }`}
                  >
                    {label} <span className="tabular-nums text-muted-foreground">{count}</span>
                  </button>
                ))}
              </div>
            </div>
            <ul className="max-h-[40vh] divide-y divide-border overflow-y-auto lg:max-h-[60vh]">
              {visibleOrders.length === 0 ? (
                <li className="px-4 py-6 text-[13px] text-muted-foreground">Không có đơn nào ở nhóm này.</li>
              ) : visibleOrders.map((order) => {
                const active = selectedOrder.purchase_order.id === order.purchase_order.id;
                return (
                  <li key={order.purchase_order.id}>
                    <button
                      type="button"
                      onClick={() => chooseOrder(order.purchase_order.id)}
                      aria-current={active ? "true" : undefined}
                      className={`w-full px-4 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40 ${active ? "bg-primary/[0.07]" : "hover:bg-muted/40"}`}
                    >
                      <p className="truncate font-mono text-[13px] font-semibold text-foreground">{order.purchase_order.po_number}</p>
                      <p className="mt-0.5 text-[12px] text-muted-foreground">{purchaseOrderStatusLabel(order.purchase_order.status)}</p>
                      <p className="truncate text-[12px] text-muted-foreground">Giao đến {order.purchase_order.warehouse?.name || "kho"}</p>
                    </button>
                  </li>
                );
              })}
            </ul>
          </aside>

          <div className="min-w-0 space-y-5">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="font-mono text-[24px] font-semibold text-foreground">{selectedOrder.purchase_order.po_number}</h2>
                <Badge className={statusTone(selectedOrder.purchase_order.status)}>{purchaseOrderStatusLabel(selectedOrder.purchase_order.status)}</Badge>
                {supplierResponseMeta(selectedOrder.purchase_order.supplier_response_status) ? (
                  <Badge className={statusTone(selectedOrder.purchase_order.supplier_response_status || "")}>{supplierResponseMeta(selectedOrder.purchase_order.supplier_response_status)?.label}</Badge>
                ) : null}
              </div>
              <p className="mt-1 text-[14px] text-muted-foreground">
                Giao đến {selectedOrder.purchase_order.warehouse?.name || "-"}, dự kiến {selectedOrder.purchase_order.expected_date ? new Date(selectedOrder.purchase_order.expected_date).toLocaleDateString("vi-VN") : "chưa hẹn ngày"}. Phiếu gửi <span className="font-mono text-[13px]">{selectedOrder.dispatch.dispatch_number}</span>, {purchaseOrderStatusLabel(selectedOrder.dispatch.status).toLocaleLowerCase("vi")}.
              </p>
            </div>

            <SupplierFigures items={[
              { label: "Đã đặt, cuốn", value: totals.ordered },
              { label: "Thư viện đã nhận, cuốn", value: totals.received },
              { label: "Còn phải giao, cuốn", value: totals.remaining },
              { label: "Đã lập phiếu giao, cuốn", value: totals.invoiced },
              { label: "Thiếu chưa xử lý, cuốn", value: totals.shortage },
            ]} />

            {selectedOrder.purchase_order.procurement_flow === "INVOICE_FIRST" ? (
              <InvoiceFirstSteps order={selectedOrder} onGo={goToStep} />
            ) : null}

            <SupplierTabs<AccountTab>
              label="Mục của đơn"
              value={activeTab}
              onChange={setTab}
              tabs={[
                ["response", "Phản hồi đơn"],
                ["delivery", "Lập phiếu giao"],
                ["shortages", `Báo thiếu${openShortages.length ? ` (${openShortages.length})` : ""}`],
                ["deliveries", `Các đợt giao (${selectedOrder.invoices.length})`],
                ["documents", "Chứng từ"],
              ]}
            />

            {activeTab === "response" ? (
              <SupplierOrderResponsePanel key={`resp-${selectedOrder.purchase_order.id}`} order={selectedOrder} onChanged={load} />
            ) : null}

            {activeTab === "documents" ? (
              <SupplierOrderDocuments
                key={`docs-${selectedOrder.purchase_order.id}-${selectedOrder.invoices.length}-${selectedOrder.purchase_order.status}-${openInvoiceForm}`}
                order={selectedOrder}
                autoOpenInvoice={openInvoiceForm || nextStepTab === "documents"}
              />
            ) : null}

            {activeTab === "delivery" && selectedOrder.purchase_order.procurement_flow === "INVOICE_FIRST" ? (
              <SupplierSection title="Lập phiếu giao hàng theo hóa đơn" icon={FileText} description="Chọn hóa đơn SmartBook đã duyệt và số lượng giao đợt này. Giao nhiều đợt cho đến khi đủ số lượng trên hóa đơn.">
                <SupplierInvoiceDeliveryForm key={`dn-${selectedOrder.purchase_order.id}`} order={selectedOrder} onSaved={load} onCreateInvoice={() => goToStep("documents")} />
              </SupplierSection>
            ) : null}

            {activeTab === "delivery" && selectedOrder.purchase_order.procurement_flow !== "INVOICE_FIRST" ? (
              <SupplierSection title="Lập phiếu giao hàng" icon={FileText} description="Mỗi đợt giao một phiếu. Một đơn có thể giao nhiều đợt, hóa đơn chính thức phát hành riêng ở mục Chứng từ.">
                <div className="space-y-4 p-5">
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    <label className="text-[12px] text-muted-foreground">Số phiếu giao hàng (bắt buộc)
                      <input value={deliveryNumber} onChange={(event) => setDeliveryNumber(event.target.value)} className={`mt-1 ${SUPPLIER_INPUT} font-mono`} />
                    </label>
                    <label className="text-[12px] text-muted-foreground">Ngày lập phiếu
                      <input type="date" value={invoiceDate} onChange={(event) => setInvoiceDate(event.target.value)} className={`mt-1 ${SUPPLIER_INPUT}`} />
                    </label>
                    <label className="text-[12px] text-muted-foreground">Ngày giao dự kiến
                      <input type="date" value={expectedDate} onChange={(event) => setExpectedDate(event.target.value)} className={`mt-1 ${SUPPLIER_INPUT}`} />
                    </label>
                    <label className="text-[12px] text-muted-foreground">Đơn vị vận chuyển
                      <input value={carrierName} onChange={(event) => setCarrierName(event.target.value)} className={`mt-1 ${SUPPLIER_INPUT}`} />
                    </label>
                    <label className="text-[12px] text-muted-foreground">Người giao
                      <input value={delivererName} onChange={(event) => setDelivererName(event.target.value)} className={`mt-1 ${SUPPLIER_INPUT}`} />
                    </label>
                    <label className="text-[12px] text-muted-foreground">Số hóa đơn tham chiếu (nếu đã có)
                      <input value={invoiceNumber} onChange={(event) => setInvoiceNumber(event.target.value)} className={`mt-1 ${SUPPLIER_INPUT} font-mono`} />
                    </label>
                  </div>
                  <label className="block text-[12px] text-muted-foreground">Ghi chú của nhà cung cấp
                    <textarea value={note} onChange={(event) => setNote(event.target.value)} className="mt-1 min-h-20 w-full rounded-xl border border-input bg-background px-3 py-2 text-[13px] text-foreground outline-none focus:border-primary/40 focus:ring-2 focus:ring-primary/10" />
                  </label>
                  <div className="overflow-x-auto rounded-xl border border-border">
                    <table className="w-full min-w-[640px] text-[13px]">
                      <thead className="text-left text-[12px] text-muted-foreground">
                        <tr className="border-b border-border">
                          <th className="px-3 py-2 font-normal">Sách</th>
                          <th className="px-3 py-2 font-normal">Mã</th>
                          <th className="px-3 py-2 text-right font-normal">Đặt</th>
                          <th className="px-3 py-2 text-right font-normal">Đã nhận</th>
                          <th className="px-3 py-2 text-right font-normal">Còn lại</th>
                          <th className="px-3 py-2 font-normal">Giao đợt này</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedOrder.purchase_order.items.map((item) => (
                          <tr key={item.id} className="border-b border-border last:border-0">
                            <td className="px-3 py-2 font-medium">{item.title || item.variant_id}</td>
                            <td className="px-3 py-2 font-mono text-[12px] text-muted-foreground">{item.item_code || item.sku || item.isbn13 || "-"}</td>
                            <td className="px-3 py-2 text-right tabular-nums">{item.ordered_qty}</td>
                            <td className="px-3 py-2 text-right tabular-nums">{item.received_qty}</td>
                            <td className="px-3 py-2 text-right tabular-nums">{item.remaining_qty}</td>
                            <td className="px-3 py-2">
                              <input type="number" aria-label={`Số lượng giao, ${item.title || item.variant_id}`} min={0} max={item.remaining_qty} {...zeroFieldProps} value={lines[item.id] || 0} onChange={(event) => setLineQty(item.id, Number(numberInputValue(event)), item.remaining_qty)} className="w-24 rounded-lg border border-input bg-background px-2 py-1.5 text-[13px] tabular-nums" />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <Button onClick={() => void submitInvoice()} disabled={working || totals.remaining <= 0} className="gap-2">
                    <PackageCheck className="h-4 w-4" /> Gửi phiếu giao hàng
                  </Button>
                </div>
              </SupplierSection>
            ) : null}

            {activeTab === "shortages" ? (
              <SupplierSection title="Chênh lệch khi nhận hàng" icon={AlertTriangle} description="Kho thư viện báo thiếu hoặc lệch khi kiểm đếm. Ghi nhận, đề xuất cách xử lý hoặc lập phiếu giao bù.">
                {openShortages.length === 0 ? (
                  <p className="p-5 text-[13px] text-muted-foreground">Không có báo cáo thiếu hàng nào đang mở.</p>
                ) : (
                  <div className="space-y-4 p-5">
                    {openShortages.map((report) => (
                      <div key={report.id} className="rounded-xl border border-border p-4">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <p className="text-[14px] font-semibold">{DISCREPANCY_TYPE_LABEL[report.discrepancy_type || "SHORTAGE"] || "Chênh lệch"} <span className="font-mono text-[12px] font-normal text-muted-foreground">{report.id.slice(0, 8)}</span></p>
                            <p className="text-[13px] text-muted-foreground">{report.reason || "Không có lý do"}</p>
                          </div>
                          <Badge className={statusTone(report.status)}>{purchaseOrderStatusLabel(report.status)}</Badge>
                        </div>
                        <ul className="mt-3 divide-y divide-border rounded-lg border border-border text-[13px]">
                          {report.items.map((item) => (
                            <li key={item.id} className="flex justify-between gap-3 px-3 py-2">
                              <span className="font-medium">{item.title || item.variant_id}</span>
                              <span className="shrink-0 text-red-700 dark:text-red-400">{(DISCREPANCY_TYPE_LABEL[item.discrepancy_type || "SHORTAGE"] || "thiếu").toLowerCase()} {item.shortage_qty}</span>
                            </li>
                          ))}
                        </ul>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <Button size="sm" variant="outline" onClick={() => void acknowledge(report.id)} disabled={working}>Ghi nhận</Button>
                          <Button size="sm" variant="outline" onClick={() => setRedeliveryReportId(report.id)}>Dùng để giao bù</Button>
                        </div>
                        {report.supplier_proposed_action ? (
                          <p className="mt-2 text-[12px] text-muted-foreground">Đề xuất đã gửi: <span className="font-medium text-foreground">{SUPPLIER_PROPOSAL_LABEL[report.supplier_proposed_action] || report.supplier_proposed_action}</span>{report.supplier_response_note ? `, ${report.supplier_response_note}` : ""}</p>
                        ) : null}
                        <div className="mt-3 grid gap-2 sm:grid-cols-[200px_minmax(0,1fr)_auto]">
                          <label className="text-[12px] text-muted-foreground">Phương án xử lý
                            <select
                              value={proposals[report.id]?.action || ""}
                              onChange={(event) => setProposals((current) => ({ ...current, [report.id]: { action: event.target.value, note: current[report.id]?.note || "" } }))}
                              className={`mt-1 ${SUPPLIER_INPUT}`}
                            >
                              <option value="">Chọn phương án</option>
                              {Object.entries(SUPPLIER_PROPOSAL_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                            </select>
                          </label>
                          <label className="text-[12px] text-muted-foreground">Ghi chú
                            <input
                              value={proposals[report.id]?.note || ""}
                              onChange={(event) => setProposals((current) => ({ ...current, [report.id]: { action: current[report.id]?.action || "", note: event.target.value } }))}
                              className={`mt-1 ${SUPPLIER_INPUT}`}
                            />
                          </label>
                          <Button size="sm" className="self-end" onClick={() => void propose(report.id)} disabled={working}>Gửi đề xuất</Button>
                        </div>
                      </div>
                    ))}
                    {selectedShortage ? (
                      <div className="rounded-xl border border-border bg-muted/40 p-4">
                        <p className="text-[14px] font-semibold">Phiếu giao bù cho chênh lệch <span className="font-mono text-[13px]">{selectedShortage.id.slice(0, 8)}</span></p>
                        <div className="mt-3 space-y-2">
                          {selectedShortage.items.map((item) => (
                            <label key={item.id} className="flex items-center justify-between gap-3 text-[13px]">
                              <span>{item.title || item.variant_id}</span>
                              <input type="number" aria-label={`Số lượng giao bù, ${item.title || item.variant_id}`} min={0} max={item.shortage_qty} value={Math.min(Number(lines[item.purchase_order_item_id] ?? item.shortage_qty), item.shortage_qty)} onChange={(event) => setLineQty(item.purchase_order_item_id, Number(event.target.value), item.shortage_qty)} className="w-24 rounded-lg border border-input bg-background px-2 py-1.5 tabular-nums" />
                            </label>
                          ))}
                        </div>
                        <Button className="mt-4 gap-2" onClick={() => void submitInvoice(selectedShortage)} disabled={working}>
                          <Truck className="h-4 w-4" /> Gửi phiếu giao bù
                        </Button>
                        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                          <input value={cannotReason} onChange={(event) => setCannotReason(event.target.value)} aria-label="Lý do nếu không thể cung cấp" className={`flex-1 ${SUPPLIER_INPUT}`} placeholder="Lý do nếu không thể cung cấp" />
                          <Button variant="outline" onClick={() => void cannotFulfill(selectedShortage.id)} disabled={working}>Không thể cung cấp</Button>
                        </div>
                      </div>
                    ) : null}
                  </div>
                )}
              </SupplierSection>
            ) : null}

            {activeTab === "deliveries" ? (
              <SupplierSection title="Các đợt giao hàng" icon={Truck}>
                {selectedOrder.invoices.length === 0 ? (
                  <p className="p-5 text-[13px] text-muted-foreground">Chưa gửi phiếu giao hàng nào.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[640px] text-[13px]">
                      <thead className="text-left text-[12px] text-muted-foreground">
                        <tr className="border-b border-border">
                          <th className="px-5 py-2 font-normal">Phiếu giao</th>
                          <th className="px-3 py-2 font-normal">Số tham chiếu</th>
                          <th className="px-3 py-2 font-normal">Trạng thái</th>
                          <th className="px-3 py-2 text-right font-normal">Số cuốn</th>
                          <th className="px-5 py-2 font-normal">Phiếu nhập kho</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedOrder.invoices.map((invoice) => (
                          <tr key={invoice.id} className="border-b border-border last:border-0">
                            <td className="px-5 py-2.5 font-mono text-[12px] font-medium">{invoice.delivery_number || invoice.invoice_number}</td>
                            <td className="px-3 py-2.5 font-mono text-[12px] text-muted-foreground">{invoice.delivery_number && invoice.invoice_number !== invoice.delivery_number ? invoice.invoice_number : "-"}</td>
                            <td className="px-3 py-2.5"><Badge className={statusTone(invoice.status)}>{purchaseOrderStatusLabel(invoice.status)}</Badge></td>
                            <td className="px-3 py-2.5 text-right tabular-nums">{invoice.items.reduce((sum, item) => sum + item.invoiced_qty, 0)}</td>
                            <td className="px-5 py-2.5 text-[12px]">{invoice.goods_receipts?.map((receipt) => `${receipt.receipt_number} (${purchaseOrderStatusLabel(receipt.status)})`).join(", ") || "-"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </SupplierSection>
            ) : null}
          </div>
        </div>
      ) : null}

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
    </SupplierShell>
  );
}
