import { NavLink } from 'react-router';
import { Star } from 'lucide-react';
import { CustomerCatalogBook } from '@/services/customer-catalog';
import { BookCoverPlaceholder } from './book-cover-placeholder';

interface BookCardProps {
  book: CustomerCatalogBook;
  onReserve: (book: CustomerCatalogBook) => void;
  reserving?: boolean;
  ratingInfo?: { averageRating: number; totalReviews: number } | null;
}

/** Cover-first catalog card: the whole cover and the title open the book, the single button reserves it. */
export function BookCard({ book, onReserve, reserving = false, ratingInfo }: BookCardProps) {
  const availableStock = Number(book.available_quantity ?? book.quantity ?? 0);
  const isAvailable = availableStock > 0;
  const canReserve = Boolean(book.reservable && isAvailable);
  const detailPath = `/customer/books/${book.id}`;

  return (
    <article className="group flex h-full flex-col overflow-hidden rounded-2xl border border-border bg-card transition-all duration-200 hover:-translate-y-0.5 hover:border-indigo-200 hover:shadow-[0_10px_24px_rgba(15,23,42,0.08)] dark:hover:border-indigo-500/30">
      <NavLink to={detailPath} tabIndex={-1} aria-hidden="true" className="relative block p-2.5 pb-0">
        <BookCoverPlaceholder category={book.category} title={book.title} imageUrl={book.cover_image_url} />
        <span
          className={`absolute bottom-2 left-4 rounded-full px-2.5 py-1 text-[11px] font-semibold shadow-sm ${
            isAvailable
              ? 'bg-emerald-600 text-white'
              : 'bg-slate-800/85 text-white'
          }`}
        >
          {isAvailable ? `Còn ${availableStock} cuốn` : 'Hết sách'}
        </span>
      </NavLink>

      <div className="flex flex-1 flex-col p-3.5">
        <p className="truncate text-[11px] uppercase tracking-[0.05em] text-muted-foreground">{book.category || 'Chưa phân loại'}</p>
        <h3 className="mt-1 line-clamp-2 min-h-[2.5rem] text-[14px] leading-5 text-foreground" style={{ fontWeight: 700 }}>
          <NavLink to={detailPath} className="hover:text-indigo-600 hover:underline dark:hover:text-indigo-400">{book.title}</NavLink>
        </h3>
        <p className="mt-0.5 truncate text-[12px] text-muted-foreground">{book.author || 'Không rõ tác giả'}</p>

        <div className="mt-1.5 flex items-center gap-1">
          {ratingInfo && ratingInfo.totalReviews > 0 ? (
            <>
              <Star size={12} className="fill-amber-400 text-amber-400" aria-hidden="true" />
              <span className="text-[12px] font-semibold text-foreground">{ratingInfo.averageRating}</span>
              <span className="text-[11px] text-muted-foreground">({ratingInfo.totalReviews} đánh giá)</span>
            </>
          ) : (
            <span className="text-[11px] text-muted-foreground/70">Chưa có đánh giá</span>
          )}
        </div>

        <button
          disabled={!canReserve || reserving}
          onClick={() => onReserve(book)}
          data-testid="reserve-book-button"
          className="mt-3 w-full rounded-[10px] bg-indigo-600 px-3 py-2 text-[13px] text-white transition-colors hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-muted-foreground dark:disabled:bg-slate-700"
          style={{ fontWeight: 600 }}
        >
          {reserving ? 'Đang đặt trước...' : canReserve ? 'Đặt trước' : 'Hết sách'}
        </button>
      </div>
    </article>
  );
}
