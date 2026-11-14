import { createPortal } from "react-dom";
import type { ReceiptDetail } from "./order-detail";
import { formatCurrency, formatDate } from "./goods-receipt-format";

// Rendered into document.body (outside #root), hidden on screen, shown only for
// window.print(). index.css hides #root in @media print so this is the only
// thing on the page — a real printed document, not a screenshot of the app chrome.

const STATUS_LABEL: Record<ReceiptDetail["status"], string> = {
  DRAFT: "Nháp — chưa duyệt",
  POSTED: "Đã duyệt",
  CANCELLED: "Đã hủy",
};

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <dt className="shrink-0 text-neutral-600">{label}:</dt>
      <dd className="font-semibold">{value}</dd>
    </div>
  );
}

function SignatureBlock({ title }: { title: string }) {
  return (
    <div>
      <p className="font-semibold">{title}</p>
      <p className="text-[9px] italic text-neutral-500">(Ký, ghi rõ họ tên)</p>
      <div className="h-16" />
    </div>
  );
}

interface Props {
  receipt: ReceiptDetail;
  totalQty: number;
  showLocation: boolean;
  showUnitCost: boolean;
  receiverName: string | null;
}

export function GoodsReceiptPrintSheet({ receipt, totalQty, showLocation, showUnitCost, receiverName }: Props) {
  const labelColSpan = 3 + (showLocation ? 1 : 0);

  return createPortal(
    <div className="hidden bg-white text-[11px] leading-snug text-black print:block" style={{ fontFamily: "Arial, Helvetica, sans-serif" }}>
      <header className="mb-4 flex items-start justify-between border-b-2 border-black pb-3">
        <div>
          <p className="text-[14px] font-bold">SmartBook — Thư viện sách</p>
          <p className="text-[9px] text-neutral-600">Hệ thống quản lý nhà sách</p>
        </div>
        <div className="text-right">
          <h1 className="text-[15px] font-bold uppercase">Phiếu nhập kho</h1>
          <p>
            Số phiếu: <span className="font-semibold">{receipt.receipt_number}</span>
          </p>
        </div>
      </header>

      <dl className="mb-4 grid grid-cols-2 gap-x-10 gap-y-1">
        <InfoRow label="Ngày lập" value={formatDate(receipt.created_at)} />
        <InfoRow label="Trạng thái" value={STATUS_LABEL[receipt.status]} />
        <InfoRow label="Kho nhận" value={receipt.warehouse_code || receipt.warehouse_name || "-"} />
        <InfoRow label="PO liên kết" value={receipt.po_number || "-"} />
        {receipt.invoice ? <InfoRow label="Nhà cung cấp" value={receipt.invoice.supplier_name || "-"} /> : null}
        {receipt.invoice ? <InfoRow label="Hóa đơn NCC" value={receipt.invoice.invoice_number} /> : null}
        <InfoRow label="Người kiểm đếm" value={receiverName || "-"} />
      </dl>

      {receipt.note ? (
        <p className="mb-4">
          <span className="font-semibold">Ghi chú: </span>
          {receipt.note}
        </p>
      ) : null}

      <table className="mb-1 w-full border-collapse">
        <thead>
          <tr className="border-y border-black">
            <th className="w-8 py-1.5 pr-2 text-left font-semibold">STT</th>
            <th className="py-1.5 pr-2 text-left font-semibold">Mã vạch</th>
            <th className="py-1.5 pr-2 text-left font-semibold">Tên sách</th>
            {showLocation ? <th className="py-1.5 pr-2 text-left font-semibold">Vị trí</th> : null}
            <th className="py-1.5 pr-2 text-right font-semibold">SL kế hoạch</th>
            <th className="py-1.5 pr-2 text-right font-semibold">SL thực nhận</th>
            {showUnitCost ? <th className="py-1.5 pr-2 text-right font-semibold">Đơn giá</th> : null}
            {showUnitCost ? <th className="py-1.5 text-right font-semibold">Thành tiền</th> : null}
          </tr>
        </thead>
        <tbody>
          {receipt.items.map((item, index) => (
            <tr key={item.id} className="border-b border-neutral-300" style={{ breakInside: "avoid" }}>
              <td className="py-1.5 pr-2">{index + 1}</td>
              <td className="py-1.5 pr-2 font-mono">{item.barcode || "-"}</td>
              <td className="py-1.5 pr-2">{item.book_title}</td>
              {showLocation ? <td className="py-1.5 pr-2 font-mono">{item.location_code || "-"}</td> : null}
              <td className="py-1.5 pr-2 text-right">{item.quantity}</td>
              <td className="py-1.5 pr-2 text-right">{item.actual_quantity ?? "-"}</td>
              {showUnitCost ? <td className="py-1.5 pr-2 text-right font-mono">{formatCurrency(item.unit_cost)}</td> : null}
              {showUnitCost ? <td className="py-1.5 text-right font-mono">{formatCurrency(item.line_total)}</td> : null}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-black font-semibold">
            <td colSpan={labelColSpan} className="py-1.5 pr-2 text-right">Tổng cộng</td>
            <td className="py-1.5 pr-2 text-right">{totalQty}</td>
            <td className="py-1.5 pr-2 text-right">-</td>
            {showUnitCost ? (
              <td colSpan={2} className="py-1.5 text-right font-mono">{formatCurrency(receipt.total_amount || 0)}</td>
            ) : null}
          </tr>
        </tfoot>
      </table>

      <footer className="mt-12 grid grid-cols-3 gap-6 text-center" style={{ breakInside: "avoid" }}>
        <SignatureBlock title="Người lập phiếu" />
        <SignatureBlock title="Thủ kho / Người kiểm đếm" />
        <SignatureBlock title="Người duyệt" />
      </footer>

      <p className="mt-10 text-right text-[9px] text-neutral-500">In lúc {new Date().toLocaleString("vi-VN")}</p>
    </div>,
    document.body,
  );
}
