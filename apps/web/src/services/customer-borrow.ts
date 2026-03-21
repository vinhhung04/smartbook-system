import { gatewayAPI } from './http-clients';

export interface ReservationPayload {
  variant_id: string;
  warehouse_id: string;
  pickup_location_id?: string | null;
  quantity?: number;
  notes?: string;
}

export interface FinePaymentPayload {
  fine_id: string;
  amount?: number;
  payment_method?: 'CASH' | 'CARD' | 'TRANSFER' | 'EWALLET';
  transaction_reference?: string;
  note?: string;
}

export interface AccountTopupPayload {
  amount: number;
  note?: string;
}

export const customerBorrowService = {
  async getMyAccount() {
    const response = await gatewayAPI.get('/my/account');
    return response.data;
  },

  async topupMyAccount(payload: AccountTopupPayload) {
    const idempotencyKey = `c-topup-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const response = await gatewayAPI.post('/my/account/topup', payload, {
      headers: {
        'Idempotency-Key': idempotencyKey,
      },
    });
    return response.data;
  },

  async getMyAccountLedger(params?: { page?: number; pageSize?: number }) {
    const response = await gatewayAPI.get('/my/account/ledger', { params });
    return response.data;
  },

  async getMyReservations() {
    const response = await gatewayAPI.get('/my/reservations');
    return response.data;
  },

  async createReservation(payload: ReservationPayload) {
    const idempotencyKey = `c-resv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const response = await gatewayAPI.post('/my/reservations', payload, {
      headers: {
        'Idempotency-Key': idempotencyKey,
      },
    });
    return response.data;
  },

  async cancelReservation(id: string) {
    const idempotencyKey = `c-cancel-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const response = await gatewayAPI.patch(`/my/reservations/${id}/cancel`, {}, {
      headers: {
        'Idempotency-Key': idempotencyKey,
      },
    });
    return response.data;
  },

  async getMyLoans() {
    const response = await gatewayAPI.get('/my/loans');
    return response.data;
  },

  async getMyLoanById(id: string) {
    const response = await gatewayAPI.get(`/my/loans/${id}`);
    return response.data;
  },

  async requestLoanRenewal(id: string) {
    const response = await gatewayAPI.post(`/my/loans/${id}/renew-request`, {});
    return response.data;
  },

  async getMyFines() {
    const response = await gatewayAPI.get('/my/fines');
    return response.data;
  },

  async payFine(payload: FinePaymentPayload) {
    const response = await gatewayAPI.post('/my/fines/payments', payload);
    return response.data;
  },

  async getMyNotifications() {
    const response = await gatewayAPI.get('/my/notifications');
    return response.data;
  },
};
