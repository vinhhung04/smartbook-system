import { useEffect, useMemo, useState } from "react";
import { NavLink, useParams } from "react-router";
import { ArrowLeft, CheckCircle, Clipboard, Edit, ExternalLink, FileText, RefreshCw, Send, Truck, XCircle } from "lucide-react";
import { toast } from "sonner";
import { purchaseOrderService, type PurchaseOrderDetail, type ReconciliationResponse, type SupplierDocumentsResponse } from "@/services/purchase-order";
import { getApiErrorMessage } from "@/services/api";
import { StatusBadge } from "@/components/status-badge";
import { SectionCard } from "@/components/ui/section-card";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";

function statusVariant(status: string) {
  if (status === "RECEIVED" || status === "MATCHED" || status === "FULLY_RECEIVED") return "success";
  if (status === "APPROVED" || status === "SENT" || status === "ACKNOWLEDGED" || status === "SUPPLIER_CONFIRMED") return "primary";
  if (status === "PENDING_APPROVAL" || status === "UNDER_RECEIVED" || status === "PARTIALLY_RECEIVED" || status === "SENT_TO_SUPPLIER" || status === "SHORTAGE_REPORTED" || status === "SUBMITTED" || status === "OPEN") return "warning";
  if (status === "REJECTED" || status === "CANCELLED" || status === "OVER_RECEIVED" || status === "FAILED") return "danger";
  return "neutral";
}

function formatCurrency(value: number) {
  return `${Number(value || 0).toLocaleString("vi-VN")} VND`;
}

function formatDate(value?: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("vi-VN", { year: "numeric", month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export function PurchaseOrderDetailPage() {
  const { id } = useParams();
  const [po, setPo] = useState<PurchaseOrderDetail | null>(null);
  const [reconciliation, setReconciliation] = useState<ReconciliationResponse | null>(null);
  const [supplierDocs, setSupplierDocs] = useState<SupplierDocumentsResponse["data"] | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);

  const load = async () => {
    if (!id) return;
    try {
      setLoading(true);
      const [detail, rec, docs] = await Promise.all([
        purchaseOrderService.getById(id),
        purchaseOrderService.getReconciliation(id),
        purchaseOrderService.getSupplierDocuments(id),
      ]);
      setPo(detail);
      setReconciliation(rec);
      setSupplierDocs(docs.data);
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Failed to load purchase order"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const totalRemaining = useMemo(() => po?.items.reduce((sum, item) => sum + Number(item.remaining_qty || 0), 0) || 0, [po]);

  const runAction = async (label: string, action: () => Promise<unknown>) => {
    try {
      setWorking(true);
      await action();
      toast.success(label);
      await load();
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Action failed"));
    } finally {
      setWorking(false);
    }
  };

  const submit = () => {
    if (!id || !window.confirm("Submit this PO for approval?")) return;
    void runAction("Purchase order submitted", () => purchaseOrderService.submit(id));
  };

  const approve = () => {
    if (!id || !window.confirm("Approve this purchase order?")) return;
    void runAction("Purchase order approved", () => purchaseOrderService.approve(id, "Approved from UI"));
  };

  const sendToSupplier = () => {
    if (!id || !window.confirm("Send this PO to supplier?")) return;
    void runAction("Purchase order sent to supplier", () => purchaseOrderService.sendToSupplier(id));
  };

  const copyText = async (value: string, label: string) => {
    await navigator.clipboard.writeText(value);
    toast.success(`${label} copied`);
  };

  const reject = () => {
    if (!id) return;
    const reason = window.prompt("Reject reason", "Rejected from UI");
    if (!reason) return;
    void runAction("Purchase order rejected", () => purchaseOrderService.reject(id, reason));
  };

  const cancel = () => {
    if (!id || !window.confirm("Cancel this purchase order?")) return;
    void runAction("Purchase order cancelled", () => purchaseOrderService.cancel(id));
  };

  if (loading) {
    return <div className="p-6 lg:p-8 max-w-7xl mx-auto text-[13px] text-muted-foreground">Loading purchase order...</div>;
  }

  if (!po) {
    return <div className="p-6 lg:p-8 max-w-7xl mx-auto"><EmptyState variant="no-data" title="Purchase order not found" description="This PO may have been deleted or does not exist" /></div>;
  }

  const canEdit = ["DRAFT", "REJECTED"].includes(po.status);
  const canSubmit = ["DRAFT", "REJECTED"].includes(po.status);
  const canApprove = po.status === "PENDING_APPROVAL";
  const canSendToSupplier = po.status === "APPROVED";
  const canCancel = ["DRAFT", "REJECTED", "PENDING_APPROVAL", "APPROVED"].includes(po.status) && po.total_received_qty === 0;
  const latestOpenInvoice = supplierDocs?.invoices.find((invoice) => ["SUBMITTED", "PARTIALLY_RECEIVED", "SHORTAGE_REPORTED"].includes(invoice.status));

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
      <NavLink to="/purchase-orders" className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to Purchase Orders
      </NavLink>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight">{po.po_number}</h1>
            <StatusBadge label={po.status} variant={statusVariant(po.status)} dot />
          </div>
          <p className="mt-1 text-[12px] text-muted-foreground">{po.supplier?.name || po.supplier_name || "-"} {"->"} {po.warehouse?.code || po.warehouse_code || "-"}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={working}><RefreshCw className="h-3.5 w-3.5" />Refresh</Button>
          {canEdit && <NavLink to={`/purchase-orders/${po.id}/edit`} className="inline-flex items-center gap-2 rounded-md border border-input bg-background px-3 py-2 text-[13px] font-medium"><Edit className="h-3.5 w-3.5" />Edit</NavLink>}
          {canSubmit && <Button size="sm" onClick={submit} disabled={working}><FileText className="h-3.5 w-3.5" />Submit</Button>}
          {canApprove && <Button size="sm" onClick={approve} disabled={working}><CheckCircle className="h-3.5 w-3.5" />Approve</Button>}
          {canApprove && <Button variant="outline" size="sm" onClick={reject} disabled={working}><XCircle className="h-3.5 w-3.5" />Reject</Button>}
          {canSendToSupplier && <Button size="sm" onClick={sendToSupplier} disabled={working}><Send className="h-3.5 w-3.5" />Send to Supplier</Button>}
          {po.status === "SUPPLIER_CONFIRMED" && latestOpenInvoice ? (
            <Button asChild size="sm" disabled={working}>
              <NavLink to={`/supplier-deliveries/${latestOpenInvoice.id}`}>
                <Truck className="h-3.5 w-3.5" />Create GR from Invoice
              </NavLink>
            </Button>
          ) : null}
          {canCancel && <Button variant="outline" size="sm" onClick={cancel} disabled={working}>Cancel</Button>}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <SectionCard title="Supplier"><p className="text-[13px] font-medium">{po.supplier?.name || po.supplier_name || "-"}</p></SectionCard>
        <SectionCard title="Warehouse"><p className="text-[13px] font-medium">{po.warehouse?.code || po.warehouse_code || "-"} - {po.warehouse?.name || po.warehouse_name || ""}</p></SectionCard>
        <SectionCard title="Expected"><p className="text-[13px] font-medium">{formatDate(po.expected_date)}</p></SectionCard>
        <SectionCard title="Total"><p className="text-[16px] font-mono font-semibold">{formatCurrency(po.total_amount)}</p></SectionCard>
      </div>

      <SectionCard title="Timeline">
        <div className="grid gap-3 md:grid-cols-4">
          {po.timeline.map((step) => (
            <div key={step.label} className={`rounded-xl border p-3 ${step.completed ? "border-emerald-200 bg-emerald-50" : "border-input bg-muted/20"}`}>
              <div className="text-[13px] font-semibold">{step.label}</div>
              <div className="mt-1 text-[11px] text-muted-foreground">{step.completed ? formatDate(step.time) : "Pending"}</div>
            </div>
          ))}
        </div>
      </SectionCard>

      <SectionCard title="Reconciliation">
        <div className="grid gap-3 md:grid-cols-5">
          <div><div className="text-[11px] text-muted-foreground">Ordered</div><div className="text-lg font-semibold">{reconciliation?.summary.total_ordered_qty ?? po.total_ordered_qty}</div></div>
          <div><div className="text-[11px] text-muted-foreground">Received</div><div className="text-lg font-semibold">{reconciliation?.summary.total_received_qty ?? po.total_received_qty}</div></div>
          <div><div className="text-[11px] text-muted-foreground">Remaining</div><div className="text-lg font-semibold">{reconciliation?.summary.total_remaining_qty ?? totalRemaining}</div></div>
          <div><div className="text-[11px] text-muted-foreground">Matched Lines</div><div className="text-lg font-semibold">{reconciliation?.summary.matched_lines ?? 0}</div></div>
          <div><div className="text-[11px] text-muted-foreground">Status</div><StatusBadge label={reconciliation?.summary.reconciliation_status || po.reconciliation_status} variant={statusVariant(reconciliation?.summary.reconciliation_status || po.reconciliation_status)} /></div>
        </div>
      </SectionCard>

      {po.status === "SENT_TO_SUPPLIER" ? (
        <SectionCard title="Supplier Fulfillment" icon={Truck}>
          <div className="rounded-lg border border-sky-200 bg-sky-50 p-4 text-[13px] text-sky-800">
            Waiting for supplier confirmation. Goods receipt can only be created after the supplier confirms the order and submits an invoice or delivery note.
          </div>
        </SectionCard>
      ) : null}

      {supplierDocs?.dispatches.length ? (
        <SectionCard title="Supplier Dispatches" noPadding>
          <table className="w-full">
            <tbody>
              {supplierDocs.dispatches.map((dispatch) => (
                <tr key={dispatch.id} className="border-b border-border last:border-0">
                  <td className="px-5 py-3.5 text-[13px] font-semibold">{dispatch.dispatch_number}</td>
                  <td className="px-5 py-3.5"><StatusBadge label={dispatch.status} variant={statusVariant(dispatch.status)} /></td>
                  <td className="px-5 py-3.5 text-[12px] text-muted-foreground">{dispatch.channel}{dispatch.sent_to_email ? ` - ${dispatch.sent_to_email}` : " - demo/manual channel"}</td>
                  <td className="px-5 py-3.5 text-right">
                    {dispatch.portal_token ? (
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => void copyText(`${window.location.origin}/supplier/portal/${dispatch.portal_token}`, "Portal link")}
                        >
                          <Clipboard className="h-3.5 w-3.5" /> Copy Link
                        </Button>
                        <NavLink to={`/supplier/portal/${dispatch.portal_token}`} target="_blank" className="inline-flex items-center gap-1.5 rounded-md border border-input bg-background px-3 py-2 text-[13px] font-medium text-indigo-600 hover:text-indigo-800">
                          Open <ExternalLink className="h-3.5 w-3.5" />
                        </NavLink>
                      </div>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </SectionCard>
      ) : null}

      {supplierDocs?.invoices.length ? (
        <SectionCard title="Supplier Invoices / Delivery Notes" noPadding>
          <table className="w-full min-w-[760px]">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                {["Invoice", "Expected", "Status", "Lines", "Action"].map((heading) => (
                  <th key={heading} className="px-5 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{heading}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {supplierDocs.invoices.map((invoice) => (
                <tr key={invoice.id} className="border-b border-border last:border-0">
                  <td className="px-5 py-3.5 text-[13px] font-semibold">{invoice.invoice_number}</td>
                  <td className="px-5 py-3.5 text-[12px] text-muted-foreground">{formatDate(invoice.expected_delivery_date)}</td>
                  <td className="px-5 py-3.5"><StatusBadge label={invoice.status} variant={statusVariant(invoice.status)} /></td>
                  <td className="px-5 py-3.5 text-[13px]">{invoice.items.length}</td>
                  <td className="px-5 py-3.5">
                    {po.status !== "RECEIVED" && totalRemaining > 0 ? (
                      <NavLink to={`/supplier-deliveries/${invoice.id}`} className="inline-flex items-center gap-1.5 rounded-md border border-input bg-background px-3 py-2 text-[13px] font-medium">
                        <Truck className="h-3.5 w-3.5" /> Receive
                      </NavLink>
                    ) : (
                      <span className="text-[12px] text-muted-foreground">Closed</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </SectionCard>
      ) : null}

      {supplierDocs?.shortage_reports.length ? (
        <SectionCard title="Shortage Reports" noPadding>
          <table className="w-full min-w-[760px]">
            <tbody>
              {supplierDocs.shortage_reports.map((report) => {
                const shortageQty = report.items.reduce((sum, item) => sum + item.shortage_qty, 0);
                return (
                  <tr key={report.id} className="border-b border-border last:border-0">
                    <td className="px-5 py-3.5"><StatusBadge label={report.status} variant={statusVariant(report.status)} /></td>
                    <td className="px-5 py-3.5 text-[13px]">{shortageQty} units short</td>
                    <td className="px-5 py-3.5 text-[12px] text-muted-foreground">{report.reason || "-"}</td>
                    <td className="px-5 py-3.5 text-right">
                      {report.status === "OPEN" ? (
                        <Button variant="outline" size="sm" onClick={() => id && runAction("Shortage report sent", () => purchaseOrderService.sendShortageReport(id, report.id))} disabled={working}>Send to Supplier</Button>
                      ) : null}
                      {["OPEN", "SENT_TO_SUPPLIER", "ACKNOWLEDGED"].includes(report.status) ? (
                        <Button variant="outline" size="sm" onClick={() => id && window.confirm("Resolve this shortage report?") && runAction("Shortage report resolved", () => purchaseOrderService.resolveShortageReport(id, report.id))} disabled={working}>Resolve</Button>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </SectionCard>
      ) : null}

      <SectionCard title={`Items (${po.items.length})`} noPadding>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px]">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                {["Title", "ISBN/SKU", "Ordered", "Received", "Remaining", "Unit Cost", "Line Total", "Status"].map((heading) => (
                  <th key={heading} className="px-5 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{heading}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {po.items.map((item) => (
                <tr key={item.id} className="border-b border-border last:border-0">
                  <td className="px-5 py-3.5 text-[13px] font-medium">{item.title}</td>
                  <td className="px-5 py-3.5 text-[12px] font-mono text-muted-foreground">{item.isbn13 || item.sku || "-"}</td>
                  <td className="px-5 py-3.5 text-[13px]">{item.ordered_qty}</td>
                  <td className="px-5 py-3.5 text-[13px]">{item.received_qty}</td>
                  <td className="px-5 py-3.5 text-[13px]">{item.remaining_qty}</td>
                  <td className="px-5 py-3.5 text-[12px] font-mono">{formatCurrency(item.unit_cost)}</td>
                  <td className="px-5 py-3.5 text-[12px] font-mono">{formatCurrency(item.line_total)}</td>
                  <td className="px-5 py-3.5"><StatusBadge label={item.reconciliation_status} variant={statusVariant(item.reconciliation_status)} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionCard>

      <SectionCard title="Linked Goods Receipts" noPadding>
        {po.goods_receipts.length === 0 ? (
          <EmptyState variant="no-data" title="No linked receipts" description="Create a goods receipt after approval" className="py-10" />
        ) : (
          <table className="w-full">
            <tbody>
              {po.goods_receipts.map((receipt) => (
                <tr key={receipt.id} className="border-b border-border last:border-0">
                  <td className="px-5 py-3.5"><NavLink to={`/orders/${receipt.id}`} className="text-[13px] font-semibold text-indigo-600">{receipt.receipt_number}</NavLink></td>
                  <td className="px-5 py-3.5"><StatusBadge label={receipt.status} variant={statusVariant(receipt.status)} /></td>
                  <td className="px-5 py-3.5 text-[13px]">{receipt.total_quantity} units</td>
                  <td className="px-5 py-3.5 text-[12px] text-muted-foreground">{formatDate(receipt.received_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </SectionCard>

    </div>
  );
}
