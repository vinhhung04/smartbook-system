import type { ChannelType, DeliveryStatus, IncidentCategory, IncidentSeverity, IncidentStatus } from '@/services/incidents';

export const SEVERITY_META: Record<IncidentSeverity, { label: string; badge: string; dot: string; rank: number }> = {
  CRITICAL: { label: 'Nghiêm trọng', badge: 'border-red-200 bg-red-50 text-red-800 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300', dot: 'bg-red-600', rank: 3 },
  HIGH: { label: 'Cao', badge: 'border-orange-200 bg-orange-50 text-orange-800 dark:border-orange-500/30 dark:bg-orange-500/10 dark:text-orange-300', dot: 'bg-orange-500', rank: 2 },
  WARNING: { label: 'Cảnh báo', badge: 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300', dot: 'bg-amber-500', rank: 1 },
  INFO: { label: 'Thông tin', badge: 'border-border bg-muted text-muted-foreground', dot: 'bg-slate-400', rank: 0 },
};

export const STATUS_LABEL: Record<IncidentStatus, string> = { OPEN: 'Đang mở', ACKNOWLEDGED: 'Đã tiếp nhận', RESOLVED: 'Đã xử lý' };
export const STATUS_STYLE: Record<IncidentStatus, string> = {
  OPEN: 'border-red-200 text-red-800 dark:border-red-500/30 dark:text-red-300',
  ACKNOWLEDGED: 'border-amber-200 text-amber-800 dark:border-amber-500/30 dark:text-amber-300',
  RESOLVED: 'border-emerald-200 text-emerald-800 dark:border-emerald-500/30 dark:text-emerald-300',
};
export const CATEGORY_LABEL: Record<IncidentCategory, string> = { TECHNICAL: 'Kỹ thuật', BUSINESS: 'Nghiệp vụ', INFO: 'Thông tin' };
export const CHANNEL_LABEL: Record<ChannelType, string> = { EMAIL: 'Email', IN_APP: 'Trong ứng dụng', WEBHOOK: 'Webhook' };
export const DELIVERY_LABEL: Record<DeliveryStatus, string> = { PENDING: 'Chờ gửi', SENDING: 'Đang gửi', RETRY: 'Chờ thử lại', SENT: 'Đã gửi', DEAD: 'Thất bại', SUPPRESSED: 'Bị chặn' };

export const EVENT_LABEL: Record<string, string> = {
  DETECTED: 'Phát hiện sự cố',
  DETECTED_LATE: 'Ghi nhận muộn',
  REOPENED: 'Sự cố tái diễn',
  SEVERITY_ESCALATED: 'Mức độ tăng',
  ACKNOWLEDGED: 'Đã tiếp nhận',
  NOTE: 'Ghi chú',
  RESOLVED: 'Đã xử lý thủ công',
  AUTO_RESOLVED: 'Tự phục hồi',
  NOTIFICATION_SUPPRESSED: 'Không gửi thông báo',
  NOTIFICATION_SKIPPED: 'Không có kênh nhận',
  DELIVERY_FAILED: 'Gửi thông báo thất bại',
};

export const SUPPRESS_REASON: Record<string, string> = {
  COOLDOWN: 'đang trong thời gian chờ giữa hai lần báo',
  INHIBITED: 'dịch vụ đang có sự cố mất kết nối (chặn cảnh báo phụ thuộc)',
  NO_POLICY: 'không có chính sách nào khớp',
  NO_ENABLED_CHANNEL: 'chính sách không có kênh nào đang bật',
};

const dateTime = new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const fullDateTime = new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'medium' });

export function formatDateTime(value?: string | null, full = false) {
  if (!value) return '—';
  return (full ? fullDateTime : dateTime).format(new Date(value));
}

/** "3 giờ 12 phút" — for durations and MTTA/MTTR. */
export function formatDuration(seconds: number | null | undefined) {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return null;
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s} giây`;
  const minutes = Math.floor(s / 60);
  if (minutes < 60) return `${minutes} phút`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} giờ ${minutes % 60} phút`;
  return `${Math.floor(hours / 24)} ngày ${hours % 24} giờ`;
}

/** How long an incident has been (or was) open. */
export function incidentAge(incident: { first_seen_at: string; resolved_at: string | null }, now = Date.now()) {
  const end = incident.resolved_at ? new Date(incident.resolved_at).getTime() : now;
  return formatDuration((end - new Date(incident.first_seen_at).getTime()) / 1000) || '—';
}
