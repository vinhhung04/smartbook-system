import { Bell, BookOpen, CalendarClock, ChevronRight, CircleAlert, CircleCheckBig, Check } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { formatDateTime } from './customer-format';
import { customerBorrowService } from '@/services/customer-borrow';
import { notificationTarget } from '@/lib/notification-links';

export interface CustomerNotification {
  id: string;
  subject?: string | null;
  body?: string | null;
  template_code?: string | null;
  reference_type?: string | null;
  reference_id?: string | null;
  metadata?: Record<string, unknown> | null;
  created_at?: string;
  scheduled_at?: string;
  read_at?: string | null;
}

interface NotificationItemProps {
  item: CustomerNotification;
  /** Called after the server confirmed the notification is read, with the server's new unread count. */
  onMarkedRead?: (id: string, unreadCount?: number) => void;
}

function pickIcon(code: string) {
  const normalized = code.toUpperCase();
  if (normalized.includes('AVAILABILITY')) return BookOpen;
  if (normalized.includes('OVERDUE') || normalized.includes('FINE')) return CircleAlert;
  if (normalized.includes('READY') || normalized.includes('REMINDER')) return CalendarClock;
  if (normalized.includes('SUCCESS') || normalized.includes('APPROVED') || normalized.includes('CONFIRMED')) return CircleCheckBig;
  return Bell;
}

export function NotificationItem({ item, onMarkedRead }: NotificationItemProps) {
  const navigate = useNavigate();
  const Icon = pickIcon(String(item.template_code || item.subject || ''));
  const target = notificationTarget(item);
  const unread = !item.read_at;
  const [marking, setMarking] = useState(false);

  const markRead = async () => {
    if (!unread) return;
    try {
      setMarking(true);
      const result = await customerBorrowService.markNotificationRead(item.id);
      const unreadCount = Number(result?.data?.unread_count);
      onMarkedRead?.(item.id, Number.isFinite(unreadCount) ? unreadCount : undefined);
    } catch {
      toast.error('Chưa đánh dấu được thông báo là đã đọc');
    } finally {
      setMarking(false);
    }
  };

  const open = async () => {
    await markRead();
    if (target) navigate(target);
  };

  const title = item.subject || 'Thông báo';

  return (
    <div
      data-testid="notification-item"
      data-unread={unread ? 'true' : 'false'}
      className={`rounded-[12px] border p-3.5 ${unread ? 'border-indigo-100 bg-indigo-50/40 dark:border-indigo-500/20 dark:bg-indigo-950/20' : 'border-border bg-card'}`}
    >
      <div className="flex items-start gap-3">
        <div className="rounded-[9px] border border-border bg-card p-2 text-slate-600 dark:text-slate-300">
          <Icon className="h-4 w-4" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            {target ? (
              <button
                type="button"
                onClick={() => void open()}
                className="group min-w-0 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40 rounded"
                aria-label={`${title} — mở chi tiết`}
              >
                <span className="inline-flex items-center gap-1 text-[13px] text-foreground group-hover:text-indigo-700 dark:group-hover:text-indigo-300" style={{ fontWeight: 700 }}>
                  {title}
                  <ChevronRight className="h-3.5 w-3.5 opacity-60" aria-hidden="true" />
                </span>
              </button>
            ) : (
              <div className="text-[13px] text-foreground" style={{ fontWeight: 700 }}>{title}</div>
            )}
            <div className="flex shrink-0 items-center gap-1.5">
              {unread ? (
                <>
                  <button
                    type="button"
                    onClick={() => void markRead()}
                    disabled={marking}
                    data-testid="notification-mark-read"
                    className="inline-flex items-center gap-1 rounded-[8px] border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-[10px] text-indigo-700 transition-colors hover:bg-indigo-100 disabled:opacity-50 dark:border-indigo-500/30 dark:bg-indigo-950/30 dark:text-indigo-300"
                  >
                    <Check className="h-3 w-3" aria-hidden="true" />
                    {marking ? 'Đang lưu…' : 'Đánh dấu đã đọc'}
                  </button>
                  <span className="rounded-[8px] bg-indigo-100 px-2 py-0.5 text-[10px] uppercase text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300">Chưa đọc</span>
                </>
              ) : null}
            </div>
          </div>
          {item.body ? <div className="mt-1.5 text-[13px] text-slate-600 dark:text-slate-300">{item.body}</div> : null}
          <div className="mt-1.5 text-[11px] text-muted-foreground">{formatDateTime(item.created_at || item.scheduled_at)}</div>
        </div>
      </div>
    </div>
  );
}
