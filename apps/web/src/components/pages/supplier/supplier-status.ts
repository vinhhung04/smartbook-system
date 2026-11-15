// Status words and badge tones shared by both supplier entrances.

const STATUS_LABELS: Record<string, string> = {
  SENT_TO_SUPPLIER: "Chờ nhà cung cấp xác nhận",
  SUPPLIER_CONFIRMED: "Nhà cung cấp đã xác nhận",
  SUBMITTED: "Đã gửi chứng từ giao hàng",
  SHORTAGE_REPORTED: "Thư viện báo thiếu hàng",
  PARTIALLY_RECEIVED: "Nhận một phần",
  RECEIVED: "Thư viện đã nhận đủ",
  ACKNOWLEDGED: "Nhà cung cấp đã ghi nhận",
  RESOLVED: "Đã xử lý xong",
  OPEN: "Đang mở",
  CANCELLED: "Đã hủy",
  REJECTED: "Từ chối",
  SENT: "Đã gửi cho nhà cung cấp",
  MATCHED: "Khớp",
  READY: "Đủ số còn lại",
  PARTIAL: "Giao một phần",
  OVER_LIMIT: "Vượt số còn lại",
  SKIP: "Không giao",
  FULL_REDELIVERY: "Giao bù đủ",
  PARTIAL_REDELIVERY: "Giao bù một phần",
};

export function supplierStatusLabel(status: string) {
  return STATUS_LABELS[status] || status;
}

export function supplierStatusVariant(status: string) {
  if (["RECEIVED", "RESOLVED", "ACKNOWLEDGED", "SUPPLIER_CONFIRMED", "MATCHED", "READY"].includes(status)) return "success";
  if (["SENT_TO_SUPPLIER", "SUBMITTED", "PARTIALLY_RECEIVED", "OPEN", "SHORTAGE_REPORTED", "PARTIAL"].includes(status)) return "warning";
  if (["CANCELLED", "REJECTED", "FAILED", "OVER_LIMIT"].includes(status)) return "danger";
  return "neutral";
}

export const SUPPLIER_INPUT = "h-10 w-full rounded-xl border border-input bg-background px-3 text-[13px] text-foreground outline-none focus:border-primary/40 focus:ring-2 focus:ring-primary/10";
