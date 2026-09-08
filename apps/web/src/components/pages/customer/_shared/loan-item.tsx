import { formatDateTime } from './customer-format';
import { StatusBadge } from './status-badge';
import { BookCoverPlaceholder } from './book-cover-placeholder';
import { useState } from 'react';

interface LoanItemProps {
  item: any;
  onView: (id: string) => void;
}

export function LoanItem({ item, onView }: LoanItemProps) {
  const [mountedAt] = useState(() => Date.now());
  const status = String(item.status || '').toUpperCase();
  const isOverdue = status === 'OVERDUE';
  const dueDate = item?.due_date ? new Date(item.due_date) : null;
  const remainingDays = dueDate ? Math.ceil((dueDate.getTime() - mountedAt) / (24 * 60 * 60 * 1000)) : null;
  const isDueSoon = !isOverdue && remainingDays !== null && remainingDays >= 0 && remainingDays <= 3;
  const bookTitle = item.primary_book_title || 'Sách chưa xác định';
  const extraCount = Number(item.extra_item_count || 0);

  return (
    <div className={`rounded-[12px] border p-4 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_8px_20px_rgba(15,23,42,0.06)] ${isOverdue ? 'border-rose-200 bg-rose-50/60 dark:border-rose-900/40 dark:bg-rose-950/20' : isDueSoon ? 'border-amber-200 bg-amber-50/60 dark:border-amber-900/40 dark:bg-amber-950/20' : 'border-border bg-card'}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-3 min-w-0">
          <div className="w-12 shrink-0">
            <BookCoverPlaceholder title={bookTitle} imageUrl={item.loan_items?.[0]?.book_cover_url} />
          </div>
          <div className="min-w-0">
            <div className="text-[13px] text-foreground truncate" style={{ fontWeight: 700 }}>
              {bookTitle}{extraCount > 0 ? ` (+${extraCount} khác)` : ''}
            </div>
            <div className="mt-1 text-[11px] text-slate-400 dark:text-slate-500">{item.loan_number || 'Phiếu mượn'}</div>
            <div className="mt-1 text-[12px] text-muted-foreground">Ngày mượn: {formatDateTime(item.borrow_date)}</div>
            <div className={`text-[12px] ${isOverdue ? 'text-rose-700 dark:text-rose-400' : isDueSoon ? 'text-amber-700 dark:text-amber-400' : 'text-muted-foreground'}`} style={{ fontWeight: isOverdue || isDueSoon ? 600 : 500 }}>
              Hạn trả: {formatDateTime(item.due_date)}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <StatusBadge status={item.status} />
          <button
            onClick={() => onView(item.id)}
            className="rounded-[10px] border border-border bg-card px-3 py-2 text-[12px] text-slate-700 dark:text-slate-300 hover:bg-muted"
            style={{ fontWeight: 600 }}
          >
            Xem chi tiết
          </button>
        </div>
      </div>
    </div>
  );
}
