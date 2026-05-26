import { formatDateTime } from './customer-format';
import { StatusBadge } from './status-badge';
import { QRCode } from '@/components/ui/qr-code';

interface ReservationItemProps {
  item: any;
  onCancel: (id: string) => void;
}

export function ReservationItem({ item, onCancel }: ReservationItemProps) {
  const status = String(item.status || '').toUpperCase();
  const canCancel = status === 'PENDING' || status === 'CONFIRMED' || status === 'READY_FOR_PICKUP';
  const isReady = status === 'READY_FOR_PICKUP';
  const pickupCode = String(item.pickup_code || '').trim();
  const expiresAt = item?.expires_at ? new Date(item.expires_at) : null;
  const hoursToExpire = expiresAt ? Math.floor((expiresAt.getTime() - Date.now()) / (60 * 60 * 1000)) : null;
  const isExpiringSoon = status === 'PENDING' && hoursToExpire !== null && hoursToExpire >= 0 && hoursToExpire <= 72;

  return (
    <div className={`rounded-[12px] border p-4 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_8px_20px_rgba(15,23,42,0.06)] ${isReady ? 'border-cyan-200 bg-cyan-50/60' : isExpiringSoon ? 'border-amber-200 bg-amber-50/60' : 'border-slate-200 bg-white'}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-[13px] text-slate-900" style={{ fontWeight: 700 }}>{item.reservation_number || 'Phiếu đặt trước'}</div>
          <div className="mt-1 text-[11px] uppercase tracking-[0.04em] text-slate-400">Thời gian đặt trước</div>
          <div className="mt-1 text-[12px] text-slate-500">Ngày đặt: {formatDateTime(item.reserved_at)}</div>
          <div className={`text-[12px] ${isExpiringSoon ? 'text-amber-700' : 'text-slate-500'}`} style={{ fontWeight: isExpiringSoon ? 600 : 500 }}>Hết hạn: {formatDateTime(item.expires_at)}</div>
        </div>

        <div className="flex items-center gap-2">
          <StatusBadge status={item.status} />
          <button
            disabled={!canCancel}
            onClick={() => onCancel(item.id)}
            className="rounded-[10px] border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] text-rose-700 hover:bg-rose-100 disabled:opacity-60"
            style={{ fontWeight: 600 }}
          >
            Hủy
          </button>
        </div>
      </div>

      {isReady && pickupCode ? (
        <div className="mt-4 flex flex-col gap-3 rounded-[10px] border border-cyan-200 bg-white/80 p-3 sm:flex-row sm:items-center">
          <div className="w-fit rounded-[8px] border border-slate-200 bg-white p-2">
            <QRCode value={`SMARTBOOK:PICKUP:${pickupCode}`} size={112} />
          </div>
          <div className="min-w-0">
            <div className="text-[11px] uppercase tracking-[0.04em] text-cyan-700" style={{ fontWeight: 700 }}>Mã nhận sách</div>
            <div className="mt-1 break-all font-mono text-lg text-slate-950" style={{ fontWeight: 800 }}>{pickupCode}</div>
            <div className="mt-1 text-[12px] text-slate-500">Có giá trị đến {formatDateTime(item.pickup_code_expires_at || item.expires_at)}</div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
