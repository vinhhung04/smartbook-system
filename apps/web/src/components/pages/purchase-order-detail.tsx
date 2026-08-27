import { useEffect, useMemo, useState } from "react";
import { NavLink, useParams } from "react-router";
import { ArrowLeft, CheckCircle, Clipboard, ClipboardList, Edit, ExternalLink, FileText, RefreshCw, Send, Truck, XCircle } from "lucide-react";
import { toast } from "sonner";
import { purchaseOrderService, type PurchaseOrderDetail, type ReconciliationResponse, type SupplierDocumentsResponse } from "@/services/purchase-order";
import { getApiErrorMessage } from "@/services/api";
import { StatusBadge } from "@/components/status-badge";
import { SectionCard } from "@/components/ui/section-card";
import { EmptyState } from "@/components/ui/empty-state";
import { LoadingOverlay } from "@/components/ui/loading-state";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Textarea } from "@/components/ui/textarea";
import { PageWrapper, FadeItem } from "../motion-utils";
import { authService } from "@/services/auth";
import { canAccess, ROUTE_ACCESS } from "@/lib/rbac";
import { getStatusVariant } from "@/lib/status-registry";

type PendingAction =
  | { type: "submit" }
  | { type: "approve" }
  | { type: "send" }
  | { type: "cancel" }
  | { type: "reject" }
  | { type: "resolveShortage"; reportId: string };

function statusVariant(status: string) {
  return getStatusVariant("purchaseOrder", status);
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

function getActionDialogConfig(pendingAction: PendingAction | null, poNumber: string | undefined) {
  const label = poNumber || "this purchase order";
  if (!pendingAction) return null;

  switch (pendingAction.type) {
    case "submit":
      return { title: "Submit for approval", description: `Submit ${label} for approval?`, confirmLabel: "Submit", variant: "default" as const };
    case "approve":
      return { title: "Approve purchase order", description: `Approve ${label}?`, confirmLabel: "Approve", variant: "default" as const };
    case "send":
      return { title: "Send to supplier", description: `Send ${label} to the supplier?`, confirmLabel: "Send", variant: "default" as const };
    case "cancel":
      return { title: "Cancel purchase order", description: `Cancel ${label}? This action cannot be undone.`, confirmLabel: "Cancel PO", variant: "destructive" as const };
    case "reject":
      return { title: "Reject purchase order", description: `Reject ${label}. Provide a reason below.`, confirmLabel: "Reject", variant: "destructive" as const };
    case "resolveShortage":
      return { title: "Resolve shortage report", description: "Mark this shortage report as resolved?", confirmLabel: "Resolve", variant: "default" as const };
    default:
      return null;
  }
}

export function PurchaseOrderDetailPage() {
  const currentUser = authService.getCurrentUser();
  const canManagePurchaseOrder = canAccess(currentUser, ROUTE_ACCESS.purchaseWrite);
  const canApprovePurchaseOrder = canAccess(currentUser, ROUTE_ACCESS.purchaseApprove);
  const canReceiveStock = canAccess(currentUser, ROUTE_ACCESS.stockWrite);
  const { id } = useParams();
  const [po, setPo] = useState<PurchaseOrderDetail | null>(null);
  const [reconciliation, setReconciliation] = useState<ReconciliationResponse | null>(null);
  const [supplierDocs, setSupplierDocs] = useState<SupplierDocumentsResponse["data"] | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);

  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [rejectReason, setRejectReason] = useState("Rejected from UI");

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
      return true;
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Action failed"));
      return false;
    } finally {
      setWorking(false);
    }
  };

  const submit = () => setPendingAction({ type: "submit" });
  const approve = () => setPendingAction({ type: "approve" });
  const sendToSupplier = () => setPendingAction({ type: "send" });
  const cancel = () => setPendingAction({ type: "cancel" });
  const reject = () => {
    setRejectReason("Rejected from UI");
    setPendingAction({ type: "reject" });
  };

  const copyText = async (value: string, label: string) => {
    await navigator.clipboard.writeText(value);
    toast.success(`${label} copied`);
  };

  const closeActionDialog = () => {
    if (working) return;
    setPendingAction(null);
    setRejectReason("Rejected from UI");
  };

  const handleConfirmAction = async () => {
    if (!pendingAction || !id) return;

    let ok = false;
    if (pendingAction.type === "submit") {
      ok = await runAction("Purchase order submitted", () => purchaseOrderService.submit(id));
    } else if (pendingAction.type === "approve") {
      ok = await runAction("Purchase order approved", () => purchaseOrderService.approve(id, "Approved from UI"));
    } else if (pendingAction.type === "send") {
      ok = await runAction("Purchase order sent to supplier", () => purchaseOrderService.sendToSupplier(id));
    } else if (pendingAction.type === "cancel") {
      ok = await runAction("Purchase order cancelled", () => purchaseOrderService.cancel(id));
    } else if (pendingAction.type === "reject") {
      const reason = rejectReason.trim();
      if (!reason) {
        toast.error("Reject reason is required");
        return;
      }
      ok = await runAction("Purchase order rejected", () => purchaseOrderService.reject(id, reason));
    } else if (pendingAction.type === "resolveShortage") {
      ok = await runAction("Shortage report resolved", () => purchaseOrderService.resolveShortageReport(id, pendingAction.reportId));
    }

    if (ok) {
      setPendingAction(null);
      setRejectReason("Rejected from UI");
    }
  };

  if (loading) {
    return (
      <PageWrapper>
        <LoadingOverlay />
      </PageWrapper>
    );
  }

  if (!po) {
    return (
      <PageWrapper>
        <EmptyState variant="no-data" title="Purchase order not found" description="This PO may have been deleted or does not exist" />
      </PageWrapper>
    );
  }

  const canEdit = canManagePurchaseOrder && ["DRAFT", "REJECTED"].includes(po.status);
  const canSubmit = canManagePurchaseOrder && ["DRAFT", "REJECTED"].includes(po.status);
  const canApprove = canApprovePurchaseOrder && po.status === "PENDING_APPROVAL";
  const canSendToSupplier = canManagePurchaseOrder && po.status === "APPROVED";
  const canCancel = canManagePurchaseOrder && ["DRAFT", "REJECTED", "PENDING_APPROVAL", "APPROVED"].includes(po.status) && po.total_received_qty === 0;
  const latestOpenInvoice = supplierDocs?.invoices.find((invoice) => ["SUBMITTED", "PARTIALLY_RECEIVED", "SHORTAGE_REPORTED"].includes(invoice.status));
  const dialogConfig = getActionDialogConfig(pendingAction, po.po_number);

  return (
    <PageWrapper className="space-y-6">
      <FadeItem>
        <NavLink to="/purchase-orders" className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to Purchase Orders
        </NavLink>
      </FadeItem>

      <FadeItem>
        <PageHeader
          icon={ClipboardList}
          title={po.po_number}
          description={`${po.supplier?.name || po.supplier_name || "-"} -> ${po.warehouse?.code || po.warehouse_code || "-"}`}
          iconBg="bg-gradient-to-br from-indigo-600 to-sky-600 shadow-lg shadow-indigo-500/20"
          iconColor="text-white"
          actions={(
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge label={po.status} variant={statusVariant(po.status)} dot />
              <Button variant="outline" size="sm" onClick={() => void load()} disabled={working}>
                <RefreshCw className="h-3.5 w-3.5" />
                Refresh
              </Button>
              {canEdit && (
                <Button asChild variant="outline" size="sm">
                  <NavLink to={`/purchase-orders/${po.id}/edit`}>
                    <Edit className="h-3.5 w-3.5" />
                    Edit
                  </NavLink>
                </Button>
              )}
              {canSubmit && <Button size="sm" onClick={submit} disabled={working}><FileText className="h-3.5 w-3.5" />Submit</Button>}
              {canApprove && <Button size="sm" onClick={approve} disabled={working}><CheckCircle className="h-3.5 w-3.5" />Approve</Button>}
              {canApprove && <Button variant="outline" size="sm" onClick={reject} disabled={working}><XCircle className="h-3.5 w-3.5" />Reject</Button>}
              {canSendToSupplier && <Button size="sm" onClick={sendToSupplier} disabled={working}><Send className="h-3.5 w-3.5" />Send to Supplier</Button>}
              {canReceiveStock && po.status === "SUPPLIER_CONFIRMED" && latestOpenInvoice ? (
                <Button asChild size="sm" disabled={working}>
                  <NavLink to={`/supplier-deliveries/${latestOpenInvoice.id}`}>
                    <Truck className="h-3.5 w-3.5" />Create GR from Invoice
                  </NavLink>
                </Button>
              ) : null}
              {canCancel && <Button variant="outline" size="sm" onClick={cancel} disabled={working}>Cancel</Button>}
            </div>
          )}
        />
      </FadeItem>

      <FadeItem>
        <div className="grid gap-4 md:grid-cols-4">
          <SectionCard title="Supplier"><p className="text-[13px] font-medium">{po.supplier?.name || po.supplier_name || "-"}</p></SectionCard>
          <SectionCard title="Warehouse"><p className="text-[13px] font-medium">{po.warehouse?.code || po.warehouse_code || "-"} - {po.warehouse?.name || po.warehouse_name || ""}</p></SectionCard>
          <SectionCard title="Expected"><p className="text-[13px] font-medium">{formatDate(po.expected_date)}</p></SectionCard>
          <SectionCard title="Total"><p className="text-[16px] font-mono font-semibold">{formatCurrency(po.total_amount)}</p></SectionCard>
        </div>
      </FadeItem>

      <FadeItem>
        <SectionCard title="Timeline">
          <div className="grid gap-3 md:grid-cols-4">
            {po.timeline.map((step) => (
              <div key={step.label} className={`rounded-xl border p-3 ${step.completed ? "border-emerald-200 bg-emerald-50 dark:border-emerald-500/20 dark:bg-emerald-500/10" : "border-input bg-muted/20"}`}>
                <div className="text-[13px] font-semibold">{step.label}</div>
                <div className="mt-1 text-[11px] text-muted-foreground">{step.completed ? formatDate(step.time) : "Pending"}</div>
              </div>
            ))}
          </div>
        </SectionCard>
      </FadeItem>

      <FadeItem>
        <SectionCard title="Reconciliation">
          <div className="grid gap-3 md:grid-cols-5">
            <div><div className="text-[11px] text-muted-foreground">Ordered</div><div className="text-lg font-semibold">{reconciliation?.summary.total_ordered_qty ?? po.total_ordered_qty}</div></div>
            <div><div className="text-[11px] text-muted-foreground">Received</div><div className="text-lg font-semibold">{reconciliation?.summary.total_received_qty ?? po.total_received_qty}</div></div>
            <div><div className="text-[11px] text-muted-foreground">Remaining</div><div className="text-lg font-semibold">{reconciliation?.summary.total_remaining_qty ?? totalRemaining}</div></div>
            <div><div className="text-[11px] text-muted-foreground">Matched Lines</div><div className="text-lg font-semibold">{reconciliation?.summary.matched_lines ?? 0}</div></div>
            <div><div className="text-[11px] text-muted-foreground">Status</div><StatusBadge label={reconciliation?.summary.reconciliation_status || po.reconciliation_status} variant={statusVariant(reconciliation?.summary.reconciliation_status || po.reconciliation_status)} /></div>
          </div>
        </SectionCard>
      </FadeItem>

      {po.status === "SENT_TO_SUPPLIER" ? (
        <FadeItem>
          <SectionCard title="Supplier Fulfillment" icon={Truck}>
            <div className="rounded-lg border border-sky-200 bg-sky-50 p-4 text-[13px] text-sky-800 dark:border-sky-500/20 dark:bg-sky-500/10 dark:text-sky-300">
              Waiting for supplier confirmation. Goods receipt can only be created after the supplier confirms the order and submits an invoice or delivery note.
            </div>
          </SectionCard>
        </FadeItem>
      ) : null}

      {supplierDocs?.dispatches.length ? (
        <FadeItem>
          <SectionCard title="Supplier Dispatches" noPadding>
            <Table>
              <TableBody>
                {supplierDocs.dispatches.map((dispatch) => (
                  <TableRow key={dispatch.id}>
                    <TableCell className="text-[13px] font-semibold">{dispatch.dispatch_number}</TableCell>
                    <TableCell><StatusBadge label={dispatch.status} variant={statusVariant(dispatch.status)} /></TableCell>
                    <TableCell className="whitespace-normal text-[12px] text-muted-foreground">{dispatch.channel}{dispatch.sent_to_email ? ` - ${dispatch.sent_to_email}` : " - demo/manual channel"}</TableCell>
                    <TableCell className="text-right">
                      {dispatch.portal_token ? (
                        <div className="flex justify-end gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => void copyText(`${window.location.origin}/supplier/portal/${dispatch.portal_token}`, "Portal link")}
                          >
                            <Clipboard className="h-3.5 w-3.5" /> Copy Link
                          </Button>
                          <NavLink to={`/supplier/portal/${dispatch.portal_token}`} target="_blank" className="inline-flex items-center gap-1.5 rounded-md border border-input bg-background px-3 py-2 text-[13px] font-medium text-indigo-600 hover:text-indigo-800 dark:text-indigo-400 dark:hover:text-indigo-300">
                            Open <ExternalLink className="h-3.5 w-3.5" />
                          </NavLink>
                        </div>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </SectionCard>
        </FadeItem>
      ) : null}

      {supplierDocs?.invoices.length ? (
        <FadeItem>
          <SectionCard title="Supplier Invoices / Delivery Notes" noPadding>
            <Table className="min-w-[760px]">
              <TableHeader>
                <TableRow className="bg-muted/30">
                  {["Invoice", "Expected", "Status", "Lines", "Action"].map((heading) => (
                    <TableHead key={heading} className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{heading}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {supplierDocs.invoices.map((invoice) => (
                  <TableRow key={invoice.id}>
                    <TableCell className="text-[13px] font-semibold">{invoice.invoice_number}</TableCell>
                    <TableCell className="text-[12px] text-muted-foreground">{formatDate(invoice.expected_delivery_date)}</TableCell>
                    <TableCell><StatusBadge label={invoice.status} variant={statusVariant(invoice.status)} /></TableCell>
                    <TableCell className="text-[13px]">{invoice.items.length}</TableCell>
                    <TableCell>
                      {canReceiveStock && po.status !== "RECEIVED" && totalRemaining > 0 ? (
                        <NavLink to={`/supplier-deliveries/${invoice.id}`} className="inline-flex items-center gap-1.5 rounded-md border border-input bg-background px-3 py-2 text-[13px] font-medium">
                          <Truck className="h-3.5 w-3.5" /> Receive
                        </NavLink>
                      ) : (
                        <span className="text-[12px] text-muted-foreground">Closed</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </SectionCard>
        </FadeItem>
      ) : null}

      {supplierDocs?.shortage_reports.length ? (
        <FadeItem>
          <SectionCard title="Shortage Reports" noPadding>
            <Table className="min-w-[760px]">
              <TableBody>
                {supplierDocs.shortage_reports.map((report) => {
                  const shortageQty = report.items.reduce((sum, item) => sum + item.shortage_qty, 0);
                  return (
                    <TableRow key={report.id}>
                      <TableCell><StatusBadge label={report.status} variant={statusVariant(report.status)} /></TableCell>
                      <TableCell className="text-[13px]">{shortageQty} units short</TableCell>
                      <TableCell className="whitespace-normal text-[12px] text-muted-foreground">{report.reason || "-"}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          {canManagePurchaseOrder && report.status === "OPEN" ? (
                            <Button variant="outline" size="sm" onClick={() => id && runAction("Shortage report sent", () => purchaseOrderService.sendShortageReport(id, report.id))} disabled={working}>Send to Supplier</Button>
                          ) : null}
                          {canManagePurchaseOrder && ["OPEN", "SENT_TO_SUPPLIER", "ACKNOWLEDGED"].includes(report.status) ? (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setPendingAction({ type: "resolveShortage", reportId: report.id })}
                              disabled={working}
                            >
                              Resolve
                            </Button>
                          ) : null}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </SectionCard>
        </FadeItem>
      ) : null}

      <FadeItem>
        <SectionCard title={`Items (${po.items.length})`} noPadding>
          <Table className="min-w-[900px]">
            <TableHeader>
              <TableRow className="bg-muted/30">
                {["Title", "ISBN/SKU", "Ordered", "Received", "Remaining", "Unit Cost", "Line Total", "Status"].map((heading) => (
                  <TableHead key={heading} className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{heading}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {po.items.map((item) => (
                <TableRow key={item.id}>
                  <TableCell className="whitespace-normal text-[13px] font-medium">{item.title}</TableCell>
                  <TableCell className="text-[12px] font-mono text-muted-foreground">{item.isbn13 || item.sku || "-"}</TableCell>
                  <TableCell className="text-[13px]">{item.ordered_qty}</TableCell>
                  <TableCell className="text-[13px]">{item.received_qty}</TableCell>
                  <TableCell className="text-[13px]">{item.remaining_qty}</TableCell>
                  <TableCell className="text-[12px] font-mono">{formatCurrency(item.unit_cost)}</TableCell>
                  <TableCell className="text-[12px] font-mono">{formatCurrency(item.line_total)}</TableCell>
                  <TableCell><StatusBadge label={item.reconciliation_status} variant={statusVariant(item.reconciliation_status)} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </SectionCard>
      </FadeItem>

      <FadeItem>
        <SectionCard title="Linked Goods Receipts" noPadding>
          {po.goods_receipts.length === 0 ? (
            <EmptyState variant="no-data" title="No linked receipts" description="Create a goods receipt after approval" className="py-10" />
          ) : (
            <Table>
              <TableBody>
                {po.goods_receipts.map((receipt) => (
                  <TableRow key={receipt.id}>
                    <TableCell><NavLink to={`/orders/${receipt.id}`} className="text-[13px] font-semibold text-indigo-600 dark:text-indigo-400">{receipt.receipt_number}</NavLink></TableCell>
                    <TableCell><StatusBadge label={receipt.status} variant={statusVariant(receipt.status)} /></TableCell>
                    <TableCell className="text-[13px]">{receipt.total_quantity} units</TableCell>
                    <TableCell className="text-[12px] text-muted-foreground">{formatDate(receipt.received_at)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </SectionCard>
      </FadeItem>

      <ConfirmDialog
        open={!!pendingAction}
        onOpenChange={(open) => { if (!open) closeActionDialog(); }}
        title={dialogConfig?.title || ""}
        description={dialogConfig?.description}
        confirmLabel={dialogConfig?.confirmLabel}
        variant={dialogConfig?.variant}
        loading={working}
        onConfirm={handleConfirmAction}
      >
        {pendingAction?.type === "reject" && (
          <div>
            <p className="mb-1.5 text-[11px] font-medium text-muted-foreground">Reject reason</p>
            <Textarea
              value={rejectReason}
              onChange={(event) => setRejectReason(event.target.value)}
              rows={2}
              placeholder="Explain why this purchase order is being rejected..."
            />
          </div>
        )}
      </ConfirmDialog>
    </PageWrapper>
  );
}
