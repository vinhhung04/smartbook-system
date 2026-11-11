// Shared label maps for AI-proposed actions — previously duplicated verbatim
// between ai-action-card.tsx (the inline chat card) and ai-action-center.tsx
// (the audit-log tab), with real risk of drifting apart like their color
// maps had. See status-registry.ts for the paired Tone domains.

export const AI_ACTION_TYPE_LABEL: Record<string, string> = {
  CREATE_REORDER_DRAFT: 'Đề xuất nhập sách',
  CREATE_REPORT_DRAFT: 'Tạo báo cáo',
  CREATE_RESERVATION_DRAFT: 'Đặt trước sách',
  CREATE_STOCK_ALERT: 'Cảnh báo tồn kho',
  CREATE_STAFF_TASK_DRAFT: 'Nhiệm vụ kho',
};

export const AI_ACTION_STATUS_LABEL: Record<string, string> = {
  PENDING_CONFIRMATION: 'Cần xác nhận',
  CONFIRMED: 'Đang thực thi',
  EXECUTED: 'Đã thực thi',
  CANCELLED: 'Đã từ chối',
  EXPIRED: 'Hết hạn',
  FAILED: 'Thất bại',
};

export const AI_ACTION_RISK_LABEL: Record<string, string> = {
  LOW: 'Rủi ro thấp',
  MEDIUM: 'Rủi ro vừa',
  HIGH: 'Rủi ro cao',
};

/** Audit trail events written by the ai-service for each lifecycle step. */
export const AI_AUDIT_EVENT_LABEL: Record<string, string> = {
  CREATED: 'AI tạo đề xuất',
  CONFIRMED: 'Đã xác nhận',
  EXECUTED: 'Đã thực thi',
  CANCELLED: 'Đã từ chối',
  EXPIRED: 'Hết hạn',
  FAILED: 'Thực thi thất bại',
};
