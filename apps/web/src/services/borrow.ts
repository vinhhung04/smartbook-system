import { inventoryAPI } from './http-clients';

export type CustomerStatus = 'ACTIVE' | 'SUSPENDED' | 'BLOCKED' | 'INACTIVE';
export type ReservationStatus = 'PENDING' | 'CONFIRMED' | 'READY_FOR_PICKUP' | 'CANCELLED' | 'EXPIRED' | 'CONVERTED_TO_LOAN';
export type ReservationSource = 'WEB' | 'MOBILE' | 'COUNTER' | 'ADMIN';
export type LoanStatus = 'RESERVED' | 'BORROWED' | 'RETURNED' | 'OVERDUE' | 'LOST' | 'CANCELLED' | 'DAMAGED';

export interface Customer {
  id: string;
  customer_code: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  birth_date: string | null;
  address: string | null;
  status: CustomerStatus;
  total_fine_balance: number;
  created_at: string;
  updated_at: string;
}

export interface CustomerPayload {
  full_name: string;
  email?: string;
  phone?: string;
  birth_date?: string;
  address?: string;
  status?: CustomerStatus;
}

export interface MembershipEligibility {
  customer_id: string;
  membership_id: string;
  plan_id: string;
  plan_code: string;
  plan_name: string;
  limits: {
    max_active_loans: number;
    max_loan_days: number;
    max_renewal_count: number;
    reservation_hold_hours: number;
    fine_per_day: number;
    lost_item_fee_multiplier: number;
  };
  active_loan_count: number;
  remaining_loan_slots: number;
  outstanding_fine_balance: number;
}

export interface Reservation {
  id: string;
  reservation_number: string;
  customer_id: string;
  variant_id: string;
  inventory_unit_id: string | null;
  warehouse_id: string;
  pickup_location_id: string | null;
  quantity: number;
  source_channel: ReservationSource;
  status: ReservationStatus;
  reserved_at: string;
  expires_at: string;
  notes: string | null;
  created_by_user_id: string | null;
  updated_at: string;
  customers?: {
    id: string;
    customer_code: string;
    full_name: string;
    status: CustomerStatus;
    email?: string;
    phone?: string;
  };
}

export interface ReservationPayload {
  customer_id: string;
  variant_id: string;
  warehouse_id: string;
  pickup_location_id?: string;
  quantity: number;
  source_channel?: ReservationSource;
  notes?: string;
}

export interface VariantLookupItem {
  id: string;
  title: string;
  sku: string;
  isbn: string | null;
  internal_barcode: string | null;
}

export interface WarehouseLookupItem {
  id: string;
  name: string;
  code: string;
  warehouse_type: string;
}

export interface LoanItem {
  id: string;
  loan_id: string;
  variant_id: string;
  inventory_unit_id: string | null;
  item_barcode: string | null;
  due_date: string;
  return_date: string | null;
  returned_to_warehouse_id: string | null;
  returned_to_location_id: string | null;
  status: string;
  item_condition_on_checkout: string;
  item_condition_on_return: string | null;
  fine_amount: number;
  lost_fee_amount: number;
  notes: string | null;
}

export interface Loan {
  id: string;
  loan_number: string;
  customer_id: string;
  warehouse_id: string;
  handled_by_user_id: string;
  source_reservation_id: string | null;
  borrow_date: string;
  due_date: string;
  closed_at: string | null;
  status: LoanStatus;
  total_items: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
  loan_items?: LoanItem[];
  customers?: {
    id: string;
    customer_code: string;
    full_name: string;
    status: CustomerStatus;
    email?: string;
    phone?: string;
  };
}

export interface RenewalRequest {
  request_id: string;
  status: string;
  requested_at: string;
  reviewed_at: string | null;
  requested_extension_days: number | null;
  metadata: Record<string, unknown>;
  customer: {
    id: string;
    customer_code: string;
    full_name: string;
    status: CustomerStatus;
  } | null;
  loan: Loan | null;
}

export interface FinePayment {
  id: string;
  fine_id: string;
  payment_method: string;
  amount: number;
  transaction_reference: string | null;
  paid_by_user_id: string | null;
  paid_at: string;
  note: string | null;
}

export interface FineSummary {
  paid_amount: number;
  remaining_balance: number;
}

export interface Fine {
  id: string;
  customer_id: string;
  loan_item_id: string | null;
  fine_type: string;
  amount: number;
  waived_amount: number;
  status: string;
  issued_by_user_id: string | null;
  issued_at: string;
  paid_at: string | null;
  waived_by_user_id: string | null;
  note: string | null;
  customers?: {
    id: string;
    customer_code: string;
    full_name: string;
    status: CustomerStatus;
    total_fine_balance?: number;
  };
  fine_payments?: FinePayment[];
  summary?: FineSummary;
}

export interface PaginatedResponse<T> {
  data: T[];
  meta: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}

function createIdempotencyHeaders(idempotencyKey?: string) {
  const generated = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

  return {
    'Idempotency-Key': idempotencyKey || generated,
  };
}

export const borrowService = {
  getCustomers: async (params?: Record<string, unknown>) => {
    const response = await inventoryAPI.get('/borrow/customers', { params });
    return response.data as PaginatedResponse<Customer>;
  },

  getCustomerById: async (id: string) => {
    const response = await inventoryAPI.get(`/borrow/customers/${id}`);
    return response.data as { data: Customer };
  },

  createCustomer: async (payload: CustomerPayload) => {
    const response = await inventoryAPI.post('/borrow/customers', payload);
    return response.data as { data: Customer };
  },

  updateCustomer: async (id: string, payload: CustomerPayload) => {
    const response = await inventoryAPI.patch(`/borrow/customers/${id}`, payload);
    return response.data as { data: Customer };
  },

  getActiveMembership: async (id: string) => {
    const response = await inventoryAPI.get(`/borrow/customers/${id}/membership/active`);
    return response.data as { data: MembershipEligibility };
  },

  getReservations: async (params?: Record<string, unknown>) => {
    const response = await inventoryAPI.get('/borrow/reservations', { params });
    return response.data as PaginatedResponse<Reservation>;
  },

  searchVariants: async (params?: Record<string, unknown>) => {
    const response = await inventoryAPI.get('/api/borrow-integration/variants/search', { params });
    return response.data as { data: VariantLookupItem[] };
  },

  searchWarehouses: async (params?: Record<string, unknown>) => {
    const response = await inventoryAPI.get('/api/borrow-integration/warehouses', { params });
    return response.data as { data: WarehouseLookupItem[] };
  },

  getReservationById: async (id: string) => {
    const response = await inventoryAPI.get(`/borrow/reservations/${id}`);
    return response.data as { data: Reservation };
  },

  createReservation: async (payload: ReservationPayload) => {
    const response = await inventoryAPI.post('/borrow/reservations', payload, {
      headers: createIdempotencyHeaders(),
    });
    return response.data as { data: Reservation };
  },

  cancelReservation: async (id: string, idempotencyKey?: string) => {
    const response = await inventoryAPI.patch(`/borrow/reservations/${id}/cancel`, {}, {
      headers: createIdempotencyHeaders(idempotencyKey),
    });
    return response.data as { data: Reservation };
  },

  convertReservationToLoan: async (reservationId: string, idempotencyKey?: string) => {
    const response = await inventoryAPI.post(`/borrow/reservations/${reservationId}/convert-to-loan`, {}, {
      headers: createIdempotencyHeaders(idempotencyKey),
    });
    return response.data as { data: Loan; idempotent?: boolean };
  },

  createDirectLoan: async (payload: ReservationPayload, idempotencyKey?: string) => {
    const response = await inventoryAPI.post('/borrow/loans/direct', payload, {
      headers: createIdempotencyHeaders(idempotencyKey),
    });
    return response.data as { data: Loan; idempotent?: boolean };
  },

  getLoans: async (params?: Record<string, unknown>) => {
    const response = await inventoryAPI.get('/borrow/loans', { params });
    return response.data as PaginatedResponse<Loan>;
  },

  getRenewalRequests: async (params?: Record<string, unknown>) => {
    const response = await inventoryAPI.get('/borrow/loans/renewal-requests', { params });
    return response.data as PaginatedResponse<RenewalRequest>;
  },

  reviewLoanRenewal: async (loanId: string, payload: { decision: 'APPROVE' | 'REJECT'; extension_days?: number; reason?: string }) => {
    const response = await inventoryAPI.post(`/borrow/loans/${loanId}/renewals/review`, payload);
    return response.data as {
      message: string;
      data: {
        loan_id: string;
        request_id: string;
        decision: 'APPROVE' | 'REJECT';
        extension_days: number | null;
        due_date: string;
      };
    };
  },

  getLoanById: async (id: string) => {
    const response = await inventoryAPI.get(`/borrow/loans/${id}`);
    return response.data as { data: Loan };
  },

  returnLoan: async (id: string, payload?: { loan_item_id?: string; returned_to_location_id?: string; item_condition_on_return?: string; notes?: string; mark_lost?: boolean }, idempotencyKey?: string) => {
    const response = await inventoryAPI.post(`/borrow/loans/${id}/return`, payload || {}, {
        headers: createIdempotencyHeaders(idempotencyKey),
      });
    return response.data as { data: Loan };
  },

  getFines: async (params?: Record<string, unknown>) => {
    const response = await inventoryAPI.get('/borrow/fines', { params });
    return response.data as PaginatedResponse<Fine>;
  },

  getFineById: async (id: string) => {
    const response = await inventoryAPI.get(`/borrow/fines/${id}`);
    return response.data as { data: Fine };
  },

  recordFinePayment: async (id: string, payload: { amount: number; payment_method: 'CASH' | 'CARD' | 'TRANSFER' | 'EWALLET'; transaction_reference?: string; note?: string }) => {
    const response = await inventoryAPI.post(`/borrow/fines/${id}/payments`, payload);
    return response.data as {
      message: string;
      data: {
        fine_id: string;
        payment_id: string;
        paid_amount: number;
        remaining_balance: number;
        status: string;
        total_fine_balance: number;
      };
    };
  },

  getMembershipPlans: async () => {
    const response = await inventoryAPI.get('/borrow/membership-plans');
    return response.data;
  },

  createMembershipPlan: async (payload: Record<string, unknown>) => {
    const response = await inventoryAPI.post('/borrow/membership-plans', payload);
    return response.data;
  },

  updateMembershipPlan: async (id: string, payload: Record<string, unknown>) => {
    const response = await inventoryAPI.patch(`/borrow/membership-plans/${id}`, payload);
    return response.data;
  },

  sendNotificationToCustomer: async (payload: { customer_id: string; subject: string; body: string }) => {
    const response = await inventoryAPI.post('/borrow/notifications/send', payload);
    return response.data;
  },

  waiveFine: async (id: string, payload: { amount?: number; note?: string }) => {
    const response = await inventoryAPI.patch(`/borrow/fines/${id}/waive`, payload);
    return response.data as {
      message: string;
      data: {
        fine_id: string;
        waived_amount: number;
        remaining_balance: number;
        status: string;
        total_fine_balance: number;
      };
    };
  },
};
