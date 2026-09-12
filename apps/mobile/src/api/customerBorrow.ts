import { apiFetch } from './client';
import { createIdempotencyKey } from '../lib/idempotency';
import type {
  CreateReservationPayload,
  FinesResponse,
  Loan,
  PaginatedResponse,
  Reservation,
  ReservationStatus,
  VnpayPaymentIntentStatus,
} from '../types/borrow';

function idempotencyHeaders(prefix: string) {
  return { 'Idempotency-Key': createIdempotencyKey(prefix) };
}

// Gateway rewrites /my to borrow-service's /borrow/my — see services/borrow-service/src/controllers/my.controller.js.
export function getMyReservations(page = 1, pageSize = 20, status?: ReservationStatus) {
  const query = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
  if (status) query.set('status', status);
  return apiFetch<PaginatedResponse<Reservation>>(`/my/reservations?${query.toString()}`);
}

export function createMyReservation(payload: CreateReservationPayload) {
  return apiFetch<{ data: Reservation; idempotent?: boolean }>('/my/reservations', {
    method: 'POST',
    body: { ...payload, source_channel: 'MOBILE' },
    headers: idempotencyHeaders('resv'),
  });
}

// No GET /my/reservations/:id exists on the backend (see
// services/borrow-service/src/routes/my.routes.js) — a patron's reservation list
// is small enough that fetching one page and finding the row client-side is fine.
export async function getMyReservationById(id: string): Promise<Reservation | null> {
  const result = await getMyReservations(1, 100);
  return result.data.find((reservation) => reservation.id === id) ?? null;
}

export function cancelMyReservation(id: string) {
  return apiFetch<{ data: Reservation; idempotent?: boolean }>(`/my/reservations/${id}/cancel`, {
    method: 'PATCH',
    headers: idempotencyHeaders('resv-cancel'),
  });
}

export function getMyLoans(page = 1, pageSize = 20, status?: string) {
  const query = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
  if (status) query.set('status', status);
  return apiFetch<PaginatedResponse<Loan>>(`/my/loans?${query.toString()}`);
}

export function getMyLoanById(id: string) {
  return apiFetch<{ data: Loan }>(`/my/loans/${id}`);
}

export function requestMyLoanRenewal(id: string) {
  return apiFetch<{
    message: string;
    data: { loan_id: string; loan_number: string; requested_extension_days: number; request_status: string };
  }>(`/my/loans/${id}/renew-request`, {
    method: 'POST',
    headers: idempotencyHeaders('renew'),
  });
}

export function getMyFines() {
  return apiFetch<{ data: FinesResponse }>('/my/fines');
}

export function createVnpayFinePayment(fineId: string) {
  return apiFetch<{
    message: string;
    data: { payment_url: string; txn_ref: string; amount: number; expires_at: string };
  }>('/my/fines/payments/vnpay/create', {
    method: 'POST',
    body: { fine_id: fineId },
  });
}

export function getVnpayFinePaymentStatus(txnRef: string) {
  return apiFetch<{
    data: { status: VnpayPaymentIntentStatus; fine_id: string; amount: number };
  }>(`/my/fines/payments/vnpay/status/${encodeURIComponent(txnRef)}`);
}
