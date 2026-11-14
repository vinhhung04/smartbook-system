import { useCallback, useEffect, useMemo, useState, type ChangeEvent } from "react";
import { CheckCircle2, FileCheck2, FileText, Send, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { StatusBadge } from "@/components/status-badge";
import { getApiErrorMessage } from "@/services/api";
import { supplierAccountService } from "@/services/supplier-account";
import type { SupplierPortalOrder } from "@/services/supplier-portal";
import { supplierDocumentService, type ProcurementDocument, type ProcurementDocumentType } from "@/services/procurement-documents";
import { ProcurementDocumentList } from "./procurement-document-list";
import { ACCEPTED_FILE_TYPES, formatDateTime, formatMoney, supplierResponseMeta } from "@/lib/procurement-document-status";

const cardClass = "rounded-[8px] border border-slate-200 bg-white p-5";
const selectClass = "h-9 w-full rounded-md border border-input bg-background px-3 text-[13px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

function today() {
  return new Date().toISOString().slice(0, 10);
}

/** Supplier answers a sent PO: accept all, accept part (changes need SmartBook approval), or reject. */
export function SupplierOrderResponsePanel({ order, onChanged }: { order: SupplierPortalOrder; onChanged: () => Promise<void> }) {
  const po = order.purchase_order;
  const [mode, setMode] = useState<"NONE" | "PARTIAL" | "REJECT">("NONE");
  const [reason, setReason] = useState("");
  const [proposedDate, setProposedDate] = useState("");
  const [lines, setLines] = useState<Record<string, { qty: number; price: number }>>({});
  const [busy, setBusy] = useState(false);
  const latest = order.supplier_responses?.[0];
  const pending = order.supplier_responses?.find((row) => row.review_status === "PENDING_REVIEW");

  useEffect(() => {
    setLines(Object.fromEntries(po.items.map((item) => [item.id, { qty: item.ordered_qty, price: item.unit_cost }])));
    setMode("NONE");
    setReason("");
  }, [po.id, po.items]);

  if (po.status !== "SENT_TO_SUPPLIER") return null;

  const send = async (decision: "ACCEPTED" | "PARTIALLY_ACCEPTED" | "REJECTED") => {
    if (decision !== "ACCEPTED" && !reason.trim()) {
      toast.error(decision === "REJECTED" ? "Cần ghi rõ lý do từ chối" : "Cần ghi lý do thay đổi");
      return;
    }
    try {
      setBusy(true);
      const result = await supplierAccountService.respond(po.id, {
        decision,
        reason: reason.trim() || undefined,
        proposed_delivery_date: proposedDate || undefined,
        lines: decision === "REJECTED" ? undefined : po.items.map((item) => ({
          purchase_order_item_id: item.id,
          confirmed_qty: decision === "ACCEPTED" ? item.ordered_qty : lines[item.id]?.qty ?? item.ordered_qty,
          confirmed_unit_cost: decision === "ACCEPTED" ? item.unit_cost : lines[item.id]?.price ?? item.unit_cost,
        })),
      });
      const reviewStatus = result?.data?.review_status;
      toast.success(decision === "REJECTED" ? "Đã gửi từ chối đơn hàng" : reviewStatus === "PENDING_REVIEW" ? "Đã gửi đề xuất — chờ SmartBook duyệt" : "Đã xác nhận đơn hàng");
      await onChanged();
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Gửi phản hồi thất bại"));
    } finally {
      setBusy(false);
    }
  };

  const changed = po.items.some((item) => (lines[item.id]?.qty ?? item.ordered_qty) !== item.ordered_qty || Math.abs((lines[item.id]?.price ?? item.unit_cost) - item.unit_cost) > 0.005);
  const partialDecision = po.items.some((item) => (lines[item.id]?.qty ?? item.ordered_qty) < item.ordered_qty) ? "PARTIALLY_ACCEPTED" : "ACCEPTED";

  return (
    <div className={cardClass}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-[16px] font-semibold">Phản hồi đơn đặt hàng</h3>
        {latest ? (
          <StatusBadge label={supplierResponseMeta(latest.review_status === "PENDING_REVIEW" ? "PENDING_REVIEW" : po.supplier_response_status || latest.decision)?.label || latest.decision} variant={supplierResponseMeta(latest.review_status === "PENDING_REVIEW" ? "PENDING_REVIEW" : po.supplier_response_status || latest.decision)?.tone} dot />
        ) : null}
      </div>
      {pending ? (
        <p className="mt-2 text-[13px] text-amber-800">Đề xuất gửi lúc {formatDateTime(pending.created_at)} đang chờ SmartBook duyệt. Bạn có thể gửi phản hồi mới để thay thế.</p>
      ) : po.supplier_response_status === "CHANGES_REJECTED" && latest?.review_note ? (
        <p className="mt-2 text-[13px] text-rose-700">SmartBook không chấp nhận thay đổi: {latest.review_note}</p>
      ) : (
        <p className="mt-2 text-[13px] text-slate-500">Xác nhận số lượng, giá và ngày giao. Thay đổi so với đơn gốc cần SmartBook duyệt trước khi giao hàng.</p>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        <Button onClick={() => void send("ACCEPTED")} disabled={busy}><CheckCircle2 className="mr-2 h-4 w-4" />Chấp nhận toàn bộ</Button>
        <Button variant="outline" onClick={() => setMode(mode === "PARTIAL" ? "NONE" : "PARTIAL")} aria-expanded={mode === "PARTIAL"}>Chấp nhận một phần / đổi giá</Button>
        <Button variant="outline" className="text-rose-700" onClick={() => setMode(mode === "REJECT" ? "NONE" : "REJECT")} aria-expanded={mode === "REJECT"}><XCircle className="mr-2 h-4 w-4" />Từ chối đơn</Button>
      </div>

      {mode === "PARTIAL" ? (
        <div className="mt-4 space-y-3">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[600px] text-[13px]">
              <thead className="bg-slate-50 text-left text-[11px] uppercase text-slate-500">
                <tr><th className="px-3 py-2">Sách</th><th className="px-3 py-2 text-right">Số lượng đặt</th><th className="px-3 py-2">Số lượng có thể giao</th><th className="px-3 py-2 text-right">Giá đặt</th><th className="px-3 py-2">Giá bán xác nhận</th></tr>
              </thead>
              <tbody>
                {po.items.map((item) => (
                  <tr key={item.id} className="border-b border-slate-100">
                    <td className="px-3 py-2 font-medium">{item.title || item.variant_id}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{item.ordered_qty}</td>
                    <td className="px-3 py-2">
                      <Input type="number" min={0} max={item.ordered_qty} aria-label={`Số lượng có thể giao — ${item.title || item.variant_id}`} className="h-8 w-24" value={lines[item.id]?.qty ?? item.ordered_qty}
                        onChange={(event) => setLines((current) => ({ ...current, [item.id]: { qty: Math.max(0, Math.min(item.ordered_qty, Math.floor(Number(event.target.value) || 0))), price: current[item.id]?.price ?? item.unit_cost } }))} />
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatMoney(item.unit_cost)}</td>
                    <td className="px-3 py-2">
                      <Input type="number" min={0} aria-label={`Giá bán xác nhận — ${item.title || item.variant_id}`} className="h-8 w-32" value={lines[item.id]?.price ?? item.unit_cost}
                        onChange={(event) => setLines((current) => ({ ...current, [item.id]: { qty: current[item.id]?.qty ?? item.ordered_qty, price: Math.max(0, Number(event.target.value) || 0) } }))} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="resp-date" className="text-[12px]">Ngày giao đề xuất</Label>
              <Input id="resp-date" type="date" value={proposedDate} onChange={(event) => setProposedDate(event.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="resp-reason" className="text-[12px]">Lý do thay đổi (bắt buộc)</Label>
              <Input id="resp-reason" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Ví dụ: chỉ còn 80 cuốn trong kho" />
            </div>
          </div>
          <Button onClick={() => void send(partialDecision)} disabled={busy || !changed}><Send className="mr-2 h-4 w-4" />Gửi đề xuất cho SmartBook duyệt</Button>
          {!changed ? <p className="text-[12px] text-slate-500">Chưa có thay đổi nào so với đơn gốc.</p> : null}
        </div>
      ) : null}

      {mode === "REJECT" ? (
        <div className="mt-4 space-y-2">
          <Label htmlFor="resp-reject" className="text-[12px]">Lý do từ chối (bắt buộc)</Label>
          <Textarea id="resp-reject" rows={2} value={reason} onChange={(event) => setReason(event.target.value)} />
          <Button variant="destructive" onClick={() => void send("REJECTED")} disabled={busy}>Gửi từ chối</Button>
        </div>
      ) : null}
    </div>
  );
}

const INVOICE_TYPES: { value: ProcurementDocumentType; label: string; hint: string }[] = [
  { value: "VAT_INVOICE", label: "Hóa đơn giá trị gia tăng điện tử", hint: "Bắt buộc ký hiệu, số, ngày lập và file PDF/XML của hóa đơn." },
  { value: "SALES_INVOICE", label: "Hóa đơn bán hàng", hint: "Hóa đơn bán hàng (không phải hóa đơn giá trị gia tăng)." },
  { value: "PROFORMA_INVOICE", label: "Hóa đơn chiếu lệ / báo giá", hint: "Chỉ để tham khảo trước khi phát hành hóa đơn chính thức; không tính vào đối soát." },
];

/** Supplier issues its own invoice (the single shared record SmartBook will also see). */
function SupplierInvoiceForm({ order, documents, onSaved }: { order: SupplierPortalOrder; documents: ProcurementDocument[]; onSaved: () => Promise<void> }) {
  const po = order.purchase_order;
  const [form, setForm] = useState({ document_type: "VAT_INVOICE" as ProcurementDocumentType, invoice_series: "", external_number: "", issue_date: today(), tax_rate: "5", lookup_code: "", seller_tax_code: "", buyer_tax_code: "", payment_due_date: "", note: "", supersedes_document_id: "" });
  const [qty, setQty] = useState<Record<string, number>>({});
  const [price, setPrice] = useState<Record<string, number>>({});
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const replaceable = documents.filter((doc) => ["VAT_INVOICE", "SALES_INVOICE", "PROFORMA_INVOICE"].includes(doc.document_type) && doc.status === "ISSUED");

  useEffect(() => {
    setQty(Object.fromEntries(po.items.map((item) => [item.id, item.ordered_qty])));
    setPrice(Object.fromEntries(po.items.map((item) => [item.id, item.unit_cost])));
  }, [po.id, po.items]);

  const subtotal = useMemo(() => po.items.reduce((sum, item) => sum + (qty[item.id] || 0) * (price[item.id] || 0), 0), [po.items, qty, price]);
  const tax = Math.round(subtotal * (Number(form.tax_rate) || 0)) / 100;
  const set = (key: keyof typeof form) => (event: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setForm((current) => ({ ...current, [key]: event.target.value }));

  const submit = async (issue: boolean) => {
    if (!form.external_number.trim()) return toast.error("Nhập số hóa đơn");
    if (form.document_type === "VAT_INVOICE" && !form.invoice_series.trim()) return toast.error("Hóa đơn giá trị gia tăng cần ký hiệu hóa đơn");
    if (issue && !file) return toast.error("Đính kèm file hóa đơn (PDF/XML) trước khi phát hành");
    const lines = po.items.filter((item) => (qty[item.id] || 0) > 0).map((item) => ({ purchase_order_item_id: item.id, quantity: qty[item.id], unit_price: price[item.id] || 0 }));
    if (lines.length === 0) return toast.error("Hóa đơn cần ít nhất một dòng");
    try {
      setBusy(true);
      await supplierDocumentService.create(po.id, {
        document_type: form.document_type,
        invoice_series: form.invoice_series.trim() || undefined,
        external_number: form.external_number.trim(),
        issue_date: form.issue_date,
        tax_rate: form.tax_rate,
        supersedes_document_id: form.supersedes_document_id || undefined,
        lines,
        metadata: { lookup_code: form.lookup_code, seller_tax_code: form.seller_tax_code, buyer_tax_code: form.buyer_tax_code, payment_due_date: form.payment_due_date, note: form.note },
        issue,
        file,
      });
      toast.success(issue ? "Đã phát hành hóa đơn — SmartBook xem được cùng bản ghi này" : "Đã lưu nháp hóa đơn (SmartBook chưa thấy)");
      setForm((current) => ({ ...current, external_number: "", supersedes_document_id: "" }));
      setFile(null);
      await onSaved();
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Không lưu được hóa đơn"));
    } finally {
      setBusy(false);
    }
  };

  const field = (key: keyof typeof form, label: string, props: Record<string, unknown> = {}) => (
    <div className="space-y-1.5">
      <Label htmlFor={`inv-${key}`} className="text-[12px]">{label}</Label>
      <Input id={`inv-${key}`} value={form[key]} onChange={set(key)} className="h-9 text-[13px]" {...props} />
    </div>
  );

  return (
    <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); void submit(true); }}>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-1.5">
          <Label htmlFor="inv-type" className="text-[12px]">Loại chứng từ</Label>
          <select id="inv-type" className={selectClass} value={form.document_type} onChange={set("document_type")}>
            {INVOICE_TYPES.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}
          </select>
        </div>
        {field("invoice_series", "Ký hiệu hóa đơn", { placeholder: "1C26TAA" })}
        {field("external_number", "Số hóa đơn")}
        {field("issue_date", "Ngày lập", { type: "date" })}
        {field("tax_rate", "Thuế suất (%)", { inputMode: "decimal" })}
        {field("lookup_code", "Mã tra cứu hóa đơn điện tử")}
        {field("seller_tax_code", "Mã số thuế bên bán")}
        {field("buyer_tax_code", "Mã số thuế bên mua")}
        {field("payment_due_date", "Hạn thanh toán", { type: "date" })}
        {replaceable.length ? (
          <div className="space-y-1.5">
            <Label htmlFor="inv-supersedes" className="text-[12px]">Thay thế hóa đơn (nếu sai)</Label>
            <select id="inv-supersedes" className={selectClass} value={form.supersedes_document_id} onChange={set("supersedes_document_id")}>
              <option value="">— Không —</option>
              {replaceable.map((doc) => <option key={doc.id} value={doc.id}>{doc.invoice_series ? `${doc.invoice_series}/` : ""}{doc.external_number}</option>)}
            </select>
          </div>
        ) : null}
      </div>
      <p className="text-[12px] text-slate-500">{INVOICE_TYPES.find((type) => type.value === form.document_type)?.hint}</p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[620px] text-[13px]">
          <thead className="bg-slate-50 text-left text-[11px] uppercase text-slate-500">
            <tr><th className="px-3 py-2">Sách</th><th className="px-3 py-2 text-right">Số lượng đặt</th><th className="px-3 py-2">Số lượng trên hóa đơn</th><th className="px-3 py-2">Đơn giá</th><th className="px-3 py-2 text-right">Thành tiền</th></tr>
          </thead>
          <tbody>
            {po.items.map((item) => (
              <tr key={item.id} className="border-b border-slate-100">
                <td className="px-3 py-2 font-medium">{item.title || item.variant_id}</td>
                <td className="px-3 py-2 text-right tabular-nums">{item.ordered_qty}</td>
                <td className="px-3 py-2"><Input type="number" min={0} aria-label={`Số lượng hóa đơn — ${item.title || item.variant_id}`} className="h-8 w-24" value={qty[item.id] ?? 0} onChange={(event) => setQty((current) => ({ ...current, [item.id]: Math.max(0, Math.floor(Number(event.target.value) || 0)) }))} /></td>
                <td className="px-3 py-2"><Input type="number" min={0} aria-label={`Đơn giá hóa đơn — ${item.title || item.variant_id}`} className="h-8 w-32" value={price[item.id] ?? 0} onChange={(event) => setPrice((current) => ({ ...current, [item.id]: Math.max(0, Number(event.target.value) || 0) }))} /></td>
                <td className="px-3 py-2 text-right tabular-nums">{formatMoney((qty[item.id] || 0) * (price[item.id] || 0))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-right text-[13px] tabular-nums">Tiền hàng {formatMoney(subtotal)} · Thuế {formatMoney(tax)} · <span className="font-semibold">Tổng {formatMoney(subtotal + tax)}</span></p>
      <div className="space-y-1.5">
        <Label htmlFor="inv-file" className="text-[12px]">File hóa đơn (PDF hoặc XML hóa đơn điện tử, tối đa 10 MB)</Label>
        <Input id="inv-file" type="file" accept={ACCEPTED_FILE_TYPES} onChange={(event) => setFile(event.target.files?.[0] || null)} />
        <p className="text-[11px] text-slate-500">Sau khi phát hành, file gốc không thể sửa hay thay. Nếu sai, hãy hủy (có lý do) hoặc lập hóa đơn thay thế.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={busy}><FileCheck2 className="mr-2 h-4 w-4" />Phát hành hóa đơn</Button>
        <Button type="button" variant="outline" disabled={busy} onClick={() => void submit(false)}>Lưu nháp</Button>
      </div>
    </form>
  );
}

/** Supplier side of the shared document set for one PO. */
export function SupplierOrderDocuments({ order }: { order: SupplierPortalOrder }) {
  const po = order.purchase_order;
  const [documents, setDocuments] = useState<ProcurementDocument[]>([]);
  const [showInvoice, setShowInvoice] = useState(false);

  const load = useCallback(
    () => supplierDocumentService.list(po.id)
      .then(setDocuments)
      .catch((error) => { toast.error(getApiErrorMessage(error, "Không tải được chứng từ")); }),
    [po.id],
  );

  useEffect(() => {
    let active = true;
    supplierDocumentService.list(po.id)
      .then((rows) => { if (active) setDocuments(rows); })
      .catch((error) => { if (active) toast.error(getApiErrorMessage(error, "Không tải được chứng từ")); });
    return () => { active = false; };
  }, [po.id]);

  const canInvoice = !["SENT_TO_SUPPLIER", "CANCELLED"].includes(po.status);
  const unacknowledged = documents.filter((doc) => doc.issuer_party === "SMARTBOOK" && ["SENT", "DELIVERED"].includes(doc.sharing.status)).length;

  return (
    <div className={cardClass + " p-0"}>
      <div className="flex flex-wrap items-start justify-between gap-3 p-5 pb-3">
        <div>
          <div className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-sky-700" aria-hidden />
            <h3 className="text-[16px] font-semibold">Chứng từ dùng chung với SmartBook</h3>
          </div>
          <p className="mt-1 text-[13px] text-slate-500">
            Hóa đơn, phiếu giao bạn phát hành và biên bản, xác nhận nhận hàng SmartBook chia sẻ. Hai bên xem cùng một bản ghi.
            {unacknowledged ? <span className="font-medium text-amber-700"> {unacknowledged} chứng từ chờ bạn xác nhận đã nhận.</span> : null}
          </p>
        </div>
        {canInvoice ? (
          <Button variant={showInvoice ? "secondary" : "default"} onClick={() => setShowInvoice((value) => !value)} aria-expanded={showInvoice}>
            {showInvoice ? "Đóng" : "Phát hành hóa đơn"}
          </Button>
        ) : <p className="text-[12px] text-slate-500">Xác nhận đơn trước khi phát hành hóa đơn.</p>}
      </div>
      {showInvoice ? (
        <div className="border-t border-slate-200 bg-slate-50/60 p-5">
          <SupplierInvoiceForm order={order} documents={documents} onSaved={async () => { setShowInvoice(false); await load(); }} />
        </div>
      ) : null}
      <ProcurementDocumentList
        documents={documents}
        viewer="SUPPLIER"
        onChanged={load}
        actions={{
          download: supplierDocumentService.download,
          acknowledge: supplierDocumentService.acknowledge,
          uploadVersion: supplierDocumentService.uploadVersion,
          issue: supplierDocumentService.issue,
          cancel: supplierDocumentService.cancel,
        }}
        emptyDescription="Phát hành hóa đơn hoặc lập phiếu giao để bắt đầu. Biên bản do SmartBook chia sẻ cũng hiện ở đây."
      />
    </div>
  );
}
