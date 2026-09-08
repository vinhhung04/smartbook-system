import { useCallback, useEffect, useState } from 'react';
import { Bell, RefreshCw, CheckCheck } from 'lucide-react';
import { customerBorrowService } from '@/services/customer-borrow';
import { getApiErrorMessage } from '@/services/api';
import { SectionCard } from '@/components/ui/section-card';
import { EmptyState } from '@/components/ui/empty-state';
import { LoadingOverlay } from '@/components/ui/loading-state';
import { NotificationListItem } from './_shared/notification-list-item';
import { toast } from 'sonner';

const PAGE_SIZE = 20;

export function CustomerNotificationsPage() {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'ALL' | 'UNREAD' | 'READ'>('ALL');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  const loadNotifications = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await customerBorrowService.getMyNotifications({ page, pageSize: PAGE_SIZE });
      setRows(Array.isArray(response?.data) ? response.data : []);
      setTotalPages(response?.meta?.totalPages || 1);
    } catch (err) {
      setError(getApiErrorMessage(err, 'Không tải được thông báo'));
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => { void loadNotifications(); }, [loadNotifications]);

  const filteredRows = rows.filter((row) => {
    if (filter === 'UNREAD') return !row.read_at;
    if (filter === 'READ') return Boolean(row.read_at);
    return true;
  });

  const unreadRows = filteredRows.filter((row) => !row.read_at);
  const readRows = filteredRows.filter((row) => Boolean(row.read_at));

  return (
    <div className="p-6 lg:p-8 max-w-4xl mx-auto space-y-6">
      {/* Hero */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-100 to-cyan-50 dark:from-indigo-950/40 dark:to-cyan-950/20 flex items-center justify-center border border-indigo-200/40 dark:border-indigo-800/40">
            <Bell className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Thông báo của tôi</h1>
            <p className="text-[13px] text-muted-foreground">Nhắc nhở, cập nhật và cảnh báo tài khoản</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={async () => {
            try {
              await customerBorrowService.markAllNotificationsRead();
              setRows((prev) => prev.map((r) => ({ ...r, read_at: r.read_at || new Date().toISOString() })));
              toast.success('Đã đánh dấu tất cả là đã đọc');
            } catch (err) { toast.error(getApiErrorMessage(err, 'Thất bại')); }
          }} disabled={loading || rows.every((r) => r.read_at)}
            className="inline-flex items-center gap-1.5 h-9 rounded-xl border border-input bg-card px-3 text-[12px] text-muted-foreground hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950/20 transition-colors disabled:opacity-50">
            <CheckCheck className="w-3.5 h-3.5" />
            Đánh dấu đã đọc tất cả
          </button>
          <button onClick={() => void loadNotifications()} disabled={loading}
            className="inline-flex items-center gap-1.5 h-9 rounded-xl border border-input bg-card px-3 text-[12px] text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-50">
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Làm mới
          </button>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="flex items-center gap-2">
        {(['ALL', 'UNREAD', 'READ'] as const).map((f) => (
          <button key={f} onClick={() => setFilter(f)} className={`inline-flex items-center gap-1.5 h-8 rounded-lg px-3 text-[12px] font-medium transition-colors ${
            filter === f
              ? 'bg-primary text-primary-foreground'
              : 'bg-card border border-input text-muted-foreground hover:bg-muted hover:text-foreground'
          }`}>
            {f === 'ALL' ? 'Tất cả' : f === 'UNREAD' ? 'Chưa đọc' : 'Đã đọc'}
            {f === 'UNREAD' && unreadRows.length > 0 && (
              <span className="ml-1 inline-flex h-4 w-4 items-center justify-center rounded-full bg-rose-500 text-[10px] text-white">{unreadRows.length}</span>
            )}
          </button>
        ))}
      </div>

      {/* Content */}
      {loading ? (
        <LoadingOverlay />
      ) : error ? (
        <EmptyState variant="error" title="Không tải được thông báo" description={error} action={<button onClick={() => void loadNotifications()} className="text-primary font-medium hover:underline">Thử lại</button>} />
      ) : filteredRows.length === 0 ? (
        <EmptyState variant="inbox" title="Không có thông báo" description={filter === 'ALL' ? 'Bạn đã đọc hết! Kiểm tra lại sau để xem nhắc nhở và cập nhật tài khoản.' : `Không có thông báo ${filter === 'UNREAD' ? 'chưa đọc' : 'đã đọc'}.`} />
      ) : (
        <div className="space-y-3">
          {unreadRows.length > 0 && (
            <div>
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Chưa đọc ({unreadRows.length})</p>
              <div className="space-y-2">
                {unreadRows.map((row) => (
                  <NotificationListItem key={row.id} item={row} />
                ))}
              </div>
            </div>
          )}
          {readRows.length > 0 && (
            <div>
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Đã đọc ({readRows.length})</p>
              <div className="space-y-2">
                {readRows.map((row) => (
                  <NotificationListItem key={row.id} item={row} />
                ))}
              </div>
            </div>
          )}
          {totalPages > 1 && (
            <div className="flex items-center justify-between pt-2 text-[12px] text-muted-foreground">
              <span>Trang {page} / {totalPages}</span>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  className="px-3 py-1 rounded border border-input text-indigo-600 dark:text-indigo-400 cursor-pointer hover:bg-indigo-50 dark:hover:bg-indigo-500/10 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
                >
                  Trước
                </button>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                  className="px-3 py-1 rounded border border-input text-indigo-600 dark:text-indigo-400 cursor-pointer hover:bg-indigo-50 dark:hover:bg-indigo-500/10 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
                >
                  Tiếp
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
