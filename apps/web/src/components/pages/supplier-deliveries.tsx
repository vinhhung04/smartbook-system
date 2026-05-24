import { useEffect, useMemo, useState } from "react";
import { NavLink, useNavigate, useParams } from "react-router";
import { AlertCircle, ArrowLeft, ClipboardCheck, FileText, RefreshCw, Search, Truck } from "lucide-react";
import { toast } from "sonner";
import { supplierDeliveryService, type SupplierDeliveryDetail } from "@/services/supplier-delivery";
import { getApiErrorMessage } from "@/services/api";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { SectionCard } from "@/components/ui/section-card";
import { StatusBadge } from "@/components/status-badge";

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
      toast.error(getApiErrorMessage(error, "Failed to load supplier deliveries"));
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
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-sky-50 text-sky-700">
            <Truck className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Supplier Deliveries</h1>
            <p className="mt-0.5 text-[12px] text-muted-foreground">Invoice, delivery notes, redeliveries, and receiving drafts</p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
        </Button>
      </div>

      <SectionCard>
        <div className="grid gap-3 md:grid-cols-[1fr_220px]">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search invoice, PO, supplier, warehouse..."
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
                {["Invoice", "PO", "Supplier", "Warehouse", "Expected", "Qty", "Accepted", "Status", "Action"].map((heading) => (
                  <th key={heading} className="px-5 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{heading}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={9} className="px-5 py-10 text-center text-[13px] text-muted-foreground">Loading supplier deliveries...</td></tr>
              ) : filteredRows.length === 0 ? (
                <tr><td colSpan={9}><EmptyState variant="no-data" title="No supplier deliveries" description="Supplier invoices and delivery notes will appear here." className="py-12" /></td></tr>
              ) : filteredRows.map((row) => {
                const totalQty = row.items.reduce((sum, item) => sum + Number(item.invoiced_qty || 0), 0);
                const acceptedQty = row.items.reduce((sum, item) => sum + Number(item.accepted_qty || 0), 0);
                const canReceive = ["SUBMITTED", "PARTIALLY_RECEIVED", "SHORTAGE_REPORTED"].includes(row.status);
                return (
                  <tr key={row.id} className="border-b border-border last:border-0 hover:bg-muted/30">
                    <td className="px-5 py-3.5">
                      <NavLink to={`/supplier-deliveries/${row.id}`} className="text-[13px] font-semibold text-indigo-600 hover:text-indigo-800">{row.invoice_number}</NavLink>
                      <div className="text-[11px] text-muted-foreground">{row.delivery_number || "-"}</div>
                    </td>
                    <td className="px-5 py-3.5">
                      {row.purchase_order_id ? <NavLink to={`/purchase-orders/${row.purchase_order_id}`} className="text-[13px] text-indigo-600">{row.po_number || row.purchase_order_id}</NavLink> : "-"}
                    </td>
                    <td className="px-5 py-3.5 text-[13px]">{row.supplier_name || "-"}</td>
                    <td className="px-5 py-3.5 text-[13px]">{row.warehouse_code || row.warehouse_name || "-"}</td>
                    <td className="px-5 py-3.5 text-[12px] text-muted-foreground">{formatDate(row.expected_delivery_date)}</td>
                    <td className="px-5 py-3.5 text-[13px]">{totalQty}</td>
                    <td className="px-5 py-3.5 text-[13px]">{acceptedQty}</td>
                    <td className="px-5 py-3.5"><StatusBadge label={row.status} variant={statusVariant(row.status)} dot /></td>
                    <td className="px-5 py-3.5">
                      <Button size="sm" variant={canReceive ? "default" : "outline"} disabled={!canReceive} onClick={() => navigate(`/supplier-deliveries/${row.id}`)}>
                        <ClipboardCheck className="h-3.5 w-3.5" /> {canReceive ? "Receive" : "Closed"}
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
  const [countedQty, setCountedQty] = useState<Record<string, number>>({});
  const [note, setNote] = useState("");

  const load = async () => {
    try {
      setLoading(true);
      const response = await supplierDeliveryService.getById(id);
      setInvoice(response.data);
      setCountedQty(Object.fromEntries(response.data.items.map((item) => [item.id, Math.min(item.remaining_qty, item.invoiced_qty)])));
      setNote(`Receive supplier invoice ${response.data.invoice_number}`);
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Failed to load supplier delivery"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const totals = useMemo(() => {
    if (!invoice) return { counted: 0, amount: 0, shortage: 0, invalid: false };
    return invoice.items.reduce(
      (acc, item) => {
        const qty = Number(countedQty[item.id] || 0);
        acc.counted += qty;
        acc.amount += qty * Number(item.unit_cost || 0);
        acc.shortage += Math.max(0, Number(item.invoiced_qty || 0) - qty, Number(item.remaining_qty || 0) - qty);
        if (qty > item.remaining_qty || qty > item.invoiced_qty) acc.invalid = true;
        return acc;
      },
      { counted: 0, amount: 0, shortage: 0, invalid: false },
    );
  }, [countedQty, invoice]);

  const createDraft = async () => {
    if (!invoice) return;
    const items = invoice.items
      .filter((item) => Number(countedQty[item.id] || 0) > 0)
      .map((item) => ({
        invoice_item_id: item.id,
        purchase_order_item_id: item.purchase_order_item_id,
        variant_id: item.variant_id,
        delivered_qty: Number(countedQty[item.id] || 0),
        unit_cost: item.unit_cost,
        location_id: null,
        note: Number(countedQty[item.id] || 0) < item.invoiced_qty ? "Supplier delivered short" : null,
      }));
    if (items.length === 0) return toast.error("Enter at least one counted quantity");
    if (totals.invalid) return toast.error("Counted quantity cannot exceed invoice or PO remaining quantity");
    if (!window.confirm("Create Goods Receipt draft from this supplier invoice?")) return;

    try {
      setSaving(true);
      const response = await supplierDeliveryService.createGoodsReceiptFromInvoice(invoice.id, {
        warehouse_id: invoice.warehouse_id || "",
        note,
        items,
      });
      toast.success(`Goods Receipt ${response.data.receipt_number} created in DRAFT`);
      navigate(`/orders/${response.data.id}`);
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Failed to create goods receipt draft"));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="p-6 lg:p-8 max-w-7xl mx-auto text-[13px] text-muted-foreground">Loading supplier delivery...</div>;
  }

  if (!invoice) {
    return <div className="p-6 lg:p-8 max-w-7xl mx-auto"><EmptyState variant="no-data" title="Supplier delivery not found" description="This invoice may have been deleted." /></div>;
  }

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
      <NavLink to="/supplier-deliveries" className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-3.5 w-3.5" /> Back to Supplier Deliveries
      </NavLink>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight">Receive Supplier Delivery</h1>
            <StatusBadge label={invoice.status} variant={statusVariant(invoice.status)} dot />
          </div>
          <p className="mt-1 text-[12px] text-muted-foreground">
            {invoice.po_number || "-"} - {invoice.supplier_name || "-"} - Invoice {invoice.invoice_number}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={saving}>
          <RefreshCw className={`h-3.5 w-3.5 ${saving ? "animate-spin" : ""}`} /> Refresh
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <SectionCard title="Warehouse"><p className="text-[13px] font-medium">{invoice.warehouse_code || "-"} - {invoice.warehouse_name || ""}</p></SectionCard>
        <SectionCard title="Expected"><p className="text-[13px] font-medium">{formatDate(invoice.expected_delivery_date)}</p></SectionCard>
        <SectionCard title="Counted"><p className="text-lg font-semibold">{totals.counted}</p></SectionCard>
        <SectionCard title="Value"><p className="font-mono text-[13px] font-semibold">{formatCurrency(totals.amount)}</p></SectionCard>
      </div>

      <SectionCard title="Receiving Comparison" noPadding>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1100px]">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                {["Title", "ISBN/SKU", "Ordered", "Previously Received", "PO Remaining", "Invoiced", "Staff Counted", "Shortage", "Status"].map((heading) => (
                  <th key={heading} className="px-5 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{heading}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {invoice.items.map((item) => {
                const qty = Number(countedQty[item.id] || 0);
                const shortage = Math.max(0, Number(item.invoiced_qty || 0) - qty, Number(item.remaining_qty || 0) - qty);
                const invalid = qty > item.remaining_qty || qty > item.invoiced_qty;
                const status = invalid ? "OVER_BLOCKED" : shortage > 0 ? "SHORTAGE" : "MATCHED";
                return (
                  <tr key={item.id} className="border-b border-border last:border-0">
                    <td className="px-5 py-3.5 text-[13px] font-semibold">{item.title || "-"}</td>
                    <td className="px-5 py-3.5 font-mono text-[12px] text-muted-foreground">{item.isbn13 || item.sku || item.variant_id}</td>
                    <td className="px-5 py-3.5 text-[13px]">{item.ordered_qty}</td>
                    <td className="px-5 py-3.5 text-[13px]">{item.previously_received_qty}</td>
                    <td className="px-5 py-3.5 text-[13px]">{item.remaining_qty}</td>
                    <td className="px-5 py-3.5 text-[13px]">{item.invoiced_qty}</td>
                    <td className="px-5 py-3.5">
                      <input
                        type="number"
                        min={0}
                        max={Math.min(item.remaining_qty, item.invoiced_qty)}
                        value={qty}
                        onChange={(event) => {
                          const max = Math.min(Number(item.remaining_qty || 0), Number(item.invoiced_qty || 0));
                          const next = Math.min(max, Math.max(0, Number(event.target.value) || 0));
                          setCountedQty((current) => ({ ...current, [item.id]: next }));
                        }}
                        className="w-24 rounded-lg border border-input bg-background px-2 py-1.5 text-[12px]"
                      />
                    </td>
                    <td className="px-5 py-3.5 text-[13px]">{shortage}</td>
                    <td className="px-5 py-3.5"><StatusBadge label={status} variant={status === "MATCHED" ? "success" : status === "SHORTAGE" ? "warning" : "danger"} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </SectionCard>

      <div className="rounded-lg border border-sky-200 bg-sky-50 p-4 text-[13px] text-sky-900">
        Stock increases only after this Goods Receipt is POSTED. No location selected: items will be placed in receiving hold.
      </div>
      {totals.shortage > 0 ? (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-4 text-[13px] text-amber-800">
          <AlertCircle className="mt-0.5 h-4 w-4" /> Shortage report will be created for counted quantities below invoice or PO remaining quantity.
        </div>
      ) : null}

      <SectionCard title="Receipt Note" icon={FileText}>
        <div className="p-5">
          <textarea value={note} onChange={(event) => setNote(event.target.value)} rows={3} className="w-full rounded-lg border border-input bg-background px-3 py-2 text-[13px]" />
        </div>
      </SectionCard>

      <div className="flex justify-end">
        <Button onClick={() => void createDraft()} disabled={saving || totals.counted <= 0 || totals.invalid}>
          <ClipboardCheck className="h-3.5 w-3.5" /> {saving ? "Creating..." : "Create Goods Receipt Draft"}
        </Button>
      </div>
    </div>
  );
}
