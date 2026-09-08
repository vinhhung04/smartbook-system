// Shared label maps for AI-proposed actions — previously duplicated verbatim
// between ai-action-card.tsx (the inline chat card) and ai-action-center.tsx
// (the audit-log tab), with real risk of drifting apart like their color
// maps had. See status-registry.ts for the paired Tone domains.

export const AI_ACTION_TYPE_LABEL: Record<string, string> = {
  CREATE_REORDER_DRAFT: 'Đề xuất nhập sách',
  CREATE_REPORT_DRAFT: 'Tạo báo cáo',
  CREATE_RESERVATION_DRAFT: 'Đặt chỗ sách',
  CREATE_STOCK_ALERT: 'Cảnh báo tồn kho',
  CREATE_STAFF_TASK_DRAFT: 'Task cho staff',
};

export const AI_ACTION_STATUS_LABEL: Record<string, string> = {
  PENDING_CONFIRMATION: 'Chờ xác nhận',
  EXECUTED: 'Đã thực thi',
  CANCELLED: 'Đã hủy',
  EXPIRED: 'Hết hạn',
  FAILED: 'Thất bại',
};
