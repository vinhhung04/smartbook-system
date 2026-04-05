import { useEffect, useMemo, useState, useCallback } from 'react';
import { Bell, BellRing, Wifi, WifiOff } from 'lucide-react';
import { useNavigate } from 'react-router';
import { customerBorrowService } from '@/services/customer-borrow';
import { formatDateTime } from './customer-format';
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
  created_at?: string;
  scheduled_at?: string;
  read_at?: string | null;
}

function toRows(payload: any): NotificationRow[] {
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload)) return payload;
  return [];
}

export function NotificationBellDropdown() {
  const navigate = useNavigate();
  const { connected } = useSocket();
  const [rows, setRows] = useState<NotificationRow[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [hasNewPush, setHasNewPush] = useState(false);

  const unreadCount = useMemo(() => rows.filter((row) => !row.read_at).length, [rows]);
  const recentRows = useMemo(() => rows.slice(0, 5), [rows]);

  const loadNotifications = async () => {
    try {
      setIsLoading(true);
      const response = await customerBorrowService.getMyNotifications();
      setRows(toRows(response));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadNotifications();
  }, []);

  const handleNewNotification = useCallback((data: any) => {
    const newRow: NotificationRow = {
      id: data.id || `push-${Date.now()}`,
      subject: data.subject,
      body: data.body,
      template_code: data.template_code,
      created_at: data.created_at || new Date().toISOString(),
      read_at: null,
    };
    setRows((prev) => [newRow, ...prev]);
    setHasNewPush(true);

    toast(data.subject || 'New notification', {
      description: data.body || '',
      duration: 5000,
    });

    setTimeout(() => setHasNewPush(false), 2000);
  }, []);

  useSocketEvent('notification:new', handleNewNotification);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="relative inline-flex h-10 w-10 items-center justify-center rounded-[11px] border border-slate-200 bg-white text-slate-600 transition-all duration-200 hover:border-cyan-200 hover:bg-cyan-50">
          <Bell className={`h-4 w-4 transition-transform ${hasNewPush ? 'animate-bounce' : ''}`} />
          {unreadCount > 0 ? (
            <span className="absolute -right-1 -top-1 inline-flex min-w-[18px] animate-pulse items-center justify-center rounded-full bg-indigo-600 px-1 text-[10px] text-white" style={{ fontWeight: 700 }}>
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          ) : null}
          {/* Connection status indicator */}
          <span className={`absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full ring-1 ring-white ${connected ? 'bg-emerald-500' : 'bg-slate-300'}`} />
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-80 rounded-[12px] border-slate-200 p-1.5 shadow-[0_20px_40px_rgba(15,23,42,0.15)]">
        <div className="flex items-center justify-between px-2 py-1.5">
          <div className="flex items-center gap-1.5">
            <p className="text-[12px] text-slate-900" style={{ fontWeight: 700 }}>Notifications</p>
            {connected ? (
              <Wifi className="h-3 w-3 text-emerald-500" />
            ) : (
              <WifiOff className="h-3 w-3 text-slate-400" />
            )}
          </div>
          <button
            onClick={async () => {
              try {
                await customerBorrowService.markAllNotificationsRead();
                setRows((prev) => prev.map((r) => ({ ...r, read_at: r.read_at || new Date().toISOString() })));
              } catch { /* ignore */ }
            }}
            disabled={unreadCount === 0}
            className={`rounded-[8px] border border-slate-200 px-2 py-1 text-[10px] transition-colors ${unreadCount > 0 ? 'text-indigo-600 hover:bg-indigo-50 cursor-pointer' : 'text-slate-400'}`}
          >
            Mark all read
          </button>
        </div>
        <DropdownMenuSeparator />

        {isLoading ? (
          <div className="px-2 py-4 text-[12px] text-slate-500">Loading notifications...</div>
        ) : recentRows.length === 0 ? (
          <div className="px-2 py-4 text-[12px] text-slate-500">No notifications yet.</div>
        ) : (
          <div className="max-h-[360px] overflow-y-auto">
            {recentRows.map((row) => (
              <DropdownMenuItem key={row.id} onSelect={() => navigate('/customer/notifications')} className="items-start rounded-[10px] px-2 py-2.5 text-[12px] transition-colors duration-200 hover:bg-cyan-50/40">
                <div className="mt-0.5">
                  {row.read_at ? <Bell className="h-4 w-4 text-slate-400" /> : <BellRing className="h-4 w-4 text-indigo-600" />}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="line-clamp-1 text-slate-900" style={{ fontWeight: 600 }}>{row.subject || row.template_code || 'Notification'}</p>
                  <p className="mt-0.5 line-clamp-2 text-[11px] text-slate-500">{row.body || ''}</p>
                  <p className="mt-1 text-[10px] text-slate-400">{formatDateTime(row.created_at || row.scheduled_at)}</p>
                </div>
                {!row.read_at ? <span className="mt-1 h-2 w-2 rounded-full bg-indigo-500" /> : null}
              </DropdownMenuItem>
            ))}
          </div>
        )}

        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => navigate('/customer/notifications')} className="justify-center rounded-[9px] text-[12px] text-indigo-700" style={{ fontWeight: 600 }}>
          View all notifications
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
