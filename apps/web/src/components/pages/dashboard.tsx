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
import { PageHeader } from '@/components/ui/page-header';
import { SectionCard } from '@/components/ui/section-card';
import { StatCard } from '@/components/ui/stat-card';
import { PageWrapper, FadeItem } from '@/components/motion-utils';
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

  if (isWarehouseStaff) {
    return <Navigate to="/my-warehouse-tasks" replace />;
  }

  return (
    <PageWrapper className="space-y-6">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25 }}
        className="rounded-xl border border-border bg-card p-5 shadow-[0_1px_3px_rgba(0,0,0,0.04)] dark:shadow-none"
      >
        <PageHeader
          icon={LayoutDashboard}
          title="Bảng phân tích"
          description="Dữ liệu thời gian thực từ Kho, Mượn trả, Đặt trước, Phạt."
          actions={
            <>
              <button
                type="button"
                onClick={() => void loadDashboard()}
                disabled={loading || !canViewAnalytics}
                aria-label="Làm mới dữ liệu"
                className="inline-flex h-10 items-center gap-2 rounded-lg border border-border bg-background px-3 text-[13px] font-medium text-foreground transition hover:bg-muted disabled:opacity-60"
              >
                <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                Làm mới
              </button>
              {canViewAnalytics ? (
                <NavLink
                  to="/reports"
                  className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-3 text-[13px] font-medium text-primary-foreground transition hover:opacity-90"
                >
                  Báo cáo <ArrowRight className="h-4 w-4" />
                </NavLink>
              ) : null}
            </>
          }
        />
      </motion.div>

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
              <NavLink to="/purchase-requests?status=PENDING" className="group">
                <div className={`flex items-center gap-3 rounded-xl border p-4 transition-all hover:shadow-sm ${pendingPR > 0 ? 'border-orange-200 bg-orange-50 hover:bg-orange-100 dark:border-orange-500/20 dark:bg-orange-500/10 dark:hover:bg-orange-500/15' : 'border-border bg-card hover:bg-muted/40'}`}>
                  <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${pendingPR > 0 ? 'bg-orange-100 border border-orange-200 dark:bg-orange-500/15 dark:border-orange-500/20' : 'bg-muted border border-border'}`}>
                    <ShoppingCart className={`h-4 w-4 ${pendingPR > 0 ? 'text-orange-600 dark:text-orange-400' : 'text-muted-foreground'}`} />
                  </div>
                  <div className="min-w-0">
                    <div className={`text-xl font-bold leading-none ${pendingPR > 0 ? 'text-orange-700 dark:text-orange-400' : 'text-foreground'}`}>{pendingPR}</div>
                    <div className="text-[11px] mt-1 leading-tight text-muted-foreground">Yêu cầu mua hàng<br />chờ duyệt</div>
                  </div>
                </div>
              </NavLink>
              <NavLink to="/exception-reports?status=OPEN" className="group">
                <div className={`flex items-center gap-3 rounded-xl border p-4 transition-all hover:shadow-sm ${openER > 0 ? 'border-red-200 bg-red-50 hover:bg-red-100 dark:border-red-500/20 dark:bg-red-500/10 dark:hover:bg-red-500/15' : 'border-border bg-card hover:bg-muted/40'}`}>
                  <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${openER > 0 ? 'bg-red-100 border border-red-200 dark:bg-red-500/15 dark:border-red-500/20' : 'bg-muted border border-border'}`}>
                    <AlertTriangle className={`h-4 w-4 ${openER > 0 ? 'text-red-600 dark:text-red-400' : 'text-muted-foreground'}`} />
                  </div>
                  <div className="min-w-0">
                    <div className={`text-xl font-bold leading-none ${openER > 0 ? 'text-red-700 dark:text-red-400' : 'text-foreground'}`}>{openER}</div>
                    <div className="text-[11px] mt-1 leading-tight text-muted-foreground">Báo cáo sự cố<br />chưa xử lý</div>
                  </div>
                </div>
              </NavLink>
              <NavLink to="/inventory" className="group">
                <div className={`flex items-center gap-3 rounded-xl border p-4 transition-all hover:shadow-sm ${kpis.low_stock_variants > 0 ? 'border-amber-200 bg-amber-50 hover:bg-amber-100 dark:border-amber-500/20 dark:bg-amber-500/10 dark:hover:bg-amber-500/15' : 'border-border bg-card hover:bg-muted/40'}`}>
                  <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${kpis.low_stock_variants > 0 ? 'bg-amber-100 border border-amber-200 dark:bg-amber-500/15 dark:border-amber-500/20' : 'bg-muted border border-border'}`}>
                    <Warehouse className={`h-4 w-4 ${kpis.low_stock_variants > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground'}`} />
                  </div>
                  <div className="min-w-0">
                    <div className={`text-xl font-bold leading-none ${kpis.low_stock_variants > 0 ? 'text-amber-700 dark:text-amber-400' : 'text-foreground'}`}>{kpis.low_stock_variants}</div>
                    <div className="text-[11px] mt-1 leading-tight text-muted-foreground">Đầu sách<br />tồn kho thấp</div>
                  </div>
                </div>
              </NavLink>
              <NavLink to="/borrow/loans?status=OVERDUE" className="group">
                <div className={`flex items-center gap-3 rounded-xl border p-4 transition-all hover:shadow-sm ${kpis.overdue_loans > 0 ? 'border-rose-200 bg-rose-50 hover:bg-rose-100 dark:border-rose-500/20 dark:bg-rose-500/10 dark:hover:bg-rose-500/15' : 'border-border bg-card hover:bg-muted/40'}`}>
                  <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${kpis.overdue_loans > 0 ? 'bg-rose-100 border border-rose-200 dark:bg-rose-500/15 dark:border-rose-500/20' : 'bg-muted border border-border'}`}>
                    <Clock className={`h-4 w-4 ${kpis.overdue_loans > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-muted-foreground'}`} />
                  </div>
                  <div className="min-w-0">
                    <div className={`text-xl font-bold leading-none ${kpis.overdue_loans > 0 ? 'text-rose-700 dark:text-rose-400' : 'text-foreground'}`}>{kpis.overdue_loans}</div>
                    <div className="text-[11px] mt-1 leading-tight text-muted-foreground">Phiếu mượn<br />quá hạn</div>
                  </div>
                </div>
              </NavLink>
              <NavLink to="/borrow/fines?status=UNPAID" className="group">
                <div className={`flex items-center gap-3 rounded-xl border p-4 transition-all hover:shadow-sm ${fines.unpaid_count > 0 ? 'border-violet-200 bg-violet-50 hover:bg-violet-100 dark:border-violet-500/20 dark:bg-violet-500/10 dark:hover:bg-violet-500/15' : 'border-border bg-card hover:bg-muted/40'}`}>
                  <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${fines.unpaid_count > 0 ? 'bg-violet-100 border border-violet-200 dark:bg-violet-500/15 dark:border-violet-500/20' : 'bg-muted border border-border'}`}>
                    <Receipt className={`h-4 w-4 ${fines.unpaid_count > 0 ? 'text-violet-600 dark:text-violet-400' : 'text-muted-foreground'}`} />
                  </div>
                  <div className="min-w-0">
                    <div className={`text-xl font-bold leading-none ${fines.unpaid_count > 0 ? 'text-violet-700 dark:text-violet-400' : 'text-foreground'}`}>{fines.unpaid_count}</div>
                    <div className="text-[11px] mt-1 leading-tight text-muted-foreground">Tiền phạt<br />chưa thu</div>
                  </div>
                </div>
              </NavLink>
            </div>
          </FadeItem>

          <FadeItem>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
              <StatCard label="Đầu sách" value={kpis.total_titles} icon={BookOpen} variant="default" animateValue />
              <StatCard label="Bản sao" value={kpis.total_copies} icon={Package} variant="success" animateValue />
              <StatCard label="Đang mượn" value={kpis.active_loans} icon={BookMarked} variant="info" animateValue />
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
                  <div className="rounded-lg border border-border p-3">
                    <p className="text-[11px] uppercase text-muted-foreground">Chưa trả</p>
                    <p className="mt-1 text-[18px] font-semibold">{formatMoney(fines.total_unpaid)}</p>
                  </div>
                  <div className="rounded-lg border border-border p-3">
                    <p className="text-[11px] uppercase text-muted-foreground">Đã trả</p>
                    <p className="mt-1 text-[18px] font-semibold">{formatMoney(fines.total_paid)}</p>
                  </div>
                  <div className="rounded-lg border border-border p-3">
                    <p className="text-[11px] uppercase text-muted-foreground">Miễn giảm</p>
                    <p className="mt-1 text-[18px] font-semibold">{formatMoney(fines.total_waived)}</p>
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
                      {stockRisk.map((item) => (
                        <tr key={item.warehouse_id} className="border-b border-border/60 last:border-0">
                          <td className="py-3 pr-3 font-medium">{item.warehouse_name}</td>
                          <td className="py-3 pr-3 text-amber-700 dark:text-amber-400">{item.low_stock_variants}</td>
                          <td className="py-3 pr-3 text-rose-700 dark:text-rose-400">{item.out_of_stock_variants}</td>
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

            <SectionCard title="Mượn quá hạn" subtitle={`Trung bình ${overdue.average_overdue_days} ngày quá hạn`} icon={Clock}>
              {overdue.items.length ? (
                <div className="space-y-2">
                  {overdue.items.slice(0, 6).map((item) => (
                    <div key={item.loan_id} className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
                      <div className="min-w-0">
                        <p className="truncate text-[13px] font-medium">{item.loan_number}</p>
                        <p className="truncate text-[12px] text-muted-foreground">{item.customer_name}</p>
                      </div>
                      <div className="text-right">
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
