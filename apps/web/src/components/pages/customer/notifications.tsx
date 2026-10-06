import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, CheckCheck } from 'lucide-react';
import { customerBorrowService } from '@/services/customer-borrow';
import { getApiErrorMessage } from '@/services/api';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { cn } from '@/components/ui/utils';
import { useSocketEvent } from '@/lib/socket';
import { CustomerPageHeader } from './_shared/customer-page-header';
import { EmptyState } from '@/components/ui/empty-state';
import { NotificationListItem } from './_shared/notification-list-item';
import type { CustomerNotification } from './_shared/notification-item';
import { toast } from 'sonner';

const PAGE_SIZE = 20;
type Filter = 'ALL' | 'UNREAD' | 'READ';
const STATUS_PARAM: Record<Filter, 'unread' | 'read' | undefined> = { ALL: undefined, UNREAD: 'unread', READ: 'read' };

export function CustomerNotificationsPage() {
  const [rows, setRows] = useState<CustomerNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('ALL');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [unreadCount, setUnreadCount] = useState(0);
  const [markingAll, setMarkingAll] = useState(false);

  // Filtering and the unread count come from the server, so they cover every
  // page — not just the 20 rows on screen.
  const loadNotifications = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await customerBorrowService.getMyNotifications({ page, pageSize: PAGE_SIZE, status: STATUS_PARAM[filter] });
      setRows(Array.isArray(response?.data) ? response.data : []);
      setTotalPages(response?.meta?.totalPages || 1);
      setTotal(response?.meta?.total || 0);
      setUnreadCount(Number(response?.meta?.unread_count) || 0);
    } catch (err) {
      setError(getApiErrorMessage(err, 'Không tải được thông báo'));
    } finally {
      setLoading(false);
    }
  }, [page, filter]);

  useEffect(() => { void loadNotifications(); }, [loadNotifications]);

  // A new notification arrives while the page is open: show it if it belongs here.
  useSocketEvent<CustomerNotification>('notification:new', useCallback((data) => {
    setUnreadCount((count) => count + 1);
    if (page === 1 && filter !== 'READ' && data?.id) {
      setRows((prev) => (prev.some((row) => row.id === data.id) ? prev : [{ ...data, read_at: null }, ...prev].slice(0, PAGE_SIZE)));
      setTotal((count) => count + 1);
    }
  }, [page, filter]));

  const handleMarkedRead = useCallback((id: string) => {
    const now = new Date().toISOString();
    setUnreadCount((count) => Math.max(0, count - 1));
    // In the "unread" view a read notification no longer belongs on the list.
    setRows((prev) => (filter === 'UNREAD'
      ? prev.filter((row) => row.id !== id)
      : prev.map((row) => (row.id === id ? { ...row, read_at: row.read_at || now } : row))));
  }, [filter]);

  const markAllRead = async () => {
    try {
      setMarkingAll(true);
      await customerBorrowService.markAllNotificationsRead();
      setUnreadCount(0);
      if (filter === 'UNREAD') setRows([]);
      else setRows((prev) => prev.map((r) => ({ ...r, read_at: r.read_at || new Date().toISOString() })));
      toast.success('Đã đánh dấu tất cả là đã đọc');
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Chưa đánh dấu được thông báo'));
    } finally {
      setMarkingAll(false);
    }
  };

  const changeFilter = (next: Filter) => {
    setFilter(next);
    setPage(1);
  };

  return (
    <div className="mx-auto max-w-3xl space-y-5 p-4 sm:p-6 lg:p-8">
      <CustomerPageHeader
        title="Thông báo"
        subtitle={unreadCount > 0 ? `Bạn có ${unreadCount} thông báo chưa đọc` : 'Nhắc nhở, cập nhật và cảnh báo về tài khoản của bạn'}
        actions={
          <>
            <button
              type="button"
              onClick={() => void markAllRead()}
              disabled={loading || markingAll || unreadCount === 0}
              data-testid="notifications-mark-all-read"
              className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-input bg-card px-3 text-[12px] font-medium text-muted-foreground transition-colors hover:bg-indigo-50 hover:text-indigo-600 disabled:opacity-50 dark:hover:bg-indigo-950/20 dark:hover:text-indigo-400"
            >
              <CheckCheck className="h-3.5 w-3.5" aria-hidden="true" />
              Đọc tất cả
            </button>
            <button
              type="button"
              onClick={() => void loadNotifications()}
              disabled={loading}
              aria-label="Làm mới thông báo"
              className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-input bg-card px-3 text-[12px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
            >
              <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} aria-hidden="true" />
              Làm mới
            </button>
          </>
        }
      />

      <div className="max-w-full overflow-x-auto">
        <SegmentedControl
          layoutId="customer-notifications-filter"
          value={filter}
          onChange={changeFilter}
          options={[
            { value: 'ALL', label: 'Tất cả' },
            { value: 'UNREAD', label: `Chưa đọc (${unreadCount})` },
            { value: 'READ', label: 'Đã đọc' },
          ]}
          className="w-max"
        />
      </div>

      {loading ? (
        <div className="space-y-2" aria-busy="true">
          {[0, 1, 2, 3].map((i) => <div key={i} className="h-16 animate-pulse rounded-xl border bg-card" />)}
        </div>
      ) : error ? (
        <EmptyState variant="error" title="Không tải được thông báo" description={error} action={<button type="button" onClick={() => void loadNotifications()} className="font-medium text-primary hover:underline">Thử lại</button>} />
      ) : rows.length === 0 ? (
        <EmptyState
          variant="inbox"
          title="Không có thông báo"
          description={filter === 'ALL' ? 'Bạn chưa có thông báo nào. Nhắc nhở và cập nhật tài khoản sẽ xuất hiện ở đây.' : `Không có thông báo ${filter === 'UNREAD' ? 'chưa đọc' : 'đã đọc'}.`}
        />
      ) : (
        <div className="space-y-3">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            {filter === 'UNREAD' ? 'Chưa đọc' : filter === 'READ' ? 'Đã đọc' : 'Tất cả'} ({total})
          </p>
          <ul className="space-y-2" data-testid="notification-list">
            {rows.map((row) => (
              <li key={row.id}>
                <NotificationListItem item={row} onMarkedRead={handleMarkedRead} />
              </li>
            ))}
          </ul>
          {totalPages > 1 && (
            <div className="flex items-center justify-between pt-2 text-[12px] text-muted-foreground">
              <span>Trang {page} / {totalPages}</span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  className="px-3 py-1 rounded border border-input text-indigo-600 dark:text-indigo-400 cursor-pointer hover:bg-indigo-50 dark:hover:bg-indigo-500/10 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
                >
                  Trước
                </button>
                <button
                  type="button"
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
