import { NavLink } from 'react-router';
import { ArrowRight, CheckCircle2, ChevronRight } from 'lucide-react';
import { cn } from '@/components/ui/utils';
import { Panel, PanelHeader } from './panel';
import { SEVERITY, type ActionItem } from './decision-items';
import { formatNumber } from './utils';

function ActionRow({ item }: { item: ActionItem }) {
  const severity = SEVERITY[item.severity];
  const unavailable = item.count === null;
  const body = (
    <>
      <span className="col-span-2 @2xl:col-span-1">
        <span className={cn('inline-flex h-6 items-center whitespace-nowrap rounded-full px-2.5 text-[12px] font-medium ring-1 ring-inset', severity.tag)}>
          {severity.label}
        </span>
      </span>
      <span className="min-w-0">
        <span className="block text-[14px] font-medium leading-5 text-foreground">{item.label}</span>
        <span className="mt-0.5 block truncate text-[12px] leading-5 text-muted-foreground">
          {unavailable ? 'Không tải được số liệu' : item.detail}
        </span>
      </span>
      <span className={cn('text-right text-[20px] font-semibold leading-none tabular-nums', unavailable ? 'text-muted-foreground' : severity.count)}>
        {unavailable ? '—' : item.value ?? formatNumber(item.count ?? 0)}
      </span>
      <span className="hidden items-center justify-end gap-1 whitespace-nowrap text-[13px] font-medium text-primary @2xl:flex">
        {item.to ? (
          <>
            {item.action}
            <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none" aria-hidden="true" />
          </>
        ) : null}
      </span>
    </>
  );
  const grid = 'grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1.5 py-3 pl-5 pr-9 @2xl:pr-5 @2xl:grid-cols-[8.5rem_minmax(0,1fr)_auto_9rem] @2xl:gap-y-0';

  return (
    <li className="border-t border-border first:border-t-0">
      {item.to ? (
        <NavLink
          to={item.to}
          className={cn(grid, 'group relative transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/40')}
        >
          {body}
          <ChevronRight className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/60 @2xl:hidden" aria-hidden="true" />
        </NavLink>
      ) : (
        <div className={grid}>{body}</div>
      )}
    </li>
  );
}

export function DecisionCenter({ items }: { items: ActionItem[] }) {
  const open = items
    .filter((item) => item.count !== 0)
    .sort((a, b) => SEVERITY[a.severity].rank - SEVERITY[b.severity].rank);
  const clear = items.filter((item) => item.count === 0);
  const openCount = open.filter((item) => item.count !== null).length;
  const urgentCount = open.filter((item) => item.severity === 'urgent' && item.count !== null).length;

  return (
    <Panel titleId="decision-center-title" className="@5xl:col-span-8">
      <PanelHeader
        id="decision-center-title"
        title="Việc cần xử lý"
        description={openCount > 0
          ? <><span className="font-medium text-foreground">{openCount}</span> đầu việc đang mở{urgentCount > 0 ? <> · <span className="font-medium text-rose-700 dark:text-rose-300">{urgentCount}</span> khẩn cấp</> : null}</>
          : 'Không còn việc tồn đọng'}
      />
      <div className="@container mt-3 flex flex-1 flex-col">
        {open.length ? (
          <ul className="border-t border-border">
            {open.map((item) => <ActionRow key={item.key} item={item} />)}
          </ul>
        ) : (
          <p className="mx-5 flex items-center gap-2 rounded-lg bg-emerald-50 px-4 py-3 text-[13px] text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-300">
            <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
            Mọi đầu việc đã được xử lý.
          </p>
        )}
        {clear.length && open.length ? (
          <p className="mt-auto flex items-start gap-2 border-t border-border px-5 py-3 text-[12px] leading-5 text-muted-foreground">
            <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
            <span>Không có mục chờ: {clear.map((item) => item.label).join(' · ')}</span>
          </p>
        ) : null}
        {open.length ? null : <span className="pb-5" aria-hidden="true" />}
      </div>
    </Panel>
  );
}
