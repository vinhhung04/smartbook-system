import type { StockAuditLine } from '../types/stockAudit';

// A scanned code identifies an audit line by SKU, ISBN-13/10 or the internal barcode printed on the
// shelf label (BC-…) — the code picking, putaway and outbound already scan — case-insensitively.
export function findAuditLineByCode(items: StockAuditLine[], rawCode: string): StockAuditLine | undefined {
  const code = rawCode.trim().toLowerCase();
  if (!code) return undefined;
  return items.find((line) =>
    [line.sku, line.isbn13, line.isbn10, line.barcode].some((value) => value && value.toLowerCase() === code),
  );
}

// Same wording as the web's stock-audits page.
const AUDIT_STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Nháp',
  IN_PROGRESS: 'Đang kiểm',
  SUBMITTED: 'Chờ duyệt',
  COMPLETED: 'Hoàn tất',
  CANCELLED: 'Đã hủy',
};

export function getAuditStatusLabel(status: string): string {
  return AUDIT_STATUS_LABELS[status] ?? status;
}
