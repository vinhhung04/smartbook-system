import { useMemo, useState } from 'react';
import { CircleCheck, CircleDashed, CircleSlash, Layers, Loader2, PackagePlus, PieChart } from 'lucide-react';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { ReorderSuggestionsData } from '@/services/analytics';
import {
  buildPlanLine,
  countByUrgency,
  formatCount,
  formatDateTime,
  formatVnd,
  sortByUrgency,
  totalLines,
  URGENCY_ORDER,
  type FundingStatus,
  type PlanLine,
  type Urgency,
} from '@/lib/reorder-intelligence';
import { BudgetPlanner } from './budget-planner';
import { Figure, FilterPills, LoadingRows, Panel, StateMessage, SUMMARY_GRID } from './primitives';
import { URGENCY_META } from './meta';
import { ReorderTable } from './reorder-table';
import { SelectionActionBar } from './selection-action-bar';

const DAY_OPTIONS = [7, 30, 90];
const LIMIT_OPTIONS = [20, 50, 100];

type UrgencyFilter = 'ALL' | Urgency;
type FundingFilter = 'ALL' | FundingStatus;

const FUNDING_FILTERS: Array<{ value: FundingFilter; label: string; icon?: typeof CircleCheck }> = [
  { value: 'ALL', label: 'Mọi trạng thái cấp' },
  { value: 'FULL', label: 'Cấp đủ', icon: CircleCheck },
  { value: 'PARTIAL', label: 'Cấp một phần', icon: PieChart },
  { value: 'UNFUNDED', label: 'Chưa được cấp', icon: CircleDashed },
  { value: 'NOT_NEEDED', label: 'Không cần nhập', icon: CircleSlash },
];

export interface ReorderWorkspaceProps {
  data: ReorderSuggestionsData | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  days: number;
  onDaysChange: (days: number) => void;
  limit: number;
  onLimitChange: (limit: number) => void;
  budgetVnd: number | '';
  onBudgetChange: (value: number | '') => void;
  canCreatePo: boolean;
  onCreatePurchaseOrder: (lines: PlanLine[]) => void;
}

export function ReorderWorkspace(props: ReorderWorkspaceProps) {
  const { data, loading, error, onRetry, days, onDaysChange, limit, onLimitChange, budgetVnd, onBudgetChange, canCreatePo, onCreatePurchaseOrder } = props;
  const [urgencyFilter, setUrgencyFilter] = useState<UrgencyFilter>('ALL');
  const [fundingFilter, setFundingFilter] = useState<FundingFilter>('ALL');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // A new analysis replaces the list, so per-row choices from the old one no longer apply.
  const [seenData, setSeenData] = useState(data);
  if (seenData !== data) {
    setSeenData(data);
    setSelectedIds(new Set());
    setDrafts({});
    setExpandedId(null);
  }

  const items = useMemo(() => (Array.isArray(data?.items) ? data.items : []), [data]);
  const leadDays = data?.range.leadTimeDays ?? 14;
  const hasBudget = Boolean(data?.budget);

  const lines = useMemo(
    () => sortByUrgency(items, leadDays).map((item) => buildPlanLine(item, leadDays, hasBudget, drafts[item.variant_id])),
    [items, leadDays, hasBudget, drafts],
  );
  const urgencyCounts = useMemo(() => countByUrgency(items, leadDays), [items, leadDays]);
  const fundingCounts = useMemo(() => {
    const counts: Record<FundingStatus, number> = { FULL: 0, PARTIAL: 0, UNFUNDED: 0, NOT_NEEDED: 0 };
    for (const line of lines) if (line.funding) counts[line.funding] += 1;
    return counts;
  }, [lines]);

  const activeFunding = hasBudget ? fundingFilter : 'ALL';
  const visible = lines.filter((line) => (urgencyFilter === 'ALL' || line.urgency === urgencyFilter)
    && (activeFunding === 'ALL' || line.funding === activeFunding));
  const selectedLines = lines.filter((line) => selectedIds.has(line.item.variant_id));
  const selection = selectedLines.length
    ? totalLines(selectedLines.map((line) => ({ qty: line.qty, unitCost: line.item.unit_cost })))
    : null;
  const hasManualEdits = lines.some((line) => line.manual);
  const missingPriceCount = lines.filter((line) => line.item.unit_cost <= 0 && line.item.suggested_reorder_qty > 0).length;

  // "Select all" takes the visible rows that have a quantity to order; rows the
  // system proposes 0 for stay opt-in, one by one.
  const visibleSelectable = visible.filter((line) => line.qty !== null);
  const visibleSelectedCount = visibleSelectable.filter((line) => selectedIds.has(line.item.variant_id)).length;
  const headerChecked = visibleSelectable.length > 0 && visibleSelectedCount === visibleSelectable.length
    ? true
    : visibleSelectedCount > 0 ? 'indeterminate' : false;
  const selectableUnselected = lines.filter((line) => line.qty !== null && !selectedIds.has(line.item.variant_id)).length;

  const setSelected = (ids: string[], checked: boolean) => setSelectedIds((current) => {
    const next = new Set(current);
    for (const id of ids) if (checked) next.add(id); else next.delete(id);
    return next;
  });
  const setDraft = (id: string, value: string | undefined) => setDrafts((current) => {
    const next = { ...current };
    if (value === undefined) delete next[id]; else next[id] = value;
    return next;
  });

  const initialLoading = loading && !data;
  const reloading = loading && Boolean(data);
  const urgent = urgencyCounts.OUT + urgencyCounts.BEFORE_RESTOCK;

  return (
    <div className="space-y-4">
      {/* Analysis scope: what period the demand comes from and how many suggestions to load. */}
      <Panel aria-label="Phạm vi phân tích" className="flex flex-col gap-3 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
          <div className="flex flex-col items-start gap-1.5 sm:flex-row sm:items-center sm:gap-2.5">
            <span id="reorder-days-label" className="text-[12px] text-muted-foreground">Nhu cầu trong</span>
            <div role="group" aria-labelledby="reorder-days-label" className="max-w-full overflow-x-auto">
              <SegmentedControl
                layoutId="reorder-days"
                value={String(days)}
                onChange={(value) => onDaysChange(Number(value))}
                options={DAY_OPTIONS.map((option) => ({ value: String(option), label: `${option} ngày` }))}
                className="w-max whitespace-nowrap"
              />
            </div>
          </div>
          <div className="flex items-center gap-2.5">
            <span id="reorder-limit-label" className="text-[12px] text-muted-foreground">Hiển thị</span>
            <Select value={String(limit)} onValueChange={(value) => onLimitChange(Number(value))}>
              <SelectTrigger size="sm" className="w-[104px]" aria-labelledby="reorder-limit-label">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LIMIT_OPTIONS.map((n) => <SelectItem key={n} value={String(n)}>Top {n}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
        <p className="flex items-center gap-2 text-[12px] text-muted-foreground" aria-live="polite">
          {loading ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              <span>Đang phân tích lại…</span>
            </>
          ) : data ? (
            <span>
              Dữ liệu {data.range.from} → {data.range.to} · Chờ hàng mặc định{' '}
              <span className="font-medium text-foreground">{data.range.leadTimeDays} ngày</span> (khi sách chưa có số liệu riêng)
              <span className="hidden xl:inline"> · cập nhật {formatDateTime(data.generated_at)}</span>
            </span>
          ) : null}
        </p>
      </Panel>

      {initialLoading ? (
        <Panel><LoadingRows label="Đang phân tích nhu cầu và tồn kho…" /></Panel>
      ) : error && !data ? (
        <Panel><StateMessage icon={PackagePlus} tone="error" title="Không thể tải gợi ý nhập thêm" onRetry={onRetry}>{error}</StateMessage></Panel>
      ) : data ? (
        <>
          {error ? (
            <Panel className="border-red-200 dark:border-red-500/30">
              <StateMessage icon={PackagePlus} tone="error" title="Không thể cập nhật phân tích — đang hiển thị kết quả trước đó" onRetry={onRetry}>{error}</StateMessage>
            </Panel>
          ) : null}

          {/* Decision summary: each figure names the scope it counts. */}
          <Panel aria-label="Tóm tắt quyết định" className={SUMMARY_GRID}>
            <Figure label="Đầu sách đã phân tích" value={formatCount(data.summary.total_candidates)} hint={`đang tải top ${formatCount(items.length)} theo ưu tiên`} />
            <Figure label="Đã hết hàng" value={formatCount(urgencyCounts.OUT)} unit="đầu sách" tone={urgencyCounts.OUT ? 'critical' : 'muted'} hint={`trong ${formatCount(items.length)} đề xuất đã tải`} />
            <Figure label="Sẽ hết trước khi hàng về" value={formatCount(urgencyCounts.BEFORE_RESTOCK)} unit="đầu sách" tone={urgencyCounts.BEFORE_RESTOCK ? 'warning' : 'muted'} hint={`hết trước thời gian chờ hàng của sách, trong ${formatCount(items.length)} đề xuất`} />
            <Figure label="Tổng số lượng đề xuất" value={formatCount(data.summary.estimated_total_reorder_qty)} unit="bản" hint={`cho toàn bộ ${formatCount(data.summary.total_candidates)} đầu sách, chưa áp ngân sách`} />
            <Figure
              label="Chi phí ước tính"
              value={formatVnd(data.summary.estimated_total_cost)}
              hint={missingPriceCount ? `${missingPriceCount} dòng đã tải chưa có đơn giá (tính 0 đ)` : 'theo đơn giá trong danh mục'}
            />
          </Panel>

          <BudgetPlanner data={data} budgetVnd={budgetVnd} onBudgetChange={onBudgetChange} selection={selection} hasManualEdits={hasManualEdits} loading={loading} />

          <Panel aria-labelledby="reorder-list-title" className="overflow-hidden">
            <div className="space-y-3 border-b border-border px-4 py-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 id="reorder-list-title" className="text-[14px] font-semibold text-foreground">
                  Đề xuất nhập thêm
                  <span className="ml-2 text-[12.5px] font-normal text-muted-foreground">
                    {visible.length === lines.length ? `${formatCount(lines.length)} dòng` : `${formatCount(visible.length)} / ${formatCount(lines.length)} dòng`}
                    {urgent ? ` · ${formatCount(urgent)} cần xem xét gấp` : ''}
                  </span>
                </h2>
                {canCreatePo ? (
                  <p className="text-[11.5px] text-muted-foreground">Chọn sách và chỉnh số lượng để tạo đơn đặt hàng.</p>
                ) : null}
              </div>
              <FilterPills
                label="Lọc theo mức khẩn cấp"
                value={urgencyFilter}
                onChange={setUrgencyFilter}
                options={[
                  { value: 'ALL', label: 'Tất cả', count: lines.length, icon: Layers },
                  ...URGENCY_ORDER.map((key) => ({
                    value: key,
                    label: URGENCY_META[key].label,
                    count: urgencyCounts[key],
                    icon: URGENCY_META[key].icon,
                    title: URGENCY_META[key].hint,
                  })),
                ]}
              />
              {hasBudget ? (
                <FilterPills
                  label="Lọc theo trạng thái cấp ngân sách"
                  value={fundingFilter}
                  onChange={setFundingFilter}
                  options={FUNDING_FILTERS.map((option) => ({ ...option, count: option.value === 'ALL' ? undefined : fundingCounts[option.value] }))}
                />
              ) : null}
            </div>

            <div aria-busy={reloading} className={reloading ? 'pointer-events-none opacity-60 transition-opacity' : 'transition-opacity'}>
              {visible.length === 0 ? (
                lines.length === 0 ? (
                  <StateMessage icon={PackagePlus} title="Chưa có sách cần nhập thêm">
                    Không có tín hiệu mượn, đặt chỗ hoặc thiếu tồn kho trong {days} ngày đã chọn.
                  </StateMessage>
                ) : (
                  <StateMessage icon={Layers} title="Không có đề xuất nào khớp bộ lọc">
                    Chọn mức khẩn cấp hoặc trạng thái cấp ngân sách khác để xem các đề xuất còn lại.
                  </StateMessage>
                )
              ) : (
                <ReorderTable
                  lines={visible}
                  days={days}
                  hasBudget={hasBudget}
                  canEdit={canCreatePo}
                  locked={loading}
                  selectedIds={selectedIds}
                  onToggle={(id, checked) => setSelected([id], checked)}
                  headerChecked={headerChecked}
                  headerDisabled={visibleSelectable.length === 0}
                  onToggleAll={(checked) => setSelected(visibleSelectable.map((line) => line.item.variant_id), checked)}
                  onDraft={setDraft}
                  expandedId={expandedId}
                  onExpand={setExpandedId}
                />
              )}
            </div>
          </Panel>

          {canCreatePo && selection ? (
            <SelectionActionBar
              totals={selection}
              budgetVnd={data.budget?.budget_vnd ?? null}
              loadedCount={lines.length}
              selectableUnselected={selectableUnselected}
              onSelectAllLoaded={() => setSelected(lines.filter((line) => line.qty !== null).map((line) => line.item.variant_id), true)}
              onClear={() => setSelectedIds(new Set())}
              onCreate={() => onCreatePurchaseOrder(selectedLines)}
              locked={loading}
            />
          ) : null}
        </>
      ) : null}
    </div>
  );
}
