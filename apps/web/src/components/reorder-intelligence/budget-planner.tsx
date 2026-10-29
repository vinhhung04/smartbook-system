import { useState } from 'react';
import { ChevronDown, Wallet, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/components/ui/utils';
import type { ReorderSuggestionsData } from '@/services/analytics';
import { formatCount, formatVnd, type LineTotals } from '@/lib/reorder-intelligence';
import { Eyebrow, Panel } from './primitives';

const FUNDING_ORDER: Record<string, string> = {
  MARGINAL_SERVICE_PER_COST: 'Mỗi bản được cấp cho dòng tăng khả năng đáp ứng nhu cầu nhiều nhất trên mỗi đồng.',
  PRIORITY_WAREHOUSE_THEN_MARGINAL: 'Ưu tiên các dòng thiếu ở kho được chọn, phần còn lại cấp theo mức tăng khả năng đáp ứng trên mỗi đồng.',
};

function digitsOf(value: string) {
  return value.replace(/[^\d]/g, '');
}

/** A horizontal bar of up to three labelled segments; values are always printed, never color-only. */
function AllocationBar({ label, segments, scale }: {
  label: string;
  scale: number;
  segments: Array<{ value: number; className: string; name: string }>;
}) {
  const total = segments.reduce((sum, segment) => sum + segment.value, 0);
  const text = segments.map((segment) => `${segment.name} ${formatVnd(segment.value)}`).join(', ');
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-3 text-[12px]">
        <span className="font-medium text-foreground">{label}</span>
        <span className="tabular-nums text-muted-foreground">{formatVnd(total)}</span>
      </div>
      <div className="flex h-2.5 overflow-hidden rounded-full bg-muted" role="img" aria-label={`${label}: ${text}`}>
        {segments.map((segment) => (
          <span
            key={segment.name}
            className={cn('h-full first:rounded-l-full last:rounded-r-full', segment.className)}
            style={{ width: `${scale > 0 ? Math.min(100, (segment.value / scale) * 100) : 0}%` }}
          />
        ))}
      </div>
    </div>
  );
}

export function BudgetPlanner({ data, budgetVnd, onBudgetChange, selection, hasManualEdits, loading }: {
  data: ReorderSuggestionsData | null;
  budgetVnd: number | '';
  onBudgetChange: (value: number | '') => void;
  /** Totals of the rows the user selected for a purchase order (null when nothing is selected). */
  selection: LineTotals | null;
  hasManualEdits: boolean;
  loading: boolean;
}) {
  const [draft, setDraft] = useState(budgetVnd === '' ? '' : budgetVnd.toLocaleString('vi-VN'));
  const [showAssumptions, setShowAssumptions] = useState(false);
  const budget = data?.budget ?? null;
  const pendingValue = digitsOf(draft) ? Number(digitsOf(draft)) : '';
  const dirty = pendingValue !== budgetVnd;

  // The analysis is requested only when the user commits a value - never per keystroke.
  const commit = () => { if (dirty) onBudgetChange(pendingValue); };
  const clear = () => { setDraft(''); onBudgetChange(''); };

  const need = budget?.capped_need_cost ?? null;
  const scale = Math.max(budget?.budget_vnd ?? 0, need ?? 0, selection?.cost ?? 0);

  return (
    <Panel aria-labelledby="budget-planner-title" className="p-4 sm:p-5">
      <div className="grid gap-5 lg:grid-cols-[minmax(240px,300px)_1fr] lg:gap-8">
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Wallet className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            <h2 id="budget-planner-title" className="text-[14px] font-semibold text-foreground">Kế hoạch ngân sách</h2>
          </div>
          <p className="text-[12.5px] leading-relaxed text-muted-foreground">
            Nhập ngân sách để hệ thống phân bổ số bản cho từng đề xuất. Để trống nếu chỉ cần xem nhu cầu.
          </p>
          <form
            className="flex items-center gap-2"
            onSubmit={(event) => { event.preventDefault(); commit(); }}
          >
            <label htmlFor="budget-input" className="sr-only">Ngân sách nhập sách (đồng)</label>
            <div className="relative min-w-0 flex-1">
              <input
                id="budget-input"
                inputMode="numeric"
                autoComplete="off"
                placeholder="Không giới hạn"
                value={draft}
                onChange={(event) => {
                  const digits = digitsOf(event.target.value).slice(0, 13);
                  setDraft(digits ? Number(digits).toLocaleString('vi-VN') : '');
                }}
                onBlur={commit}
                className="h-9 w-full rounded-lg border border-border bg-input-background pl-3 pr-14 text-[13.5px] font-medium tabular-nums text-foreground outline-none transition-[border-color,box-shadow] placeholder:font-normal placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/30"
              />
              <span className="pointer-events-none absolute right-8 top-1/2 -translate-y-1/2 text-[12px] text-muted-foreground">đ</span>
              {draft ? (
                <button
                  type="button"
                  onClick={clear}
                  className="absolute right-1.5 top-1/2 grid h-6 w-6 -translate-y-1/2 cursor-pointer place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
                  aria-label="Xóa ngân sách"
                >
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              ) : null}
            </div>
            <Button type="submit" size="sm" variant={dirty ? 'default' : 'outline'} disabled={!dirty || loading} className="h-9">
              Phân bổ
            </Button>
          </form>
          {budgetVnd !== '' && !loading && budget ? (
            <p className="text-[11.5px] text-muted-foreground">Đang áp dụng {formatVnd(budget.budget_vnd)}.</p>
          ) : null}
        </div>

        {budget ? (
          <div className="min-w-0 space-y-4" aria-live="polite">
            <div className="space-y-3">
              <AllocationBar
                label="Ngân sách nhập vào"
                scale={scale}
                segments={[
                  { name: 'Đã phân bổ', value: budget.funded_cost, className: 'bg-primary' },
                  { name: 'Còn lại', value: budget.remaining_vnd, className: 'bg-primary/25' },
                ]}
              />
              {need !== null ? (
                <AllocationBar
                  label="Nhu cầu theo kế hoạch ngân sách"
                  scale={scale}
                  segments={[
                    { name: 'Được cấp', value: Math.min(budget.funded_cost, need), className: 'bg-primary' },
                    { name: 'Chưa được cấp', value: Math.max(0, need - budget.funded_cost), className: 'bg-amber-400/70 dark:bg-amber-400/50' },
                  ]}
                />
              ) : null}
              {selection && selection.lines > 0 ? (
                <AllocationBar
                  label="Bạn đang chọn để đặt hàng"
                  scale={scale}
                  segments={[{ name: 'Đã chọn', value: selection.cost, className: selection.cost > budget.budget_vnd ? 'bg-red-500' : 'bg-foreground/70' }]}
                />
              ) : null}
            </div>

            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 border-t border-border pt-3 text-[12px] sm:grid-cols-4">
              <div>
                <dt className="text-muted-foreground">Đã phân bổ</dt>
                <dd className="mt-0.5 text-[14px] font-semibold tabular-nums text-foreground">{formatVnd(budget.funded_cost)}</dd>
                <dd className="text-muted-foreground">{formatCount(budget.funded_qty ?? 0)} bản · {formatCount(budget.funded_lines ?? 0)} dòng</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Còn lại</dt>
                <dd className="mt-0.5 text-[14px] font-semibold tabular-nums text-foreground">{formatVnd(budget.remaining_vnd)}</dd>
                <dd className="text-muted-foreground">{budget.budget_vnd > 0 ? `${Math.round((budget.remaining_vnd / budget.budget_vnd) * 100)}% ngân sách` : '—'}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Cấp một phần</dt>
                <dd className="mt-0.5 text-[14px] font-semibold tabular-nums text-foreground">{formatCount(budget.partially_funded_lines ?? 0)} dòng</dd>
                <dd className="text-muted-foreground">trên toàn bộ đề xuất</dd>
              </div>
              <div>
                <dt className="text-muted-foreground" title="Tỷ lệ nhu cầu dự kiến trong thời gian chờ hàng mà các bản được cấp đáp ứng, so với khi cấp đủ toàn bộ kế hoạch (mô hình nhu cầu Poisson của hệ thống).">
                  Mức đáp ứng dự kiến
                </dt>
                <dd className="mt-0.5 text-[14px] font-semibold tabular-nums text-foreground">
                  {budget.expected_service_pct === null || budget.expected_service_pct === undefined ? '—' : `${budget.expected_service_pct.toLocaleString('vi-VN')}%`}
                </dd>
                <dd className="text-muted-foreground">{budget.expected_service_pct === null ? 'kế hoạch không có nhu cầu cần đáp ứng' : 'so với cấp đủ kế hoạch'}</dd>
              </div>
            </dl>

            {selection && selection.lines > 0 ? (
              <p className={cn('text-[12px] leading-relaxed', selection.cost > budget.budget_vnd ? 'text-red-700 dark:text-red-400' : 'text-muted-foreground')}>
                Lựa chọn hiện tại: {formatVnd(selection.cost)}
                {selection.missingCost ? ` (chưa gồm ${selection.missingCost} dòng chưa có giá)` : ''}
                {selection.cost > budget.budget_vnd ? ` — vượt ngân sách nhập vào ${formatVnd(selection.cost - budget.budget_vnd)}.` : ` — trong ngân sách nhập vào.`}
              </p>
            ) : null}
            {hasManualEdits ? (
              <p className="text-[12px] leading-relaxed text-amber-800 dark:text-amber-300">
                Bạn đã chỉnh số lượng thủ công. Phân bổ ở trên vẫn là kết quả hệ thống trả về cho số lượng gốc — hệ thống không phân bổ lại theo phần đã chỉnh.
              </p>
            ) : null}

            <div>
              <button
                type="button"
                onClick={() => setShowAssumptions((open) => !open)}
                aria-expanded={showAssumptions}
                aria-controls="budget-assumptions"
                className="inline-flex min-h-8 cursor-pointer items-center gap-1 rounded-md text-[12px] font-medium text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
              >
                Cách hệ thống phân bổ
                <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', showAssumptions && 'rotate-180')} aria-hidden="true" />
              </button>
              {showAssumptions ? (
                <ul id="budget-assumptions" className="mt-1 list-disc space-y-1 pl-5 text-[12px] leading-relaxed text-muted-foreground">
                  {budget.funding_order && FUNDING_ORDER[budget.funding_order] ? <li>{FUNDING_ORDER[budget.funding_order]}</li> : null}
                  {(budget.assumptions ?? []).map((text) => <li key={text}>{text}</li>)}
                </ul>
              ) : null}
            </div>
          </div>
        ) : (
          <div className="flex min-h-[120px] flex-col justify-center rounded-lg border border-dashed border-border px-4 py-4">
            <Eyebrow>Chưa đặt ngân sách</Eyebrow>
            <p className="mt-1.5 max-w-[60ch] text-[12.5px] leading-relaxed text-muted-foreground">
              Khi có ngân sách, hệ thống tính lại số lượng theo tồn quy đổi (khả dụng + hàng đang về + bản dự kiến được trả),
              rồi cho biết dòng nào được cấp đủ, cấp một phần hoặc chưa được cấp.
            </p>
          </div>
        )}
      </div>
    </Panel>
  );
}
