// Vietnamese labels for purchase-order statuses and the supplier/receipt document
// statuses shown alongside them. Unknown values fall back to the raw code.
const PURCHASE_ORDER_STATUS_LABEL: Record<string, string> = {
  DRAFT: "Nháp",
  PENDING_APPROVAL: "Chờ duyệt",
  APPROVED: "Đã duyệt",
  SENT_TO_SUPPLIER: "Đã gửi NCC",
  SUPPLIER_CONFIRMED: "NCC đã xác nhận",
  PARTIALLY_RECEIVED: "Nhận một phần",
  SHORTAGE_REPORTED: "Báo thiếu hàng",
  RECEIVED: "Đã nhận",
  REJECTED: "Bị từ chối",
  CANCELLED: "Đã hủy",
  NOT_RECEIVED: "Chưa nhận",
  FULLY_RECEIVED: "Đã nhận đủ",
  OVER_RECEIVED: "Nhận dư",
  UNDER_RECEIVED: "Nhận thiếu",
  MATCHED: "Khớp",
  SENT: "Đã gửi",
  ACKNOWLEDGED: "Đã xác nhận",
  SUBMITTED: "Chờ nhận hàng",
  OPEN: "Mới",
  RESOLVED: "Đã xử lý",
  POSTED: "Đã ghi sổ",
  COMPLETED: "Hoàn tất",
  PENDING: "Đang chờ",
};

export function purchaseOrderStatusLabel(status?: string | null) {
  if (!status) return "-";
  return PURCHASE_ORDER_STATUS_LABEL[status] ?? status;
}
