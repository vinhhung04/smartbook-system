import { gatewayAPI } from './http-clients';

type ApiResponse<T> = {
  data: T;
};

export type DashboardKpis = {
  total_titles: number;
  total_copies: number;
  active_loans: number;
  overdue_loans: number;
  pending_reservations: number;
  confirmed_reservations: number;
  ready_for_pickup_reservations: number;
  pickup_codes_expiring_soon: number;
  unpaid_fine_amount: number;
  low_stock_variants: number;
  reservation_conversion_rate: number;
};

export type AnalyticsDateParams = {
  from?: string;
  to?: string;
};

export type BorrowTrendParams = AnalyticsDateParams & {
  granularity?: 'day' | 'month';
};

export type TopBooksParams = AnalyticsDateParams & {
  limit?: number;
};

export type BorrowTrendItem = {
  date: string;
  loans: number;
  returns: number;
  reservations: number;
};

export type TopBookItem = {
  variant_id: string;
  book_id: string | null;
  title: string;
  borrow_count: number;
};

export type OverdueSummaryItem = {
  loan_id: string;
  loan_number: string;
  customer_id: string;
  customer_name: string;
  due_date: string | null;
  overdue_days: number;
};

export type OverdueSummary = {
  total_overdue_items: number;
  total_overdue_loans: number;
  average_overdue_days: number;
  oldest_overdue_days: number;
  items: OverdueSummaryItem[];
};

export type FineSummaryTypeItem = {
  fine_type: string;
  amount: number;
  count: number;
};

export type FineSummary = {
  total_unpaid: number;
  total_paid: number;
  total_waived: number;
  unpaid_count: number;
  paid_count: number;
  by_type: FineSummaryTypeItem[];
};

export type WarehouseStockRiskItem = {
  warehouse_id: string;
  warehouse_name: string;
  low_stock_variants: number;
  out_of_stock_variants: number;
  total_available_qty: number;
  total_reserved_qty: number;
  total_borrowed_qty: number;
};

export type ReservationFunnel = {
  total: number;
  pending: number;
  confirmed: number;
  ready_for_pickup: number;
  converted_to_loan: number;
  cancelled: number;
  expired: number;
  conversion_rate: number;
};

async function unwrap<T>(promise: Promise<{ data: ApiResponse<T> }>): Promise<T> {
  const response = await promise;
  return response.data.data;
}

export function getDashboardKpis() {
  return unwrap<DashboardKpis>(gatewayAPI.get('/analytics/dashboard/kpis'));
}

export function getBorrowTrends(params?: BorrowTrendParams) {
  return unwrap<BorrowTrendItem[]>(gatewayAPI.get('/analytics/borrow-trends', { params }));
}

export function getTopBooks(params?: TopBooksParams) {
  return unwrap<TopBookItem[]>(gatewayAPI.get('/analytics/top-books', { params }));
}

export function getOverdueSummary() {
  return unwrap<OverdueSummary>(gatewayAPI.get('/analytics/overdue-summary'));
}

export function getFineSummary() {
  return unwrap<FineSummary>(gatewayAPI.get('/analytics/fine-summary'));
}

export function getWarehouseStockRisk() {
  return unwrap<WarehouseStockRiskItem[]>(gatewayAPI.get('/analytics/warehouse-stock-risk'));
}

export function getReservationFunnel() {
  return unwrap<ReservationFunnel>(gatewayAPI.get('/analytics/reservation-funnel'));
}

export const analyticsService = {
  getDashboardKpis,
  getBorrowTrends,
  getTopBooks,
  getOverdueSummary,
  getFineSummary,
  getWarehouseStockRisk,
  getReservationFunnel,
};
