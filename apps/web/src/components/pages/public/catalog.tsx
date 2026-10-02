import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation, useParams, useSearchParams } from 'react-router';
import axios from 'axios';
import { ChevronLeft, ChevronRight, Search, SlidersHorizontal, X } from 'lucide-react';
import {
  publicCatalogService,
  type CatalogPage,
  type CatalogQuery,
  type CatalogSort,
} from '@/services/public-catalog';
import { usePageMeta } from '@/lib/page-meta';
import { cn } from '@/components/ui/utils';
import { EmptyState } from '@/components/ui/empty-state';
import { BookCardSkeleton, PublicBookCard } from '@/components/public/public-book-card';
import { useReserveAction } from '@/components/public/use-reserve-action';
import { useDialogA11y } from '@/hooks/useDialogA11y';
import { PageHero } from '@/components/public/page-hero';
import { ReserveModal } from '@/components/pages/customer/_shared/reserve-modal';

const SEARCH_DEBOUNCE_MS = 350;
// Filters in the panel/sheet; availability is its own toggle in the results bar.
const FILTER_KEYS = ['category', 'branch', 'author', 'publisher', 'language', 'year'] as const;
const SORT_LABELS: Record<CatalogSort, string> = {
  relevance: 'Liên quan nhất',
  popular: 'Phổ biến',
  newest: 'Mới nhất',
  rating: 'Đánh giá cao',
  title: 'Tên A–Z',
};
const LANGUAGE_LABELS: Record<string, string> = { vi: 'Tiếng Việt', en: 'Tiếng Anh', fr: 'Tiếng Pháp', ja: 'Tiếng Nhật', zh: 'Tiếng Trung', ko: 'Tiếng Hàn' };

function languageLabel(code: string) {
  return LANGUAGE_LABELS[code.toLowerCase()] || code.toUpperCase();
}

function FilterSelect({ label, value, onChange, children }: { label: string; value: string; onChange: (value: string) => void; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[12px] font-semibold text-muted-foreground">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-10 w-full rounded-md border border-border bg-card px-2.5 text-[13.5px] outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
      >
        {children}
      </select>
    </label>
  );
}

function Pagination({ page, totalPages, onPage }: { page: number; totalPages: number; onPage: (page: number) => void }) {
  if (totalPages <= 1) return null;
  const pages = Array.from(new Set([1, page - 1, page, page + 1, totalPages].filter((p) => p >= 1 && p <= totalPages))).sort((a, b) => a - b);
  const button = 'inline-flex h-9 min-w-9 items-center justify-center rounded-md border border-border px-2.5 text-[13px] font-medium hover:bg-muted disabled:pointer-events-none disabled:opacity-40';
  return (
    <nav aria-label="Phân trang" className="flex items-center justify-center gap-1.5 pt-4">
      <button type="button" className={button} onClick={() => onPage(page - 1)} disabled={page <= 1} aria-label="Trang trước">
        <ChevronLeft className="h-4 w-4" aria-hidden="true" />
      </button>
      {pages.map((p, index) => (
        <span key={p} className="flex items-center gap-1.5">
          {index > 0 && p - pages[index - 1] > 1 ? <span className="px-1 text-muted-foreground" aria-hidden="true">…</span> : null}
          <button
            type="button"
            onClick={() => onPage(p)}
            aria-current={p === page ? 'page' : undefined}
            className={cn(button, p === page && 'border-indigo-700 bg-indigo-700 text-white hover:bg-indigo-700 dark:border-indigo-500 dark:bg-indigo-500')}
          >
            {p}
          </button>
        </span>
      ))}
      <button type="button" className={button} onClick={() => onPage(page + 1)} disabled={page >= totalPages} aria-label="Trang sau">
        <ChevronRight className="h-4 w-4" aria-hidden="true" />
      </button>
    </nav>
  );
}

/**
 * /books, /search and /categories/:slug. The URL is the only source of state,
 * so a refresh, the back button or a shared link restores the exact view.
 */
export function PublicCatalogPage() {
  const { slug } = useParams();
  const { pathname } = useLocation();
  const [params, setParams] = useSearchParams();
  const isSearchPage = pathname === '/search';
  const urlQuery = params.get('q') || '';
  const [draft, setDraft] = useState(urlQuery);
  const [result, setResult] = useState<CatalogPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const sheetRef = useRef<HTMLDivElement>(null);
  useDialogA11y(filtersOpen, () => setFiltersOpen(false), sheetRef);
  const { target, requestReserve, closeReserve } = useReserveAction();
  const resultsRef = useRef<HTMLDivElement>(null);

  const query: CatalogQuery = useMemo(() => ({
    q: urlQuery,
    category: slug || params.get('category') || '',
    branch: params.get('branch') || '',
    author: params.get('author') || '',
    publisher: params.get('publisher') || '',
    language: params.get('language') || '',
    year: params.get('year') || '',
    availability: params.get('availability') === 'available' ? 'available' : '',
    sort: (params.get('sort') as CatalogSort) || '',
    page: Math.max(1, Number(params.get('page')) || 1),
  }), [params, slug, urlQuery]);

  const updateParams = (changes: Record<string, string>, { resetPage = true, replace = false } = {}) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    if (resetPage) next.delete('page');
    setParams(next, { replace });
  };

  // Keep the input in step with back/forward navigation.
  useEffect(() => { setDraft(urlQuery); }, [urlQuery]);

  // Debounced typing writes to the URL (replace, so each keystroke isn't a history entry).
  useEffect(() => {
    const next = draft.trim();
    if (next === urlQuery) return undefined;
    const timer = window.setTimeout(() => updateParams({ q: next }, { replace: true }), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- updateParams reads the latest params on each run
  }, [draft]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    publicCatalogService.getBooks(query, controller.signal)
      .then((data) => setResult(data))
      .catch((err) => {
        if (axios.isCancel(err)) return;
        setError(axios.isAxiosError(err) && err.response?.status === 429
          ? 'Bạn đang tìm quá nhanh. Đợi vài giây rồi thử lại.'
          : 'Máy chủ thư viện chưa phản hồi.');
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [query, reloadKey]);

  const facets = result?.facets;
  const categoryName = query.category ? facets?.categories.find((c) => c.slug === query.category)?.name : null;
  // The server names the branch it filtered by; null means the id matched no open branch.
  const branch = query.branch && result ? result.branch : null;
  const unknownBranch = Boolean(query.branch && result && !result.branch);
  const branchPage = Boolean(branch && !slug && !isSearchPage);
  const heading = slug
    ? categoryName || 'Thể loại'
    : isSearchPage
      ? (urlQuery ? `Kết quả cho “${urlQuery}”` : 'Tìm sách')
      : branchPage && branch ? `Sách tại ${branch.name}`
        : query.sort === 'newest' ? 'Sách mới về' : 'Khám phá sách';
  usePageMeta({
    title: heading,
    description: slug && categoryName
      ? `Sách thể loại ${categoryName} tại thư viện SmartBook — xem còn sách ở chi nhánh nào và đặt mượn trực tuyến.`
      : branchPage && branch
        ? `Sách tại ${branch.name} — xem cuốn nào còn trên kệ và đặt trước để nhận tại chi nhánh.`
        : undefined,
  });

  const activeFilterCount = FILTER_KEYS.filter((key) => key !== 'category' || !slug).filter((key) => params.get(key)).length;
  const hasAnyCriteria = Boolean(urlQuery) || activeFilterCount > 0 || query.availability === 'available';
  const signalsAvailable = result?.signals_available ?? true;
  const effectiveSort = result?.meta.sort || query.sort || (urlQuery ? 'relevance' : 'popular');
  const sortOptions: CatalogSort[] = urlQuery ? ['relevance', 'popular', 'newest', 'rating', 'title'] : ['popular', 'newest', 'rating', 'title'];

  const clearAll = () => {
    setDraft('');
    setParams(new URLSearchParams(), { replace: false });
  };

  const goToPage = (page: number) => {
    updateParams({ page: page > 1 ? String(page) : '' }, { resetPage: false });
    resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const filterPanel = facets ? (
    <div className="space-y-4">
      {!slug ? (
        <FilterSelect label="Thể loại" value={query.category || ''} onChange={(value) => updateParams({ category: value })}>
          <option value="">Tất cả thể loại</option>
          {facets.categories.map((c) => <option key={c.slug} value={c.slug}>{c.name} ({c.count})</option>)}
        </FilterSelect>
      ) : null}
      {facets.branches.length || query.branch ? (
        <FilterSelect label="Chi nhánh" value={query.branch || ''} onChange={(value) => updateParams({ branch: value })}>
          <option value="">Mọi chi nhánh</option>
          {facets.branches.map((b) => <option key={b.id} value={b.id}>{b.name} ({b.count})</option>)}
          {query.branch && !facets.branches.some((b) => b.id === query.branch) ? (
            <option value={query.branch}>{branch?.name || 'Chi nhánh không tồn tại'}</option>
          ) : null}
        </FilterSelect>
      ) : null}
      <FilterSelect label="Tác giả" value={query.author || ''} onChange={(value) => updateParams({ author: value })}>
        <option value="">Tất cả tác giả</option>
        {facets.authors.map((a) => <option key={a.value} value={a.value}>{a.value} ({a.count})</option>)}
      </FilterSelect>
      <FilterSelect label="Nhà xuất bản" value={query.publisher || ''} onChange={(value) => updateParams({ publisher: value })}>
        <option value="">Tất cả nhà xuất bản</option>
        {facets.publishers.map((p) => <option key={p.value} value={p.value}>{p.value} ({p.count})</option>)}
      </FilterSelect>
      {facets.languages.length > 1 ? (
        <FilterSelect label="Ngôn ngữ" value={query.language || ''} onChange={(value) => updateParams({ language: value })}>
          <option value="">Mọi ngôn ngữ</option>
          {facets.languages.map((l) => <option key={l.value} value={l.value}>{languageLabel(l.value)} ({l.count})</option>)}
        </FilterSelect>
      ) : null}
      {facets.years.length > 1 ? (
        <FilterSelect label="Năm xuất bản" value={query.year || ''} onChange={(value) => updateParams({ year: value })}>
          <option value="">Mọi năm</option>
          {facets.years.map((y) => <option key={y.value} value={String(y.value)}>{y.value} ({y.count})</option>)}
        </FilterSelect>
      ) : null}
      {activeFilterCount > 0 ? (
        <button type="button" onClick={() => updateParams(Object.fromEntries(FILTER_KEYS.filter((k) => k !== 'category' || !slug).map((k) => [k, ''])))} className="text-[13px] font-semibold text-indigo-700 hover:underline dark:text-indigo-300">
          Bỏ tất cả bộ lọc
        </button>
      ) : null}
    </div>
  ) : null;

  const chips = facets ? [
    !slug && query.category ? { key: 'category', label: categoryName || query.category } : null,
    query.branch ? { key: 'branch', label: `Chi nhánh: ${branch?.name || 'không tồn tại'}` } : null,
    query.author ? { key: 'author', label: `Tác giả: ${query.author}` } : null,
    query.publisher ? { key: 'publisher', label: `NXB: ${query.publisher}` } : null,
    query.language ? { key: 'language', label: languageLabel(query.language) } : null,
    query.year ? { key: 'year', label: `Năm ${query.year}` } : null,
  ].filter((chip): chip is { key: string; label: string } => Boolean(chip)) : [];

  const eyebrow = slug ? 'Thể loại' : isSearchPage ? 'Tìm kiếm' : branchPage ? 'Chi nhánh' : query.sort === 'newest' ? 'Mới cập nhật' : 'Danh mục';
  const description = slug
    ? (result ? `${result.meta.total} đầu sách trong thể loại này.` : 'Sách trong thể loại này.')
    : branchPage && result
      ? `${result.meta.total} đầu sách ${query.availability === 'available' ? 'có sẵn để đặt trước và nhận tại chi nhánh này' : 'chi nhánh này đang giữ, kể cả cuốn đang được mượn'}.`
    : isSearchPage && urlQuery
      ? (result ? `Tìm thấy ${result.meta.total} đầu sách khớp tên sách, tác giả hoặc ISBN.` : 'Đang tìm…')
      : 'Lọc theo thể loại, tác giả, năm xuất bản và xem ngay sách nào còn trên kệ.';

  return (
    <>
      <PageHero
        eyebrow={eyebrow}
        title={heading}
        description={description}
        top={slug ? (
          <nav aria-label="Đường dẫn" className="text-[13px] text-muted-foreground">
            <Link to="/categories" className="hover:text-foreground hover:underline">Thể loại</Link>
            <span aria-hidden="true"> / </span>
            <span className="text-foreground">{categoryName || slug}</span>
          </nav>
        ) : branchPage && branch ? (
          <nav aria-label="Đường dẫn" className="text-[13px] text-muted-foreground">
            <Link to="/branches" className="hover:text-foreground hover:underline">Chi nhánh</Link>
            <span aria-hidden="true"> / </span>
            <Link to={`/branches/${branch.id}`} className="text-foreground hover:underline">{branch.name}</Link>
          </nav>
        ) : undefined}
      >
        <form role="search" onSubmit={(event) => { event.preventDefault(); updateParams({ q: draft.trim() }); }} className="flex max-w-2xl items-center gap-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <input
              type="search"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Tên sách, tác giả, ISBN…"
              aria-label="Tìm trong danh mục"
              autoFocus={isSearchPage && !urlQuery}
              className="h-12 w-full rounded-full border border-border bg-card pl-11 pr-11 text-[14.5px] shadow-sm outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/15 [&::-webkit-search-cancel-button]:hidden"
            />
            {draft ? (
              <button type="button" onClick={() => { setDraft(''); updateParams({ q: '' }); }} aria-label="Xóa từ khóa" className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-1 text-muted-foreground hover:bg-muted hover:text-foreground">
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            ) : null}
          </div>
          <button type="button" onClick={() => setFiltersOpen(true)} aria-expanded={filtersOpen} aria-haspopup="dialog" className="inline-flex h-12 items-center gap-1.5 rounded-full border border-border bg-card px-4 text-[13.5px] font-medium hover:bg-muted lg:hidden">
            <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
            Bộ lọc{activeFilterCount ? ` (${activeFilterCount})` : ''}
          </button>
        </form>
      </PageHero>

      <div className="mx-auto max-w-7xl px-4 pb-6 pt-6 sm:px-6 lg:px-8">

        {chips.length ? (
          <ul className="mt-4 flex flex-wrap gap-2" aria-label="Bộ lọc đang áp dụng">
            {chips.map((chip) => (
              <li key={chip.key}>
                <button
                  type="button"
                  onClick={() => updateParams({ [chip.key]: '' })}
                  aria-label={`Bỏ lọc ${chip.label}`}
                  className="inline-flex items-center gap-1.5 rounded-full border border-indigo-200 bg-indigo-50 py-1 pl-3 pr-2 text-[12.5px] font-medium text-indigo-800 hover:bg-indigo-100 dark:border-indigo-500/30 dark:bg-indigo-950/30 dark:text-indigo-200"
                >
                  {chip.label} <X className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        ) : null}

        <div className="mt-8 grid gap-8 lg:grid-cols-[220px_1fr]">
          <aside aria-label="Bộ lọc" className="hidden lg:sticky lg:top-24 lg:block lg:self-start">
            {filterPanel ?? <div className="h-64 animate-pulse rounded-md bg-muted/60" aria-hidden="true" />}
          </aside>

          <div ref={resultsRef} className="min-w-0 scroll-mt-24">
            <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-3">
                <p className="text-[13.5px] text-muted-foreground" aria-live="polite">
                  {loading && !result ? 'Đang tải…' : result ? <><span className="font-semibold text-foreground">{result.meta.total}</span> đầu sách</> : null}
                </p>
                <button
                  type="button"
                  role="switch"
                  aria-checked={query.availability === 'available'}
                  onClick={() => updateParams({ availability: query.availability === 'available' ? '' : 'available' })}
                  className={cn(
                    'inline-flex h-8 items-center gap-2 rounded-full border px-3 text-[12.5px] font-medium transition-colors',
                    query.availability === 'available'
                      ? 'border-emerald-600 bg-emerald-600 text-white'
                      : 'border-border text-foreground hover:border-emerald-500/60',
                  )}
                >
                  <span className={cn('h-1.5 w-1.5 rounded-full', query.availability === 'available' ? 'bg-white' : 'bg-emerald-500')} aria-hidden="true" />
                  {query.branch ? 'Có sẵn tại chi nhánh' : 'Chỉ sách có sẵn'}
                </button>
              </div>
              <label className="flex items-center gap-2 text-[13px] text-muted-foreground">
                Sắp xếp
                <select
                  value={effectiveSort}
                  onChange={(event) => updateParams({ sort: event.target.value })}
                  className="h-9 rounded-md border border-border bg-card px-2 text-[13px] text-foreground outline-none focus:border-indigo-500"
                >
                  {sortOptions.map((sort) => (
                    <option key={sort} value={sort} disabled={!signalsAvailable && (sort === 'popular' || sort === 'rating')}>
                      {SORT_LABELS[sort]}{!signalsAvailable && (sort === 'popular' || sort === 'rating') ? ' (tạm chưa có dữ liệu)' : ''}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {error ? (
              <EmptyState
                variant="error"
                title="Không tải được danh sách sách"
                description={error}
                action={<button type="button" onClick={() => setReloadKey((key) => key + 1)} className="font-semibold text-indigo-700 hover:underline dark:text-indigo-300">Thử lại</button>}
              />
            ) : unknownBranch ? (
              <EmptyState
                variant="no-results"
                title="Không tìm thấy chi nhánh này"
                description="Chi nhánh không tồn tại hoặc đã ngừng hoạt động."
                action={
                  <div className="flex flex-wrap justify-center gap-4">
                    <button type="button" onClick={() => updateParams({ branch: '' })} className="font-semibold text-indigo-700 hover:underline dark:text-indigo-300">Bỏ lọc chi nhánh</button>
                    <Link to="/branches" className="font-semibold text-indigo-700 hover:underline dark:text-indigo-300">Xem các chi nhánh</Link>
                  </div>
                }
              />
            ) : loading && !result ? (
              <div className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 xl:grid-cols-4" aria-busy="true">
                {Array.from({ length: 8 }).map((_, index) => <BookCardSkeleton key={index} />)}
              </div>
            ) : result && result.data.length === 0 ? (
              <EmptyState
                variant="no-results"
                title={urlQuery ? `Không có sách khớp với “${urlQuery}”` : 'Không có sách khớp với bộ lọc'}
                description="Thử từ khóa ngắn hơn, kiểm tra chính tả hoặc bỏ bớt bộ lọc."
                action={
                  <div className="flex flex-wrap justify-center gap-4">
                    {hasAnyCriteria ? <button type="button" onClick={clearAll} className="font-semibold text-indigo-700 hover:underline dark:text-indigo-300">Xóa tìm kiếm và bộ lọc</button> : null}
                    <Link to="/categories" className="font-semibold text-indigo-700 hover:underline dark:text-indigo-300">Duyệt theo thể loại</Link>
                  </div>
                }
              />
            ) : result ? (
              <>
                <ul className={cn('grid grid-cols-2 gap-x-4 gap-y-8 transition-opacity sm:grid-cols-3 xl:grid-cols-4', loading && 'opacity-60')} aria-busy={loading}>
                  {result.data.map((book) => (
                    <li key={book.id}><PublicBookCard book={book} onReserve={requestReserve} /></li>
                  ))}
                </ul>
                <Pagination page={result.meta.page} totalPages={result.meta.totalPages} onPage={goToPage} />
              </>
            ) : null}
          </div>
        </div>

        {filtersOpen ? (
          <div className="fixed inset-0 z-40 lg:hidden" onClick={() => setFiltersOpen(false)}>
            <div className="absolute inset-0 bg-black/30" />
            <div
              ref={sheetRef}
              role="dialog"
              aria-modal="true"
              aria-label="Bộ lọc"
              onClick={(event) => event.stopPropagation()}
              className="absolute inset-x-0 bottom-0 flex max-h-[85vh] flex-col rounded-t-2xl border-t border-border bg-background"
            >
              <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
                <h2 className="text-[15px] font-semibold">Bộ lọc</h2>
                <button type="button" onClick={() => setFiltersOpen(false)} aria-label="Đóng bộ lọc" className="rounded-md p-1.5 text-muted-foreground hover:bg-muted">
                  <X className="h-5 w-5" aria-hidden="true" />
                </button>
              </div>
              <div className="overflow-y-auto px-5 py-4">{filterPanel}</div>
              <div className="border-t border-border px-5 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
                <button type="button" onClick={() => setFiltersOpen(false)} className="h-11 w-full rounded-md bg-indigo-700 text-[14px] font-semibold text-white dark:bg-indigo-500">
                  {result ? `Xem ${result.meta.total} đầu sách` : 'Xem kết quả'}
                </button>
              </div>
            </div>
          </div>
        ) : null}

        <ReserveModal book={target} onClose={closeReserve} onSuccess={() => { closeReserve(); setReloadKey((key) => key + 1); }} />
      </div>
    </>
  );
}
