import { useCallback, useEffect, useState } from "react";
import { FileSignature, Save } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SectionCard } from "@/components/ui/section-card";
import { getApiErrorMessage } from "@/services/api";
import { authService } from "@/services/auth";
import { canManageReceiving } from "@/lib/rbac";
import { procurementDocumentService, type GoodsReceiptDocumentsResponse } from "@/services/procurement-documents";
import { ProcurementDocumentList } from "./procurement-document-list";
import { ACCEPTED_FILE_TYPES } from "@/lib/procurement-document-status";

/**
 * Receiving outcome + shared documents for a goods receipt created from a supplier delivery note.
 * Staff record damaged / refused copies next to their count and attach the signed delivery
 * minutes; only the accepted quantity is posted to stock when the manager approves.
 * Renders nothing for receipts that are not linked to a supplier purchase order.
 */
export function GoodsReceiptProcurementPanel({ receiptId }: { receiptId: string }) {
  const [data, setData] = useState<GoodsReceiptDocumentsResponse | null>(null);
  const [counts, setCounts] = useState<Record<string, { damaged: number; rejected: number }>>({});
  const [saving, setSaving] = useState(false);
  const [minutes, setMinutes] = useState({ signed_date: "", supplier_representative: "", library_representative: "", confirmed_qty: "", discrepancy_summary: "" });
  const [file, setFile] = useState<File | null>(null);
  const isManager = canManageReceiving(authService.getCurrentUser());

  const apply = (response: GoodsReceiptDocumentsResponse) => {
    setData(response);
    setCounts(Object.fromEntries(response.lines.map((line) => [line.id, { damaged: line.damaged_qty, rejected: line.rejected_qty }])));
  };

  const reload = useCallback(() => procurementDocumentService.forGoodsReceipt(receiptId).then(apply).catch(() => undefined), [receiptId]);

  useEffect(() => {
    let active = true;
    procurementDocumentService.forGoodsReceipt(receiptId)
      .then((response) => { if (active) apply(response); })
      .catch(() => { if (active) setData(null); });
    return () => { active = false; };
  }, [receiptId]);

  if (!data) return null;
  const isDraft = data.status === "DRAFT";
  const hasMinutes = data.documents.some((doc) => doc.document_type === "DELIVERY_ACCEPTANCE_MINUTES" && doc.goods_receipt_id === data.goods_receipt_id && doc.status !== "CANCELLED");

  const saveCounts = async () => {
    try {
      setSaving(true);
      await procurementDocumentService.verifyReceiptCounts(receiptId, data.lines.map((line) => ({
        id: line.id,
        // Never invent a count: an uncounted line keeps actual_quantity empty for the staff count step.
        ...(line.actual_quantity != null ? { actual_quantity: line.actual_quantity } : {}),
        damaged_qty: counts[line.id]?.damaged || 0,
        rejected_qty: counts[line.id]?.rejected || 0,
      })));
      toast.success("Đã lưu số hỏng / từ chối");
      await reload();
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Không lưu được"));
    } finally {
      setSaving(false);
    }
  };

  const createMinutes = async () => {
    try {
      setSaving(true);
      await procurementDocumentService.create(data.purchase_order_id, {
        document_type: "DELIVERY_ACCEPTANCE_MINUTES",
        goods_receipt_id: data.goods_receipt_id,
        metadata: minutes,
        file,
      });
      toast.success(file ? "Đã lưu biên bản và bản scan" : "Đã tạo biên bản — trạng thái Chờ bản ký");
      setFile(null);
      await reload();
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Không lưu được biên bản"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <SectionCard title="Kiểm nhận theo phiếu giao & chứng từ" subtitle={`PO ${data.po_number} · chỉ số chấp nhận được nhập kho, thiếu/hỏng/từ chối lập biên bản chênh lệch`} noPadding>
      <div className="overflow-x-auto border-t border-border">
        <table className="w-full min-w-[680px] text-[13px]">
          <thead>
            <tr className="bg-muted/30 text-left text-[11px] uppercase tracking-wider text-muted-foreground">
              <th className="px-4 py-2">Sách</th>
              <th className="px-3 py-2 text-right">Phiếu giao</th>
              <th className="px-3 py-2 text-right">Thực nhận</th>
              <th className="px-3 py-2 text-right">Hỏng</th>
              <th className="px-3 py-2 text-right">Từ chối</th>
              <th className="px-3 py-2 text-right">Chấp nhận</th>
              <th className="px-3 py-2 text-right">Thiếu</th>
            </tr>
          </thead>
          <tbody>
            {data.lines.map((line) => {
              const delivered = line.actual_quantity ?? line.delivered_qty ?? line.quantity;
              const damaged = counts[line.id]?.damaged || 0;
              const rejected = counts[line.id]?.rejected || 0;
              const accepted = Math.max(0, delivered - damaged - rejected);
              const missing = line.delivery_note_qty != null ? Math.max(0, line.delivery_note_qty - delivered) : 0;
              return (
                <tr key={line.id} className="border-t border-border">
                  <td className="px-4 py-2"><span className="font-medium">{line.title || "-"}</span><span className="block font-mono text-[11px] text-muted-foreground">{line.isbn13 || ""}</span></td>
                  <td className="px-3 py-2 text-right tabular-nums">{line.delivery_note_qty ?? "-"}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{delivered}{line.actual_quantity == null ? <span className="block text-[11px] text-muted-foreground">chưa kiểm đếm</span> : null}</td>
                  {(["damaged", "rejected"] as const).map((kind) => (
                    <td key={kind} className="px-3 py-2 text-right">
                      {isDraft ? (
                        <Input
                          type="number"
                          min={0}
                          inputMode="numeric"
                          aria-label={`${kind === "damaged" ? "Số hỏng" : "Số từ chối"} — ${line.title || line.id}`}
                          value={kind === "damaged" ? damaged : rejected}
                          onChange={(event) => {
                            const value = Math.max(0, Math.floor(Number(event.target.value) || 0));
                            setCounts((current) => ({ ...current, [line.id]: { damaged: current[line.id]?.damaged || 0, rejected: current[line.id]?.rejected || 0, [kind]: value } }));
                          }}
                          className="ml-auto h-8 w-20 text-right tabular-nums"
                        />
                      ) : <span className="tabular-nums">{kind === "damaged" ? damaged : rejected}</span>}
                    </td>
                  ))}
                  <td className="px-3 py-2 text-right font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">{isDraft ? accepted : line.quantity}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{missing}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {isDraft ? (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-5 py-3 text-[12px] text-muted-foreground">
          <span>Hàng giao thừa so với phiếu giao phải ghi vào cột “Từ chối” (trả lại NCC).</span>
          <Button size="sm" variant="outline" onClick={() => void saveCounts()} disabled={saving}><Save className="h-3.5 w-3.5" />Lưu hỏng / từ chối</Button>
        </div>
      ) : null}

      {data.can_upload_minutes && !hasMinutes ? (
        <form className="grid gap-3 border-t border-border bg-muted/20 px-5 py-4 sm:grid-cols-2 lg:grid-cols-3" onSubmit={(event) => { event.preventDefault(); void createMinutes(); }}>
          <p className="flex items-center gap-2 text-[13px] font-semibold sm:col-span-2 lg:col-span-3"><FileSignature className="h-4 w-4" aria-hidden />Biên bản giao nhận (ký giấy ngoài hệ thống, tải bản scan lên)</p>
          {([
            ["signed_date", "Ngày ký", "date"],
            ["supplier_representative", "Đại diện nhà cung cấp", "text"],
            ["library_representative", "Đại diện thư viện", "text"],
            ["confirmed_qty", "Số lượng xác nhận", "number"],
            ["discrepancy_summary", "Danh sách chênh lệch", "text"],
          ] as const).map(([key, label, type]) => (
            <div key={key} className="space-y-1.5">
              <Label htmlFor={`grm-${key}`} className="text-[12px]">{label}</Label>
              <Input id={`grm-${key}`} type={type} value={minutes[key]} onChange={(event) => setMinutes((current) => ({ ...current, [key]: event.target.value }))} className="h-9 text-[13px]" />
            </div>
          ))}
          <div className="space-y-1.5">
            <Label htmlFor="grm-file" className="text-[12px]">Bản scan đã ký (PDF/ảnh)</Label>
            <Input id="grm-file" type="file" accept={ACCEPTED_FILE_TYPES} onChange={(event) => setFile(event.target.files?.[0] || null)} className="h-9 text-[13px]" />
          </div>
          <p className="text-[11px] text-muted-foreground sm:col-span-2">Không có file thì biên bản ở trạng thái “Chờ bản ký”. Tải file lên chỉ ghi nhận “Đã tải bản scan” — hệ thống không tự đánh dấu là đã ký.</p>
          <div className="flex items-end"><Button type="submit" size="sm" disabled={saving}>Lưu biên bản</Button></div>
        </form>
      ) : null}

      <div className="border-t border-border pt-3">
        <ProcurementDocumentList
          documents={data.documents}
          viewer="SMARTBOOK"
          canManage={isManager}
          canUploadVersion={(doc) => data.can_upload_minutes && ["DELIVERY_ACCEPTANCE_MINUTES", "DISCREPANCY_REPORT"].includes(doc.document_type)}
          onChanged={reload}
          actions={{
            download: procurementDocumentService.download,
            acknowledge: procurementDocumentService.acknowledge,
            uploadVersion: procurementDocumentService.uploadVersion,
            issue: procurementDocumentService.issue,
            cancel: procurementDocumentService.cancel,
            share: isManager ? procurementDocumentService.share : undefined,
          }}
          emptyDescription="Hóa đơn và phiếu giao của nhà cung cấp cho phiếu nhập này sẽ hiện ở đây."
        />
      </div>
    </SectionCard>
  );
}
