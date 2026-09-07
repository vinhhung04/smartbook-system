import type { ReservationStatus } from '../types/borrow';

export type StampTone = 'success' | 'danger' | 'warning' | 'primary';

const RESERVATION_STATUS_MAP: Record<ReservationStatus, { label: string; tone: StampTone }> = {
  PENDING: { label: 'Chờ xác nhận', tone: 'warning' },
  CONFIRMED: { label: 'Đã xác nhận', tone: 'primary' },
  READY_FOR_PICKUP: { label: 'Sẵn sàng nhận', tone: 'success' },
  CONVERTED_TO_LOAN: { label: 'Đã nhận sách', tone: 'primary' },
  CANCELLED: { label: 'Đã hủy', tone: 'danger' },
  EXPIRED: { label: 'Hết hạn', tone: 'danger' },
};

export function getReservationStatusDisplay(status: ReservationStatus) {
  return RESERVATION_STATUS_MAP[status];
}

// Customer can only cancel while the hold hasn't been picked up, cancelled or
// expired yet — mirrors the guard in services/borrow-service reservation.controller.js.
export function canCancelReservation(status: ReservationStatus): boolean {
  return status === 'PENDING' || status === 'CONFIRMED' || status === 'READY_FOR_PICKUP';
}
