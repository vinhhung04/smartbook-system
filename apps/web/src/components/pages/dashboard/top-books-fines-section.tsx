import { useMemo } from 'react';
import { NavLink } from 'react-router';
import { cn } from '@/components/ui/utils';
import type { FineSummary, TopBookItem } from '@/services/analytics';
import { BlockEmpty, BlockError, Panel, PanelBody, PanelHeader, PanelLink } from './panel';
import { formatMoney, formatNumber, formatShare } from './utils';

// Backend stores a few spellings for the same fine reason; readers see one Vietnamese label.
const FINE_TYPE_LABELS: Record<string, string> = {
  OVERDUE: 'Trả trễ hạn',
  LATE: 'Trả trễ hạn',
  DAMAGE: 'Hư hỏng sách',
  DAMAGED: 'Hư hỏng sách',
  LOST: 'Mất sách',
};

interface TopBooksFinesSectionProps {
  topBooks: TopBookItem[] | null;
  /** The number of books requested: a shorter list means fewer books have been borrowed. */
  topBooksLimit: number;
  fines: FineSummary | null;
  access: { catalog: boolean; borrow: boolean };
  onRetry: () => void;
}

function TopBooksPanel({ topBooks, limit, canOpenBook, onRetry }: { topBooks: TopBookItem[] | null; limit: number; canOpenBook: boolean; onRetry: () => void }) {
  const topMax = topBooks?.[0]?.borrow_count || 1;

  return (
    <Panel titleId="top-books-title" className="@5xl:col-span-5">
      <PanelHeader id="top-books-title" level={3} title="Sách được mượn nhiều nhất" description="Xếp hạng theo tổng lượt mượn" />
      <PanelBody>
        {!topBooks ? (
          <BlockError what="xếp hạng sách" onRetry={onRetry} />
        ) : !topBooks.length ? (
          <BlockEmpty>Sách sẽ được xếp hạng khi có giao dịch mượn.</BlockEmpty>
        ) : (
          <>
            <div className="flex h-8 items-center justify-between border-b border-border text-[12px] text-muted-foreground" aria-hidden="true">
              <span>Đầu sách</span>
              <span>Lượt mượn</span>
            </div>
            <ol className="mt-1">
              {topBooks.map((book, index) => {
                const title = <span className="block truncate text-[13px] font-medium text-foreground" title={book.title}>{book.title}</span>;
                return (
                  <li key={book.variant_id} className="grid grid-cols-[1.5rem_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 py-2">
                    <span className="text-[12px] font-medium tabular-nums text-muted-foreground">{index + 1}</span>
                    {canOpenBook && book.book_id ? (
                      <NavLink to={`/book/${book.book_id}`} className="min-w-0 rounded-sm underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40">{title}</NavLink>
                    ) : title}
                    <span className="text-right text-[13px] font-semibold tabular-nums text-foreground">{formatNumber(book.borrow_count)}</span>
                    <span className="col-start-2 col-end-4 h-1 overflow-hidden rounded-full bg-muted" aria-hidden="true">
                      <span className="block h-full rounded-full bg-indigo-500 dark:bg-indigo-400" style={{ width: `${(book.borrow_count / topMax) * 100}%` }} />
                    </span>
                  </li>
                );
              })}
            </ol>
            {topBooks.length < limit ? (
              <p className="mt-2 text-[12px] leading-5 text-muted-foreground">Mới có {formatNumber(topBooks.length)} đầu sách được mượn.</p>
            ) : null}
          </>
        )}
      </PanelBody>
    </Panel>
  );
}

function FinesPanel({ fines, canOpenFines, onRetry }: { fines: FineSummary | null; canOpenFines: boolean; onRetry: () => void }) {
  const byType = useMemo(() => {
    const merged = new Map<string, { label: string; amount: number; count: number }>();
    for (const item of fines?.by_type ?? []) {
      const label = FINE_TYPE_LABELS[String(item.fine_type).toUpperCase()] || item.fine_type;
      const current = merged.get(label) || { label, amount: 0, count: 0 };
      current.amount += Number(item.amount || 0);
      current.count += Number(item.count || 0);
      merged.set(label, current);
    }
    return [...merged.values()].sort((a, b) => b.amount - a.amount);
  }, [fines]);

  const statusParts = fines ? [
    { key: 'unpaid', label: 'Chưa thu', value: fines.total_unpaid, color: 'bg-amber-500' },
    { key: 'paid', label: 'Đã thu', value: fines.total_paid, color: 'bg-emerald-500' },
    { key: 'waived', label: 'Miễn giảm', value: fines.total_waived, color: 'bg-slate-400 dark:bg-slate-500' },
  ] : [];
  const statusTotal = statusParts.reduce((sum, part) => sum + part.value, 0);
  const byTypeTotal = byType.reduce((sum, row) => sum + row.amount, 0);

  return (
    <Panel titleId="fines-title" className="@5xl:col-span-7">
      <PanelHeader
        id="fines-title"
        level={3}
        title="Tiền phạt"
        description={fines && statusTotal > 0
          ? <>Tổng phát sinh <span className="font-medium text-foreground">{formatMoney(statusTotal)}</span> · chưa thu {formatNumber(fines.unpaid_count)} khoản</>
          : 'Cơ cấu tiền phạt theo trạng thái và lý do'}
        aside={canOpenFines && fines && fines.unpaid_count > 0 ? <PanelLink to="/borrow/fines?tab=open">Xem khoản chưa thu</PanelLink> : null}
      />
      <PanelBody className="@container">
        {!fines ? (
          <BlockError what="tổng quan tiền phạt" onRetry={onRetry} />
        ) : statusTotal > 0 ? (
          <>
            <div className="flex h-2.5 w-full gap-0.5 overflow-hidden rounded-full" role="img" aria-label={`Tỷ trọng tiền phạt: ${statusParts.map((part) => `${part.label} ${formatShare(part.value, statusTotal)}`).join(', ')}`}>
              {statusParts.filter((part) => part.value > 0).map((part) => (
                <span key={part.key} className={cn('h-full', part.color)} style={{ width: `${(part.value / statusTotal) * 100}%`, minWidth: 3 }} />
              ))}
            </div>
            <dl className="mt-3 grid grid-cols-1 gap-3 @md:grid-cols-3">
              {statusParts.map((part) => (
                <div key={part.key} className="min-w-0">
                  <dt className="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground">
                    <span className={cn('h-2.5 w-2.5 rounded-[3px]', part.color)} aria-hidden="true" />
                    {part.label} · {formatShare(part.value, statusTotal)}
                  </dt>
                  <dd className="mt-0.5 text-[16px] font-semibold leading-6 tabular-nums text-foreground">{formatMoney(part.value)}</dd>
                </div>
              ))}
            </dl>

            {byType.length ? (
              <table className="mt-5 w-full text-[13px]">
                <caption className="sr-only">Tiền phạt theo lý do</caption>
                <thead>
                  <tr className="border-b border-border text-[12px] text-muted-foreground [&>th]:h-8 [&>th]:font-normal">
                    <th scope="col" className="text-left">Theo lý do phạt</th>
                    <th scope="col" className="px-3 text-right">Số khoản</th>
                    <th scope="col" className="text-right">Số tiền</th>
                  </tr>
                </thead>
                <tbody>
                  {byType.map((row) => (
                    <tr key={row.label} className="border-b border-border/70 last:border-0">
                      <th scope="row" className="py-2 text-left font-normal text-foreground">{row.label}</th>
                      <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{formatNumber(row.count)}</td>
                      <td className="py-2 text-right tabular-nums">
                        <span className="font-semibold text-foreground">{formatMoney(row.amount)}</span>
                        <span className="ml-2 hidden w-12 text-muted-foreground @md:inline-block">{formatShare(row.amount, byTypeTotal)}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}
          </>
        ) : (
          <BlockEmpty>Chưa phát sinh khoản phạt nào.</BlockEmpty>
        )}
      </PanelBody>
    </Panel>
  );
}

export function TopBooksFinesSection({ topBooks, topBooksLimit, fines, access, onRetry }: TopBooksFinesSectionProps) {
  return (
    <div className="grid grid-cols-1 gap-5 @5xl:grid-cols-12">
      <TopBooksPanel topBooks={topBooks} limit={topBooksLimit} canOpenBook={access.catalog} onRetry={onRetry} />
      <FinesPanel fines={fines} canOpenFines={access.borrow} onRetry={onRetry} />
    </div>
  );
}
