import { useEffect, useMemo, useState, type ComponentType, type ReactNode } from "react";
import { NavLink, useParams } from "react-router";
import {
  AlertTriangle, ArrowLeft, ArrowRight, Ban, CheckCircle, CheckCircle2, Clipboard, ClipboardList, Clock,
  Edit, ExternalLink, FileText, PackageCheck, RefreshCw, Send, Truck, XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { purchaseOrderService, type PurchaseOrderDetail, type PurchaseOrderStatus, type ReconciliationResponse, type SupplierDocumentsResponse } from "@/services/purchase-order";
import { getApiErrorMessage } from "@/services/api";
import { StatusBadge } from "@/components/status-badge";
import { SectionCard } from "@/components/ui/section-card";
import { EmptyState } from "@/components/ui/empty-state";
import { LoadingOverlay } from "@/components/ui/loading-state";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { WorkflowStepper, type WorkflowStep } from "@/components/ui/workflow-stepper";
import { cn } from "@/components/ui/utils";
import { PageWrapper, FadeItem } from "../motion-utils";
import { authService } from "@/services/auth";
import { canAccess, ROUTE_ACCESS } from "@/lib/rbac";
import { getStatusVariant } from "@/lib/status-registry";
import { purchaseOrderStatusLabel } from "@/lib/purchase-order-status";

type PendingAction =
  | { type: "submit" }
  | { type: "approve" }
  | { type: "send" }
  | { type: "cancel" }
  | { type: "reject" }
  | { type: "resolveShortage"; reportId: string };

const DEFAULT_REJECT_REASON = "Từ chối từ giao diện quản lý";

// The PO happy path, same sequence the list page uses for its progress dots.
const STAGES: { status: PurchaseOrderStatus; label: string }[] = [
  { status: "DRAFT", label: "Nháp" },
  { status: "PENDING_APPROVAL", label: "Chờ duyệt" },
  { status: "APPROVED", label: "Đã duyệt" },
  { status: "SENT_TO_SUPPLIER", label: "Đã gửi NCC" },
  { status: "SUPPLIER_CONFIRMED", label: "NCC xác nhận" },
  { status: "RECEIVED", label: "Đã nhận hàng" },
];

const statusLabel = purchaseOrderStatusLabel;

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
  return date.toLocaleString("vi-VN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function formatDay(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString("vi-VN", { year: "numeric", month: "2-digit", day: "2-digit" });
}

const NOTE_TAG_LABEL: Record<string, string> = {
  APPROVED_NOTE: "Ghi chú duyệt",
  REJECTED_REASON: "Lý do từ chối",
};

// The backend appends workflow notes to po.note as "[TAG] text" lines.
function parseNote(note?: string | null) {
  const general: string[] = [];
  const tagged: { tag: string; label: string; text: string }[] = [];
  for (const line of (note || "").split("\n")) {
    const match = line.match(/^\[([A-Z_]+)\]\s*(.*)$/);
    if (match) tagged.push({ tag: match[1], label: NOTE_TAG_LABEL[match[1]] ?? match[1], text: match[2] });
    else if (line.trim()) general.push(line);
  }
  return { general: general.join("\n"), tagged };
}

function buildSteps(status: PurchaseOrderStatus): WorkflowStep[] {
  if (status === "REJECTED") {
    return STAGES.map((stage, i) => ({
      id: stage.status,
      label: i === 1 ? "Bị từ chối" : stage.label,
      status: i === 0 ? "completed" : i === 1 ? "error" : "pending",
    }));
  }
  if (status === "CANCELLED") {
    return STAGES.map((stage) => ({ id: stage.status, label: stage.label, status: "pending" }));
  }
  // Receiving in progress sits on the last stage without completing it.
  const receiving = status === "PARTIALLY_RECEIVED" || status === "SHORTAGE_REPORTED";
  const currentIdx = receiving ? STAGES.length - 1 : STAGES.findIndex((stage) => stage.status === status);
  return STAGES.map((stage, i) => ({
    id: stage.status,
    label: receiving && i === currentIdx ? statusLabel(status) : stage.label,
    status: i < currentIdx || status === "RECEIVED" ? "completed" : i === currentIdx ? (status === "SHORTAGE_REPORTED" ? "error" : "active") : "pending",
  }));
}

function getActionDialogConfig(pendingAction: PendingAction | null, poNumber: string | undefined) {
  const label = poNumber || "đơn đặt hàng này";
  if (!pendingAction) return null;

  switch (pendingAction.type) {
    case "submit":
      return { title: "Gửi duyệt đơn đặt hàng", description: `Gửi ${label} cho quản lý duyệt?`, confirmLabel: "Gửi duyệt", variant: "default" as const };
    case "approve":
      return { title: "Duyệt đơn đặt hàng", description: `Duyệt ${label}? Sau khi duyệt, đơn có thể được gửi cho nhà cung cấp.`, confirmLabel: "Duyệt đơn", variant: "default" as const };
    case "send":
      return { title: "Gửi đơn cho nhà cung cấp", description: `Gửi ${label} cho nhà cung cấp? Nhà cung cấp sẽ nhận được liên kết cổng NCC để xác nhận đơn.`, confirmLabel: "Gửi cho NCC", variant: "default" as const };
    case "cancel":
      return { title: "Hủy đơn đặt hàng", description: `Hủy ${label}? Không thể hoàn tác thao tác này.`, confirmLabel: "Hủy đơn", variant: "destructive" as const };
    case "reject":
      return { title: "Từ chối đơn đặt hàng", description: `Từ chối ${label}. Người tạo đơn sẽ thấy lý do bên dưới.`, confirmLabel: "Từ chối", variant: "destructive" as const };
    case "resolveShortage":
      return { title: "Đóng báo thiếu hàng", description: "Đánh dấu báo thiếu này là đã xử lý xong?", confirmLabel: "Đã xử lý", variant: "default" as const };
    default:
      return null;
  }
}

type Tone = "primary" | "warning" | "danger" | "success" | "neutral" | "info";

const TONE_STRIP: Record<Tone, string> = {
  primary: "bg-indigo-50/70 dark:bg-indigo-500/10",
  info: "bg-sky-50/70 dark:bg-sky-500/10",
  warning: "bg-amber-50/70 dark:bg-amber-500/10",
  danger: "bg-red-50/70 dark:bg-red-500/10",
  success: "bg-emerald-50/70 dark:bg-emerald-500/10",
  neutral: "bg-muted/40",
};

const TONE_ICON: Record<Tone, string> = {
  primary: "bg-indigo-600 text-white",
  info: "bg-sky-600 text-white",
  warning: "bg-amber-500 text-white",
  danger: "bg-red-600 text-white",
  success: "bg-emerald-600 text-white",
  neutral: "bg-slate-500 text-white",
};

function NextStep({ tone, icon: Icon, title, description, children }: {
  tone: Tone;
  icon: ComponentType<{ className?: string }>;
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <div className={cn("flex flex-col gap-3 border-t border-border px-5 py-4 sm:flex-row sm:items-center sm:justify-between", TONE_STRIP[tone])}>
      <div className="flex items-start gap-3">
        <div className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg", TONE_ICON[tone])}>
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Bước tiếp theo</p>
          <p className="text-[14px] font-semibold text-foreground">{title}</p>
          <p className="mt-0.5 text-[12px] text-muted-foreground">{description}</p>
        </div>
      </div>
      {children ? <div className="flex flex-wrap items-center gap-2 sm:shrink-0 sm:justify-end">{children}</div> : null}
    </div>
  );
}

function ProgressBar({ value, max, tone = "success" }: { value: number; max: number; tone?: "success" | "warning" | "danger" }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  const color = tone === "danger" ? "bg-red-500" : tone === "warning" ? "bg-amber-500" : "bg-emerald-500";
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted" role="img" aria-label={`${value}/${max}`}>
      <div className={cn("h-full rounded-full transition-all duration-500", color)} style={{ width: `${pct}%` }} />
    </div>
  );
}

function InfoRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[104px_minmax(0,1fr)] gap-3 py-2.5 text-[13px]">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words text-foreground">{children}</dd>
    </div>
  );
}

function DocRow({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("flex flex-col gap-2 px-5 py-3.5 sm:flex-row sm:items-center sm:justify-between", className)}>{children}</div>;
}

const linkButtonClass = "inline-flex h-8 items-center gap-1.5 rounded-md border border-input bg-background px-3 text-[13px] font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

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
  const [rejectReason, setRejectReason] = useState(DEFAULT_REJECT_REASON);

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
      toast.error(getApiErrorMessage(error, "Không tải được đơn đặt hàng"));
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
      toast.error(getApiErrorMessage(error, "Thao tác thất bại"));
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
    setRejectReason(DEFAULT_REJECT_REASON);
    setPendingAction({ type: "reject" });
  };

  const copyText = async (value: string, label: string) => {
    await navigator.clipboard.writeText(value);
    toast.success(`Đã sao chép ${label}`);
  };

  const closeActionDialog = () => {
    if (working) return;
    setPendingAction(null);
    setRejectReason(DEFAULT_REJECT_REASON);
  };

  const handleConfirmAction = async () => {
    if (!pendingAction || !id) return;

    let ok = false;
    if (pendingAction.type === "submit") {
      ok = await runAction("Đã gửi duyệt đơn đặt hàng", () => purchaseOrderService.submit(id));
    } else if (pendingAction.type === "approve") {
      ok = await runAction("Đã duyệt đơn đặt hàng", () => purchaseOrderService.approve(id, "Approved from UI"));
    } else if (pendingAction.type === "send") {
      ok = await runAction("Đã gửi đơn cho nhà cung cấp", () => purchaseOrderService.sendToSupplier(id));
    } else if (pendingAction.type === "cancel") {
      ok = await runAction("Đã hủy đơn đặt hàng", () => purchaseOrderService.cancel(id));
    } else if (pendingAction.type === "reject") {
      const reason = rejectReason.trim();
      if (!reason) {
        toast.error("Cần nhập lý do từ chối");
        return;
      }
      ok = await runAction("Đã từ chối đơn đặt hàng", () => purchaseOrderService.reject(id, reason));
    } else if (pendingAction.type === "resolveShortage") {
      ok = await runAction("Đã đóng báo thiếu hàng", () => purchaseOrderService.resolveShortageReport(id, pendingAction.reportId));
    }

    if (ok) {
      setPendingAction(null);
      setRejectReason(DEFAULT_REJECT_REASON);
    }
  };

  // Only the first load blanks the page; refreshes after an action keep the content in place.
  if (loading && !po) {
    return (
      <PageWrapper>
        <LoadingOverlay />
      </PageWrapper>
    );
  }

  if (!po) {
    return (
      <PageWrapper>
        <EmptyState variant="no-data" title="Không tìm thấy đơn đặt hàng" description="Đơn này có thể đã bị xóa hoặc không tồn tại" />
      </PageWrapper>
    );
  }

  const canEdit = canManagePurchaseOrder && ["DRAFT", "REJECTED"].includes(po.status);
  const canSubmit = canManagePurchaseOrder && ["DRAFT", "REJECTED"].includes(po.status);
  const canApprove = canApprovePurchaseOrder && po.status === "PENDING_APPROVAL";
  const canSendToSupplier = canManagePurchaseOrder && po.status === "APPROVED";
  const canCancel = canManagePurchaseOrder && ["DRAFT", "REJECTED", "PENDING_APPROVAL", "APPROVED"].includes(po.status) && po.total_received_qty === 0;
  const dispatches = supplierDocs?.dispatches ?? [];
  const invoices = supplierDocs?.invoices ?? [];
  const shortageReports = supplierDocs?.shortage_reports ?? [];
  const latestOpenInvoice = invoices.find((invoice) => ["SUBMITTED", "PARTIALLY_RECEIVED", "SHORTAGE_REPORTED"].includes(invoice.status));
  const latestPortalToken = dispatches.find((dispatch) => dispatch.portal_token)?.portal_token;
  const openShortages = shortageReports.filter((report) => report.status !== "RESOLVED");
  const dialogConfig = getActionDialogConfig(pendingAction, po.po_number);

  const supplierName = po.supplier?.name || po.supplier_name || "-";
  const warehouseCode = po.warehouse?.code || po.warehouse_code || "-";
  const warehouseName = po.warehouse?.name || po.warehouse_name || "";
  const summary = reconciliation?.summary;
  const orderedQty = summary?.total_ordered_qty ?? po.total_ordered_qty;
  const receivedQty = summary?.total_received_qty ?? po.total_received_qty;
  const remainingQty = summary?.total_remaining_qty ?? totalRemaining;
  const reconStatus = summary?.reconciliation_status || po.reconciliation_status;
  const matchedLines = summary?.matched_lines ?? po.items.filter((item) => item.reconciliation_status === "MATCHED").length;
  const missingPrices = po.items.some((item) => Number(item.unit_cost) === 0);
  const expectedDay = formatDay(po.expected_date);
  const notes = parseNote(po.note);
  const rejectReasonNote = [...notes.tagged].reverse().find((entry) => entry.tag === "REJECTED_REASON")?.text;

  const nextStep = (() => {
    switch (po.status) {
      case "DRAFT":
      case "REJECTED": {
        const rejected = po.status === "REJECTED";
        return (
          <NextStep
            tone={rejected ? "danger" : "primary"}
            icon={rejected ? XCircle : FileText}
            title={rejected ? "Đơn bị từ chối — chỉnh sửa và gửi duyệt lại" : canSubmit ? "Kiểm tra lại rồi gửi duyệt" : "Đơn đang ở dạng nháp"}
            description={rejected
              ? (rejectReasonNote ? `Lý do: ${rejectReasonNote}` : "Xem lại số lượng, đơn giá và nhà cung cấp trước khi gửi lại.")
              : canSubmit ? "Quản lý sẽ nhận được yêu cầu duyệt ngay khi bạn gửi." : "Người tạo đơn cần gửi duyệt trước khi quản lý có thể duyệt."}
          >
            {canEdit && (
              <Button asChild variant="outline" size="sm">
                <NavLink to={`/purchase-orders/${po.id}/edit`}><Edit className="h-3.5 w-3.5" />Chỉnh sửa</NavLink>
              </Button>
            )}
            {canSubmit && <Button size="sm" onClick={submit} disabled={working} data-testid="submit-po-button"><Send className="h-3.5 w-3.5" />Gửi duyệt</Button>}
          </NextStep>
        );
      }
      case "PENDING_APPROVAL":
        return (
          <NextStep
            tone="warning"
            icon={Clock}
            title={canApprove ? "Đơn đang chờ bạn duyệt" : "Đang chờ quản lý duyệt"}
            description={canApprove ? `${po.item_count} đầu sách · ${orderedQty} cuốn · ${formatCurrency(po.total_amount)}` : "Bạn sẽ thấy bước tiếp theo ở đây sau khi đơn được duyệt."}
          >
            {canApprove && <Button variant="outline" size="sm" onClick={reject} disabled={working}><XCircle className="h-3.5 w-3.5" />Từ chối</Button>}
            {canApprove && <Button size="sm" onClick={approve} disabled={working} data-testid="approve-po-button"><CheckCircle className="h-3.5 w-3.5" />Duyệt đơn</Button>}
          </NextStep>
        );
      case "APPROVED":
        return (
          <NextStep
            tone="primary"
            icon={Send}
            title={canSendToSupplier ? "Gửi đơn cho nhà cung cấp" : "Đơn đã duyệt, chờ gửi cho NCC"}
            description={`${supplierName} sẽ nhận liên kết cổng NCC để xác nhận và gửi hóa đơn.`}
          >
            {canSendToSupplier && <Button size="sm" onClick={sendToSupplier} disabled={working} data-testid="send-to-supplier-button"><Send className="h-3.5 w-3.5" />Gửi cho NCC</Button>}
          </NextStep>
        );
      case "SENT_TO_SUPPLIER":
        return (
          <NextStep
            tone="info"
            icon={Clock}
            title="Đang chờ nhà cung cấp xác nhận"
            description="Chỉ tạo được phiếu nhập kho sau khi NCC xác nhận đơn và gửi hóa đơn hoặc phiếu giao hàng."
          >
            {latestPortalToken && (
              <Button variant="outline" size="sm" onClick={() => void copyText(`${window.location.origin}/supplier/portal/${latestPortalToken}`, "liên kết cổng NCC")}>
                <Clipboard className="h-3.5 w-3.5" />Sao chép liên kết NCC
              </Button>
            )}
          </NextStep>
        );
      case "SUPPLIER_CONFIRMED":
      case "PARTIALLY_RECEIVED":
        return latestOpenInvoice ? (
          <NextStep
            tone="primary"
            icon={Truck}
            title={`Nhận hàng theo ${latestOpenInvoice.invoice_number}`}
            description={`Còn ${remainingQty} cuốn chưa nhận${latestOpenInvoice.expected_delivery_date ? ` · NCC hẹn giao ${formatDay(latestOpenInvoice.expected_delivery_date)}` : ""}.`}
          >
            {canReceiveStock && (
              <Button asChild size="sm" disabled={working}>
                <NavLink to={`/supplier-deliveries/${latestOpenInvoice.id}`}><Truck className="h-3.5 w-3.5" />Tạo phiếu nhập</NavLink>
              </Button>
            )}
          </NextStep>
        ) : (
          <NextStep
            tone="info"
            icon={Clock}
            title="Chờ NCC gửi hóa đơn hoặc phiếu giao hàng"
            description={`Còn ${remainingQty} cuốn chưa nhận. Hóa đơn mới sẽ xuất hiện ở mục Chứng từ.`}
          />
        );
      case "SHORTAGE_REPORTED":
        return (
          <NextStep
            tone="warning"
            icon={AlertTriangle}
            title={openShortages.length > 1 ? `Xử lý ${openShortages.length} báo thiếu hàng` : "Xử lý báo thiếu hàng"}
            description={`Đã nhận ${receivedQty}/${orderedQty} cuốn. Gửi báo thiếu cho NCC hoặc đóng khi đã thống nhất.`}
          >
            <a href="#po-documents" className={linkButtonClass}>Xem báo thiếu<ArrowRight className="h-3.5 w-3.5" /></a>
          </NextStep>
        );
      case "RECEIVED":
        return (
          <NextStep
            tone="success"
            icon={PackageCheck}
            title="Đã nhận đủ hàng"
            description={`${receivedQty}/${orderedQty} cuốn đã nhập kho ${warehouseCode}. Không cần thao tác thêm.`}
          />
        );
      case "CANCELLED":
        return <NextStep tone="neutral" icon={Ban} title="Đơn đã hủy" description="Đơn này không còn hiệu lực. Tạo đơn mới nếu vẫn cần đặt hàng." />;
      default:
        return null;
    }
  })();

  const activity = [
    { key: "created", time: po.created_at || po.order_date, label: "Tạo đơn đặt hàng", tone: "neutral" as Tone },
    ...dispatches.flatMap((dispatch) => [
      dispatch.sent_at ? { key: `${dispatch.id}-sent`, time: dispatch.sent_at, label: `Gửi đơn cho NCC qua ${dispatch.channel.toLowerCase()}`, tone: "info" as Tone } : null,
      dispatch.acknowledged_at ? { key: `${dispatch.id}-ack`, time: dispatch.acknowledged_at, label: "NCC xác nhận đơn", tone: "primary" as Tone } : null,
    ]),
    ...invoices.map((invoice) => ({ key: invoice.id, time: invoice.created_at, label: `NCC gửi ${invoice.invoice_number}`, tone: "primary" as Tone })),
    ...po.goods_receipts.map((receipt) => receipt.received_at ? { key: receipt.id, time: receipt.received_at, label: `Nhập kho ${receipt.total_quantity} cuốn · ${receipt.receipt_number}`, tone: "success" as Tone } : null),
    ...shortageReports.flatMap((report) => [
      { key: `${report.id}-open`, time: report.created_at, label: `Báo thiếu ${report.items.reduce((sum, item) => sum + item.shortage_qty, 0)} cuốn`, tone: "warning" as Tone },
      report.resolved_at ? { key: `${report.id}-resolved`, time: report.resolved_at, label: "Đóng báo thiếu", tone: "success" as Tone } : null,
    ]),
    po.status === "REJECTED" ? { key: "rejected", time: po.updated_at, label: "Đơn bị từ chối", tone: "danger" as Tone } : null,
    po.status === "CANCELLED" ? { key: "cancelled", time: po.updated_at, label: "Đơn bị hủy", tone: "danger" as Tone } : null,
  ]
    .filter((event): event is { key: string; time: string; label: string; tone: Tone } => Boolean(event?.time))
    .sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());

  const activityDot: Record<Tone, string> = {
    neutral: "bg-slate-400", info: "bg-sky-500", primary: "bg-indigo-500", success: "bg-emerald-500", warning: "bg-amber-500", danger: "bg-red-500",
  };

  const defaultDocTab = po.status === "SHORTAGE_REPORTED" && shortageReports.length ? "shortages"
    : po.status === "RECEIVED" && po.goods_receipts.length ? "receipts"
      : ["SUPPLIER_CONFIRMED", "PARTIALLY_RECEIVED"].includes(po.status) && invoices.length ? "invoices"
        : "dispatches";

  const docTabs = [
    { value: "dispatches", label: "Gửi NCC", count: dispatches.length },
    { value: "invoices", label: "Hóa đơn / phiếu giao", count: invoices.length },
    { value: "shortages", label: "Báo thiếu", count: shortageReports.length },
    { value: "receipts", label: "Phiếu nhập kho", count: po.goods_receipts.length },
  ];

  return (
    <PageWrapper className="space-y-5">
      <FadeItem>
        <NavLink to="/purchase-orders" className="inline-flex items-center gap-1.5 rounded text-[13px] text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <ArrowLeft className="h-3.5 w-3.5" />
          Đơn đặt hàng
        </NavLink>
      </FadeItem>

      <FadeItem>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border bg-gradient-to-br from-indigo-600 to-sky-600 shadow-lg shadow-indigo-500/20">
              <ClipboardList className="h-5 w-5 text-white" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="break-all font-mono text-xl font-semibold tracking-tight text-foreground">{po.po_number}</h1>
                <StatusBadge label={statusLabel(po.status)} variant={statusVariant(po.status)} dot />
              </div>
              <p className="mt-1 flex flex-wrap items-center gap-x-1.5 text-[13px] text-muted-foreground">
                <span className="text-foreground">{supplierName}</span>
                <ArrowRight className="h-3.5 w-3.5" aria-label="giao đến" />
                <span>{warehouseCode}{warehouseName ? ` · ${warehouseName}` : ""}</span>
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {canEdit && (
              <Button asChild variant="outline" size="sm">
                <NavLink to={`/purchase-orders/${po.id}/edit`}><Edit className="h-3.5 w-3.5" />Sửa</NavLink>
              </Button>
            )}
            {canCancel && (
              <Button variant="outline" size="sm" onClick={cancel} disabled={working} className="text-red-600 hover:text-red-700 dark:text-red-400">
                <Ban className="h-3.5 w-3.5" />Hủy đơn
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={() => void load()} disabled={working || loading} aria-label="Làm mới">
              <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
              <span className="hidden sm:inline">Làm mới</span>
            </Button>
          </div>
        </div>
      </FadeItem>

      <FadeItem>
        <div className="overflow-hidden rounded-xl border border-border bg-card shadow-[0_1px_2px_rgba(0,0,0,0.03),0_2px_8px_rgba(0,0,0,0.04)] dark:shadow-none">
          <div className="overflow-x-auto px-5 py-5">
            <WorkflowStepper steps={buildSteps(po.status)} className="min-w-[540px]" />
          </div>
          {nextStep}
        </div>
      </FadeItem>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-5">
          <FadeItem>
            <SectionCard title="Sách đặt mua" subtitle={`${po.items.length} đầu sách · ${orderedQty} cuốn`} noPadding>
              <div className="overflow-x-auto border-t border-border">
                <Table className="min-w-[720px]">
                  <TableHeader>
                    <TableRow className="bg-muted/30">
                      <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Sách</TableHead>
                      <TableHead className="w-[150px] text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Đã nhận / đặt</TableHead>
                      <TableHead className="text-right text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Đơn giá</TableHead>
                      <TableHead className="text-right text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Thành tiền</TableHead>
                      <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Đối soát</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {po.items.map((item) => {
                      const over = item.received_qty > item.ordered_qty;
                      return (
                        <TableRow key={item.id}>
                          <TableCell className="whitespace-normal">
                            <p className="text-[13px] font-medium text-foreground">{item.title}</p>
                            <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">{item.isbn13 || item.sku || "-"}</p>
                            {item.note ? <p className="mt-1 text-[11px] text-muted-foreground">{item.note}</p> : null}
                          </TableCell>
                          <TableCell>
                            <div className="flex items-baseline justify-between gap-2 text-[13px] tabular-nums">
                              <span><span className="font-semibold">{item.received_qty}</span><span className="text-muted-foreground">/{item.ordered_qty}</span></span>
                              {item.remaining_qty > 0 ? <span className="text-[11px] text-muted-foreground">còn {item.remaining_qty}</span> : null}
                            </div>
                            <div className="mt-1.5"><ProgressBar value={item.received_qty} max={item.ordered_qty} tone={over ? "danger" : item.received_qty < item.ordered_qty && item.received_qty > 0 ? "warning" : "success"} /></div>
                          </TableCell>
                          <TableCell className={cn("text-right font-mono text-[12px] tabular-nums", Number(item.unit_cost) === 0 && "text-muted-foreground")}>{formatCurrency(item.unit_cost)}</TableCell>
                          <TableCell className="text-right font-mono text-[12px] tabular-nums">{formatCurrency(item.line_total)}</TableCell>
                          <TableCell><StatusBadge label={statusLabel(item.reconciliation_status)} variant={statusVariant(item.reconciliation_status)} /></TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                  <TableFooter>
                    <TableRow className="bg-muted/20 hover:bg-muted/20">
                      <TableCell className="text-[12px] font-medium text-muted-foreground">Tổng cộng</TableCell>
                      <TableCell className="text-[13px] tabular-nums"><span className="font-semibold">{receivedQty}</span><span className="text-muted-foreground">/{orderedQty}</span></TableCell>
                      <TableCell />
                      <TableCell className="text-right font-mono text-[13px] font-semibold tabular-nums">{formatCurrency(po.total_amount)}</TableCell>
                      <TableCell />
                    </TableRow>
                  </TableFooter>
                </Table>
              </div>
            </SectionCard>
          </FadeItem>

          <FadeItem>
            <div id="po-documents" className="scroll-mt-20">
              <SectionCard title="Chứng từ" subtitle="Trao đổi với nhà cung cấp và các lần nhập kho" noPadding>
                <Tabs key={po.status} defaultValue={defaultDocTab} className="gap-0">
                  <div className="overflow-x-auto px-5 pb-3">
                    <TabsList className="w-max">
                      {docTabs.map((tab) => (
                        <TabsTrigger key={tab.value} value={tab.value} className="px-3 text-[12px]">
                          {tab.label}
                          <span className="rounded-full bg-muted-foreground/10 px-1.5 text-[11px] tabular-nums text-muted-foreground">{tab.count}</span>
                        </TabsTrigger>
                      ))}
                    </TabsList>
                  </div>

                  <TabsContent value="dispatches" className="divide-y divide-border border-t border-border">
                    {dispatches.length === 0 ? (
                      <EmptyState variant="no-data" title="Chưa gửi đơn cho NCC" description="Đơn được gửi sau khi quản lý duyệt" className="py-8" />
                    ) : dispatches.map((dispatch) => (
                      <DocRow key={dispatch.id}>
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-mono text-[13px] font-semibold">{dispatch.dispatch_number}</span>
                            <StatusBadge label={statusLabel(dispatch.status)} variant={statusVariant(dispatch.status)} />
                          </div>
                          <p className="mt-0.5 text-[12px] text-muted-foreground">
                            {dispatch.channel}{dispatch.sent_to_email ? ` · ${dispatch.sent_to_email}` : " · gửi thủ công"}{dispatch.sent_at ? ` · ${formatDate(dispatch.sent_at)}` : ""}
                          </p>
                        </div>
                        {dispatch.portal_token ? (
                          <div className="flex shrink-0 gap-2">
                            <Button variant="outline" size="sm" onClick={() => void copyText(`${window.location.origin}/supplier/portal/${dispatch.portal_token}`, "liên kết cổng NCC")}>
                              <Clipboard className="h-3.5 w-3.5" />Sao chép
                            </Button>
                            <NavLink to={`/supplier/portal/${dispatch.portal_token}`} target="_blank" data-testid="supplier-portal-link" className={cn(linkButtonClass, "text-indigo-600 hover:text-indigo-800 dark:text-indigo-400 dark:hover:text-indigo-300")}>
                              Mở cổng NCC <ExternalLink className="h-3.5 w-3.5" />
                            </NavLink>
                          </div>
                        ) : null}
                      </DocRow>
                    ))}
                  </TabsContent>

                  <TabsContent value="invoices" className="divide-y divide-border border-t border-border">
                    {invoices.length === 0 ? (
                      <EmptyState variant="no-data" title="Chưa có hóa đơn" description="NCC gửi hóa đơn hoặc phiếu giao qua cổng NCC sau khi xác nhận đơn" className="py-8" />
                    ) : invoices.map((invoice) => {
                      const invoicedQty = invoice.items.reduce((sum, item) => sum + Number(item.invoiced_qty || 0), 0);
                      const receivable = canReceiveStock && po.status !== "RECEIVED" && totalRemaining > 0 && invoice.status !== "RECEIVED";
                      return (
                        <DocRow key={invoice.id}>
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-mono text-[13px] font-semibold">{invoice.invoice_number}</span>
                              <StatusBadge label={statusLabel(invoice.status)} variant={statusVariant(invoice.status)} />
                            </div>
                            <p className="mt-0.5 text-[12px] text-muted-foreground">
                              {invoice.items.length} dòng · {invoicedQty} cuốn{formatDay(invoice.expected_delivery_date) ? ` · hẹn giao ${formatDay(invoice.expected_delivery_date)}` : ""}
                            </p>
                            {invoice.supplier_note ? <p className="mt-1 text-[12px] text-muted-foreground">“{invoice.supplier_note}”</p> : null}
                          </div>
                          {receivable ? (
                            <NavLink to={`/supplier-deliveries/${invoice.id}`} className={linkButtonClass}>
                              <Truck className="h-3.5 w-3.5" /> Nhận hàng
                            </NavLink>
                          ) : null}
                        </DocRow>
                      );
                    })}
                  </TabsContent>

                  <TabsContent value="shortages" className="divide-y divide-border border-t border-border">
                    {shortageReports.length === 0 ? (
                      <EmptyState variant="no-data" title="Không có báo thiếu" description="Báo thiếu được tạo khi số lượng nhận ít hơn hóa đơn" className="py-8" />
                    ) : shortageReports.map((report) => {
                      const shortageQty = report.items.reduce((sum, item) => sum + item.shortage_qty, 0);
                      return (
                        <DocRow key={report.id} className="sm:items-start">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-[13px] font-semibold">Thiếu {shortageQty} cuốn</span>
                              <StatusBadge label={statusLabel(report.status)} variant={statusVariant(report.status)} />
                              <span className="text-[12px] text-muted-foreground">{formatDate(report.created_at)}</span>
                            </div>
                            {report.reason ? <p className="mt-0.5 text-[12px] text-muted-foreground">{report.reason}</p> : null}
                            <ul className="mt-1.5 space-y-0.5 text-[12px]">
                              {report.items.map((item) => (
                                <li key={item.id} className="text-muted-foreground">
                                  <span className="text-foreground">{item.title || "-"}</span> · nhận {item.received_qty}/{item.ordered_qty}, thiếu <span className="font-medium text-amber-700 dark:text-amber-400">{item.shortage_qty}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                          <div className="flex shrink-0 gap-2">
                            {canManagePurchaseOrder && report.status === "OPEN" ? (
                              <Button variant="outline" size="sm" onClick={() => id && runAction("Đã gửi báo thiếu cho NCC", () => purchaseOrderService.sendShortageReport(id, report.id))} disabled={working}>
                                <Send className="h-3.5 w-3.5" />Gửi NCC
                              </Button>
                            ) : null}
                            {canManagePurchaseOrder && ["OPEN", "SENT_TO_SUPPLIER", "ACKNOWLEDGED"].includes(report.status) ? (
                              <Button variant="outline" size="sm" onClick={() => setPendingAction({ type: "resolveShortage", reportId: report.id })} disabled={working}>
                                <CheckCircle2 className="h-3.5 w-3.5" />Đã xử lý
                              </Button>
                            ) : null}
                          </div>
                        </DocRow>
                      );
                    })}
                  </TabsContent>

                  <TabsContent value="receipts" className="divide-y divide-border border-t border-border">
                    {po.goods_receipts.length === 0 ? (
                      <EmptyState variant="no-data" title="Chưa có phiếu nhập kho" description="Phiếu nhập được tạo khi kho nhận hàng theo hóa đơn của NCC" className="py-8" />
                    ) : po.goods_receipts.map((receipt) => (
                      <DocRow key={receipt.id}>
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <NavLink to={`/orders/${receipt.id}`} className="rounded font-mono text-[13px] font-semibold text-indigo-600 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:text-indigo-400">{receipt.receipt_number}</NavLink>
                            <StatusBadge label={statusLabel(receipt.status)} variant={statusVariant(receipt.status)} />
                          </div>
                          <p className="mt-0.5 text-[12px] text-muted-foreground">{receipt.total_quantity} cuốn · {receipt.item_count} dòng · {formatDate(receipt.received_at)}</p>
                        </div>
                      </DocRow>
                    ))}
                  </TabsContent>
                </Tabs>
              </SectionCard>
            </div>
          </FadeItem>
        </div>

        <div className="min-w-0 space-y-5">
          <FadeItem>
            <SectionCard title="Tiến độ nhận hàng">
              <div className="flex items-baseline justify-between">
                <p className="tabular-nums"><span className="text-2xl font-semibold">{receivedQty}</span><span className="text-[13px] text-muted-foreground"> / {orderedQty} cuốn</span></p>
                <StatusBadge label={statusLabel(reconStatus)} variant={statusVariant(reconStatus)} />
              </div>
              <div className="mt-3"><ProgressBar value={receivedQty} max={orderedQty} tone={reconStatus === "OVER_RECEIVED" ? "danger" : remainingQty > 0 && receivedQty > 0 ? "warning" : "success"} /></div>
              <dl className="mt-4 grid grid-cols-3 gap-2 text-center">
                {[
                  { label: "Còn lại", value: remainingQty },
                  { label: "Dòng khớp", value: `${matchedLines}/${po.items.length}` },
                  { label: "Lệch", value: (summary?.over_received_lines ?? 0) + (summary?.under_received_lines ?? 0) },
                ].map((stat) => (
                  <div key={stat.label} className="rounded-lg bg-muted/40 px-2 py-2">
                    <dt className="text-[11px] text-muted-foreground">{stat.label}</dt>
                    <dd className="text-[15px] font-semibold tabular-nums">{stat.value}</dd>
                  </div>
                ))}
              </dl>
            </SectionCard>
          </FadeItem>

          <FadeItem>
            <SectionCard title="Thông tin đơn">
              <dl className="-my-2.5 divide-y divide-border">
                <InfoRow label="Tổng tiền">
                  <span className="font-mono text-[15px] font-semibold tabular-nums">{formatCurrency(po.total_amount)}</span>
                  {missingPrices ? <span className="mt-0.5 block text-[11px] text-amber-700 dark:text-amber-400">Có dòng chưa nhập đơn giá</span> : null}
                </InfoRow>
                <InfoRow label="Nhà cung cấp">
                  {supplierName}
                  {po.supplier?.email ? <span className="block text-[12px] text-muted-foreground">{po.supplier.email}</span> : null}
                </InfoRow>
                <InfoRow label="Kho nhận">{warehouseCode}{warehouseName ? <span className="block text-[12px] text-muted-foreground">{warehouseName}</span> : null}</InfoRow>
                <InfoRow label="Ngày đặt">{formatDay(po.order_date) ?? "-"}</InfoRow>
                <InfoRow label="Dự kiến giao">{expectedDay ?? <span className="text-muted-foreground">Chưa hẹn ngày</span>}</InfoRow>
                {notes.general ? <InfoRow label="Ghi chú"><span className="whitespace-pre-line">{notes.general}</span></InfoRow> : null}
                {notes.tagged.map((entry, i) => (
                  <InfoRow key={`${entry.tag}-${i}`} label={entry.label}>{entry.text || "-"}</InfoRow>
                ))}
              </dl>
            </SectionCard>
          </FadeItem>

          <FadeItem>
            <SectionCard title="Hoạt động">
              {activity.length === 0 ? (
                <p className="text-[12px] text-muted-foreground">Chưa có hoạt động.</p>
              ) : (
                <ol className="relative space-y-3.5 before:absolute before:bottom-1 before:left-[4px] before:top-1 before:w-px before:bg-border">
                  {activity.map((event) => (
                    <li key={event.key} className="relative flex gap-3 pl-0">
                      <span className={cn("relative mt-[5px] h-[9px] w-[9px] shrink-0 rounded-full ring-2 ring-card", activityDot[event.tone])} />
                      <div className="min-w-0">
                        <p className="text-[13px] text-foreground">{event.label}</p>
                        <p className="text-[11px] tabular-nums text-muted-foreground">{formatDate(event.time)}</p>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </SectionCard>
          </FadeItem>
        </div>
      </div>

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
            <p className="mb-1.5 text-[11px] font-medium text-muted-foreground">Lý do từ chối</p>
            <Textarea
              value={rejectReason}
              onChange={(event) => setRejectReason(event.target.value)}
              rows={2}
              placeholder="Giải thích lý do từ chối để người tạo đơn chỉnh sửa..."
            />
          </div>
        )}
      </ConfirmDialog>
    </PageWrapper>
  );
}
