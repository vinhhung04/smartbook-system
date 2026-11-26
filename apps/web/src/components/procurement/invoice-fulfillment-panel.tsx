import { useState } from "react";
import { CheckCircle2, Truck, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { StatusBadge } from "@/components/status-badge";
import { cn } from "@/components/ui/utils";
import type { InvoiceFulfillment, ProcurementDocument } from "@/services/procurement-documents";
import { formatDay, formatDateTime, formatMoney } from "@/lib/procurement-document-status";

type Tone = "success" | "warning" | "danger" | "info" | "neutral" | "primary";

const APPROVAL: Record<string, { label: string; tone: Tone }> = {
  PENDING_APPROVAL: { label: "Chờ SmartBook duyệt", tone: "warning" },
  APPROVED: { label: "Đã duyệt", tone: "success" },
  REJECTED: { label: "Bị từ chối / cần điều chỉnh", tone: "danger" },
};

const DELIVERY: Record<string, { label: string; tone: Tone }> = {
  AWAITING_SHIPMENT: { label: "Chưa giao", tone: "neutral" },
  IN_TRANSIT: { label: "Đang vận chuyển", tone: "info" },
  PARTIALLY_RECEIVED: { label: "Nhận một phần", tone: "warning" },
  RECEIVED: { label: "Giao thành công đơn", tone: "success" },
  CANCELLED: { label: "Đã hủy", tone: "neutral" },
};

/** "Giao thành công 5/10 · còn thiếu 5" — only SmartBook-confirmed receipts count as delivered. */
function fulfillmentHeadline(f: InvoiceFulfillment) {
  if (f.status === "RECEIVED") return `Giao thành công đơn (${f.received_qty}/${f.invoiced_qty})`;
  const parts = [];
  if (f.received_qty > 0) parts.push(`Giao thành công ${f.received_qty}/${f.invoiced_qty}`);
  if (f.in_transit_qty > 0) parts.push(`đang vận chuyển ${f.in_transit_qty}`);
  parts.push(`còn thiếu ${f.missing_qty} quyển`);
  return parts.join(" · ");
}

interface Props {
  invoices: ProcurementDocument[];
  fulfillment: InvoiceFulfillment[];
  /** PO line id -> display title */
  titleOf: (poItemId: string) => string;
  /** SmartBook reviewer actions; omitted on the supplier side */
  onReview?: (docId: string, decision: "APPROVE" | "REJECT", note: string) => Promise<void>;
  busy?: boolean;
}

export function InvoiceFulfillmentPanel({ invoices, fulfillment, titleOf, onReview, busy }: Props) {
  const [rejecting, setRejecting] = useState<{ id: string; note: string } | null>(null);
  const sent = invoices.filter((doc) => doc.status !== "DRAFT" && doc.status !== "CANCELLED" && doc.approval_status);

  if (sent.length === 0) {
    return <p className="px-5 py-6 text-center text-[13px] text-muted-foreground">Chưa có hóa đơn nào được gửi cho đơn này.</p>;
  }

  return (
    <ul className="divide-y divide-border">
      {sent.map((doc) => {
        const progress = fulfillment.find((f) => f.invoice_id === doc.id);
        const approval = APPROVAL[doc.approval_status || ""] || { label: doc.approval_status || "-", tone: "neutral" as Tone };
        const linesById = new Map((progress?.lines || []).map((line) => [line.purchase_order_item_id, line]));
        const approved = doc.approval_status === "APPROVED";
        return (
          <li key={doc.id} className="space-y-3 px-5 py-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="text-[14px] font-semibold text-foreground">
                  Hóa đơn {doc.invoice_series ? `${doc.invoice_series}/` : ""}{doc.external_number || doc.document_number}
                </p>
                <p className="text-[12px] text-muted-foreground">
                  {doc.document_type_label} · Ngày lập {formatDay(doc.issue_date)} · Tổng {formatMoney(doc.total_amount)}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge label={approval.label} variant={approval.tone} dot />
                {approved && progress ? <StatusBadge label={DELIVERY[progress.status]?.label || progress.status} variant={DELIVERY[progress.status]?.tone} /> : null}
              </div>
            </div>

            {doc.approval_status === "REJECTED" && doc.approval_note ? (
              <p className="text-[13px] text-rose-700 dark:text-rose-400">Lý do SmartBook từ chối: {doc.approval_note}</p>
            ) : null}
            {approved && progress ? (
              <p className={cn("text-[13px] font-medium", progress.status === "RECEIVED" ? "text-emerald-700 dark:text-emerald-400" : "text-foreground")}>
                {fulfillmentHeadline(progress)}
              </p>
            ) : null}

            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-[13px]">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                    <th className="py-1.5 pr-3">Sách</th>
                    <th className="py-1.5 pr-3 text-right">Số lượng</th>
                    <th className="py-1.5 pr-3 text-right">Đơn giá</th>
                    <th className="py-1.5 pr-3 text-right">Thành tiền</th>
                    {approved ? (
                      <>
                        <th className="py-1.5 pr-3 text-right">Đã gửi</th>
                        <th className="py-1.5 pr-3 text-right">Đang vận chuyển</th>
                        <th className="py-1.5 pr-3 text-right">Đã nhận</th>
                        <th className="py-1.5 text-right">Còn thiếu</th>
                      </>
                    ) : null}
                  </tr>
                </thead>
                <tbody>
                  {doc.lines.map((line) => {
                    const p = line.purchase_order_item_id ? linesById.get(line.purchase_order_item_id) : undefined;
                    return (
                      <tr key={line.id} className="border-t border-border">
                        <td className="py-1.5 pr-3">
                          <span className="block">{line.title || (line.purchase_order_item_id ? titleOf(line.purchase_order_item_id) : "-")}</span>
                          {line.item_code ? <span className="block font-mono text-[11px] text-muted-foreground">{line.item_code}</span> : null}
                        </td>
                        <td className="py-1.5 pr-3 text-right tabular-nums">{line.quantity}</td>
                        <td className="py-1.5 pr-3 text-right tabular-nums">{formatMoney(line.unit_price)}</td>
                        <td className="py-1.5 pr-3 text-right tabular-nums">{formatMoney(line.line_amount)}</td>
                        {approved ? (
                          <>
                            <td className="py-1.5 pr-3 text-right tabular-nums">{p?.shipped_qty ?? 0}</td>
                            <td className="py-1.5 pr-3 text-right tabular-nums">{p?.in_transit_qty ?? 0}</td>
                            <td className="py-1.5 pr-3 text-right tabular-nums">{p?.received_qty ?? 0}</td>
                            <td className={cn("py-1.5 text-right tabular-nums", (p?.missing_qty ?? line.quantity) > 0 && "font-semibold text-amber-700 dark:text-amber-400")}>{p?.missing_qty ?? line.quantity}</td>
                          </>
                        ) : null}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {approved && progress && progress.deliveries.length > 0 ? (
              <div>
                <p className="mb-1 text-[12px] font-medium text-muted-foreground">Phiếu giao theo hóa đơn này</p>
                <ul className="space-y-1">
                  {progress.deliveries.map((delivery) => (
                    <li key={delivery.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]">
                      <Truck className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                      <span className="font-mono">{delivery.delivery_number || delivery.id.slice(0, 8)}</span>
                      <span className="text-muted-foreground">
                        {delivery.items.map((item) => `${titleOf(item.purchase_order_item_id)}: ${item.received_qty ?? "-"}/${item.shipped_qty}`).join(" · ")}
                      </span>
                      {delivery.carrier_name || delivery.tracking_number ? (
                        <span className="text-muted-foreground">{[delivery.carrier_name, delivery.tracking_number].filter(Boolean).join(" · ")}</span>
                      ) : null}
                      <span className="text-muted-foreground">{formatDateTime(delivery.created_at)}</span>
                      <StatusBadge label={(delivery.redelivery ? "Giao bù · " : "") + (DELIVERY[delivery.status]?.label || delivery.status)} variant={DELIVERY[delivery.status]?.tone} />
                    </li>
                  ))}
                </ul>
                <p className="mt-1 text-[11px] text-muted-foreground">Số đầu tiên là số SmartBook đã xác nhận nhận, số sau là số nhà cung cấp gửi.</p>
              </div>
            ) : null}

            {onReview && doc.approval_status === "PENDING_APPROVAL" ? (
              rejecting?.id === doc.id ? (
                <div className="space-y-2">
                  <Label htmlFor={`reject-${doc.id}`} className="text-[12px]">Lý do từ chối / nội dung cần điều chỉnh (bắt buộc)</Label>
                  <Textarea id={`reject-${doc.id}`} rows={2} value={rejecting.note} onChange={(event) => setRejecting({ id: doc.id, note: event.target.value })} />
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="destructive" disabled={busy || !rejecting.note.trim()} onClick={() => void onReview(doc.id, "REJECT", rejecting.note.trim()).then(() => setRejecting(null))}>Gửi từ chối</Button>
                    <Button size="sm" variant="outline" disabled={busy} onClick={() => setRejecting(null)}>Thôi</Button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" disabled={busy} onClick={() => void onReview(doc.id, "APPROVE", "")}><CheckCircle2 className="h-3.5 w-3.5" />Duyệt hóa đơn</Button>
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => setRejecting({ id: doc.id, note: "" })}><XCircle className="h-3.5 w-3.5" />Từ chối / yêu cầu điều chỉnh</Button>
                </div>
              )
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
