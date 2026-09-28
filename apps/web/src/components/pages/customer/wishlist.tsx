import { useEffect, useState, useCallback } from 'react';
import { NavLink } from 'react-router';
import { motion } from 'motion/react';
import { Trash2 } from 'lucide-react';
import { Bell, BellOff } from 'lucide'; // icon data (not components) — MorphIcon needs this, not lucide-react
import { MorphIcon } from 'morphicons/react';
import { customerBorrowService } from '@/services/customer-borrow';
import { getApiErrorMessage } from '@/services/api';
import { EmptyState } from '@/components/ui/empty-state';
import { cn } from '@/components/ui/utils';
import { toast } from 'sonner';
import { CustomerPageHeader } from './_shared/customer-page-header';
import { BookCoverPlaceholder } from './_shared/book-cover-placeholder';

interface WishlistItem {
  id: string;
  book_id: string;
  created_at: string;
  book_title?: string;
  book_author?: string;
  book_quantity?: number;
}

export function CustomerWishlistPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<WishlistItem[]>([]);
  const [alerts, setAlerts] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [wishResp, alertResp] = await Promise.allSettled([
        customerBorrowService.getMyWishlist(),
        customerBorrowService.getMyAvailabilityAlerts(),
      ]);
      if (wishResp.status === 'fulfilled') {
        setItems(Array.isArray(wishResp.value?.data) ? wishResp.value.data : []);
      } else {
        setError(getApiErrorMessage(wishResp.reason, 'Không tải được danh sách yêu thích'));
      }
      if (alertResp.status === 'fulfilled') {
        const alertList = Array.isArray(alertResp.value?.data) ? alertResp.value.data : [];
        setAlerts(new Set(alertList.filter((a: any) => a.status === 'ACTIVE').map((a: any) => a.book_id)));
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const handleRemove = async (bookId: string) => {
    try {
      await customerBorrowService.removeFromWishlist(bookId);
      setItems((prev) => prev.filter((i) => i.book_id !== bookId));
      toast.success('Đã xóa khỏi danh sách yêu thích');
    } catch { toast.error('Không thể xóa'); }
  };

  const toggleAlert = async (bookId: string) => {
    try {
      if (alerts.has(bookId)) {
        await customerBorrowService.unsubscribeAvailabilityAlert(bookId);
        setAlerts((prev) => { const n = new Set(prev); n.delete(bookId); return n; });
        toast.success('Đã tắt thông báo');
      } else {
        await customerBorrowService.subscribeAvailabilityAlert(bookId);
        setAlerts((prev) => new Set(prev).add(bookId));
        toast.success('Sẽ thông báo khi sách có hàng');
      }
    } catch { toast.error('Thao tác thất bại'); }
  };

  return (
    <div className="mx-auto max-w-4xl space-y-5 p-4 sm:p-6 lg:p-8">
      <CustomerPageHeader
        title="Sách yêu thích"
        subtitle={loading ? 'Đang tải...' : `${items.length} sách trong danh sách của bạn`}
      />

      {loading ? (
        <div className="space-y-3" aria-busy="true">
          {[0, 1, 2].map((i) => <div key={i} className="h-24 animate-pulse rounded-xl border bg-card" />)}
        </div>
      ) : error ? (
        <EmptyState
          variant="error"
          title="Không tải được danh sách yêu thích"
          description={error}
          action={<button onClick={() => void load()} className="font-medium text-primary hover:underline">Thử lại</button>}
        />
      ) : items.length === 0 ? (
        <EmptyState
          variant="no-data"
          title="Chưa có sách yêu thích"
          description="Thêm sách vào danh sách từ danh mục để theo dõi và được báo khi sách có hàng."
          action={<NavLink to="/customer/books" className="font-medium text-primary hover:underline">Xem danh mục sách</NavLink>}
        />
      ) : (
        <ul className="space-y-3">
          {items.map((item, i) => {
            const title = item.book_title || 'Sách chưa xác định';
            const inStock = Number(item.book_quantity ?? 0) > 0;
            const watching = alerts.has(item.book_id);
            return (
              <motion.li
                key={item.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(i, 8) * 0.04 }}
                className="flex items-center gap-3 rounded-xl border border-border bg-card p-3.5 transition-shadow hover:shadow-md sm:gap-4 sm:p-4"
              >
                <div className="w-12 shrink-0 sm:w-14">
                  <BookCoverPlaceholder title={title} />
                </div>
                <div className="min-w-0 flex-1">
                  <NavLink to={`/customer/books/${item.book_id}`} className="block truncate text-[14px] font-bold text-foreground hover:text-indigo-600 dark:hover:text-indigo-400" title={title}>
                    {title}
                  </NavLink>
                  <p className="truncate text-[12px] text-muted-foreground">{item.book_author || 'Không rõ tác giả'}</p>
                  <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px]">
                    <span className={cn('font-semibold', inStock ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400')}>
                      {inStock ? 'Còn sách' : 'Hết sách'}
                    </span>
                    <span className="text-muted-foreground">Thêm {new Date(item.created_at).toLocaleDateString('vi-VN')}</span>
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <button
                    onClick={() => void toggleAlert(item.book_id)}
                    aria-pressed={watching}
                    aria-label={watching ? `Tắt báo khi có hàng: ${title}` : `Báo khi có hàng: ${title}`}
                    title={watching ? 'Đang bật báo khi có hàng — bấm để tắt' : 'Báo cho tôi khi sách có hàng'}
                    className={cn(
                      'inline-flex h-9 items-center gap-1.5 rounded-lg border px-2.5 text-[12px] font-medium transition-colors',
                      watching
                        ? 'border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100 dark:border-amber-500/20 dark:bg-amber-950/30 dark:text-amber-400'
                        : 'border-border bg-card text-muted-foreground hover:bg-muted',
                    )}
                  >
                    <MorphIcon icon={watching ? Bell : BellOff} className="h-4 w-4" />
                    <span className="hidden sm:inline">{watching ? 'Đang theo dõi' : 'Báo khi có hàng'}</span>
                  </button>
                  <button
                    onClick={() => void handleRemove(item.book_id)}
                    aria-label={`Xóa khỏi yêu thích: ${title}`}
                    title="Xóa khỏi yêu thích"
                    className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-rose-200 bg-rose-50 text-rose-600 transition-colors hover:bg-rose-100 dark:border-rose-500/20 dark:bg-rose-950/30 dark:text-rose-400"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </motion.li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
