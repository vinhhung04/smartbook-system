import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, FilePlus2, History, RefreshCw, Scale, ShieldCheck, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { SectionCard } from "@/components/ui/section-card";
import { StatusBadge } from "@/components/status-badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/components/ui/utils";
import { getApiErrorMessage } from "@/services/api";
import type { PurchaseOrderDetail } from "@/services/purchase-order";
import {
  procurementDocumentService,
  type ActivityEntry,
  type DocumentReconciliation,
  type ProcurementDocument,
  type ProcurementDocumentType,
} from "@/services/procurement-documents";
import { ProcurementDocumentList } from "./procurement-document-list";
import {
  ACCEPTED_FILE_TYPES,
  ACTIVITY_LABEL,
  RECONCILIATION_FLAG_LABEL,
  formatDateTime,
  formatDay,
  formatMoney,
  reconciliationStatusMeta,
  supplierResponseMeta,
} from "@/lib/procurement-document-status";

interface Props {
  po: PurchaseOrderDetail;
  canManage: boolean;
  canApprove: boolean;
  onChanged: () => void | Promise<void>;
}

const SMARTBOOK_TYPES: { value: ProcurementDocumentType; label: string }[] = [
  { value: "DELIVERY_ACCEPTANCE_MINUTES", label: "Biên bản giao nhận (bản scan đã ký)" },
  { value: "DISCREPANCY_REPORT", label: "Biên bản chênh lệch" },
  { value: "PAYMENT_EVIDENCE", label: "Chứng từ thanh toán (tham chiếu)" },
  { value: "OTHER", label: "Chứng từ khác" },
];

const selectClass = "h-9 w-full rounded-md border border-input bg-background px-3 text-[13px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function ProcurementDocumentCenter({ po, canManage, canApprove, onChanged }: Props) {
  const [documents, setDocuments] = useState<ProcurementDocument[]>([]);
  const [reconciliation, setReconciliation] = useState<DocumentReconciliation | null>(null);
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [completeOpen, setCompleteOpen] = useState(false);
  const [completeNote, setCompleteNote] = useState("");
  const [review, setReview] = useState<{ decision: "APPROVE" | "REJECT"; note: string } | null>(null);

  const [form, setForm] = useState({
    document_type: "DELIVERY_ACCEPTANCE_MINUTES" as ProcurementDocumentType,
    goods_receipt_id: "",
    external_number: "",
    signed_date: "",
    supplier_representative: "",
    library_representative: "",
    confirmed_qty: "",
    discrepancy_summary: "",
    payment_reference: "",
    paid_amount: "",
    paid_date: "",
    note: "",
    internal_note: "",
  });
  const [file, setFile] = useState<File | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const [docs, rec, acts] = await Promise.all([
        procurementDocumentService.list(po.id),
        procurementDocumentService.reconciliation(po.id),
        procurementDocumentService.activity(po.id),
      ]);
      setDocuments(docs);
      setReconciliation(rec);
      setActivity(acts);
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Không tải được bộ chứng từ"));
    } finally {
      setLoading(false);
    }
  }, [po.id]);

  useEffect(() => { void load(); }, [load, po.updated_at]);

  const refreshAll = async () => {
    await load();
    await onChanged();
  };

  const pendingResponse = (po.supplier_responses || []).find((row) => row.review_status === "PENDING_REVIEW");
  const postedReceipts = po.goods_receipts.filter((receipt) => receipt.status === "POSTED");
  const confirmedReceiptIds = useMemo(
    () => new Set(documents.filter((doc) => doc.document_type === "GOODS_RECEIPT_CONFIRMATION" && doc.status !== "CANCELLED").map((doc) => doc.goods_receipt_id)),
    [documents],
  );
  const itemTitle = (itemId: string) => po.items.find((item) => item.id === itemId)?.title || "-";
  const recMeta = reconciliation ? reconciliationStatusMeta(reconciliation.status) : null;

  const submitDocument = async () => {
    if (form.document_type === "DELIVERY_ACCEPTANCE_MINUTES" && !form.goods_receipt_id) {
      toast.error("Chọn phiếu nhập kho mà biên bản này xác nhận");
      return;
    }
    try {
      setSaving(true);
      const metadata: Record<string, unknown> =
        form.document_type === "PAYMENT_EVIDENCE"
          ? { payment_reference: form.payment_reference, paid_amount: form.paid_amount, paid_date: form.paid_date, note: form.note }
          : form.document_type === "OTHER"
            ? { note: form.note }
            : {
              signed_date: form.signed_date,
              supplier_representative: form.supplier_representative,
              library_representative: form.library_representative,
              confirmed_qty: form.confirmed_qty,
              discrepancy_summary: form.discrepancy_summary,
            };
      await procurementDocumentService.create(po.id, {
        document_type: form.document_type,
        goods_receipt_id: form.goods_receipt_id || undefined,
        external_number: form.external_number || undefined,
        internal_note: form.internal_note || undefined,
        metadata,
        file,
      });
      toast.success(file ? "Đã lưu chứng từ và file" : "Đã tạo chứng từ — chờ tải bản scan");
      setShowForm(false);
      setFile(null);
      setForm((current) => ({ ...current, external_number: "", confirmed_qty: "", discrepancy_summary: "", note: "", internal_note: "" }));
      await load();
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Không lưu được chứng từ"));
    } finally {
      setSaving(false);
    }
  };

  const issueConfirmation = async (grId: string) => {
    try {
      setSaving(true);
      await procurementDocumentService.issueReceiptConfirmation(grId);
      toast.success("Đã phát hành xác nhận kết quả nhận hàng — chia sẻ để nhà cung cấp thấy");
      await load();
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Không phát hành được xác nhận"));
    } finally {
      setSaving(false);
    }
  };

  const completeReconciliation = async () => {
    if (!reconciliation) return;
    const exception = !reconciliation.can_complete_without_exception;
    if (exception && !completeNote.trim()) {
      toast.error("Cần ghi lý do duyệt ngoại lệ");
      return;
    }
    try {
      setSaving(true);
      await procurementDocumentService.completeReconciliation(po.id, { exception_approved: exception, note: completeNote.trim() || undefined });
      toast.success(exception ? "Đã hoàn tất đối soát (duyệt ngoại lệ)" : "Đã hoàn tất đối soát");
      setCompleteOpen(false);
      setCompleteNote("");
      await load();
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Không hoàn tất được đối soát"));
    } finally {
      setSaving(false);
    }
  };

  const submitReview = async () => {
    if (!review || !pendingResponse) return;
    if (review.decision === "REJECT" && !review.note.trim()) {
      toast.error("Cần ghi lý do không chấp nhận thay đổi");
      return;
    }
    try {
      setSaving(true);
      await procurementDocumentService.reviewSupplierResponse(po.id, pendingResponse.id, { decision: review.decision, note: review.note.trim() || undefined });
      toast.success(review.decision === "APPROVE" ? "Đã duyệt thay đổi của nhà cung cấp" : "Đã từ chối thay đổi của nhà cung cấp");
      setReview(null);
      await refreshAll();
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Không xử lý được phản hồi"));
    } finally {
      setSaving(false);
    }
  };

  const field = (key: keyof typeof form, label: string, props: Record<string, unknown> = {}) => (
    <div className="space-y-1.5">
      <Label htmlFor={`pdc-${key}`} className="text-[12px]">{label}</Label>
      <Input id={`pdc-${key}`} value={form[key]} onChange={(event) => setForm((current) => ({ ...current, [key]: event.target.value }))} className="h-9 text-[13px]" {...props} />
    </div>
  );

  return (
    <div id="po-procurement-documents" className="scroll-mt-20 space-y-5">
      {pendingResponse ? (
        <SectionCard title="Phản hồi của nhà cung cấp chờ duyệt" subtitle={`Gửi lúc ${formatDateTime(pendingResponse.created_at)} · ${supplierResponseMeta(pendingResponse.decision)?.label}`}>
          {pendingResponse.reason ? <p className="mb-3 text-[13px]"><span className="text-muted-foreground">Lý do nhà cung cấp: </span>{pendingResponse.reason}</p> : null}
          {pendingResponse.proposed_delivery_date ? <p className="mb-3 text-[13px]"><span className="text-muted-foreground">Đề xuất ngày giao: </span>{formatDay(pendingResponse.proposed_delivery_date)}</p> : null}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-[13px]">
              <thead><tr className="text-left text-[11px] uppercase tracking-wider text-muted-foreground"><th className="py-1.5 pr-3">Sách</th><th className="py-1.5 pr-3 text-right">Số lượng đặt → nhà cung cấp xác nhận</th><th className="py-1.5 text-right">Đơn giá PO → nhà cung cấp</th></tr></thead>
              <tbody>
                {pendingResponse.lines.map((line) => {
                  const qtyChanged = line.confirmed_qty !== line.ordered_qty;
                  const priceChanged = Math.abs(line.confirmed_unit_cost - line.unit_cost) > 0.005;
                  return (
                    <tr key={line.purchase_order_item_id} className="border-t border-border">
                      <td className="py-1.5 pr-3">{itemTitle(line.purchase_order_item_id)}</td>
                      <td className={cn("py-1.5 pr-3 text-right tabular-nums", qtyChanged && "font-semibold text-amber-700 dark:text-amber-400")}>{line.ordered_qty} → {line.confirmed_qty}{qtyChanged ? " (thay đổi)" : ""}</td>
                      <td className={cn("py-1.5 text-right tabular-nums", priceChanged && "font-semibold text-amber-700 dark:text-amber-400")}>{formatMoney(line.unit_cost)} → {formatMoney(line.confirmed_unit_cost)}{priceChanged ? " (thay đổi)" : ""}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-[12px] text-muted-foreground">Đơn gốc chưa bị thay đổi. Duyệt sẽ áp dụng số lượng/giá nhà cung cấp xác nhận (lịch sử được lưu); từ chối giữ nguyên đơn và nhà cung cấp phải phản hồi lại.</p>
          {canApprove ? (
            <div className="mt-3 flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => setReview({ decision: "REJECT", note: "" })} disabled={saving}><XCircle className="h-3.5 w-3.5" />Không chấp nhận</Button>
              <Button size="sm" onClick={() => setReview({ decision: "APPROVE", note: "" })} disabled={saving}><CheckCircle2 className="h-3.5 w-3.5" />Duyệt thay đổi</Button>
            </div>
          ) : <p className="mt-3 text-[12px] text-muted-foreground">Cần quyền duyệt mua hàng để xử lý.</p>}
        </SectionCard>
      ) : null}

      <SectionCard
        title="Bộ chứng từ dùng chung"
        subtitle="Cùng một bản ghi cho nhà cung cấp và kho: hóa đơn, phiếu giao, biên bản, đối soát"
        noPadding
        actions={(
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading} aria-label="Làm mới bộ chứng từ">
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
          </Button>
        )}
      >
        <Tabs defaultValue="documents" className="gap-0">
          <div className="overflow-x-auto px-5 pb-3">
            <TabsList className="w-max">
              <TabsTrigger value="documents" className="px-3 text-[12px]">Chứng từ<span className="rounded-full bg-muted-foreground/10 px-1.5 text-[11px] tabular-nums text-muted-foreground">{documents.length}</span></TabsTrigger>
              <TabsTrigger value="reconciliation" className="px-3 text-[12px]"><Scale className="h-3.5 w-3.5" />Đối soát{recMeta ? <span className="text-[11px] text-muted-foreground">· {recMeta.label}</span> : null}</TabsTrigger>
              <TabsTrigger value="activity" className="px-3 text-[12px]"><History className="h-3.5 w-3.5" />Lịch sử</TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="documents">
            {canManage ? (
              <div className="flex flex-wrap items-center gap-2 border-t border-border px-5 py-3">
                <Button size="sm" variant={showForm ? "secondary" : "default"} onClick={() => setShowForm((value) => !value)} aria-expanded={showForm}>
                  <FilePlus2 className="h-3.5 w-3.5" />{showForm ? "Đóng biểu mẫu" : "Thêm biên bản / chứng từ"}
                </Button>
                {postedReceipts.filter((receipt) => !confirmedReceiptIds.has(receipt.id)).map((receipt) => (
                  <Button key={receipt.id} size="sm" variant="outline" disabled={saving} onClick={() => void issueConfirmation(receipt.id)}>
                    <ShieldCheck className="h-3.5 w-3.5" />Xác nhận nhận hàng {receipt.receipt_number}
                  </Button>
                ))}
              </div>
            ) : null}

            {showForm && canManage ? (
              <form
                className="grid gap-3 border-t border-border bg-muted/20 px-5 py-4 sm:grid-cols-2 lg:grid-cols-3"
                onSubmit={(event) => { event.preventDefault(); void submitDocument(); }}
              >
                <div className="space-y-1.5">
                  <Label htmlFor="pdc-type" className="text-[12px]">Loại chứng từ</Label>
                  <select id="pdc-type" className={selectClass} value={form.document_type} onChange={(event) => setForm((current) => ({ ...current, document_type: event.target.value as ProcurementDocumentType }))}>
                    {SMARTBOOK_TYPES.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}
                  </select>
                </div>
                {["DELIVERY_ACCEPTANCE_MINUTES", "DISCREPANCY_REPORT"].includes(form.document_type) ? (
                  <div className="space-y-1.5">
                    <Label htmlFor="pdc-gr" className="text-[12px]">Phiếu nhập kho{form.document_type === "DELIVERY_ACCEPTANCE_MINUTES" ? " (bắt buộc)" : ""}</Label>
                    <select id="pdc-gr" className={selectClass} value={form.goods_receipt_id} onChange={(event) => setForm((current) => ({ ...current, goods_receipt_id: event.target.value }))}>
                      <option value="">— Chọn phiếu nhập —</option>
                      {po.goods_receipts.map((receipt) => <option key={receipt.id} value={receipt.id}>{receipt.receipt_number} ({receipt.total_quantity} cuốn)</option>)}
                    </select>
                  </div>
                ) : null}
                {field("external_number", "Số chứng từ (in trên giấy)")}
                {form.document_type === "PAYMENT_EVIDENCE" ? (
                  <>
                    {field("payment_reference", "Số tham chiếu thanh toán")}
                    {field("paid_amount", "Số tiền", { inputMode: "decimal" })}
                    {field("paid_date", "Ngày thanh toán", { type: "date" })}
                  </>
                ) : form.document_type === "OTHER" ? null : (
                  <>
                    {field("signed_date", "Ngày ký", { type: "date" })}
                    {field("supplier_representative", "Đại diện nhà cung cấp")}
                    {field("library_representative", "Đại diện thư viện")}
                    {field("confirmed_qty", "Số lượng xác nhận", { inputMode: "numeric" })}
                    <div className="space-y-1.5 sm:col-span-2">
                      <Label htmlFor="pdc-discrepancy" className="text-[12px]">Danh sách chênh lệch</Label>
                      <Textarea id="pdc-discrepancy" rows={2} value={form.discrepancy_summary} onChange={(event) => setForm((current) => ({ ...current, discrepancy_summary: event.target.value }))} placeholder="Ví dụ: thiếu 2 cuốn A, hỏng 3 cuốn A" />
                    </div>
                  </>
                )}
                {form.document_type === "PAYMENT_EVIDENCE" || form.document_type === "OTHER" ? (
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label htmlFor="pdc-note" className="text-[12px]">Ghi chú (nhà cung cấp xem được)</Label>
                    <Textarea id="pdc-note" rows={2} value={form.note} onChange={(event) => setForm((current) => ({ ...current, note: event.target.value }))} />
                  </div>
                ) : null}
                <div className="space-y-1.5 sm:col-span-2 lg:col-span-1">
                  <Label htmlFor="pdc-internal" className="text-[12px]">Ghi chú nội bộ (nhà cung cấp không thấy)</Label>
                  <Input id="pdc-internal" value={form.internal_note} onChange={(event) => setForm((current) => ({ ...current, internal_note: event.target.value }))} className="h-9 text-[13px]" />
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="pdc-file" className="text-[12px]">File scan (PDF, PNG, JPEG — tối đa 10 MB)</Label>
                  <Input id="pdc-file" type="file" accept={ACCEPTED_FILE_TYPES} onChange={(event) => setFile(event.target.files?.[0] || null)} className="h-9 text-[13px]" />
                  <p className="text-[11px] text-muted-foreground">
                    {form.document_type === "DELIVERY_ACCEPTANCE_MINUTES"
                      ? "Biên bản được ký ngoài hệ thống. Không có file thì trạng thái là “Chờ bản ký”; tải file lên chỉ ghi nhận “Đã tải bản scan”, không tự đánh dấu đã ký."
                      : "File được lưu kèm mã SHA-256 và không thể ghi đè; tải lại sẽ tạo phiên bản mới."}
                  </p>
                </div>
                <div className="flex items-end sm:col-span-2 lg:col-span-1">
                  <Button type="submit" size="sm" disabled={saving}>{saving ? "Đang lưu…" : "Lưu chứng từ"}</Button>
                </div>
              </form>
            ) : null}

            <ProcurementDocumentList
              documents={documents}
              viewer="SMARTBOOK"
              canManage={canManage}
              onChanged={load}
              actions={{
                download: procurementDocumentService.download,
                acknowledge: procurementDocumentService.acknowledge,
                uploadVersion: procurementDocumentService.uploadVersion,
                issue: procurementDocumentService.issue,
                cancel: procurementDocumentService.cancel,
                share: procurementDocumentService.share,
              }}
              emptyDescription="Hóa đơn và phiếu giao do nhà cung cấp phát hành, biên bản do kho tải lên sẽ hiện ở đây."
            />
          </TabsContent>

          <TabsContent value="reconciliation" className="border-t border-border">
            {!reconciliation ? (
              <EmptyState variant="no-data" title="Chưa có dữ liệu đối soát" className="py-8" />
            ) : (
              <div className="space-y-4 px-5 py-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[13px] text-muted-foreground">Kết quả đối soát PO ↔ Hóa đơn ↔ Phiếu giao ↔ Phiếu nhập:</span>
                    {recMeta ? <StatusBadge label={recMeta.label} variant={recMeta.tone} dot /> : null}
                  </div>
                  {canManage ? (
                    <Button size="sm" variant={reconciliation.can_complete_without_exception ? "default" : "outline"} disabled={saving || (!reconciliation.can_complete_without_exception && !canApprove)} onClick={() => setCompleteOpen(true)}>
                      <CheckCircle2 className="h-3.5 w-3.5" />{reconciliation.can_complete_without_exception ? "Hoàn tất đối soát" : "Duyệt ngoại lệ & hoàn tất"}
                    </Button>
                  ) : null}
                </div>
                <dl className="grid grid-cols-2 gap-2 text-center sm:grid-cols-4 lg:grid-cols-7">
                  {[
                    ["Đặt", reconciliation.totals.ordered_qty],
                    ["Hóa đơn", reconciliation.totals.invoiced_qty],
                    ["Phiếu giao", reconciliation.totals.delivery_note_qty],
                    ["Thực nhận", reconciliation.totals.delivered_qty],
                    ["Chấp nhận", reconciliation.totals.accepted_qty],
                    ["Hỏng / từ chối", `${reconciliation.totals.damaged_qty} / ${reconciliation.totals.rejected_qty}`],
                    ["Còn phải nhận", reconciliation.totals.remaining_to_receive_qty],
                  ].map(([label, value]) => (
                    <div key={String(label)} className="rounded-lg bg-muted/40 px-2 py-2">
                      <dt className="text-[11px] text-muted-foreground">{label}</dt>
                      <dd className="text-[15px] font-semibold tabular-nums">{value}</dd>
                    </div>
                  ))}
                </dl>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[880px] text-[12px]">
                    <thead>
                      <tr className="bg-muted/30 text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                        <th className="px-2 py-2">Sách</th>
                        <th className="px-2 py-2 text-right">Đặt</th>
                        <th className="px-2 py-2 text-right">Hóa đơn</th>
                        <th className="px-2 py-2 text-right">Phiếu giao</th>
                        <th className="px-2 py-2 text-right">Thực nhận</th>
                        <th className="px-2 py-2 text-right">Chấp nhận</th>
                        <th className="px-2 py-2 text-right">Hỏng</th>
                        <th className="px-2 py-2 text-right">Từ chối</th>
                        <th className="px-2 py-2 text-right">Giá PO / HĐ</th>
                        <th className="px-2 py-2">Kết quả</th>
                      </tr>
                    </thead>
                    <tbody>
                      {reconciliation.lines.map((line) => {
                        const meta = reconciliationStatusMeta(line.status);
                        const notes = line.flags.filter((flag) => flag !== "PENDING_DELIVERY" || line.status !== "MATCHED");
                        return (
                          <tr key={line.purchase_order_item_id} className="border-t border-border align-top">
                            <td className="px-2 py-2"><span className="font-medium">{line.title || "-"}</span><span className="block font-mono text-[11px] text-muted-foreground">{line.isbn13 || ""}</span></td>
                            <td className="px-2 py-2 text-right tabular-nums">{line.ordered_qty}</td>
                            <td className="px-2 py-2 text-right tabular-nums">{line.invoiced_qty}</td>
                            <td className="px-2 py-2 text-right tabular-nums">{line.delivery_note_qty}</td>
                            <td className="px-2 py-2 text-right tabular-nums">{line.delivered_qty}</td>
                            <td className="px-2 py-2 text-right font-semibold tabular-nums">{line.accepted_qty}</td>
                            <td className="px-2 py-2 text-right tabular-nums">{line.damaged_qty}</td>
                            <td className="px-2 py-2 text-right tabular-nums">{line.rejected_qty}</td>
                            <td className="px-2 py-2 text-right tabular-nums">{formatMoney(line.po_unit_cost)}{line.invoice_unit_prices.length ? <span className="block text-muted-foreground">HĐ {line.invoice_unit_prices.map((p) => formatMoney(p)).join(", ")}</span> : null}</td>
                            <td className="px-2 py-2">
                              <StatusBadge label={meta.label} variant={meta.tone} />
                              {notes.length ? <ul className="mt-1 space-y-0.5 text-[11px] text-muted-foreground">{notes.map((flag) => <li key={flag}>• {RECONCILIATION_FLAG_LABEL[flag] || flag}</li>)}</ul> : null}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {reconciliation.invoices.some((row) => row.issues.length) ? (
                  <p className="text-[12px] text-amber-700 dark:text-amber-400">Hóa đơn cần rà soát: {reconciliation.invoices.filter((row) => row.issues.length).map((row) => row.external_number || row.document_number).join(", ")} (tổng tiền không khớp các dòng/thuế).</p>
                ) : null}
                <div>
                  <p className="mb-1.5 text-[12px] font-semibold">Theo từng lần giao</p>
                  {reconciliation.deliveries.length === 0 ? <p className="text-[12px] text-muted-foreground">Chưa có phiếu giao hàng.</p> : (
                    <ul className="divide-y divide-border rounded-lg border border-border text-[12px]">
                      {reconciliation.deliveries.map((delivery) => (
                        <li key={delivery.delivery_id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                          <span className="font-mono">{delivery.document_number}</span>
                          <span className="tabular-nums text-muted-foreground">phiếu {delivery.delivery_note_qty} · nhận {delivery.delivered_qty} · chấp nhận {delivery.accepted_qty} · hỏng {delivery.damaged_qty} · từ chối {delivery.rejected_qty}</span>
                          <span className="text-muted-foreground">{delivery.goods_receipts.map((gr) => gr.receipt_number).join(", ") || "chưa lập phiếu nhập"}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                {reconciliation.history.length ? (
                  <div>
                    <p className="mb-1.5 text-[12px] font-semibold">Các lần hoàn tất đối soát</p>
                    <ul className="space-y-1 text-[12px]">
                      {reconciliation.history.map((row) => (
                        <li key={row.id} className="flex flex-wrap items-center gap-2">
                          <StatusBadge label={reconciliationStatusMeta(row.result_status).label} variant={reconciliationStatusMeta(row.result_status).tone} />
                          {row.exception_approved ? <span className="font-medium text-amber-700 dark:text-amber-400">Duyệt ngoại lệ</span> : null}
                          <span className="text-muted-foreground">{formatDateTime(row.created_at)}</span>
                          {row.note ? <span>— {row.note}</span> : null}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            )}
          </TabsContent>

          <TabsContent value="activity" className="border-t border-border">
            {activity.length === 0 ? (
              <EmptyState variant="no-data" title="Chưa có hoạt động" className="py-8" />
            ) : (
              <ol className="max-h-[480px] space-y-3 overflow-y-auto px-5 py-4">
                {activity.map((entry) => (
                  <li key={entry.id} className="flex gap-3 text-[13px]">
                    <span className={cn("mt-[6px] h-2 w-2 shrink-0 rounded-full", entry.actor_party === "SUPPLIER" ? "bg-sky-500" : "bg-indigo-500")} aria-hidden />
                    <div className="min-w-0">
                      <p className="text-foreground">
                        {ACTIVITY_LABEL[entry.action_name] || entry.action_name}
                        {entry.entity_label ? <span className="font-mono text-[12px] text-muted-foreground"> · {entry.entity_label}</span> : null}
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        {formatDateTime(entry.created_at)} · {entry.actor_party === "SUPPLIER" ? "Nhà cung cấp" : entry.actor_party === "SMARTBOOK" ? "SmartBook" : "Hệ thống/SmartBook"}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </TabsContent>
        </Tabs>
      </SectionCard>

      <ConfirmDialog
        open={completeOpen}
        onOpenChange={(open) => { if (!open) setCompleteOpen(false); }}
        title={reconciliation?.can_complete_without_exception ? "Hoàn tất đối soát" : "Duyệt ngoại lệ đối soát"}
        description={reconciliation?.can_complete_without_exception
          ? "Tất cả dòng đã khớp. Kết quả được lưu kèm ảnh chụp số liệu hiện tại."
          : `Kết quả hiện tại: ${recMeta?.label}. Hoàn tất khi chưa khớp cần lý do và được ghi nhận là ngoại lệ.`}
        confirmLabel="Hoàn tất"
        loading={saving}
        onConfirm={completeReconciliation}
      >
        <label htmlFor="pdc-complete-note" className="mb-1.5 block text-[11px] font-medium text-muted-foreground">{reconciliation?.can_complete_without_exception ? "Ghi chú (tùy chọn)" : "Lý do duyệt ngoại lệ (bắt buộc)"}</label>
        <Textarea id="pdc-complete-note" rows={2} value={completeNote} onChange={(event) => setCompleteNote(event.target.value)} />
      </ConfirmDialog>

      <ConfirmDialog
        open={Boolean(review)}
        onOpenChange={(open) => { if (!open) setReview(null); }}
        title={review?.decision === "APPROVE" ? "Duyệt thay đổi của nhà cung cấp" : "Không chấp nhận thay đổi"}
        description={review?.decision === "APPROVE" ? "Số lượng/giá nhà cung cấp xác nhận sẽ thay cho đơn gốc; giá trị cũ vẫn lưu trong lịch sử." : "Đơn giữ nguyên; nhà cung cấp sẽ thấy lý do và cần phản hồi lại."}
        confirmLabel={review?.decision === "APPROVE" ? "Duyệt" : "Không chấp nhận"}
        variant={review?.decision === "APPROVE" ? "default" : "destructive"}
        loading={saving}
        onConfirm={submitReview}
      >
        <label htmlFor="pdc-review-note" className="mb-1.5 block text-[11px] font-medium text-muted-foreground">{review?.decision === "REJECT" ? "Lý do (bắt buộc)" : "Ghi chú (tùy chọn)"}</label>
        <Textarea id="pdc-review-note" rows={2} value={review?.note || ""} onChange={(event) => setReview((current) => (current ? { ...current, note: event.target.value } : current))} />
      </ConfirmDialog>
    </div>
  );
}
