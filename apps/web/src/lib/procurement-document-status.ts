import type { Tone } from "@/lib/status-registry";

// Labels + badge tones for the shared procurement document workflow. Every badge carries a text
// label (never color alone). SENT, DELIVERED and ACKNOWLEDGED are deliberately distinct.

const DOCUMENT_STATUS: Record<string, { label: string; tone: Tone }> = {
  DRAFT: { label: "Nháp", tone: "neutral" },
  ISSUED: { label: "Đã phát hành", tone: "primary" },
  PENDING_SIGNED_DOCUMENT: { label: "Chờ bản ký", tone: "warning" },
  SCAN_UPLOADED: { label: "Đã tải bản scan", tone: "info" },
  SUPERSEDED: { label: "Đã bị thay thế", tone: "neutral" },
  CANCELLED: { label: "Đã hủy", tone: "danger" },
};

const SHARE_STATUS: Record<string, { label: string; tone: Tone }> = {
  NOT_SHARED: { label: "Chưa chia sẻ", tone: "neutral" },
  SENT: { label: "Đã gửi", tone: "info" },
  DELIVERED: { label: "Bên nhận đã mở", tone: "primary" },
  ACKNOWLEDGED: { label: "Đã xác nhận nhận", tone: "success" },
  FAILED: { label: "Gửi thất bại", tone: "danger" },
};

const RECONCILIATION_STATUS: Record<string, { label: string; tone: Tone }> = {
  MATCHED: { label: "Khớp", tone: "success" },
  PARTIALLY_MATCHED: { label: "Khớp một phần", tone: "info" },
  DISCREPANCY: { label: "Có chênh lệch", tone: "danger" },
  PENDING_DOCUMENT: { label: "Thiếu chứng từ", tone: "warning" },
  NEEDS_REVIEW: { label: "Cần rà soát", tone: "amber" },
};

const SUPPLIER_RESPONSE: Record<string, { label: string; tone: Tone }> = {
  PENDING_SUPPLIER: { label: "Chờ NCC phản hồi", tone: "warning" },
  ACCEPTED: { label: "NCC chấp nhận", tone: "success" },
  PARTIALLY_ACCEPTED: { label: "NCC chấp nhận một phần", tone: "amber" },
  REJECTED: { label: "NCC từ chối", tone: "danger" },
  CHANGES_REJECTED: { label: "Không duyệt thay đổi của NCC", tone: "danger" },
  PENDING_REVIEW: { label: "Chờ duyệt thay đổi", tone: "warning" },
  APPROVED: { label: "Đã duyệt", tone: "success" },
  WITHDRAWN: { label: "Đã thay bằng phản hồi mới", tone: "neutral" },
  NOT_REQUIRED: { label: "Không cần duyệt", tone: "neutral" },
};

export const DISCREPANCY_TYPE_LABEL: Record<string, string> = {
  SHORTAGE: "Thiếu",
  DAMAGED: "Hư hỏng",
  REJECTED: "Từ chối nhận",
  OVERAGE: "Giao thừa",
  WRONG_ITEM: "Sai đầu sách",
  PRICE_MISMATCH: "Sai giá",
  MIXED: "Nhiều loại",
};

export const SUPPLIER_PROPOSAL_LABEL: Record<string, string> = {
  REDELIVER: "Giao bù",
  EXCHANGE: "Đổi hàng",
  RETURN: "Nhận lại hàng / trả hàng",
  DOCUMENT_ADJUSTMENT: "Điều chỉnh chứng từ",
  CANNOT_FULFILL: "Không thể cung cấp",
};

export const RESOLUTION_LABEL: Record<string, string> = {
  REDELIVERED: "Đã giao bù",
  EXCHANGED: "Đã đổi hàng",
  RETURNED: "Đã trả hàng",
  DOCUMENT_ADJUSTED: "Đã điều chỉnh chứng từ",
  ACCEPTED_LOSS: "Chấp nhận thiếu/hỏng",
  OTHER: "Khác",
};

export const RECONCILIATION_FLAG_LABEL: Record<string, string> = {
  PRICE_MISMATCH: "Giá hóa đơn khác giá PO",
  OVER_INVOICED: "Hóa đơn vượt số lượng đặt",
  OPEN_DISCREPANCY: "Có biên bản chênh lệch chưa xử lý",
  DELIVERED_LESS_THAN_NOTE: "Thực nhận ít hơn phiếu giao",
  DELIVERED_MORE_THAN_NOTE: "Thực nhận nhiều hơn phiếu giao",
  DAMAGED: "Có hàng hỏng",
  REJECTED: "Có hàng bị từ chối",
  GOODS_WITHOUT_INVOICE: "Đã nhận hàng nhưng chưa có hóa đơn",
  INVOICE_WITHOUT_DELIVERY_NOTE: "Có hóa đơn nhưng chưa có phiếu giao",
  INVOICED_NOT_YET_RECEIVED: "Đã xuất hóa đơn, hàng chưa nhận hết",
  INVOICE_EXCEEDS_ACCEPTED: "Hóa đơn lớn hơn số lượng chấp nhận — cần điều chỉnh",
  PENDING_DELIVERY: "Còn hàng chưa giao",
};

export const ACTIVITY_LABEL: Record<string, string> = {
  PURCHASE_ORDER_CREATED: "Tạo đơn đặt hàng",
  PURCHASE_ORDER_UPDATED: "Sửa đơn đặt hàng",
  PURCHASE_ORDER_SUBMITTED: "Gửi duyệt đơn",
  PURCHASE_ORDER_APPROVED: "Duyệt đơn",
  PURCHASE_ORDER_REJECTED: "Từ chối đơn",
  PURCHASE_ORDER_CANCELLED: "Hủy đơn",
  PURCHASE_ORDER_SENT_TO_SUPPLIER: "Gửi đơn cho NCC",
  SUPPLIER_ORDER_ACKNOWLEDGED: "NCC xác nhận đơn",
  SUPPLIER_ORDER_RESPONDED: "NCC phản hồi đơn",
  SUPPLIER_RESPONSE_APPROVED: "Duyệt thay đổi của NCC",
  SUPPLIER_RESPONSE_REJECTED: "Không duyệt thay đổi của NCC",
  SUPPLIER_INVOICE_CREATED: "NCC lập phiếu giao hàng",
  SUPPLIER_REDELIVERY_INVOICE_CREATED: "NCC lập phiếu giao bù",
  GOODS_RECEIPT_CREATED_FROM_SUPPLIER_INVOICE: "Lập phiếu nhập kho từ phiếu giao",
  GOODS_RECEIPT_POSTED: "Ghi sổ phiếu nhập kho",
  PURCHASE_ORDER_RECEIVED_AGAINST_GR: "Cập nhật số lượng đã nhận",
  PURCHASE_ORDER_RECEIPT_CANCELLED: "Hủy phiếu nhập — đảo số lượng",
  SUPPLIER_SHORTAGE_REPORTED: "Ghi nhận thiếu hàng",
  SUPPLIER_DISCREPANCY_REPORTED: "Ghi nhận chênh lệch khi kiểm nhận",
  SUPPLIER_DISCREPANCY_PROPOSAL: "NCC đề xuất xử lý chênh lệch",
  SUPPLIER_DISCREPANCY_VOIDED: "Hủy biên bản chênh lệch (phiếu nhập bị hủy)",
  SUPPLIER_SHORTAGE_ACKNOWLEDGED: "NCC ghi nhận chênh lệch",
  SUPPLIER_SHORTAGE_CANNOT_FULFILL: "NCC báo không thể cung cấp",
  SUPPLIER_SHORTAGE_RESOLVED: "Đóng biên bản chênh lệch",
  PROCUREMENT_DOCUMENT_CREATED: "Tạo chứng từ",
  PROCUREMENT_DOCUMENT_ISSUED: "Phát hành chứng từ",
  PROCUREMENT_DOCUMENT_FILE_UPLOADED: "Tải phiên bản file",
  PROCUREMENT_DOCUMENT_SUPERSEDED: "Chứng từ bị thay thế",
  PROCUREMENT_DOCUMENT_CANCELLED: "Hủy chứng từ",
  PROCUREMENT_DOCUMENT_SHARED: "Chia sẻ chứng từ",
  PROCUREMENT_DOCUMENT_SHARE_FAILED: "Gửi chứng từ thất bại",
  PROCUREMENT_DOCUMENT_DOWNLOADED: "Tải xuống chứng từ",
  PROCUREMENT_DOCUMENT_ACKNOWLEDGED: "Xác nhận đã nhận chứng từ",
  PROCUREMENT_RECONCILIATION_COMPLETED: "Hoàn tất đối soát",
};

export function documentStatusMeta(status: string) {
  return DOCUMENT_STATUS[status] ?? { label: status, tone: "neutral" as Tone };
}
export function shareStatusMeta(status: string) {
  return SHARE_STATUS[status] ?? { label: status, tone: "neutral" as Tone };
}
export function reconciliationStatusMeta(status: string) {
  return RECONCILIATION_STATUS[status] ?? { label: status, tone: "neutral" as Tone };
}
export function supplierResponseMeta(status?: string | null) {
  if (!status) return null;
  return SUPPLIER_RESPONSE[status] ?? { label: status, tone: "neutral" as Tone };
}

export function formatBytes(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

export function formatMoney(value?: number | null) {
  if (value == null) return "-";
  return `${Number(value).toLocaleString("vi-VN")} ₫`;
}

export function formatDateTime(value?: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function formatDay(value?: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleDateString("vi-VN");
}

export const ACCEPTED_FILE_TYPES = ".pdf,.xml,.png,.jpg,.jpeg,application/pdf,application/xml,text/xml,image/png,image/jpeg";
