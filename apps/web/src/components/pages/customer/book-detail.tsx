import { useEffect, useState } from 'react';
import { NavLink, useParams } from 'react-router';
import { motion } from 'motion/react';
import { customerCatalogService, CustomerCatalogBook } from '@/services/customer-catalog';
import { getApiErrorMessage } from '@/services/api';
import { customerBorrowService } from '@/services/customer-borrow';
import { toast } from 'sonner';
import { EmptyState } from '@/components/ui/empty-state';
import { LoadingOverlay } from '@/components/ui/loading-state';
import { StatusBadge } from '@/components/ui/status-badge';
import { BookOpen, MapPin, ShoppingCart, Star, Calendar, ChevronRight } from 'lucide-react';

export function CustomerBookDetailPage() {
  const { id } = useParams();
  const [book, setBook] = useState<CustomerCatalogBook | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isReserving, setIsReserving] = useState(false);

  useEffect(() => {
    const run = async () => {
      if (!id) return;
      try {
        setLoading(true);
        setError(null);
        const data = await customerCatalogService.getBookById(id);
        setBook(data);
      } catch (err) {
        setError(getApiErrorMessage(err, 'Failed to load book detail'));
      } finally {
        setLoading(false);
      }
    };
    void run();
  }, [id]);

  const handleReserve = async () => {
    if (!book?.variant_id || !book?.default_warehouse_id) {
      toast.error('Book is not reservable right now');
      return;
    }
    try {
      setIsReserving(true);
      await customerBorrowService.createReservation({
        variant_id: book.variant_id,
        warehouse_id: book.default_warehouse_id,
        pickup_location_id: book.default_location_id || null,
        quantity: 1,
      });
      toast.success('Reservation created successfully!');
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Failed to create reservation'));
    } finally {
      setIsReserving(false);
    }
  };

  if (loading) return <LoadingOverlay />;
  if (error) return (
    <div className="p-6 lg:p-8 max-w-4xl mx-auto">
      <EmptyState variant="error" title="Failed to load book" description={error}
        action={<button onClick={() => window.location.reload()} className="text-primary font-medium hover:underline">Try again</button>} />
    </div>
  );
  if (!book) return (
    <div className="p-6 lg:p-8 max-w-4xl mx-auto">
      <EmptyState variant="no-data" title="Book not found" description="This book may no longer be available in the catalog."
        action={<NavLink to="/customer/books" className="text-primary font-medium hover:underline">Back to catalog</NavLink>} />
    </div>
  );

  const isAvailable = Number(book.quantity || 0) > 0;
  const isReservable = book.reservable && isAvailable;

  return (
    <div className="p-6 lg:p-8 max-w-4xl mx-auto space-y-6">
      {/* Breadcrumb */}
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}>
        <NavLink to="/customer/books" className="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground hover:text-foreground transition-colors">
          <ChevronRight className="w-3.5 h-3.5 rotate-180" />
          Back to Catalog
        </NavLink>
      </motion.div>

      {/* Hero Section */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.05, duration: 0.3 }}
        className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-indigo-600 via-blue-600 to-violet-600 p-6 shadow-xl shadow-indigo-500/20"
      >
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_85%_15%,rgba(255,255,255,0.1),transparent_50%)]" />
        <div className="absolute top-0 right-0 w-60 h-60 bg-white/5 rounded-full -translate-y-1/2 translate-x-1/3" />
        <div className="relative flex items-center gap-4">
          <div>
            <h1 className="text-[22px] tracking-tight text-white" style={{ fontWeight: 700 }}>{book.title}</h1>
            {book.subtitle && <p className="text-white/65 text-[13px] mt-0.5">{book.subtitle}</p>}
            <div className="flex items-center gap-3 mt-3 text-white/80 text-[12px]">
              {book.author && <span>{book.author}</span>}
              {book.publisher && <><span className="text-white/30">|</span><span>{book.publisher}</span></>}
              {book.publish_year && <><span className="text-white/30">|</span><span>{book.publish_year}</span></>}
            </div>
          </div>
          <div className="ml-auto shrink-0">
            <button
              onClick={() => void handleReserve()}
              disabled={!isReservable || isReserving}
              className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-white text-indigo-700 text-[13px] font-semibold shadow-lg hover:shadow-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <ShoppingCart className="w-4 h-4" />
              {isReserving ? 'Reserving...' : 'Reserve Now'}
            </button>
          </div>
        </div>
      </motion.div>

      {/* Content */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Left: Cover + Metadata */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1, duration: 0.3 }}
          className="md:col-span-1 space-y-4"
        >
          {/* Cover Image */}
          <div className="rounded-2xl border border-black/5 bg-card overflow-hidden shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
            {book.cover_image_url ? (
              <img src={book.cover_image_url} alt={book.title} className="w-full h-auto object-cover" />
            ) : (
              <div className="aspect-[2/3] bg-gradient-to-br from-indigo-100 via-blue-50 to-cyan-50 flex items-center justify-center">
                <div className="text-center p-6">
                  <BookOpen className="w-12 h-12 text-indigo-300 mx-auto mb-3" />
                  <p className="text-[12px] text-indigo-400">{book.category || 'Book'}</p>
                </div>
              </div>
            )}
          </div>

          {/* Availability Status */}
          <div className={`rounded-xl border px-4 py-3 flex items-center gap-3 ${
            isAvailable
              ? 'bg-emerald-50 border-emerald-100'
              : 'bg-rose-50 border-rose-100'
          }`}>
            <div className={`w-2.5 h-2.5 rounded-full ${isAvailable ? 'bg-emerald-500' : 'bg-rose-500'}`} />
            <div>
              <p className={`text-[13px] font-semibold ${isAvailable ? 'text-emerald-700' : 'text-rose-700'}`}>
                {isAvailable ? 'Available for Reservation' : 'Out of Stock'}
              </p>
              <p className={`text-[11px] ${isAvailable ? 'text-emerald-600' : 'text-rose-600'}`}>
                {isAvailable ? `${book.quantity || 0} copies in stock` : 'Currently unavailable'}
              </p>
            </div>
          </div>

          {/* Metadata */}
          <div className="rounded-xl border border-black/5 bg-card p-5 space-y-3 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
            <h3 className="text-[13px] font-semibold text-foreground">Book Details</h3>
            {[
              { label: 'Author', value: book.author || '-' },
              { label: 'Category', value: book.category || '-' },
              { label: 'Publisher', value: book.publisher || '-' },
              { label: 'ISBN', value: book.isbn || '-', mono: true },
              { label: 'Language', value: book.language || 'vi' },
              { label: 'In Stock', value: `${book.quantity || 0} copies` },
            ].map((meta) => (
              <div key={meta.label} className="flex items-start justify-between gap-3 text-[12px]">
                <span className="text-muted-foreground shrink-0">{meta.label}</span>
                <span className={`text-foreground text-right ${meta.mono ? 'font-mono' : ''}`} style={{ fontWeight: 500 }}>{meta.value}</span>
              </div>
            ))}
          </div>
        </motion.div>

        {/* Right: Description + Summary */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15, duration: 0.3 }}
          className="md:col-span-2 space-y-5"
        >
          {/* Description */}
          <div className="rounded-xl border border-black/5 bg-card p-5 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
            <h3 className="text-[14px] font-semibold mb-3">About this book</h3>
            {book.description ? (
              <p className="text-[13px] text-muted-foreground leading-relaxed whitespace-pre-line">{book.description}</p>
            ) : (
              <p className="text-[13px] text-muted-foreground italic">No description available for this book.</p>
            )}
          </div>

          {/* AI Summary */}
          {book.summary_vi && (
            <div className="rounded-xl border border-cyan-100 bg-gradient-to-br from-cyan-50/60 to-blue-50/40 p-5 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
              <div className="flex items-center gap-2 mb-3">
                <Star className="w-4 h-4 text-cyan-600" />
                <h3 className="text-[14px] font-semibold text-cyan-800">AI Summary</h3>
              </div>
              <p className="text-[13px] text-cyan-900 leading-relaxed whitespace-pre-line">{book.summary_vi}</p>
            </div>
          )}

          {/* Reserve CTA */}
          <div className="rounded-xl border border-indigo-100 bg-gradient-to-br from-indigo-50/60 to-violet-50/40 p-5">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-indigo-100 flex items-center justify-center shrink-0 mt-0.5">
                <ShoppingCart className="w-5 h-5 text-indigo-600" />
              </div>
              <div className="flex-1">
                <h3 className="text-[14px] font-semibold text-foreground mb-1">Reserve this book</h3>
                <p className="text-[12px] text-muted-foreground leading-relaxed mb-3">
                  {isAvailable
                    ? 'This book is available. Click below to create a reservation for pickup at your nearest library location.'
                    : 'This book is currently out of stock. Please check back later or browse other titles.'}
                </p>
                <button
                  onClick={() => void handleReserve()}
                  disabled={!isReservable || isReserving}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary text-primary-foreground text-[13px] font-semibold hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  <ShoppingCart className="w-4 h-4" />
                  {isReserving ? 'Creating reservation...' : 'Reserve Now'}
                </button>
              </div>
            </div>
          </div>

          {/* Info Note */}
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
            <p className="text-[12px] text-amber-700 leading-relaxed">
              <strong>Note:</strong> Reservations are held for a limited time. Pick up your book at the designated library location within the hold period. Late pickup may result in reservation cancellation.
            </p>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
