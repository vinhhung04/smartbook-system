import { useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { Link } from 'react-router';
import { ArrowRight, Bell, BellRing, Clock, Flame, MapPin, Navigation, Phone, Star } from 'lucide-react';
import type { PublicBook, PublicBranch, PublicHome } from '@/services/public-catalog';
import { cn } from '@/components/ui/utils';
import type { AvailabilityAlerts } from './use-availability-alerts';
import { AvailabilityStamp } from './availability-stamp';
import { BookCover } from './book-cover';
import { Reveal, SectionHeading } from './book-row';
import { TiltCard } from './tilt-card';
import { BranchStatus } from './branch-status';
import { bindingFor } from '@/lib/book-binding';
import { branchBooksUrl, directionsUrl } from '@/lib/branch-links';
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
          title="Đang được yêu thích"
          basis={`Xếp theo lượt mượn, đặt trước và thêm vào yêu thích trong ${days} ngày qua, không lặp lại các sách ở bảng Top 10.`}
          seeAllTo="/books?sort=popular"
        />
        <div className="grid gap-4 lg:grid-cols-[1.15fr_1fr] lg:gap-5">
          <article data-reveal-item className="group relative overflow-hidden rounded-[28px] bg-indigo-50 p-6 dark:bg-indigo-500/10 sm:p-9">
            <div className="relative flex flex-col gap-7 sm:flex-row sm:items-center">
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
                <p className="inline-flex items-center gap-1.5 text-[13.5px] font-semibold text-indigo-800 dark:text-indigo-200">
                  <Flame className="h-4 w-4 text-orange-500" aria-hidden="true" /> Được quan tâm nhất lúc này
                </p>
                <h3 className="mt-2 text-balance font-display text-[28px] font-semibold leading-[1.08] tracking-[-0.02em] sm:text-[34px]">
                  <Link to={`/books/${lead.id}`} className="hover:underline">{lead.title}</Link>
                </h3>
                <p className="mt-1 text-[14px] text-muted-foreground">{lead.author || 'Chưa rõ tác giả'}</p>
                <dl className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-[13px]">
                  <div>
                    <dt className="text-muted-foreground">Hoạt động {days} ngày</dt>
                    <dd className="font-display text-[26px] font-semibold tabular-nums">{numberFormat.format(activity(lead))}</dd>
                  </div>
                  {lead.signals && lead.signals.rating_count > 0 ? (
                    <div>
                      <dt className="text-muted-foreground">{lead.signals.rating_count} đánh giá</dt>
                      <dd className="flex items-center gap-1 font-display text-[26px] font-semibold tabular-nums">
                        {lead.signals.rating_avg.toFixed(1)} <Star className="h-4 w-4 fill-amber-400 text-amber-400" aria-hidden="true" />
                      </dd>
                    </div>
                  ) : null}
                </dl>
                <div className="mt-5 flex flex-wrap items-center gap-3">
                  <AvailabilityStamp book={lead} />
                  {lead.reservable ? (
                    <button type="button" onClick={() => onReserve(lead)} className="inline-flex h-11 items-center rounded-full bg-indigo-700 px-5 text-[14px] font-semibold text-white transition-[background-color,transform] hover:bg-indigo-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/50 focus-visible:ring-offset-2 active:scale-[0.98] dark:bg-indigo-500 dark:hover:bg-indigo-400">
                      Đặt trước
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void alerts.toggle(lead)}
                      disabled={alerts.isBusy(lead.id)}
                      aria-pressed={alerts.isOn(lead.id)}
                      className={cn(
                        'inline-flex h-11 items-center gap-1.5 rounded-full px-5 text-[14px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/50 disabled:opacity-60',
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
              <li key={book.id} data-reveal-item>
                <TiltCard className="h-full rounded-2xl">
                <Link
                  to={`/books/${book.id}`}
                  className="group flex h-full items-center gap-4 rounded-2xl bg-card p-4 ring-1 ring-border transition-[box-shadow] hover:ring-indigo-300 hover:shadow-[0_14px_30px_-20px_rgba(30,27,75,0.45)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/50 dark:hover:ring-indigo-500/40"
                >
                  <BookCover title={book.title} author={book.author} imageUrl={book.cover_image_url} className="w-16 shrink-0" />
                  <span className="min-w-0">
                    <span className="font-display text-[15px] font-semibold tabular-nums text-muted-foreground">Hạng {index + 2}</span>
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
      title: 'Được mượn nhiều nhất',
      basis: `Mười cuốn có nhiều lượt mượn thực tế nhất trong ${borrowDays} ngày qua. Thanh bên cạnh so với cuốn đứng đầu.`,
      seeAllTo: '/books?sort=popular',
    },
    {
      key: 'rated' as const,
      label: 'Đánh giá cao',
      books: topRated,
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
    <section aria-labelledby="xep-hang" className="relative overflow-hidden bg-[#1d1a4a] py-20 text-white sm:py-28 dark:bg-[#15133a]">
      <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <Reveal>
          <SectionHeading
            id="xep-hang"
            tone="inverse"
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
                <li key={book.id} data-reveal-item className="flex items-center gap-2">
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
                          <span className="block h-full origin-left rounded-full bg-amber-200" style={{ transform: `scaleX(${Math.max(0.04, share)})` }} />
                        </span>
                        <span className="shrink-0 whitespace-nowrap text-right text-[12.5px] font-medium tabular-nums text-indigo-100/85">{metric}</span>
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

/**
 * "Đến thư viện gần bạn" as an index of branches rather than a wall of equal
 * cards: one row per branch, read left to right (where, when, what is on the
 * shelves, what to do). Every value comes from the branch record.
 */
export function HomeBranches({ branches }: { branches: PublicBranch[] }) {
  if (branches.length === 0) return null;
  return (
    <Reveal>
      <section aria-labelledby="chi-nhanh">
        <SectionHeading
          id="chi-nhanh"
          title="Đến thư viện gần bạn"
          basis={`${branches.length} chi nhánh. Đặt trước trực tuyến, nhận sách tại chi nhánh bạn chọn. Số sách có sẵn cập nhật theo kệ thật của từng chi nhánh.`}
          seeAllTo="/branches"
        />
        <ul className="grid gap-3">
          {branches.map((branch) => {
            const { stats } = branch;
            return (
              <li key={branch.id} data-reveal-item>
                <article
                  aria-labelledby={`chi-nhanh-${branch.id}`}
                  className="grid gap-5 rounded-[22px] bg-card p-5 ring-1 ring-border transition-shadow hover:shadow-[0_18px_40px_-28px_rgba(30,27,75,0.5)] sm:p-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)_auto] lg:items-center lg:gap-8"
                >
                  <div className="min-w-0">
                    <h3 id={`chi-nhanh-${branch.id}`} className="font-display text-[22px] font-semibold leading-tight tracking-[-0.01em]">
                      <Link to={`/branches/${branch.id}`} className="rounded-sm hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/50">{branch.name}</Link>
                    </h3>
                    <div className="mt-2"><BranchStatus /></div>
                  </div>
                  <div className="min-w-0 space-y-1.5 text-[14px] leading-relaxed text-foreground/80">
                    <p className="flex gap-2">
                      <MapPin className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                      {branch.address ? <span>{branch.address}</span> : <span className="text-muted-foreground">Địa chỉ đang được cập nhật</span>}
                    </p>
                    {branch.opening_hours ? (
                      <p className="flex gap-2">
                        <Clock className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                        <span><span className="sr-only">Giờ mở cửa: </span>{branch.opening_hours}</span>
                      </p>
                    ) : null}
                    {branch.phone ? (
                      <p className="flex gap-2">
                        <Phone className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                        <a href={`tel:${branch.phone.replace(/[^0-9+]/g, '')}`} className="hover:underline">{branch.phone}</a>
                      </p>
                    ) : null}
                  </div>
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-center lg:justify-end">
                    {stats.title_count > 0 ? (
                      <dl className="flex gap-6">
                        <div>
                          <dt className="text-[12.5px] text-muted-foreground">Đầu sách</dt>
                          <dd className="font-display text-[26px] font-semibold leading-tight tabular-nums">{numberFormat.format(stats.title_count)}</dd>
                        </div>
                        <div>
                          <dt className="text-[12.5px] text-muted-foreground">Có sẵn</dt>
                          <dd className="font-display text-[26px] font-semibold leading-tight tabular-nums text-emerald-700 dark:text-emerald-400">{numberFormat.format(stats.available_title_count)}</dd>
                        </div>
                      </dl>
                    ) : (
                      <p className="text-[13.5px] text-muted-foreground">Chi nhánh chưa có sách trên kệ.</p>
                    )}
                    <div className="flex flex-wrap gap-2">
                      {stats.title_count > 0 ? (
                        <Link
                          to={branchBooksUrl(branch)}
                          aria-label={`Xem sách tại ${branch.name}`}
                          className="group inline-flex h-11 items-center gap-1.5 rounded-full bg-indigo-700 px-4 text-[13.5px] font-semibold text-white transition-[background-color,transform] hover:bg-indigo-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/50 focus-visible:ring-offset-2 active:scale-[0.98] dark:bg-indigo-500 dark:hover:bg-indigo-400"
                        >
                          Xem sách <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
                        </Link>
                      ) : null}
                      {branch.address ? (
                        <a
                          href={directionsUrl(branch.address)}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label={`Chỉ đường đến ${branch.name} (mở Google Maps trong thẻ mới)`}
                          className="inline-flex h-11 items-center gap-1.5 rounded-full px-4 text-[13.5px] font-semibold text-foreground ring-1 ring-border transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/50"
                        >
                          <Navigation className="h-4 w-4" aria-hidden="true" /> Chỉ đường
                        </a>
                      ) : null}
                    </div>
                  </div>
                </article>
              </li>
            );
          })}
        </ul>
      </section>
    </Reveal>
  );
}

/**
 * Categories as an editorial spread: the largest category is a full field of
 * its own binding colour with its covers fanned large, the next four are
 * tinted with theirs. Each category keeps the same colour as its cloth
 * binding elsewhere on the site, so it is recognisable at a glance.
 */
export function CategoryShowcase({ categories }: { categories: PublicHome['categories'] }) {
  if (categories.length === 0) return null;
  return (
    <Reveal>
      <section aria-labelledby="the-loai">
        <SectionHeading id="the-loai" title="Khám phá theo thể loại" basis="Số đầu sách và số đang có trên kệ của từng thể loại." seeAllTo="/categories" />
        <ul className="grid gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-4 lg:grid-rows-2">
          {categories.slice(0, 5).map((category, index) => {
            const lead = index === 0;
            const colour = bindingFor(category.name);
            const covers = category.covers.slice(0, lead ? 3 : 2);
            return (
              <li key={category.slug} data-reveal-item className={cn(lead && 'sm:col-span-2 lg:row-span-2')}>
                <Link
                  to={`/categories/${category.slug}`}
                  className={cn(
                    'group relative flex h-full overflow-hidden rounded-[22px] p-5 transition-shadow hover:shadow-[0_20px_44px_-26px_rgba(30,27,75,0.55)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/60 focus-visible:ring-offset-2 sm:p-6',
                    lead ? 'min-h-[15rem] text-[#F3EBD8] lg:min-h-[26rem] lg:p-8' : 'min-h-[9.5rem] bg-card text-foreground ring-1 ring-border sm:min-h-[11.5rem]',
                  )}
                  style={lead ? { backgroundColor: colour } : undefined}
                >
                  {lead ? null : <span className="pointer-events-none absolute inset-0 opacity-[0.10] transition-opacity duration-500 group-hover:opacity-[0.18] dark:opacity-[0.22] dark:group-hover:opacity-[0.3]" style={{ backgroundColor: colour }} aria-hidden="true" />}
                  <span className={cn('relative z-10 flex min-w-0 flex-col justify-between', lead ? 'max-w-[58%] lg:max-w-[16rem]' : 'max-w-[62%]')}>
                    <span>
                      <span className={cn('block text-balance font-display font-semibold tracking-[-0.015em]', lead ? 'text-[28px] lg:text-[40px]' : 'text-[19px] sm:text-[21px]', 'leading-[1.08]')}>{category.name}</span>
                      <span className={cn('mt-2 block text-[13px] leading-snug', lead ? 'text-[#F3EBD8]/80' : 'text-muted-foreground')}>
                        {numberFormat.format(category.book_count)} đầu sách, {numberFormat.format(category.available_count)} có trên kệ
                      </span>
                    </span>
                    <span className={cn('mt-5 inline-flex items-center gap-1 whitespace-nowrap text-[13.5px] font-semibold', lead ? 'text-[#F3EBD8]' : 'text-indigo-700 dark:text-indigo-300')}>
                      Xem thể loại <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-1" aria-hidden="true" />
                    </span>
                  </span>
                  {/* The category's own covers, fanned; they spread a little further on hover. */}
                  <span className={cn('pointer-events-none absolute', lead ? '-bottom-6 right-4 h-[78%] w-[44%] lg:right-8 lg:h-[72%] lg:w-[46%]' : '-bottom-4 right-3 h-[80%] w-[34%] sm:right-2 sm:h-[70%] sm:w-[42%]')} aria-hidden="true">
                    {(covers.length ? covers : [null, null]).map((cover, coverIndex, all) => {
                      const spread = coverIndex - (all.length - 1) / 2;
                      return (
                        <span
                          key={cover || coverIndex}
                          className="absolute bottom-0 left-1/2 block w-[62%] origin-bottom transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] [transform:translateX(calc(-50%_+_var(--fan-x)))_rotate(var(--fan-r))] group-hover:[transform:translateX(calc(-50%_+_var(--fan-x)*1.25))_translateY(-4%)_rotate(calc(var(--fan-r)*1.3))] motion-reduce:transition-none"
                          style={{
                            '--fan-x': `${spread * 26}%`,
                            '--fan-r': `${spread * 8}deg`,
                            zIndex: 10 - Math.abs(Math.round(spread * 2)),
                          } as CSSProperties}
                        >
                          {cover ? (
                            <img src={cover} alt="" loading="lazy" decoding="async" className="aspect-[2/3] w-full rounded-[4px] object-cover shadow-[0_14px_28px_-12px_rgba(15,23,42,0.6)]" />
                          ) : (
                            <span className="block aspect-[2/3] w-full rounded-[4px] shadow-lg" style={{ backgroundColor: bindingFor(`${category.name}-${coverIndex}`) }} />
                          )}
                        </span>
                      );
                    })}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </section>
    </Reveal>
  );
}
