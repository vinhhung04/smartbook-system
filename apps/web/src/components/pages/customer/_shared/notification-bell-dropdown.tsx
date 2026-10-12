import { useCallback, useEffect, useRef, useState } from 'react';
import { Bell } from 'lucide-react';
import { Bell as BellData, BellRing as BellRingData, Wifi, WifiOff } from 'lucide'; // icon data (not components) — MorphIcon needs this, not lucide-react
import { MorphIcon } from 'morphicons/react';
import { useNavigate } from 'react-router';
import { customerBorrowService } from '@/services/customer-borrow';
import { formatDateTime } from './customer-format';
import { notificationTarget } from '@/lib/notification-links';
import { applyAllRead, applyIncoming, applyMarkedRead, createRecentIds, type NotificationListState } from '@/lib/notification-state';
import { onUnreadCount, publishUnreadCount } from '@/lib/notification-sync';
import { useSocket, useSocketEvent } from '@/lib/socket';
import { toast } from 'sonner';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

interface NotificationRow {
  id: string;
  subject?: string;
  body?: string;
  template_code?: string;
  reference_type?: string | null;
  reference_id?: string | null;
  metadata?: Record<string, unknown> | null;
  created_at?: string;
  scheduled_at?: string;
  read_at?: string | null;
}

function toRows(payload: any): NotificationRow[] {
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload)) return payload;
  return [];
}

const BELL_SIZE = 5;
// After a burst of realtime events, re-read the authoritative unread count once.
const RECONCILE_DELAY_MS = 1500;

export function NotificationBellDropdown() {
  const navigate = useNavigate();
  const { connected } = useSocket();
  // Latest 5 rows; unreadCount is the server's (meta.unread_count), not derived from them.
  const [list, setList] = useState<NotificationListState<NotificationRow>>({ rows: [], total: 0, unreadCount: 0, page: 1, totalPages: 1, pageSize: BELL_SIZE });
  const [isLoading, setIsLoading] = useState(false);
  const [hasNewPush, setHasNewPush] = useState(false);
  const [seen] = useState(() => createRecentIds());
  const reconcileTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { rows: recentRows, unreadCount } = list;

  const loadNotifications = async () => {
    try {
      setIsLoading(true);
      const response = await customerBorrowService.getMyNotifications({ page: 1, pageSize: BELL_SIZE });
      const count = Number(response?.meta?.unread_count) || 0;
      setList((prev) => ({ ...prev, rows: toRows(response), total: Number(response?.meta?.total) || 0, unreadCount: count }));
      publishUnreadCount(count);
    } catch {
      /* the bell stays usable; the notifications page shows the error */
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadNotifications();
  }, []);

  // The notifications page (or an earlier reconcile) learned a newer server count.
  useEffect(() => onUnreadCount((count) => setList((prev) => (prev.unreadCount === count ? prev : { ...prev, unreadCount: count }))), []);

  useEffect(() => () => {
    if (reconcileTimer.current) clearTimeout(reconcileTimer.current);
  }, []);

  const scheduleReconcile = useCallback(() => {
    if (reconcileTimer.current) clearTimeout(reconcileTimer.current);
    reconcileTimer.current = setTimeout(() => {
      reconcileTimer.current = null;
      customerBorrowService.getUnreadNotificationCount()
        .then((count) => publishUnreadCount(count))
        .catch(() => { /* keep the local count until the next event or page load */ });
    }, RECONCILE_DELAY_MS);
  }, []);

  const handleNewNotification = useCallback((data: any) => {
    // Every server notification carries its id; the same id emitted twice is
    // counted (and toasted) once.
    if (!data?.id || !seen.addIfNew(data.id)) return;
    const newRow: NotificationRow = {
      id: data.id,
      subject: data.subject,
      body: data.body,
      template_code: data.template_code,
      reference_type: data.reference_type ?? null,
      reference_id: data.reference_id ?? null,
      metadata: data.metadata ?? null,
      created_at: data.created_at || new Date().toISOString(),
      read_at: null,
    };
    setList((prev) => applyIncoming(prev, newRow, 'ALL'));
    scheduleReconcile();
    setHasNewPush(true);

    toast(data.subject || 'Thông báo mới', {
      description: data.body || '',
      duration: 5000,
    });

    setTimeout(() => setHasNewPush(false), 2000);
  }, [seen, scheduleReconcile]);

  useSocketEvent('notification:new', handleNewNotification);

  const openNotification = async (row: NotificationRow) => {
    if (!row.read_at) {
      try {
        const result = await customerBorrowService.markNotificationRead(row.id);
        const serverCount = Number(result?.data?.unread_count);
        setList((prev) => {
          const marked = applyMarkedRead(prev, row.id, 'ALL', new Date().toISOString());
          return Number.isFinite(serverCount) ? { ...marked, unreadCount: serverCount } : marked;
        });
        if (Number.isFinite(serverCount)) publishUnreadCount(serverCount);
      } catch { /* still open the target */ }
    }
    navigate(notificationTarget(row) || '/customer/notifications');
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={unreadCount > 0 ? `Thông báo, ${unreadCount} chưa đọc` : 'Thông báo'}
          data-testid="notification-bell"
          className="relative inline-flex h-10 w-10 items-center justify-center rounded-[11px] border border-border bg-card text-slate-600 dark:text-slate-300 transition-all duration-200 hover:border-cyan-200 hover:bg-cyan-50 dark:hover:border-cyan-800/40 dark:hover:bg-cyan-950/20">
          <Bell className={`h-4 w-4 transition-transform ${hasNewPush ? 'animate-bounce' : ''}`} />
          {unreadCount > 0 ? (
            <span data-testid="notification-unread-count" className="absolute -right-1 -top-1 inline-flex min-w-[18px] animate-pulse items-center justify-center rounded-full bg-indigo-600 px-1 text-[10px] text-white" style={{ fontWeight: 700 }}>
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          ) : null}
          {/* Connection status indicator */}
          <span className={`absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full ring-1 ring-white ${connected ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-600'}`} />
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-80 rounded-[12px] border-border p-1.5 shadow-[0_20px_40px_rgba(15,23,42,0.15)]">
        <div className="flex items-center justify-between px-2 py-1.5">
          <div className="flex items-center gap-1.5">
            <p className="text-[12px] text-foreground" style={{ fontWeight: 700 }}>Thông báo</p>
            <MorphIcon icon={connected ? Wifi : WifiOff} className={`h-3 w-3 ${connected ? 'text-emerald-500' : 'text-slate-400 dark:text-slate-500'}`} />
          </div>
          <button
            onClick={async () => {
              try {
                await customerBorrowService.markAllNotificationsRead();
                setList((prev) => applyAllRead(prev, 'ALL', new Date().toISOString()));
                publishUnreadCount(0);
              } catch { /* ignore */ }
            }}
            disabled={unreadCount === 0}
            className={`rounded-[8px] border border-border px-2 py-1 text-[10px] transition-colors ${unreadCount > 0 ? 'text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950/30 cursor-pointer' : 'text-slate-400 dark:text-slate-500'}`}
          >
            Đọc tất cả
          </button>
        </div>
        <DropdownMenuSeparator />

        {isLoading ? (
          <div className="px-2 py-4 text-[12px] text-muted-foreground">Đang tải thông báo...</div>
        ) : recentRows.length === 0 ? (
          <div className="px-2 py-4 text-[12px] text-muted-foreground">Chưa có thông báo nào.</div>
        ) : (
          <div className="max-h-[360px] overflow-y-auto">
            {recentRows.map((row) => (
              <DropdownMenuItem key={row.id} onSelect={() => void openNotification(row)} className="items-start rounded-[10px] px-2 py-2.5 text-[12px] transition-colors duration-200 hover:bg-cyan-50/40 dark:hover:bg-cyan-950/20">
                <div className="mt-0.5">
                  <MorphIcon icon={row.read_at ? BellData : BellRingData} className={`h-4 w-4 ${row.read_at ? 'text-slate-400 dark:text-slate-500' : 'text-indigo-600 dark:text-indigo-400'}`} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="line-clamp-1 text-foreground" style={{ fontWeight: 600 }}>{row.subject || 'Thông báo'}</p>
                  <p className="mt-0.5 line-clamp-2 text-[11px] text-muted-foreground">{row.body || ''}</p>
                  <p className="mt-1 text-[10px] text-slate-400 dark:text-slate-500">{formatDateTime(row.created_at || row.scheduled_at)}</p>
                </div>
                {!row.read_at ? <span className="mt-1 h-2 w-2 rounded-full bg-indigo-500" /> : null}
              </DropdownMenuItem>
            ))}
          </div>
        )}

        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => navigate('/customer/notifications')} className="justify-center rounded-[9px] text-[12px] text-indigo-700 dark:text-indigo-400" style={{ fontWeight: 600 }}>
          Xem tất cả thông báo
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
