import { useCallback, useEffect, useMemo, useState, type ChangeEvent } from "react";
import { CheckCircle2, FileCheck2, FileText, PackageCheck, Pencil, Send, XCircle } from "lucide-react";
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
import { InvoiceFulfillmentPanel } from "./invoice-fulfillment-panel";
import { invoiceFirstStage, type FlowTab } from "@/lib/invoice-first-stage";
import { ACCEPTED_FILE_TYPES, formatDateTime, formatMoney, supplierResponseMeta } from "@/lib/procurement-document-status";

const cardClass = "rounded-[8px] border border-slate-200 bg-white p-5";
const selectClass = "h-9 w-full rounded-md border border-input bg-background px-3 text-[13px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const INVOICE_DOC_TYPES = ["VAT_INVOICE", "SALES_INVOICE", "PROFORMA_INVOICE"];
// invoice-first: the supplier invoices only after SmartBook approved its qty/price proposal
const INVOICEABLE_STATUSES = ["SUPPLIER_CONFIRMED", "PARTIALLY_RECEIVED", "SHORTAGE_REPORTED"];

function today() {
  return new Date().toISOString().slice(0, 10);
}

function isInvoiceFirst(order: SupplierPortalOrder) {
  return order.purchase_order.procurement_flow === "INVOICE_FIRST";
}

/**
 * Supplier answers a sent PO: accept all, accept part, or reject.
 * Invoice-first POs carry no price, so both accept options quote a unit price per book and
 * always wait for SmartBook's approval; legacy POs keep the one-click full acceptance.
 */
export function SupplierOrderResponsePanel({ order, onChanged }: { order: SupplierPortalOrder; onChanged: () => Promise<void> }) {
  const po = order.purchase_order;
  const invoiceFirst = isInvoiceFirst(order);
  const [mode, setMode] = useState<"NONE" | "ALL" | "PARTIAL" | "REJECT">("NONE");
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

  const qtyOf = (itemId: string, ordered: number) => (mode === "ALL" ? ordered : lines[itemId]?.qty ?? ordered);

  const send = async (decision: "ACCEPTED" | "PARTIALLY_ACCEPTED" | "REJECTED") => {
    if (decision !== "ACCEPTED" && !reason.trim()) {
      toast.error(decision === "REJECTED" ? "Cần ghi rõ lý do từ chối" : "Cần ghi lý do chỉ chấp nhận một phần");
      return;
    }
    if (invoiceFirst && decision !== "REJECTED") {
      const missing = po.items.find((item) => qtyOf(item.id, item.ordered_qty) > 0 && !((lines[item.id]?.price ?? 0) > 0));
      if (missing) {
        toast.error(`Nhập đơn giá (lớn hơn 0) cho "${missing.title || "sách"}"`);
        return;
      }
    }
    try {
      setBusy(true);
      const result = await supplierAccountService.respond(po.id, {
        decision,
        reason: reason.trim() || undefined,
        proposed_delivery_date: proposedDate || undefined,
        lines: decision === "REJECTED" ? undefined : po.items.map((item) => ({
          purchase_order_item_id: item.id,
          confirmed_qty: qtyOf(item.id, item.ordered_qty),
          confirmed_unit_cost: !invoiceFirst && decision === "ACCEPTED" ? item.unit_cost : lines[item.id]?.price ?? item.unit_cost,
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
  const showTable = mode === "PARTIAL" || (mode === "ALL" && invoiceFirst);

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
        <p className="mt-2 text-[13px] text-rose-700">SmartBook không chấp nhận đề xuất: {latest.review_note}. Hãy gửi đề xuất mới hoặc từ chối đơn.</p>
      ) : (
        <p className="mt-2 text-[13px] text-slate-500">
          {invoiceFirst
            ? "Nhập đơn giá cho từng sách bạn cung cấp được. SmartBook duyệt số lượng và đơn giá trước khi bạn lập hóa đơn."
            : "Xác nhận số lượng, giá và ngày giao. Thay đổi so với đơn gốc cần SmartBook duyệt trước khi giao hàng."}
        </p>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        <Button onClick={() => (invoiceFirst ? setMode(mode === "ALL" ? "NONE" : "ALL") : void send("ACCEPTED"))} disabled={busy} aria-expanded={invoiceFirst ? mode === "ALL" : undefined}>
          <CheckCircle2 className="mr-2 h-4 w-4" />Chấp nhận tất cả
        </Button>
        <Button variant="outline" onClick={() => setMode(mode === "PARTIAL" ? "NONE" : "PARTIAL")} aria-expanded={mode === "PARTIAL"}>Chấp nhận một phần</Button>
        <Button variant="outline" className="text-rose-700" onClick={() => setMode(mode === "REJECT" ? "NONE" : "REJECT")} aria-expanded={mode === "REJECT"}><XCircle className="mr-2 h-4 w-4" />Từ chối</Button>
      </div>

      {showTable ? (
        <div className="mt-4 space-y-3">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-[13px]">
              <thead className="bg-slate-50 text-left text-[11px] uppercase text-slate-500">
                <tr>
                  <th className="px-3 py-2">Sách</th>
                  <th className="px-3 py-2 text-right">SmartBook yêu cầu</th>
                  <th className="px-3 py-2">Số lượng chấp nhận</th>
                  {invoiceFirst ? null : <th className="px-3 py-2 text-right">Giá đặt</th>}
                  <th className="px-3 py-2">{invoiceFirst ? "Đơn giá đề xuất (₫)" : "Giá bán xác nhận"}</th>
                </tr>
              </thead>
              <tbody>
                {po.items.map((item) => {
                  const name = item.title || item.item_code || "sách";
                  const qty = qtyOf(item.id, item.ordered_qty);
                  return (
                    <tr key={item.id} className="border-b border-slate-100">
                      <td className="px-3 py-2">
                        <span className="block font-medium">{name}</span>
                        <span className="block text-[11px] text-slate-500">{[item.item_code, item.item_author, item.item_publish_year].filter(Boolean).join(" · ")}</span>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{item.ordered_qty}</td>
                      <td className="px-3 py-2">
                        {mode === "ALL" ? (
                          <span className="tabular-nums">{item.ordered_qty}</span>
                        ) : (
                          <>
                            <Input type="number" min={0} max={item.ordered_qty} aria-label={`Số lượng chấp nhận — ${name}`} className="h-8 w-24" value={lines[item.id]?.qty ?? item.ordered_qty}
                              onChange={(event) => setLines((current) => ({ ...current, [item.id]: { qty: Math.max(0, Math.min(item.ordered_qty, Math.floor(Number(event.target.value) || 0))), price: current[item.id]?.price ?? item.unit_cost } }))} />
                            {qty < item.ordered_qty ? <span className="mt-0.5 block text-[11px] text-amber-700">Không chấp nhận {item.ordered_qty - qty}</span> : null}
                          </>
                        )}
                      </td>
                      {invoiceFirst ? null : <td className="px-3 py-2 text-right tabular-nums">{formatMoney(item.unit_cost)}</td>}
                      <td className="px-3 py-2">
                        <Input type="number" min={0} disabled={qty === 0} aria-label={`Đơn giá — ${name}`} className="h-8 w-32" value={lines[item.id]?.price || ""}
                          onChange={(event) => setLines((current) => ({ ...current, [item.id]: { qty: current[item.id]?.qty ?? item.ordered_qty, price: Math.max(0, Number(event.target.value) || 0) } }))} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="resp-date" className="text-[12px]">Ngày giao đề xuất</Label>
              <Input id="resp-date" type="date" value={proposedDate} onChange={(event) => setProposedDate(event.target.value)} />
            </div>
            {mode === "PARTIAL" ? (
              <div className="space-y-1.5">
                <Label htmlFor="resp-reason" className="text-[12px]">Lý do chỉ chấp nhận một phần (bắt buộc)</Label>
                <Input id="resp-reason" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Ví dụ: chỉ còn 7 cuốn trong kho" />
              </div>
            ) : null}
          </div>
          <Button
            onClick={() => void send(mode === "ALL" ? "ACCEPTED" : partialDecision)}
            disabled={busy || (!invoiceFirst && !changed)}
          >
            <Send className="mr-2 h-4 w-4" />Gửi đề xuất cho SmartBook duyệt
          </Button>
          {!invoiceFirst && !changed ? <p className="text-[12px] text-slate-500">Chưa có thay đổi nào so với đơn gốc.</p> : null}
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
function SupplierInvoiceForm({ order, documents, editing, onSaved }: { order: SupplierPortalOrder; documents: ProcurementDocument[]; editing?: ProcurementDocument | null; onSaved: () => Promise<void> }) {
  const po = order.purchase_order;
  const invoiceFirst = isInvoiceFirst(order);
  const [form, setForm] = useState({
    document_type: (editing?.document_type || (invoiceFirst ? "SALES_INVOICE" : "VAT_INVOICE")) as ProcurementDocumentType,
    invoice_series: editing?.invoice_series || "",
    external_number: editing?.external_number || "",
    issue_date: editing?.issue_date ? String(editing.issue_date).slice(0, 10) : today(),
    tax_rate: editing?.tax_rate != null ? String(editing.tax_rate) : invoiceFirst ? "0" : "5",
    lookup_code: "", seller_tax_code: "", buyer_tax_code: "", payment_due_date: "",
    note: (editing?.metadata?.note as string) || "",
    supersedes_document_id: "",
  });
  const [qty, setQty] = useState<Record<string, number>>({});
  const [price, setPrice] = useState<Record<string, number>>({});
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const replaceable = documents.filter((doc) => INVOICE_DOC_TYPES.includes(doc.document_type) && doc.status === "ISSUED");

  // invoice-first: how much of each accepted line other live invoices already hold
  const usedByItem = useMemo(() => {
    const used: Record<string, number> = {};
    for (const doc of documents) {
      if (!INVOICE_DOC_TYPES.includes(doc.document_type) || doc.status === "CANCELLED" || doc.status === "SUPERSEDED") continue;
      if (doc.approval_status === "REJECTED" || doc.id === editing?.id) continue;
      for (const line of doc.lines) if (line.purchase_order_item_id) used[line.purchase_order_item_id] = (used[line.purchase_order_item_id] || 0) + line.quantity;
    }
    return used;
  }, [documents, editing?.id]);
  const availableOf = useCallback((itemId: string, accepted: number) => Math.max(0, accepted - (usedByItem[itemId] || 0)), [usedByItem]);

  useEffect(() => {
    if (editing) {
      setQty(Object.fromEntries(editing.lines.map((line) => [line.purchase_order_item_id || "", line.quantity])));
    } else {
      setQty(Object.fromEntries(po.items.map((item) => [item.id, invoiceFirst ? availableOf(item.id, item.ordered_qty) : item.ordered_qty])));
    }
    setPrice(Object.fromEntries(po.items.map((item) => [item.id, item.unit_cost])));
  }, [po.id, po.items, invoiceFirst, editing, availableOf]);

  const subtotal = useMemo(() => po.items.reduce((sum, item) => sum + (qty[item.id] || 0) * (price[item.id] || 0), 0), [po.items, qty, price]);
  const tax = Math.round(subtotal * (Number(form.tax_rate) || 0)) / 100;
  const set = (key: keyof typeof form) => (event: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setForm((current) => ({ ...current, [key]: event.target.value }));
  const types = invoiceFirst ? INVOICE_TYPES.filter((type) => type.value !== "PROFORMA_INVOICE") : INVOICE_TYPES;

  const submit = async (issue: boolean) => {
    if (!form.external_number.trim()) return toast.error("Nhập số hóa đơn");
    if (!form.issue_date) return toast.error("Nhập ngày lập hóa đơn");
    if (form.document_type === "VAT_INVOICE" && !form.invoice_series.trim()) return toast.error("Hóa đơn giá trị gia tăng cần ký hiệu hóa đơn");
    if (issue && !file && !invoiceFirst && !editing) return toast.error("Đính kèm file hóa đơn (PDF/XML) trước khi phát hành");
    const lines = po.items.filter((item) => (qty[item.id] || 0) > 0).map((item) => ({ purchase_order_item_id: item.id, quantity: qty[item.id], unit_price: price[item.id] || 0 }));
    if (lines.length === 0) return toast.error("Hóa đơn cần ít nhất một dòng");
    if (invoiceFirst) {
      const over = po.items.find((item) => (qty[item.id] || 0) > availableOf(item.id, item.ordered_qty));
      if (over) return toast.error(`"${over.title || "sách"}" vượt số lượng đã được chấp nhận (còn ${availableOf(over.id, over.ordered_qty)})`);
    }
    try {
      setBusy(true);
      if (editing) {
        await supplierDocumentService.updateDraft(editing.id, {
          external_number: form.external_number.trim(),
          invoice_series: form.invoice_series.trim() || undefined,
          issue_date: form.issue_date,
          tax_rate: form.tax_rate,
          metadata: { note: form.note },
          lines: lines.map(({ purchase_order_item_id, quantity }) => ({ purchase_order_item_id, quantity })),
        });
        if (issue) await supplierDocumentService.issue(editing.id);
      } else {
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
      }
      toast.success(issue
        ? (invoiceFirst ? "Đã gửi hóa đơn — chờ SmartBook duyệt" : "Đã phát hành hóa đơn — SmartBook xem được cùng bản ghi này")
        : "Đã lưu nháp hóa đơn (SmartBook chưa thấy)");
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
      {invoiceFirst ? (
        <p className="text-[13px] text-slate-600">
          Bên mua: <span className="font-medium">SmartBook</span> · Bên bán: <span className="font-medium">{po.supplier?.name || "nhà cung cấp"}</span> · Đơn {po.po_number}.
          Đơn giá lấy theo giá SmartBook đã duyệt; số lượng không vượt số đã được chấp nhận.
        </p>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-1.5">
          <Label htmlFor="inv-type" className="text-[12px]">Loại chứng từ</Label>
          <select id="inv-type" className={selectClass} value={form.document_type} onChange={set("document_type")} disabled={Boolean(editing)}>
            {types.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}
          </select>
        </div>
        {field("invoice_series", "Ký hiệu hóa đơn", { placeholder: "1C26TAA" })}
        {field("external_number", "Số hóa đơn")}
        {field("issue_date", "Ngày lập", { type: "date" })}
        {field("tax_rate", "Thuế suất (%)", { inputMode: "decimal" })}
        {invoiceFirst ? null : (
          <>
            {field("lookup_code", "Mã tra cứu hóa đơn điện tử")}
            {field("seller_tax_code", "Mã số thuế bên bán")}
            {field("buyer_tax_code", "Mã số thuế bên mua")}
            {field("payment_due_date", "Hạn thanh toán", { type: "date" })}
          </>
        )}
        {!invoiceFirst && replaceable.length ? (
          <div className="space-y-1.5">
            <Label htmlFor="inv-supersedes" className="text-[12px]">Thay thế hóa đơn (nếu sai)</Label>
            <select id="inv-supersedes" className={selectClass} value={form.supersedes_document_id} onChange={set("supersedes_document_id")}>
              <option value="">— Không —</option>
              {replaceable.map((doc) => <option key={doc.id} value={doc.id}>{doc.invoice_series ? `${doc.invoice_series}/` : ""}{doc.external_number}</option>)}
            </select>
          </div>
        ) : null}
      </div>
      <p className="text-[12px] text-slate-500">{types.find((type) => type.value === form.document_type)?.hint}</p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[620px] text-[13px]">
          <thead className="bg-slate-50 text-left text-[11px] uppercase text-slate-500">
            <tr>
              <th className="px-3 py-2">Sách</th>
              <th className="px-3 py-2 text-right">{invoiceFirst ? "Còn được lập" : "Số lượng đặt"}</th>
              <th className="px-3 py-2">Số lượng trên hóa đơn</th>
              <th className="px-3 py-2">Đơn giá</th>
              <th className="px-3 py-2 text-right">Thành tiền</th>
            </tr>
          </thead>
          <tbody>
            {po.items.map((item) => (
              <tr key={item.id} className="border-b border-slate-100">
                <td className="px-3 py-2">
                  <span className="block font-medium">{item.title || item.variant_id}</span>
                  {item.item_code ? <span className="block font-mono text-[11px] text-slate-500">{item.item_code}</span> : null}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{invoiceFirst ? availableOf(item.id, item.ordered_qty) : item.ordered_qty}</td>
                <td className="px-3 py-2"><Input type="number" min={0} max={invoiceFirst ? availableOf(item.id, item.ordered_qty) : undefined} aria-label={`Số lượng hóa đơn — ${item.title || item.variant_id}`} className="h-8 w-24" value={qty[item.id] ?? 0} onChange={(event) => setQty((current) => ({ ...current, [item.id]: Math.max(0, Math.floor(Number(event.target.value) || 0)) }))} /></td>
                <td className="px-3 py-2">
                  {invoiceFirst ? (
                    <span className="tabular-nums">{formatMoney(price[item.id] || 0)}</span>
                  ) : (
                    <Input type="number" min={0} aria-label={`Đơn giá hóa đơn — ${item.title || item.variant_id}`} className="h-8 w-32" value={price[item.id] ?? 0} onChange={(event) => setPrice((current) => ({ ...current, [item.id]: Math.max(0, Number(event.target.value) || 0) }))} />
                  )}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{formatMoney((qty[item.id] || 0) * (price[item.id] || 0))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-right text-[13px] tabular-nums">Tiền hàng {formatMoney(subtotal)} · Thuế {formatMoney(tax)} · <span className="font-semibold">Tổng {formatMoney(subtotal + tax)}</span></p>
      {invoiceFirst ? (
        <div className="space-y-1.5">
          <Label htmlFor="inv-note" className="text-[12px]">Ghi chú</Label>
          <Textarea id="inv-note" rows={2} value={form.note} onChange={set("note")} />
        </div>
      ) : null}
      {editing ? null : (
        <div className="space-y-1.5">
          <Label htmlFor="inv-file" className="text-[12px]">File hóa đơn (PDF hoặc XML hóa đơn điện tử, tối đa 10 MB){invoiceFirst ? " — không bắt buộc" : ""}</Label>
          <Input id="inv-file" type="file" accept={ACCEPTED_FILE_TYPES} onChange={(event) => setFile(event.target.files?.[0] || null)} />
          <p className="text-[11px] text-slate-500">Sau khi gửi, hóa đơn không sửa được. {invoiceFirst ? "Nếu SmartBook từ chối, hãy lập hóa đơn mới." : "Nếu sai, hãy hủy (có lý do) hoặc lập hóa đơn thay thế."}</p>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={busy}><FileCheck2 className="mr-2 h-4 w-4" />{invoiceFirst ? "Gửi hóa đơn cho SmartBook" : "Phát hành hóa đơn"}</Button>
        <Button type="button" variant="outline" disabled={busy} onClick={() => void submit(false)}>{editing ? "Lưu thay đổi nháp" : "Lưu nháp"}</Button>
      </div>
    </form>
  );
}

/** Supplier side of the shared document set for one PO. */
export function SupplierOrderDocuments({ order, autoOpenInvoice = false }: { order: SupplierPortalOrder; autoOpenInvoice?: boolean }) {
  const po = order.purchase_order;
  const invoiceFirst = isInvoiceFirst(order);
  const [documents, setDocuments] = useState<ProcurementDocument[]>([]);
  const [showInvoice, setShowInvoice] = useState(autoOpenInvoice);
  const [editing, setEditing] = useState<ProcurementDocument | null>(null);

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

  const canInvoice = invoiceFirst ? INVOICEABLE_STATUSES.includes(po.status) : !["SENT_TO_SUPPLIER", "CANCELLED"].includes(po.status);
  const unacknowledged = documents.filter((doc) => doc.issuer_party === "SMARTBOOK" && ["SENT", "DELIVERED"].includes(doc.sharing.status)).length;
  const drafts = invoiceFirst ? documents.filter((doc) => INVOICE_DOC_TYPES.includes(doc.document_type) && doc.status === "DRAFT") : [];
  const titleOf = (itemId: string) => po.items.find((item) => item.id === itemId)?.title || "-";
  const formOpen = showInvoice || Boolean(editing);

  return (
    <div className="space-y-4">
      {invoiceFirst ? (
        <div className={cardClass + " p-0"}>
          <div className="p-5 pb-3">
            <h3 className="text-[16px] font-semibold">Hóa đơn và tiến độ giao hàng</h3>
            <p className="mt-1 text-[13px] text-slate-500">Chỉ hóa đơn SmartBook đã duyệt mới lập được phiếu giao. Hàng chỉ tính là giao thành công khi kho SmartBook xác nhận nhận.</p>
          </div>
          <InvoiceFulfillmentPanel
            invoices={documents.filter((doc) => ["VAT_INVOICE", "SALES_INVOICE"].includes(doc.document_type))}
            fulfillment={order.invoice_fulfillment || []}
            titleOf={titleOf}
          />
        </div>
      ) : null}

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
            <Button variant={formOpen ? "secondary" : "default"} onClick={() => { setEditing(null); setShowInvoice((value) => !value); }} aria-expanded={formOpen}>
              {formOpen ? "Đóng" : invoiceFirst ? "Lập hóa đơn" : "Phát hành hóa đơn"}
            </Button>
          ) : (
            <p className="text-[12px] text-slate-500">{invoiceFirst ? "Lập hóa đơn sau khi SmartBook duyệt đề xuất số lượng và đơn giá." : "Xác nhận đơn trước khi phát hành hóa đơn."}</p>
          )}
        </div>
        {drafts.length > 0 && !formOpen ? (
          <ul className="space-y-1 border-t border-slate-200 px-5 py-3 text-[13px]">
            {drafts.map((doc) => (
              <li key={doc.id} className="flex flex-wrap items-center gap-2">
                <span>Hóa đơn nháp <span className="font-mono">{doc.external_number || doc.document_number}</span> · {formatMoney(doc.total_amount)}</span>
                <Button size="sm" variant="outline" onClick={() => { setShowInvoice(false); setEditing(doc); }}><Pencil className="mr-1 h-3.5 w-3.5" />Sửa / gửi</Button>
              </li>
            ))}
          </ul>
        ) : null}
        {formOpen ? (
          <div className="border-t border-slate-200 bg-slate-50/60 p-5">
            <SupplierInvoiceForm key={editing?.id || "new"} order={order} documents={documents} editing={editing} onSaved={async () => { setShowInvoice(false); setEditing(null); await load(); }} />
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
          emptyDescription={invoiceFirst ? "Lập hóa đơn sau khi SmartBook duyệt đề xuất. Biên bản do SmartBook chia sẻ cũng hiện ở đây." : "Phát hành hóa đơn hoặc lập phiếu giao để bắt đầu. Biên bản do SmartBook chia sẻ cũng hiện ở đây."}
        />
      </div>
    </div>
  );
}

const FLOW_STEPS = ["Đề xuất giá", "SmartBook duyệt đề xuất", "Lập hóa đơn", "SmartBook duyệt hóa đơn", "Lập phiếu giao"];

/** Step tracker shown above an invoice-first order on the supplier account. */
export function InvoiceFirstSteps({ order, onGo }: { order: SupplierPortalOrder; onGo: (tab: FlowTab) => void }) {
  const stage = invoiceFirstStage(order);
  if (!stage) return null;
  return (
    <div className={cardClass}>
      <ol className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px]" aria-label="Các bước xử lý đơn">
        {FLOW_STEPS.map((label, index) => {
          const done = index < stage.step;
          const current = index === stage.step;
          return (
            <li key={label} className="flex items-center gap-2">
              <span
                aria-current={current ? "step" : undefined}
                className={done ? "font-medium text-emerald-700" : current ? "font-semibold text-sky-700" : "text-slate-400"}
              >
                {done ? "✓ " : `${index + 1}. `}{label}
              </span>
              {index < FLOW_STEPS.length - 1 ? <span aria-hidden className="text-slate-300">→</span> : null}
            </li>
          );
        })}
      </ol>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <p className="text-[14px] font-medium text-slate-800">{stage.title}</p>
        {stage.tab && stage.action ? <Button size="sm" onClick={() => onGo(stage.tab!)}>{stage.action}</Button> : null}
      </div>
    </div>
  );
}

/** Invoice-first delivery note: ships part or all of what an approved invoice still owes. */
export function SupplierInvoiceDeliveryForm({ order, onSaved, onCreateInvoice }: { order: SupplierPortalOrder; onSaved: () => Promise<void>; onCreateInvoice?: () => void }) {
  const po = order.purchase_order;
  const approved = (order.invoice_fulfillment || []).filter((f) => f.approval_status === "APPROVED" && f.lines.some((line) => line.remaining_to_ship_qty > 0));
  const [invoiceId, setInvoiceId] = useState(approved[0]?.invoice_id || "");
  const invoice = approved.find((f) => f.invoice_id === invoiceId) || null;
  const [qty, setQty] = useState<Record<string, number>>({});
  const [form, setForm] = useState({ delivery_number: `PG-${po.po_number}-${Date.now().toString().slice(-5)}`, carrier_name: "", tracking_number: "", delivery_date: today(), note: "" });
  const [busy, setBusy] = useState(false);
  const titleOf = (itemId: string) => po.items.find((item) => item.id === itemId)?.title || "-";

  useEffect(() => {
    setQty(Object.fromEntries((invoice?.lines || []).map((line) => [line.purchase_order_item_id, line.remaining_to_ship_qty])));
  }, [invoice]);

  if (approved.length === 0) {
    const pending = (order.invoice_fulfillment || []).some((f) => f.approval_status === "PENDING_APPROVAL");
    return (
      <div className="space-y-3 p-5 text-[13px] text-muted-foreground">
        <p>
          {pending
            ? "Hóa đơn của bạn đang chờ SmartBook duyệt. Phiếu giao hàng lập được ngay sau khi hóa đơn được duyệt."
            : "Chưa có hóa đơn được SmartBook duyệt. Hãy lập hóa đơn theo giá đã duyệt trước; sau khi SmartBook duyệt hóa đơn, bạn lập phiếu giao ở đây."}
        </p>
        {!pending && onCreateInvoice ? (
          <Button onClick={onCreateInvoice}><FileCheck2 className="mr-2 h-4 w-4" />Lập hóa đơn</Button>
        ) : null}
      </div>
    );
  }

  const submit = async () => {
    if (!invoice) return toast.error("Chọn hóa đơn đã được duyệt");
    if (!form.delivery_number.trim()) return toast.error("Nhập số phiếu giao hàng");
    if (!form.delivery_date) return toast.error("Nhập ngày giao");
    const items = invoice.lines
      .filter((line) => (qty[line.purchase_order_item_id] || 0) > 0)
      .map((line) => ({ purchase_order_item_id: line.purchase_order_item_id, invoiced_qty: qty[line.purchase_order_item_id] }));
    if (items.length === 0) return toast.error("Nhập số lượng giao cho ít nhất một sách");
    const over = invoice.lines.find((line) => (qty[line.purchase_order_item_id] || 0) > line.remaining_to_ship_qty);
    if (over) return toast.error(`"${titleOf(over.purchase_order_item_id)}" vượt số lượng còn phải giao (${over.remaining_to_ship_qty})`);
    try {
      setBusy(true);
      await supplierAccountService.createInvoice(po.id, {
        invoice_document_id: invoice.invoice_id,
        delivery_number: form.delivery_number.trim(),
        carrier_name: form.carrier_name.trim() || undefined,
        tracking_number: form.tracking_number.trim() || undefined,
        expected_delivery_date: form.delivery_date,
        invoice_date: today(),
        supplier_note: form.note.trim() || undefined,
        items,
      });
      toast.success("Đã gửi phiếu giao hàng — SmartBook sẽ xác nhận khi nhận hàng");
      setForm((current) => ({ ...current, delivery_number: `PG-${po.po_number}-${Date.now().toString().slice(-5)}`, tracking_number: "", note: "" }));
      await onSaved();
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Gửi phiếu giao thất bại"));
    } finally {
      setBusy(false);
    }
  };

  const input = (key: keyof typeof form, label: string, props: Record<string, unknown> = {}) => (
    <div className="space-y-1.5">
      <Label htmlFor={`dn-${key}`} className="text-[12px]">{label}</Label>
      <Input id={`dn-${key}`} value={form[key]} onChange={(event) => setForm((current) => ({ ...current, [key]: event.target.value }))} className="h-9 text-[13px]" {...props} />
    </div>
  );

  return (
    <div className="space-y-4 p-5">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor="dn-invoice" className="text-[12px]">Hóa đơn đã duyệt</Label>
          <select id="dn-invoice" className={selectClass} value={invoiceId} onChange={(event) => setInvoiceId(event.target.value)}>
            {approved.map((f) => <option key={f.invoice_id} value={f.invoice_id}>{f.external_number || f.document_number} · còn thiếu {f.missing_qty}</option>)}
          </select>
        </div>
        {input("delivery_number", "Số phiếu giao")}
        {input("delivery_date", "Ngày giao", { type: "date" })}
        {input("carrier_name", "Đơn vị vận chuyển")}
        {input("tracking_number", "Mã vận đơn (nếu có)")}
        {input("note", "Ghi chú")}
      </div>
      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full min-w-[600px] text-[13px]">
          <thead className="text-left text-[12px] text-muted-foreground">
            <tr className="border-b border-border">
              <th className="px-3 py-2 font-normal">Sách</th>
              <th className="px-3 py-2 text-right font-normal">Trên hóa đơn</th>
              <th className="px-3 py-2 text-right font-normal">Đã gửi</th>
              <th className="px-3 py-2 text-right font-normal">Còn phải giao</th>
              <th className="px-3 py-2 font-normal">Giao đợt này</th>
            </tr>
          </thead>
          <tbody>
            {(invoice?.lines || []).map((line) => (
              <tr key={line.purchase_order_item_id} className="border-b border-border last:border-0">
                <td className="px-3 py-2 font-medium">{titleOf(line.purchase_order_item_id)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{line.invoiced_qty}</td>
                <td className="px-3 py-2 text-right tabular-nums">{line.shipped_qty}</td>
                <td className="px-3 py-2 text-right tabular-nums">{line.remaining_to_ship_qty}</td>
                <td className="px-3 py-2">
                  <input
                    type="number"
                    min={0}
                    max={line.remaining_to_ship_qty}
                    disabled={line.remaining_to_ship_qty === 0}
                    aria-label={`Số lượng giao đợt này, ${titleOf(line.purchase_order_item_id)}`}
                    value={qty[line.purchase_order_item_id] ?? 0}
                    onChange={(event) => setQty((current) => ({ ...current, [line.purchase_order_item_id]: Math.max(0, Math.min(line.remaining_to_ship_qty, Math.floor(Number(event.target.value) || 0))) }))}
                    className="w-24 rounded-lg border border-input bg-background px-2 py-1.5 text-[13px] tabular-nums"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Button onClick={() => void submit()} disabled={busy} className="gap-2">
        <PackageCheck className="h-4 w-4" /> Gửi phiếu giao hàng
      </Button>
    </div>
  );
}
