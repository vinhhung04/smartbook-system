import { formatDateTime } from './customer-format';
import { StatusBadge } from './status-badge';
import { QRCode } from '@/components/ui/qr-code';
import { BookCoverPlaceholder } from './book-cover-placeholder';
import { useState } from 'react';

interface ReservationItemProps {
  item: any;
  onCancel: (id: string) => void;
}

export function ReservationItem({ item, onCancel }: ReservationItemProps) {
  const [mountedAt] = useState(() => Date.now());
  const status = String(item.status || '').toUpperCase();
  const canCancel = status === 'PENDING' || status === 'CONFIRMED' || status === 'READY_FOR_PICKUP';
  const isReady = status === 'READY_FOR_PICKUP';
  const pickupCode = String(item.pickup_code || '').trim();
  const expiresAt = item?.expires_at ? new Date(item.expires_at) : null;
  const hoursToExpire = expiresAt ? Math.floor((expiresAt.getTime() - mountedAt) / (60 * 60 * 1000)) : null;
  const isExpiringSoon = status === 'PENDING' && hoursToExpire !== null && hoursToExpire >= 0 && hoursToExpire <= 72;
  const bookTitle = item.book_title || 'Sách chưa xác định';

  return (
    <div className={`rounded-[12px] border p-4 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_8px_20px_rgba(15,23,42,0.06)] ${isReady ? 'border-cyan-200 bg-cyan-50/60 dark:border-cyan-900/40 dark:bg-cyan-950/20' : isExpiringSoon ? 'border-amber-200 bg-amber-50/60 dark:border-amber-900/40 dark:bg-amber-950/20' : 'border-border bg-card'}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-3 min-w-0">
          <div className="w-12 shrink-0">
            <BookCoverPlaceholder title={bookTitle} imageUrl={item.book_cover_url} />
          </div>
          <div className="min-w-0">
            <div className="text-[13px] text-foreground truncate" style={{ fontWeight: 700 }}>{bookTitle}</div>
            {item.book_author ? <div className="text-[11px] text-muted-foreground truncate">{item.book_author}</div> : null}
            <div className="mt-1 text-[11px] text-slate-400 dark:text-slate-500">{item.reservation_number || 'Phiếu đặt trước'}</div>
            <div className="mt-1 text-[12px] text-muted-foreground">Ngày đặt: {formatDateTime(item.reserved_at)}</div>
            <div className={`text-[12px] ${isExpiringSoon ? 'text-amber-700 dark:text-amber-400' : 'text-muted-foreground'}`} style={{ fontWeight: isExpiringSoon ? 600 : 500 }}>Hết hạn: {formatDateTime(item.expires_at)}</div>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <StatusBadge status={item.status} />
          <button
            disabled={!canCancel}
            onClick={() => onCancel(item.id)}
            className="rounded-[10px] border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] text-rose-700 hover:bg-rose-100 disabled:opacity-60 dark:border-rose-800/40 dark:bg-rose-950/30 dark:text-rose-400 dark:hover:bg-rose-900/40"
            style={{ fontWeight: 600 }}
          >
            Hủy
          </button>
        </div>
      </div>

      {isReady && pickupCode ? (
        <div className="mt-4 flex flex-col gap-3 rounded-[10px] border border-cyan-200 dark:border-cyan-900/40 bg-card/80 p-3 sm:flex-row sm:items-center">
          <div className="w-fit rounded-[8px] border border-border bg-card p-2">
            <QRCode value={`SMARTBOOK:PICKUP:${pickupCode}`} size={112} />
          </div>
          <div className="min-w-0">
            <div className="text-[11px] uppercase tracking-[0.04em] text-cyan-700 dark:text-cyan-400" style={{ fontWeight: 700 }}>Mã nhận sách</div>
            <div className="mt-1 break-all font-mono text-lg text-foreground" style={{ fontWeight: 800 }}>{pickupCode}</div>
            <div className="mt-1 text-[12px] text-muted-foreground">Có giá trị đến {formatDateTime(item.pickup_code_expires_at || item.expires_at)}</div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
