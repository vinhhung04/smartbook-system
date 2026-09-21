import { useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { StatusBadge } from './status-badge';
import { BookCoverPlaceholder } from './book-cover-placeholder';

interface LoanItemProps {
  item: any;
  onView: (id: string) => void;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const OPEN_STATUSES = ['BORROWED', 'OVERDUE', 'RESERVED'];

function formatDay(value?: string | null) {
  if (!value) return '-';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '-' : date.toLocaleDateString('vi-VN');
}

/** The one line a borrower cares about: how long they have left (or how late they are). */
function dueLabel(status: string, dueDate: Date | null, now: number): { text: string; tone: 'overdue' | 'soon' | 'ok' | 'closed' } {
  if (!OPEN_STATUSES.includes(status)) return { text: '', tone: 'closed' };
  if (!dueDate) return { text: '', tone: 'ok' };
  const diff = dueDate.getTime() - now;
  if (status === 'OVERDUE' || diff < 0) return { text: `Quá hạn ${Math.max(1, Math.ceil(-diff / DAY_MS))} ngày`, tone: 'overdue' };
  const days = Math.ceil(diff / DAY_MS);
  if (days <= 0) return { text: 'Hạn trả hôm nay', tone: 'soon' };
  return { text: `Còn ${days} ngày`, tone: days <= 3 ? 'soon' : 'ok' };
}

const TONE_TEXT = {
  overdue: 'text-rose-700 dark:text-rose-400',
  soon: 'text-amber-700 dark:text-amber-400',
  ok: 'text-foreground',
  closed: 'text-muted-foreground',
} as const;

export function LoanItem({ item, onView }: LoanItemProps) {
  const [mountedAt] = useState(() => Date.now());
  const status = String(item.status || '').toUpperCase();
  const dueDate = item?.due_date ? new Date(item.due_date) : null;
  const due = dueLabel(status, dueDate && !Number.isNaN(dueDate.getTime()) ? dueDate : null, mountedAt);
  const bookTitle = item.primary_book_title || 'Sách chưa xác định';
  const extraCount = Number(item.extra_item_count || 0);

  return (
    <div
      className={`rounded-xl border p-3.5 transition-all duration-200 hover:shadow-[0_8px_20px_rgba(15,23,42,0.06)] sm:p-4 ${
        due.tone === 'overdue'
          ? 'border-rose-200 bg-rose-50/60 dark:border-rose-900/40 dark:bg-rose-950/20'
          : due.tone === 'soon'
            ? 'border-amber-200 bg-amber-50/60 dark:border-amber-900/40 dark:bg-amber-950/20'
            : 'border-border bg-card'
      }`}
    >
      <div className="flex items-center gap-3 sm:gap-4">
        <div className="w-12 shrink-0 sm:w-14">
          <BookCoverPlaceholder title={bookTitle} imageUrl={item.loan_items?.[0]?.book_cover_url} />
        </div>

        <div className="min-w-0 flex-1">
          <p className="truncate text-[14px] text-foreground" style={{ fontWeight: 700 }} title={bookTitle}>
            {bookTitle}{extraCount > 0 ? ` (+${extraCount} khác)` : ''}
          </p>
          <p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">{item.loan_number || 'Phiếu mượn'}</p>
          <p className="mt-1 text-[12px] text-muted-foreground">
            Mượn {formatDay(item.borrow_date)} · Hạn trả {formatDay(item.due_date)}
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-2 sm:hidden">
            <StatusBadge status={item.status} />
            {due.text ? <span className={`text-[12px] font-semibold ${TONE_TEXT[due.tone]}`}>{due.text}</span> : null}
          </div>
        </div>

        <div className="hidden shrink-0 flex-col items-end gap-1.5 sm:flex">
          {due.text ? <span className={`text-[14px] font-bold ${TONE_TEXT[due.tone]}`}>{due.text}</span> : null}
          <StatusBadge status={item.status} />
        </div>

        <button
          onClick={() => onView(item.id)}
          aria-label={`Xem chi tiết phiếu ${item.loan_number || ''}`.trim()}
          className="inline-flex shrink-0 items-center gap-1 rounded-[10px] border border-border bg-card px-2.5 py-2 text-[12px] text-slate-700 hover:bg-muted dark:text-slate-300 sm:px-3"
          style={{ fontWeight: 600 }}
        >
          <span className="hidden sm:inline">Chi tiết</span>
          <ChevronRight className="h-4 w-4 sm:h-3.5 sm:w-3.5" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
