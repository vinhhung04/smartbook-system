import type { FineStatus } from '../types/borrow';
import type { StampTone } from './reservationStatus';

const FINE_STATUS_MAP: Record<FineStatus, { label: string; tone: StampTone }> = {
  UNPAID: { label: 'Chưa trả', tone: 'danger' },
  PARTIALLY_PAID: { label: 'Trả một phần', tone: 'warning' },
  PAID: { label: 'Đã trả', tone: 'success' },
  WAIVED: { label: 'Đã miễn', tone: 'primary' },
};

export function getFineStatusDisplay(status: FineStatus) {
  return FINE_STATUS_MAP[status];
}

export function canPayFine(status: FineStatus): boolean {
  return status === 'UNPAID' || status === 'PARTIALLY_PAID';
}
