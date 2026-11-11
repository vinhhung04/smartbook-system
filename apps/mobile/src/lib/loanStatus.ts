import type { LoanRenewalState, LoanStatus } from '../types/borrow';
import type { StampTone } from './reservationStatus';

const LOAN_STATUS_MAP: Record<LoanStatus, { label: string; tone: StampTone }> = {
  RESERVED: { label: 'Đã giữ chỗ', tone: 'primary' },
  BORROWED: { label: 'Đang mượn', tone: 'primary' },
  RETURNED: { label: 'Đã trả', tone: 'success' },
  OVERDUE: { label: 'Quá hạn', tone: 'danger' },
  LOST: { label: 'Đã báo mất', tone: 'danger' },
  DAMAGED: { label: 'Đã báo hư', tone: 'warning' },
  CANCELLED: { label: 'Đã hủy', tone: 'danger' },
};

export function getLoanStatusDisplay(status: LoanStatus) {
  return LOAN_STATUS_MAP[status];
}

// Mirrors apps/web/src/components/pages/customer/loan-detail.tsx canRequestRenewal.
export function canRequestRenewal(status: LoanStatus): boolean {
  return status === 'BORROWED' || status === 'OVERDUE';
}

export const DUE_SOON_DAYS = 3;

export type DueState = { kind: 'overdue' | 'soon' | 'ok' | 'closed'; daysLeft: number; label: string };

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfDay(time: number): number {
  const date = new Date(time);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/** How urgent a loan's due date is, counted in calendar days (a book due today is not overdue). */
export function getDueState(dueDate: string, status: LoanStatus, now = Date.now()): DueState {
  if (!canRequestRenewal(status)) return { kind: 'closed', daysLeft: 0, label: '' };
  const daysLeft = Math.round((startOfDay(new Date(dueDate).getTime()) - startOfDay(now)) / DAY_MS);
  if (status === 'OVERDUE' || daysLeft < 0) {
    const late = Math.max(1, -daysLeft);
    return { kind: 'overdue', daysLeft, label: `Quá hạn ${late} ngày` };
  }
  if (daysLeft === 0) return { kind: 'soon', daysLeft, label: 'Hết hạn hôm nay' };
  if (daysLeft <= DUE_SOON_DAYS) return { kind: 'soon', daysLeft, label: `Còn ${daysLeft} ngày` };
  return { kind: 'ok', daysLeft, label: `Còn ${daysLeft} ngày` };
}

export type RenewalView = { canRequest: boolean; note: string | null };

/** Whether the "Gia hạn" button is offered, and what to say about earlier requests. */
export function getRenewalView(status: LoanStatus, renewal: LoanRenewalState | undefined): RenewalView {
  if (!canRequestRenewal(status)) return { canRequest: false, note: null };
  if (renewal?.pending) return { canRequest: false, note: 'Đã gửi yêu cầu gia hạn — đang chờ thư viện duyệt.' };
  if (renewal?.last_decision === 'REJECT') return { canRequest: true, note: 'Yêu cầu gia hạn trước đã bị từ chối.' };
  if (renewal?.last_decision === 'APPROVE') return { canRequest: true, note: 'Đã được gia hạn trước đó.' };
  return { canRequest: true, note: null };
}
