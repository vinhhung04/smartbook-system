/** Vietnamese names for borrow-service audit action codes (/audit-trail, /dashboard activity feed). */
// Codes written by borrow-service (src/lib/audit.js callers); unknown codes still show as-is.
export const ACTION_LABELS: Record<string, string> = {
  CREATE_CUSTOMER: 'Tạo khách hàng',
  UPDATE_CUSTOMER: 'Cập nhật khách hàng',
  AUTO_ASSIGN_CUSTOMER_MEMBERSHIP: 'Tự gán gói hội viên',
  RENEW_CUSTOMER_MEMBERSHIP: 'Gia hạn gói hội viên',
  COUNTER_WALLET_TOPUP: 'Nạp ví tại quầy',
  CUSTOMER_WALLET_TOPUP_VNPAY: 'Nạp ví qua VNPay',
  CREATE_RESERVATION: 'Tạo đặt trước',
  CONFIRM_RESERVATION: 'Xác nhận đặt trước',
  MARK_RESERVATION_READY: 'Báo sách sẵn sàng',
  CANCEL_RESERVATION: 'Hủy đặt trước',
  ROLLBACK_CANCEL_RESERVATION: 'Hoàn tác hủy đặt trước',
  EXPIRE_RESERVATION: 'Đặt trước hết hạn',
  CONVERT_RESERVATION_TO_LOAN: 'Chuyển đặt trước thành phiếu mượn',
  CREATE_DIRECT_LOAN: 'Cho mượn trực tiếp',
  HOLD_LOAN_DEPOSITS: 'Giữ tiền cọc',
  SETTLE_LOAN_DEPOSIT: 'Tất toán tiền cọc',
  RETURN_LOAN_ITEMS: 'Trả sách',
  MARK_ITEM_OVERDUE: 'Đánh dấu quá hạn',
  REQUEST_LOAN_RENEWAL: 'Xin gia hạn',
  APPROVE_LOAN_RENEWAL: 'Duyệt gia hạn',
  REJECT_LOAN_RENEWAL: 'Từ chối gia hạn',
  GENERATE_RETURN_FINES: 'Tạo tiền phạt khi trả',
  PAY_FINE: 'Thanh toán tiền phạt',
  STAFF_PAY_FINE: 'Thu tiền phạt tại quầy',
  CUSTOMER_PAY_FINE_VNPAY: 'Thanh toán phạt qua VNPay',
  WAIVE_FINE: 'Miễn giảm tiền phạt',
};

export function actionLabel(code: string) {
  return ACTION_LABELS[code] ?? code;
}

export const ENTITY_LABELS: Record<string, string> = {
  LOAN_TRANSACTION: 'Phiếu mượn',
  LOAN_ITEM: 'Sách trong phiếu mượn',
  RESERVATION: 'Đặt trước',
  FINE: 'Tiền phạt',
  CUSTOMER: 'Khách hàng',
};
