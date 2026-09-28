import { useState } from 'react';
import { X } from 'lucide-react';
import { formatDateTime } from './customer-format';
import { StatusBadge } from './status-badge';
import { QRCode } from '@/components/ui/qr-code';
import { BookCoverPlaceholder } from './book-cover-placeholder';

interface ReservationItemProps {
  item: any;
  onCancel: (id: string) => void;
}

const HOUR_MS = 60 * 60 * 1000;
const LIVE_STATUSES = ['PENDING', 'CONFIRMED', 'READY_FOR_PICKUP'];

function formatDay(value?: string | null) {
  if (!value) return '-';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '-' : date.toLocaleDateString('vi-VN');
}

function expiryLabel(expiresAt: Date | null, now: number): { text: string; urgent: boolean } | null {
  if (!expiresAt) return null;
  const diff = expiresAt.getTime() - now;
  if (diff <= 0) return { text: 'Đã hết hạn', urgent: true };
  const hours = Math.floor(diff / HOUR_MS);
  if (hours < 1) return { text: 'Còn dưới 1 giờ', urgent: true };
  if (hours < 24) return { text: `Còn ${hours} giờ`, urgent: true };
  return { text: `Còn ${Math.floor(hours / 24)} ngày`, urgent: hours < 72 };
}

export function ReservationItem({ item, onCancel }: ReservationItemProps) {
  const [mountedAt] = useState(() => Date.now());
  const status = String(item.status || '').toUpperCase();
  const isLive = LIVE_STATUSES.includes(status);
  const isReady = status === 'READY_FOR_PICKUP';
  const pickupCode = String(item.pickup_code || '').trim();
  const expiresAt = item?.expires_at ? new Date(item.expires_at) : null;
  const expiry = isLive ? expiryLabel(expiresAt && !Number.isNaN(expiresAt.getTime()) ? expiresAt : null, mountedAt) : null;
  const bookTitle = item.book_title || 'Sách chưa xác định';

  return (
    <div
      className={`rounded-xl border p-3.5 transition-all duration-200 hover:shadow-[0_8px_20px_rgba(15,23,42,0.06)] sm:p-4 ${
        isReady
          ? 'border-emerald-200 bg-emerald-50/60 dark:border-emerald-900/40 dark:bg-emerald-950/20'
          : expiry?.urgent
            ? 'border-amber-200 bg-amber-50/60 dark:border-amber-900/40 dark:bg-amber-950/20'
            : 'border-border bg-card'
      }`}
    >
      <div className="flex items-center gap-3 sm:gap-4">
        <div className="w-12 shrink-0 sm:w-14">
          <BookCoverPlaceholder title={bookTitle} imageUrl={item.book_cover_url} />
        </div>

        <div className="min-w-0 flex-1">
          <p className="truncate text-[14px] text-foreground" style={{ fontWeight: 700 }} title={bookTitle}>{bookTitle}</p>
          {item.book_author ? <p className="truncate text-[12px] text-muted-foreground">{item.book_author}</p> : null}
          <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">{item.reservation_number || 'Phiếu đặt trước'}</p>
          <p className="mt-1 text-[12px] text-muted-foreground">
            Đặt {formatDay(item.reserved_at)} · Hết hạn {formatDay(item.expires_at)}
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-2 sm:hidden">
            <StatusBadge status={item.status} />
            {expiry ? <span className={`text-[12px] font-semibold ${expiry.urgent ? 'text-amber-700 dark:text-amber-400' : 'text-foreground'}`}>{expiry.text}</span> : null}
          </div>
        </div>

        <div className="hidden shrink-0 flex-col items-end gap-1.5 sm:flex">
          {expiry ? <span className={`text-[14px] font-bold ${expiry.urgent ? 'text-amber-700 dark:text-amber-400' : 'text-foreground'}`}>{expiry.text}</span> : null}
          <StatusBadge status={item.status} />
        </div>

        {isLive ? (
          <button
            onClick={() => onCancel(item.id)}
            aria-label={`Hủy đặt trước ${bookTitle}`}
            title="Hủy đặt trước"
            className="inline-flex shrink-0 items-center gap-1 rounded-[10px] border border-rose-200 bg-rose-50 px-2.5 py-2 text-[12px] text-rose-700 hover:bg-rose-100 dark:border-rose-800/40 dark:bg-rose-950/30 dark:text-rose-400 dark:hover:bg-rose-900/40 sm:px-3"
            style={{ fontWeight: 600 }}
          >
            <X className="h-4 w-4 sm:h-3.5 sm:w-3.5" aria-hidden="true" />
            <span className="hidden sm:inline">Hủy</span>
          </button>
        ) : null}
      </div>

      {isReady && pickupCode ? (
        <div className="mt-4 flex flex-col gap-3 rounded-xl border border-emerald-200 bg-card p-3 dark:border-emerald-900/40 sm:flex-row sm:items-center">
          <div className="w-fit rounded-lg border border-border bg-white p-2">
            <QRCode value={`SMARTBOOK:PICKUP:${pickupCode}`} size={112} />
          </div>
          <div className="min-w-0">
            <p className="text-[12px] font-bold text-emerald-700 dark:text-emerald-400">Sách đã sẵn sàng — đưa mã này cho nhân viên</p>
            <p className="mt-1 break-all font-mono text-xl font-extrabold text-foreground">{pickupCode}</p>
            <p className="mt-1 text-[12px] text-muted-foreground">Có giá trị đến {formatDateTime(item.pickup_code_expires_at || item.expires_at)}</p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
