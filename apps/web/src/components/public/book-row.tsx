import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { ArrowRight } from 'lucide-react';
import type { PublicBook } from '@/services/public-catalog';
import { BookCardSkeleton, PublicBookCard } from './public-book-card';

interface BookRowProps {
  id: string;
  title: string;
  /** What the ranking is based on, in plain words — shown under the title. */
  basis?: ReactNode;
  books: PublicBook[];
  seeAllTo?: string;
  onReserve?: (book: PublicBook) => void;
}

export function SectionHeading({ id, title, basis, seeAllTo }: Pick<BookRowProps, 'id' | 'title' | 'basis' | 'seeAllTo'>) {
  return (
    <div className="mb-5 flex items-end justify-between gap-4">
      <div className="min-w-0">
        <h2 id={id} className="font-serif text-[22px] font-semibold leading-tight tracking-tight text-foreground sm:text-[26px]">{title}</h2>
        {basis ? <p className="mt-1 text-[13px] text-muted-foreground">{basis}</p> : null}
      </div>
      {seeAllTo ? (
        <Link to={seeAllTo} className="inline-flex shrink-0 items-center gap-1 rounded-md text-[13px] font-semibold text-indigo-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/50 dark:text-indigo-300">
          Xem tất cả <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
        </Link>
      ) : null}
    </div>
  );
}

/** A shelf of books that scrolls sideways on phones and lays out in a row on desktop. */
export function BookRow({ id, title, basis, books, seeAllTo, onReserve }: BookRowProps) {
  if (books.length === 0) return null;
  return (
    <section aria-labelledby={id}>
      <SectionHeading id={id} title={title} basis={basis} seeAllTo={seeAllTo} />
      <ul className="-mx-4 flex snap-x snap-mandatory gap-4 overflow-x-auto px-4 pb-2 sm:-mx-6 sm:px-6 lg:mx-0 lg:grid lg:grid-cols-6 lg:gap-5 lg:overflow-visible lg:px-0">
        {books.slice(0, 6).map((book) => (
          <li key={book.id} className="w-[42%] shrink-0 snap-start sm:w-[28%] lg:w-auto">
            <PublicBookCard book={book} onReserve={onReserve} />
          </li>
        ))}
      </ul>
    </section>
  );
}

export function BookRowSkeleton() {
  return (
    <div aria-hidden="true">
      <div className="mb-5 h-7 w-56 animate-pulse rounded bg-muted" />
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6 lg:gap-5">
        {Array.from({ length: 6 }).map((_, index) => (
          <div key={index} className={index >= 2 ? 'hidden sm:block' : undefined}>
            <BookCardSkeleton />
          </div>
        ))}
      </div>
    </div>
  );
}
