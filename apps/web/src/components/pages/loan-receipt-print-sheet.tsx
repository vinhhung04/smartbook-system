import { createPortal } from "react-dom";

// Rendered into document.body (outside #root), hidden on screen, shown only for
// window.print(). index.css hides #root in @media print so this is the only thing
// on the page. Used by both the staff and customer loan-detail screens — native
// browser text rendering (not jsPDF's built-in fonts) is what makes Vietnamese
// diacritics in customer names and book titles print correctly.

function formatDateTime(value: string | null | undefined): string {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleString("vi-VN");
}

function formatVnd(value: number | string | null | undefined): string {
  return `${Number(value || 0).toLocaleString("vi-VN")} VND`;
}

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

export interface LoanReceiptPrintItem {
  title: string;
  dueDate: string | null | undefined;
  statusLabel: string;
  code?: string | null;
  returnDate?: string | null;
  fineAmount?: number | string | null;
  depositAmount?: number | string | null;
}

interface Props {
  loanNumber: string;
  statusLabel: string;
  customerName: string;
  customerCode?: string | null;
  borrowDate: string | null | undefined;
  dueDate: string | null | undefined;
  totalItems: number;
  items: LoanReceiptPrintItem[];
  /** Staff view has barcode/trả/tiền phạt/tiền cọc per item; the customer view doesn't. */
  showFinance?: boolean;
}

export function LoanReceiptPrintSheet({
  loanNumber,
  statusLabel,
  customerName,
  customerCode,
  borrowDate,
  dueDate,
  totalItems,
  items,
  showFinance = false,
}: Props) {
  return createPortal(
    <div className="hidden bg-white text-[11px] leading-snug text-black print:block" style={{ fontFamily: "Arial, Helvetica, sans-serif" }}>
      <header className="mb-4 flex items-start justify-between border-b-2 border-black pb-3">
        <div>
          <p className="text-[14px] font-bold">SmartBook — Thư viện sách</p>
          <p className="text-[9px] text-neutral-600">Hệ thống quản lý nhà sách</p>
        </div>
        <div className="text-right">
          <h1 className="text-[15px] font-bold uppercase">Phiếu mượn sách</h1>
          <p>
            Số phiếu: <span className="font-semibold">{loanNumber}</span>
          </p>
        </div>
      </header>

      <dl className="mb-4 grid grid-cols-2 gap-x-10 gap-y-1">
        <InfoRow label="Người mượn" value={customerName || "-"} />
        <InfoRow label="Trạng thái" value={statusLabel} />
        {customerCode ? <InfoRow label="Mã khách hàng" value={customerCode} /> : null}
        <InfoRow label="Ngày mượn" value={formatDateTime(borrowDate)} />
        <InfoRow label="Hạn trả" value={formatDateTime(dueDate)} />
        <InfoRow label="Số sách" value={String(totalItems)} />
      </dl>

      <table className="mb-1 w-full border-collapse">
        <thead>
          <tr className="border-y border-black">
            <th className="w-8 py-1.5 pr-2 text-left font-semibold">STT</th>
            {showFinance ? <th className="py-1.5 pr-2 text-left font-semibold">Mã vạch</th> : null}
            <th className="py-1.5 pr-2 text-left font-semibold">Tên sách</th>
            <th className="py-1.5 pr-2 text-left font-semibold">Hạn trả</th>
            {showFinance ? <th className="py-1.5 pr-2 text-left font-semibold">Ngày trả</th> : null}
            <th className="py-1.5 pr-2 text-left font-semibold">Trạng thái</th>
            {showFinance ? <th className="py-1.5 pr-2 text-right font-semibold">Tiền phạt</th> : null}
            {showFinance ? <th className="py-1.5 text-right font-semibold">Tiền cọc</th> : null}
          </tr>
        </thead>
        <tbody>
          {items.map((item, index) => (
            <tr key={index} className="border-b border-neutral-300" style={{ breakInside: "avoid" }}>
              <td className="py-1.5 pr-2">{index + 1}</td>
              {showFinance ? <td className="py-1.5 pr-2 font-mono">{item.code || "-"}</td> : null}
              <td className="py-1.5 pr-2">{item.title}</td>
              <td className="py-1.5 pr-2">{formatDateTime(item.dueDate)}</td>
              {showFinance ? <td className="py-1.5 pr-2">{formatDateTime(item.returnDate)}</td> : null}
              <td className="py-1.5 pr-2">{item.statusLabel}</td>
              {showFinance ? <td className="py-1.5 pr-2 text-right font-mono">{formatVnd(item.fineAmount)}</td> : null}
              {showFinance ? <td className="py-1.5 text-right font-mono">{formatVnd(item.depositAmount)}</td> : null}
            </tr>
          ))}
        </tbody>
      </table>

      <footer className="mt-12 grid grid-cols-2 gap-6 text-center" style={{ breakInside: "avoid" }}>
        <SignatureBlock title="Thủ thư giao sách" />
        <SignatureBlock title="Người mượn" />
      </footer>

      <p className="mt-10 text-right text-[9px] text-neutral-500">In lúc {new Date().toLocaleString("vi-VN")}</p>
    </div>,
    document.body,
  );
}
