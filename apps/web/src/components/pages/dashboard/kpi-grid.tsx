import { NavLink } from 'react-router';
import { ChevronRight } from 'lucide-react';
import type { DashboardKpis } from '@/services/analytics';
import { formatPercent } from './utils';

interface KpiGridProps {
  kpis: DashboardKpis;
}

function Snapshot({ to, label, value, detail }: { to?: string; label: string; value: string; detail: string }) {
  const body = (
    <>
      <span className="flex items-center justify-between gap-2 text-[13px] text-muted-foreground">
        {label}
        {to ? <ChevronRight className="h-4 w-4 text-muted-foreground/40 transition-colors group-hover:text-muted-foreground" aria-hidden="true" /> : null}
      </span>
      <span className="mt-1.5 block text-[26px] font-semibold leading-none tracking-tight text-foreground">{value}</span>
      <span className="mt-2 block text-[12px] leading-5 text-muted-foreground">{detail}</span>
    </>
  );
  const className = 'group block min-w-0 px-5 py-4';
  return to ? (
    <NavLink to={to} className={`${className} transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/30`}>{body}</NavLink>
  ) : (
    <div className={className}>{body}</div>
  );
}

export function KpiGrid({ kpis }: KpiGridProps) {
  const circulatingShare = kpis.total_copies > 0 ? Math.round((kpis.active_loans / kpis.total_copies) * 100) : 0;
  const waitingPickup = kpis.pending_reservations + kpis.confirmed_reservations + kpis.ready_for_pickup_reservations;

  return (
    <section aria-labelledby="library-snapshot-title">
      <h2 id="library-snapshot-title" className="sr-only">Tình hình thư viện</h2>
      <div className="grid grid-cols-2 overflow-hidden rounded-xl border border-border bg-card lg:grid-cols-4 [&>*]:border-border [&>*:nth-child(even)]:border-l [&>*:nth-child(n+3)]:border-t lg:[&>*:nth-child(3)]:border-l lg:[&>*:nth-child(n+3)]:border-t-0">
        <Snapshot
          to="/borrow/loans?status=BORROWED"
          label="Đang cho mượn"
          value={kpis.active_loans.toLocaleString('vi-VN')}
          detail={`bản sao · ${circulatingShare}% tổng bản sao đang ở ngoài`}
        />
        <Snapshot
          to="/borrow/reservations"
          label="Đặt trước đang mở"
          value={waitingPickup.toLocaleString('vi-VN')}
          detail={kpis.pickup_codes_expiring_soon > 0
            ? `${kpis.ready_for_pickup_reservations} sẵn sàng lấy · ${kpis.pickup_codes_expiring_soon} mã sắp hết hạn`
            : `${kpis.ready_for_pickup_reservations} sẵn sàng để khách lấy`}
        />
        <Snapshot
          label="Tỷ lệ nhận sách"
          value={formatPercent(kpis.reservation_conversion_rate)}
          detail="đặt trước được khách đến lấy thành phiếu mượn"
        />
        <Snapshot
          to="/catalog"
          label="Vốn sách"
          value={kpis.total_copies.toLocaleString('vi-VN')}
          detail={`bản sao thuộc ${kpis.total_titles.toLocaleString('vi-VN')} đầu sách`}
        />
      </div>
    </section>
  );
}
