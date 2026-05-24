import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router";
import { CheckCircle2, FileText, RefreshCw, Truck } from "lucide-react";
import { toast } from "sonner";
import { supplierPortalService, type SupplierPortalOrder } from "@/services/supplier-portal";
import { getApiErrorMessage } from "@/services/api";
import { Button } from "@/components/ui/button";

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export function SupplierPortalPage() {
  const { token } = useParams();
  const [order, setOrder] = useState<SupplierPortalOrder | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [invoiceNumber, setInvoiceNumber] = useState(`INV-${Date.now()}`);
  const [invoiceDate, setInvoiceDate] = useState(todayIso());
  const [expectedDeliveryDate, setExpectedDeliveryDate] = useState(todayIso());
  const [invoiceQty, setInvoiceQty] = useState<Record<string, number>>({});

  const load = async () => {
    if (!token) return;
    try {
      setLoading(true);
      const response = await supplierPortalService.getPortalOrder(token);
      setOrder(response.data);
      const qty: Record<string, number> = {};
      response.data.purchase_order.items.forEach((item) => {
        qty[item.id] = item.remaining_qty;
      });
      setInvoiceQty(qty);
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Failed to load supplier order"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const totalQty = useMemo(() => {
    if (!order) return 0;
    return order.purchase_order.items.reduce((sum, item) => sum + Number(invoiceQty[item.id] || 0), 0);
  }, [invoiceQty, order]);

  const confirmOrder = async () => {
    if (!token) return;
    try {
      setWorking(true);
      await supplierPortalService.confirmPortalOrder(token);
      toast.success("Order confirmed");
      await load();
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Confirm failed"));
    } finally {
      setWorking(false);
    }
  };

  const createInvoice = async () => {
    if (!token || !order) return;
    const items = order.purchase_order.items
      .filter((item) => Number(invoiceQty[item.id] || 0) > 0)
      .map((item) => ({
        purchase_order_item_id: item.id,
        invoiced_qty: Number(invoiceQty[item.id] || 0),
        unit_cost: item.unit_cost,
      }));
    if (!invoiceNumber.trim()) {
      toast.error("Invoice number is required");
      return;
    }
    if (items.length === 0) {
      toast.error("Invoice must include at least one line");
      return;
    }
    try {
      setWorking(true);
      await supplierPortalService.createPortalInvoice(token, {
        invoice_number: invoiceNumber.trim(),
        invoice_date: invoiceDate,
        expected_delivery_date: expectedDeliveryDate,
        items,
      });
      toast.success("Invoice / delivery note submitted");
      setInvoiceNumber(`INV-${Date.now()}`);
      await load();
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Create invoice failed"));
    } finally {
      setWorking(false);
    }
  };

  if (loading) {
    return <div className="mx-auto max-w-6xl p-6 text-[13px] text-slate-500">Loading supplier portal...</div>;
  }

  if (!order) {
    return <div className="mx-auto max-w-6xl p-6 text-[13px] text-slate-500">Supplier order not found.</div>;
  }

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-6 lg:p-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-[12px] font-semibold text-amber-800">
            Demo supplier portal
          </div>
          <h1 className="mt-3 text-2xl font-semibold tracking-tight">{order.purchase_order.po_number}</h1>
          <p className="mt-1 text-[13px] text-slate-500">
            {order.purchase_order.supplier?.name || "-"} - {order.purchase_order.warehouse?.code || "-"} - Dispatch {order.dispatch.dispatch_number}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={working}><RefreshCw className="h-3.5 w-3.5" />Refresh</Button>
          {order.purchase_order.status === "SENT_TO_SUPPLIER" ? (
            <Button size="sm" onClick={() => void confirmOrder()} disabled={working}><CheckCircle2 className="h-3.5 w-3.5" />Confirm Order</Button>
          ) : null}
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <p className="text-[11px] font-semibold uppercase text-slate-400">PO status</p>
          <p className="mt-1 text-[13px] font-semibold">{order.purchase_order.status}</p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <p className="text-[11px] font-semibold uppercase text-slate-400">Dispatch</p>
          <p className="mt-1 text-[13px] font-semibold">{order.dispatch.status}</p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <p className="text-[11px] font-semibold uppercase text-slate-400">Expected</p>
          <p className="mt-1 text-[13px] font-semibold">{order.purchase_order.expected_date ? new Date(order.purchase_order.expected_date).toLocaleDateString("vi-VN") : "-"}</p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <p className="text-[11px] font-semibold uppercase text-slate-400">Invoice qty</p>
          <p className="mt-1 text-[18px] font-bold">{totalQty}</p>
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <div className="flex items-center gap-2 border-b border-slate-100 px-5 py-4">
          <Truck className="h-4 w-4 text-slate-500" />
          <h2 className="text-[14px] font-semibold">Purchase Order Lines</h2>
        </div>
        <table className="w-full min-w-[760px]">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50">
              {["Title", "ISBN/SKU", "Ordered", "Received", "Remaining", "Unit Cost"].map((heading) => (
                <th key={heading} className="px-5 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">{heading}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {order.purchase_order.items.map((item) => (
              <tr key={item.id} className="border-b border-slate-100 last:border-0">
                <td className="px-5 py-3.5 text-[13px] font-semibold">{item.title || "-"}</td>
                <td className="px-5 py-3.5 font-mono text-[12px] text-slate-500">{item.isbn13 || item.sku || item.variant_id}</td>
                <td className="px-5 py-3.5 text-[13px]">{item.ordered_qty}</td>
                <td className="px-5 py-3.5 text-[13px]">{item.received_qty}</td>
                <td className="px-5 py-3.5 text-[13px]">{item.remaining_qty}</td>
                <td className="px-5 py-3.5 font-mono text-[12px]">{Number(item.unit_cost).toLocaleString("vi-VN")} VND</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-5">
        <div className="mb-4 flex items-center gap-2">
          <FileText className="h-4 w-4 text-slate-500" />
          <h2 className="text-[14px] font-semibold">Create Invoice / Delivery Note</h2>
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          <input value={invoiceNumber} onChange={(event) => setInvoiceNumber(event.target.value)} className="rounded-lg border border-slate-200 px-3 py-2 text-[13px]" />
          <input type="date" value={invoiceDate} onChange={(event) => setInvoiceDate(event.target.value)} className="rounded-lg border border-slate-200 px-3 py-2 text-[13px]" />
          <input type="date" value={expectedDeliveryDate} onChange={(event) => setExpectedDeliveryDate(event.target.value)} className="rounded-lg border border-slate-200 px-3 py-2 text-[13px]" />
        </div>
        <div className="mt-4 space-y-2">
          {order.purchase_order.items.map((item) => (
            <div key={item.id} className="grid grid-cols-[1fr_120px] gap-3 rounded-lg border border-slate-100 p-3">
              <div>
                <p className="text-[13px] font-medium">{item.title || item.variant_id}</p>
                <p className="text-[11px] text-slate-500">Remaining {item.remaining_qty}</p>
              </div>
              <input
                type="number"
                min={0}
                max={item.remaining_qty}
                value={invoiceQty[item.id] ?? 0}
                onChange={(event) => {
                  const next = Math.min(item.remaining_qty, Math.max(0, Number(event.target.value) || 0));
                  setInvoiceQty((current) => ({ ...current, [item.id]: next }));
                }}
                className="rounded-lg border border-slate-200 px-3 py-2 text-[13px]"
              />
            </div>
          ))}
        </div>
        <div className="mt-4 flex justify-end">
          <Button onClick={() => void createInvoice()} disabled={working}>Submit Invoice</Button>
        </div>
      </div>

      {order.invoices.length ? (
        <div className="rounded-lg border border-slate-200 bg-white p-5">
          <h2 className="text-[14px] font-semibold">Submitted Documents</h2>
          <div className="mt-3 space-y-2">
            {order.invoices.map((invoice) => (
              <div key={invoice.id} className="flex items-center justify-between rounded-lg border border-slate-100 px-3 py-2 text-[13px]">
                <span className="font-semibold">{invoice.invoice_number}</span>
                <span className="text-slate-500">{invoice.status}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
