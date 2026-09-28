import { useMemo } from 'react';
import { NavLink } from 'react-router';
import { EmptyState } from '@/components/ui/empty-state';
import { cn } from '@/components/ui/utils';
import type { FineSummary } from '@/services/analytics';
import { formatMoney } from './utils';

// Backend stores a few spellings for the same fine reason; readers see one Vietnamese label.
const FINE_TYPE_LABELS: Record<string, string> = {
  OVERDUE: 'Trả trễ hạn',
  LATE: 'Trả trễ hạn',
  DAMAGE: 'Hư hỏng sách',
  DAMAGED: 'Hư hỏng sách',
  LOST: 'Mất sách',
};

function compactMoney(value: number) {
  return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND', notation: 'compact', maximumFractionDigits: 1 }).format(value || 0);
}

interface TopBooksFinesSectionProps {
  topBookData: Array<{ variant_id: string; book_id: string | null; title: string; borrow_count: number }>;
  fines: FineSummary;
}

export function TopBooksFinesSection({ topBookData, fines }: TopBooksFinesSectionProps) {
  const topMax = topBookData[0]?.borrow_count || 1;

  const byType = useMemo(() => {
    const merged = new Map<string, { label: string; amount: number; count: number }>();
    for (const item of fines.by_type) {
      const label = FINE_TYPE_LABELS[String(item.fine_type).toUpperCase()] || item.fine_type;
      const current = merged.get(label) || { label, amount: 0, count: 0 };
      current.amount += Number(item.amount || 0);
      current.count += Number(item.count || 0);
      merged.set(label, current);
    }
    return [...merged.values()].sort((a, b) => b.amount - a.amount);
  }, [fines.by_type]);

  const statusParts = [
    { key: 'unpaid', label: 'Chưa thu', value: fines.total_unpaid, color: 'bg-rose-500' },
    { key: 'paid', label: 'Đã thu', value: fines.total_paid, color: 'bg-emerald-500' },
    { key: 'waived', label: 'Miễn giảm', value: fines.total_waived, color: 'bg-slate-400' },
  ];
  const statusTotal = statusParts.reduce((sum, part) => sum + part.value, 0);

  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
      <section aria-labelledby="top-books-title" className="rounded-xl border border-border bg-card p-5">
        <h3 id="top-books-title" className="text-[14px] font-semibold text-foreground">Sách được mượn nhiều nhất</h3>
        <p className="mt-1 text-[13px] text-muted-foreground">Xếp hạng theo tổng lượt mượn</p>
        <div className="mt-4">
          {topBookData.length ? (
            <ol className="space-y-3">
              {topBookData.map((book, index) => {
                const title = (
                  <span className="truncate text-[13px] font-medium text-foreground" title={book.title}>{book.title}</span>
                );
                return (
                  <li key={book.variant_id} className="grid grid-cols-[20px_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5">
                    <span className="text-[12px] font-semibold tabular-nums text-muted-foreground">{index + 1}</span>
                    {book.book_id ? (
                      <NavLink to={`/book/${book.book_id}`} className="min-w-0 truncate hover:underline">{title}</NavLink>
                    ) : title}
                    <span className="text-[13px] font-semibold tabular-nums text-foreground">{book.borrow_count.toLocaleString('vi-VN')}</span>
                    <span className="col-start-2 col-end-4 h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden="true">
                      <span className="block h-full rounded-full bg-indigo-500 dark:bg-indigo-400" style={{ width: `${(book.borrow_count / topMax) * 100}%` }} />
                    </span>
                  </li>
                );
              })}
            </ol>
          ) : (
            <EmptyState variant="no-data" title="Chưa có dữ liệu mượn sách" description="Sách sẽ được xếp hạng sau khi có giao dịch mượn." />
          )}
        </div>
      </section>

      <section aria-labelledby="fines-title" className="rounded-xl border border-border bg-card p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h3 id="fines-title" className="text-[14px] font-semibold text-foreground">Tiền phạt</h3>
          <NavLink to="/borrow/fines?status=UNPAID" className="text-[13px] font-medium text-indigo-600 hover:underline dark:text-indigo-400">Xem khoản chưa thu</NavLink>
        </div>
        {statusTotal > 0 ? (
          <>
            <p className="mt-1 text-[13px] text-muted-foreground">
              Chưa thu <span className="font-semibold text-foreground">{formatMoney(fines.total_unpaid)}</span> · {fines.unpaid_count.toLocaleString('vi-VN')} khoản
            </p>
            <div className="mt-4 flex h-2.5 w-full gap-[2px] overflow-hidden rounded-full" role="img" aria-label="Tỷ trọng tiền phạt theo trạng thái">
              {statusParts.filter((part) => part.value > 0).map((part) => (
                <span key={part.key} className={cn('h-full', part.color)} style={{ width: `${(part.value / statusTotal) * 100}%`, minWidth: 3 }} />
              ))}
            </div>
            <dl className="mt-3 grid grid-cols-3 gap-3">
              {statusParts.map((part) => (
                <div key={part.key}>
                  <dt className="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground">
                    <span className={cn('h-2 w-2 rounded-[2px]', part.color)} aria-hidden="true" />
                    {part.label}
                  </dt>
                  <dd className="mt-0.5 text-[15px] font-semibold text-foreground">{compactMoney(part.value)}</dd>
                </div>
              ))}
            </dl>

            {byType.length ? (
              <table className="mt-5 w-full text-[13px]">
                <caption className="mb-1 text-left text-[12px] font-medium text-muted-foreground">Theo lý do phạt</caption>
                <thead className="sr-only">
                  <tr><th>Lý do</th><th>Số khoản</th><th>Số tiền</th></tr>
                </thead>
                <tbody>
                  {byType.map((row) => (
                    <tr key={row.label} className="border-b border-border last:border-0">
                      <td className="py-2 text-foreground">{row.label}</td>
                      <td className="py-2 text-right tabular-nums text-muted-foreground">{row.count.toLocaleString('vi-VN')} khoản</td>
                      <td className="w-28 py-2 text-right font-semibold tabular-nums text-foreground">{compactMoney(row.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}
          </>
        ) : (
          <EmptyState variant="no-data" title="Chưa có tiền phạt" description="Tổng quan tiền phạt sẽ hiển thị khi có phạt." className="py-8" />
        )}
      </section>
    </div>
  );
}
