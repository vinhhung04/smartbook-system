import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { AlertTriangle, BookOpen, CheckCircle2, FileText, LogOut, PackageCheck, RefreshCw, Truck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { authService } from "@/services/auth";
import { getApiErrorMessage } from "@/services/api";
import { supplierAccountService } from "@/services/supplier-account";
import type { SupplierPortalOrder, SupplierPortalShortageReport } from "@/services/supplier-portal";

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
  const [lines, setLines] = useState<InvoiceLines>({});
  const [redeliveryReportId, setRedeliveryReportId] = useState("");
  const [cannotReason, setCannotReason] = useState("");

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
      setError(getApiErrorMessage(loadError, "Cannot load supplier account"));
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
    setInvoiceNumber(`INV-${selectedOrder.purchase_order.po_number}-${Date.now().toString().slice(-5)}`);
    setDeliveryNumber(`DN-${selectedOrder.purchase_order.po_number}-${Date.now().toString().slice(-5)}`);
    setRedeliveryReportId(openShortages[0]?.id || "");
  }, [selectedOrder, openShortages]);

  async function logout() {
    await authService.logout();
    navigate("/login");
  }

  async function confirmOrder() {
    if (!selectedOrder) return;
    if (!window.confirm("Confirm this purchase order?")) return;
    try {
      setWorking(true);
      await supplierAccountService.confirmOrder(selectedOrder.purchase_order.id);
      toast.success("Order confirmed");
      await load();
    } catch (confirmError) {
      toast.error(getApiErrorMessage(confirmError, "Confirm order failed"));
    } finally {
      setWorking(false);
    }
  }

  function setLineQty(itemId: string, value: number, max: number) {
    setLines((current) => ({
      ...current,
      [itemId]: Math.max(0, Math.min(max, Number.isFinite(value) ? value : 0)),
    }));
  }

  async function submitInvoice(redeliveryReport?: SupplierPortalShortageReport) {
    if (!selectedOrder) return;
    if (!invoiceNumber.trim()) return toast.error("Invoice number is required");

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

    if (payloadItems.length === 0) return toast.error("Enter at least one quantity");
    if (!window.confirm(redeliveryReport ? "Create redelivery invoice?" : "Submit invoice / delivery note?")) return;

    try {
      setWorking(true);
      const payload = {
        invoice_number: invoiceNumber.trim(),
        delivery_number: deliveryNumber.trim(),
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
      toast.success(redeliveryReport ? "Redelivery invoice submitted" : "Invoice submitted");
      setNote("");
      await load();
    } catch (submitError) {
      toast.error(getApiErrorMessage(submitError, "Submit failed"));
    } finally {
      setWorking(false);
    }
  }

  async function acknowledge(reportId: string) {
    if (!selectedOrder) return;
    if (!window.confirm("Acknowledge this shortage report?")) return;
    try {
      setWorking(true);
      await supplierAccountService.acknowledgeShortage(selectedOrder.purchase_order.id, reportId);
      toast.success("Shortage acknowledged");
      await load();
    } catch (ackError) {
      toast.error(getApiErrorMessage(ackError, "Acknowledge failed"));
    } finally {
      setWorking(false);
    }
  }

  async function cannotFulfill(reportId: string) {
    if (!selectedOrder) return;
    if (!cannotReason.trim()) return toast.error("Reason is required");
    try {
      setWorking(true);
      await supplierAccountService.cannotFulfillShortage(selectedOrder.purchase_order.id, reportId, cannotReason.trim());
      toast.success("Shortage note submitted");
      setCannotReason("");
      await load();
    } catch (cannotError) {
      toast.error(getApiErrorMessage(cannotError, "Update failed"));
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
              <p className="text-[12px] font-semibold uppercase tracking-wide text-slate-500">SmartBook Supplier Account</p>
              <h1 className="text-[20px] font-bold">{supplierName || "Supplier"}</h1>
            </div>
          </div>
          <Button variant="outline" onClick={() => void logout()}>
            <LogOut className="mr-2 h-4 w-4" /> Sign out
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6">
        <div className="mb-5 flex items-start gap-3 rounded-[8px] border border-amber-200 bg-amber-50 p-4 text-[13px] text-amber-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <p>Supplier accounts can confirm orders and submit delivery documents only. Stock receiving and posting are handled by SmartBook warehouse staff.</p>
        </div>

        {isLoading ? (
          <div className="rounded-[8px] border border-slate-200 bg-white p-8 text-[13px] text-slate-500">Loading supplier orders...</div>
        ) : error ? (
          <div className="rounded-[8px] border border-rose-200 bg-white p-8">
            <p className="text-[14px] font-semibold text-rose-700">{error}</p>
            <Button className="mt-4" variant="outline" onClick={() => void load()}><RefreshCw className="mr-2 h-4 w-4" /> Retry</Button>
          </div>
        ) : orders.length === 0 ? (
          <div className="rounded-[8px] border border-slate-200 bg-white p-10 text-center">
            <Truck className="mx-auto mb-3 h-8 w-8 text-slate-400" />
            <h2 className="text-[16px] font-semibold">No supplier orders yet</h2>
            <p className="mt-1 text-[13px] text-slate-500">Orders will appear here after SmartBook staff sends a purchase order to this supplier account.</p>
          </div>
        ) : selectedOrder ? (
          <div className="grid gap-5 lg:grid-cols-[320px_minmax(0,1fr)]">
            <aside className="space-y-3">
              {orders.map((order) => (
                <button
                  key={order.purchase_order.id}
                  onClick={() => setSelectedPoId(order.purchase_order.id)}
                  className={`w-full rounded-[8px] border bg-white p-4 text-left transition ${selectedOrder.purchase_order.id === order.purchase_order.id ? "border-sky-300 ring-2 ring-sky-100" : "border-slate-200 hover:border-slate-300"}`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-[14px] font-semibold">{order.purchase_order.po_number}</p>
                    <Badge className={statusTone(order.purchase_order.status)}>{order.purchase_order.status}</Badge>
                  </div>
                  <p className="mt-2 text-[12px] text-slate-500">{order.purchase_order.warehouse?.name || "Warehouse"} - {order.dispatch.dispatch_number}</p>
                </button>
              ))}
            </aside>

            <section className="space-y-5">
              <div className="rounded-[8px] border border-slate-200 bg-white p-5">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="text-[12px] font-semibold uppercase text-slate-500">Purchase Order</p>
                    <h2 className="text-[24px] font-bold">{selectedOrder.purchase_order.po_number}</h2>
                    <p className="text-[13px] text-slate-500">Warehouse: {selectedOrder.purchase_order.warehouse?.name || "-"} | Expected: {selectedOrder.purchase_order.expected_date ? new Date(selectedOrder.purchase_order.expected_date).toLocaleDateString() : "-"}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Badge className={statusTone(selectedOrder.purchase_order.status)}>{selectedOrder.purchase_order.status}</Badge>
                    <Badge className={statusTone(selectedOrder.dispatch.status)}>{selectedOrder.dispatch.status}</Badge>
                  </div>
                </div>
                <div className="mt-5 grid gap-3 sm:grid-cols-5">
                  {[
                    ["Ordered", totals.ordered],
                    ["Received", totals.received],
                    ["Remaining", totals.remaining],
                    ["Invoiced", totals.invoiced],
                    ["Open shortage", totals.shortage],
                  ].map(([label, value]) => (
                    <div key={label} className="rounded-[8px] border border-slate-100 bg-slate-50 p-3">
                      <p className="text-[11px] font-semibold uppercase text-slate-500">{label}</p>
                      <p className="mt-1 text-[20px] font-bold">{value}</p>
                    </div>
                  ))}
                </div>
                {selectedOrder.purchase_order.status === "SENT_TO_SUPPLIER" ? (
                  <Button className="mt-5" onClick={() => void confirmOrder()} disabled={working}>
                    <CheckCircle2 className="mr-2 h-4 w-4" /> Confirm order
                  </Button>
                ) : null}
              </div>

              <div className="rounded-[8px] border border-slate-200 bg-white p-5">
                <div className="mb-4 flex items-center gap-2">
                  <FileText className="h-4 w-4 text-sky-700" />
                  <h3 className="text-[16px] font-semibold">Create invoice / delivery note</h3>
                </div>
                <div className="grid gap-3 sm:grid-cols-4">
                  <input value={invoiceNumber} onChange={(event) => setInvoiceNumber(event.target.value)} className="rounded-[8px] border border-slate-200 px-3 py-2 text-[13px]" placeholder="Invoice number" />
                  <input value={deliveryNumber} onChange={(event) => setDeliveryNumber(event.target.value)} className="rounded-[8px] border border-slate-200 px-3 py-2 text-[13px]" placeholder="Delivery number" />
                  <input type="date" value={invoiceDate} onChange={(event) => setInvoiceDate(event.target.value)} className="rounded-[8px] border border-slate-200 px-3 py-2 text-[13px]" />
                  <input type="date" value={expectedDate} onChange={(event) => setExpectedDate(event.target.value)} className="rounded-[8px] border border-slate-200 px-3 py-2 text-[13px]" />
                </div>
                <textarea value={note} onChange={(event) => setNote(event.target.value)} className="mt-3 min-h-20 w-full rounded-[8px] border border-slate-200 px-3 py-2 text-[13px]" placeholder="Supplier note" />
                <div className="mt-4 overflow-x-auto">
                  <table className="w-full min-w-[760px] text-[13px]">
                    <thead className="bg-slate-50 text-left text-[11px] uppercase text-slate-500">
                      <tr>
                        <th className="px-3 py-2">Book</th>
                        <th className="px-3 py-2">SKU</th>
                        <th className="px-3 py-2">Ordered</th>
                        <th className="px-3 py-2">Received</th>
                        <th className="px-3 py-2">Remaining</th>
                        <th className="px-3 py-2">Invoice qty</th>
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
                            <input type="number" min={0} max={item.remaining_qty} value={lines[item.id] || 0} onChange={(event) => setLineQty(item.id, Number(event.target.value), item.remaining_qty)} className="w-24 rounded-[8px] border border-slate-200 px-2 py-1" />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <Button className="mt-4" onClick={() => void submitInvoice()} disabled={working || totals.remaining <= 0}>
                  <PackageCheck className="mr-2 h-4 w-4" /> Submit invoice
                </Button>
              </div>

              <div className="rounded-[8px] border border-slate-200 bg-white p-5">
                <h3 className="text-[16px] font-semibold">Shortage reports and redelivery</h3>
                {openShortages.length === 0 ? (
                  <p className="mt-3 text-[13px] text-slate-500">No open shortage reports.</p>
                ) : (
                  <div className="mt-4 space-y-4">
                    {openShortages.map((report) => (
                      <div key={report.id} className="rounded-[8px] border border-slate-200 p-4">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <p className="text-[13px] font-semibold">Shortage {report.id.slice(0, 8)}</p>
                            <p className="text-[12px] text-slate-500">{report.reason || "No reason"}</p>
                          </div>
                          <Badge className={statusTone(report.status)}>{report.status}</Badge>
                        </div>
                        <div className="mt-3 grid gap-2 sm:grid-cols-2">
                          {report.items.map((item) => (
                            <div key={item.id} className="rounded-[8px] bg-amber-50 p-3 text-[13px] text-amber-900">
                              <span className="font-semibold">{item.title || item.variant_id}</span> - shortage qty {item.shortage_qty}
                            </div>
                          ))}
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <Button size="sm" variant="outline" onClick={() => void acknowledge(report.id)} disabled={working}>Acknowledge</Button>
                          <Button size="sm" variant="outline" onClick={() => setRedeliveryReportId(report.id)}>Use for redelivery</Button>
                        </div>
                      </div>
                    ))}
                    {selectedShortage ? (
                      <div className="rounded-[8px] border border-sky-200 bg-sky-50 p-4">
                        <p className="text-[14px] font-semibold">Create redelivery for shortage {selectedShortage.id.slice(0, 8)}</p>
                        <div className="mt-3 space-y-2">
                          {selectedShortage.items.map((item) => (
                            <label key={item.id} className="flex items-center justify-between gap-3 text-[13px]">
                              <span>{item.title || item.variant_id}</span>
                              <input type="number" min={0} max={item.shortage_qty} value={Math.min(Number(lines[item.purchase_order_item_id] ?? item.shortage_qty), item.shortage_qty)} onChange={(event) => setLineQty(item.purchase_order_item_id, Number(event.target.value), item.shortage_qty)} className="w-24 rounded-[8px] border border-slate-200 px-2 py-1" />
                            </label>
                          ))}
                        </div>
                        <Button className="mt-4" onClick={() => void submitInvoice(selectedShortage)} disabled={working}>
                          <Truck className="mr-2 h-4 w-4" /> Submit redelivery invoice
                        </Button>
                        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                          <input value={cannotReason} onChange={(event) => setCannotReason(event.target.value)} className="flex-1 rounded-[8px] border border-slate-200 px-3 py-2 text-[13px]" placeholder="Reason if cannot fulfill" />
                          <Button variant="outline" onClick={() => void cannotFulfill(selectedShortage.id)} disabled={working}>Cannot fulfill</Button>
                        </div>
                      </div>
                    ) : null}
                  </div>
                )}
              </div>

              <div className="rounded-[8px] border border-slate-200 bg-white p-5">
                <h3 className="text-[16px] font-semibold">Submitted invoices</h3>
                {selectedOrder.invoices.length === 0 ? (
                  <p className="mt-3 text-[13px] text-slate-500">No invoice or delivery note submitted yet.</p>
                ) : (
                  <div className="mt-4 overflow-x-auto">
                    <table className="w-full min-w-[760px] text-[13px]">
                      <thead className="bg-slate-50 text-left text-[11px] uppercase text-slate-500">
                        <tr>
                          <th className="px-3 py-2">Invoice</th>
                          <th className="px-3 py-2">Delivery</th>
                          <th className="px-3 py-2">Status</th>
                          <th className="px-3 py-2">Qty</th>
                          <th className="px-3 py-2">Goods receipt</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedOrder.invoices.map((invoice) => (
                          <tr key={invoice.id} className="border-b border-slate-100">
                            <td className="px-3 py-2 font-medium">{invoice.invoice_number}</td>
                            <td className="px-3 py-2">{invoice.delivery_number || "-"}</td>
                            <td className="px-3 py-2"><Badge className={statusTone(invoice.status)}>{invoice.status}</Badge></td>
                            <td className="px-3 py-2">{invoice.items.reduce((sum, item) => sum + item.invoiced_qty, 0)}</td>
                            <td className="px-3 py-2">{invoice.goods_receipts?.map((receipt) => `${receipt.receipt_number} (${receipt.status})`).join(", ") || "-"}</td>
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
    </div>
  );
}
