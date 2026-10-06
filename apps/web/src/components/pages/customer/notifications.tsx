import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, CheckCheck } from 'lucide-react';
import { customerBorrowService } from '@/services/customer-borrow';
import { getApiErrorMessage } from '@/services/api';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { cn } from '@/components/ui/utils';
import { useSocketEvent } from '@/lib/socket';
import {
  applyAllRead,
  applyIncoming,
  applyMarkedRead,
  createRecentIds,
  type NotificationFilter,
  type NotificationListState,
} from '@/lib/notification-state';
import { onUnreadCount, publishUnreadCount } from '@/lib/notification-sync';
import { CustomerPageHeader } from './_shared/customer-page-header';
import { EmptyState } from '@/components/ui/empty-state';
import { NotificationListItem } from './_shared/notification-list-item';
import type { CustomerNotification } from './_shared/notification-item';
import { toast } from 'sonner';

const PAGE_SIZE = 20;
const STATUS_PARAM: Record<NotificationFilter, 'unread' | 'read' | undefined> = { ALL: undefined, UNREAD: 'unread', READ: 'read' };
const EMPTY_LIST: NotificationListState<CustomerNotification> = { rows: [], total: 0, unreadCount: 0, page: 1, totalPages: 1, pageSize: PAGE_SIZE };

export function CustomerNotificationsPage() {
  const [list, setList] = useState(EMPTY_LIST);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<NotificationFilter>('ALL');
  // The page to fetch; list.page is the page on screen (clamped by the state helpers).
  const [requestedPage, setRequestedPage] = useState(1);
  const [reloadKey, setReloadKey] = useState(0);
  const [markingAll, setMarkingAll] = useState(false);
  const [seen] = useState(() => createRecentIds());

  // Filtering, totals and the unread count come from the server, so they cover
  // every page — not just the rows on screen.
  const loadNotifications = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await customerBorrowService.getMyNotifications({ page: requestedPage, pageSize: PAGE_SIZE, status: STATUS_PARAM[filter] });
      const totalPages = response?.meta?.totalPages || 1;
      if (requestedPage > totalPages) {
        // Items disappeared since (e.g. read elsewhere): fall back to the last real page.
        setRequestedPage(totalPages);
        return;
      }
      const unreadCount = Number(response?.meta?.unread_count) || 0;
      setList({
        rows: Array.isArray(response?.data) ? response.data : [],
        total: response?.meta?.total || 0,
        unreadCount,
        page: requestedPage,
        totalPages,
        pageSize: PAGE_SIZE,
      });
      publishUnreadCount(unreadCount);
    } catch (err) {
      setError(getApiErrorMessage(err, 'Không tải được thông báo'));
    } finally {
      setLoading(false);
    }
  }, [requestedPage, filter]);

  useEffect(() => { void loadNotifications(); }, [loadNotifications, reloadKey]);

  // The header bell (or another action) learned a newer server count.
  useEffect(() => onUnreadCount((count) => setList((prev) => (prev.unreadCount === count ? prev : { ...prev, unreadCount: count }))), []);

  // Realtime: a duplicate emit of the same notification is ignored (see applyIncoming).
  useSocketEvent<CustomerNotification>('notification:new', useCallback((data) => {
    if (!data?.id || !seen.addIfNew(data.id)) return;
    setList((prev) => applyIncoming(prev, data, filter));
  }, [filter, seen]));

  const handleMarkedRead = useCallback((id: string, serverUnread?: number) => {
    const marked = applyMarkedRead(list, id, filter, new Date().toISOString());
    setList(serverUnread === undefined ? marked : { ...marked, unreadCount: serverUnread });
    if (serverUnread !== undefined) publishUnreadCount(serverUnread);
    // The last unread row on this page was read but more remain: fetch the
    // (possibly earlier, never out-of-range) page that still has them.
    if (filter === 'UNREAD' && marked.rows.length === 0 && marked.total > 0) {
      setRequestedPage(marked.page);
      setReloadKey((key) => key + 1);
    }
  }, [list, filter]);

  const markAllRead = async () => {
    try {
      setMarkingAll(true);
      await customerBorrowService.markAllNotificationsRead();
      setList((prev) => applyAllRead(prev, filter, new Date().toISOString()));
      // UNREAD is now empty (page 1); ALL keeps its page with every row read.
      if (filter === 'UNREAD') setRequestedPage(1);
      publishUnreadCount(0);
      // The READ view just gained rows it cannot know about locally.
      if (filter === 'READ') setReloadKey((key) => key + 1);
      toast.success('Đã đánh dấu tất cả là đã đọc');
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Chưa đánh dấu được thông báo'));
    } finally {
      setMarkingAll(false);
    }
  };

  const changeFilter = (next: NotificationFilter) => {
    setFilter(next);
    setRequestedPage(1);
  };

  const { rows, total, unreadCount, page, totalPages } = list;

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
              onClick={() => setReloadKey((key) => key + 1)}
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

      {loading && rows.length === 0 ? (
        <div className="space-y-2" aria-busy="true">
          {[0, 1, 2, 3].map((i) => <div key={i} className="h-16 animate-pulse rounded-xl border bg-card" />)}
        </div>
      ) : error ? (
        <EmptyState variant="error" title="Không tải được thông báo" description={error} action={<button type="button" onClick={() => setReloadKey((key) => key + 1)} className="font-medium text-primary hover:underline">Thử lại</button>} />
      ) : rows.length === 0 ? (
        <EmptyState
          variant="inbox"
          title="Không có thông báo"
          description={filter === 'ALL' ? 'Bạn chưa có thông báo nào. Nhắc nhở và cập nhật tài khoản sẽ xuất hiện ở đây.' : `Không có thông báo ${filter === 'UNREAD' ? 'chưa đọc' : 'đã đọc'}.`}
        />
      ) : (
        <div className="space-y-3">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground" data-testid="notifications-total">
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
                  onClick={() => setRequestedPage(Math.max(1, page - 1))}
                  disabled={page <= 1 || loading}
                  className="px-3 py-1 rounded border border-input text-indigo-600 dark:text-indigo-400 cursor-pointer hover:bg-indigo-50 dark:hover:bg-indigo-500/10 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
                >
                  Trước
                </button>
                <button
                  type="button"
                  onClick={() => setRequestedPage(Math.min(totalPages, page + 1))}
                  disabled={page >= totalPages || loading}
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
