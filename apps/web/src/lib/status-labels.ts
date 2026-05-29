export const STATUS_LABELS: Record<string, string> = {
  // General
  PENDING: 'Chờ xử lý',
  PENDING_APPROVAL: 'Chờ duyệt',
  APPROVED: 'Đã duyệt',
  REJECTED: 'Từ chối',
  DRAFT: 'Bản nháp',
  POSTED: 'Đã ghi nhận',
  CANCELLED: 'Đã hủy',
  COMPLETED: 'Hoàn tất',
  CONFIRMED: 'Đã xác nhận',
  REQUESTED: 'Đã yêu cầu',
  OPEN: 'Đang mở',
  IN_PROGRESS: 'Đang xử lý',
  DONE: 'Hoàn tất',
  // Picking / Warehouse
  PICKING: 'Đang lấy hàng',
  REPICKING: 'Đang lấy bù',
  PARTIAL_PICKED: 'Lấy một phần',
  READY_FOR_OUTBOUND: 'Sẵn sàng xuất',
  READY_TO_SHIP: 'Sẵn sàng gửi',
  IN_TRANSIT: 'Đang vận chuyển',
  RECEIVED: 'Đã nhận hàng',
  // Borrow / Library
  ACTIVE: 'Đang mượn',
  OVERDUE: 'Quá hạn',
  RETURNED: 'Đã trả',
  READY_FOR_PICKUP: 'Sẵn sàng nhận sách',
  // Purchase / Supplier
  SHORTAGE_REPORTED: 'Đã báo thiếu',
  SENT_TO_SUPPLIER: 'Đã gửi NCC',
  SUPPLIER_CONFIRMED: 'NCC đã xác nhận',
  PARTIALLY_RECEIVED: 'Nhận một phần',
  // Fines
  UNPAID: 'Chưa thanh toán',
  PAID: 'Đã thanh toán',
  WAIVED: 'Đã miễn',
  PARTIALLY_PAID: 'Thanh toán một phần',
  // Staff Task
  LOW: 'Thấp',
  MEDIUM: 'Trung bình',
  HIGH: 'Cao',
  URGENT: 'Khẩn cấp',
  // Reservation
  OUT_OF_STOCK: 'Hết hàng',
};

export const STATUS_VARIANT: Record<string, string> = {
  // success
  APPROVED: 'success',
  COMPLETED: 'success',
  DONE: 'success',
  POSTED: 'success',
  RECEIVED: 'success',
  PAID: 'success',
  RETURNED: 'success',
  ACTIVE: 'success',
  CONFIRMED: 'success',
  // info
  IN_PROGRESS: 'info',
  PICKING: 'info',
  IN_TRANSIT: 'info',
  SENT_TO_SUPPLIER: 'info',
  PARTIALLY_RECEIVED: 'info',
  // warning
  PENDING: 'warning',
  PENDING_APPROVAL: 'warning',
  DRAFT: 'warning',
  OPEN: 'warning',
  READY_FOR_OUTBOUND: 'warning',
  READY_TO_SHIP: 'warning',
  REQUESTED: 'warning',
  PARTIALLY_PAID: 'amber',
  // teal / cyan
  READY_FOR_PICKUP: 'cyan',
  SUPPLIER_CONFIRMED: 'teal',
  // amber
  PARTIAL_PICKED: 'amber',
  REPICKING: 'amber',
  // danger
  REJECTED: 'danger',
  CANCELLED: 'danger',
  SHORTAGE_REPORTED: 'danger',
  OVERDUE: 'danger',
  UNPAID: 'danger',
  // neutral
  WAIVED: 'neutral',
  OUT_OF_STOCK: 'neutral',
  LOW: 'neutral',
  MEDIUM: 'info',
  HIGH: 'warning',
  URGENT: 'danger',
};

export function getStatusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}

export function getStatusVariant(status: string): string {
  return STATUS_VARIANT[status] ?? 'neutral';
}
