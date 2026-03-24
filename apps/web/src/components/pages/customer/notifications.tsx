import { useEffect, useState } from 'react';
import { Bell, RefreshCw } from 'lucide-react';
import { customerBorrowService } from '@/services/customer-borrow';
import { getApiErrorMessage } from '@/services/api';
import { SectionCard } from '@/components/ui/section-card';
import { EmptyState } from '@/components/ui/empty-state';
import { LoadingOverlay } from '@/components/ui/loading-state';
import { NotificationListItem } from './_shared/notification-list-item';

export function CustomerNotificationsPage() {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'ALL' | 'UNREAD' | 'READ'>('ALL');

  const loadNotifications = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await customerBorrowService.getMyNotifications();
      setRows(Array.isArray(response?.data) ? response.data : []);
    } catch (err) {
      setError(getApiErrorMessage(err, 'Failed to load notifications'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void loadNotifications(); }, []);

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
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-100 to-cyan-50 flex items-center justify-center border border-indigo-200/40">
            <Bell className="w-5 h-5 text-indigo-600" />
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">My Notifications</h1>
            <p className="text-[13px] text-muted-foreground">Reminders, updates, and account alerts</p>
          </div>
        </div>
        <button onClick={() => void loadNotifications()} disabled={loading}
          className="inline-flex items-center gap-1.5 h-9 rounded-xl border border-input bg-white px-3 text-[12px] text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-50">
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* Filter Tabs */}
      <div className="flex items-center gap-2">
        {(['ALL', 'UNREAD', 'READ'] as const).map((f) => (
          <button key={f} onClick={() => setFilter(f)} className={`inline-flex items-center gap-1.5 h-8 rounded-lg px-3 text-[12px] font-medium transition-colors ${
            filter === f
              ? 'bg-primary text-primary-foreground'
              : 'bg-card border border-input text-muted-foreground hover:bg-muted hover:text-foreground'
          }`}>
            {f === 'ALL' ? 'All' : f === 'UNREAD' ? 'Unread' : 'Read'}
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
        <EmptyState variant="error" title="Failed to load notifications" description={error} action={<button onClick={() => void loadNotifications()} className="text-primary font-medium hover:underline">Try again</button>} />
      ) : filteredRows.length === 0 ? (
        <EmptyState variant="inbox" title="No notifications" description={filter === 'ALL' ? 'You are all caught up! Check back later for reminders and account updates.' : `No ${filter.toLowerCase()} notifications.`} />
      ) : (
        <div className="space-y-3">
          {unreadRows.length > 0 && (
            <div>
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Unread ({unreadRows.length})</p>
              <div className="space-y-2">
                {unreadRows.map((row) => (
                  <NotificationListItem key={row.id} item={row} />
                ))}
              </div>
            </div>
          )}
          {readRows.length > 0 && (
            <div>
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Read ({readRows.length})</p>
              <div className="space-y-2">
                {readRows.map((row) => (
                  <NotificationListItem key={row.id} item={row} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
