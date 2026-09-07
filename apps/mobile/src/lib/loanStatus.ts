import type { LoanStatus } from '../types/borrow';
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
