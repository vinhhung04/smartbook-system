import { Link } from 'react-router';
import { Star } from 'lucide-react';
import type { PublicBook } from '@/services/public-catalog';
import { cn } from '@/components/ui/utils';
import { BookCover } from './book-cover';
import { AvailabilityStamp } from './availability-stamp';

interface PublicBookCardProps {
  book: PublicBook;
  /** Omit to render a browse-only card. The button only appears when a copy can
   *  actually be reserved — the availability stamp already explains the rest. */
  onReserve?: (book: PublicBook) => void;
  className?: string;
}

/** Cover-first card: the cover and title open the book; one button reserves it. */
export function PublicBookCard({ book, onReserve, className }: PublicBookCardProps) {
  const detailPath = `/books/${book.id}`;
  const rating = book.signals && book.signals.rating_count > 0 ? book.signals : null;

  return (
    <article className={cn('group flex h-full flex-col', className)}>
      <Link to={detailPath} tabIndex={-1} aria-hidden="true" className="block transition-transform duration-200 group-hover:-translate-y-1 motion-reduce:transform-none">
        <BookCover title={book.title} author={book.author} imageUrl={book.cover_image_url} />
      </Link>

      <div className="mt-3 flex flex-1 flex-col">
        <h3 className="line-clamp-2 text-[14px] font-semibold leading-snug text-foreground">
          <Link to={detailPath} className="rounded-sm outline-none hover:text-indigo-700 hover:underline focus-visible:ring-2 focus-visible:ring-indigo-500/50 dark:hover:text-indigo-300">
            {book.title}
          </Link>
        </h3>
        <p className="mt-0.5 truncate text-[12.5px] text-muted-foreground">{book.author || 'Chưa rõ tác giả'}</p>
        <AvailabilityStamp book={book} className="mt-2 self-start" />
        {rating ? (
          <p className="mt-1 flex items-center gap-1 text-[12px] text-muted-foreground">
            <Star className="h-3 w-3 fill-amber-400 text-amber-400" aria-hidden="true" />
            <span className="font-semibold text-foreground">{rating.rating_avg.toFixed(1)}</span>
            <span>({rating.rating_count} đánh giá)</span>
          </p>
        ) : null}

        {onReserve && book.reservable ? (
          <div className="mt-auto pt-3">
            <button
              type="button"
              onClick={() => onReserve(book)}
              data-testid="reserve-book-button"
              className="w-full rounded-lg border border-indigo-600 bg-indigo-600 px-3 py-2 text-[13px] font-semibold text-white transition-colors hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/50 focus-visible:ring-offset-2"
            >
              Đặt trước
            </button>
          </div>
        ) : null}
      </div>
    </article>
  );
}

export function BookCardSkeleton() {
  return (
    <div className="animate-pulse" aria-hidden="true">
      <div className="aspect-[2/3] rounded-[6px] bg-muted" />
      <div className="mt-3 h-3 w-20 rounded bg-muted" />
      <div className="mt-2 h-4 w-4/5 rounded bg-muted" />
      <div className="mt-1.5 h-3 w-1/2 rounded bg-muted" />
    </div>
  );
}
