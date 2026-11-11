import { apiFetch } from './client';
import { createIdempotencyKey } from '../lib/idempotency';
import type {
  BorrowListScope,
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

type ListFilter = { scope?: BorrowListScope; status?: ReservationStatus | string };

function listQuery(page: number, pageSize: number, filter: ListFilter = {}) {
  const query = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
  if (filter.status) query.set('status', filter.status);
  else if (filter.scope) query.set('scope', filter.scope);
  return query.toString();
}

// Gateway rewrites /my to borrow-service's /borrow/my — see services/borrow-service/src/controllers/my.controller.js.
export function getMyReservations(page = 1, pageSize = 20, filter: ListFilter = {}) {
  return apiFetch<PaginatedResponse<Reservation>>(`/my/reservations?${listQuery(page, pageSize, filter)}`);
}

export function createMyReservation(payload: CreateReservationPayload) {
  return apiFetch<{ data: Reservation; idempotent?: boolean }>('/my/reservations', {
    method: 'POST',
    body: { ...payload, source_channel: 'MOBILE' },
    headers: idempotencyHeaders('resv'),
  });
}

/** Any reservation of the signed-in reader by id (ownership checked server-side), however old. */
export function getMyReservationById(id: string) {
  return apiFetch<{ data: Reservation }>(`/my/reservations/${encodeURIComponent(id)}`);
}

export function cancelMyReservation(id: string) {
  return apiFetch<{ data: Reservation; idempotent?: boolean }>(`/my/reservations/${id}/cancel`, {
    method: 'PATCH',
    headers: idempotencyHeaders('resv-cancel'),
  });
}

export function getMyLoans(page = 1, pageSize = 20, filter: ListFilter = {}) {
  return apiFetch<PaginatedResponse<Loan>>(`/my/loans?${listQuery(page, pageSize, filter)}`);
}

export function getMyLoanById(id: string) {
  return apiFetch<{ data: Loan }>(`/my/loans/${encodeURIComponent(id)}`);
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
