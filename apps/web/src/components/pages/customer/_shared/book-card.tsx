import { CustomerCatalogBook } from '@/services/customer-catalog';
import { StatusBadge } from './status-badge';
import { BookCoverPlaceholder } from './book-cover-placeholder';
import { Star } from 'lucide-react';

interface BookCardProps {
  book: CustomerCatalogBook;
  onView: (bookId: string) => void;
  onReserve: (book: CustomerCatalogBook) => void;
  reserving?: boolean;
  ratingInfo?: { averageRating: number; totalReviews: number } | null;
}

export function BookCard({ book, onView, onReserve, reserving = false, ratingInfo }: BookCardProps) {
  const stock = Number(book.quantity || 0);
  const isAvailable = stock > 0;
  const canReserve = Boolean(book.reservable && isAvailable);
  const stockLabel = isAvailable ? `${stock} in stock` : 'Out of stock';

  return (
    <article className="rounded-[14px] border border-slate-200 bg-white p-4 transition-all duration-200 hover:-translate-y-0.5 hover:border-cyan-200 hover:shadow-[0_10px_24px_rgba(15,23,42,0.08)]">
      <BookCoverPlaceholder category={book.category} title={book.title} imageUrl={book.cover_image_url} />

      <div className="mt-3 flex items-center justify-between gap-2">
        <span className="max-w-[70%] truncate rounded-[8px] border border-slate-200 bg-slate-50/90 px-2 py-1 text-[10px] uppercase tracking-[0.05em] text-slate-500">
          {book.category || 'Uncategorized'}
        </span>
        <StatusBadge status={isAvailable ? 'ACTIVE' : 'OUT_OF_STOCK'} />
      </div>

      <h3 className="mt-2 line-clamp-2 text-[14px] text-slate-900" style={{ fontWeight: 700 }}>
        {book.title}
      </h3>
      <p className="mt-1 text-[12px] text-slate-500">{book.author || 'Unknown author'}</p>

      {/* Rating */}
      <div className="mt-2 flex items-center gap-1.5">
        {ratingInfo && ratingInfo.totalReviews > 0 ? (
          <>
            <div className="flex items-center gap-0.5">
              {[1, 2, 3, 4, 5].map((s) => (
                <Star
                  key={s}
                  size={12}
                  className={s <= Math.round(ratingInfo.averageRating) ? 'fill-amber-400 text-amber-400' : 'fill-transparent text-slate-300'}
                />
              ))}
            </div>
            <span className="text-[11px] font-medium text-slate-600">{ratingInfo.averageRating}</span>
            <span className="text-[11px] text-slate-400">({ratingInfo.totalReviews})</span>
          </>
        ) : (
          <span className="text-[11px] text-slate-400">No reviews</span>
        )}
      </div>

      <div className={`mt-2 text-[11px] ${isAvailable ? 'text-emerald-600' : 'text-rose-500'}`}>{stockLabel}</div>

      <div className="mt-3 flex items-center gap-2">
        <button
          onClick={() => onView(book.id)}
          className="rounded-[10px] border border-slate-200 bg-white px-3 py-2 text-[12px] text-slate-600 hover:bg-slate-50"
          style={{ fontWeight: 600 }}
        >
          View details
        </button>

        <button
          disabled={!canReserve || reserving}
          onClick={() => onReserve(book)}
          className="flex-1 rounded-[10px] bg-indigo-600 px-3 py-2 text-[12px] text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500"
          style={{ fontWeight: 600 }}
        >
          {reserving ? 'Reserving...' : 'Reserve'}
        </button>
      </div>
    </article>
  );
}
