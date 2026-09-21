import { useCallback, useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { RefreshCw } from 'lucide-react';
import { customerCatalogService, CustomerCatalogBook } from '@/services/customer-catalog';
import { customerBorrowService } from '@/services/customer-borrow';
import { getApiErrorMessage } from '@/services/api';
import { EmptyState } from '@/components/ui/empty-state';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { cn } from '@/components/ui/utils';
import { BookCard } from './_shared/book-card';
import { CustomerPageHeader } from './_shared/customer-page-header';
import { SearchFilterBar } from './_shared/search-filter-bar';
import { ReserveModal } from './_shared/reserve-modal';

type RatingMap = Record<string, { averageRating: number; totalReviews: number }>;
type Availability = 'available' | 'unavailable' | '';

const SEARCH_DEBOUNCE_MS = 300;

export function CustomerCatalogPage() {
  const [books, setBooks] = useState<CustomerCatalogBook[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reserveTarget, setReserveTarget] = useState<CustomerCatalogBook | null>(null);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [availability, setAvailability] = useState<Availability>('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [authorFilter, setAuthorFilter] = useState('');
  const [ratingsMap, setRatingsMap] = useState<RatingMap>({});
  const [allCategories, setAllCategories] = useState<string[]>([]);
  const [allAuthors, setAllAuthors] = useState<string[]>([]);

  // Typing used to fire one request per keystroke; wait for a short pause instead.
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [search]);

  const loadBooks = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const params: Record<string, string> = {};
      if (debouncedSearch) params.search = debouncedSearch;
      if (availability) params.availability = availability;
      if (categoryFilter) params.category = categoryFilter;
      if (authorFilter) params.author = authorFilter;
      const data = await customerCatalogService.getBooks(params);
      setBooks(data);

      // Category chips and the author list come from the unfiltered catalog, so they stay put while the user narrows down.
      if (!debouncedSearch && !availability && !categoryFilter && !authorFilter) {
        setAllCategories([...new Set(data.map((b) => b.category).filter(Boolean))].sort() as string[]);
        setAllAuthors([...new Set(data.map((b) => b.author).filter(Boolean))].sort() as string[]);
      }

      if (data.length > 0) {
        try {
          const res = await customerBorrowService.getBookRatingStats(data.map((b) => b.id));
          setRatingsMap(res.data || {});
        } catch { /* ratings are optional */ }
      }
    } catch (err) {
      setError(getApiErrorMessage(err, 'Không tải được danh mục sách'));
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch, availability, categoryFilter, authorFilter]);

  useEffect(() => {
    void loadBooks();
  }, [loadBooks]);

  const reservableCount = useMemo(
    () => books.filter((b) => Number(b.available_quantity ?? b.quantity ?? 0) > 0).length,
    [books],
  );
  const hasFilters = Boolean(search || availability || categoryFilter || authorFilter);

  const clearFilters = () => {
    setSearch('');
    setDebouncedSearch('');
    setAvailability('');
    setCategoryFilter('');
    setAuthorFilter('');
  };

  return (
    <div className="mx-auto max-w-7xl space-y-5 p-4 sm:p-6 lg:p-8">
      <CustomerPageHeader
        title="Danh mục sách"
        subtitle="Tìm sách, xem chi tiết và đặt trước ngay tại đây."
        actions={
          <button
            onClick={() => void loadBooks()}
            disabled={loading}
            className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-input bg-card px-3 text-[12px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
            Làm mới
          </button>
        }
      />

      <SearchFilterBar
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="Tìm theo tên sách, tác giả, ISBN..."
        filters={
          <>
            <div className="max-w-full overflow-x-auto">
              <SegmentedControl
                layoutId="customer-catalog-availability"
                value={availability}
                onChange={(value) => setAvailability(value as Availability)}
                options={[
                  { value: '', label: 'Tất cả' },
                  { value: 'available', label: 'Còn sách' },
                  { value: 'unavailable', label: 'Hết sách' },
                ]}
                className="w-max"
              />
            </div>
            <select
              value={authorFilter}
              onChange={(e) => setAuthorFilter(e.target.value)}
              aria-label="Lọc theo tác giả"
              className="h-9 max-w-[200px] rounded-xl border border-input bg-background px-3 text-[13px] text-foreground outline-none focus:ring-2 focus:ring-primary/10"
            >
              <option value="">Tất cả tác giả</option>
              {allAuthors.slice(0, 30).map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </>
        }
      />

      {allCategories.length > 0 && (
        <div className="-mx-1 overflow-x-auto px-1 pb-1" role="group" aria-label="Lọc theo thể loại">
          <div className="flex w-max items-center gap-2">
            {['', ...allCategories].map((category) => {
              const active = categoryFilter === category;
              return (
                <button
                  key={category || 'all'}
                  type="button"
                  onClick={() => setCategoryFilter(category)}
                  aria-pressed={active}
                  className={cn(
                    'shrink-0 rounded-full border px-3.5 py-1.5 text-[12px] font-medium transition-colors',
                    active
                      ? 'border-indigo-600 bg-indigo-600 text-white'
                      : 'border-border bg-card text-muted-foreground hover:border-indigo-200 hover:text-foreground',
                  )}
                >
                  {category || 'Tất cả thể loại'}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 text-[13px] text-muted-foreground">
        <p>
          <span className="font-semibold text-foreground">{books.length}</span> đầu sách
          {books.length > 0 ? <> · {reservableCount} có thể đặt trước</> : null}
        </p>
        {hasFilters ? (
          <button type="button" onClick={clearFilters} className="font-medium text-primary hover:underline">
            Xóa bộ lọc
          </button>
        ) : null}
      </div>

      {loading ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4 xl:grid-cols-5" aria-busy="true">
          {Array.from({ length: 10 }).map((_, i) => (
            <div key={i} className="animate-pulse space-y-3 rounded-2xl border bg-card p-3">
              <div className="aspect-[4/5] rounded-xl bg-muted" />
              <div className="h-3 w-1/3 rounded bg-muted" />
              <div className="h-4 w-4/5 rounded bg-muted" />
              <div className="h-9 rounded-lg bg-muted" />
            </div>
          ))}
        </div>
      ) : error ? (
        <EmptyState
          variant="error"
          title="Không tải được danh mục sách"
          description={error}
          action={
            <button onClick={() => void loadBooks()} className="font-medium text-primary hover:underline">
              Thử lại
            </button>
          }
        />
      ) : books.length === 0 ? (
        <EmptyState
          variant="no-results"
          title="Không tìm thấy sách"
          description="Thử đổi từ khóa hoặc bộ lọc để tìm sách phù hợp."
          action={
            <button onClick={clearFilters} className="font-medium text-primary hover:underline">
              Xóa tất cả bộ lọc
            </button>
          }
        />
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4 xl:grid-cols-5">
          {books.map((book, index) => (
            <motion.div
              key={book.id}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: Math.min(index * 0.03, 0.3), duration: 0.25 }}
            >
              <BookCard
                book={book}
                onReserve={setReserveTarget}
                ratingInfo={ratingsMap[book.id] || null}
              />
            </motion.div>
          ))}
        </div>
      )}

      <ReserveModal
        book={reserveTarget}
        onClose={() => setReserveTarget(null)}
        onSuccess={() => { setReserveTarget(null); void loadBooks(); }}
      />
    </div>
  );
}
