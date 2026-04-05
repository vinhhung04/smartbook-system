import { useEffect, useState, useCallback } from 'react';
import { NavLink } from 'react-router';
import { motion } from 'motion/react';
import { Heart, BookOpen, Trash2, Loader2, Bell, BellOff } from 'lucide-react';
import { customerBorrowService } from '@/services/customer-borrow';
import { toast } from 'sonner';

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
  const [items, setItems] = useState<WishlistItem[]>([]);
  const [alerts, setAlerts] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const [wishResp, alertResp] = await Promise.allSettled([
        customerBorrowService.getMyWishlist(),
        customerBorrowService.getMyAvailabilityAlerts(),
      ]);
      if (wishResp.status === 'fulfilled') {
        setItems(Array.isArray(wishResp.value?.data) ? wishResp.value.data : []);
      }
      if (alertResp.status === 'fulfilled') {
        const alertList = Array.isArray(alertResp.value?.data) ? alertResp.value.data : [];
        setAlerts(new Set(alertList.filter((a: any) => a.status === 'ACTIVE').map((a: any) => a.book_id)));
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const handleRemove = async (bookId: string) => {
    try {
      await customerBorrowService.removeFromWishlist(bookId);
      setItems(prev => prev.filter(i => i.book_id !== bookId));
      toast.success('Đã xóa khỏi danh sách yêu thích');
    } catch { toast.error('Không thể xóa'); }
  };

  const toggleAlert = async (bookId: string) => {
    try {
      if (alerts.has(bookId)) {
        await customerBorrowService.unsubscribeAvailabilityAlert(bookId);
        setAlerts(prev => { const n = new Set(prev); n.delete(bookId); return n; });
        toast.success('Đã tắt thông báo');
      } else {
        await customerBorrowService.subscribeAvailabilityAlert(bookId);
        setAlerts(prev => new Set(prev).add(bookId));
        toast.success('Sẽ thông báo khi sách có hàng');
      }
    } catch { toast.error('Thao tác thất bại'); }
  };

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-rose-500 to-pink-600 flex items-center justify-center shadow-lg shadow-rose-500/20">
          <Heart className="w-5 h-5 text-white fill-white" />
        </div>
        <div>
          <h1 className="text-[20px] tracking-[-0.02em]" style={{ fontWeight: 700 }}>Sách yêu thích</h1>
          <p className="text-[12px] text-slate-400">{items.length} sách trong danh sách</p>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-6 h-6 text-indigo-400 animate-spin" />
        </div>
      ) : items.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-xl border">
          <Heart className="w-10 h-10 text-rose-200 mx-auto mb-3" />
          <p className="text-[14px] text-slate-500" style={{ fontWeight: 550 }}>Chưa có sách yêu thích</p>
          <p className="text-[12px] text-slate-400 mt-1">Thêm sách vào danh sách từ trang Catalog</p>
          <NavLink to="/customer/books" className="inline-flex items-center gap-1.5 mt-4 px-4 py-2 rounded-lg bg-indigo-600 text-white text-[13px] hover:bg-indigo-700 transition-all" style={{ fontWeight: 550 }}>
            <BookOpen className="w-4 h-4" /> Xem danh mục sách
          </NavLink>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((item, i) => (
            <motion.div key={item.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}
              className="bg-white rounded-xl border p-4 flex items-center gap-4 hover:shadow-md transition-all">
              <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-indigo-100 to-violet-100 flex items-center justify-center shrink-0">
                <BookOpen className="w-6 h-6 text-indigo-500" />
              </div>
              <div className="flex-1 min-w-0">
                <NavLink to={`/customer/books/${item.book_id}`} className="text-[14px] text-slate-800 hover:text-indigo-600 transition-colors truncate block" style={{ fontWeight: 600 }}>
                  {item.book_title || `Book ${item.book_id.slice(0, 8)}`}
                </NavLink>
                <p className="text-[12px] text-slate-400">{item.book_author || 'Unknown'} · Thêm {new Date(item.created_at).toLocaleDateString('vi-VN')}</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button onClick={() => toggleAlert(item.book_id)}
                  className={`w-8 h-8 rounded-lg flex items-center justify-center transition-all ${alerts.has(item.book_id) ? 'bg-amber-50 text-amber-600 hover:bg-amber-100' : 'bg-slate-50 text-slate-400 hover:bg-slate-100'}`}
                  title={alerts.has(item.book_id) ? 'Tắt thông báo có hàng' : 'Báo khi có hàng'}>
                  {alerts.has(item.book_id) ? <Bell className="w-4 h-4" /> : <BellOff className="w-4 h-4" />}
                </button>
                <button onClick={() => handleRemove(item.book_id)}
                  className="w-8 h-8 rounded-lg flex items-center justify-center bg-rose-50 text-rose-500 hover:bg-rose-100 transition-all">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}
