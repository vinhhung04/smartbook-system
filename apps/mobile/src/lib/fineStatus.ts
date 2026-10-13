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

// Same wording as the web's fine-type labels (apps/web/src/lib/status-registry.ts). Seed data
// uses both DAMAGE and DAMAGED for the same reason.
const FINE_TYPE_LABELS: Record<string, string> = {
  OVERDUE: 'Trả trễ',
  LOST: 'Mất sách',
  DAMAGED: 'Hư hỏng',
  DAMAGE: 'Hư hỏng',
};

export function getFineTypeLabel(fineType: string): string {
  return FINE_TYPE_LABELS[fineType] ?? fineType;
}

export function canPayFine(status: FineStatus): boolean {
  return status === 'UNPAID' || status === 'PARTIALLY_PAID';
}
