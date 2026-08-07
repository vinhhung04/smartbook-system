import { useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate, NavLink } from 'react-router';
import { motion } from 'motion/react';
import {
  AlertTriangle,
  ArrowRight,
  Ban,
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
import { PageWrapper, FadeItem, AnimatedCounter } from '@/components/motion-utils';
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
import { purchaseRequestService } from '@/services/purchase-requests';
import { exceptionReportService } from '@/services/exception-reports';

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
    active: 'border-orange-200 bg-orange-50 hover:bg-orange-100 dark:border-orange-500/20 dark:bg-orange-500/10 dark:hover:bg-orange-500/15',
    iconActive: 'bg-orange-100 border-orange-200 dark:bg-orange-500/15 dark:border-orange-500/20',
    iconColorActive: 'text-orange-600 dark:text-orange-400',
    textActive: 'text-orange-700 dark:text-orange-400',
  },
  red: {
    active: 'border-red-200 bg-red-50 hover:bg-red-100 dark:border-red-500/20 dark:bg-red-500/10 dark:hover:bg-red-500/15',
    iconActive: 'bg-red-100 border-red-200 dark:bg-red-500/15 dark:border-red-500/20',
    iconColorActive: 'text-red-600 dark:text-red-400',
    textActive: 'text-red-700 dark:text-red-400',
  },
  amber: {
    active: 'border-amber-200 bg-amber-50 hover:bg-amber-100 dark:border-amber-500/20 dark:bg-amber-500/10 dark:hover:bg-amber-500/15',
    iconActive: 'bg-amber-100 border-amber-200 dark:bg-amber-500/15 dark:border-amber-500/20',
    iconColorActive: 'text-amber-600 dark:text-amber-400',
    textActive: 'text-amber-700 dark:text-amber-400',
  },
  rose: {
    active: 'border-rose-200 bg-rose-50 hover:bg-rose-100 dark:border-rose-500/20 dark:bg-rose-500/10 dark:hover:bg-rose-500/15',
    iconActive: 'bg-rose-100 border-rose-200 dark:bg-rose-500/15 dark:border-rose-500/20',
    iconColorActive: 'text-rose-600 dark:text-rose-400',
    textActive: 'text-rose-700 dark:text-rose-400',
  },
  violet: {
    active: 'border-violet-200 bg-violet-50 hover:bg-violet-100 dark:border-violet-500/20 dark:bg-violet-500/10 dark:hover:bg-violet-500/15',
    iconActive: 'bg-violet-100 border-violet-200 dark:bg-violet-500/15 dark:border-violet-500/20',
    iconColorActive: 'text-violet-600 dark:text-violet-400',
    textActive: 'text-violet-700 dark:text-violet-400',
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

      const [prRes, erRes] = await Promise.allSettled([
        purchaseRequestService.getAll({ status: 'PENDING', limit: 1 }),
        exceptionReportService.getAll({ status: 'OPEN', limit: 1 }),
      ]);
      setPendingPR(prRes.status === 'fulfilled' ? (prRes.value.total ?? prRes.value.data?.length ?? 0) : 0);
      setOpenER(erRes.status === 'fulfilled' ? (erRes.value.total ?? erRes.value.data?.length ?? 0) : 0);
    } catch (err) {
      const message = getApiErrorMessage(err, 'Failed to load analytics dashboard.');
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }, [canViewAnalytics, isWarehouseStaff]);

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
  const totalActionable = pendingPR + openER + kpis.low_stock_variants + kpis.overdue_loans + fines.unpaid_count;

  if (isWarehouseStaff) {
    return <Navigate to="/my-warehouse-tasks" replace />;
  }

  return (
    <>
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="relative overflow-hidden bg-gradient-to-br from-slate-950 via-indigo-950 to-slate-900"
      >
        <div className="pointer-events-none absolute -top-24 -right-24 h-72 w-72 rounded-full bg-indigo-500/30 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-32 left-1/3 h-80 w-80 rounded-full bg-blue-500/20 blur-3xl" />

        <div className="relative max-w-7xl mx-auto px-6 py-8 lg:px-8 lg:py-10">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-start gap-4">
              <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-white/25 bg-white/15 backdrop-blur">
                <LayoutDashboard className="h-6 w-6 text-white" />
              </div>
              <div>
                <p className="text-[13px] font-medium capitalize text-white/80">{todayLabel}</p>
                <h1 className="mt-0.5 text-2xl font-bold text-white">
                  {greeting}{currentUser?.full_name ? `, ${currentUser.full_name}` : ''}
                </h1>
                <p className="mt-1.5 text-[13px] text-white/85">
                  {canViewAnalytics && !loading && !error
                    ? totalActionable > 0
                      ? `Bạn có ${totalActionable} việc cần xử lý hôm nay.`
                      : 'Không có việc gì khẩn cấp hôm nay — mọi thứ đang ổn định.'
                    : 'Dữ liệu thời gian thực từ Kho, Mượn trả, Đặt trước, Phạt.'}
                </p>
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => void loadDashboard()}
                disabled={!canViewAnalytics}
                loading={loading}
                aria-label="Làm mới dữ liệu"
                className="border-white/30 bg-white/10 text-white hover:bg-white/20"
              >
                <RefreshCw className="h-4 w-4" />
                Làm mới
              </Button>
              {canViewAnalytics ? (
                <Button type="button" asChild className="bg-white text-indigo-700 hover:bg-white/90">
                  <NavLink to="/reports">
                    Báo cáo <ArrowRight className="h-4 w-4" />
                  </NavLink>
                </Button>
              ) : null}
            </div>
          </div>
        </div>
      </motion.div>

      <PageWrapper className="space-y-6">
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
            <div className="grid gap-3 grid-cols-2 lg:grid-cols-5">
              {([
                { to: '/purchase-requests?status=PENDING', icon: ShoppingCart, count: pendingPR, label: ['Yêu cầu mua hàng', 'chờ duyệt'], color: 'orange' },
                { to: '/exception-reports?status=OPEN', icon: AlertTriangle, count: openER, label: ['Báo cáo sự cố', 'chưa xử lý'], color: 'red' },
                { to: '/inventory', icon: Warehouse, count: kpis.low_stock_variants, label: ['Đầu sách', 'tồn kho thấp'], color: 'amber' },
                { to: '/borrow/loans?status=OVERDUE', icon: Clock, count: kpis.overdue_loans, label: ['Phiếu mượn', 'quá hạn'], color: 'rose' },
                { to: '/borrow/fines?status=UNPAID', icon: Receipt, count: fines.unpaid_count, label: ['Tiền phạt', 'chưa thu'], color: 'violet' },
              ] as const).map((item, index) => {
                const active = item.count > 0;
                const colors = DECISION_COLORS[item.color];
                const Icon = item.icon;
                return (
                  <NavLink key={item.to} to={item.to} className="group">
                    <motion.div
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.25, delay: index * 0.04 }}
                      whileHover={{ y: -2 }}
                      className={`flex items-center gap-3 rounded-xl border p-4 transition-colors hover:shadow-sm cursor-pointer ${active ? colors.active : 'border-border bg-card hover:bg-muted/40'}`}
                    >
                      <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border ${active ? colors.iconActive : 'bg-muted border-border'}`}>
                        <Icon className={`h-4 w-4 ${active ? colors.iconColorActive : 'text-muted-foreground'}`} />
                      </div>
                      <div className="min-w-0">
                        <div className={`text-xl font-bold leading-none ${active ? colors.textActive : 'text-foreground'}`}>{item.count}</div>
                        <div className="text-[11px] mt-1 leading-tight text-muted-foreground">{item.label[0]}<br />{item.label[1]}</div>
                      </div>
                    </motion.div>
                  </NavLink>
                );
              })}
            </div>
          </FadeItem>

          <FadeItem>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4 md:auto-rows-[minmax(120px,1fr)] md:grid-flow-dense lg:grid-cols-6">
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
              <StatCard label="Đặt trước" value={kpis.pending_reservations} icon={FileText} variant="primary" animateValue />
              <StatCard label="Đã xác nhận" value={kpis.confirmed_reservations} icon={PackageCheck} variant="success" animateValue />
              <StatCard label="Sẵn lấy" value={kpis.ready_for_pickup_reservations} icon={TicketCheck} variant="info" animateValue />
              <StatCard label="Sắp hết hạn lấy" value={kpis.pickup_codes_expiring_soon} icon={Clock} variant="warning" animateValue />
              <StatCard label="Tỷ lệ nhận sách" value={formatPercent(kpis.reservation_conversion_rate)} icon={TrendingUp} variant="success" />
              <StatCard label="Mục quá hạn" value={overdue.total_overdue_items} icon={AlertTriangle} variant="danger" animateValue />
            </div>
          </FadeItem>

          <FadeItem>
            <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
              <section className="xl:col-span-2">
                <SectionCard title="Xu hướng mượn trả" subtitle="Lượt mượn, trả và đặt trước trong khoảng thời gian gần nhất" icon={TrendingUp} className="relative overflow-hidden">
                  <div className="absolute top-0 left-0 right-0 h-[3px] bg-gradient-to-r from-blue-500 to-cyan-500" />
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

              <SectionCard title="Phễu đặt trước" subtitle={`Tỷ lệ chuyển đổi ${formatPercent(dashboard?.funnel.conversion_rate || 0)}`} icon={TicketCheck} className="relative overflow-hidden">
                <div className="absolute top-0 left-0 right-0 h-[3px] bg-gradient-to-r from-violet-500 to-purple-500" />
                {funnelData.some((item) => item.value > 0) ? (
                  <ResponsiveContainer width="100%" height={300}>
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
              <SectionCard title="Sách mượn nhiều nhất" subtitle="Xếp hạng theo số lượt mượn" icon={Crown} className="relative overflow-hidden">
                <div className="absolute top-0 left-0 right-0 h-[3px] bg-gradient-to-r from-amber-500 to-orange-500" />
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

              <SectionCard title="Tổng quan tiền phạt" subtitle="Số tiền chưa trả, đã trả và miễn giảm" icon={Receipt} className="relative overflow-hidden">
                <div className="absolute top-0 left-0 right-0 h-[3px] bg-gradient-to-r from-rose-500 to-pink-500" />
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
            <SectionCard title="Rủi ro tồn kho theo kho" subtitle="Biến thể sắp hết và hết hàng theo kho" icon={Warehouse} className="relative overflow-hidden">
              <div className="absolute top-0 left-0 right-0 h-[3px] bg-gradient-to-r from-amber-500 to-red-500" />
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
                      {stockRisk.map((item) => (
                        <tr key={item.warehouse_id} className="border-b border-border/60 last:border-0 hover:bg-muted/30 transition-colors">
                          <td className="py-3 pr-3 font-medium">{item.warehouse_name}</td>
                          <td className="py-3 pr-3 text-amber-700 dark:text-amber-400 font-semibold">{item.low_stock_variants}</td>
                          <td className="py-3 pr-3 text-rose-700 dark:text-rose-400 font-semibold">{item.out_of_stock_variants}</td>
                          <td className="py-3 pr-3">{item.total_available_qty}</td>
                          <td className="py-3 pr-3">{item.total_reserved_qty}</td>
                          <td className="py-3 pr-3">{item.total_borrowed_qty}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <EmptyState variant="no-data" title="Chưa có dữ liệu tồn kho" description="Rủi ro tồn kho sẽ hiển thị sau khi có dữ liệu tồn kho." />
              )}
            </SectionCard>

            <SectionCard title="Mượn quá hạn" subtitle={`Trung bình ${overdue.average_overdue_days} ngày quá hạn`} icon={Clock} className="relative overflow-hidden">
              <div className="absolute top-0 left-0 right-0 h-[3px] bg-gradient-to-r from-rose-500 to-red-500" />
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
    </>
  );
}
