import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, CheckCheck } from 'lucide-react';
import { customerBorrowService } from '@/services/customer-borrow';
import { getApiErrorMessage } from '@/services/api';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { cn } from '@/components/ui/utils';
import { CustomerPageHeader } from './_shared/customer-page-header';
import { EmptyState } from '@/components/ui/empty-state';
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
    <div className="mx-auto max-w-3xl space-y-5 p-4 sm:p-6 lg:p-8">
      <CustomerPageHeader
        title="Thông báo"
        subtitle="Nhắc nhở, cập nhật và cảnh báo về tài khoản của bạn"
        actions={
          <>
            <button
              onClick={async () => {
                try {
                  await customerBorrowService.markAllNotificationsRead();
                  setRows((prev) => prev.map((r) => ({ ...r, read_at: r.read_at || new Date().toISOString() })));
                  toast.success('Đã đánh dấu tất cả là đã đọc');
                } catch (err) { toast.error(getApiErrorMessage(err, 'Thất bại')); }
              }}
              disabled={loading || rows.every((r) => r.read_at)}
              className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-input bg-card px-3 text-[12px] font-medium text-muted-foreground transition-colors hover:bg-indigo-50 hover:text-indigo-600 disabled:opacity-50 dark:hover:bg-indigo-950/20 dark:hover:text-indigo-400"
            >
              <CheckCheck className="h-3.5 w-3.5" />
              Đọc tất cả
            </button>
            <button
              onClick={() => void loadNotifications()}
              disabled={loading}
              aria-label="Làm mới thông báo"
              className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-input bg-card px-3 text-[12px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
            >
              <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
              Làm mới
            </button>
          </>
        }
      />

      <div className="max-w-full overflow-x-auto">
        <SegmentedControl
          layoutId="customer-notifications-filter"
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'ALL', label: `Tất cả (${rows.length})` },
            { value: 'UNREAD', label: `Chưa đọc (${rows.filter((r) => !r.read_at).length})` },
            { value: 'READ', label: `Đã đọc (${rows.filter((r) => r.read_at).length})` },
          ]}
          className="w-max"
        />
      </div>

      {/* Content */}
      {loading ? (
        <div className="space-y-2" aria-busy="true">
          {[0, 1, 2, 3].map((i) => <div key={i} className="h-16 animate-pulse rounded-xl border bg-card" />)}
        </div>
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
