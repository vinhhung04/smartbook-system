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
import { useNavigate } from 'react-router';
import { EmptyState } from '@/components/ui/empty-state';
import { SectionCard } from '@/components/ui/section-card';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/status-badge';
import { PageHeader } from '@/components/ui/page-header';
import { LoadingSpinner } from '@/components/ui/loading-state';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
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
import { authService } from '@/services/auth';
import { canAccess, ROUTE_ACCESS } from '@/lib/rbac';
import { askChatbot } from '@/lib/chatbot-bus';
import type { PurchaseOrderPrefill } from './purchase-order-form';

type PriorityFilter = 'ALL' | 'HIGH' | 'MEDIUM' | 'LOW';
type Tab = 'reorder' | 'weeding' | 'late-return' | 'no-show';

const dayOptions = [7, 30, 90];

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

// Urgency is what a buyer acts on: almost every candidate comes back HIGH priority,
// so the list is split by when the shelf runs empty relative to the supplier lead time.
type Urgency = 'OUT' | 'BEFORE_RESTOCK' | 'LATER';
type UrgencyFilter = 'ALL' | Urgency;
const URGENCY_FILTERS: UrgencyFilter[] = ['ALL', 'OUT', 'BEFORE_RESTOCK', 'LATER'];
const URGENCY_RANK: Record<Urgency, number> = { OUT: 0, BEFORE_RESTOCK: 1, LATER: 2 };
const URGENCY: Record<Urgency, { label: string; dot: string; text: string; hint: (leadDays: number) => string }> = {
  OUT: { label: 'Đã hết hàng', dot: 'bg-red-500', text: 'text-red-600 dark:text-red-400', hint: () => 'Không còn cuốn nào sẵn sàng' },
  BEFORE_RESTOCK: { label: 'Sẽ hết trước khi hàng về', dot: 'bg-amber-500', text: 'text-amber-700 dark:text-amber-400', hint: (d) => `Dự kiến hết trong ${d} ngày tới — đặt bây giờ vẫn có thể thiếu hàng một thời gian` },
  LATER: { label: 'Còn thời gian', dot: 'bg-emerald-500', text: 'text-foreground', hint: (d) => `Hết sau hơn ${d} ngày hoặc chưa xác định` },
};

function urgencyOf(item: ReorderSuggestionItem, leadDays: number): Urgency {
  if (item.available_qty <= 0) return 'OUT';
  const days = item.estimated_days_until_stockout;
  if (days !== null && days !== undefined && days <= leadDays) return 'BEFORE_RESTOCK';
  return 'LATER';
}

function stockoutText(item: ReorderSuggestionItem) {
  if (item.available_qty <= 0) return 'Đã hết hàng';
  const days = item.estimated_days_until_stockout;
  if (days === null || days === undefined) return 'Chưa xác định';
  return `Hết sau ~${Math.round(days).toLocaleString('vi-VN')} ngày`;
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

export function ReorderSuggestionsPage() {
  const navigate = useNavigate();
  const canCreatePo = canAccess(authService.getCurrentUser(), ROUTE_ACCESS.purchaseWrite);
  const [activeTab, setActiveTab] = useState<Tab>('reorder');
  // Borrow-domain risk models are gated by analytics.borrow.read; roles without it (e.g. warehouse manager) get 403.
  const canViewBorrowRisk = hasPermission('analytics.borrow.read');

  const [days, setDays] = useState(30);
  const [limit, setLimit] = useState(20);
  const [budgetVnd, setBudgetVnd] = useState<number | ''>('');
  const [budgetDraft, setBudgetDraft] = useState('');
  const [urgencyFilter, setUrgencyFilter] = useState<UrgencyFilter>('ALL');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [qtyOverrides, setQtyOverrides] = useState<Record<string, number>>({});
  const [reasonOpen, setReasonOpen] = useState<string | null>(null);
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
        priority: 'ALL',
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
  }, [days, limit, budgetVnd]);

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

  const leadDays = data?.range.leadTimeDays ?? 14;
  const sortedItems = useMemo(() => [...items].sort((a, b) => {
    const ua = urgencyOf(a, leadDays);
    const ub = urgencyOf(b, leadDays);
    if (ua !== ub) return URGENCY_RANK[ua] - URGENCY_RANK[ub];
    const da = a.estimated_days_until_stockout ?? Number.POSITIVE_INFINITY;
    const db = b.estimated_days_until_stockout ?? Number.POSITIVE_INFINITY;
    return da - db || b.demand_score - a.demand_score;
  }), [items, leadDays]);
  const urgencyCounts = useMemo(() => {
    const counts: Record<string, number> = { ALL: sortedItems.length };
    for (const item of sortedItems) {
      const key = urgencyOf(item, leadDays);
      counts[key] = (counts[key] ?? 0) + 1;
    }
    return counts;
  }, [sortedItems, leadDays]);
  const visibleItems = useMemo(
    () => (urgencyFilter === 'ALL' ? sortedItems : sortedItems.filter((item) => urgencyOf(item, leadDays) === urgencyFilter)),
    [sortedItems, urgencyFilter, leadDays],
  );
  const qtyFor = (item: ReorderSuggestionItem) => qtyOverrides[item.variant_id] ?? item.suggested_reorder_qty;
  const setQtyOverride = (variantId: string, value: number) => {
    setQtyOverrides((current) => ({ ...current, [variantId]: Math.max(1, Math.round(value) || 1) }));
  };
  const visibleQty = visibleItems.reduce((sum, item) => sum + qtyFor(item), 0);
  const visibleCost = visibleItems.reduce((sum, item) => sum + qtyFor(item) * (item.unit_cost || 0), 0);
  const selectedItems = sortedItems.filter((item) => selectedIds.has(item.variant_id));
  const selectedQty = selectedItems.reduce((sum, item) => sum + qtyFor(item), 0);
  const selectedCost = selectedItems.reduce((sum, item) => sum + qtyFor(item) * (item.unit_cost || 0), 0);
  const allVisibleSelected = visibleItems.length > 0 && visibleItems.every((item) => selectedIds.has(item.variant_id));

  const toggleItem = (variantId: string, checked: boolean) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (checked) next.add(variantId); else next.delete(variantId);
      return next;
    });
  };
  const toggleAllVisible = (checked: boolean) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      for (const item of visibleItems) {
        if (checked) next.add(item.variant_id); else next.delete(item.variant_id);
      }
      return next;
    });
  };
  const commitBudget = () => {
    const digits = budgetDraft.replace(/[^\d]/g, '');
    setBudgetVnd(digits ? Number(digits) : '');
  };
  const createPurchaseOrder = () => {
    const prefill: PurchaseOrderPrefill = {
      note: `Tạo từ đề xuất nhập thêm (${days} ngày qua, ${new Date().toLocaleDateString('vi-VN')})`,
      lines: selectedItems.map((item) => ({
        variant_id: item.variant_id,
        title: item.title,
        isbn13: item.isbn || null,
        ordered_qty: qtyFor(item),
        unit_cost: item.unit_cost || 0,
      })),
    };
    navigate('/purchase-orders/new', { state: { prefill } });
  };

  // A new analysis replaces the list, so per-row choices from the old one no longer apply.
  useEffect(() => {
    setSelectedIds(new Set());
    setQtyOverrides({});
    setReasonOpen(null);
  }, [data]);

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
    reorder: 'Giải thích danh sách đề xuất nhập thêm sách hiện tại: sách nào cần đặt gấp và vì sao?',
    weeding: 'Giải thích danh sách sách nên thanh lý hoặc chuyển kho hiện tại.',
    'late-return': 'Giải thích các khoản mượn có nguy cơ trả trễ cao và đề xuất cách xử lý.',
    'no-show': 'Giải thích các đặt chỗ có nguy cơ bỏ lỡ cao và đề xuất cách xử lý.',
  };

  const handleAskAi = async () => {
    const prompt = askAiPrompts[activeTab];
    if (askChatbot(prompt)) return;
    // Roles with the full assistant page have no floating chatbot; hand the question over there.
    if (canAccess(authService.getCurrentUser(), ROUTE_ACCESS.aiAssistant)) {
      navigate('/ai-assistant', { state: { prompt } });
      return;
    }
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
            <Button type="button" variant="outline" size="sm" onClick={() => void handleAskAi()} title="Mở trợ lý AI với câu hỏi về mục đang xem">
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
          value={loading ? '–' : (urgencyCounts.OUT ?? 0) + (urgencyCounts.BEFORE_RESTOCK ?? 0)}
          hint={`sách đã hết hoặc sắp hết · ${summary?.total_candidates ?? 0} đầu sách đã xét`}
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
            <div className="overflow-hidden rounded-xl border border-border bg-card shadow-[0_1px_2px_rgba(0,0,0,0.03),0_2px_8px_rgba(0,0,0,0.04)] dark:shadow-none">
              <div className="flex flex-wrap items-end gap-x-5 gap-y-3 px-4 py-3">
                <div>
                  <p className="mb-1 text-[11px] font-medium text-muted-foreground">Dựa trên lượt mượn</p>
                  <div className="max-w-full overflow-x-auto">
                    <SegmentedControl
                      layoutId="reorder-days"
                      value={String(days)}
                      onChange={(value) => setDays(Number(value))}
                      options={dayOptions.map((option) => ({ value: String(option), label: `${option} ngày qua` }))}
                      className="w-max whitespace-nowrap"
                    />
                  </div>
                </div>
                <label className="block">
                  <span className="mb-1 block text-[11px] font-medium text-muted-foreground">Số đề xuất</span>
                  <Select value={String(limit)} onValueChange={(value) => setLimit(Number(value))}>
                    <SelectTrigger size="sm" className="w-[110px]" aria-label="Số đề xuất">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {[20, 50, 100].map((n) => <SelectItem key={n} value={String(n)}>Top {n}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </label>
                <label className="block">
                  <span className="mb-1 block text-[11px] font-medium text-muted-foreground">Ngân sách</span>
                  <div className="relative">
                    <Input
                      inputMode="numeric"
                      placeholder="Không giới hạn"
                      value={budgetDraft}
                      onChange={(event) => {
                        const digits = event.target.value.replace(/[^\d]/g, '');
                        setBudgetDraft(digits ? Number(digits).toLocaleString('vi-VN') : '');
                      }}
                      onBlur={commitBudget}
                      onKeyDown={(event) => { if (event.key === 'Enter') commitBudget(); }}
                      className="h-8 w-[170px] pr-7 text-[13px]"
                    />
                    <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[12px] text-muted-foreground">đ</span>
                  </div>
                </label>
                {data ? (
                  <p className="text-[11px] text-muted-foreground lg:ml-auto">
                    Hàng về sau khoảng <span className="font-medium text-foreground">{data.range.leadTimeDays} ngày</span> kể từ lúc đặt · cập nhật {formatDateTime(data.generated_at)}
                  </p>
                ) : null}
              </div>

              <div className="flex items-center gap-1 overflow-x-auto border-t border-border p-2 [scrollbar-width:thin]" role="group" aria-label="Lọc theo độ gấp">
                {URGENCY_FILTERS.map((key) => {
                  const active = urgencyFilter === key;
                  const count = urgencyCounts[key] ?? 0;
                  return (
                    <button
                      key={key}
                      type="button"
                      aria-pressed={active}
                      onClick={() => setUrgencyFilter(key)}
                      title={key === 'ALL' ? undefined : URGENCY[key].hint(leadDays)}
                      className={`flex shrink-0 flex-col items-start rounded-lg border px-3 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                        active ? 'border-violet-300 bg-violet-50 text-violet-800 dark:border-violet-500/40 dark:bg-violet-500/15 dark:text-violet-300' : 'border-transparent hover:border-border hover:bg-muted/50'
                      }`}
                    >
                      <span className={`text-[18px] font-semibold leading-tight tabular-nums ${!active && !count ? 'text-muted-foreground/60' : ''}`}>{loading ? '–' : count}</span>
                      <span className={`flex items-center gap-1.5 whitespace-nowrap text-[11px] ${active ? 'font-medium' : 'text-muted-foreground'}`}>
                        {key !== 'ALL' && <span className={`h-1.5 w-1.5 rounded-full ${URGENCY[key].dot}`} aria-hidden="true" />}
                        {key === 'ALL' ? 'Tất cả đề xuất' : URGENCY[key].label}
                      </span>
                    </button>
                  );
                })}
                <div className="ml-auto hidden shrink-0 px-3 text-right sm:block">
                  <p className="font-mono text-[15px] font-semibold tabular-nums text-foreground">{formatVnd(visibleCost)}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {visibleQty.toLocaleString('vi-VN')} cuốn đề xuất
                    {data?.budget ? <> · ngân sách còn <span className={data.budget.remaining_vnd <= 0 ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'}>{formatVnd(data.budget.remaining_vnd)}</span></> : null}
                  </p>
                </div>
              </div>
            </div>

            <SectionCard noPadding>
              {loading ? (
                <div className="flex min-h-[260px] items-center justify-center">
                  <LoadingSpinner message="Đang phân tích nhu cầu..." />
                </div>
              ) : error ? (
                errorState(error, () => void loadData(), 'Không thể tải gợi ý nhập thêm')
              ) : visibleItems.length === 0 ? (
                <EmptyState
                  title={items.length === 0 ? 'Chưa có sách cần nhập thêm' : 'Không có đề xuất ở mức này'}
                  description={items.length === 0 ? 'Không có tín hiệu mượn, đặt chỗ hoặc thiếu tồn kho trong khoảng thời gian đã chọn.' : 'Chọn mức độ gấp khác để xem các đề xuất còn lại.'}
                  icon={PackagePlus}
                />
              ) : (
                <table className="w-full table-fixed text-left text-[13px]">
                  <thead className="border-b border-border bg-muted/40 text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
                    <tr>
                      {canCreatePo ? (
                        <th className="w-10 px-3 py-3">
                          <Checkbox checked={allVisibleSelected} onCheckedChange={(checked) => toggleAllVisible(checked === true)} aria-label="Chọn tất cả đề xuất đang hiển thị" />
                        </th>
                      ) : null}
                      <th className="px-3 py-3 font-semibold">Sách</th>
                      <th className="hidden w-[200px] px-3 py-3 font-semibold md:table-cell">Tồn &amp; nhu cầu</th>
                      <th className="hidden w-[160px] px-3 py-3 font-semibold sm:table-cell">Khi nào hết</th>
                      <th className="w-[120px] px-4 py-3 text-right font-semibold">Nên nhập</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {visibleItems.map((item) => {
                      const urgency = urgencyOf(item, leadDays);
                      const qty = qtyFor(item);
                      const selected = selectedIds.has(item.variant_id);
                      const trend = Math.round(item.demand_trend_pct);
                      const expanded = reasonOpen === item.variant_id;
                      return (
                        <tr key={item.variant_id} className={`align-top transition hover:bg-muted/30 ${selected ? 'bg-violet-50/50 dark:bg-violet-500/5' : ''}`}>
                          {canCreatePo ? (
                            <td className="px-3 py-3">
                              <Checkbox checked={selected} onCheckedChange={(checked) => toggleItem(item.variant_id, checked === true)} aria-label={`Chọn ${item.title}`} />
                            </td>
                          ) : null}
                          <td className="px-3 py-3">
                            <p className="line-clamp-2 font-semibold text-foreground sm:line-clamp-none sm:truncate" title={item.title || undefined}>{item.title || 'Chưa có tên sách'}</p>
                            <p className="truncate text-[12px] text-muted-foreground">
                              {[item.author, item.isbn].filter(Boolean).join(' · ') || 'Chưa có metadata'}
                            </p>
                            <p className="mt-1 text-[12px] text-muted-foreground md:hidden">
                              Còn {item.available_qty} · {item.borrow_count} lượt mượn
                            </p>
                            <p className={`mt-0.5 text-[12px] font-medium sm:hidden ${URGENCY[urgency].text}`}>{stockoutText(item)}</p>
                            <button
                              type="button"
                              onClick={() => setReasonOpen(expanded ? null : item.variant_id)}
                              aria-expanded={expanded}
                              className="mt-1 rounded text-[11px] text-violet-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:text-violet-400"
                            >
                              {expanded ? 'Ẩn lý do' : 'Vì sao?'}
                            </button>
                            {expanded ? <p className="mt-1 rounded-md bg-muted/40 px-2.5 py-2 text-[12px] leading-relaxed text-muted-foreground">{item.reason}</p> : null}
                          </td>
                          <td className="hidden px-3 py-3 text-[12px] leading-relaxed md:table-cell">
                            <p><span className="font-semibold text-foreground">Còn {item.available_qty}</span> <span className="text-muted-foreground">sẵn sàng</span></p>
                            <p className="text-muted-foreground">
                              {item.borrow_count} lượt mượn{item.reservation_count ? ` · ${item.reservation_count} đặt chỗ` : ''}
                              {trend !== 0 ? <span className={trend > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}> · {trend > 0 ? '↑' : '↓'}{Math.abs(trend)}%</span> : null}
                            </p>
                            {item.seasonal_event ? (
                              <div className="mt-1"><StatusBadge label={`${item.seasonal_event} · ${item.seasonal_index}x`} variant="info" dot /></div>
                            ) : null}
                          </td>
                          <td className="hidden px-3 py-3 sm:table-cell">
                            <p className={`text-[13px] font-semibold ${URGENCY[urgency].text}`}>{stockoutText(item)}</p>
                            <p className="mt-0.5 text-[11px] text-muted-foreground">Ưu tiên {(PRIORITY_LABELS[item.priority as PriorityFilter] ?? item.priority).toLowerCase()}</p>
                          </td>
                          <td className="px-4 py-3 text-right">
                            {canCreatePo ? (
                              <Input
                                type="number"
                                min={1}
                                inputMode="numeric"
                                value={qty}
                                onChange={(event) => setQtyOverride(item.variant_id, Number(event.target.value))}
                                aria-label={`Số lượng nhập cho ${item.title}`}
                                className="ml-auto h-8 w-20 text-right font-mono text-[13px] font-semibold"
                              />
                            ) : (
                              <p className="font-semibold text-foreground">{qty} cuốn</p>
                            )}
                            <p className="mt-1 text-[11px] text-muted-foreground">{formatVnd(qty * (item.unit_cost || 0))}</p>
                            {data?.budget && item.within_budget === false ? (
                              <p className="mt-0.5 text-[11px] font-medium text-rose-600 dark:text-rose-400">Vượt ngân sách</p>
                            ) : null}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </SectionCard>

            {canCreatePo && selectedItems.length > 0 ? (
              <div className="sticky bottom-4 z-20 mx-auto flex w-fit max-w-full flex-wrap items-center gap-3 rounded-xl border border-border bg-card px-4 py-2.5 text-[13px] shadow-lg">
                <span>
                  Đã chọn <span className="font-semibold">{selectedItems.length} sách</span> · {selectedQty.toLocaleString('vi-VN')} cuốn · <span className="font-mono">{formatVnd(selectedCost)}</span>
                </span>
                <Button variant="ghost" size="sm" onClick={() => setSelectedIds(new Set())}>Bỏ chọn</Button>
                <Button size="sm" onClick={createPurchaseOrder}>
                  <PackagePlus className="h-3.5 w-3.5" />Tạo đơn đặt hàng
                </Button>
              </div>
            ) : null}
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
