import { Clock, UserX } from 'lucide-react';
import type { RiskDomainConfig } from './risk-workspace';

// Shared by /reorder-suggestions (full workspace) and /dashboard (AI risk block).
export const LATE_RETURN: RiskDomainConfig = {
  id: 'late-return',
  icon: Clock,
  title: 'Rủi ro trả trễ',
  modelSummary: 'Mô hình hồi quy logistic ước tính khả năng một khoản mượn đang mở sẽ được trả sau hạn, học từ lịch sử mượn/trả của thư viện.',
  subjectNoun: 'khoản mượn',
  eventNoun: 'trả trễ',
  fromLabel: 'Mượn',
  toLabel: 'Hạn trả',
  pastDueLabel: 'Đã quá hạn trả',
  factorLabels: {
    loan_days: 'Số ngày được mượn',
    items_in_loan: 'Số đầu sách trong phiếu',
    prior_loans: 'Số lần mượn trước đây',
    prior_late_rate: 'Tỷ lệ trả trễ trước đây',
    prior_late_count: 'Số lần trả trễ trước đây',
    prior_renewal_rate: 'Tỷ lệ gia hạn trước đây',
    customer_tenure_days: 'Thời gian là thành viên',
    unpaid_fines_at_checkout: 'Tiền phạt chưa thanh toán',
    plan_max_loan_days: 'Hạn mượn theo gói thành viên',
    plan_fine_per_day: 'Mức phạt/ngày theo gói',
    from_reservation: 'Mượn từ đặt chỗ trước',
    condition_worn_at_checkout: 'Tình trạng sách khi mượn',
  },
  needs: 'Mô hình sẽ tự huấn luyện khi có thêm các khoản mượn đã kết thúc (đã trả, đúng hạn hoặc trễ hạn).',
  emptyTitle: 'Không có khoản mượn nào đang mở',
  emptyText: 'Mô hình đã sẵn sàng nhưng hiện không có khoản mượn nào cần chấm điểm rủi ro trả trễ.',
};

export const NO_SHOW: RiskDomainConfig = {
  id: 'no-show',
  icon: UserX,
  title: 'Rủi ro bỏ lỡ đặt chỗ',
  modelSummary: 'Mô hình hồi quy logistic ước tính khả năng một đặt chỗ đang chờ sẽ hết hạn giữ mà bạn đọc không đến nhận sách.',
  subjectNoun: 'đặt chỗ',
  eventNoun: 'bỏ lỡ',
  fromLabel: 'Đặt lúc',
  toLabel: 'Hết hạn giữ',
  pastDueLabel: 'Đã hết hạn giữ',
  factorLabels: {
    hold_hours: 'Thời gian giữ chỗ',
    lead_hours: 'Thời gian đặt trước',
    quantity: 'Số lượng đặt',
    channel_web: 'Kênh đặt qua web',
    prior_reservations: 'Số lần đặt chỗ trước đây',
    prior_no_show_rate: 'Tỷ lệ bỏ lỡ trước đây',
    customer_tenure_days: 'Thời gian là thành viên',
    unpaid_fines_at_reservation: 'Tiền phạt chưa thanh toán',
    active_loans_at_reservation: 'Số phiếu đang mượn',
  },
  needs: 'Mô hình sẽ tự huấn luyện khi có thêm các đặt chỗ đã kết thúc (đã nhận sách hoặc hết hạn).',
  emptyTitle: 'Không có đặt chỗ nào đang chờ nhận',
  emptyText: 'Mô hình đã sẵn sàng nhưng hiện không có đặt chỗ nào cần chấm điểm rủi ro bỏ lỡ.',
};
