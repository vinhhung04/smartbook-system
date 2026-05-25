import { useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate, NavLink } from 'react-router';
import { motion } from 'motion/react';
import {
  AlertTriangle,
  ArrowRight,
  BookMarked,
  BookOpen,
  Clock,
  Crown,
  FileText,
  Package,
  PackageCheck,
  Receipt,
  RefreshCw,
  ShieldOff,
  TicketCheck,
  TrendingUp,
  Warehouse,
} from 'lucide-react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { EmptyState } from '@/components/ui/empty-state';
import { LoadingOverlay } from '@/components/ui/loading-state';
import { SectionCard } from '@/components/ui/section-card';
import { StatCard } from '@/components/ui/stat-card';
import {
  analyticsService,
  type BorrowTrendItem,
  type DashboardKpis,
  type FineSummary,
  type OverdueSummary,
  type ReservationFunnel,
  type TopBookItem,
  type WarehouseStockRiskItem,
} from '@/services/analytics';
import { getApiErrorMessage, hasAnyPermission } from '@/services/http-clients';
import { toast } from 'sonner';
import { authService } from '@/services/auth';

const CHART_COLORS = ['#2563eb', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4'];
const ANALYTICS_PERMISSIONS = ['analytics.reports.view', 'analytics.read', 'reports.read'];

type DashboardState = {
  kpis: DashboardKpis;
  trends: BorrowTrendItem[];
  topBooks: TopBookItem[];
  overdue: OverdueSummary;
  fines: FineSummary;
  stockRisk: WarehouseStockRiskItem[];
  funnel: ReservationFunnel;
};

const emptyKpis: DashboardKpis = {
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

const emptyOverdue: OverdueSummary = {
  total_overdue_items: 0,
  total_overdue_loans: 0,
  average_overdue_days: 0,
  oldest_overdue_days: 0,
  items: [],
};

const emptyFines: FineSummary = {
  total_unpaid: 0,
  total_paid: 0,
  total_waived: 0,
  unpaid_count: 0,
  paid_count: 0,
  by_type: [],
};

const emptyFunnel: ReservationFunnel = {
  total: 0,
  pending: 0,
  confirmed: 0,
  ready_for_pickup: 0,
  converted_to_loan: 0,
  cancelled: 0,
  expired: 0,
  conversion_rate: 0,
};

function formatMoney(value: number) {
  return new Intl.NumberFormat('vi-VN', {
    style: 'currency',
    currency: 'VND',
    maximumFractionDigits: 0,
  }).format(value || 0);
}

function formatPercent(value: number) {
  return `${Number(value || 0).toFixed(1)}%`;
}

function compactTitle(title: string, length = 22) {
  return title.length > length ? `${title.slice(0, length)}...` : title;
}

function hasRealData(state: DashboardState | null) {
  if (!state) return false;
  const kpiTotal = Object.values(state.kpis).reduce((sum, value) => sum + Number(value || 0), 0);
  return (
    kpiTotal > 0 ||
    state.trends.some((item) => item.loans || item.returns || item.reservations) ||
    state.topBooks.length > 0 ||
    state.stockRisk.length > 0 ||
    state.funnel.total > 0
  );
}

export function DashboardPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dashboard, setDashboard] = useState<DashboardState | null>(null);
  const canViewAnalytics = hasAnyPermission(ANALYTICS_PERMISSIONS);
  const currentUser = authService.getCurrentUser();
  const roles = (currentUser?.roles || []).map((role) => role.toUpperCase());
  const isWarehouseStaff = roles.some((role) => ['STAFF', 'WAREHOUSE_STAFF', 'WAREHOUSE_OPERATOR'].includes(role));

  if (isWarehouseStaff) {
    return <Navigate to="/my-warehouse-tasks" replace />;
  }

  const loadDashboard = useCallback(async () => {
    if (!canViewAnalytics) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const [kpis, trends, topBooks, overdue, fines, stockRisk, funnel] = await Promise.all([
        analyticsService.getDashboardKpis(),
        analyticsService.getBorrowTrends({ granularity: 'day' }),
        analyticsService.getTopBooks({ limit: 8 }),
        analyticsService.getOverdueSummary(),
        analyticsService.getFineSummary(),
        analyticsService.getWarehouseStockRisk(),
        analyticsService.getReservationFunnel(),
      ]);

      setDashboard({
        kpis: kpis || emptyKpis,
        trends: Array.isArray(trends) ? trends : [],
        topBooks: Array.isArray(topBooks) ? topBooks : [],
        overdue: overdue || emptyOverdue,
        fines: fines || emptyFines,
        stockRisk: Array.isArray(stockRisk) ? stockRisk : [],
        funnel: funnel || emptyFunnel,
      });
    } catch (err) {
      const message = getApiErrorMessage(err, 'Failed to load analytics dashboard.');
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }, [canViewAnalytics]);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  const trendData = useMemo(
    () =>
      (dashboard?.trends || []).map((item) => ({
        ...item,
        label: item.date.length === 10 ? item.date.slice(5) : item.date,
      })),
    [dashboard?.trends],
  );

  const topBookData = useMemo(
    () =>
      (dashboard?.topBooks || []).map((item) => ({
        ...item,
        name: compactTitle(item.title),
      })),
    [dashboard?.topBooks],
  );

  const funnelData = useMemo(() => {
    const funnel = dashboard?.funnel || emptyFunnel;
    return [
      { name: 'Pending', value: funnel.pending },
      { name: 'Confirmed', value: funnel.confirmed },
      { name: 'Ready', value: funnel.ready_for_pickup },
      { name: 'Converted', value: funnel.converted_to_loan },
      { name: 'Cancelled', value: funnel.cancelled },
      { name: 'Expired', value: funnel.expired },
    ];
  }, [dashboard?.funnel]);

  const kpis = dashboard?.kpis || emptyKpis;
  const overdue = dashboard?.overdue || emptyOverdue;
  const fines = dashboard?.fines || emptyFines;
  const stockRisk = dashboard?.stockRisk || [];

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25 }}
        className="rounded-xl border border-black/5 bg-card p-5 shadow-[0_1px_3px_rgba(0,0,0,0.04)]"
      >
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-[22px] font-bold tracking-tight text-foreground">Analytics Dashboard</h1>
            <p className="mt-1 text-[13px] text-muted-foreground">
              Real-time reporting from Inventory, Borrow, Reservation, Loan, Return and Fine data.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void loadDashboard()}
              disabled={loading || !canViewAnalytics}
              className="inline-flex h-10 items-center gap-2 rounded-lg border border-border bg-background px-3 text-[13px] font-medium text-foreground transition hover:bg-muted disabled:opacity-60"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
            {canViewAnalytics ? (
              <NavLink
                to="/reports"
                className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-3 text-[13px] font-medium text-primary-foreground transition hover:opacity-90"
              >
                Reports <ArrowRight className="h-4 w-4" />
              </NavLink>
            ) : null}
          </div>
        </div>
      </motion.div>

      {!canViewAnalytics ? (
        <SectionCard>
          <EmptyState
            variant="no-permission"
            icon={ShieldOff}
            title="No analytics permission"
            description="Your account cannot view analytics dashboards."
          />
        </SectionCard>
      ) : loading ? (
        <SectionCard>
          <LoadingOverlay />
        </SectionCard>
      ) : error ? (
        <SectionCard>
          <EmptyState
            variant="error"
            title="Unable to load analytics"
            description={error}
            action={
              <button
                type="button"
                onClick={() => void loadDashboard()}
                className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-3 text-[13px] font-medium text-primary-foreground"
              >
                <RefreshCw className="h-4 w-4" /> Retry
              </button>
            }
          />
        </SectionCard>
      ) : (
        <>
          {!hasRealData(dashboard) && (
            <SectionCard>
              <EmptyState
                variant="no-data"
                title="No analytics data yet"
                description="Once books, stock, reservations, loans and fines exist, this dashboard will populate automatically."
              />
            </SectionCard>
          )}

          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
            <StatCard label="Titles" value={kpis.total_titles} icon={BookOpen} variant="default" />
            <StatCard label="Copies" value={kpis.total_copies} icon={Package} variant="success" />
            <StatCard label="Borrowed" value={kpis.active_loans} icon={BookMarked} variant="info" />
            <StatCard label="Overdue" value={kpis.overdue_loans} icon={Clock} variant="danger" />
            <StatCard label="Low stock" value={kpis.low_stock_variants} icon={AlertTriangle} variant="warning" />
            <StatCard label="Unpaid fines" value={formatMoney(kpis.unpaid_fine_amount)} icon={Receipt} variant="warning" />
            <StatCard label="Pending" value={kpis.pending_reservations} icon={FileText} variant="primary" />
            <StatCard label="Confirmed" value={kpis.confirmed_reservations} icon={PackageCheck} variant="success" />
            <StatCard label="Ready" value={kpis.ready_for_pickup_reservations} icon={TicketCheck} variant="info" />
            <StatCard label="Pickup expiring" value={kpis.pickup_codes_expiring_soon} icon={Clock} variant="warning" />
            <StatCard label="Convert rate" value={formatPercent(kpis.reservation_conversion_rate)} icon={TrendingUp} variant="success" />
            <StatCard label="Overdue items" value={overdue.total_overdue_items} icon={AlertTriangle} variant="danger" />
          </div>

          <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
            <section className="xl:col-span-2">
              <SectionCard title="Borrow trends" subtitle="Loans, returns and reservations in the latest date range" icon={TrendingUp}>
                {trendData.length ? (
                  <ResponsiveContainer width="100%" height={300}>
                    <AreaChart data={trendData} margin={{ top: 12, right: 16, left: 0, bottom: 8 }}>
                      <defs>
                        <linearGradient id="loansGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#2563eb" stopOpacity={0.28} />
                          <stop offset="100%" stopColor="#2563eb" stopOpacity={0.03} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#edf0f5" vertical={false} />
                      <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} width={32} />
                      <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e5e7eb' }} />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      <Area type="monotone" dataKey="loans" stroke="#2563eb" fill="url(#loansGrad)" strokeWidth={2} name="Loans" />
                      <Area type="monotone" dataKey="returns" stroke="#10b981" fill="#10b98122" strokeWidth={2} name="Returns" />
                      <Area type="monotone" dataKey="reservations" stroke="#f59e0b" fill="#f59e0b22" strokeWidth={2} name="Reservations" />
                    </AreaChart>
                  </ResponsiveContainer>
                ) : (
                  <EmptyState variant="no-data" title="No trend data" description="No loan or reservation activity in the selected range." />
                )}
              </SectionCard>
            </section>

            <SectionCard title="Reservation funnel" subtitle={`Conversion ${formatPercent(dashboard?.funnel.conversion_rate || 0)}`} icon={TicketCheck}>
              {funnelData.some((item) => item.value > 0) ? (
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={funnelData} margin={{ top: 12, right: 12, left: 0, bottom: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#edf0f5" vertical={false} />
                    <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#64748b' }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} width={28} />
                    <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e5e7eb' }} />
                    <Bar dataKey="value" radius={[6, 6, 0, 0]} name="Reservations">
                      {funnelData.map((_, index) => (
                        <Cell key={index} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <EmptyState variant="no-data" title="No reservations" description="Reservation funnel will appear after customer reservations are created." />
              )}
            </SectionCard>
          </div>

          <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
            <SectionCard title="Top borrowed books" subtitle="Ranked by loan item count" icon={Crown}>
              {topBookData.length ? (
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={topBookData} layout="vertical" margin={{ top: 4, right: 20, left: 8, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#edf0f5" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
                    <YAxis dataKey="name" type="category" width={140} tick={{ fontSize: 11, fill: '#334155' }} axisLine={false} tickLine={false} />
                    <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e5e7eb' }} />
                    <Bar dataKey="borrow_count" radius={[0, 6, 6, 0]} name="Borrow count">
                      {topBookData.map((_, index) => (
                        <Cell key={index} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <EmptyState variant="no-data" title="No borrowed books" description="Books will be ranked after loan transactions exist." />
              )}
            </SectionCard>

            <SectionCard title="Fine summary" subtitle="Unpaid, paid and waived amounts" icon={Receipt}>
              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-lg border border-border p-3">
                  <p className="text-[11px] uppercase text-muted-foreground">Unpaid</p>
                  <p className="mt-1 text-[18px] font-semibold">{formatMoney(fines.total_unpaid)}</p>
                </div>
                <div className="rounded-lg border border-border p-3">
                  <p className="text-[11px] uppercase text-muted-foreground">Paid</p>
                  <p className="mt-1 text-[18px] font-semibold">{formatMoney(fines.total_paid)}</p>
                </div>
                <div className="rounded-lg border border-border p-3">
                  <p className="text-[11px] uppercase text-muted-foreground">Waived</p>
                  <p className="mt-1 text-[18px] font-semibold">{formatMoney(fines.total_waived)}</p>
                </div>
              </div>
              <div className="mt-4 space-y-2">
                {fines.by_type.length ? (
                  fines.by_type.map((item) => (
                    <div key={item.fine_type} className="flex items-center justify-between rounded-lg bg-muted/40 px-3 py-2">
                      <div>
                        <p className="text-[13px] font-medium">{item.fine_type}</p>
                        <p className="text-[12px] text-muted-foreground">{item.count} fines</p>
                      </div>
                      <p className="text-[13px] font-semibold">{formatMoney(item.amount)}</p>
                    </div>
                  ))
                ) : (
                  <EmptyState variant="no-data" title="No fines" description="Fine breakdown will appear when fines are issued." className="py-8" />
                )}
              </div>
            </SectionCard>
          </div>

          <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
            <SectionCard title="Warehouse stock risk" subtitle="Low stock and out of stock variants by warehouse" icon={Warehouse}>
              {stockRisk.length ? (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[560px] text-left text-[13px]">
                    <thead className="text-[11px] uppercase text-muted-foreground">
                      <tr className="border-b border-border">
                        <th className="py-2 pr-3 font-medium">Warehouse</th>
                        <th className="py-2 pr-3 font-medium">Low</th>
                        <th className="py-2 pr-3 font-medium">Out</th>
                        <th className="py-2 pr-3 font-medium">Available</th>
                        <th className="py-2 pr-3 font-medium">Reserved</th>
                        <th className="py-2 pr-3 font-medium">Borrowed</th>
                      </tr>
                    </thead>
                    <tbody>
                      {stockRisk.map((item) => (
                        <tr key={item.warehouse_id} className="border-b border-border/60 last:border-0">
                          <td className="py-3 pr-3 font-medium">{item.warehouse_name}</td>
                          <td className="py-3 pr-3 text-amber-700">{item.low_stock_variants}</td>
                          <td className="py-3 pr-3 text-rose-700">{item.out_of_stock_variants}</td>
                          <td className="py-3 pr-3">{item.total_available_qty}</td>
                          <td className="py-3 pr-3">{item.total_reserved_qty}</td>
                          <td className="py-3 pr-3">{item.total_borrowed_qty}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <EmptyState variant="no-data" title="No warehouse stock" description="Stock risk will appear after inventory balances are available." />
              )}
            </SectionCard>

            <SectionCard title="Overdue loans" subtitle={`Average ${overdue.average_overdue_days} days overdue`} icon={Clock}>
              {overdue.items.length ? (
                <div className="space-y-2">
                  {overdue.items.slice(0, 6).map((item) => (
                    <div key={item.loan_id} className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
                      <div className="min-w-0">
                        <p className="truncate text-[13px] font-medium">{item.loan_number}</p>
                        <p className="truncate text-[12px] text-muted-foreground">{item.customer_name}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-[13px] font-semibold text-rose-700">{item.overdue_days} days</p>
                        <p className="text-[12px] text-muted-foreground">{item.due_date ? item.due_date.slice(0, 10) : 'No due date'}</p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState variant="no-data" title="No overdue loans" description="Great: there are no overdue loan items right now." />
              )}
            </SectionCard>
          </div>
        </>
      )}
    </div>
  );
}
