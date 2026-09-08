// Mirrors apps/web/src/services/borrow.ts (Reservation/Loan/Fine section) exactly —
// /my/* endpoints in borrow-service query the same Prisma tables without remapping,
// so the customer-facing response shape is field-identical to the staff-facing one.
export type ReservationStatus =
  | 'PENDING'
  | 'CONFIRMED'
  | 'READY_FOR_PICKUP'
  | 'CANCELLED'
  | 'EXPIRED'
  | 'CONVERTED_TO_LOAN';

export type ReservationSource = 'WEB' | 'MOBILE' | 'COUNTER' | 'ADMIN';

export type LoanStatus = 'RESERVED' | 'BORROWED' | 'RETURNED' | 'OVERDUE' | 'LOST' | 'CANCELLED' | 'DAMAGED';

export type FineStatus = 'UNPAID' | 'PARTIALLY_PAID' | 'PAID' | 'WAIVED';

export type FinePaymentMethod = 'CASH' | 'CARD' | 'TRANSFER' | 'EWALLET';

export type Reservation = {
  id: string;
  reservation_number: string;
  customer_id: string;
  variant_id: string;
  warehouse_id: string;
  pickup_location_id: string | null;
  quantity: number;
  source_channel: ReservationSource;
  status: ReservationStatus;
  reserved_at: string;
  expires_at: string;
  pickup_code: string | null;
  pickup_code_issued_at: string | null;
  pickup_code_expires_at: string | null;
  pickup_code_used_at: string | null;
  notes: string | null;
  created_at?: string;
  updated_at: string;
};

export type CreateReservationPayload = {
  variant_id: string;
  warehouse_id: string;
  pickup_location_id?: string;
  quantity?: number;
  notes?: string;
};

export type LoanItem = {
  id: string;
  loan_id: string;
  variant_id: string;
  item_barcode: string | null;
  due_date: string;
  return_date: string | null;
  status: string;
  item_condition_on_checkout: string;
  item_condition_on_return: string | null;
  fine_amount: number;
  lost_fee_amount: number;
  notes: string | null;
};

export type Loan = {
  id: string;
  loan_number: string;
  customer_id: string;
  warehouse_id: string;
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
};

export type RenewLoanResult = {
  request_id: string;
  status: string;
  requested_at: string;
};

export type FinePayment = {
  id: string;
  fine_id: string;
  payment_method: FinePaymentMethod | string;
  amount: number;
  transaction_reference: string | null;
  paid_at: string;
  note: string | null;
};

export type Fine = {
  id: string;
  customer_id: string;
  loan_item_id: string | null;
  fine_type: string;
  amount: number;
  waived_amount: number;
  status: FineStatus;
  issued_at: string;
  paid_at: string | null;
  note: string | null;
  fine_payments?: FinePayment[];
};

export type FinesResponse = {
  customer_id: string;
  total_fine_balance: number;
  fines: Fine[];
  fine_payments: FinePayment[];
};

export type PayFinePayload = {
  fine_id: string;
  amount?: number;
  payment_method: FinePaymentMethod;
  transaction_reference?: string;
  note?: string;
};

export type PaginatedResponse<T> = {
  data: T[];
  meta: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
};
