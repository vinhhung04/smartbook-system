import { useEffect, useMemo, useState } from "react";
import { NavLink, useNavigate, useParams } from "react-router";
import { ArrowLeft, CheckCircle, ClipboardCheck, Edit, FileText, RefreshCw, XCircle } from "lucide-react";
import { toast } from "sonner";
import { purchaseOrderService, type PurchaseOrderDetail, type ReconciliationResponse } from "@/services/purchase-order";
import { getApiErrorMessage } from "@/services/api";
import { StatusBadge } from "@/components/status-badge";
import { SectionCard } from "@/components/ui/section-card";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";

function statusVariant(status: string) {
  if (status === "RECEIVED" || status === "MATCHED" || status === "FULLY_RECEIVED") return "success";
  if (status === "APPROVED") return "primary";
  if (status === "PENDING_APPROVAL" || status === "UNDER_RECEIVED" || status === "PARTIALLY_RECEIVED") return "warning";
  if (status === "REJECTED" || status === "CANCELLED" || status === "OVER_RECEIVED") return "danger";
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
  const navigate = useNavigate();
  const [po, setPo] = useState<PurchaseOrderDetail | null>(null);
  const [reconciliation, setReconciliation] = useState<ReconciliationResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [receiptModalOpen, setReceiptModalOpen] = useState(false);
  const [receiptQty, setReceiptQty] = useState<Record<string, number>>({});

  const load = async () => {
    if (!id) return;
    try {
      setLoading(true);
      const [detail, rec] = await Promise.all([
        purchaseOrderService.getById(id),
        purchaseOrderService.getReconciliation(id),
      ]);
      setPo(detail);
      setReconciliation(rec);
      const qty: Record<string, number> = {};
      detail.items.forEach((item) => {
        if (item.remaining_qty > 0) qty[item.id] = item.remaining_qty;
      });
      setReceiptQty(qty);
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

  const createReceipt = async () => {
    if (!id || !po) return;
    const items = po.items
      .filter((item) => Number(receiptQty[item.id] || 0) > 0)
      .map((item) => ({
        purchase_order_item_id: item.id,
        variant_id: item.variant_id,
        quantity: Number(receiptQty[item.id] || 0),
        unit_cost: item.unit_cost,
        location_id: null,
      }));
    if (items.length === 0) {
      toast.error("Enter at least one receive quantity");
      return;
    }
    try {
      setWorking(true);
      const response = await purchaseOrderService.createGoodsReceiptFromPo(id, {
        note: "Created from Purchase Order UI",
        items,
      });
      toast.success(`Goods receipt ${response.data.receipt_number} created as DRAFT`);
      setReceiptModalOpen(false);
      await load();
      navigate(`/orders/${response.data.id}`);
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Failed to create goods receipt"));
    } finally {
      setWorking(false);
    }
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
  const canReceive = ["APPROVED", "PARTIALLY_RECEIVED"].includes(po.status) && totalRemaining > 0;
  const canCancel = ["DRAFT", "REJECTED", "PENDING_APPROVAL", "APPROVED"].includes(po.status) && po.total_received_qty === 0;

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
          {canReceive && <Button size="sm" onClick={() => setReceiptModalOpen(true)} disabled={working}><ClipboardCheck className="h-3.5 w-3.5" />Create GR</Button>}
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

      {receiptModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-3xl rounded-xl bg-background p-5 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold">Create Goods Receipt Draft</h2>
                <p className="text-[12px] text-muted-foreground">Stock updates only after posting the receipt.</p>
              </div>
              <button onClick={() => setReceiptModalOpen(false)} className="rounded-lg px-2 py-1 text-muted-foreground hover:bg-muted">Close</button>
            </div>
            <div className="max-h-[55vh] space-y-2 overflow-y-auto">
              {po.items.filter((item) => item.remaining_qty > 0).map((item) => (
                <div key={item.id} className="grid grid-cols-[1fr_120px] gap-3 rounded-lg border border-border p-3">
                  <div>
                    <div className="text-[13px] font-medium">{item.title}</div>
                    <div className="text-[11px] text-muted-foreground">Remaining {item.remaining_qty} - {item.isbn13 || item.sku || item.variant_id}</div>
                  </div>
                  <input type="number" min={0} max={item.remaining_qty} value={receiptQty[item.id] ?? 0} onChange={(e) => setReceiptQty((current) => ({ ...current, [item.id]: Number(e.target.value) }))} className="rounded-lg border border-input bg-background px-3 py-2 text-[13px]" />
                </div>
              ))}
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="outline" onClick={() => setReceiptModalOpen(false)}>Cancel</Button>
              <Button onClick={() => void createReceipt()} disabled={working}>Create Draft</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
