import { formatDateTime } from './customer-format';
import { StatusBadge } from './status-badge';

interface ReservationItemProps {
  item: any;
  onCancel: (id: string) => void;
}

export function ReservationItem({ item, onCancel }: ReservationItemProps) {
  const status = String(item.status || '').toUpperCase();
  const canCancel = status === 'PENDING';
  const isReady = status === 'READY_FOR_PICKUP';
  const expiresAt = item?.expires_at ? new Date(item.expires_at) : null;
  const hoursToExpire = expiresAt ? Math.floor((expiresAt.getTime() - Date.now()) / (60 * 60 * 1000)) : null;
  const isExpiringSoon = status === 'PENDING' && hoursToExpire !== null && hoursToExpire >= 0 && hoursToExpire <= 72;

  return (
    <div className={`rounded-[12px] border p-4 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_8px_20px_rgba(15,23,42,0.06)] ${isReady ? 'border-cyan-200 bg-cyan-50/60' : isExpiringSoon ? 'border-amber-200 bg-amber-50/60' : 'border-slate-200 bg-white'}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-[13px] text-slate-900" style={{ fontWeight: 700 }}>{item.reservation_number || 'Reservation'}</div>
          <div className="mt-1 text-[11px] uppercase tracking-[0.04em] text-slate-400">Reservation timeline</div>
          <div className="mt-1 text-[12px] text-slate-500">Reserved: {formatDateTime(item.reserved_at)}</div>
          <div className={`text-[12px] ${isExpiringSoon ? 'text-amber-700' : 'text-slate-500'}`} style={{ fontWeight: isExpiringSoon ? 600 : 500 }}>Expires: {formatDateTime(item.expires_at)}</div>
        </div>

        <div className="flex items-center gap-2">
          <StatusBadge status={item.status} />
          <button
            disabled={!canCancel}
            onClick={() => onCancel(item.id)}
            className="rounded-[10px] border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] text-rose-700 hover:bg-rose-100 disabled:opacity-60"
            style={{ fontWeight: 600 }}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
