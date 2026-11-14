import { useMemo, useRef, useState } from "react";
import { CheckCircle2, ChevronDown, Download, FileText, Mail, Send, Upload, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/status-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/components/ui/utils";
import { getApiErrorMessage } from "@/services/api";
import type { ProcurementDocument, ProcurementDocumentFile } from "@/services/procurement-documents";
import {
  ACCEPTED_FILE_TYPES,
  documentStatusMeta,
  formatBytes,
  formatDateTime,
  formatDay,
  formatMoney,
  shareStatusMeta,
} from "@/lib/procurement-document-status";

type Party = "SUPPLIER" | "SMARTBOOK";

export interface DocumentActions {
  download: (doc: ProcurementDocument, file: ProcurementDocumentFile) => Promise<void>;
  acknowledge: (docId: string) => Promise<unknown>;
  uploadVersion: (docId: string, file: File) => Promise<unknown>;
  issue: (docId: string) => Promise<unknown>;
  cancel: (docId: string, reason: string) => Promise<unknown>;
  share?: (docId: string, channel: "PORTAL" | "EMAIL") => Promise<unknown>;
}

interface Props {
  documents: ProcurementDocument[];
  viewer: Party;
  actions: DocumentActions;
  onChanged: () => void | Promise<void>;
  /** SmartBook manager: may share / cancel SmartBook documents. Staff: false. */
  canManage?: boolean;
  /** May upload a new scan version for this SmartBook document (staff: own receipts only). */
  canUploadVersion?: (doc: ProcurementDocument) => boolean;
  emptyDescription?: string;
}

const GROUPS: { value: string; label: string; types: string[] }[] = [
  { value: "ALL", label: "Tất cả", types: [] },
  { value: "INVOICE", label: "Hóa đơn", types: ["VAT_INVOICE", "SALES_INVOICE", "PROFORMA_INVOICE"] },
  { value: "DELIVERY", label: "Giao hàng", types: ["DELIVERY_NOTE"] },
  { value: "RECEIVING", label: "Kiểm nhận", types: ["GOODS_RECEIPT_CONFIRMATION", "DELIVERY_ACCEPTANCE_MINUTES"] },
  { value: "OTHER", label: "Chênh lệch & khác", types: ["DISCREPANCY_REPORT", "PAYMENT_EVIDENCE", "OTHER"] },
];

const INVOICE_TYPES = new Set(["VAT_INVOICE", "SALES_INVOICE", "PROFORMA_INVOICE"]);
const LIVE = new Set(["DRAFT", "ISSUED", "PENDING_SIGNED_DOCUMENT", "SCAN_UPLOADED"]);

function partyLabel(party: Party) {
  return party === "SUPPLIER" ? "Nhà cung cấp phát hành" : "SmartBook phát hành";
}

const METADATA_LABEL: Record<string, string> = {
  lookup_code: "Mã tra cứu hóa đơn điện tử",
  lookup_url: "Trang tra cứu",
  seller_tax_code: "Mã số thuế bên bán",
  buyer_tax_code: "Mã số thuế bên mua",
  payment_due_date: "Hạn thanh toán",
  carrier_name: "Đơn vị vận chuyển",
  deliverer_name: "Người giao",
  signed_date: "Ngày ký",
  supplier_representative: "Đại diện nhà cung cấp",
  library_representative: "Đại diện thư viện",
  confirmed_qty: "Số lượng xác nhận",
  discrepancy_summary: "Chênh lệch",
  payment_reference: "Số tham chiếu thanh toán",
  paid_amount: "Số tiền",
  paid_date: "Ngày thanh toán",
  delivery_note_number: "Phiếu giao",
  note: "Ghi chú",
};

export function ProcurementDocumentList({ documents, viewer, actions, onChanged, canManage = false, canUploadVersion, emptyDescription }: Props) {
  const [group, setGroup] = useState("ALL");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [cancelTarget, setCancelTarget] = useState<ProcurementDocument | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const fileInputs = useRef<Record<string, HTMLInputElement | null>>({});

  const visible = useMemo(() => {
    const types = GROUPS.find((g) => g.value === group)?.types || [];
    return types.length ? documents.filter((doc) => types.includes(doc.document_type)) : documents;
  }, [documents, group]);

  const run = async (key: string, label: string, action: () => Promise<unknown>) => {
    try {
      setBusy(key);
      await action();
      if (label) toast.success(label);
      await onChanged();
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Thao tác thất bại"));
    } finally {
      setBusy(null);
    }
  };

  const mayUpload = (doc: ProcurementDocument) => {
    if (doc.issuer_party !== viewer || !LIVE.has(doc.status) || doc.document_type === "GOODS_RECEIPT_CONFIRMATION") return false;
    if (INVOICE_TYPES.has(doc.document_type) && doc.status !== "DRAFT") return false;
    if (viewer === "SMARTBOOK") return canUploadVersion ? canUploadVersion(doc) : canManage;
    return true;
  };
  // A delivery note mirrors a delivery batch the warehouse may already have received: it is corrected
  // through a discrepancy report, never by cancelling it.
  const mayCancel = (doc: ProcurementDocument) => doc.issuer_party === viewer && LIVE.has(doc.status) && doc.document_type !== "DELIVERY_NOTE" && (viewer === "SUPPLIER" || canManage);
  const mayIssue = (doc: ProcurementDocument) => doc.issuer_party === viewer && doc.status === "DRAFT" && (viewer === "SUPPLIER" || canManage) && (!INVOICE_TYPES.has(doc.document_type) || doc.files.length > 0);
  const mayAcknowledge = (doc: ProcurementDocument) => doc.issuer_party !== viewer && ["SENT", "DELIVERED"].includes(doc.sharing.status);
  const mayShare = (doc: ProcurementDocument) => viewer === "SMARTBOOK" && canManage && Boolean(actions.share) && doc.issuer_party === "SMARTBOOK" && ["ISSUED", "SCAN_UPLOADED"].includes(doc.status);

  return (
    <div>
      <div className="flex flex-wrap gap-1.5 px-5 pb-3" role="tablist" aria-label="Lọc theo loại chứng từ">
        {GROUPS.map((g) => {
          const count = g.types.length ? documents.filter((doc) => g.types.includes(doc.document_type)).length : documents.length;
          return (
            <button
              key={g.value}
              type="button"
              role="tab"
              aria-selected={group === g.value}
              onClick={() => setGroup(g.value)}
              className={cn(
                "inline-flex min-h-8 items-center gap-1.5 rounded-full border px-3 text-[12px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                group === g.value ? "border-indigo-300 bg-indigo-50 text-indigo-700 dark:border-indigo-500/40 dark:bg-indigo-500/10 dark:text-indigo-300" : "border-border text-muted-foreground hover:bg-accent",
              )}
            >
              {g.label}
              <span className="tabular-nums opacity-70">{count}</span>
            </button>
          );
        })}
      </div>

      {visible.length === 0 ? (
        <EmptyState variant="no-data" title="Chưa có chứng từ" description={emptyDescription || "Chứng từ do hai bên phát hành sẽ hiện ở đây."} className="border-t border-border py-8" />
      ) : (
        <ul className="divide-y divide-border border-t border-border">
          {visible.map((doc) => {
            const status = documentStatusMeta(doc.status);
            const share = shareStatusMeta(doc.sharing.status);
            const latest = doc.files[0];
            const open = expanded === doc.id;
            const isMine = doc.issuer_party === viewer;
            return (
              <li key={doc.id} className="px-5 py-3.5">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <FileText className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                      <span className="text-[13px] font-semibold text-foreground">{doc.document_type_label}</span>
                      <span className="font-mono text-[12px] text-muted-foreground">
                        {doc.invoice_series ? `${doc.invoice_series} · ` : ""}{doc.external_number || doc.document_number}
                      </span>
                      <StatusBadge label={status.label} variant={status.tone} />
                    </div>
                    <p className="mt-1 text-[12px] text-muted-foreground">
                      {partyLabel(doc.issuer_party)}
                      {doc.issue_date ? ` · ngày ${formatDay(doc.issue_date)}` : ""}
                      {doc.goods_receipt_number ? ` · phiếu nhập ${doc.goods_receipt_number}` : ""}
                      {doc.total_amount != null ? ` · ${formatMoney(doc.total_amount)}` : ""}
                      {` · mã ${doc.document_number}`}
                    </p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[12px]">
                      <span className="text-muted-foreground">{isMine ? "Bên nhận:" : "Bạn:"}</span>
                      <StatusBadge label={share.label} variant={share.tone} dot />
                      {doc.sharing.acknowledged_at ? <span className="text-muted-foreground">xác nhận {formatDateTime(doc.sharing.acknowledged_at)}</span>
                        : doc.sharing.delivered_at ? <span className="text-muted-foreground">mở lúc {formatDateTime(doc.sharing.delivered_at)}</span>
                          : doc.sharing.shared_at ? <span className="text-muted-foreground">gửi lúc {formatDateTime(doc.sharing.shared_at)}</span> : null}
                    </div>
                    {doc.status === "CANCELLED" && doc.cancel_reason ? <p className="mt-1 text-[12px] text-red-700 dark:text-red-400">Lý do hủy: {doc.cancel_reason}</p> : null}
                    {doc.superseded_by.length ? <p className="mt-1 text-[12px] text-muted-foreground">Được thay thế bởi {doc.superseded_by.map((d) => d.document_number).join(", ")}</p> : null}
                  </div>

                  <div className="flex flex-wrap gap-2 lg:justify-end">
                    {latest ? (
                      <Button variant="outline" size="sm" disabled={busy !== null} onClick={() => void run(`dl-${doc.id}`, "", () => actions.download(doc, latest))}>
                        <Download className="h-3.5 w-3.5" />Tải v{latest.version_no}
                      </Button>
                    ) : null}
                    {mayAcknowledge(doc) ? (
                      <Button size="sm" disabled={busy !== null} onClick={() => void run(`ack-${doc.id}`, "Đã xác nhận nhận chứng từ", () => actions.acknowledge(doc.id))}>
                        <CheckCircle2 className="h-3.5 w-3.5" />Xác nhận đã nhận
                      </Button>
                    ) : null}
                    {mayIssue(doc) ? (
                      <Button size="sm" disabled={busy !== null} onClick={() => void run(`issue-${doc.id}`, "Đã phát hành chứng từ", () => actions.issue(doc.id))}>
                        <Send className="h-3.5 w-3.5" />Phát hành
                      </Button>
                    ) : null}
                    {mayShare(doc) ? (
                      <>
                        <Button variant="outline" size="sm" disabled={busy !== null} onClick={() => void run(`sp-${doc.id}`, "Đã chia sẻ qua cổng nhà cung cấp", () => actions.share!(doc.id, "PORTAL"))}>
                          <Send className="h-3.5 w-3.5" />Chia sẻ cổng nhà cung cấp
                        </Button>
                        <Button variant="outline" size="sm" disabled={busy !== null} onClick={() => void run(`se-${doc.id}`, "Đã ghi nhận lần gửi email (xem trạng thái)", () => actions.share!(doc.id, "EMAIL"))}>
                          <Mail className="h-3.5 w-3.5" />Gửi email
                        </Button>
                      </>
                    ) : null}
                    {mayUpload(doc) ? (
                      <>
                        <input
                          ref={(el) => { fileInputs.current[doc.id] = el; }}
                          type="file"
                          accept={ACCEPTED_FILE_TYPES}
                          className="sr-only"
                          aria-label={`Tải file cho ${doc.document_number}`}
                          onChange={(event) => {
                            const file = event.target.files?.[0];
                            event.target.value = "";
                            if (file) void run(`up-${doc.id}`, "Đã tải phiên bản mới", () => actions.uploadVersion(doc.id, file));
                          }}
                        />
                        <Button variant="outline" size="sm" disabled={busy !== null} onClick={() => fileInputs.current[doc.id]?.click()}>
                          <Upload className="h-3.5 w-3.5" />{doc.files.length ? "Tải bản mới" : doc.document_type === "DELIVERY_ACCEPTANCE_MINUTES" ? "Tải bản scan đã ký" : "Đính kèm file"}
                        </Button>
                      </>
                    ) : null}
                    {mayCancel(doc) ? (
                      <Button variant="outline" size="sm" disabled={busy !== null} className="text-red-600 hover:text-red-700 dark:text-red-400" onClick={() => { setCancelReason(""); setCancelTarget(doc); }}>
                        <XCircle className="h-3.5 w-3.5" />Hủy
                      </Button>
                    ) : null}
                    <Button variant="ghost" size="sm" aria-expanded={open} aria-controls={`doc-detail-${doc.id}`} onClick={() => setExpanded(open ? null : doc.id)}>
                      Chi tiết<ChevronDown className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")} />
                    </Button>
                  </div>
                </div>

                {open ? (
                  <div id={`doc-detail-${doc.id}`} className="mt-3 grid gap-4 rounded-lg border border-border bg-muted/20 p-3 text-[12px] md:grid-cols-2">
                    <div>
                      <p className="mb-1.5 font-semibold text-foreground">File & phiên bản</p>
                      {doc.files.length === 0 ? (
                        <p className="text-muted-foreground">{doc.document_type === "DELIVERY_ACCEPTANCE_MINUTES" ? "Chưa có bản scan biên bản đã ký." : "Không có file đính kèm."}</p>
                      ) : (
                        <ul className="space-y-1.5">
                          {doc.files.map((file) => (
                            <li key={file.id} className="flex flex-wrap items-center justify-between gap-2">
                              <span className="min-w-0">
                                <span className="font-medium">v{file.version_no}</span> · {file.original_name} · {formatBytes(file.size_bytes)} · {formatDateTime(file.created_at)}
                                <span className="block break-all font-mono text-[11px] text-muted-foreground" title="SHA-256">SHA-256 {file.sha256}</span>
                              </span>
                              <Button variant="ghost" size="sm" aria-label={`Tải phiên bản ${file.version_no}`} onClick={() => void run(`dl-${file.id}`, "", () => actions.download(doc, file))}>
                                <Download className="h-3.5 w-3.5" />
                              </Button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                    <div>
                      <p className="mb-1.5 font-semibold text-foreground">Lịch sử chia sẻ</p>
                      {doc.shares.length === 0 ? <p className="text-muted-foreground">Chưa chia sẻ.</p> : (
                        <ul className="space-y-1.5">
                          {doc.shares.map((row) => {
                            const meta = shareStatusMeta(row.status);
                            return (
                              <li key={row.id} className="flex flex-wrap items-center gap-2">
                                <StatusBadge label={meta.label} variant={meta.tone} />
                                <span>{row.channel === "EMAIL" ? `Email${row.recipient_email ? ` → ${row.recipient_email}` : ""}` : "Cổng"} → {row.recipient_party === "SUPPLIER" ? "Nhà cung cấp" : "SmartBook"}</span>
                                <span className="text-muted-foreground">{formatDateTime(row.shared_at)}</span>
                                {row.message_id ? <span className="break-all font-mono text-[11px] text-muted-foreground">msg {row.message_id}</span> : null}
                                {row.error_message ? <span className="w-full text-red-700 dark:text-red-400">Lỗi: {row.error_message}</span> : null}
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </div>
                    {Object.entries(doc.metadata || {}).some(([key, value]) => METADATA_LABEL[key] && value != null && value !== "") ? (
                      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                        {Object.entries(doc.metadata).filter(([key, value]) => METADATA_LABEL[key] && value != null && value !== "").map(([key, value]) => (
                          <div key={key} className="contents">
                            <dt className="text-muted-foreground">{METADATA_LABEL[key]}</dt>
                            <dd className="break-words">{String(value)}</dd>
                          </div>
                        ))}
                      </dl>
                    ) : null}
                    {INVOICE_TYPES.has(doc.document_type) ? (
                      <p className="text-muted-foreground md:col-span-2">
                        Tiền hàng {formatMoney(doc.subtotal_amount)} · Thuế {doc.tax_rate != null ? `${doc.tax_rate}%` : "-"} ({formatMoney(doc.tax_amount)}) · Tổng {formatMoney(doc.total_amount)}.
                        {" "}Đây là chứng từ nhà cung cấp tải lên; SmartBook chưa đối chiếu với cơ quan thuế.
                      </p>
                    ) : null}
                    {doc.lines.length ? (
                      <div className="overflow-x-auto md:col-span-2">
                        <table className="w-full min-w-[480px]">
                          <thead><tr className="text-left text-[11px] uppercase text-muted-foreground"><th className="py-1 pr-2">Sách</th><th className="py-1 pr-2 text-right">Số lượng</th><th className="py-1 pr-2 text-right">Đơn giá</th><th className="py-1 text-right">Thành tiền</th></tr></thead>
                          <tbody>
                            {doc.lines.map((line) => (
                              <tr key={line.id} className="border-t border-border/60">
                                <td className="py-1 pr-2">{line.title || "-"}<span className="block font-mono text-[11px] text-muted-foreground">{line.isbn13 || ""}</span></td>
                                <td className="py-1 pr-2 text-right tabular-nums">{line.quantity}</td>
                                <td className="py-1 pr-2 text-right tabular-nums">{formatMoney(line.unit_price)}</td>
                                <td className="py-1 text-right tabular-nums">{formatMoney(line.line_amount)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : null}
                    {doc.document_type === "GOODS_RECEIPT_CONFIRMATION" && Array.isArray(doc.metadata?.lines) ? (
                      <div className="overflow-x-auto md:col-span-2">
                        <table className="w-full min-w-[560px]">
                          <thead><tr className="text-left text-[11px] uppercase text-muted-foreground"><th className="py-1 pr-2">Sách</th><th className="py-1 pr-2 text-right">Phiếu giao</th><th className="py-1 pr-2 text-right">Thực nhận</th><th className="py-1 pr-2 text-right">Chấp nhận</th><th className="py-1 pr-2 text-right">Hỏng</th><th className="py-1 pr-2 text-right">Từ chối</th><th className="py-1 text-right">Thiếu</th></tr></thead>
                          <tbody>
                            {(doc.metadata.lines as Array<Record<string, number | string | null>>).map((line, index) => (
                              <tr key={index} className="border-t border-border/60">
                                <td className="py-1 pr-2">{String(line.title || "-")}</td>
                                {["delivery_note_qty", "delivered_qty", "accepted_qty", "damaged_qty", "rejected_qty", "missing_qty"].map((key) => (
                                  <td key={key} className="py-1 pr-2 text-right tabular-nums">{String(line[key] ?? 0)}</td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        <p className="mt-1 text-muted-foreground">Xác nhận kết quả kiểm nhận của SmartBook — không phải hóa đơn.</p>
                      </div>
                    ) : null}
                    {viewer === "SMARTBOOK" && doc.internal_note ? <p className="md:col-span-2"><span className="text-muted-foreground">Ghi chú nội bộ: </span>{doc.internal_note}</p> : null}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      <ConfirmDialog
        open={Boolean(cancelTarget)}
        onOpenChange={(value) => { if (!value) setCancelTarget(null); }}
        title={`Hủy ${cancelTarget?.document_type_label?.toLowerCase() || "chứng từ"} ${cancelTarget?.external_number || cancelTarget?.document_number || ""}`}
        description="Chứng từ không bị xóa: trạng thái chuyển sang Đã hủy, file và lịch sử được giữ lại."
        confirmLabel="Hủy chứng từ"
        variant="destructive"
        loading={busy === "cancel"}
        onConfirm={async () => {
          if (!cancelTarget) return;
          if (!cancelReason.trim()) {
            toast.error("Cần nhập lý do hủy");
            return;
          }
          await run("cancel", "Đã hủy chứng từ", () => actions.cancel(cancelTarget.id, cancelReason.trim()));
          setCancelTarget(null);
        }}
      >
        <label htmlFor="doc-cancel-reason" className="mb-1.5 block text-[11px] font-medium text-muted-foreground">Lý do hủy (bắt buộc)</label>
        <Textarea id="doc-cancel-reason" value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} rows={2} placeholder="Ví dụ: sai mã số thuế bên mua, sẽ lập hóa đơn thay thế" />
      </ConfirmDialog>
    </div>
  );
}
