import { Link } from 'react-router';
import { ArrowRight, Flame, Star } from 'lucide-react';
import type { PublicBook, PublicHome } from '@/services/public-catalog';
import { bindingFor } from '@/lib/book-binding';
import { cn } from '@/components/ui/utils';
import { AvailabilityStamp } from './availability-stamp';
import { Book3D } from './book-3d';
import { BookCover } from './book-cover';
import { Reveal, SectionHeading } from './book-row';

const numberFormat = new Intl.NumberFormat('vi-VN');

/**
 * "Đang được yêu thích" as a bento: the most-active book gets a feature panel,
 * the next four sit beside it. Every number shown is the real recent-activity
 * count (loans + reservations + wishlist adds in the window).
 */
export function FeaturedTrending({ books, days, onReserve }: { books: PublicBook[]; days: number; onReserve: (book: PublicBook) => void }) {
  if (books.length === 0) return null;
  const [lead, ...rest] = books;
  const activity = (book: PublicBook) => book.signals?.recent_activity || 0;

  return (
    <Reveal>
      <section aria-labelledby="dang-duoc-yeu-thich">
        <SectionHeading
          id="dang-duoc-yeu-thich"
          eyebrow={`Xu hướng · ${days} ngày qua`}
          title="Đang được yêu thích"
          basis="Xếp theo lượt mượn, đặt trước và thêm vào yêu thích gần đây, không lặp lại các sách ở bảng Top 10."
          seeAllTo="/books?sort=popular"
        />
        <div className="grid gap-4 lg:grid-cols-[1.15fr_1fr] lg:gap-5">
          <article className="group relative overflow-hidden rounded-2xl border border-border bg-gradient-to-br from-indigo-50 via-card to-card p-6 dark:from-indigo-950/40 sm:p-8">
            <div className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-indigo-400/20 blur-3xl dark:bg-indigo-500/20" aria-hidden="true" />
            <div className="relative flex flex-col gap-6 sm:flex-row sm:items-center">
              <Link to={`/books/${lead.id}`} tabIndex={-1} aria-hidden="true" className="mx-auto w-36 shrink-0 sm:mx-0 sm:w-44">
                <Book3D title={lead.title} author={lead.author} imageUrl={lead.cover_image_url} pose="card" />
              </Link>
              <div className="min-w-0">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-indigo-600 px-2.5 py-1 text-[11.5px] font-semibold text-white">
                  <Flame className="h-3.5 w-3.5" aria-hidden="true" /> #1 đang được quan tâm
                </span>
                <h3 className="mt-3 font-serif text-[26px] font-semibold leading-[1.15] tracking-tight sm:text-[30px]">
                  <Link to={`/books/${lead.id}`} className="hover:underline">{lead.title}</Link>
                </h3>
                <p className="mt-1 text-[14px] text-muted-foreground">{lead.author || 'Chưa rõ tác giả'}</p>
                <dl className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-[13px]">
                  <div>
                    <dt className="text-muted-foreground">Hoạt động {days} ngày</dt>
                    <dd className="font-serif text-[22px] font-semibold tabular-nums">{numberFormat.format(activity(lead))}</dd>
                  </div>
                  {lead.signals && lead.signals.rating_count > 0 ? (
                    <div>
                      <dt className="text-muted-foreground">{lead.signals.rating_count} đánh giá</dt>
                      <dd className="flex items-center gap-1 font-serif text-[22px] font-semibold tabular-nums">
                        {lead.signals.rating_avg.toFixed(1)} <Star className="h-4 w-4 fill-amber-400 text-amber-400" aria-hidden="true" />
                      </dd>
                    </div>
                  ) : null}
                </dl>
                <div className="mt-5 flex flex-wrap items-center gap-3">
                  <AvailabilityStamp book={lead} />
                  {lead.reservable ? (
                    <button type="button" onClick={() => onReserve(lead)} className="inline-flex h-9 items-center rounded-full bg-indigo-700 px-4 text-[13px] font-semibold text-white hover:bg-indigo-800 dark:bg-indigo-500">
                      Đặt trước
                    </button>
                  ) : null}
                  <Link to={`/books/${lead.id}`} className="inline-flex items-center gap-1 text-[13px] font-semibold text-indigo-700 hover:underline dark:text-indigo-300">
                    Xem chi tiết <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                  </Link>
                </div>
              </div>
            </div>
          </article>

          <ol className="grid gap-3 sm:grid-cols-2 lg:gap-4">
            {rest.slice(0, 4).map((book, index) => (
              <li key={book.id}>
                <Link
                  to={`/books/${book.id}`}
                  className="group flex h-full items-center gap-4 rounded-2xl border border-border bg-card p-4 transition-all hover:-translate-y-0.5 hover:border-indigo-300 hover:shadow-[0_12px_30px_-18px_rgba(79,70,229,0.5)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/50 motion-reduce:transform-none dark:hover:border-indigo-500/40"
                >
                  <BookCover title={book.title} author={book.author} imageUrl={book.cover_image_url} className="w-16 shrink-0" />
                  <span className="min-w-0">
                    <span className="font-mono text-[11px] text-muted-foreground">#{index + 2}</span>
                    <span className="mt-0.5 line-clamp-2 block text-[14px] font-semibold leading-snug group-hover:text-indigo-700 dark:group-hover:text-indigo-300">{book.title}</span>
                    <span className="mt-0.5 block truncate text-[12.5px] text-muted-foreground">{book.author || 'Chưa rõ tác giả'}</span>
                    <span className="mt-1.5 inline-flex items-center gap-1 text-[12px] font-medium text-foreground/80">
                      <Flame className="h-3 w-3 text-orange-500" aria-hidden="true" /> {numberFormat.format(activity(book))} lượt quan tâm
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ol>
        </div>
      </section>
    </Reveal>
  );
}

/** Full-bleed dark band: the ten most borrowed titles, bar length = share of #1's loans. */
export function TopTenBand({ books, days }: { books: PublicBook[]; days: number }) {
  if (books.length === 0) return null;
  const max = Math.max(...books.map((book) => book.signals?.borrow_count || 0), 1);
  return (
    <section aria-labelledby="duoc-muon-nhieu" className="relative overflow-hidden bg-[#141432] py-16 text-white sm:py-20">
      <div className="pointer-events-none absolute -left-24 top-0 h-80 w-80 rounded-full bg-indigo-600/30 blur-3xl" aria-hidden="true" />
      <div className="pointer-events-none absolute -right-24 bottom-0 h-80 w-80 rounded-full bg-cyan-500/15 blur-3xl" aria-hidden="true" />
      <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <Reveal>
          <SectionHeading
            id="duoc-muon-nhieu"
            tone="inverse"
            eyebrow={`Top 10 · ${days} ngày qua`}
            title="Được mượn nhiều nhất"
            basis="Xếp theo số lượt mượn thực tế. Thanh bên cạnh so với cuốn đứng đầu."
            seeAllTo="/books?sort=popular"
          />
          <ol className="grid gap-x-10 gap-y-1 md:grid-cols-2">
            {books.map((book, index) => {
              const count = book.signals?.borrow_count || 0;
              return (
                <li key={book.id}>
                  <Link to={`/books/${book.id}`} className="group flex items-center gap-4 rounded-xl px-2 py-3 transition-colors hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300/60">
                    <span
                      className={cn('w-12 shrink-0 text-right font-serif font-semibold tabular-nums leading-none', index < 3 ? 'text-[40px] text-white' : 'text-[34px] text-transparent [-webkit-text-stroke:1px_rgba(255,255,255,0.45)]')}
                    >
                      {index + 1}
                    </span>
                    <BookCover title={book.title} author={book.author} imageUrl={book.cover_image_url} className="w-11 shrink-0 rounded-[3px]" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14.5px] font-semibold group-hover:underline">{book.title}</span>
                      <span className="block truncate text-[12.5px] text-indigo-100/70">{book.author || 'Chưa rõ tác giả'}</span>
                      <span className="mt-2 flex items-center gap-2">
                        <span className="h-1 flex-1 overflow-hidden rounded-full bg-white/10">
                          <span className="block h-full rounded-full bg-gradient-to-r from-indigo-400 to-cyan-300" style={{ width: `${Math.max(4, (count / max) * 100)}%` }} />
                        </span>
                        <span className="shrink-0 whitespace-nowrap text-right font-mono text-[11.5px] tabular-nums text-indigo-100/80">{numberFormat.format(count)} lượt</span>
                      </span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ol>
        </Reveal>
      </div>
    </section>
  );
}

/** Large category cards; the covers fan out further on hover. */
export function CategoryShowcase({ categories }: { categories: PublicHome['categories'] }) {
  if (categories.length === 0) return null;
  return (
    <Reveal>
      <section aria-labelledby="the-loai">
        <SectionHeading id="the-loai" eyebrow="Thể loại" title="Khám phá theo thể loại" seeAllTo="/categories" />
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {/* 1 large + 4 small fills the 3-column bento exactly. */}
          {categories.slice(0, 5).map((category, index) => (
            <li key={category.slug} className={cn(index === 0 && 'lg:row-span-2')}>
              <Link
                to={`/categories/${category.slug}`}
                className={cn(
                  'group relative flex h-full min-h-40 overflow-hidden rounded-2xl border border-border bg-card p-6 transition-all hover:-translate-y-0.5 hover:shadow-[0_18px_40px_-22px_rgba(15,23,42,0.45)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/50 motion-reduce:transform-none',
                  index === 0 && 'lg:min-h-[21rem]',
                )}
              >
                <span className="pointer-events-none absolute inset-0 opacity-[0.07] dark:opacity-[0.16]" style={{ backgroundColor: bindingFor(category.name) }} aria-hidden="true" />
                <span className={cn('relative z-10 flex min-w-0 flex-col justify-between pr-28', index === 0 && 'lg:pr-0')}>
                  <span>
                    <span className={cn('block font-serif text-[22px] font-semibold leading-tight tracking-tight', index === 0 && 'lg:text-[30px]')}>{category.name}</span>
                    <span className="mt-1.5 block text-[13px] text-muted-foreground">
                      {numberFormat.format(category.book_count)} đầu sách · {numberFormat.format(category.available_count)} đang có trên kệ
                    </span>
                  </span>
                  <span className="mt-6 inline-flex items-center gap-1 text-[13px] font-semibold text-indigo-700 dark:text-indigo-300">
                    Xem thể loại <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-1" aria-hidden="true" />
                  </span>
                </span>
                <span className={cn('pointer-events-none absolute bottom-0 right-4 h-32 w-28', index === 0 && 'lg:right-8 lg:h-56 lg:w-44')} aria-hidden="true">
                  {(category.covers.length ? category.covers : [null, null, null]).slice(0, 3).map((cover, coverIndex) => (
                    <span
                      key={cover || coverIndex}
                      className="absolute bottom-[-12%] left-1/2 block w-[62%] origin-bottom transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none"
                      style={{
                        transform: `translateX(-50%) rotate(${(coverIndex - 1) * 9}deg) translateX(${(coverIndex - 1) * 18}%)`,
                        zIndex: coverIndex === 1 ? 3 : 2,
                      }}
                    >
                      <span className="block transition-transform duration-500 group-hover:-translate-y-2 motion-reduce:transform-none">
                        {cover ? (
                          <img src={cover} alt="" loading="lazy" decoding="async" className="aspect-[2/3] w-full rounded-[4px] object-cover shadow-lg" />
                        ) : (
                          <span className="block aspect-[2/3] w-full rounded-[4px] shadow-lg" style={{ backgroundColor: bindingFor(`${category.name}-${coverIndex}`) }} />
                        )}
                      </span>
                    </span>
                  ))}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </Reveal>
  );
}
