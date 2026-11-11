import { Fragment } from 'react';
import { ArrowDownRight, ArrowUpRight, ChevronDown, RotateCcw } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/components/ui/utils';
import { formatCount, formatVnd, MAX_ORDER_QTY, stockoutText, type PlanLine } from '@/lib/reorder-intelligence';
import { UrgencyChip } from './primitives';
import { URGENCY_META, useMediaQuery, WIDE_QUERY } from './meta';
import { ReorderDetail } from './reorder-detail';

export interface ReorderTableProps {
  lines: PlanLine[];
  days: number;
  hasBudget: boolean;
  /** Can build a purchase order: selection and quantity editing. */
  canEdit: boolean;
  /** A new analysis is loading; edits would be discarded, so inputs are locked. */
  locked: boolean;
  selectedIds: Set<string>;
  onToggle: (id: string, checked: boolean) => void;
  headerChecked: boolean | 'indeterminate';
  headerDisabled: boolean;
  onToggleAll: (checked: boolean) => void;
  onDraft: (id: string, value: string | undefined) => void;
  expandedId: string | null;
  onExpand: (id: string | null) => void;
}

const detailId = (id: string) => `reorder-detail-${id}`;
const qtyHintId = (id: string) => `reorder-qty-hint-${id}`;

function TrendMark({ pct }: { pct: number }) {
  const value = Math.round(pct);
  if (value === 0) return null;
  const Icon = value > 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <span className="inline-flex items-center text-[11.5px] text-muted-foreground" title={`${value > 0 ? 'Tăng' : 'Giảm'} ${Math.abs(value)}% so với kỳ trước`}>
      <Icon className="h-3 w-3" aria-hidden="true" />
      <span className="sr-only">{value > 0 ? 'tăng' : 'giảm'}</span>
      {Math.abs(value)}%
    </span>
  );
}

/** Small status under the quantity: manual edit, budget funding, validation. */
function QtyNote({ line, selected, hasBudget }: { line: PlanLine; selected: boolean; hasBudget: boolean }) {
  const { item, funding } = line;
  if (line.draft !== undefined && line.qty === null) {
    return <span className="text-red-600 dark:text-red-400">Nhập số nguyên từ 1 đến {formatCount(MAX_ORDER_QTY)}</span>;
  }
  if (line.qty === null) {
    return <span className={selected ? 'text-red-600 dark:text-red-400' : undefined}>{selected ? 'Nhập số lượng để đặt' : 'Không cần nhập'}</span>;
  }
  const parts: string[] = [];
  if (line.manual) parts.push(`Đã chỉnh · gốc ${formatCount(line.systemQty)}`);
  if (hasBudget && funding) {
    const cap = item.budget_plan?.cap_qty ?? item.suggested_reorder_qty;
    if (funding === 'FULL') parts.push(`Cấp đủ ${formatCount(item.funded_qty ?? 0)}`);
    if (funding === 'PARTIAL') parts.push(`Cấp ${formatCount(item.funded_qty ?? 0)}/${formatCount(cap)}`);
    if (funding === 'UNFUNDED') parts.push('Chưa được cấp');
    if (funding === 'NOT_NEEDED') parts.push('Ngân sách: không cần');
  }
  return (
    <>
      {parts.join(' · ')}
      {hasBudget && line.overFunded > 0 ? (
        <span className="block text-amber-700 dark:text-amber-400">+{formatCount(line.overFunded)} ngoài phần được cấp</span>
      ) : null}
    </>
  );
}

function QtyField({ line, selected, hasBudget, canEdit, locked, onDraft, compact = false }: {
  line: PlanLine;
  selected: boolean;
  hasBudget: boolean;
  canEdit: boolean;
  locked: boolean;
  onDraft: ReorderTableProps['onDraft'];
  compact?: boolean;
}) {
  const id = line.item.variant_id;
  const invalid = (line.draft !== undefined && line.qty === null) || (selected && line.qty === null);
  if (!canEdit) {
    return (
      <div className={cn(compact ? 'text-left' : 'text-right')}>
        <p className="text-[13px] font-semibold tabular-nums text-foreground">{line.qty === null ? '—' : `${formatCount(line.qty)} bản`}</p>
        <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground"><QtyNote line={line} selected={false} hasBudget={hasBudget} /></p>
      </div>
    );
  }
  return (
    <div className={cn('flex flex-col', compact ? 'items-start' : 'items-end')}>
      <div className="flex items-center gap-1">
        {line.manual ? (
          <button
            type="button"
            onClick={() => onDraft(id, undefined)}
            disabled={locked}
            className="grid h-7 w-7 cursor-pointer place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring disabled:opacity-50"
            aria-label={`Khôi phục số lượng hệ thống đề xuất (${line.systemQty}) cho ${line.item.title}`}
            title="Khôi phục số lượng đề xuất"
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        ) : null}
        <input
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete="off"
          value={line.draft ?? (line.systemQty > 0 ? String(line.systemQty) : '')}
          placeholder="0"
          disabled={locked}
          onChange={(event) => onDraft(id, event.target.value.replace(/[^\d]/g, '').slice(0, 6))}
          onFocus={(event) => event.target.select()}
          aria-label={`Số lượng nhập cho ${line.item.title}`}
          aria-invalid={invalid || undefined}
          aria-describedby={qtyHintId(id)}
          className={cn(
            'h-8 w-[72px] rounded-md border bg-input-background px-2 text-right text-[13px] font-semibold tabular-nums text-foreground outline-none placeholder:font-normal placeholder:text-muted-foreground/50 transition-[border-color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/30 disabled:opacity-60',
            invalid ? 'border-red-400 dark:border-red-500/60' : line.manual ? 'border-primary/50' : 'border-border',
          )}
        />
      </div>
      <p id={qtyHintId(id)} className={cn('mt-1 max-w-[160px] text-[11px] leading-snug text-muted-foreground', compact ? 'text-left' : 'text-right')}>
        <QtyNote line={line} selected={selected} hasBudget={hasBudget} />
      </p>
    </div>
  );
}

function CostCell({ line }: { line: PlanLine }) {
  if (line.cost !== null) return <span className="font-medium tabular-nums text-foreground">{formatVnd(line.cost)}</span>;
  if (line.qty === null) return <span className="text-muted-foreground">—</span>;
  return <span className="text-[12px] text-amber-700 dark:text-amber-400" title="Danh mục chưa có đơn giá — không tính vào tổng chi phí">Chưa có giá</span>;
}

function DetailToggle({ id, title, expanded, onExpand, compact = false }: {
  id: string; title: string; expanded: boolean; onExpand: (id: string | null) => void; compact?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={() => onExpand(expanded ? null : id)}
      aria-expanded={expanded}
      aria-controls={detailId(id)}
      aria-label={compact ? undefined : `${expanded ? 'Ẩn' : 'Xem'} lý do đề xuất cho ${title}`}
      className={cn(
        'inline-flex cursor-pointer items-center gap-1 rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring',
        compact ? 'min-h-8 px-2 text-[12.5px] font-medium text-primary hover:text-primary' : 'h-8 w-8 justify-center',
      )}
    >
      {compact ? (expanded ? 'Ẩn chi tiết' : 'Vì sao nên nhập?') : null}
      <ChevronDown className={cn('h-4 w-4 transition-transform duration-200', expanded && 'rotate-180')} aria-hidden="true" />
    </button>
  );
}

export function ReorderTable(props: ReorderTableProps) {
  const { lines, days, hasBudget, canEdit, locked, selectedIds, onToggle, headerChecked, headerDisabled, onToggleAll, onDraft, expandedId, onExpand } = props;
  const columns = canEdit ? 9 : 8;
  const wide = useMediaQuery(WIDE_QUERY);

  if (wide) {
    return (
      // Desktop and tablet: a comparable table; scrolls inside its own region so the header stays visible.
      <div
        role="region"
        aria-label="Bảng đề xuất nhập thêm"
        tabIndex={0}
        className="max-h-[min(72vh,760px)] overflow-auto focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
      >
        <table className="w-full min-w-[960px] border-separate border-spacing-0 text-left text-[13px]">
          <caption className="sr-only">
            Đề xuất nhập thêm, sắp theo mức khẩn cấp rồi thời điểm hết hàng. Mở từng dòng để xem lý do và số liệu đầu vào.
          </caption>
          <thead className="sticky top-0 z-10 whitespace-nowrap bg-card text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
            <tr className="[&>th]:border-b [&>th]:border-border [&>th]:bg-muted/50 [&>th]:py-2.5">
              {canEdit ? (
                <th scope="col" className="w-10 pl-4 pr-2">
                  <Checkbox
                    checked={headerChecked}
                    disabled={headerDisabled || locked}
                    onCheckedChange={(checked) => onToggleAll(checked === true)}
                    aria-label="Chọn mọi dòng đang hiển thị có số lượng nhập"
                  />
                </th>
              ) : null}
              <th scope="col" className={cn('px-3', !canEdit && 'pl-4')}>Sách</th>
              <th scope="col" className="w-[180px] px-3">Mức khẩn cấp</th>
              <th scope="col" className="w-[92px] px-3 text-right">Khả dụng</th>
              <th scope="col" className="w-[118px] px-3 text-right">Lượt mượn {days}n</th>
              <th scope="col" className="w-[100px] px-3 text-right">Dự báo 30n</th>
              <th scope="col" className="w-[150px] px-3 text-right">Số lượng nhập</th>
              <th scope="col" className="w-[118px] px-3 text-right">Chi phí</th>
              <th scope="col" className="w-12 pr-3"><span className="sr-only">Chi tiết</span></th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => {
              const { item } = line;
              const id = item.variant_id;
              const selected = selectedIds.has(id);
              const expanded = expandedId === id;
              const cell = 'border-b border-border px-3 py-3 align-top';
              return (
                <Fragment key={id}>
                  <tr className={cn('transition-colors duration-150 hover:bg-muted/35', selected && 'bg-primary/[0.045] hover:bg-primary/[0.07]')}>
                    {canEdit ? (
                      <td className={cn(cell, 'pl-4 pr-2 pt-3.5')}>
                        <Checkbox checked={selected} disabled={locked} onCheckedChange={(checked) => onToggle(id, checked === true)} aria-label={`Chọn ${item.title}`} />
                      </td>
                    ) : null}
                    <td className={cn(cell, !canEdit && 'pl-4')}>
                      <p className="line-clamp-2 font-semibold leading-snug text-foreground" title={item.title || undefined}>{item.title || 'Chưa có tên sách'}</p>
                      <p className="mt-0.5 truncate text-[12px] text-muted-foreground">{[item.author, item.isbn].filter(Boolean).join(' · ') || 'Chưa có thông tin tác giả/ISBN'}</p>
                      {item.seasonal_event ? <p className="mt-1 text-[11.5px] text-muted-foreground">Mùa vụ: {item.seasonal_event} · {item.seasonal_index}x</p> : null}
                    </td>
                    <td className={cell}>
                      <UrgencyChip urgency={line.urgency} />
                      <p className={cn('mt-1 text-[12px]', line.urgency === 'LATER' ? 'text-muted-foreground' : URGENCY_META[line.urgency].text)}>{stockoutText(item)}</p>
                      <p className="text-[11.5px] text-muted-foreground">Chờ hàng {formatCount(line.leadDays)} ngày</p>
                    </td>
                    <td className={cn(cell, 'text-right')}>
                      <p className={cn('font-semibold tabular-nums', item.available_qty <= 0 ? 'text-red-700 dark:text-red-400' : 'text-foreground')}>{formatCount(item.available_qty)}</p>
                      <p className="whitespace-nowrap text-[11.5px] tabular-nums text-muted-foreground">/{formatCount(item.on_hand_qty)} trên kệ</p>
                    </td>
                    <td className={cn(cell, 'text-right')}>
                      <p className="font-medium tabular-nums text-foreground">{formatCount(item.borrow_count)}</p>
                      <p className="flex justify-end gap-1.5 text-[11.5px] text-muted-foreground">
                        {item.reservation_count ? <span className="tabular-nums">{item.reservation_count} đặt chỗ</span> : null}
                        <TrendMark pct={item.demand_trend_pct} />
                      </p>
                    </td>
                    <td className={cn(cell, 'text-right tabular-nums text-foreground')}>{formatCount(item.forecast_30d)}</td>
                    <td className={cn(cell, 'py-2.5')}>
                      <QtyField line={line} selected={selected} hasBudget={hasBudget} canEdit={canEdit} locked={locked} onDraft={onDraft} />
                    </td>
                    <td className={cn(cell, 'pt-3.5 text-right')}><CostCell line={line} /></td>
                    <td className={cn(cell, 'pr-3 pt-2')}>
                      <DetailToggle id={id} title={item.title} expanded={expanded} onExpand={onExpand} />
                    </td>
                  </tr>
                  {expanded ? (
                    <tr id={detailId(id)}>
                      <td colSpan={columns} className="border-b border-border bg-muted/20 px-4 py-4 sm:px-6">
                        <ReorderDetail line={line} days={days} hasBudget={hasBudget} />
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    // Phones: one row per book, the decision facts first, details on demand.
    <ul className="divide-y divide-border" aria-label="Đề xuất nhập thêm">
        {lines.map((line) => {
          const { item } = line;
          const id = item.variant_id;
          const selected = selectedIds.has(id);
          const expanded = expandedId === id;
          return (
            <li key={id} className={cn('px-4 py-3.5', selected && 'bg-primary/[0.045]')}>
              <div className="flex items-start gap-3">
                {canEdit ? (
                  <Checkbox className="mt-0.5" checked={selected} disabled={locked} onCheckedChange={(checked) => onToggle(id, checked === true)} aria-label={`Chọn ${item.title}`} />
                ) : null}
                <div className="min-w-0 flex-1">
                  <p className="font-semibold leading-snug text-foreground">{item.title || 'Chưa có tên sách'}</p>
                  <p className="truncate text-[12px] text-muted-foreground">{[item.author, item.isbn].filter(Boolean).join(' · ') || 'Chưa có thông tin tác giả/ISBN'}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
                    <UrgencyChip urgency={line.urgency} />
                    <span className={cn('text-[12px]', line.urgency === 'LATER' ? 'text-muted-foreground' : URGENCY_META[line.urgency].text)}>{stockoutText(item)}</span>
                    <span className="text-[11.5px] text-muted-foreground">· chờ hàng {formatCount(line.leadDays)} ngày</span>
                  </div>
                  <dl className="mt-2 grid grid-cols-3 gap-2 text-[12px]">
                    <div><dt className="text-muted-foreground">Khả dụng</dt><dd className="font-semibold tabular-nums text-foreground">{formatCount(item.available_qty)}<span className="font-normal text-muted-foreground">/{formatCount(item.on_hand_qty)}</span></dd></div>
                    <div><dt className="text-muted-foreground">Mượn {days}n</dt><dd className="font-semibold tabular-nums text-foreground">{formatCount(item.borrow_count)} <TrendMark pct={item.demand_trend_pct} /></dd></div>
                    <div><dt className="text-muted-foreground">Dự báo 30n</dt><dd className="font-semibold tabular-nums text-foreground">{formatCount(item.forecast_30d)}</dd></div>
                  </dl>
                  <div className="mt-3 flex items-end justify-between gap-3">
                    <QtyField line={line} selected={selected} hasBudget={hasBudget} canEdit={canEdit} locked={locked} onDraft={onDraft} compact />
                    <div className="pb-5 text-right text-[13px]"><CostCell line={line} /></div>
                  </div>
                  <div className="-ml-2 mt-1">
                    <DetailToggle id={id} title={item.title} expanded={expanded} onExpand={onExpand} compact />
                  </div>
                  {expanded ? (
                    <div id={detailId(id)} className="mt-2">
                      <ReorderDetail line={line} days={days} hasBudget={hasBudget} />
                    </div>
                  ) : null}
                </div>
              </div>
            </li>
          );
        })}
    </ul>
  );
}
