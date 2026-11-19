import { Bell, BookOpen, CalendarClock, ChevronRight, CircleAlert, CircleCheckBig, Check } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { formatDateTime } from './customer-format';

/** The list is grouped by day (the group heading carries the date), so a row only needs its time. */
function formatTimeOfDay(value?: string) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return formatDateTime(value);
  return date.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
}
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

  // One row of a ruled list: unread rows carry a dot and a bold title instead of a tinted card,
  // and "mark as read" is a quiet icon that shows on hover/focus (always on touch screens).
  return (
    <div
      data-testid="notification-item"
      data-unread={unread ? 'true' : 'false'}
      className="group/notification relative flex items-start gap-3 px-4 py-3.5 transition-colors hover:bg-muted/40 sm:px-5"
    >
      <span
        className={`absolute left-1.5 top-[1.35rem] h-1.5 w-1.5 rounded-full sm:left-2 ${unread ? 'bg-primary' : 'bg-transparent'}`}
        role={unread ? 'img' : undefined}
        aria-label={unread ? 'Chưa đọc' : undefined}
      />
      <div className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${unread ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'}`}>
        <Icon className="h-4 w-4" aria-hidden="true" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-3">
          {target ? (
            <button
              type="button"
              onClick={() => void open()}
              className="group min-w-0 rounded text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              aria-label={`${title} — mở chi tiết`}
            >
              <span className={`inline-flex items-center gap-1 text-[13.5px] group-hover:text-primary ${unread ? 'font-semibold text-foreground' : 'font-medium text-foreground/80'}`}>
                {title}
                <ChevronRight className="h-3.5 w-3.5 opacity-60" aria-hidden="true" />
              </span>
            </button>
          ) : (
            <div className={`text-[13.5px] ${unread ? 'font-semibold text-foreground' : 'font-medium text-foreground/80'}`}>{title}</div>
          )}
          <div className="flex shrink-0 items-center gap-2">
            <time className="whitespace-nowrap text-[12px] tabular-nums text-muted-foreground" dateTime={item.created_at || item.scheduled_at || undefined}>
              {formatTimeOfDay(item.created_at || item.scheduled_at)}
            </time>
            {unread ? (
              <button
                type="button"
                onClick={() => void markRead()}
                disabled={marking}
                data-testid="notification-mark-read"
                aria-label="Đánh dấu đã đọc"
                title="Đánh dấu đã đọc"
                className="inline-flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground transition-[opacity,color,background-color] hover:bg-primary/10 hover:text-primary focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-50 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover/notification:opacity-100"
              >
                <Check className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            ) : null}
          </div>
        </div>
        {item.body ? <p className={`mt-1 text-[13px] leading-relaxed ${unread ? 'text-foreground/80' : 'text-muted-foreground'}`}>{item.body}</p> : null}
      </div>
    </div>
  );
}
