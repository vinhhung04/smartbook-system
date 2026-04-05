import { Bell, CalendarClock, CircleAlert, CircleCheckBig, Check } from 'lucide-react';
import { formatDateTime } from './customer-format';
import { customerBorrowService } from '@/services/customer-borrow';
import { useState } from 'react';

interface NotificationItemProps {
  item: any;
  onMarkedRead?: (id: string) => void;
}

function pickIcon(code: string) {
  const normalized = code.toUpperCase();
  if (normalized.includes('OVERDUE') || normalized.includes('FINE')) return CircleAlert;
  if (normalized.includes('READY') || normalized.includes('REMINDER')) return CalendarClock;
  if (normalized.includes('SUCCESS') || normalized.includes('APPROVED')) return CircleCheckBig;
  return Bell;
}

export function NotificationItem({ item, onMarkedRead }: NotificationItemProps) {
  const Icon = pickIcon(String(item.template_code || item.subject || ''));
  const [isRead, setIsRead] = useState(Boolean(item.read_at));
  const [marking, setMarking] = useState(false);

  const handleMarkRead = async () => {
    try {
      setMarking(true);
      await customerBorrowService.markNotificationRead(item.id);
      setIsRead(true);
      onMarkedRead?.(item.id);
    } catch { /* ignore */ } finally { setMarking(false); }
  };

  const unread = !isRead;

  return (
    <div className={`rounded-[12px] border p-3.5 ${unread ? 'border-indigo-100 bg-indigo-50/40' : 'border-slate-200 bg-white'}`}>
      <div className="flex items-start gap-3">
        <div className="rounded-[9px] border border-slate-200 bg-white p-2 text-slate-600">
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <div className="text-[13px] text-slate-900" style={{ fontWeight: 700 }}>{item.subject || item.template_code || 'Notification'}</div>
            <div className="flex items-center gap-1.5">
              {unread && (
                <button onClick={() => void handleMarkRead()} disabled={marking}
                  className="inline-flex items-center gap-1 rounded-[8px] border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-[10px] text-indigo-700 hover:bg-indigo-100 transition-colors disabled:opacity-50">
                  <Check className="h-3 w-3" />
                  {marking ? '...' : 'Mark read'}
                </button>
              )}
              {unread ? <span className="rounded-[8px] bg-indigo-100 px-2 py-0.5 text-[10px] uppercase text-indigo-700">Unread</span> : null}
            </div>
          </div>
          <div className="mt-1.5 text-[13px] text-slate-600">{item.body}</div>
          <div className="mt-1.5 text-[11px] text-slate-500">{formatDateTime(item.created_at || item.scheduled_at)}</div>
        </div>
      </div>
    </div>
  );
}
