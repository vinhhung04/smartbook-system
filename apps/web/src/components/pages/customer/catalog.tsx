import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { motion } from 'motion/react';
import { customerCatalogService, CustomerCatalogBook } from '@/services/customer-catalog';
import { customerBorrowService } from '@/services/customer-borrow';
import { getApiErrorMessage } from '@/services/api';
import { toast } from 'sonner';
import { EmptyState } from '@/components/ui/empty-state';
import { SectionCard } from '@/components/ui/section-card';
import { FilterBar } from '@/components/ui/filter-bar';
import { BookCard } from './_shared/book-card';
import { DetailDrawer } from './_shared/detail-drawer';
import { StatusBadge } from '@/components/ui/status-badge';
import { BookOpen, RefreshCw, Star } from 'lucide-react';

type RatingMap = Record<string, { averageRating: number; totalReviews: number }>;

export function CustomerCatalogPage() {
  const navigate = useNavigate();
  const [books, setBooks] = useState<CustomerCatalogBook[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reservingBookId, setReservingBookId] = useState<string | null>(null);
  const [previewBook, setPreviewBook] = useState<CustomerCatalogBook | null>(null);
  const [search, setSearch] = useState('');
  const [availability, setAvailability] = useState<'available' | 'unavailable' | ''>('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [authorFilter, setAuthorFilter] = useState('');
  const [ratingsMap, setRatingsMap] = useState<RatingMap>({});
  const [allCategories, setAllCategories] = useState<string[]>([]);
  const [allAuthors, setAllAuthors] = useState<string[]>([]);

  const loadBooks = async () => {
    try {
      setLoading(true);
      setError(null);
      const params: Record<string, string> = {};
      if (search) params.search = search;
      if (availability) params.availability = availability;
      if (categoryFilter) params.category = categoryFilter;
      if (authorFilter) params.author = authorFilter;
      const data = await customerCatalogService.getBooks(params);
      setBooks(data);

      const cats = [...new Set(data.map((b: any) => b.category).filter(Boolean))].sort();
      const authors = [...new Set(data.map((b: any) => b.author).filter(Boolean))].sort();
      if (!categoryFilter && !authorFilter) {
        setAllCategories(cats as string[]);
        setAllAuthors(authors as string[]);
      }

      if (data.length > 0) {
        try {
          const ids = data.map((b) => b.id);
          const res = await customerBorrowService.getBookRatingStats(ids);
          setRatingsMap(res.data || {});
        } catch { /* ratings are optional */ }
      }
    } catch (err) {
      setError(getApiErrorMessage(err, 'Không tải được danh mục sách'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadBooks();
  }, [search, availability, categoryFilter, authorFilter]);

  const stats = useMemo(() => ({
    total: books.length,
    available: books.filter((b) => Number(b.quantity || 0) > 0).length,
    unavailable: books.filter((b) => Number(b.quantity || 0) <= 0).length,
  }), [books]);

  const handleReserve = async (book: CustomerCatalogBook) => {
    if (!book.variant_id || !book.default_warehouse_id) {
      toast.error('Sách hiện không thể đặt trước');
      return;
    }

    try {
      setReservingBookId(book.id);
      await customerBorrowService.createReservation({
        variant_id: book.variant_id,
        warehouse_id: book.default_warehouse_id,
        pickup_location_id: book.default_location_id || null,
        quantity: 1,
      });
      toast.success('Đặt trước thành công');
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Đặt trước sách thất bại'));
    } finally {
      setReservingBookId(null);
    }
  };

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
      {/* Hero Banner */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
        className="relative overflow-hidden rounded-2xl border border-indigo-200/60 bg-gradient-to-br from-indigo-600 via-blue-600 to-violet-600 p-6 shadow-xl shadow-indigo-500/15"
      >
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_85%_15%,rgba(255,255,255,0.1),transparent_50%)]" />
        <div className="absolute top-0 right-0 w-64 h-64 bg-white/5 rounded-full -translate-y-1/2 translate-x-1/4" />
        <div className="relative">
          <h1 className="text-[22px] tracking-tight text-white" style={{ fontWeight: 700 }}>Khám phá danh mục sách</h1>
          <p className="text-white/65 text-[13px] mt-1">Tìm kiếm đầu sách, xem chi tiết và đặt trước chỉ một click.</p>
        </div>
      </motion.div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Tổng đầu sách', value: stats.total, variant: 'default' as const },
          { label: 'Còn sách', value: stats.available, variant: 'success' as const },
          { label: 'Hết sách', value: stats.unavailable, variant: 'danger' as const },
        ].map((stat) => (
          <div key={stat.label} className={`rounded-xl border px-4 py-3 flex items-center justify-between ${
            stat.variant === 'success' ? 'bg-emerald-50 border-emerald-100' :
            stat.variant === 'danger' ? 'bg-rose-50 border-rose-100' :
            'bg-indigo-50 border-indigo-100'
          }`}>
            <span className="text-[12px] text-muted-foreground font-medium">{stat.label}</span>
            <span className={`text-[20px] font-bold ${
              stat.variant === 'success' ? 'text-emerald-700' :
              stat.variant === 'danger' ? 'text-rose-700' :
              'text-indigo-700'
            }`}>{stat.value}</span>
          </div>
        ))}
      </div>

      {/* Filters */}
      <FilterBar
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="Tìm theo tên sách, tác giả, ISBN..."
        filters={
          <>
            <select
              value={availability}
              onChange={(e) => setAvailability(e.target.value as 'available' | 'unavailable' | '')}
              className="h-9 rounded-xl border border-input bg-background px-3 text-[13px] text-foreground outline-none focus:ring-2 focus:ring-primary/10"
            >
              <option value="">Tất cả</option>
              <option value="available">Còn sách</option>
              <option value="unavailable">Hết sách</option>
            </select>
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="h-9 rounded-xl border border-input bg-background px-3 text-[13px] text-foreground outline-none focus:ring-2 focus:ring-primary/10"
            >
              <option value="">Tất cả thể loại</option>
              {allCategories.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <select
              value={authorFilter}
              onChange={(e) => setAuthorFilter(e.target.value)}
              className="h-9 rounded-xl border border-input bg-background px-3 text-[13px] text-foreground outline-none focus:ring-2 focus:ring-primary/10 max-w-[180px]"
            >
              <option value="">Tất cả tác giả</option>
              {allAuthors.slice(0, 30).map(a => <option key={a} value={a}>{a}</option>)}
            </select>
          </>
        }
        actions={
          <button
            onClick={() => void loadBooks()}
            disabled={loading}
            className="inline-flex items-center gap-1.5 h-9 rounded-xl border border-input bg-white px-3 text-[12px] text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-50"
            style={{ fontWeight: 500 }}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Làm mới
          </button>
        }
      />

      {/* Catalog Grid */}
      <SectionCard noPadding className="!rounded-xl overflow-hidden">
        <div className="px-5 py-3 border-b border-border bg-muted/20">
          <p className="text-[12px] text-muted-foreground font-medium">
            Hiển thị {stats.total} đầu sách — {stats.available} còn sách
          </p>
        </div>

        {loading ? (
          <div className="p-8">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="rounded-xl border bg-card p-4 animate-pulse space-y-3">
                  <div className="h-40 bg-muted rounded-lg" />
                  <div className="h-4 bg-muted rounded w-3/4" />
                  <div className="h-3 bg-muted rounded w-1/2" />
                </div>
              ))}
            </div>
          </div>
        ) : error ? (
          <EmptyState
            variant="error"
            title="Không tải được danh mục sách"
            description={error}
            action={
              <button onClick={() => void loadBooks()} className="text-primary font-medium hover:underline">
                Thử lại
              </button>
            }
          />
        ) : books.length === 0 ? (
          <EmptyState
            variant="no-results"
            title="Không tìm thấy sách"
            description="Thử điều chỉnh từ khóa hoặc bộ lọc để tìm sách phù hợp."
            action={
              <button
                onClick={() => { setSearch(''); setAvailability(''); }}
                className="text-primary font-medium hover:underline"
              >
                Xóa tất cả bộ lọc
              </button>
            }
          />
        ) : (
          <div className="p-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {books.map((book, index) => (
                <motion.div
                  key={book.id}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: Math.min(index * 0.03, 0.3), duration: 0.25 }}
                >
                  <BookCard
                    book={book}
                    onView={(bookId) => {
                      const found = books.find((row) => row.id === bookId) || null;
                      setPreviewBook(found);
                    }}
                    onReserve={handleReserve}
                    reserving={reservingBookId === book.id}
                    ratingInfo={ratingsMap[book.id] || null}
                  />
                </motion.div>
              ))}
            </div>
          </div>
        )}
      </SectionCard>

      {/* Detail Drawer */}
      <DetailDrawer
        open={Boolean(previewBook)}
        title={previewBook?.title || 'Xem sách'}
        onClose={() => setPreviewBook(null)}
      >
        {previewBook ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[13px] text-muted-foreground">{previewBook.author || 'Không rõ tác giả'}</p>
              <StatusBadge
                label={Number(previewBook.quantity || 0) > 0 ? 'Còn sách' : 'Hết sách'}
                variant={Number(previewBook.quantity || 0) > 0 ? 'success' : 'destructive'}
              />
            </div>
            <div className="rounded-xl border border-border bg-muted/30 p-4 space-y-2">
              <p className="text-[12px]"><span className="text-muted-foreground">Thể loại:</span> {previewBook.category || '-'}</p>
              <p className="text-[12px]"><span className="text-muted-foreground">ISBN:</span> {previewBook.isbn || '-'}</p>
              <p className="text-[12px]"><span className="text-muted-foreground">Tồn kho:</span> {previewBook.quantity || 0} cuốn</p>
            </div>
            <p className="text-[12px] text-muted-foreground">{previewBook.description || 'Chưa có mô tả.'}</p>

            {/* Rating in drawer */}
            {ratingsMap[previewBook.id] && ratingsMap[previewBook.id].totalReviews > 0 && (
              <div className="flex items-center gap-2 rounded-xl border border-amber-100 bg-amber-50/60 px-3 py-2">
                <div className="flex items-center gap-0.5">
                  {[1, 2, 3, 4, 5].map((s) => (
                    <Star
                      key={s}
                      size={13}
                      className={s <= Math.round(ratingsMap[previewBook.id].averageRating) ? 'fill-amber-400 text-amber-400' : 'fill-transparent text-slate-300'}
                    />
                  ))}
                </div>
                <span className="text-[12px] font-semibold text-amber-700">{ratingsMap[previewBook.id].averageRating}</span>
                <span className="text-[11px] text-amber-600">({ratingsMap[previewBook.id].totalReviews} reviews)</span>
              </div>
            )}

            <div className="flex items-center gap-2 pt-2">
              <button
                onClick={() => void handleReserve(previewBook)}
                disabled={reservingBookId === previewBook.id || Number(previewBook.quantity || 0) <= 0}
                className="flex-1 rounded-xl bg-primary text-primary-foreground px-4 py-2.5 text-[13px] font-semibold hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {reservingBookId === previewBook.id ? 'Đang đặt trước...' : Number(previewBook.quantity || 0) <= 0 ? 'Hết sách' : 'Đặt trước ngay'}
              </button>
              <button
                onClick={() => navigate(`/customer/books/${previewBook.id}`)}
                className="rounded-xl border border-input bg-background px-4 py-2.5 text-[13px] text-foreground hover:bg-muted transition-colors"
              >
                Chi tiết
              </button>
            </div>
          </div>
        ) : null}
      </DetailDrawer>
    </div>
  );
}
