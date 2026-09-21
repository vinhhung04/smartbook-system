import { useCallback, useEffect, useMemo, useState, type ComponentType } from 'react';
import { motion } from 'motion/react';
import {
  Archive,
  BrainCircuit,
  Clock,
  Copy,
  Gauge,
  PackagePlus,
  RefreshCw,
  UserX,
} from 'lucide-react';
import { toast } from 'sonner';
import { EmptyState } from '@/components/ui/empty-state';
import { SectionCard } from '@/components/ui/section-card';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/status-badge';
import { PageHeader } from '@/components/ui/page-header';
import { LoadingSpinner } from '@/components/ui/loading-state';
import {
  analyticsService,
  type LateReturnRiskItem,
  type ReservationNoShowRiskItem,
  type RiskBand,
  type RiskFactor,
  type RiskModelData,
  type WeedingSuggestionItem,
  type ReorderSuggestionItem,
  type ReorderSuggestionsData,
} from '@/services/analytics';
import { getApiErrorMessage } from '@/services/api';
import { hasPermission } from '@/services/http-clients';

type PriorityFilter = 'ALL' | 'HIGH' | 'MEDIUM' | 'LOW';
type Tab = 'reorder' | 'weeding' | 'late-return' | 'no-show';

const dayOptions = [7, 30, 90];
const priorityOptions: PriorityFilter[] = ['ALL', 'HIGH', 'MEDIUM', 'LOW'];

const RISK_METER_FILL: Record<RiskBand, string> = {
  HIGH: 'bg-red-500',
  MEDIUM: 'bg-amber-500',
  LOW: 'bg-sky-500',
};

const LATE_RETURN_FACTOR_LABELS: Record<string, string> = {
  loan_days: 'Số ngày được mượn',
  items_in_loan: 'Số đầu sách trong phiếu',
  prior_loans: 'Số lần mượn trước đây',
  prior_late_rate: 'Tỷ lệ trả trễ trước đây',
  prior_late_count: 'Số lần trả trễ trước đây',
  prior_renewal_rate: 'Tỷ lệ gia hạn trước đây',
  customer_tenure_days: 'Thời gian là thành viên',
  unpaid_fines_at_checkout: 'Tiền phạt chưa thanh toán',
  plan_max_loan_days: 'Hạn mượn theo gói thành viên',
  plan_fine_per_day: 'Mức phạt/ngày theo gói',
  from_reservation: 'Mượn từ đặt chỗ trước',
  condition_worn_at_checkout: 'Tình trạng sách khi mượn',
};

const NO_SHOW_FACTOR_LABELS: Record<string, string> = {
  hold_hours: 'Thời gian giữ chỗ',
  lead_hours: 'Thời gian đặt trước',
  quantity: 'Số lượng đặt',
  channel_web: 'Kênh đặt qua web',
  prior_reservations: 'Số lần đặt chỗ trước đây',
  prior_no_show_rate: 'Tỷ lệ bỏ lỡ trước đây',
  customer_tenure_days: 'Thời gian là thành viên',
  unpaid_fines_at_reservation: 'Tiền phạt chưa thanh toán',
  active_loans_at_reservation: 'Số phiếu đang mượn',
};

function priorityVariant(priority: ReorderSuggestionItem['priority']) {
  if (priority === 'HIGH') return 'danger';
  if (priority === 'MEDIUM') return 'warning';
  return 'info';
}

const PRIORITY_LABELS: Record<PriorityFilter, string> = {
  ALL: 'Tất cả',
  HIGH: 'Cao',
  MEDIUM: 'Trung bình',
  LOW: 'Thấp',
};

function riskBandVariant(band: RiskBand) {
  if (band === 'HIGH') return 'danger';
  if (band === 'MEDIUM') return 'warning';
  return 'info';
}

function riskBandLabel(band: RiskBand) {
  if (band === 'HIGH') return 'Nguy cơ cao';
  if (band === 'MEDIUM') return 'Nguy cơ vừa';
  return 'Nguy cơ thấp';
}

function formatStockoutDays(value: number | null) {
  if (value === null || value === undefined) return 'Chưa xác định';
  return `${value.toLocaleString('vi-VN')} ngày`;
}

function formatVnd(value: number) {
  return `${Math.round(value).toLocaleString('vi-VN')} đ`;
}

function formatPercent(value: number) {
  return `${Math.round(value * 100)}%`;
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' });
}

function severityVariant(severity: WeedingSuggestionItem['severity']) {
  return severity === 'CRITICAL' ? 'danger' : 'warning';
}

function actionLabel(action: WeedingSuggestionItem['suggested_action']) {
  return action === 'REDISTRIBUTE' ? 'Chuyển kho' : 'Thanh lý';
}

function RiskMeter({ score, band }: { score: number; band: RiskBand }) {
  const pct = Math.round(Math.min(1, Math.max(0, score)) * 100);
  return (
    <div className="flex items-center gap-2">
      <span className="w-10 shrink-0 text-right font-semibold text-foreground">{pct}%</span>
      <span className="inline-flex h-1.5 w-16 shrink-0 overflow-hidden rounded-full bg-muted" aria-hidden="true">
        <span className={`h-full rounded-full ${RISK_METER_FILL[band]}`} style={{ width: `${pct}%` }} />
      </span>
    </div>
  );
}

function TopFactors({ factors, labels }: { factors: RiskFactor[]; labels: Record<string, string> }) {
  if (!factors.length) return <span className="text-[12px] text-muted-foreground">—</span>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {factors.slice(0, 2).map((factor) => (
        <span
          key={factor.feature}
          className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] ${
            factor.direction === 'increases_risk'
              ? 'border-red-200 bg-red-50 text-red-700 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-400'
              : 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-400'
          }`}
        >
          {factor.direction === 'increases_risk' ? '↑' : '↓'} {labels[factor.feature] || factor.feature}
        </span>
      ))}
    </div>
  );
}

function ModelQualityStrip({ evaluation }: { evaluation: RiskModelData<unknown>['evaluation'] }) {
  if (!evaluation) return null;
  const lift50 = evaluation.lift.find((entry) => entry.k === 50) || evaluation.lift[0];
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg border border-border bg-muted/30 px-4 py-3 text-[12px]">
      <span className="flex items-center gap-1.5 font-medium text-muted-foreground">
        <Gauge className="h-3.5 w-3.5" /> Chất lượng mô hình
      </span>
      <span><span className="text-muted-foreground">AUC</span> <span className="font-semibold text-foreground">{evaluation.auc !== null ? evaluation.auc.toFixed(2) : '—'}</span></span>
      <span><span className="text-muted-foreground">Precision</span> <span className="font-semibold text-foreground">{formatPercent(evaluation.best_threshold.precision)}</span></span>
      <span><span className="text-muted-foreground">Recall</span> <span className="font-semibold text-foreground">{formatPercent(evaluation.best_threshold.recall)}</span></span>
      <span><span className="text-muted-foreground">F1</span> <span className="font-semibold text-foreground">{formatPercent(evaluation.best_threshold.f1)}</span></span>
      {lift50 ? (
        <span>
          <span className="text-muted-foreground">Lift @top-{lift50.k}</span>{' '}
          <span className="font-semibold text-foreground">{lift50.lift !== null ? `${lift50.lift.toFixed(1)}x` : '—'}</span>
        </span>
      ) : null}
      <span className="text-muted-foreground">Huấn luyện trên {evaluation.samples.toLocaleString('vi-VN')} mẫu</span>
    </div>
  );
}

type Accent = 'violet' | 'amber' | 'rose' | 'cyan';

const ACCENT_CLASSES: Record<Accent, { border: string; bg: string; iconBg: string; iconColor: string; rail: string }> = {
  violet: {
    border: 'border-violet-300 dark:border-violet-500/40',
    bg: 'bg-violet-50/70 dark:bg-violet-500/10',
    iconBg: 'bg-violet-100 dark:bg-violet-500/15',
    iconColor: 'text-violet-600 dark:text-violet-400',
    rail: 'bg-violet-500',
  },
  amber: {
    border: 'border-amber-300 dark:border-amber-500/40',
    bg: 'bg-amber-50/70 dark:bg-amber-500/10',
    iconBg: 'bg-amber-100 dark:bg-amber-500/15',
    iconColor: 'text-amber-600 dark:text-amber-400',
    rail: 'bg-amber-500',
  },
  rose: {
    border: 'border-rose-300 dark:border-rose-500/40',
    bg: 'bg-rose-50/70 dark:bg-rose-500/10',
    iconBg: 'bg-rose-100 dark:bg-rose-500/15',
    iconColor: 'text-rose-600 dark:text-rose-400',
    rail: 'bg-rose-500',
  },
  cyan: {
    border: 'border-cyan-300 dark:border-cyan-500/40',
    bg: 'bg-cyan-50/70 dark:bg-cyan-500/10',
    iconBg: 'bg-cyan-100 dark:bg-cyan-500/15',
    iconColor: 'text-cyan-600 dark:text-cyan-400',
    rail: 'bg-cyan-500',
  },
};

function DomainNavItem({
  active,
  onClick,
  icon: Icon,
  label,
  value,
  hint,
  accent,
}: {
  active: boolean;
  onClick: () => void;
  icon: ComponentType<{ className?: string }>;
  label: string;
  value: number | string;
  hint: string;
  accent: Accent;
}) {
  const theme = ACCENT_CLASSES[accent];
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`relative w-full overflow-hidden rounded-xl border px-4 py-3 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 ${
        active ? `${theme.border} ${theme.bg} shadow-[0_1px_2px_rgba(0,0,0,0.04)]` : 'border-border bg-card hover:bg-muted/40'
      }`}
    >
      <span className={`absolute inset-x-0 top-0 h-[3px] ${active ? theme.rail : 'bg-transparent'}`} />
      <span className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-2">
          <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${theme.iconBg}`}>
            <Icon className={`h-3.5 w-3.5 ${theme.iconColor}`} />
          </span>
          <span className="truncate text-[13px] font-semibold text-foreground">{label}</span>
        </span>
        <span className="shrink-0 font-mono text-[22px] font-bold leading-none tabular-nums text-foreground">{value}</span>
      </span>
      <span className="mt-1.5 block truncate text-[12px] text-muted-foreground">{hint}</span>
    </button>
  );
}

interface RiskRow {
  key: string;
  customer: string;
  title: string;
  fromLabel: string;
  from: string | null | undefined;
  toLabel: string;
  to: string | null | undefined;
  score: number;
  band: RiskBand;
  factors: RiskFactor[];
}

/** Shared table for the two risk models (late return, reservation no-show): same shape, different dates and factor labels. */
function RiskTable({ rows, factorLabels }: { rows: RiskRow[]; factorLabels: Record<string, string> }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full table-fixed text-left text-[13px]">
        <thead className="border-b border-border bg-muted/40 text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
          <tr>
            <th className="px-4 py-3 font-semibold">Khách hàng &amp; sách</th>
            <th className="hidden w-[170px] px-3 py-3 font-semibold sm:table-cell">Thời hạn</th>
            <th className="w-[190px] px-3 py-3 font-semibold">Mức rủi ro</th>
            <th className="hidden w-[250px] px-4 py-3 font-semibold xl:table-cell">Yếu tố chính</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((row) => (
            <tr key={row.key} className="align-top transition hover:bg-muted/40">
              <td className="px-4 py-3">
                <p className="truncate font-semibold text-foreground" title={row.customer}>{row.customer}</p>
                <p className="truncate text-[12px] text-muted-foreground" title={row.title}>{row.title}</p>
                <p className="mt-1 text-[12px] text-muted-foreground sm:hidden">{row.toLabel}: {formatDateTime(row.to)}</p>
                <div className="mt-1.5 xl:hidden"><TopFactors factors={row.factors} labels={factorLabels} /></div>
              </td>
              <td className="hidden px-3 py-3 sm:table-cell">
                <p className="text-[12px] text-foreground">{row.toLabel}: {formatDateTime(row.to)}</p>
                <p className="text-[12px] text-muted-foreground">{row.fromLabel}: {formatDateTime(row.from)}</p>
              </td>
              <td className="px-3 py-3">
                <RiskMeter score={row.score} band={row.band} />
                <div className="mt-1.5"><StatusBadge label={riskBandLabel(row.band)} variant={riskBandVariant(row.band)} dot /></div>
              </td>
              <td className="hidden px-4 py-3 xl:table-cell"><TopFactors factors={row.factors} labels={factorLabels} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SummaryStrip({ items }: { items: Array<{ label: string; value: string | number; tone?: string; hint?: string }> }) {
  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-4 rounded-xl border border-border bg-card p-4 sm:grid-cols-3 sm:p-5 xl:grid-cols-6">
      {items.map((item) => (
        <div key={item.label} className="min-w-0">
          <dt className="text-[12px] text-muted-foreground">{item.label}</dt>
          <dd className={`mt-1 truncate font-mono text-[22px] font-bold leading-none tabular-nums ${item.tone ?? 'text-foreground'}`}>{item.value}</dd>
          {item.hint ? <p className="mt-1 truncate text-[11px] text-muted-foreground">{item.hint}</p> : null}
        </div>
      ))}
    </dl>
  );
}

export function ReorderSuggestionsPage() {
  const [activeTab, setActiveTab] = useState<Tab>('reorder');
  // Borrow-domain risk models are gated by analytics.borrow.read; roles without it (e.g. warehouse manager) get 403.
  const canViewBorrowRisk = hasPermission('analytics.borrow.read');

  const [days, setDays] = useState(30);
  const [priority, setPriority] = useState<PriorityFilter>('ALL');
  const [limit, setLimit] = useState(20);
  const [budgetVnd, setBudgetVnd] = useState<number | ''>('');
  const [data, setData] = useState<ReorderSuggestionsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [weedingItems, setWeedingItems] = useState<WeedingSuggestionItem[]>([]);
  const [weedingLoading, setWeedingLoading] = useState(true);
  const [weedingError, setWeedingError] = useState<string | null>(null);

  const [lateReturn, setLateReturn] = useState<RiskModelData<LateReturnRiskItem> | null>(null);
  const [lateReturnLoading, setLateReturnLoading] = useState(true);
  const [lateReturnError, setLateReturnError] = useState<string | null>(null);

  const [noShow, setNoShow] = useState<RiskModelData<ReservationNoShowRiskItem> | null>(null);
  const [noShowLoading, setNoShowLoading] = useState(true);
  const [noShowError, setNoShowError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await analyticsService.getReorderSuggestions({
        days,
        priority,
        limit,
        budgetVnd: budgetVnd === '' ? undefined : budgetVnd,
      });
      setData(response);
    } catch (err) {
      const message = getApiErrorMessage(err, 'Không thể tải gợi ý nhập thêm sách');
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }, [days, priority, limit, budgetVnd]);

  const loadWeedingSuggestions = useCallback(async () => {
    try {
      setWeedingLoading(true);
      setWeedingError(null);
      const response = await analyticsService.getWeedingSuggestions({ days: 180, limit: 50 });
      setWeedingItems(response.items);
    } catch (err) {
      setWeedingError(getApiErrorMessage(err, 'Không thể tải danh sách sách nên thanh lý'));
    } finally {
      setWeedingLoading(false);
    }
  }, []);

  const loadLateReturnRisk = useCallback(async () => {
    try {
      setLateReturnLoading(true);
      setLateReturnError(null);
      const response = await analyticsService.getLateReturnRisk({ limit: 100 });
      setLateReturn(response);
    } catch (err) {
      setLateReturnError(getApiErrorMessage(err, 'Không thể tải dữ liệu rủi ro trả trễ'));
    } finally {
      setLateReturnLoading(false);
    }
  }, []);

  const loadNoShowRisk = useCallback(async () => {
    try {
      setNoShowLoading(true);
      setNoShowError(null);
      const response = await analyticsService.getReservationNoShowRisk({ limit: 100 });
      setNoShow(response);
    } catch (err) {
      setNoShowError(getApiErrorMessage(err, 'Không thể tải dữ liệu rủi ro bỏ lỡ đặt chỗ'));
    } finally {
      setNoShowLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    void loadWeedingSuggestions();
  }, [loadWeedingSuggestions]);

  useEffect(() => {
    if (canViewBorrowRisk) void loadLateReturnRisk();
  }, [canViewBorrowRisk, loadLateReturnRisk]);

  useEffect(() => {
    if (canViewBorrowRisk) void loadNoShowRisk();
  }, [canViewBorrowRisk, loadNoShowRisk]);

  const summary = data?.summary;
  const items = useMemo(() => (Array.isArray(data?.items) ? data.items : []), [data]);

  const lateReturnReady = lateReturn != null && lateReturn.status !== 'INSUFFICIENT_DATA';
  const noShowReady = noShow != null && noShow.status !== 'INSUFFICIENT_DATA';
  const lateReturnHighCount = useMemo(
    () => (lateReturnReady ? (lateReturn?.items ?? []).filter((item) => item.risk_band === 'HIGH').length : null),
    [lateReturn, lateReturnReady],
  );
  const noShowHighCount = useMemo(
    () => (noShowReady ? (noShow?.items ?? []).filter((item) => item.risk_band === 'HIGH').length : null),
    [noShow, noShowReady],
  );
  const weedingActionableCount = weedingItems.length;

  const askAiPrompts: Record<Tab, string> = {
    reorder: 'Giải thích kế hoạch nhập thêm sách dựa trên Reorder Suggestions hiện tại.',
    weeding: 'Giải thích danh sách sách nên thanh lý hoặc chuyển kho hiện tại.',
    'late-return': 'Giải thích các khoản mượn có nguy cơ trả trễ cao và đề xuất cách xử lý.',
    'no-show': 'Giải thích các đặt chỗ có nguy cơ bỏ lỡ cao và đề xuất cách xử lý.',
  };

  const handleAskAi = async () => {
    const prompt = askAiPrompts[activeTab];
    try {
      await navigator.clipboard.writeText(prompt);
      toast.success('Đã sao chép prompt để hỏi AI chatbot');
    } catch {
      toast.info(prompt);
    }
  };

  const handleRefreshActiveTab = () => {
    if (activeTab === 'reorder') void loadData();
    else if (activeTab === 'weeding') void loadWeedingSuggestions();
    else if (activeTab === 'late-return') void loadLateReturnRisk();
    else void loadNoShowRisk();
  };

  const activeLoading =
    activeTab === 'reorder' ? loading
      : activeTab === 'weeding' ? weedingLoading
      : activeTab === 'late-return' ? lateReturnLoading
      : noShowLoading;

  const errorState = (message: string, retry: () => void, title = 'Không thể tải dữ liệu') => (
    <EmptyState
      variant="error"
      title={title}
      description={message}
      action={<Button type="button" size="sm" onClick={retry}>Thử lại</Button>}
    />
  );

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6"
    >
      <PageHeader
        icon={BrainCircuit}
        title="Đề xuất & cảnh báo rủi ro AI"
        description="Phân tích lượt mượn, đặt chỗ và tồn kho để đề xuất nhập thêm, thanh lý, đồng thời cảnh báo sớm nguy cơ trả trễ và bỏ lỡ đặt chỗ."
        iconBg="bg-violet-100 dark:bg-violet-500/15"
        iconColor="text-violet-600 dark:text-violet-400"
        actions={
          <>
            <Button type="button" variant="outline" size="sm" onClick={handleAskAi} title="Sao chép câu hỏi mẫu để dán vào chatbot AI">
              <Copy className="h-3.5 w-3.5" />
              Hỏi AI về mục này
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={handleRefreshActiveTab} disabled={activeLoading}>
              <RefreshCw className={`h-3.5 w-3.5 ${activeLoading ? 'animate-spin' : ''}`} />
              Làm mới
            </Button>
          </>
        }
      />

      <div className={`grid grid-cols-2 gap-3 ${canViewBorrowRisk ? 'lg:grid-cols-4' : 'lg:grid-cols-2'}`}>
        <DomainNavItem
          active={activeTab === 'reorder'}
          onClick={() => setActiveTab('reorder')}
          icon={PackagePlus}
          label="Nhập thêm"
          value={summary?.high_priority ?? 0}
          hint={`ưu tiên cao · ${summary?.total_candidates ?? 0} đầu sách xem xét`}
          accent="violet"
        />
        <DomainNavItem
          active={activeTab === 'weeding'}
          onClick={() => setActiveTab('weeding')}
          icon={Archive}
          label="Thanh lý / chuyển kho"
          value={weedingActionableCount}
          hint="sách tồn lâu, không hoạt động"
          accent="amber"
        />
        {canViewBorrowRisk && (
          <>
        <DomainNavItem
          active={activeTab === 'late-return'}
          onClick={() => setActiveTab('late-return')}
          icon={Clock}
          label="Rủi ro trả trễ"
          value={lateReturnHighCount ?? '—'}
          hint="khoản mượn đang mở, nguy cơ cao"
          accent="rose"
        />
        <DomainNavItem
          active={activeTab === 'no-show'}
          onClick={() => setActiveTab('no-show')}
          icon={UserX}
          label="Bỏ lỡ đặt chỗ"
          value={noShowHighCount ?? '—'}
          hint="đặt chỗ đang chờ, nguy cơ cao"
          accent="cyan"
        />
          </>
        )}
      </div>

      <div className="space-y-4">
        {activeTab === 'reorder' && (
          <div className="space-y-4">
            <SectionCard
              title="Bộ lọc dự báo"
              subtitle={data ? `Dữ liệu từ ${data.range.from} đến ${data.range.to}, thời gian giao hàng ${data.range.leadTimeDays} ngày` : 'Chọn khoảng thời gian và mức ưu tiên'}
              icon={BrainCircuit}
            >
              <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
                <div className="max-w-full overflow-x-auto">
                  <SegmentedControl
                    layoutId="reorder-days"
                    value={String(days)}
                    onChange={(value) => setDays(Number(value))}
                    options={dayOptions.map((option) => ({ value: String(option), label: `${option} ngày` }))}
                    className="w-max"
                  />
                </div>
                <div className="max-w-full overflow-x-auto">
                  <SegmentedControl
                    layoutId="reorder-priority"
                    value={priority}
                    onChange={(value) => setPriority(value as PriorityFilter)}
                    options={priorityOptions.map((option) => ({ value: option, label: PRIORITY_LABELS[option] }))}
                    className="w-max"
                  />
                </div>
                <label className="flex items-center gap-2 text-[13px] text-muted-foreground">
                  Hiển thị tối đa
                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={limit}
                    onChange={(event) => setLimit(Math.min(100, Math.max(1, Number(event.target.value) || 1)))}
                    className="h-9 w-20 rounded-lg border border-border bg-card px-3 text-[13px] text-foreground outline-none focus:border-indigo-300 dark:focus:border-indigo-500/40"
                  />
                </label>
                <label className="flex items-center gap-2 text-[13px] text-muted-foreground">
                  Ngân sách (đ)
                  <input
                    type="number"
                    min={0}
                    placeholder="Không giới hạn"
                    value={budgetVnd}
                    onChange={(event) => {
                      const raw = event.target.value;
                      setBudgetVnd(raw === '' ? '' : Math.max(0, Number(raw) || 0));
                    }}
                    className="h-9 w-40 rounded-lg border border-border bg-card px-3 text-[13px] text-foreground outline-none focus:border-indigo-300 dark:focus:border-indigo-500/40"
                  />
                </label>
              </div>
            </SectionCard>

            <SummaryStrip
              items={[
                { label: 'Đầu sách xem xét', value: (summary?.total_candidates ?? 0).toLocaleString('vi-VN') },
                { label: 'Ưu tiên cao', value: summary?.high_priority ?? 0, tone: (summary?.high_priority ?? 0) > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-foreground/40' },
                { label: 'Ưu tiên trung bình', value: summary?.medium_priority ?? 0, tone: 'text-amber-600 dark:text-amber-400' },
                { label: 'Tổng số lượng đề xuất', value: (summary?.estimated_total_reorder_qty ?? 0).toLocaleString('vi-VN'), tone: 'text-emerald-600 dark:text-emerald-400' },
                { label: 'Chi phí ước tính', value: formatVnd(summary?.estimated_total_cost ?? 0), tone: 'text-indigo-600 dark:text-indigo-400' },
                ...(data?.budget
                  ? [{ label: 'Ngân sách còn lại', value: formatVnd(data.budget.remaining_vnd), tone: data.budget.remaining_vnd <= 0 ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400' }]
                  : []),
              ]}
            />

            <SectionCard
              title="Sách nên xem xét nhập thêm"
              subtitle="Sắp xếp theo mức ưu tiên, điểm nhu cầu và số lượng đề xuất"
              icon={PackagePlus}
              noPadding
            >
              {loading ? (
                <div className="flex min-h-[260px] items-center justify-center">
                  <LoadingSpinner message="Đang phân tích nhu cầu..." />
                </div>
              ) : error ? (
                errorState(error, () => void loadData(), 'Không thể tải gợi ý nhập thêm')
              ) : items.length === 0 ? (
                <EmptyState title="Chưa có sách cần nhập thêm" description="Không có tín hiệu mượn, đặt chỗ hoặc thiếu tồn kho trong bộ lọc hiện tại." icon={PackagePlus} />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full table-fixed text-left text-[13px]">
                    <thead className="border-y border-border bg-muted/40 text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
                      <tr>
                        <th className="px-4 py-3 font-semibold">Sách</th>
                        <th className="hidden w-[190px] px-3 py-3 font-semibold md:table-cell">Nhu cầu</th>
                        <th className="w-[170px] px-3 py-3 font-semibold">Ưu tiên</th>
                        <th className="w-[170px] px-4 py-3 font-semibold">Đề xuất nhập</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {items.map((item) => (
                        <tr key={item.variant_id} className="align-top transition hover:bg-muted/40">
                          <td className="px-4 py-3">
                            <p className="truncate font-semibold text-foreground" title={item.title || undefined}>{item.title || 'Chưa có tên sách'}</p>
                            <p className="truncate text-[12px] text-muted-foreground">
                              {[item.author, item.category, item.isbn].filter(Boolean).join(' · ') || 'Chưa có metadata'}
                            </p>
                            <p className="mt-1 line-clamp-2 text-[12px] leading-relaxed text-muted-foreground" title={item.reason}>{item.reason}</p>
                            <p className="mt-1 text-[12px] text-muted-foreground md:hidden">
                              Còn {item.available_qty} · dự báo 30 ngày: {item.forecast_30d}
                            </p>
                          </td>
                          <td className="hidden px-3 py-3 text-[12px] leading-relaxed md:table-cell">
                            <p><span className="font-semibold text-foreground">{item.available_qty}</span> <span className="text-muted-foreground">còn lại</span></p>
                            <p className="text-muted-foreground">{item.borrow_count} mượn · {item.reservation_count} đặt chỗ</p>
                            <p className="mt-1 text-foreground">Dự báo 30 ngày: <span className="font-semibold">{item.forecast_30d}</span></p>
                            {item.seasonal_event ? (
                              <div className="mt-1"><StatusBadge label={`${item.seasonal_event} · ${item.seasonal_index}x`} variant="info" dot /></div>
                            ) : item.seasonal_index !== 1 ? (
                              <p className="text-muted-foreground">{item.seasonal_index}x mùa vụ</p>
                            ) : null}
                          </td>
                          <td className="px-3 py-3">
                            <StatusBadge label={PRIORITY_LABELS[item.priority as PriorityFilter] ?? item.priority} variant={priorityVariant(item.priority)} dot />
                            <p className="mt-1.5 text-[12px] text-muted-foreground">Hết hàng sau: {formatStockoutDays(item.estimated_days_until_stockout)}</p>
                          </td>
                          <td className="px-4 py-3">
                            <p className="font-semibold text-emerald-700 dark:text-emerald-400">{item.suggested_reorder_qty} cuốn</p>
                            <p className="text-[12px] text-muted-foreground">{formatVnd(item.estimated_cost)}</p>
                            {data?.budget ? (
                              <div className="mt-1"><StatusBadge label={item.within_budget ? 'Trong ngân sách' : 'Vượt ngân sách'} variant={item.within_budget ? 'success' : 'danger'} dot /></div>
                            ) : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </SectionCard>
          </div>
        )}

        {activeTab === 'weeding' && (
          <SectionCard
            title="Gợi ý thanh lý / chuyển kho"
            subtitle="Sách còn tồn kho, không có lượt mượn hoặc di chuyển kho trong 180 ngày gần đây — xếp theo giá trị tồn đọng"
            icon={Archive}
            noPadding
          >
            {weedingLoading ? (
              <div className="flex min-h-[160px] items-center justify-center">
                <LoadingSpinner message="Đang kiểm tra tồn kho lâu..." />
              </div>
            ) : weedingError ? (
              errorState(weedingError, () => void loadWeedingSuggestions())
            ) : weedingItems.length === 0 ? (
              <EmptyState title="Không có sách nào cần thanh lý" description="Tất cả sách còn tồn kho đều có hoạt động mượn/di chuyển trong 180 ngày gần đây." icon={Archive} />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full table-fixed text-left text-[13px]">
                  <thead className="border-y border-border bg-muted/40 text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
                    <tr>
                      <th className="px-4 py-3 font-semibold">Sách</th>
                      <th className="hidden w-[190px] px-3 py-3 font-semibold sm:table-cell">Tồn kho</th>
                      <th className="hidden w-[160px] px-3 py-3 font-semibold md:table-cell">Giá trị tồn đọng</th>
                      <th className="w-[150px] px-4 py-3 font-semibold">Đề xuất</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {weedingItems.map((item) => {
                      const idle = item.days_since_last_activity === null ? 'Chưa từng' : `${item.days_since_last_activity} ngày`;
                      return (
                        <tr key={`${item.variant_id}-${item.warehouse_id}`} className="align-top transition hover:bg-muted/40">
                          <td className="px-4 py-3">
                            <p className="truncate font-semibold text-foreground" title={item.title}>{item.title}</p>
                            <p className="truncate text-[12px] text-muted-foreground">{item.warehouse_name}</p>
                            <p className="mt-1 text-[12px] text-muted-foreground sm:hidden">
                              {item.on_hand_qty} bản · không hoạt động {idle} · {formatVnd(item.tied_up_value)}
                            </p>
                          </td>
                          <td className="hidden px-3 py-3 sm:table-cell">
                            <p className="font-semibold text-foreground">{item.on_hand_qty} bản</p>
                            <div className="mt-1"><StatusBadge label={`Không hoạt động: ${idle}`} variant={severityVariant(item.severity)} dot /></div>
                          </td>
                          <td className="hidden px-3 py-3 font-semibold md:table-cell">{formatVnd(item.tied_up_value)}</td>
                          <td className="px-4 py-3">
                            <StatusBadge label={actionLabel(item.suggested_action)} variant={item.suggested_action === 'REDISTRIBUTE' ? 'info' : 'danger'} dot />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </SectionCard>
        )}

        {activeTab === 'late-return' && (
          <SectionCard
            title="Rủi ro trả trễ"
            subtitle="Mô hình hồi quy logistic ước tính khả năng một khoản mượn đang mở sẽ trả trễ, dựa trên lịch sử mượn/trả của khách hàng"
            icon={Clock}
            noPadding
          >
            {lateReturnLoading ? (
              <div className="flex min-h-[200px] items-center justify-center">
                <LoadingSpinner message="Đang chấm điểm rủi ro..." />
              </div>
            ) : lateReturnError ? (
              errorState(lateReturnError, () => void loadLateReturnRisk())
            ) : !lateReturnReady ? (
              <EmptyState
                title="Chưa đủ dữ liệu để huấn luyện mô hình"
                description={lateReturn?.reason || 'Cần thêm lịch sử mượn/trả đã hoàn tất để mô hình học được các mẫu trả trễ.'}
                icon={Clock}
              />
            ) : (lateReturn?.items.length ?? 0) === 0 ? (
              <EmptyState title="Không có khoản mượn nào đang mở" description="Hiện không có khoản mượn nào cần chấm điểm rủi ro trả trễ." icon={Clock} />
            ) : (
              <div className="space-y-4 px-4 pb-5 pt-4 sm:px-5">
                <ModelQualityStrip evaluation={lateReturn?.evaluation} />
                <RiskTable
                  factorLabels={LATE_RETURN_FACTOR_LABELS}
                  rows={(lateReturn?.items ?? []).map((item) => ({
                    key: item.loan_item_id,
                    customer: item.customer_name || 'Chưa xác định',
                    title: item.title || 'Chưa xác định',
                    fromLabel: 'Ngày mượn',
                    from: item.borrow_date,
                    toLabel: 'Hạn trả',
                    to: item.due_date,
                    score: item.risk_score,
                    band: item.risk_band,
                    factors: item.top_factors,
                  }))}
                />
              </div>
            )}
          </SectionCard>
        )}

        {activeTab === 'no-show' && (
          <SectionCard
            title="Rủi ro bỏ lỡ đặt chỗ"
            subtitle="Mô hình hồi quy logistic ước tính khả năng một đặt chỗ đang chờ lấy sách sẽ hết hạn mà không có ai đến nhận"
            icon={UserX}
            noPadding
          >
            {noShowLoading ? (
              <div className="flex min-h-[200px] items-center justify-center">
                <LoadingSpinner message="Đang chấm điểm rủi ro..." />
              </div>
            ) : noShowError ? (
              errorState(noShowError, () => void loadNoShowRisk())
            ) : !noShowReady ? (
              <EmptyState
                title="Chưa đủ dữ liệu để huấn luyện mô hình"
                description={noShow?.reason || 'Cần thêm lịch sử đặt chỗ đã kết thúc (lấy sách hoặc hết hạn) để mô hình học được các mẫu bỏ lỡ.'}
                icon={UserX}
              />
            ) : (noShow?.items.length ?? 0) === 0 ? (
              <EmptyState title="Không có đặt chỗ nào đang chờ lấy" description="Hiện không có đặt chỗ nào cần chấm điểm rủi ro bỏ lỡ." icon={UserX} />
            ) : (
              <div className="space-y-4 px-4 pb-5 pt-4 sm:px-5">
                <ModelQualityStrip evaluation={noShow?.evaluation} />
                <RiskTable
                  factorLabels={NO_SHOW_FACTOR_LABELS}
                  rows={(noShow?.items ?? []).map((item) => ({
                    key: item.reservation_id,
                    customer: item.customer_name || 'Chưa xác định',
                    title: item.title || 'Chưa xác định',
                    fromLabel: 'Ngày đặt',
                    from: item.reserved_at,
                    toLabel: 'Hết hạn lấy',
                    to: item.expires_at,
                    score: item.risk_score,
                    band: item.risk_band,
                    factors: item.top_factors,
                  }))}
                />
              </div>
            )}
          </SectionCard>
        )}
      </div>
    </motion.div>
  );
}
