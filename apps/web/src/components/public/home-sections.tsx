import { useRef, useState, type KeyboardEvent } from 'react';
import { Link } from 'react-router';
import { ArrowRight, Bell, BellRing, Flame, Star } from 'lucide-react';
import type { PublicBook, PublicBranch, PublicHome } from '@/services/public-catalog';
import { cn } from '@/components/ui/utils';
import type { AvailabilityAlerts } from './use-availability-alerts';
import { AvailabilityStamp } from './availability-stamp';
import { BookCover } from './book-cover';
import { Reveal, SectionHeading } from './book-row';
import { TiltCard } from './tilt-card';
import { CategoryCard } from './category-card';
import { BranchCard } from './branch-card';
import { BackCover, SpinningBook } from './spinning-book';

const numberFormat = new Intl.NumberFormat('vi-VN');

/**
 * "Đang được yêu thích" as a bento: the most-active book gets a feature panel,
 * the next four sit beside it. Every number shown is the real recent-activity
 * count (loans + reservations + wishlist adds in the window).
 */
export function FeaturedTrending({ books, days, onReserve, alerts }: { books: PublicBook[]; days: number; onReserve: (book: PublicBook) => void; alerts: AvailabilityAlerts }) {
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
              <SpinningBook
                title={lead.title}
                author={lead.author}
                imageUrl={lead.cover_image_url}
                className="mx-auto w-40 shrink-0 sm:mx-0 sm:w-48"
                back={(
                  <BackCover
                    title={lead.title}
                    author={lead.author}
                    facts={[
                      ...(lead.signals && lead.signals.rating_count > 0
                        ? [{ label: 'Đánh giá', value: `★ ${lead.signals.rating_avg.toFixed(1)} · ${lead.signals.rating_count}` }]
                        : []),
                      { label: `${days} ngày qua`, value: `${numberFormat.format(activity(lead))} lượt` },
                      { label: 'Tình trạng', value: lead.available_quantity > 0 ? `Còn ${lead.available_quantity}` : 'Đã mượn hết' },
                    ]}
                  />
                )}
              />
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
                  ) : (
                    <button
                      type="button"
                      onClick={() => void alerts.toggle(lead)}
                      disabled={alerts.isBusy(lead.id)}
                      aria-pressed={alerts.isOn(lead.id)}
                      className={cn(
                        'inline-flex h-9 items-center gap-1.5 rounded-full px-4 text-[13px] font-semibold transition-colors disabled:opacity-60',
                        alerts.isOn(lead.id)
                          ? 'border border-indigo-300 text-indigo-700 dark:border-indigo-500/40 dark:text-indigo-300'
                          : 'bg-indigo-700 text-white hover:bg-indigo-800 dark:bg-indigo-500',
                      )}
                    >
                      {alerts.isOn(lead.id) ? <BellRing className="h-3.5 w-3.5" aria-hidden="true" /> : <Bell className="h-3.5 w-3.5" aria-hidden="true" />}
                      {alerts.isOn(lead.id) ? 'Đã bật thông báo' : 'Báo khi có sách'}
                    </button>
                  )}
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
                <TiltCard className="h-full rounded-2xl">
                <Link
                  to={`/books/${book.id}`}
                  className="group flex h-full items-center gap-4 rounded-2xl border border-border bg-card p-4 transition-[border-color,box-shadow] hover:border-indigo-300 hover:shadow-[0_12px_30px_-18px_rgba(79,70,229,0.5)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/50 dark:hover:border-indigo-500/40"
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
                </TiltCard>
              </li>
            ))}
          </ol>
        </div>
      </section>
    </Reveal>
  );
}

type Ranking = 'borrowed' | 'rated';

/**
 * Full-bleed dark band with the two "best of" lists behind tabs: the ten most
 * borrowed titles (bar = share of #1's loans) and the best rated (bar = score
 * out of 5). One band instead of two sections that mostly repeat each other.
 */
export function RankingBand({ mostBorrowed, topRated, borrowDays, minReviews, alerts }: {
  mostBorrowed: PublicBook[];
  topRated: PublicBook[];
  borrowDays: number;
  minReviews: number;
  alerts: AvailabilityAlerts;
}) {
  const tabs = ([
    {
      key: 'borrowed' as const,
      label: 'Mượn nhiều',
      books: mostBorrowed,
      eyebrow: `Top 10 · ${borrowDays} ngày qua`,
      title: 'Được mượn nhiều nhất',
      basis: 'Xếp theo số lượt mượn thực tế. Thanh bên cạnh so với cuốn đứng đầu.',
      seeAllTo: '/books?sort=popular',
    },
    {
      key: 'rated' as const,
      label: 'Đánh giá cao',
      books: topRated,
      eyebrow: 'Bạn đọc chấm điểm',
      title: 'Bạn đọc đánh giá cao',
      basis: `Điểm trung bình từ ít nhất ${minReviews} đánh giá của bạn đọc. Thanh bên cạnh là điểm trên thang 5.`,
      seeAllTo: '/books?sort=rating',
    },
  ]).filter((tab) => tab.books.length > 0);
  const [selected, setSelected] = useState<Ranking>('borrowed');
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  if (tabs.length === 0) return null;
  const current = tabs.find((tab) => tab.key === selected) ?? tabs[0];
  const maxBorrowed = Math.max(...mostBorrowed.map((book) => book.signals?.borrow_count || 0), 1);

  // WAI-ARIA tabs: arrow keys move between tabs (roving tabindex).
  const onTabKey = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const next = (index + step + tabs.length) % tabs.length;
    setSelected(tabs[next].key);
    tabRefs.current[next]?.focus();
  };

  const tabList = tabs.length > 1 ? (
    <div role="tablist" aria-label="Bảng xếp hạng" className="inline-flex rounded-full border border-white/20 bg-white/5 p-1">
      {tabs.map((tab, index) => {
        const active = tab.key === current.key;
        return (
          <button
            key={tab.key}
            ref={(node) => { tabRefs.current[index] = node; }}
            type="button"
            role="tab"
            id={`xep-hang-tab-${tab.key}`}
            aria-selected={active}
            aria-controls="xep-hang-panel"
            tabIndex={active ? 0 : -1}
            onClick={() => setSelected(tab.key)}
            onKeyDown={(event) => onTabKey(event, index)}
            className={cn(
              'h-8 rounded-full px-3.5 text-[13px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300/70',
              active ? 'bg-white text-[#141432]' : 'text-indigo-100/85 hover:text-white',
            )}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  ) : null;

  return (
    <section aria-labelledby="xep-hang" className="relative overflow-hidden bg-[#141432] py-16 text-white sm:py-20">
      <div className="pointer-events-none absolute -left-24 top-0 h-80 w-80 rounded-full bg-indigo-600/30 blur-3xl" aria-hidden="true" />
      <div className="pointer-events-none absolute -right-24 bottom-0 h-80 w-80 rounded-full bg-cyan-500/15 blur-3xl" aria-hidden="true" />
      <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <Reveal>
          <SectionHeading
            id="xep-hang"
            tone="inverse"
            eyebrow={current.eyebrow}
            title={current.title}
            basis={current.basis}
            seeAllTo={current.seeAllTo}
            actions={tabList}
          />
          <ol
            id="xep-hang-panel"
            role={tabList ? 'tabpanel' : undefined}
            aria-labelledby={tabList ? `xep-hang-tab-${current.key}` : undefined}
            className="grid grid-cols-1 gap-x-10 gap-y-1 md:grid-cols-2"
          >
            {current.books.map((book, index) => {
              const borrowed = book.signals?.borrow_count || 0;
              const rating = book.signals?.rating_avg || 0;
              const share = current.key === 'borrowed' ? borrowed / maxBorrowed : rating / 5;
              const metric = current.key === 'borrowed'
                ? `${numberFormat.format(borrowed)} lượt`
                : `★ ${rating.toFixed(1)} · ${numberFormat.format(book.signals?.rating_count || 0)}`;
              const alertOn = alerts.isOn(book.id);
              return (
                <li key={book.id} className="flex items-center gap-2">
                  <Link to={`/books/${book.id}`} className="group flex min-w-0 flex-1 items-center gap-4 rounded-xl px-2 py-3 transition-colors hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300/60">
                    <span
                      className={cn('w-12 shrink-0 text-right font-serif font-semibold tabular-nums leading-none', index < 3 ? 'text-[40px] text-white' : 'text-[34px] text-transparent [-webkit-text-stroke:1px_rgba(255,255,255,0.45)]')}
                    >
                      {index + 1}
                    </span>
                    <BookCover title={book.title} author={book.author} imageUrl={book.cover_image_url} className="w-11 shrink-0 rounded-[3px]" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14.5px] font-semibold group-hover:underline">{book.title}</span>
                      <span className="block truncate text-[12.5px] text-indigo-100/70">
                        {book.author || 'Chưa rõ tác giả'}
                        {book.reservable ? <span className="text-emerald-300"> · Còn sách</span> : null}
                      </span>
                      <span className="mt-2 flex items-center gap-2">
                        <span className="h-1 flex-1 overflow-hidden rounded-full bg-white/10">
                          <span className="block h-full rounded-full bg-gradient-to-r from-indigo-400 to-cyan-300" style={{ width: `${Math.max(4, share * 100)}%` }} />
                        </span>
                        <span className="shrink-0 whitespace-nowrap text-right font-mono text-[11.5px] tabular-nums text-indigo-100/80">{metric}</span>
                      </span>
                    </span>
                  </Link>
                  {book.reservable ? null : (
                    <button
                      type="button"
                      onClick={() => void alerts.toggle(book)}
                      disabled={alerts.isBusy(book.id)}
                      aria-pressed={alertOn}
                      aria-label={`${alertOn ? 'Tắt thông báo' : 'Báo khi có sách'}: ${book.title}`}
                      title={alertOn ? 'Đã bật thông báo' : 'Đã mượn hết — báo khi có sách'}
                      className={cn(
                        'inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300/70 disabled:opacity-60',
                        alertOn ? 'border-indigo-300/60 bg-indigo-400/20 text-white' : 'border-white/20 text-indigo-100/80 hover:border-white/40 hover:text-white',
                      )}
                    >
                      {alertOn ? <BellRing className="h-4 w-4" aria-hidden="true" /> : <Bell className="h-4 w-4" aria-hidden="true" />}
                    </button>
                  )}
                </li>
              );
            })}
          </ol>
        </Reveal>
      </div>
    </section>
  );
}

/** "Đến thư viện gần bạn": every public branch, with what is on its shelves today. */
export function HomeBranches({ branches }: { branches: PublicBranch[] }) {
  if (branches.length === 0) return null;
  return (
    <Reveal>
      <section aria-labelledby="chi-nhanh">
        <SectionHeading
          id="chi-nhanh"
          eyebrow={`${branches.length} chi nhánh`}
          title="Đến thư viện gần bạn"
          basis="Đặt trước trực tuyến, nhận sách tại chi nhánh bạn chọn. Số sách có sẵn cập nhật theo kệ thật của từng chi nhánh."
          seeAllTo="/branches"
        />
        <ul className={cn('grid gap-4', branches.length > 1 && 'md:grid-cols-2', branches.length > 2 && 'lg:grid-cols-3')}>
          {branches.map((branch) => (
            <li key={branch.id}><BranchCard branch={branch} headingLevel="h3" /></li>
          ))}
        </ul>
      </section>
    </Reveal>
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
              <CategoryCard category={category} featured={index === 0} />
            </li>
          ))}
        </ul>
      </section>
    </Reveal>
  );
}
