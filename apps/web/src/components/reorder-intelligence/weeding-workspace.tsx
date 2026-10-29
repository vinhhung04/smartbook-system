import { useState } from 'react';
import { Archive, ArrowLeftRight, Layers, Recycle } from 'lucide-react';
import { cn } from '@/components/ui/utils';
import type { WeedingSuggestionItem, WeedingSuggestionsData } from '@/services/analytics';
import { formatCount, formatDate, formatVnd } from '@/lib/reorder-intelligence';
import { Figure, FilterPills, LoadingRows, Meter, Panel, StateMessage, SUMMARY_GRID } from './primitives';
import { useMediaQuery, WIDE_QUERY } from './meta';

type ActionFilter = 'ALL' | WeedingSuggestionItem['suggested_action'];

const ACTION_META: Record<WeedingSuggestionItem['suggested_action'], { label: string; icon: typeof Recycle; why: string; chip: string }> = {
  REDISTRIBUTE: {
    label: 'Chuyển kho',
    icon: ArrowLeftRight,
    why: 'Cùng đầu sách vẫn có nhu cầu gần đây ở kho khác.',
    chip: 'border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-300',
  },
  LIQUIDATE: {
    label: 'Thanh lý',
    icon: Recycle,
    why: 'Không thấy nhu cầu gần đây ở kho nào khác.',
    chip: 'border-border bg-muted/60 text-foreground',
  },
};

function idleText(item: WeedingSuggestionItem) {
  return item.days_since_last_activity === null ? 'Chưa từng có hoạt động' : `${formatCount(item.days_since_last_activity)} ngày`;
}

function SeverityLabel({ severity }: { severity: WeedingSuggestionItem['severity'] }) {
  return severity === 'CRITICAL'
    ? <span className="text-[11.5px] font-medium text-amber-800 dark:text-amber-300">Tồn rất lâu</span>
    : <span className="text-[11.5px] text-muted-foreground">Tồn lâu</span>;
}

function ActionChip({ action }: { action: WeedingSuggestionItem['suggested_action'] }) {
  const meta = ACTION_META[action];
  const Icon = meta.icon;
  return (
    <span className={cn('inline-flex items-center gap-1 whitespace-nowrap rounded-md border px-1.5 py-0.5 text-[11.5px] font-medium', meta.chip)}>
      <Icon className="h-3 w-3" aria-hidden="true" />
      {meta.label}
    </span>
  );
}

export function WeedingWorkspace({ data, loading, error, onRetry }: {
  data: WeedingSuggestionsData | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}) {
  const [filter, setFilter] = useState<ActionFilter>('ALL');
  const wide = useMediaQuery(WIDE_QUERY);

  if (loading && !data) return <Panel><LoadingRows label="Đang kiểm tra tồn kho lâu ngày…" /></Panel>;
  if (error && !data) {
    return <Panel><StateMessage icon={Archive} tone="error" title="Không thể tải đề xuất thanh lý / chuyển kho" onRetry={onRetry}>{error}</StateMessage></Panel>;
  }
  if (!data) return null;

  const { summary, threshold_days: threshold } = data;
  const items = data.items;
  const visible = filter === 'ALL' ? items : items.filter((item) => item.suggested_action === filter);
  const maxValue = Math.max(0, ...items.map((item) => item.tied_up_value));

  return (
    <div className="space-y-4">
      {error ? (
        <Panel className="border-red-200 dark:border-red-500/30">
          <StateMessage icon={Archive} tone="error" title="Không thể cập nhật — đang hiển thị kết quả trước đó" onRetry={onRetry}>{error}</StateMessage>
        </Panel>
      ) : null}

      <Panel aria-label="Tóm tắt tồn kho lâu ngày" className={SUMMARY_GRID}>
        <Figure label="Vốn đang tồn đọng" value={formatVnd(summary.total_tied_up_value)} hint="số lượng tồn × đơn giá, trên toàn bộ dòng" />
        <Figure label="Dòng sách · kho" value={formatCount(summary.total_items)} hint={`không hoạt động ≥ ${threshold} ngày`} />
        <Figure label="Tồn rất lâu" value={formatCount(summary.critical_count)} tone={summary.critical_count ? 'warning' : 'muted'} hint={`≥ ${threshold * 2} ngày hoặc chưa từng hoạt động`} />
        <Figure label="Đề xuất chuyển kho" value={formatCount(summary.redistribute_count)} hint="nơi khác vẫn có nhu cầu" />
        <Figure label="Đề xuất thanh lý" value={formatCount(summary.liquidate_count)} hint="không thấy nhu cầu ở kho khác" />
      </Panel>

      <Panel aria-labelledby="weeding-list-title" className="overflow-hidden">
        <div className="space-y-3 border-b border-border px-4 py-3">
          <div>
            <h2 id="weeding-list-title" className="text-[14px] font-semibold text-foreground">Tồn kho lâu ngày & hướng xử lý</h2>
            <p className="mt-1 max-w-[90ch] text-[12.5px] leading-relaxed text-muted-foreground">
              Sách còn tồn nhưng không có lượt mượn hoặc di chuyển kho từ {data.cutoff ? formatDate(data.cutoff) : `${threshold} ngày trước`}.
              Đây là danh sách để xem xét — trang này không thực hiện chuyển kho hay thanh lý, và giá trị tồn đọng không phải số tiền chắc chắn thu hồi được.
            </p>
          </div>
          {items.length ? (
            <FilterPills
              label="Lọc theo hướng xử lý"
              value={filter}
              onChange={setFilter}
              options={[
                { value: 'ALL', label: 'Tất cả', count: items.length, icon: Layers },
                { value: 'REDISTRIBUTE', label: 'Chuyển kho', count: items.filter((i) => i.suggested_action === 'REDISTRIBUTE').length, icon: ArrowLeftRight },
                { value: 'LIQUIDATE', label: 'Thanh lý', count: items.filter((i) => i.suggested_action === 'LIQUIDATE').length, icon: Recycle },
              ]}
            />
          ) : null}
        </div>

        <div aria-busy={loading} className={loading ? 'opacity-60 transition-opacity' : 'transition-opacity'}>
          {items.length === 0 ? (
            <StateMessage icon={Archive} title="Không có sách tồn lâu cần xem xét">
              Mọi sách còn tồn đều có lượt mượn hoặc di chuyển kho trong {threshold} ngày gần đây.
            </StateMessage>
          ) : visible.length === 0 ? (
            <StateMessage icon={Layers} title="Không có dòng nào với hướng xử lý này" />
          ) : wide ? (
            <div role="region" aria-label="Bảng tồn kho lâu ngày" tabIndex={0} className="max-h-[min(72vh,760px)] overflow-auto focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring">
              <table className="w-full min-w-[760px] border-separate border-spacing-0 text-left text-[13px]">
                <caption className="sr-only">Sách tồn lâu theo kho, xếp theo giá trị tồn đọng</caption>
                <thead className="sticky top-0 z-10 whitespace-nowrap text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                  <tr className="[&>th]:border-b [&>th]:border-border [&>th]:bg-muted/50 [&>th]:py-2.5">
                    <th scope="col" className="pl-4 pr-3">Sách · kho</th>
                    <th scope="col" className="w-[90px] px-3 text-right">Tồn</th>
                    <th scope="col" className="w-[170px] px-3">Không hoạt động</th>
                    <th scope="col" className="w-[200px] px-3 text-right">Vốn tồn đọng</th>
                    <th scope="col" className="w-[230px] px-3 pr-4">Hướng xử lý đề xuất</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((item) => {
                    const cell = 'border-b border-border px-3 py-3 align-top';
                    return (
                      <tr key={`${item.variant_id}-${item.warehouse_id}`} className="transition-colors duration-150 hover:bg-muted/35">
                        <td className={cn(cell, 'pl-4')}>
                          <p className="line-clamp-2 font-semibold leading-snug text-foreground" title={item.title}>{item.title}</p>
                          <p className="mt-0.5 truncate text-[12px] text-muted-foreground">{item.warehouse_name}</p>
                        </td>
                        <td className={cn(cell, 'text-right font-medium tabular-nums text-foreground')}>{formatCount(item.on_hand_qty)} bản</td>
                        <td className={cell}>
                          <p className="tabular-nums text-foreground">{idleText(item)}</p>
                          <SeverityLabel severity={item.severity} />
                        </td>
                        <td className={cn(cell, 'text-right')}>
                          <p className="font-semibold tabular-nums text-foreground">{item.unit_cost > 0 ? formatVnd(item.tied_up_value) : <span className="text-[12px] font-normal text-amber-700 dark:text-amber-400">Chưa có đơn giá</span>}</p>
                          {item.unit_cost > 0 ? <Meter value={maxValue ? item.tied_up_value / maxValue : 0} fill="bg-foreground/45" className="mt-1.5 w-28" /> : null}
                        </td>
                        <td className={cn(cell, 'pr-4')}>
                          <ActionChip action={item.suggested_action} />
                          <p className="mt-1 text-[11.5px] leading-snug text-muted-foreground">{ACTION_META[item.suggested_action].why}</p>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <ul className="divide-y divide-border" aria-label="Tồn kho lâu ngày">
              {visible.map((item) => (
                <li key={`${item.variant_id}-${item.warehouse_id}`} className="px-4 py-3.5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-semibold leading-snug text-foreground">{item.title}</p>
                      <p className="truncate text-[12px] text-muted-foreground">{item.warehouse_name}</p>
                    </div>
                    <ActionChip action={item.suggested_action} />
                  </div>
                  <dl className="mt-2 grid grid-cols-3 gap-2 text-[12px]">
                    <div><dt className="text-muted-foreground">Tồn</dt><dd className="font-semibold tabular-nums text-foreground">{formatCount(item.on_hand_qty)} bản</dd></div>
                    <div><dt className="text-muted-foreground">Không hoạt động</dt><dd className="font-semibold tabular-nums text-foreground">{idleText(item)}</dd><dd><SeverityLabel severity={item.severity} /></dd></div>
                    <div><dt className="text-muted-foreground">Vốn tồn đọng</dt><dd className="font-semibold tabular-nums text-foreground">{item.unit_cost > 0 ? formatVnd(item.tied_up_value) : 'Chưa có giá'}</dd></div>
                  </dl>
                  <p className="mt-1.5 text-[11.5px] text-muted-foreground">{ACTION_META[item.suggested_action].why}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Panel>
    </div>
  );
}
