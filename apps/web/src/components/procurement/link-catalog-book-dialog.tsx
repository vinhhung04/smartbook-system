import { useState } from "react";
import { Plus, Search } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getApiErrorMessage } from "@/services/api";
import { purchaseOrderService, type VariantSearchItem } from "@/services/purchase-order";
import { supplierDeliveryService } from "@/services/supplier-delivery";

export interface UnlinkedLine {
  purchase_order_item_id: string;
  title: string;
  item_code?: string | null;
  item_author?: string | null;
  item_publish_year?: number | null;
}

/**
 * Receiving a book that was ordered by typed details only: link it to an existing catalog book,
 * or create the catalog book (ISBN-13 / EAN-13 codes) from what was ordered. The PO keeps its
 * ordered snapshot either way; nothing existing in the catalog is overwritten.
 */
export function LinkCatalogBookDialog({ deliveryId, line, onClose, onLinked }: { deliveryId: string; line: UnlinkedLine | null; onClose: () => void; onLinked: () => Promise<void> }) {
  const [query, setQuery] = useState(line?.item_code || line?.title || "");
  const [results, setResults] = useState<VariantSearchItem[] | null>(null);
  const [price, setPrice] = useState("");
  // the code printed on the physical book; pre-filled with the code typed on the PO
  const [bookCode, setBookCode] = useState(line?.item_code || "");
  const [existing, setExisting] = useState<{ variant_id: string; title: string | null } | null>(null);
  const [busy, setBusy] = useState(false);

  const link = async (variantId: string) => {
    if (!line) return;
    try {
      setBusy(true);
      await supplierDeliveryService.linkItem(deliveryId, line.purchase_order_item_id, variantId);
      toast.success(`Đã liên kết "${line.title}" với danh mục`);
      await onLinked();
      onClose();
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Không liên kết được sách"));
    } finally {
      setBusy(false);
    }
  };

  const search = async () => {
    try {
      setBusy(true);
      setResults(await purchaseOrderService.searchVariants(query));
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Tìm sách thất bại"));
    } finally {
      setBusy(false);
    }
  };

  const createAndLink = async () => {
    if (!line) return;
    const listPrice = Number(price);
    if (!bookCode.trim()) return toast.error("Nhập hoặc quét mã in trên sách");
    if (!price || !Number.isFinite(listPrice) || listPrice < 0) return toast.error("Nhập giá bán (lớn hơn hoặc bằng 0) cho sách mới");
    setExisting(null);
    try {
      setBusy(true);
      // one call: create the book from the ordered title/author/year with this code, then link it
      const created = await supplierDeliveryService.createCatalogBook(deliveryId, {
        purchase_order_item_id: line.purchase_order_item_id,
        code: bookCode.trim(),
        price: listPrice,
      });
      toast.success(`Đã tạo "${line.title}" trong danh mục (mã ${created.data.internal_barcode}) và liên kết`, {
        description: "Sách ở trạng thái Chưa hoàn chỉnh: bổ sung thông tin ở Danh mục (nút Hoàn thiện bằng AI hoặc Bổ sung).",
      });
      await onLinked();
      onClose();
    } catch (error) {
      const body = (error as { response?: { data?: { code?: string; existing?: { variant_id: string; title: string | null } } } }).response?.data;
      if (body?.code === "BOOK_CODE_EXISTS" && body.existing) setExisting(body.existing);
      toast.error(getApiErrorMessage(error, "Không tạo được sách mới"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={Boolean(line)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Liên kết sách với danh mục</DialogTitle>
          <DialogDescription>
            {line ? `Đặt mua: "${line.title}" · mã ${line.item_code || "-"}${line.item_author ? ` · ${line.item_author}` : ""}${line.item_publish_year ? ` · năm ${line.item_publish_year}` : ""}. ` : ""}
            Sách phải có trong danh mục trước khi nhập kho. Thông tin trên đơn đặt hàng được giữ nguyên.
          </DialogDescription>
        </DialogHeader>

        <section className="space-y-2">
          <p className="text-[13px] font-medium">Chọn sách có sẵn</p>
          <div className="flex gap-2">
            <Input value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void search(); }} aria-label="Tìm sách trong danh mục" placeholder="Tên sách, ISBN hoặc mã vạch" className="border-border bg-card" />
            <Button variant="outline" onClick={() => void search()} disabled={busy || query.trim().length < 2}><Search className="h-3.5 w-3.5" />Tìm</Button>
          </div>
          {results ? (
            results.length === 0 ? (
              <p className="text-[12px] text-muted-foreground">Không tìm thấy sách phù hợp.</p>
            ) : (
              <ul className="max-h-56 divide-y divide-border overflow-y-auto rounded-lg border border-border">
                {results.map((row) => (
                  <li key={row.variant_id} className="flex items-center justify-between gap-3 px-3 py-2 text-[13px]">
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{row.title}</span>
                      <span className="block font-mono text-[11px] text-muted-foreground">{row.isbn13 || row.barcode || row.sku}</span>
                    </span>
                    <Button size="sm" variant="outline" disabled={busy} onClick={() => void link(row.variant_id)}>Chọn</Button>
                  </li>
                ))}
              </ul>
            )
          ) : null}
        </section>

        <section className="space-y-2 border-t border-border pt-3">
          <p className="text-[13px] font-medium">Hoặc tạo sách mới từ thông tin đặt mua</p>
          <p className="text-[12px] text-muted-foreground">
            Quét hoặc nhập mã in trên sách. ISBN-13, EAN-13 được lưu làm mã chuẩn (ISBN-10 tự đổi sang ISBN-13); sách không có mã vạch chuẩn thì mã này thành mã nội bộ để quét khi đóng gói.
            Tên, tác giả, năm lấy theo đơn đặt hàng; sách ở trạng thái chưa hoàn thiện để thủ thư bổ sung sau.
          </p>
          <div className="space-y-1.5">
            <Label htmlFor="link-new-code" className="text-[12px]">Mã vạch in trên sách</Label>
            <Input id="link-new-code" value={bookCode} onChange={(event) => { setBookCode(event.target.value); setExisting(null); }} maxLength={50} className="border-border bg-card font-mono" />
          </div>
          {existing ? (
            <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[13px] text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
              <span>Mã này đã thuộc sách "{existing.title || "không rõ tên"}" trong danh mục.</span>
              <Button size="sm" variant="outline" disabled={busy} onClick={() => void link(existing.variant_id)}>Liên kết sách này</Button>
            </div>
          ) : null}
          <div className="flex items-end gap-2">
            <div className="flex-1 space-y-1.5">
              <Label htmlFor="link-new-price" className="text-[12px]">Giá bán, VND</Label>
              <Input id="link-new-price" type="number" min={0} value={price} onChange={(event) => setPrice(event.target.value)} className="border-border bg-card" />
            </div>
            <Button disabled={busy} onClick={() => void createAndLink()}><Plus className="h-3.5 w-3.5" />Tạo và liên kết</Button>
          </div>
        </section>
      </DialogContent>
    </Dialog>
  );
}
