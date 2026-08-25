import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate, NavLink } from 'react-router';
import { AnimatePresence, motion } from 'motion/react';
import {
  AlertTriangle,
  ArrowRight,
  Ban,
  Bell,
  BookMarked,
  BookOpen,
  CheckCircle2,
  Clock,
  Crown,
  FileText,
  LayoutDashboard,
  Package,
  PackageCheck,
  Receipt,
  RefreshCw,
  ShieldOff,
  ShoppingCart,
  Sparkles,
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
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import { PageWrapper, FadeItem, AnimatedCounter } from '@/components/motion-utils';
import {
  analyticsService,
  type BorrowTrendItem,
  type DashboardKpis,
  type FineSummary,
  type OverdueSummary,
  type ReorderSuggestionsData,
  type ReservationFunnel,
  type TopBookItem,
  type WarehouseStockRiskItem,
} from '@/services/analytics';
import { getApiErrorMessage, hasAnyPermission } from '@/services/http-clients';
import { toast } from 'sonner';
import { authService } from '@/services/auth';
import { purchaseRequestService } from '@/services/purchase-requests';
import { exceptionReportService } from '@/services/exception-reports';
import { useBorrowRealtime } from '@/hooks/useBorrowRealtime';
import { useInventoryRealtime } from '@/hooks/useInventoryRealtime';

const CHART_COLORS = ['var(--color-chart-1)', 'var(--color-chart-2)', 'var(--color-chart-3)', 'var(--color-chart-4)', 'var(--color-chart-5)', 'var(--color-chart-1)'];
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

const emptyReorderSummary: ReorderSuggestionsData['summary'] = {
  total_candidates: 0,
  high_priority: 0,
  medium_priority: 0,
  low_priority: 0,
  estimated_total_reorder_qty: 0,
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

function getGreeting(hour: number) {
  if (hour < 12) return 'Chào buổi sáng';
  if (hour < 18) return 'Chào buổi chiều';
  return 'Chào buổi tối';
}

const DECISION_COLORS = {
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
  const [pendingPR, setPendingPR] = useState(0);
  const [openER, setOpenER] = useState(0);
  const [reorderSummary, setReorderSummary] = useState(emptyReorderSummary);
  const [hasNewData, setHasNewData] = useState(false);
  const canViewAnalytics = hasAnyPermission(ANALYTICS_PERMISSIONS);
  const currentUser = authService.getCurrentUser();
  const roles = (currentUser?.roles || []).map((role) => role.toUpperCase());
  const isWarehouseStaff = roles.includes('WAREHOUSE_STAFF');

  const loadDashboard = useCallback(async () => {
    if (!canViewAnalytics || isWarehouseStaff) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);
      setHasNewData(false);

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

      const [prRes, erRes, reorderRes] = await Promise.allSettled([
        purchaseRequestService.getAll({ status: 'PENDING', limit: 1 }),
        exceptionReportService.getAll({ status: 'OPEN', limit: 1 }),
        analyticsService.getReorderSuggestions({ priority: 'ALL', limit: 1 }),
      ]);
      setPendingPR(prRes.status === 'fulfilled' ? (prRes.value.total ?? prRes.value.data?.length ?? 0) : 0);
      setOpenER(erRes.status === 'fulfilled' ? (erRes.value.total ?? erRes.value.data?.length ?? 0) : 0);
      setReorderSummary(reorderRes.status === 'fulfilled' ? (reorderRes.value.summary || emptyReorderSummary) : emptyReorderSummary);
    } catch (err) {
      const message = getApiErrorMessage(err, 'Không tải được bảng phân tích.');
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }, [canViewAnalytics, isWarehouseStaff]);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  const markNewData = useCallback(() => {
    if (canViewAnalytics && !loading) setHasNewData(true);
  }, [canViewAnalytics, loading]);

  useBorrowRealtime({
    onLoanEvent: markNewData,
    onReservationEvent: markNewData,
    onFineEvent: markNewData,
  });
  useInventoryRealtime({
    onStockEvent: markNewData,
    onPurchaseRequestEvent: markNewData,
  });

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
      { name: 'Chờ xác nhận', value: funnel.pending },
      { name: 'Đã xác nhận', value: funnel.confirmed },
      { name: 'Sẵn lấy', value: funnel.ready_for_pickup },
      { name: 'Đã mượn', value: funnel.converted_to_loan },
      { name: 'Đã hủy', value: funnel.cancelled },
      { name: 'Hết hạn', value: funnel.expired },
    ];
  }, [dashboard?.funnel]);

  const kpis = dashboard?.kpis || emptyKpis;
  const overdue = dashboard?.overdue || emptyOverdue;
  const fines = dashboard?.fines || emptyFines;
  const stockRisk = dashboard?.stockRisk || [];

  const greeting = getGreeting(new Date().getHours());
  const todayLabel = new Date().toLocaleDateString('vi-VN', {
    weekday: 'long',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
  const totalActionable = pendingPR + openER + kpis.low_stock_variants + kpis.overdue_loans + fines.unpaid_count + reorderSummary.high_priority;

  if (isWarehouseStaff) {
    return <Navigate to="/my-warehouse-tasks" replace />;
  }

  const headerDescription = canViewAnalytics && !loading && !error
    ? totalActionable > 0
      ? `${todayLabel} — Bạn có ${totalActionable} việc cần xử lý hôm nay.`
      : `${todayLabel} — Không có việc gì khẩn cấp hôm nay, mọi thứ đang ổn định.`
    : `${todayLabel} — Xem KPI thư viện, kho vận và các việc cần xử lý trong ngày.`;

  return (
    <PageWrapper className="space-y-6">
      <FadeItem>
        <PageHeader
          icon={LayoutDashboard}
          title={`${greeting}${currentUser?.full_name ? `, ${currentUser.full_name}` : ''}`}
          description={headerDescription}
          iconBg="bg-indigo-100 dark:bg-indigo-500/15"
          iconColor="text-indigo-600 dark:text-indigo-400"
          actions={
            <>
              <Button type="button" variant="outline" onClick={() => void loadDashboard()} disabled={!canViewAnalytics} loading={loading} aria-label="Làm mới dữ liệu">
                <RefreshCw className="h-4 w-4" />
                Làm mới
              </Button>
              {canViewAnalytics ? (
                <Button type="button" asChild>
                  <NavLink to="/reports">
                    Báo cáo <ArrowRight className="h-4 w-4" />
                  </NavLink>
                </Button>
              ) : null}
            </>
          }
        />
      </FadeItem>

      <AnimatePresence>
        {hasNewData && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-2.5 dark:border-indigo-500/20 dark:bg-indigo-500/10">
              <div className="flex items-center gap-2 text-[13px] text-indigo-700 dark:text-indigo-400">
                <Bell className="h-4 w-4 shrink-0" />
                Có dữ liệu mới — số liệu bên dưới có thể đã thay đổi.
              </div>
              <button
                type="button"
                onClick={() => void loadDashboard()}
                className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-[12px] font-medium text-white hover:bg-indigo-700 transition-colors"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Cập nhật ngay
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {!canViewAnalytics ? (
        <SectionCard>
          <EmptyState
            variant="no-permission"
            icon={ShieldOff}
            title="Không có quyền xem phân tích"
            description="Tài khoản của bạn không có quyền xem bảng phân tích."
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
            title="Không thể tải phân tích"
            description={error}
            action={
              <button
                type="button"
                onClick={() => void loadDashboard()}
                className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-3 text-[13px] font-medium text-primary-foreground"
              >
                <RefreshCw className="h-4 w-4" /> Thử lại
              </button>
            }
          />
        </SectionCard>
      ) : (
        <>
          {!hasRealData(dashboard) && (
            <FadeItem>
              <SectionCard>
                <EmptyState
                  variant="no-data"
                  title="Chưa có dữ liệu phân tích"
                  description="Khi sách, tồn kho, đặt trước, mượn trả và tiền phạt có dữ liệu, bảng phân tích sẽ tự động cập nhật."
                />
              </SectionCard>
            </FadeItem>
          )}

          {/* Manager Decision Center */}
          <FadeItem>
            <div className="flex items-center justify-between mb-3">
              <div>
                <h2 className="text-[15px] font-semibold text-foreground">Việc cần xử lý hôm nay</h2>
                <p className="text-[12px] text-muted-foreground mt-0.5">Các mục cần quyết định hoặc theo dõi ngay</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {([
                { to: '/purchase-requests?status=PENDING', icon: ShoppingCart, count: pendingPR, label: 'Yêu cầu mua hàng chờ duyệt', color: 'orange' },
                { to: '/exception-reports?status=OPEN', icon: AlertTriangle, count: openER, label: 'Báo cáo sự cố chưa xử lý', color: 'red' },
                { to: '/inventory', icon: Warehouse, count: kpis.low_stock_variants, label: 'Đầu sách tồn kho thấp', color: 'amber' },
                { to: '/borrow/loans?status=OVERDUE', icon: Clock, count: kpis.overdue_loans, label: 'Phiếu mượn quá hạn', color: 'rose' },
                { to: '/borrow/fines?status=UNPAID', icon: Receipt, count: fines.unpaid_count, label: 'Tiền phạt chưa thu', color: 'violet' },
                { to: '/reorder-suggestions', icon: Sparkles, count: reorderSummary.high_priority, label: 'Cần nhập thêm hàng', color: 'blue' },
              ] as const).map((item, index) => {
                const active = item.count > 0;
                const colors = DECISION_COLORS[item.color];
                const Icon = item.icon;
                return (
                  <NavLink key={item.to} to={item.to}>
                    <motion.div
                      initial={{ opacity: 0, scale: 0.92 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ duration: 0.2, delay: index * 0.03 }}
                      whileHover={{ scale: 1.03 }}
                      whileTap={{ scale: 0.98 }}
                      className={`inline-flex h-11 items-center gap-2 rounded-full border pl-3 pr-3.5 transition-colors cursor-pointer ${active ? colors.pill : 'border-border bg-muted/50 hover:bg-muted'}`}
                    >
                      <Icon className={`h-4 w-4 shrink-0 ${active ? colors.iconColor : 'text-muted-foreground'}`} />
                      <span className={`text-[13px] font-bold tabular-nums ${active ? colors.text : 'text-muted-foreground'}`}>{item.count}</span>
                      <span className="text-[13px] text-foreground">{item.label}</span>
                    </motion.div>
                  </NavLink>
                );
              })}
            </div>
          </FadeItem>

          {/* KPI: hero tile + thư viện overview */}
          <FadeItem>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4 md:auto-rows-[minmax(120px,1fr)] md:grid-flow-dense lg:grid-cols-5">
              <div className="relative col-span-2 overflow-hidden rounded-xl border border-indigo-700/20 bg-gradient-to-br from-indigo-600 to-blue-600 p-5 flex flex-col justify-between text-white shadow-[0_4px_20px_-6px_rgba(79,70,229,0.5)] md:row-span-2">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-medium uppercase tracking-wider text-white/70">Đang mượn</span>
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/15">
                    <BookMarked className="h-[18px] w-[18px] text-white" />
                  </div>
                </div>
                <AnimatedCounter value={kpis.active_loans} className="text-[42px] font-bold tracking-tight text-white leading-none" />
                <p className="text-[12px] text-white/75">Tổng số bản sao đang được mượn</p>
              </div>
              <StatCard label="Đầu sách" value={kpis.total_titles} icon={BookOpen} variant="default" animateValue />
              <StatCard label="Bản sao" value={kpis.total_copies} icon={Package} variant="success" animateValue />
              <StatCard label="Tỷ lệ nhận sách" value={formatPercent(kpis.reservation_conversion_rate)} icon={TrendingUp} variant="success" />
              <StatCard label="Mục quá hạn" value={overdue.total_overdue_items} icon={AlertTriangle} variant="danger" animateValue />
            </div>
          </FadeItem>

          <FadeItem>
            <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
              <section className="xl:col-span-2">
                <SectionCard title="Xu hướng mượn trả" subtitle="Lượt mượn, trả và đặt trước trong khoảng thời gian gần nhất" icon={TrendingUp}>
                  {trendData.length ? (
                    <ResponsiveContainer width="100%" height={300}>
                      <AreaChart data={trendData} margin={{ top: 12, right: 16, left: 0, bottom: 8 }}>
                        <defs>
                          <linearGradient id="loansGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor={CHART_COLORS[0]} stopOpacity={0.28} />
                            <stop offset="100%" stopColor={CHART_COLORS[0]} stopOpacity={0.03} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                        <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--color-muted-foreground)' }} axisLine={false} tickLine={false} />
                        <YAxis tick={{ fontSize: 11, fill: 'var(--color-muted-foreground)' }} axisLine={false} tickLine={false} width={32} />
                        <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid var(--color-border)', backgroundColor: 'var(--color-card)', color: 'var(--color-foreground)' }} />
                        <Legend wrapperStyle={{ fontSize: 12 }} />
                        <Area type="monotone" dataKey="loans" stroke={CHART_COLORS[0]} fill="url(#loansGrad)" strokeWidth={2} name="Mượn" />
                        <Area type="monotone" dataKey="returns" stroke={CHART_COLORS[1]} fill={CHART_COLORS[1]} fillOpacity={0.15} strokeWidth={2} name="Trả" />
                        <Area type="monotone" dataKey="reservations" stroke={CHART_COLORS[2]} fill={CHART_COLORS[2]} fillOpacity={0.15} strokeWidth={2} name="Đặt trước" />
                      </AreaChart>
                    </ResponsiveContainer>
                  ) : (
                    <EmptyState variant="no-data" title="Chưa có dữ liệu xu hướng" description="Chưa có hoạt động mượn/đặt trong khoảng thời gian đã chọn." />
                  )}
                </SectionCard>
              </section>

              <SectionCard title="Phễu đặt trước" subtitle={`Tỷ lệ chuyển đổi ${formatPercent(dashboard?.funnel.conversion_rate || 0)}`} icon={TicketCheck}>
                <div className="grid grid-cols-2 gap-2 mb-4">
                  <div className="rounded-lg bg-muted/50 px-2.5 py-2">
                    <p className="text-[10px] uppercase text-muted-foreground">Đặt trước</p>
                    <p className="text-[15px] font-semibold text-foreground">{kpis.pending_reservations}</p>
                  </div>
                  <div className="rounded-lg bg-muted/50 px-2.5 py-2">
                    <p className="text-[10px] uppercase text-muted-foreground">Đã xác nhận</p>
                    <p className="text-[15px] font-semibold text-foreground">{kpis.confirmed_reservations}</p>
                  </div>
                  <div className="rounded-lg bg-muted/50 px-2.5 py-2">
                    <p className="text-[10px] uppercase text-muted-foreground">Sẵn lấy</p>
                    <p className="text-[15px] font-semibold text-foreground">{kpis.ready_for_pickup_reservations}</p>
                  </div>
                  <div className="rounded-lg bg-muted/50 px-2.5 py-2">
                    <p className="text-[10px] uppercase text-muted-foreground">Sắp hết hạn lấy</p>
                    <p className="text-[15px] font-semibold text-foreground">{kpis.pickup_codes_expiring_soon}</p>
                  </div>
                </div>
                {funnelData.some((item) => item.value > 0) ? (
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={funnelData} margin={{ top: 12, right: 12, left: 0, bottom: 8 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                      <XAxis dataKey="name" tick={{ fontSize: 10, fill: 'var(--color-muted-foreground)' }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fontSize: 11, fill: 'var(--color-muted-foreground)' }} axisLine={false} tickLine={false} width={28} />
                      <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid var(--color-border)', backgroundColor: 'var(--color-card)', color: 'var(--color-foreground)' }} />
                      <Bar dataKey="value" radius={[6, 6, 0, 0]} name="Đặt trước">
                        {funnelData.map((_, index) => (
                          <Cell key={index} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <EmptyState variant="no-data" title="Chưa có đặt trước" description="Phễu đặt trước sẽ hiển thị sau khi khách hàng tạo đặt trước." />
                )}
              </SectionCard>
            </div>
          </FadeItem>

          <FadeItem>
            <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
              <SectionCard title="Sách mượn nhiều nhất" subtitle="Xếp hạng theo số lượt mượn" icon={Crown}>
                {topBookData.length ? (
                  <ResponsiveContainer width="100%" height={280}>
                    <BarChart data={topBookData} layout="vertical" margin={{ top: 4, right: 20, left: 8, bottom: 4 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" horizontal={false} />
                      <XAxis type="number" tick={{ fontSize: 11, fill: 'var(--color-muted-foreground)' }} axisLine={false} tickLine={false} />
                      <YAxis dataKey="name" type="category" width={140} tick={{ fontSize: 11, fill: 'var(--color-foreground)' }} axisLine={false} tickLine={false} />
                      <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid var(--color-border)', backgroundColor: 'var(--color-card)', color: 'var(--color-foreground)' }} />
                      <Bar dataKey="borrow_count" radius={[0, 6, 6, 0]} name="Số lượt mượn">
                        {topBookData.map((_, index) => (
                          <Cell key={index} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <EmptyState variant="no-data" title="Chưa có dữ liệu mượn sách" description="Sách sẽ được xếp hạng sau khi có giao dịch mượn." />
                )}
              </SectionCard>

              <SectionCard title="Tổng quan tiền phạt" subtitle="Số tiền chưa trả, đã trả và miễn giảm" icon={Receipt}>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 dark:border-rose-500/20 dark:bg-rose-500/10">
                    <div className="flex items-center gap-1.5 text-[11px] uppercase text-rose-700 dark:text-rose-400">
                      <Receipt className="w-3 h-3" /> Chưa trả
                    </div>
                    <p className="mt-1 text-[18px] font-semibold text-rose-900 dark:text-rose-300">{formatMoney(fines.total_unpaid)}</p>
                  </div>
                  <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 dark:border-emerald-500/20 dark:bg-emerald-500/10">
                    <div className="flex items-center gap-1.5 text-[11px] uppercase text-emerald-700 dark:text-emerald-400">
                      <CheckCircle2 className="w-3 h-3" /> Đã trả
                    </div>
                    <p className="mt-1 text-[18px] font-semibold text-emerald-900 dark:text-emerald-300">{formatMoney(fines.total_paid)}</p>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-500/20 dark:bg-slate-500/10">
                    <div className="flex items-center gap-1.5 text-[11px] uppercase text-slate-600 dark:text-slate-400">
                      <Ban className="w-3 h-3" /> Miễn giảm
                    </div>
                    <p className="mt-1 text-[18px] font-semibold text-slate-800 dark:text-slate-300">{formatMoney(fines.total_waived)}</p>
                  </div>
                </div>
                <div className="mt-4 space-y-2">
                  {fines.by_type.length ? (
                    fines.by_type.map((item) => (
                      <div key={item.fine_type} className="flex items-center justify-between rounded-lg bg-muted/40 px-3 py-2">
                        <div>
                          <p className="text-[13px] font-medium">{item.fine_type}</p>
                          <p className="text-[12px] text-muted-foreground">{item.count} khoản phạt</p>
                        </div>
                        <p className="text-[13px] font-semibold">{formatMoney(item.amount)}</p>
                      </div>
                    ))
                  ) : (
                    <EmptyState variant="no-data" title="Chưa có tiền phạt" description="Tổng quan tiền phạt sẽ hiển thị khi có phạt." className="py-8" />
                  )}
                </div>
              </SectionCard>
            </div>
          </FadeItem>

          <FadeItem>
          <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
            <SectionCard title="Rủi ro tồn kho theo kho" subtitle="Biến thể sắp hết và hết hàng theo kho" icon={Warehouse}>
              {stockRisk.length ? (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[560px] text-left text-[13px]">
                    <thead className="text-[11px] uppercase text-muted-foreground">
                      <tr className="border-b border-border">
                        <th className="py-2 pr-3 font-medium">Kho</th>
                        <th className="py-2 pr-3 font-medium">Sắp hết</th>
                        <th className="py-2 pr-3 font-medium">Hết hàng</th>
                        <th className="py-2 pr-3 font-medium">Khả dụng</th>
                        <th className="py-2 pr-3 font-medium">Đang đặt</th>
                        <th className="py-2 pr-3 font-medium">Đang mượn</th>
                      </tr>
                    </thead>
                    <tbody>
                      {stockRisk.map((item) => {
                        const hasRisk = item.low_stock_variants > 0 || item.out_of_stock_variants > 0;
                        return (
                          <Fragment key={item.warehouse_id}>
                            <tr className={`border-b border-border/60 last:border-0 hover:bg-muted/30 transition-colors ${hasRisk && item.reasoning ? 'border-b-0' : ''}`}>
                              <td className="py-3 pr-3 font-medium">{item.warehouse_name}</td>
                              <td className="py-3 pr-3 text-amber-700 dark:text-amber-400 font-semibold">{item.low_stock_variants}</td>
                              <td className="py-3 pr-3 text-rose-700 dark:text-rose-400 font-semibold">{item.out_of_stock_variants}</td>
                              <td className="py-3 pr-3">{item.total_available_qty}</td>
                              <td className="py-3 pr-3">{item.total_reserved_qty}</td>
                              <td className="py-3 pr-3">{item.total_borrowed_qty}</td>
                            </tr>
                            {hasRisk && item.reasoning ? (
                              <tr className="border-b border-border/60 last:border-0">
                                <td colSpan={6} className="pb-3 pt-0 text-[11px] italic text-muted-foreground">{item.reasoning}</td>
                              </tr>
                            ) : null}
                          </Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <EmptyState variant="no-data" title="Chưa có dữ liệu tồn kho" description="Rủi ro tồn kho sẽ hiển thị sau khi có dữ liệu tồn kho." />
              )}
            </SectionCard>

            <SectionCard
              title="Mượn quá hạn"
              subtitle={`Trung bình ${overdue.average_overdue_days} ngày · ${overdue.total_overdue_loans} phiếu · lâu nhất ${overdue.oldest_overdue_days} ngày`}
              icon={Clock}
            >
              {overdue.items.length ? (
                <div className="space-y-2">
                  {overdue.items.slice(0, 6).map((item) => (
                    <div key={item.loan_id} className="flex items-center justify-between rounded-lg border border-rose-100 bg-rose-50/40 px-3 py-2 dark:border-rose-500/15 dark:bg-rose-500/5 hover:bg-rose-50 dark:hover:bg-rose-500/10 transition-colors">
                      <div className="min-w-0">
                        <p className="truncate text-[13px] font-medium">{item.loan_number}</p>
                        <p className="truncate text-[12px] text-muted-foreground">{item.customer_name}</p>
                      </div>
                      <div className="text-right shrink-0 ml-2">
                        <p className="text-[13px] font-semibold text-rose-700 dark:text-rose-400">{item.overdue_days} ngày</p>
                        <p className="text-[12px] text-muted-foreground">{item.due_date ? item.due_date.slice(0, 10) : 'Không có hạn'}</p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState variant="no-data" title="Không có mượn quá hạn" description="Tốt lắm — hiện tại không có mục mượn nào quá hạn." />
              )}
            </SectionCard>
          </div>
          </FadeItem>
        </>
      )}
    </PageWrapper>
  );
}
