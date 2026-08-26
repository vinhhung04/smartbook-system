import type {
  BorrowTrendItem,
  DashboardKpis,
  FineSummary,
  OverdueSummary,
  ReorderSuggestionsData,
  ReservationFunnel,
  TopBookItem,
  WarehouseStockRiskItem,
} from '@/services/analytics';

export type DashboardState = {
  kpis: DashboardKpis;
  trends: BorrowTrendItem[];
  topBooks: TopBookItem[];
  overdue: OverdueSummary;
  fines: FineSummary;
  stockRisk: WarehouseStockRiskItem[];
  funnel: ReservationFunnel;
};

export const CHART_COLORS = ['var(--color-chart-1)', 'var(--color-chart-2)', 'var(--color-chart-3)', 'var(--color-chart-4)', 'var(--color-chart-5)', 'var(--color-chart-1)'];
export const ANALYTICS_PERMISSIONS = ['analytics.reports.view', 'analytics.read', 'reports.read'];

export const emptyKpis: DashboardKpis = {
  total_titles: 0,
  total_copies: 0,
  active_loans: 0,
  overdue_loans: 0,
  pending_reservations: 0,
  confirmed_reservations: 0,
  ready_for_pickup_reservations: 0,
  pickup_codes_expiring_soon: 0,
  unpaid_fine_amount: 0,
  low_stock_variants: 0,
  reservation_conversion_rate: 0,
};

export const emptyOverdue: OverdueSummary = {
  total_overdue_items: 0,
  total_overdue_loans: 0,
  average_overdue_days: 0,
  oldest_overdue_days: 0,
  items: [],
};

export const emptyFines: FineSummary = {
  total_unpaid: 0,
  total_paid: 0,
  total_waived: 0,
  unpaid_count: 0,
  paid_count: 0,
  by_type: [],
};

export const emptyFunnel: ReservationFunnel = {
  total: 0,
  pending: 0,
  confirmed: 0,
  ready_for_pickup: 0,
  converted_to_loan: 0,
  cancelled: 0,
  expired: 0,
  conversion_rate: 0,
};

export const emptyReorderSummary: ReorderSuggestionsData['summary'] = {
  total_candidates: 0,
  high_priority: 0,
  medium_priority: 0,
  low_priority: 0,
  estimated_total_reorder_qty: 0,
};

export const DECISION_COLORS = {
  orange: {
    pill: 'border-orange-200 bg-orange-50 hover:bg-orange-100 dark:border-orange-500/20 dark:bg-orange-500/10 dark:hover:bg-orange-500/15',
    iconColor: 'text-orange-600 dark:text-orange-400',
    text: 'text-orange-700 dark:text-orange-400',
  },
  red: {
    pill: 'border-red-200 bg-red-50 hover:bg-red-100 dark:border-red-500/20 dark:bg-red-500/10 dark:hover:bg-red-500/15',
    iconColor: 'text-red-600 dark:text-red-400',
    text: 'text-red-700 dark:text-red-400',
  },
  amber: {
    pill: 'border-amber-200 bg-amber-50 hover:bg-amber-100 dark:border-amber-500/20 dark:bg-amber-500/10 dark:hover:bg-amber-500/15',
    iconColor: 'text-amber-600 dark:text-amber-400',
    text: 'text-amber-700 dark:text-amber-400',
  },
  rose: {
    pill: 'border-rose-200 bg-rose-50 hover:bg-rose-100 dark:border-rose-500/20 dark:bg-rose-500/10 dark:hover:bg-rose-500/15',
    iconColor: 'text-rose-600 dark:text-rose-400',
    text: 'text-rose-700 dark:text-rose-400',
  },
  violet: {
    pill: 'border-violet-200 bg-violet-50 hover:bg-violet-100 dark:border-violet-500/20 dark:bg-violet-500/10 dark:hover:bg-violet-500/15',
    iconColor: 'text-violet-600 dark:text-violet-400',
    text: 'text-violet-700 dark:text-violet-400',
  },
  blue: {
    pill: 'border-blue-200 bg-blue-50 hover:bg-blue-100 dark:border-blue-500/20 dark:bg-blue-500/10 dark:hover:bg-blue-500/15',
    iconColor: 'text-blue-600 dark:text-blue-400',
    text: 'text-blue-700 dark:text-blue-400',
  },
} as const;
