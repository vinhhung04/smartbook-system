import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useParams } from "react-router";
import {
  AlertCircle,
  CheckCircle2,
  Clipboard,
  FileText,
  PackageCheck,
  RefreshCw,
  RotateCcw,
  Send,
  Truck,
  XCircle,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { toast } from "sonner";
import {
  supplierPortalService,
  type SupplierPortalOrder,
  type SupplierPortalShortageReport,
} from "@/services/supplier-portal";
import { getApiErrorMessage } from "@/services/api";
import { PageWrapper, FadeItem } from "../../motion-utils";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatusBadge } from "@/components/status-badge";
import { ConfirmDialog, WorkflowStepper, type WorkflowStep } from "@/components/ui";

type PortalTab = "overview" | "order" | "invoices" | "shortages" | "redelivery" | "activity";

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

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
  if (["RECEIVED", "RESOLVED", "ACKNOWLEDGED", "SUPPLIER_CONFIRMED", "MATCHED"].includes(status)) return "success";
  if (["SENT_TO_SUPPLIER", "SUBMITTED", "PARTIALLY_RECEIVED", "OPEN", "SHORTAGE_REPORTED"].includes(status)) return "warning";
  if (["CANCELLED", "REJECTED", "FAILED"].includes(status)) return "danger";
  return "neutral";
}

function statusLabel(status: string) {
  const labels: Record<string, string> = {
    SENT_TO_SUPPLIER: "Chờ xác nhận từ nhà cung cấp",
    SUPPLIER_CONFIRMED: "NCC đã xác nhận",
    SUBMITTED: "Đã gửi chứng từ giao hàng",
    SHORTAGE_REPORTED: "Thư viện báo thiếu hàng",
    PARTIALLY_RECEIVED: "Nhận một phần",
    RECEIVED: "Thư viện đã nhận đủ",
    ACKNOWLEDGED: "NCC đã ghi nhận",
    RESOLVED: "Đã xử lý xong",
    OPEN: "Đang mở",
    CANCELLED: "Đã hủy",
    REJECTED: "Từ chối",
  };
  return labels[status] || status;
}

function StatBox({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <p className="text-[11px] font-semibold uppercase text-slate-400">{label}</p>
      <p className="mt-1 text-[18px] font-semibold text-slate-900">{value}</p>
    </div>
  );
}

function Section({ title, icon: Icon, children }: { title: string; icon?: LucideIcon; children: ReactNode }) {
  return (
    <section className="overflow-hidden rounded-lg border border-slate-200 bg-white">
      <div className="flex items-center gap-2 border-b border-slate-100 px-5 py-4">
        {Icon ? <Icon className="h-4 w-4 text-slate-500" /> : null}
        <h2 className="text-[14px] font-semibold text-slate-900">{title}</h2>
      </div>
      <div>{children}</div>
    </section>
  );
}

export function SupplierPortalPage() {
  const { token } = useParams();
  const [order, setOrder] = useState<SupplierPortalOrder | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [tab, setTab] = useState<PortalTab>("overview");
  const [invoiceNumber, setInvoiceNumber] = useState(`INV-${Date.now()}`);
  const [deliveryNumber, setDeliveryNumber] = useState(`DLV-${Date.now()}`);
  const [invoiceDate, setInvoiceDate] = useState(todayIso());
  const [expectedDeliveryDate, setExpectedDeliveryDate] = useState(todayIso());
  const [supplierNote, setSupplierNote] = useState("");
  const [invoiceQty, setInvoiceQty] = useState<Record<string, number>>({});
  const [invoiceNotes, setInvoiceNotes] = useState<Record<string, string>>({});
  const [redeliveryReportId, setRedeliveryReportId] = useState("");
  const [redeliveryQty, setRedeliveryQty] = useState<Record<string, number>>({});
  const [cannotReason, setCannotReason] = useState<Record<string, string>>({});
  const [confirmState, setConfirmState] = useState<{
    open: boolean;
    title: string;
    description?: string;
    variant: "default" | "destructive";
    onConfirm: () => Promise<void>;
  }>({ open: false, title: "", variant: "default", onConfirm: async () => {} });

  const openConfirm = (title: string, description: string, variant: "default" | "destructive", action: () => Promise<void>) => {
    setConfirmState({ open: true, title, description, variant, onConfirm: action });
  };

  const load = async () => {
    if (!token) return;
    try {
      setLoading(true);
      setError(null);
      const response = await supplierPortalService.getPortalOrder(token);
      setOrder(response.data);
      setInvoiceQty(Object.fromEntries(response.data.purchase_order.items.map((item) => [item.id, item.remaining_qty])));
      const firstOpen = response.data.shortage_reports.find((report) => ["OPEN", "SENT_TO_SUPPLIER", "ACKNOWLEDGED"].includes(report.status));
      if (firstOpen) {
        setRedeliveryReportId(firstOpen.id);
        setRedeliveryQty(Object.fromEntries(firstOpen.items.map((item) => [item.purchase_order_item_id, item.shortage_qty])));
      }
    } catch (loadError) {
      const message = getApiErrorMessage(loadError, "Failed to load supplier order");
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const summary = useMemo(() => {
    const items = order?.purchase_order.items || [];
    const invoices = order?.invoices || [];
    const shortages = order?.shortage_reports || [];
    return {
      itemCount: items.length,
      orderedQty: items.reduce((sum, item) => sum + item.ordered_qty, 0),
      receivedQty: items.reduce((sum, item) => sum + item.received_qty, 0),
      remainingQty: items.reduce((sum, item) => sum + item.remaining_qty, 0),
      invoiceQty: invoices.flatMap((invoice) => invoice.items || []).reduce((sum, item) => sum + item.invoiced_qty, 0),
      openShortageQty: shortages
        .filter((report) => ["OPEN", "SENT_TO_SUPPLIER", "ACKNOWLEDGED"].includes(report.status))
        .flatMap((report) => report.items)
        .reduce((sum, item) => sum + item.shortage_qty, 0),
    };
  }, [order]);

  const selectedShortage = useMemo(
    () => order?.shortage_reports.find((report) => report.id === redeliveryReportId) || null,
    [order, redeliveryReportId],
  );

  const invoiceTotal = useMemo(() => {
    if (!order) return { qty: 0, amount: 0, partial: false, invalid: false };
    return order.purchase_order.items.reduce(
      (acc, item) => {
        const qty = Number(invoiceQty[item.id] || 0);
        acc.qty += qty;
        acc.amount += qty * Number(item.unit_cost || 0);
        if (qty > item.remaining_qty) acc.invalid = true;
        if (qty > 0 && qty < item.remaining_qty) acc.partial = true;
        return acc;
      },
      { qty: 0, amount: 0, partial: false, invalid: false },
    );
  }, [invoiceQty, order]);

  const redeliveryTotal = useMemo(() => {
    if (!selectedShortage) return { qty: 0, invalid: false };
    return selectedShortage.items.reduce(
      (acc, item) => {
        const qty = Number(redeliveryQty[item.purchase_order_item_id] || 0);
        acc.qty += qty;
        if (qty > item.shortage_qty) acc.invalid = true;
        return acc;
      },
      { qty: 0, invalid: false },
    );
  }, [redeliveryQty, selectedShortage]);

  const confirmOrder = () => {
    if (!token) return;
    openConfirm(
      "Xác nhận đơn đặt hàng",
      "Bạn xác nhận sẽ cung cấp hàng theo đơn này?",
      "default",
      async () => {
        try {
          setWorking(true);
          await supplierPortalService.confirmPortalOrder(token);
          toast.success("Đã xác nhận đơn hàng");
          setConfirmState((s) => ({ ...s, open: false }));
          await load();
        } catch (confirmError) {
          toast.error(getApiErrorMessage(confirmError, "Xác nhận thất bại"));
        } finally {
          setWorking(false);
        }
      },
    );
  };

  const submitInvoice = () => {
    if (!token || !order) return;
    if (!invoiceNumber.trim()) { toast.error("Số hóa đơn là bắt buộc"); return; }
    const items = order.purchase_order.items
      .filter((item) => Number(invoiceQty[item.id] || 0) > 0)
      .map((item) => ({
        purchase_order_item_id: item.id,
        invoiced_qty: Number(invoiceQty[item.id] || 0),
        unit_cost: item.unit_cost,
        note: invoiceNotes[item.id],
      }));
    if (items.length === 0) { toast.error("Hóa đơn phải có ít nhất một dòng hàng"); return; }
    if (items.some((item) => item.invoiced_qty > (order.purchase_order.items.find((line) => line.id === item.purchase_order_item_id)?.remaining_qty || 0))) {
      toast.error("Số lượng hóa đơn không thể vượt quá số lượng còn lại của PO"); return;
    }
    openConfirm(
      "Gửi hóa đơn / chứng từ giao hàng",
      "Xác nhận gửi hóa đơn này cho thư viện?",
      "default",
      async () => {
        try {
          setWorking(true);
          await supplierPortalService.createPortalInvoice(token, {
            invoice_number: invoiceNumber.trim(),
            delivery_number: deliveryNumber.trim(),
            invoice_date: invoiceDate,
            expected_delivery_date: expectedDeliveryDate,
            supplier_note: supplierNote.trim(),
            items,
          });
          toast.success("Đã gửi hóa đơn thành công");
          setInvoiceNumber(`INV-${Date.now()}`);
          setDeliveryNumber(`DLV-${Date.now()}`);
          setSupplierNote("");
          setConfirmState((s) => ({ ...s, open: false }));
          setTab("invoices");
          await load();
        } catch (submitError) {
          toast.error(getApiErrorMessage(submitError, "Gửi hóa đơn thất bại"));
        } finally {
          setWorking(false);
        }
      },
    );
  };

  const acknowledgeShortage = (report: SupplierPortalShortageReport) => {
    if (!token) return;
    openConfirm(
      "Ghi nhận báo cáo thiếu hàng",
      "Xác nhận bạn đã nhận được thông báo thiếu hàng này?",
      "default",
      async () => {
        try {
          setWorking(true);
          await supplierPortalService.acknowledgeShortage(token, report.id);
          toast.success("Đã ghi nhận báo cáo thiếu hàng");
          setConfirmState((s) => ({ ...s, open: false }));
          await load();
        } catch (ackError) {
          toast.error(getApiErrorMessage(ackError, "Ghi nhận thất bại"));
        } finally {
          setWorking(false);
        }
      },
    );
  };

  const markCannotFulfill = (report: SupplierPortalShortageReport) => {
    if (!token) return;
    const reason = cannotReason[report.id]?.trim();
    if (!reason) { toast.error("Vui lòng nhập lý do không thể cung cấp hàng"); return; }
    openConfirm(
      "Thông báo không thể cung cấp hàng",
      `Gửi thông báo không thể cung cấp đến thư viện?\nLý do: ${reason}`,
      "destructive",
      async () => {
        try {
          setWorking(true);
          await supplierPortalService.cannotFulfillShortage(token, report.id, reason);
          toast.success("Đã gửi thông báo không thể cung cấp");
          setConfirmState((s) => ({ ...s, open: false }));
          await load();
        } catch (cannotError) {
          toast.error(getApiErrorMessage(cannotError, "Cập nhật thất bại"));
        } finally {
          setWorking(false);
        }
      },
    );
  };

  const submitRedelivery = () => {
    if (!token || !selectedShortage || !order) return;
    if (!invoiceNumber.trim()) { toast.error("Số hóa đơn là bắt buộc"); return; }
    const poItems = new Map(order.purchase_order.items.map((item) => [item.id, item]));
    const items = selectedShortage.items
      .filter((item) => Number(redeliveryQty[item.purchase_order_item_id] || 0) > 0)
      .map((item) => {
        const poItem = poItems.get(item.purchase_order_item_id);
        return {
          purchase_order_item_id: item.purchase_order_item_id,
          invoiced_qty: Number(redeliveryQty[item.purchase_order_item_id] || 0),
          unit_cost: poItem?.unit_cost || 0,
          note: "Giao bù hàng thiếu",
        };
      });
    if (items.length === 0) { toast.error("Phải có ít nhất một dòng hàng"); return; }
    if (redeliveryTotal.invalid) { toast.error("Số lượng giao bù không thể vượt quá số lượng thiếu"); return; }
    openConfirm(
      "Tạo hóa đơn giao bù",
      "Xác nhận tạo hóa đơn giao bù cho báo cáo thiếu hàng này?",
      "default",
      async () => {
        try {
          setWorking(true);
          await supplierPortalService.createRedeliveryInvoice(token, selectedShortage.id, {
            invoice_number: invoiceNumber.trim(),
            delivery_number: deliveryNumber.trim(),
            invoice_date: invoiceDate,
            expected_delivery_date: expectedDeliveryDate,
            supplier_note: supplierNote.trim() || "Giao bù hàng thiếu",
            source_shortage_report_id: selectedShortage.id,
            redelivery: true,
            items,
          });
          toast.success("Đã gửi hóa đơn giao bù");
          setInvoiceNumber(`INV-${Date.now()}`);
          setDeliveryNumber(`DLV-${Date.now()}`);
          setSupplierNote("");
          setConfirmState((s) => ({ ...s, open: false }));
          setTab("invoices");
          await load();
        } catch (redeliveryError) {
          toast.error(getApiErrorMessage(redeliveryError, "Tạo hóa đơn giao bù thất bại"));
        } finally {
          setWorking(false);
        }
      },
    );
  };

  if (loading) {
    return <div className="mx-auto max-w-6xl p-6 text-[13px] text-slate-500">Loading supplier portal...</div>;
  }

  if (error || !order) {
    return (
      <div className="mx-auto max-w-4xl p-6">
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-5 text-[13px] text-rose-800">
          {error || "Supplier order not found."}
        </div>
      </div>
    );
  }

  const canConfirm = order.purchase_order.status === "SENT_TO_SUPPLIER";
  const canInvoice = ["SENT_TO_SUPPLIER", "SUPPLIER_CONFIRMED", "PARTIALLY_RECEIVED", "SHORTAGE_REPORTED"].includes(order.purchase_order.status) && summary.remainingQty > 0;
  const openShortages = order.shortage_reports.filter((report) => ["OPEN", "SENT_TO_SUPPLIER", "ACKNOWLEDGED"].includes(report.status));

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-5 py-5 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold tracking-tight text-slate-950">SmartBook Supplier Portal</h1>
              <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-800">
                Demo Supplier Portal
              </span>
            </div>
            <p className="mt-1 text-[13px] text-slate-500">
              {order.purchase_order.supplier?.name || "-"} - Dispatch {order.dispatch.dispatch_number} - PO {order.purchase_order.po_number}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => navigator.clipboard.writeText(order.purchase_order.po_number).then(() => toast.success("PO number copied"))}>
              <Clipboard className="h-3.5 w-3.5" /> Copy PO
            </Button>
            <Button variant="outline" size="sm" onClick={() => void load()} disabled={working}>
              <RefreshCw className={`h-3.5 w-3.5 ${working ? "animate-spin" : ""}`} /> Refresh
            </Button>
            {canConfirm ? (
              <Button size="sm" onClick={() => void confirmOrder()} disabled={working}>
                <CheckCircle2 className="h-3.5 w-3.5" /> Confirm Order
              </Button>
            ) : null}
          </div>
        </div>
      </header>

      <PageWrapper className="space-y-5">
        <FadeItem>
          <div className="rounded-lg border border-sky-200 bg-sky-50 p-4 text-[13px] text-sky-900">
            Supplier can only confirm orders and submit delivery documents. Stock receiving is handled by warehouse staff.
          </div>
        </FadeItem>

        <FadeItem>
          <div className="grid gap-3 md:grid-cols-6">
            <StatBox label="PO status" value={statusLabel(order.purchase_order.status)} />
            <StatBox label="Dispatch" value={order.dispatch.status} />
            <StatBox label="Lines" value={summary.itemCount} />
            <StatBox label="Ordered" value={summary.orderedQty} />
            <StatBox label="Received" value={summary.receivedQty} />
            <StatBox label="Remaining" value={summary.remainingQty} />
          </div>
        </FadeItem>

        <FadeItem>
          <nav className="flex gap-2 overflow-x-auto border-b border-slate-200">
            {[
              ["overview", "Overview"],
              ["order", "Purchase Order"],
              ["invoices", "Invoices"],
              ["shortages", "Shortage Reports"],
              ["redelivery", "Redelivery"],
              ["activity", "Activity"],
            ].map(([key, label]) => (
              <button
                key={key}
                onClick={() => setTab(key as PortalTab)}
                className={`whitespace-nowrap border-b-2 px-3 py-2 text-[13px] font-semibold ${
                  tab === key ? "border-slate-900 text-slate-950" : "border-transparent text-slate-500 hover:text-slate-800"
                }`}
              >
                {label}
              </button>
            ))}
          </nav>
        </FadeItem>

        {tab === "overview" ? (
          <FadeItem className="space-y-5">
            <Section title="Thông tin chung" icon={PackageCheck}>
              <div className="grid gap-4 p-5 md:grid-cols-3">
                <div>
                  <p className="text-[11px] font-semibold uppercase text-slate-400">Nhà cung cấp</p>
                  <p className="mt-1 text-[13px] font-semibold">{order.purchase_order.supplier?.name || "-"}</p>
                </div>
                <div>
                  <p className="text-[11px] font-semibold uppercase text-slate-400">Kho nhận hàng</p>
                  <p className="mt-1 text-[13px] font-semibold">{order.purchase_order.warehouse?.code || "-"} - {order.purchase_order.warehouse?.name || ""}</p>
                </div>
                <div>
                  <p className="text-[11px] font-semibold uppercase text-slate-400">Ngày giao dự kiến</p>
                  <p className="mt-1 text-[13px] font-semibold">{formatDate(order.purchase_order.expected_date)}</p>
                </div>
                <div>
                  <p className="text-[11px] font-semibold uppercase text-slate-400">Số lượng đã gửi HĐ</p>
                  <p className="mt-1 text-[18px] font-semibold">{summary.invoiceQty}</p>
                </div>
                <div>
                  <p className="text-[11px] font-semibold uppercase text-slate-400">Số lượng thiếu đang mở</p>
                  <p className="mt-1 text-[18px] font-semibold">{summary.openShortageQty}</p>
                </div>
                <div>
                  <p className="text-[11px] font-semibold uppercase text-slate-400">Trạng thái hiện tại</p>
                  <div className="mt-1"><StatusBadge label={statusLabel(order.purchase_order.status)} variant={statusVariant(order.purchase_order.status)} /></div>
                </div>
              </div>
            </Section>
            <Section title="Tiến trình đơn hàng" icon={Truck}>
              <div className="p-5">
                <WorkflowStepper
                  orientation="horizontal"
                  steps={[
                    { id: "sent", label: "PO đã gửi", status: "completed" },
                    {
                      id: "confirmed",
                      label: "NCC xác nhận",
                      status: ["SUPPLIER_CONFIRMED", "PARTIALLY_RECEIVED", "SHORTAGE_REPORTED", "RECEIVED"].includes(order.purchase_order.status)
                        ? "completed"
                        : order.dispatch.sent_at ? "active" : "pending",
                    },
                    {
                      id: "invoice",
                      label: "Đã gửi hóa đơn",
                      status: order.invoices.length > 0 ? "completed"
                        : ["SUPPLIER_CONFIRMED"].includes(order.purchase_order.status) ? "active" : "pending",
                    },
                    {
                      id: "received",
                      label: "Kho đã nhận",
                      status: summary.receivedQty > 0 ? "completed"
                        : order.invoices.length > 0 ? "active" : "pending",
                    },
                    {
                      id: "done",
                      label: "Hoàn tất",
                      status: order.purchase_order.status === "RECEIVED" ? "completed"
                        : order.shortage_reports.length > 0 && summary.openShortageQty === 0 ? "completed"
                        : summary.receivedQty > 0 ? "active" : "pending",
                    },
                  ] satisfies WorkflowStep[]}
                />
              </div>
            </Section>
          </FadeItem>
        ) : null}

        {tab === "order" ? (
          <FadeItem>
            <Section title="Purchase Order Lines" icon={Truck}>
              <div className="overflow-x-auto">
                <Table className="min-w-[900px]">
                  <TableHeader>
                    <TableRow className="border-slate-100 bg-slate-50">
                      {["Title", "ISBN/SKU", "Ordered", "Received", "Remaining", "Unit Cost"].map((heading) => (
                        <TableHead key={heading} className="px-5 py-3 text-[11px] font-semibold uppercase text-slate-500">{heading}</TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {order.purchase_order.items.map((item) => (
                      <TableRow key={item.id} className="border-slate-100">
                        <TableCell className="whitespace-normal px-5 py-3.5 text-[13px] font-semibold">{item.title || "-"}</TableCell>
                        <TableCell className="px-5 py-3.5 font-mono text-[12px] text-slate-500">{item.isbn13 || item.sku || item.variant_id}</TableCell>
                        <TableCell className="px-5 py-3.5 text-[13px]">{item.ordered_qty}</TableCell>
                        <TableCell className="px-5 py-3.5 text-[13px]">{item.received_qty}</TableCell>
                        <TableCell className="px-5 py-3.5 text-[13px]">{item.remaining_qty}</TableCell>
                        <TableCell className="px-5 py-3.5 font-mono text-[12px]">{formatCurrency(item.unit_cost)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </Section>
          </FadeItem>
        ) : null}

        {tab === "invoices" ? (
          <FadeItem className="space-y-5">
            <Section title="Create Invoice / Delivery Note" icon={FileText}>
              <div className="space-y-4 p-5">
                {!canInvoice ? (
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-[13px] text-slate-600">This order is read-only because there is no remaining quantity to invoice.</div>
                ) : null}
                <div className="grid gap-3 md:grid-cols-5">
                  <input value={invoiceNumber} onChange={(event) => setInvoiceNumber(event.target.value)} placeholder="Invoice number" className="rounded-lg border border-slate-200 px-3 py-2 text-[13px]" />
                  <input value={deliveryNumber} onChange={(event) => setDeliveryNumber(event.target.value)} placeholder="Delivery number" className="rounded-lg border border-slate-200 px-3 py-2 text-[13px]" />
                  <input type="date" value={invoiceDate} onChange={(event) => setInvoiceDate(event.target.value)} className="rounded-lg border border-slate-200 px-3 py-2 text-[13px]" />
                  <input type="date" value={expectedDeliveryDate} onChange={(event) => setExpectedDeliveryDate(event.target.value)} className="rounded-lg border border-slate-200 px-3 py-2 text-[13px]" />
                  <input value={supplierNote} onChange={(event) => setSupplierNote(event.target.value)} placeholder="Supplier note" className="rounded-lg border border-slate-200 px-3 py-2 text-[13px]" />
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" onClick={() => setInvoiceQty(Object.fromEntries(order.purchase_order.items.map((item) => [item.id, item.remaining_qty])))}>Autofill remaining</Button>
                  <Button variant="outline" size="sm" onClick={() => setInvoiceQty(Object.fromEntries(order.purchase_order.items.map((item) => [item.id, 0])))}>Clear all</Button>
                </div>
                <div className="overflow-x-auto rounded-lg border border-slate-200">
                  <Table className="min-w-[980px]">
                    <TableHeader>
                      <TableRow className="border-slate-100 bg-slate-50">
                        {["Book", "Ordered", "Received", "Remaining", "Invoice Qty", "Unit Cost", "Note", "Status"].map((heading) => (
                          <TableHead key={heading} className="px-4 py-3 text-[11px] font-semibold uppercase text-slate-500">{heading}</TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {order.purchase_order.items.map((item) => {
                        const qty = Number(invoiceQty[item.id] || 0);
                        const lineStatus = qty > item.remaining_qty ? "OVER_LIMIT" : qty > 0 && qty < item.remaining_qty ? "PARTIAL" : qty === item.remaining_qty && qty > 0 ? "READY" : "SKIP";
                        return (
                          <TableRow key={item.id} className="border-slate-100">
                            <TableCell className="whitespace-normal px-4 py-3 text-[13px] font-semibold">{item.title || item.variant_id}</TableCell>
                            <TableCell className="px-4 py-3 text-[13px]">{item.ordered_qty}</TableCell>
                            <TableCell className="px-4 py-3 text-[13px]">{item.received_qty}</TableCell>
                            <TableCell className="px-4 py-3 text-[13px]">{item.remaining_qty}</TableCell>
                            <TableCell className="px-4 py-3">
                              <input
                                type="number"
                                min={0}
                                max={item.remaining_qty}
                                value={qty}
                                disabled={!canInvoice}
                                onChange={(event) => {
                                  const next = Math.min(item.remaining_qty, Math.max(0, Number(event.target.value) || 0));
                                  setInvoiceQty((current) => ({ ...current, [item.id]: next }));
                                }}
                                className="w-24 rounded-lg border border-slate-200 px-2 py-1.5 text-[12px]"
                              />
                            </TableCell>
                            <TableCell className="px-4 py-3 font-mono text-[12px]">{formatCurrency(item.unit_cost)}</TableCell>
                            <TableCell className="px-4 py-3">
                              <input value={invoiceNotes[item.id] || ""} onChange={(event) => setInvoiceNotes((current) => ({ ...current, [item.id]: event.target.value }))} className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-[12px]" />
                            </TableCell>
                            <TableCell className="px-4 py-3"><StatusBadge label={lineStatus} variant={statusVariant(lineStatus)} /></TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
                {invoiceTotal.partial ? (
                  <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-[13px] text-amber-800">
                    <AlertCircle className="mt-0.5 h-4 w-4" /> This is a partial delivery.
                  </div>
                ) : null}
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-[13px] text-slate-600">Total qty {invoiceTotal.qty} - {formatCurrency(invoiceTotal.amount)}</p>
                  <Button onClick={() => void submitInvoice()} disabled={!canInvoice || working || invoiceTotal.qty <= 0 || invoiceTotal.invalid}>
                    <Send className="h-3.5 w-3.5" /> Submit Invoice
                  </Button>
                </div>
              </div>
            </Section>

            <Section title="Submitted Documents" icon={FileText}>
              {order.invoices.length === 0 ? (
                <EmptyState variant="no-data" title="No invoices yet" description="Submit an invoice or delivery note when books are ready to ship." className="py-10" />
              ) : (
                <div className="divide-y divide-slate-100">
                  {order.invoices.map((invoice) => {
                    const total = invoice.items.reduce((sum, item) => sum + item.invoiced_qty, 0);
                    const accepted = invoice.items.reduce((sum, item) => sum + item.accepted_qty, 0);
                    const isRedelivery = Boolean(invoice.raw_payload?.redelivery);
                    return (
                      <div key={invoice.id} className="p-5">
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                          <div>
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="text-[13px] font-semibold">{invoice.invoice_number}</p>
                              {isRedelivery ? <span className="rounded-full bg-cyan-50 px-2 py-1 text-[11px] font-semibold text-cyan-700">Redelivery</span> : null}
                              <StatusBadge label={statusLabel(invoice.status)} variant={statusVariant(invoice.status)} />
                            </div>
                            <p className="mt-1 text-[12px] text-slate-500">Delivery {invoice.delivery_number || "-"} - Expected {formatDate(invoice.expected_delivery_date)}</p>
                          </div>
                          <Button variant="outline" size="sm" onClick={() => navigator.clipboard.writeText(invoice.invoice_number).then(() => toast.success("Invoice number copied"))}>
                            <Clipboard className="h-3.5 w-3.5" /> Copy
                          </Button>
                        </div>
                        <div className="mt-3 grid gap-3 sm:grid-cols-3">
                          <StatBox label="Invoice qty" value={total} />
                          <StatBox label="Accepted qty" value={accepted} />
                          <StatBox label="Linked GR" value={invoice.goods_receipts?.[0]?.receipt_number || "-"} />
                        </div>
                        <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200">
                          <table className="w-full min-w-[760px]">
                            <tbody>
                              {invoice.items.map((item) => (
                                <tr key={item.id} className="border-b border-slate-100 last:border-0">
                                  <td className="px-4 py-3 text-[13px] font-semibold">{item.title || item.variant_id}</td>
                                  <td className="px-4 py-3 font-mono text-[12px] text-slate-500">{item.isbn13 || item.sku || "-"}</td>
                                  <td className="px-4 py-3 text-[13px]">Invoiced {item.invoiced_qty}</td>
                                  <td className="px-4 py-3 text-[13px]">Accepted {item.accepted_qty}</td>
                                  <td className="px-4 py-3 font-mono text-[12px]">{formatCurrency(item.unit_cost)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </Section>
          </FadeItem>
        ) : null}

        {tab === "shortages" ? (
          <Section title="Shortage Reports" icon={AlertCircle}>
            {order.shortage_reports.length === 0 ? (
              <EmptyState variant="no-data" title="No shortage reports" description="Any reported receiving shortage will appear here." className="py-10" />
            ) : (
              <div className="divide-y divide-slate-100">
                {order.shortage_reports.map((report) => {
                  const shortageQty = report.items.reduce((sum, item) => sum + item.shortage_qty, 0);
                  return (
                    <div key={report.id} className="space-y-3 p-5">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <StatusBadge label={statusLabel(report.status)} variant={statusVariant(report.status)} />
                            <span className="text-[13px] font-semibold">{shortageQty} units short</span>
                          </div>
                          <p className="mt-1 text-[12px] text-slate-500">Created {formatDate(report.created_at)} - Sent {formatDate(report.sent_at)}</p>
                          <p className="mt-1 text-[12px] text-slate-600">{report.reason || "-"}</p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {["OPEN", "SENT_TO_SUPPLIER"].includes(report.status) ? (
                            <Button variant="outline" size="sm" onClick={() => void acknowledgeShortage(report)} disabled={working}>
                              <CheckCircle2 className="h-3.5 w-3.5" /> Acknowledge
                            </Button>
                          ) : null}
                          {["OPEN", "SENT_TO_SUPPLIER", "ACKNOWLEDGED"].includes(report.status) ? (
                            <Button size="sm" onClick={() => { setRedeliveryReportId(report.id); setTab("redelivery"); }}>
                              <RotateCcw className="h-3.5 w-3.5" /> Create Redelivery
                            </Button>
                          ) : null}
                        </div>
                      </div>
                      <div className="overflow-x-auto rounded-lg border border-slate-200">
                        <table className="w-full min-w-[760px]">
                          <tbody>
                            {report.items.map((item) => (
                              <tr key={item.id} className="border-b border-slate-100 last:border-0">
                                <td className="px-4 py-3 text-[13px] font-semibold">{item.title || item.variant_id}</td>
                                <td className="px-4 py-3 font-mono text-[12px] text-slate-500">{item.isbn13 || item.sku || "-"}</td>
                                <td className="px-4 py-3 text-[13px]">Ordered {item.ordered_qty}</td>
                                <td className="px-4 py-3 text-[13px]">Received {item.received_qty}</td>
                                <td className="px-4 py-3 text-[13px] font-semibold">Short {item.shortage_qty}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      {["OPEN", "SENT_TO_SUPPLIER", "ACKNOWLEDGED"].includes(report.status) ? (
                        <div className="flex flex-col gap-2 sm:flex-row">
                          <input
                            value={cannotReason[report.id] || ""}
                            onChange={(event) => setCannotReason((current) => ({ ...current, [report.id]: event.target.value }))}
                            placeholder="Cannot fulfill reason"
                            className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-[13px]"
                          />
                          <Button variant="outline" size="sm" onClick={() => void markCannotFulfill(report)} disabled={working}>
                            <XCircle className="h-3.5 w-3.5" /> Cannot Fulfill
                          </Button>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            )}
          </Section>
        ) : null}

        {tab === "redelivery" ? (
          <Section title="Create Redelivery Invoice" icon={RotateCcw}>
            {openShortages.length === 0 ? (
              <EmptyState variant="no-data" title="No open shortage reports" description="Redelivery is available after the library reports a shortage." className="py-10" />
            ) : (
              <div className="space-y-4 p-5">
                <select
                  value={redeliveryReportId}
                  onChange={(event) => {
                    const report = order.shortage_reports.find((item) => item.id === event.target.value);
                    setRedeliveryReportId(event.target.value);
                    if (report) setRedeliveryQty(Object.fromEntries(report.items.map((item) => [item.purchase_order_item_id, item.shortage_qty])));
                  }}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-[13px]"
                >
                  {openShortages.map((report) => (
                    <option key={report.id} value={report.id}>
                      {statusLabel(report.status)} - {report.items.reduce((sum, item) => sum + item.shortage_qty, 0)} units short
                    </option>
                  ))}
                </select>
                {selectedShortage ? (
                  <>
                    <div className="grid gap-3 md:grid-cols-5">
                      <input value={invoiceNumber} onChange={(event) => setInvoiceNumber(event.target.value)} placeholder="Invoice number" className="rounded-lg border border-slate-200 px-3 py-2 text-[13px]" />
                      <input value={deliveryNumber} onChange={(event) => setDeliveryNumber(event.target.value)} placeholder="Delivery number" className="rounded-lg border border-slate-200 px-3 py-2 text-[13px]" />
                      <input type="date" value={invoiceDate} onChange={(event) => setInvoiceDate(event.target.value)} className="rounded-lg border border-slate-200 px-3 py-2 text-[13px]" />
                      <input type="date" value={expectedDeliveryDate} onChange={(event) => setExpectedDeliveryDate(event.target.value)} className="rounded-lg border border-slate-200 px-3 py-2 text-[13px]" />
                      <input value={supplierNote} onChange={(event) => setSupplierNote(event.target.value)} placeholder="Supplier note" className="rounded-lg border border-slate-200 px-3 py-2 text-[13px]" />
                    </div>
                    <div className="overflow-x-auto rounded-lg border border-slate-200">
                      <table className="w-full min-w-[820px]">
                        <thead>
                          <tr className="border-b border-slate-100 bg-slate-50">
                            {["Book", "Received", "Shortage Max", "Redelivery Qty", "Status"].map((heading) => (
                              <th key={heading} className="px-4 py-3 text-left text-[11px] font-semibold uppercase text-slate-500">{heading}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {selectedShortage.items.map((item) => {
                            const qty = Number(redeliveryQty[item.purchase_order_item_id] || 0);
                            return (
                              <tr key={item.id} className="border-b border-slate-100 last:border-0">
                                <td className="px-4 py-3 text-[13px] font-semibold">{item.title || item.variant_id}</td>
                                <td className="px-4 py-3 text-[13px]">{item.received_qty}</td>
                                <td className="px-4 py-3 text-[13px]">{item.shortage_qty}</td>
                                <td className="px-4 py-3">
                                  <input
                                    type="number"
                                    min={0}
                                    max={item.shortage_qty}
                                    value={qty}
                                    onChange={(event) => {
                                      const next = Math.min(item.shortage_qty, Math.max(0, Number(event.target.value) || 0));
                                      setRedeliveryQty((current) => ({ ...current, [item.purchase_order_item_id]: next }));
                                    }}
                                    className="w-24 rounded-lg border border-slate-200 px-2 py-1.5 text-[12px]"
                                  />
                                </td>
                                <td className="px-4 py-3">
                                  <StatusBadge label={qty === item.shortage_qty ? "FULL_REDELIVERY" : qty > 0 ? "PARTIAL_REDELIVERY" : "SKIP"} variant={qty > 0 ? "warning" : "neutral"} />
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <p className="text-[13px] text-slate-600">Total redelivery qty {redeliveryTotal.qty}</p>
                      <Button onClick={() => void submitRedelivery()} disabled={working || redeliveryTotal.qty <= 0 || redeliveryTotal.invalid}>
                        <Send className="h-3.5 w-3.5" /> Submit Redelivery
                      </Button>
                    </div>
                  </>
                ) : null}
              </div>
            )}
          </Section>
        ) : null}

        {tab === "activity" ? (
          <Section title="Activity" icon={RefreshCw}>
            <div className="space-y-3 p-5">
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-[13px] text-slate-700">Dispatch sent: {formatDate(order.dispatch.sent_at)}</div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-[13px] text-slate-700">Acknowledged: {formatDate(order.dispatch.acknowledged_at)}</div>
              {order.invoices.map((invoice) => (
                <div key={invoice.id} className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-[13px] text-slate-700">
                  Invoice {invoice.invoice_number}: {statusLabel(invoice.status)}
                </div>
              ))}
              {order.shortage_reports.map((report) => (
                <div key={report.id} className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-[13px] text-slate-700">
                  Shortage {report.id.slice(0, 8)}: {statusLabel(report.status)}
                </div>
              ))}
            </div>
          </Section>
        ) : null}
      </PageWrapper>

      <ConfirmDialog
        open={confirmState.open}
        onOpenChange={(open) => setConfirmState((s) => ({ ...s, open }))}
        title={confirmState.title}
        description={confirmState.description}
        variant={confirmState.variant}
        onConfirm={confirmState.onConfirm}
        loading={working}
      />
    </div>
  );
}
