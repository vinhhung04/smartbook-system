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
import { BookOpen, RefreshCw } from 'lucide-react';

export function CustomerCatalogPage() {
  const navigate = useNavigate();
  const [books, setBooks] = useState<CustomerCatalogBook[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reservingBookId, setReservingBookId] = useState<string | null>(null);
  const [previewBook, setPreviewBook] = useState<CustomerCatalogBook | null>(null);
  const [search, setSearch] = useState('');
  const [availability, setAvailability] = useState<'available' | 'unavailable' | ''>('');

  const loadBooks = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await customerCatalogService.getBooks({ search, availability });
      setBooks(data);
    } catch (err) {
      setError(getApiErrorMessage(err, 'Failed to load catalog'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadBooks();
  }, [search, availability]);

  const stats = useMemo(() => ({
    total: books.length,
    available: books.filter((b) => Number(b.quantity || 0) > 0).length,
    unavailable: books.filter((b) => Number(b.quantity || 0) <= 0).length,
  }), [books]);

  const handleReserve = async (book: CustomerCatalogBook) => {
    if (!book.variant_id || !book.default_warehouse_id) {
      toast.error('Book is not reservable right now');
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
      toast.success('Reservation created successfully');
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Failed to reserve this book'));
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
          <h1 className="text-[22px] tracking-tight text-white" style={{ fontWeight: 700 }}>Browse the Catalog</h1>
          <p className="text-white/65 text-[13px] mt-1">Discover titles, preview details, and reserve in one click.</p>
        </div>
      </motion.div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Total Titles', value: stats.total, variant: 'default' as const },
          { label: 'Available', value: stats.available, variant: 'success' as const },
          { label: 'Out of Stock', value: stats.unavailable, variant: 'danger' as const },
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
        searchPlaceholder="Search by title, author, ISBN..."
        filters={
          <>
            <select
              value={availability}
              onChange={(e) => setAvailability(e.target.value as 'available' | 'unavailable' | '')}
              className="h-9 rounded-xl border border-input bg-background px-3 text-[13px] text-foreground outline-none focus:ring-2 focus:ring-primary/10"
            >
              <option value="">All availability</option>
              <option value="available">Available</option>
              <option value="unavailable">Out of stock</option>
            </select>
            <select
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="hidden"
            >
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
            Refresh
          </button>
        }
      />

      {/* Catalog Grid */}
      <SectionCard noPadding className="!rounded-xl overflow-hidden">
        <div className="px-5 py-3 border-b border-border bg-muted/20">
          <p className="text-[12px] text-muted-foreground font-medium">
            Showing {stats.total} title{stats.total !== 1 ? 's' : ''} — {stats.available} available
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
            title="Failed to load catalog"
            description={error}
            action={
              <button onClick={() => void loadBooks()} className="text-primary font-medium hover:underline">
                Try again
              </button>
            }
          />
        ) : books.length === 0 ? (
          <EmptyState
            variant="no-results"
            title="No books found"
            description="Try adjusting your search or filters to find what you're looking for."
            action={
              <button
                onClick={() => { setSearch(''); setAvailability(''); }}
                className="text-primary font-medium hover:underline"
              >
                Clear all filters
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
        title={previewBook?.title || 'Book preview'}
        onClose={() => setPreviewBook(null)}
      >
        {previewBook ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[13px] text-muted-foreground">{previewBook.author || 'Unknown author'}</p>
              <StatusBadge
                label={Number(previewBook.quantity || 0) > 0 ? 'Available' : 'Out of Stock'}
                variant={Number(previewBook.quantity || 0) > 0 ? 'success' : 'destructive'}
              />
            </div>
            <div className="rounded-xl border border-border bg-muted/30 p-4 space-y-2">
              <p className="text-[12px]"><span className="text-muted-foreground">Category:</span> {previewBook.category || '-'}</p>
              <p className="text-[12px]"><span className="text-muted-foreground">ISBN:</span> {previewBook.isbn || '-'}</p>
              <p className="text-[12px]"><span className="text-muted-foreground">Stock:</span> {previewBook.quantity || 0} available</p>
            </div>
            <p className="text-[12px] text-muted-foreground">{previewBook.description || 'No description available.'}</p>

            <div className="flex items-center gap-2 pt-2">
              <button
                onClick={() => void handleReserve(previewBook)}
                disabled={reservingBookId === previewBook.id || Number(previewBook.quantity || 0) <= 0}
                className="flex-1 rounded-xl bg-primary text-primary-foreground px-4 py-2.5 text-[13px] font-semibold hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {reservingBookId === previewBook.id ? 'Reserving...' : Number(previewBook.quantity || 0) <= 0 ? 'Out of Stock' : 'Reserve Now'}
              </button>
              <button
                onClick={() => navigate(`/customer/books/${previewBook.id}`)}
                className="rounded-xl border border-input bg-background px-4 py-2.5 text-[13px] text-foreground hover:bg-muted transition-colors"
              >
                Details
              </button>
            </div>
          </div>
        ) : null}
      </DetailDrawer>
    </div>
  );
}
