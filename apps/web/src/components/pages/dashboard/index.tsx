import { useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate, NavLink } from 'react-router';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowRight, Bell, LayoutDashboard, RefreshCw, ShieldOff } from 'lucide-react';
import { EmptyState } from '@/components/ui/empty-state';
import { SectionCard } from '@/components/ui/section-card';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import { PageWrapper, FadeItem } from '@/components/motion-utils';
import {
  analyticsService,
  type BorrowTrendItem,
  type TopBookItem,
} from '@/services/analytics';
import { getApiErrorMessage, hasAnyPermission } from '@/services/http-clients';
import { toast } from 'sonner';
import { authService } from '@/services/auth';
import { purchaseRequestService } from '@/services/purchase-requests';
import { exceptionReportService } from '@/services/exception-reports';
import { useBorrowRealtime } from '@/hooks/useBorrowRealtime';
import { useInventoryRealtime } from '@/hooks/useInventoryRealtime';
import { DashboardSkeleton } from './dashboard-skeleton';
import { DecisionCenter } from './decision-center';
import { KpiGrid } from './kpi-grid';
import { TrendFunnelSection } from './trend-funnel-section';
import { TopBooksFinesSection } from './top-books-fines-section';
import { StockRiskOverdueSection } from './stock-risk-overdue-section';
import {
  ANALYTICS_PERMISSIONS,
  emptyFines,
  emptyFunnel,
  emptyKpis,
  emptyOverdue,
  emptyReorderSummary,
  type DashboardState,
} from './types';
import { compactTitle, getGreeting } from './utils';

function compactBook(item: TopBookItem) {
  return { ...item, name: compactTitle(item.title) };
}

function labelTrend(item: BorrowTrendItem) {
  return { ...item, label: item.date.length === 10 ? item.date.slice(5) : item.date };
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

  const trendData = useMemo(() => (dashboard?.trends || []).map(labelTrend), [dashboard?.trends]);
  const topBookData = useMemo(() => (dashboard?.topBooks || []).map(compactBook), [dashboard?.topBooks]);

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
        <DashboardSkeleton />
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
          <FadeItem>
            <DecisionCenter
              pendingPR={pendingPR}
              openER={openER}
              lowStockVariants={kpis.low_stock_variants}
              overdueLoans={kpis.overdue_loans}
              unpaidFineCount={fines.unpaid_count}
              unpaidFineAmount={kpis.unpaid_fine_amount}
              highPriorityReorder={reorderSummary.high_priority}
            />
          </FadeItem>

          <FadeItem>
            <KpiGrid kpis={kpis} overdueTotalItems={overdue.total_overdue_items} />
          </FadeItem>

          <FadeItem>
            <div className="mb-3">
              <h2 className="text-[15px] font-semibold text-foreground">Phân tích &amp; xu hướng</h2>
              <p className="text-[12px] text-muted-foreground mt-0.5">Dữ liệu lịch sử để theo dõi hiệu suất theo thời gian</p>
            </div>
            <TrendFunnelSection
              trendData={trendData}
              funnelData={funnelData}
              kpis={kpis}
              conversionRate={dashboard?.funnel.conversion_rate || 0}
            />
          </FadeItem>

          <FadeItem>
            <TopBooksFinesSection topBookData={topBookData} fines={fines} />
          </FadeItem>

          <FadeItem>
            <StockRiskOverdueSection stockRisk={stockRisk} overdue={overdue} />
          </FadeItem>
        </>
      )}
    </PageWrapper>
  );
}
