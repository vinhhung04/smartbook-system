import { useCallback, useEffect, useRef, useState } from 'react';
import { Navigate, NavLink } from 'react-router';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowRight, Bell, RefreshCw, ShieldOff } from 'lucide-react';
import { EmptyState } from '@/components/ui/empty-state';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { PageWrapper } from '@/components/motion-utils';
import { cn } from '@/components/ui/utils';
import { analyticsService } from '@/services/analytics';
import { gatewayAPI, getApiErrorMessage, hasAnyPermission, hasPermission } from '@/services/http-clients';
import { toast } from 'sonner';
import { authService } from '@/services/auth';
import { canAccess, ROUTE_ACCESS } from '@/lib/rbac';
import { purchaseRequestService } from '@/services/purchase-requests';
import { exceptionReportService } from '@/services/exception-reports';
import { stockAuditService } from '@/services/stock-audit';
import { transferReceivingService } from '@/services/transfer-receiving';
import { WarehouseFilter } from '@/components/analytics/warehouse-filter';
import { useWarehouseFilter, WAREHOUSE_PARAM } from '@/hooks/useWarehouseFilter';
import { useBorrowRealtime } from '@/hooks/useBorrowRealtime';
import { useInventoryRealtime } from '@/hooks/useInventoryRealtime';
import { DashboardSkeleton } from './dashboard-skeleton';
import { DecisionCenter } from './decision-center';
import { AI_RISK_LIMIT, AiRiskSection } from './ai-risk-section';
import { ActivityFeed, FEED_SIZE, type AuditLogEntry, type LiveEvent } from './activity-feed';
import { DEFAULT_PERIOD, PERIOD_OPTIONS, periodParams, type Period } from './period';
import { buildDecisionItems, type ActionItem } from './decision-items';
import { KpiGrid } from './kpi-grid';
import { GroupHeading, Panel } from './panel';
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
import { formatNumber, formatTime, getGreeting } from './utils';

const TOP_BOOKS_LIMIT = 8;

/** What changed since the last load, in the words the banner uses. */
const SOURCE_LABELS = {
  loans: 'phiếu mượn',
  reservations: 'đặt trước',
  fines: 'tiền phạt',
  stock: 'tồn kho',
  purchaseRequests: 'yêu cầu mua hàng',
} as const;
type ChangeSource = keyof typeof SOURCE_LABELS;

type LoadStatus = 'loading' | 'ready' | 'error';

function settled<T>(result: PromiseSettledResult<T | undefined>, fallback: T): T | null {
  return result.status === 'fulfilled' ? (result.value ?? fallback) : null;
}

function settledList<T>(result: PromiseSettledResult<T[] | undefined>): T[] | null {
  if (result.status !== 'fulfilled') return null;
  return Array.isArray(result.value) ? result.value : [];
}

/** Links and action rows follow the same route guards the router enforces. */
function routeAccess() {
  const user = authService.getCurrentUser();
  return {
    borrow: canAccess(user, ROUTE_ACCESS.borrowRead),
    catalog: canAccess(user, ROUTE_ACCESS.catalog),
    inventory: canAccess(user, ROUTE_ACCESS.managerInventoryRead),
    purchaseRequests: canAccess(user, ROUTE_ACCESS.purchaseRequestManage),
    exceptions: canAccess(user, ROUTE_ACCESS.exceptionReportManage),
    reorder: canAccess(user, ROUTE_ACCESS.reports),
    reports: canAccess(user, ROUTE_ACCESS.reports),
    audit: canAccess(user, ROUTE_ACCESS.admin),
    stockAudits: canAccess(user, ROUTE_ACCESS.inventoryAuditRead),
    transferReceiving: canAccess(user, ROUTE_ACCESS.staffTaskProgress),
  };
}

type FetchResult = { state: DashboardState } | { error: string };

/** Every block is requested at once and settles on its own; only a total failure is an error. */
async function fetchActivity(): Promise<AuditLogEntry[]> {
  const response = await gatewayAPI.get('/borrow/audit-logs', { params: { page: 1, pageSize: FEED_SIZE } });
  return response.data?.data ?? [];
}

/** The two period-scoped reads; also reloaded on their own when the period changes. */
/** `warehouseId` ('' = every warehouse in the caller's scope) narrows each scoped read. */
function fetchPeriodBlocks(period: Period, warehouseId: string) {
  const { from, granularity } = periodParams(period);
  const wh = warehouseId ? { warehouseId } : {};
  return [
    analyticsService.getBorrowTrends({ granularity, from, ...wh }),
    analyticsService.getTopBooks({ limit: TOP_BOOKS_LIMIT, from, ...wh }),
  ] as const;
}

async function fetchDashboard(borrow: boolean, period: Period, warehouseId: string): Promise<FetchResult> {
  const {
    borrow: canSeeAudit, purchaseRequests: canSeePR, exceptions: canSeeER, reorder: canSeeReorder,
    stockAudits: canSeeAudits, transferReceiving: canSeeTransfers,
  } = routeAccess();
  const skip = Promise.resolve(undefined);
  const [trendsRequest, topBooksRequest] = borrow ? fetchPeriodBlocks(period, warehouseId) : [skip, skip];
  const wh = warehouseId ? { warehouseId } : undefined;
  const whId = warehouseId || undefined;
  // The borrow audit log has no warehouse filter: the feed is shown only for "all warehouses".
  const withActivity = borrow && canSeeAudit && !warehouseId;

  const results = await Promise.allSettled([
    analyticsService.getDashboardKpis(wh),
    trendsRequest,
    topBooksRequest,
    borrow ? analyticsService.getOverdueSummary(wh) : skip,
    borrow ? analyticsService.getFineSummary(wh) : skip,
    analyticsService.getWarehouseStockRisk(wh),
    borrow ? analyticsService.getReservationFunnel(wh) : skip,
    canSeePR ? purchaseRequestService.getAll({ status: 'PENDING', limit: 1, warehouse_id: whId }) : skip,
    canSeeER ? exceptionReportService.getAll({ status: 'OPEN', limit: 1, warehouse_id: whId }) : skip,
    canSeeReorder ? analyticsService.getReorderSuggestions({ priority: 'ALL', limit: 1, ...wh }) : skip,
    borrow ? analyticsService.getLateReturnRisk({ limit: AI_RISK_LIMIT, ...wh }) : skip,
    borrow ? analyticsService.getReservationNoShowRisk({ limit: AI_RISK_LIMIT, ...wh }) : skip,
    withActivity ? fetchActivity() : skip,
    canSeeAudits ? stockAuditService.getAll({ status: 'SUBMITTED', warehouse_id: whId }) : skip,
    canSeeTransfers ? transferReceivingService.getQueue(whId) : skip,
  ]);
  const [kpis, trends, topBooks, overdue, fines, stockRisk, funnel, pr, er, reorder, lateRisk, noShowRisk, activity, audits, transfers] = results;
  const requested = [true, borrow, borrow, borrow, borrow, true, borrow, canSeePR, canSeeER, canSeeReorder, borrow, borrow, withActivity, canSeeAudits, canSeeTransfers];
  const failures = results.filter((result, index) => requested[index] && result.status === 'rejected') as PromiseRejectedResult[];
  if (failures.length === requested.filter(Boolean).length) {
    return { error: getApiErrorMessage(failures[0]?.reason, 'Không tải được bảng điều khiển.') };
  }

  const count = (result: PromiseSettledResult<{ total?: number; data?: unknown[] } | undefined>, enabled: boolean) => {
    if (!enabled || result.status !== 'fulfilled') return null;
    return result.value?.total ?? result.value?.data?.length ?? 0;
  };
  return {
    state: {
      kpis: settled(kpis, emptyKpis),
      trends: borrow ? settledList(trends) : null,
      topBooks: borrow ? settledList(topBooks) : null,
      overdue: borrow ? settled(overdue, emptyOverdue) : null,
      fines: borrow ? settled(fines, emptyFines) : null,
      stockRisk: settledList(stockRisk),
      funnel: borrow ? settled(funnel, emptyFunnel) : null,
      pendingPR: count(pr, canSeePR),
      openER: count(er, canSeeER),
      submittedAudits: count(audits, canSeeAudits),
      inboundTransfers: count(transfers, canSeeTransfers),
      reorder: canSeeReorder && reorder.status === 'fulfilled' ? (reorder.value?.summary || emptyReorderSummary) : null,
      lateRisk: borrow && lateRisk.status === 'fulfilled' ? lateRisk.value ?? null : null,
      noShowRisk: borrow && noShowRisk.status === 'fulfilled' ? noShowRisk.value ?? null : null,
      activity: withActivity ? settledList(activity) : null,
    },
  };
}

function headerFinding(status: LoadStatus, items: ActionItem[]) {
  if (status === 'loading') return 'Đang tải số liệu thư viện và kho vận…';
  if (status === 'error') return 'Chưa tải được số liệu, hãy thử lại.';
  const open = items.filter((item) => item.count !== null && item.count > 0);
  const missing = items.some((item) => item.count === null) ? ' Một số số liệu chưa tải được.' : '';
  if (!open.length) return missing ? 'Một số số liệu chưa tải được, chưa thể tổng hợp việc cần xử lý.' : 'Không có việc tồn đọng, mọi thứ đang ổn định.';
  const lead = open.find((item) => item.severity === 'urgent') ?? open[0];
  const leadFigure = lead.value ?? formatNumber(lead.count ?? 0);
  return `${formatNumber(open.length)} đầu việc đang mở, gấp nhất: ${leadFigure} ${lead.label.charAt(0).toLowerCase()}${lead.label.slice(1)}.${missing}`;
}

export function DashboardPage() {
  const [status, setStatus] = useState<LoadStatus>('loading');
  const [error, setError] = useState<string | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [dashboard, setDashboard] = useState<DashboardState | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [changes, setChanges] = useState<ChangeSource[]>([]);
  const [live, setLive] = useState<LiveEvent[]>([]);
  const [period, setPeriod] = useState<Period>(DEFAULT_PERIOD);
  const [periodLoading, setPeriodLoading] = useState(false);
  const { warehouses, warehouseId, setWarehouseId, selected: selectedWarehouse } = useWarehouseFilter();
  // The figures on screen stay until the picked warehouse's figures land (the header says it is updating).
  const pickWarehouse = (next: string) => {
    if (next === warehouseId) return;
    setRefreshing(true);
    setWarehouseId(next);
  };
  const hasData = useRef(false);
  const liveSeq = useRef(0);
  // Refresh keeps whatever period is on screen; changePeriod moves it.
  const periodRef = useRef(period);

  const canViewAnalytics = hasAnyPermission(ANALYTICS_PERMISSIONS);
  // Borrow-domain analytics need analytics.borrow.read (admin, manager, librarian; own scope).
  const canViewBorrowAnalytics = hasPermission('analytics.borrow.read');
  const currentUser = authService.getCurrentUser();
  const roles = (currentUser?.roles || []).map((role) => role.toUpperCase());
  const isWarehouseStaff = roles.includes('WAREHOUSE_STAFF');
  const access = routeAccess();

  const applyResult = useCallback((result: FetchResult) => {
    if ('error' in result) {
      toast.error(result.error);
      // A failed refresh keeps the figures already on screen; only a failed first load replaces them.
      if (hasData.current) setRefreshError(result.error);
      else {
        setError(result.error);
        setStatus('error');
      }
    } else {
      hasData.current = true;
      setDashboard(result.state);
      setError(null);
      setStatus('ready');
      setUpdatedAt(new Date());
      setChanges([]);
      // The reloaded audit log now holds these events; keep only what arrives after this load.
      setLive([]);
    }
    setRefreshing(false);
  }, []);

  const enabled = canViewAnalytics && !isWarehouseStaff;

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void fetchDashboard(canViewBorrowAnalytics, periodRef.current, warehouseId).then((result) => {
      if (!cancelled) applyResult(result);
    });
    return () => {
      cancelled = true;
    };
  }, [enabled, canViewBorrowAnalytics, applyResult, warehouseId]);

  const markChanged = useCallback((source: ChangeSource) => {
    if (status !== 'ready') return;
    setChanges((current) => (current.includes(source) ? current : [...current, source]));
  }, [status]);

  const pushLive = useCallback((name: string) => {
    liveSeq.current += 1;
    const event = { id: String(liveSeq.current), name, at: new Date().toISOString() };
    setLive((current) => [event, ...current].slice(0, FEED_SIZE));
  }, []);

  useBorrowRealtime({
    onLoanEvent: (name) => { markChanged('loans'); pushLive(name); },
    onReservationEvent: (name) => { markChanged('reservations'); pushLive(name); },
    onFineEvent: (name) => { markChanged('fines'); pushLive(name); },
  });
  useInventoryRealtime({
    onStockEvent: () => markChanged('stock'),
    onPurchaseRequestEvent: () => markChanged('purchaseRequests'),
  });

  if (isWarehouseStaff) {
    return <Navigate to="/my-warehouse-tasks" replace />;
  }

  const decisionItems = dashboard
    ? buildDecisionItems({
      canViewBorrow: canViewBorrowAnalytics,
      access,
      kpis: dashboard.kpis,
      overdue: dashboard.overdue,
      fines: dashboard.fines,
      pendingPR: dashboard.pendingPR,
      openER: dashboard.openER,
      reorder: dashboard.reorder,
      submittedAudits: dashboard.submittedAudits,
      inboundTransfers: dashboard.inboundTransfers,
    })
    : [];

  const now = new Date();
  const todayLabel = now.toLocaleDateString('vi-VN', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' });
  const greeting = `${getGreeting(now.getHours())}${currentUser?.full_name ? `, ${currentUser.full_name}` : ''}.`;
  const finding = canViewAnalytics ? headerFinding(status, decisionItems) : 'Tài khoản của bạn chưa được cấp quyền xem số liệu phân tích.';
  const retry = () => {
    if (!enabled) return;
    setRefreshing(true);
    setRefreshError(null);
    void fetchDashboard(canViewBorrowAnalytics, periodRef.current, warehouseId).then(applyResult);
  };

  /** Only the trend and the ranking depend on the period; the rest of the page stays as it is. */
  const changePeriod = (next: Period) => {
    if (next === period) return;
    setPeriod(next);
    periodRef.current = next;
    setPeriodLoading(true);
    void Promise.allSettled(fetchPeriodBlocks(next, warehouseId)).then(([trends, topBooks]) => {
      if (periodRef.current !== next) return;
      setDashboard((current) => (current ? { ...current, trends: settledList(trends), topBooks: settledList(topBooks) } : current));
      setPeriodLoading(false);
    });
  };
  const periodLabel = PERIOD_OPTIONS.find((option) => option.value === period)?.label ?? '';

  return (
    <PageWrapper className="@container space-y-5">
      <PageHeader
        title="Tổng quan vận hành"
        description={(
          <>
            {greeting} <span className="text-foreground">{finding}</span>
            {selectedWarehouse ? <> Đang xem riêng <strong className="font-semibold text-foreground">{selectedWarehouse.name}</strong>.</> : null}
          </>
        )}
        actions={(
          <>
            {canViewAnalytics ? <WarehouseFilter warehouses={warehouses} value={warehouseId} onChange={pickWarehouse} /> : null}
            <p className="mr-2 text-[12px] leading-5 text-muted-foreground sm:text-right">
              <span className="block capitalize">{todayLabel}</span>
              <span className="block tabular-nums" aria-live="polite">
                {refreshing && dashboard ? 'Đang cập nhật…' : updatedAt ? `Cập nhật lúc ${formatTime(updatedAt)}` : ' '}
              </span>
            </p>
            <Button type="button" variant="outline" onClick={retry} disabled={!canViewAnalytics || refreshing} aria-busy={refreshing}>
              <RefreshCw className={cn('h-4 w-4', refreshing && 'animate-spin motion-reduce:animate-none')} aria-hidden="true" />
              Làm mới
            </Button>
            {canViewAnalytics && access.reports ? (
              <Button type="button" asChild>
                <NavLink to={warehouseId ? `/reports?${WAREHOUSE_PARAM}=${warehouseId}` : '/reports'}>
                  Báo cáo <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </NavLink>
              </Button>
            ) : null}
          </>
        )}
      />

      <AnimatePresence initial={false}>
        {changes.length > 0 && (
          <motion.div
            key="new-data"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-primary/25 bg-primary/5 px-4 py-2.5">
              <p className="flex min-w-0 items-center gap-2 text-[13px] text-foreground">
                <Bell className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                <span>
                  Có thay đổi mới về {changes.map((source) => SOURCE_LABELS[source]).join(', ')}
                  {updatedAt ? ` sau lần cập nhật lúc ${formatTime(updatedAt)}` : ''}. Số liệu bên dưới có thể đã cũ.
                </span>
              </p>
              <Button type="button" size="sm" variant="default-outline" onClick={retry} disabled={refreshing}>
                <RefreshCw className={cn('h-3.5 w-3.5', refreshing && 'animate-spin motion-reduce:animate-none')} aria-hidden="true" />
                Cập nhật ngay
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {refreshError ? (
        <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-[13px] text-rose-800 dark:border-rose-500/25 dark:bg-rose-500/10 dark:text-rose-200">
          Không làm mới được: {refreshError} Đang hiển thị số liệu lúc {updatedAt ? formatTime(updatedAt) : '—'}.
        </p>
      ) : null}

      {!canViewAnalytics ? (
        <Panel titleId="no-permission-title">
          <h2 id="no-permission-title" className="sr-only">Không có quyền xem phân tích</h2>
          <EmptyState
            variant="no-permission"
            icon={ShieldOff}
            title="Không có quyền xem phân tích"
            description="Liên hệ quản trị viên để được cấp quyền xem báo cáo và phân tích."
          />
        </Panel>
      ) : status === 'loading' ? (
        <DashboardSkeleton canViewBorrow={canViewBorrowAnalytics} withFeed={access.borrow && !warehouseId} />
      ) : status === 'error' || !dashboard ? (
        <Panel titleId="dashboard-error-title">
          <h2 id="dashboard-error-title" className="sr-only">Không tải được bảng điều khiển</h2>
          <EmptyState
            variant="error"
            title="Không tải được bảng điều khiển"
            description={error || 'Đã xảy ra lỗi khi tải số liệu.'}
            action={(
              <Button type="button" onClick={retry} disabled={refreshing}>
                <RefreshCw className={cn('h-4 w-4', refreshing && 'animate-spin motion-reduce:animate-none')} aria-hidden="true" /> Thử lại
              </Button>
            )}
          />
        </Panel>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-5 @5xl:grid-cols-12">
            <DecisionCenter items={decisionItems} />
            <KpiGrid canViewBorrow={canViewBorrowAnalytics} access={access} kpis={dashboard.kpis} stockRisk={dashboard.stockRisk} onRetry={retry} />
          </div>

          {canViewBorrowAnalytics ? (
            <div className="grid grid-cols-1 gap-5 @5xl:grid-cols-12">
              {/* The feed reads the borrow desk's audit log (no per-warehouse filter); without it the risk block takes the row. */}
              {access.borrow && !warehouseId ? (
                <>
                  <AiRiskSection late={dashboard.lateRisk} noShow={dashboard.noShowRisk} canOpen={access.reorder} onRetry={retry} />
                  <ActivityFeed logs={dashboard.activity} live={live} canOpenAudit={access.audit} onRetry={retry} />
                </>
              ) : (
                <AiRiskSection late={dashboard.lateRisk} noShow={dashboard.noShowRisk} canOpen={access.reorder} onRetry={retry} className="@5xl:col-span-12" />
              )}
            </div>
          ) : null}

          <StockRiskOverdueSection
            canViewBorrow={canViewBorrowAnalytics}
            access={access}
            stockRisk={dashboard.stockRisk}
            overdue={dashboard.overdue}
            onRetry={retry}
          />

          {canViewBorrowAnalytics ? (
            <section aria-labelledby="analytics-title" className="space-y-5">
              <GroupHeading
                id="analytics-title"
                title="Phân tích & xu hướng"
                description="Lịch sử mượn trả, đặt trước và tiền phạt"
                aside={(
                  <div role="group" aria-label="Kỳ phân tích" aria-busy={periodLoading}>
                    <SegmentedControl options={PERIOD_OPTIONS} value={period} onChange={changePeriod} layoutId="dashboard-period" />
                  </div>
                )}
              />
              <div className={cn('space-y-5 transition-opacity', periodLoading && 'opacity-60')}>
                <TrendFunnelSection trendData={dashboard.trends} funnel={dashboard.funnel} kpis={dashboard.kpis} onRetry={retry} />
                <TopBooksFinesSection topBooks={dashboard.topBooks} topBooksLimit={TOP_BOOKS_LIMIT} fines={dashboard.fines} periodLabel={periodLabel} access={access} onRetry={retry} />
              </div>
            </section>
          ) : null}
        </>
      )}
    </PageWrapper>
  );
}
