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

export type ReorderSuggestionsParams = AnalyticsDateParams & {
  days?: number;
  limit?: number;
  leadTimeDays?: number;
  priority?: 'ALL' | 'HIGH' | 'MEDIUM' | 'LOW';
  includeLowDemand?: boolean;
  budgetVnd?: number;
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
  reasoning?: string;
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

export type ReorderSuggestionItem = {
  book_id: string;
  variant_id: string;
  title: string;
  author: string;
  category: string;
  isbn: string;
  available_qty: number;
  on_hand_qty: number;
  reserved_qty: number;
  borrowed_qty: number;
  reorder_point: number;
  borrow_count: number;
  previous_borrow_count: number;
  reservation_count: number;
  wishlist_count: number;
  availability_alert_count: number;
  avg_daily_demand: number;
  forecast_7d: number;
  forecast_30d: number;
  estimated_days_until_stockout: number | null;
  demand_trend_pct: number;
  demand_score: number;
  priority: 'HIGH' | 'MEDIUM' | 'LOW';
  suggested_reorder_qty: number;
  seasonal_index: number;
  seasonal_event: string | null;
  reason: string;
  unit_cost: number;
  estimated_cost: number;
  within_budget?: boolean;
};

export type ReorderSuggestionsData = {
  generated_at: string;
  range: {
    from: string;
    to: string;
    days: number;
    leadTimeDays: number;
  };
  summary: {
    total_candidates: number;
    high_priority: number;
    medium_priority: number;
    low_priority: number;
    estimated_total_reorder_qty: number;
    estimated_total_cost: number;
  };
  budget: {
    budget_vnd: number;
    funded_cost: number;
    remaining_vnd: number;
  } | null;
  items: ReorderSuggestionItem[];
};

export type AgingInventoryItem = {
  variant_id: string;
  book_id: string;
  title: string;
  warehouse_id: string;
  warehouse_name: string;
  on_hand_qty: number;
  last_activity_at: string | null;
  days_since_last_activity: number | null;
};

export type AgingInventoryData = {
  generated_at: string;
  threshold_days: number;
  cutoff: string;
  items: AgingInventoryItem[];
};

export type WeedingSuggestionItem = {
  variant_id: string;
  book_id: string;
  title: string;
  warehouse_id: string;
  warehouse_name: string;
  on_hand_qty: number;
  unit_cost: number;
  last_activity_at: string | null;
  days_since_last_activity: number | null;
  severity: 'HIGH' | 'CRITICAL';
  suggested_action: 'LIQUIDATE' | 'REDISTRIBUTE';
  tied_up_value: number;
};

export type WeedingSuggestionsData = {
  generated_at: string;
  threshold_days: number;
  cutoff: string;
  summary: {
    total_items: number;
    total_tied_up_value: number;
    critical_count: number;
    high_count: number;
    redistribute_count: number;
    liquidate_count: number;
  };
  items: WeedingSuggestionItem[];
};

export type RiskBand = 'HIGH' | 'MEDIUM' | 'LOW';

export type RiskFactor = {
  feature: string;
  contribution: number;
  direction: 'increases_risk' | 'decreases_risk';
};

export type RiskModelEvaluation = {
  samples: number;
  positives: number;
  base_rate: number | null;
  auc: number | null;
  brier: number | null;
  best_threshold: { threshold: number; precision: number; recall: number; f1: number };
  ece: number | null;
  lift: { k: number; captured: number; base_rate: number; precision_at_k: number; lift: number | null }[];
};

export type RiskModelInfo = {
  feature_names: string[];
  weights: number[];
  bias: number;
  trained_at: string;
  train_size: number;
};

export type LateReturnRiskItem = {
  loan_item_id: string;
  customer_name: string | null;
  title: string | null;
  borrow_date: string;
  due_date: string;
  risk_score: number;
  risk_band: RiskBand;
  top_factors: RiskFactor[];
};

export type ReservationNoShowRiskItem = {
  reservation_id: string;
  customer_name: string | null;
  title: string | null;
  reserved_at: string;
  expires_at: string;
  risk_score: number;
  risk_band: RiskBand;
  top_factors: RiskFactor[];
};

export type RiskModelData<TItem> = {
  generated_at: string;
  status?: 'INSUFFICIENT_DATA';
  reason?: string;
  model?: RiskModelInfo;
  evaluation?: RiskModelEvaluation;
  items: TItem[];
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

export function getReorderSuggestions(params?: ReorderSuggestionsParams) {
  return unwrap<ReorderSuggestionsData>(gatewayAPI.get('/analytics/reorder-suggestions', { params }));
}

export function getAgingInventory(params?: { days?: number; limit?: number }) {
  return unwrap<AgingInventoryData>(gatewayAPI.get('/analytics/aging-inventory', { params }));
}

export function getWeedingSuggestions(params?: { days?: number; limit?: number }) {
  return unwrap<WeedingSuggestionsData>(gatewayAPI.get('/analytics/weeding-suggestions', { params }));
}

export function getLateReturnRisk(params?: { limit?: number; dueWithinDays?: number }) {
  return unwrap<RiskModelData<LateReturnRiskItem>>(gatewayAPI.get('/analytics/late-return-risk', { params }));
}

export function getReservationNoShowRisk(params?: { limit?: number }) {
  return unwrap<RiskModelData<ReservationNoShowRiskItem>>(gatewayAPI.get('/analytics/reservation-no-show-risk', { params }));
}

export const analyticsService = {
  getDashboardKpis,
  getBorrowTrends,
  getTopBooks,
  getOverdueSummary,
  getFineSummary,
  getWarehouseStockRisk,
  getReservationFunnel,
  getReorderSuggestions,
  getAgingInventory,
  getWeedingSuggestions,
  getLateReturnRisk,
  getReservationNoShowRisk,
};
