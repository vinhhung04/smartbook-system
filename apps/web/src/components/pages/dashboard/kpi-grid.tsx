import { NavLink } from 'react-router';
import { ChevronRight } from 'lucide-react';
import type { DashboardKpis, WarehouseStockRiskItem } from '@/services/analytics';
import { cn } from '@/components/ui/utils';
import { BlockError, Panel, PanelHeader } from './panel';
import { formatNumber, formatPercent, formatShare } from './utils';

interface Stat {
  key: string;
  label: string;
  /** `null` renders a dash: the figure could not be loaded. */
  value: string | null;
  detail: string;
  to?: string;
}

export interface KpiAccess {
  borrow: boolean;
  catalog: boolean;
  inventory: boolean;
}

interface KpiGridProps {
  canViewBorrow: boolean;
  access: KpiAccess;
  kpis: DashboardKpis | null;
  stockRisk: WarehouseStockRiskItem[] | null;
  onRetry: () => void;
}

function libraryStats(kpis: DashboardKpis, access: KpiAccess): Stat[] {
  const openReservations = kpis.pending_reservations + kpis.confirmed_reservations + kpis.ready_for_pickup_reservations;
  const ready = kpis.ready_for_pickup_reservations;
  const reservationDetail = openReservations === 0
    ? 'Không có lượt nào đang chờ'
    : [
      `${formatNumber(ready)} sẵn sàng để lấy`,
      kpis.pickup_codes_expiring_soon > 0 ? `${formatNumber(kpis.pickup_codes_expiring_soon)} mã sắp hết hạn` : null,
    ].filter(Boolean).join(' · ');

  return [
    {
      key: 'active-loans',
      label: 'Đang cho mượn',
      value: formatNumber(kpis.active_loans),
      detail: `bản sao · ${formatShare(kpis.active_loans, kpis.total_copies)} vốn sách`,
      to: access.borrow ? '/borrow/loans' : undefined,
    },
    {
      key: 'open-reservations',
      label: 'Đặt trước đang mở',
      value: formatNumber(openReservations),
      detail: reservationDetail,
      to: access.borrow ? `/borrow/reservations${kpis.pending_reservations > 0 ? '?tab=pending' : ''}` : undefined,
    },
    {
      key: 'conversion',
      label: 'Tỷ lệ nhận sách',
      value: formatPercent(kpis.reservation_conversion_rate),
      detail: 'lượt đặt trước khách đã đến lấy',
    },
    {
      key: 'collection',
      label: 'Vốn sách',
      value: formatNumber(kpis.total_copies),
      detail: `bản sao · ${formatNumber(kpis.total_titles)} đầu sách`,
      to: access.catalog ? '/catalog' : undefined,
    },
  ];
}

/** Users without borrow analytics see the stock picture instead of loan figures. */
function stockStats(kpis: DashboardKpis | null, stockRisk: WarehouseStockRiskItem[] | null, access: KpiAccess): Stat[] {
  const sum = (pick: (item: WarehouseStockRiskItem) => number) => (stockRisk ? stockRisk.reduce((total, item) => total + Number(pick(item) || 0), 0) : null);
  const available = sum((item) => item.total_available_qty);
  const reserved = sum((item) => item.total_reserved_qty);
  const outOfStock = sum((item) => item.out_of_stock_variants);
  const warehousesOut = stockRisk ? stockRisk.filter((item) => item.out_of_stock_variants > 0).length : 0;
  const inventoryLink = access.inventory ? '/inventory' : undefined;

  return [
    {
      key: 'collection',
      label: 'Vốn sách',
      value: kpis ? formatNumber(kpis.total_copies) : null,
      detail: kpis ? `bản sao · ${formatNumber(kpis.total_titles)} đầu sách` : 'Không tải được số liệu',
      to: access.catalog ? '/catalog' : undefined,
    },
    {
      key: 'available',
      label: 'Sẵn có tại kho',
      value: available === null ? null : formatNumber(available),
      detail: stockRisk ? `bản sao trên ${formatNumber(stockRisk.length)} kho` : 'Không tải được số liệu',
      to: inventoryLink,
    },
    {
      key: 'reserved',
      label: 'Đang giữ chỗ',
      value: reserved === null ? null : formatNumber(reserved),
      detail: 'bản sao đã được giữ, chưa xuất',
      to: inventoryLink,
    },
    {
      key: 'out-of-stock',
      label: 'Hết hàng',
      value: outOfStock === null ? null : formatNumber(outOfStock),
      detail: outOfStock ? `đầu sách tại ${formatNumber(warehousesOut)} kho` : 'Không có đầu sách nào hết hàng',
      to: inventoryLink,
    },
  ];
}

/**
 * Beside the Decision Center the panel is narrow: each figure is a row, label left and value right.
 * When the panel spans the canvas it becomes a four-column strip with the value under its label.
 */
function StatCell({ stat }: { stat: Stat }) {
  const chevron = <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/50 transition-colors group-hover:text-foreground" aria-hidden="true" />;
  const body = (
    <>
      <span className="col-start-1 row-start-1 flex items-center justify-between gap-2 text-[13px] leading-5 text-muted-foreground">
        {stat.label}
        {stat.to ? <span className="hidden @2xl:block">{chevron}</span> : null}
      </span>
      <span className={cn(
        'col-start-2 row-span-2 row-start-1 flex items-center gap-1 self-center text-[26px] font-semibold leading-8 tracking-tight tabular-nums',
        '@2xl:col-start-1 @2xl:row-span-1 @2xl:row-start-2 @2xl:mt-1.5 @2xl:self-start',
        stat.value === null ? 'text-muted-foreground' : 'text-foreground',
      )}
      >
        {stat.value ?? '—'}
        {stat.to ? <span className="@2xl:hidden">{chevron}</span> : null}
      </span>
      <span className="col-start-1 row-start-2 mt-0.5 text-[12px] leading-5 text-muted-foreground @2xl:row-start-3 @2xl:mt-auto @2xl:pt-1.5">{stat.detail}</span>
    </>
  );
  const className = 'group grid min-w-0 grid-cols-[minmax(0,1fr)_auto] content-center gap-x-4 bg-card px-5 py-3.5 @2xl:grid-cols-1 @2xl:grid-rows-[auto_auto_1fr] @2xl:content-stretch @2xl:py-4';
  return stat.to ? (
    <NavLink
      to={stat.to}
      className={cn(className, 'transition-colors hover:bg-muted/40 focus-visible:relative focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/40')}
    >
      {body}
    </NavLink>
  ) : (
    <div className={className}>{body}</div>
  );
}

export function KpiGrid({ canViewBorrow, access, kpis, stockRisk, onRetry }: KpiGridProps) {
  const title = canViewBorrow ? 'Tình hình thư viện' : 'Tình hình kho';

  if (canViewBorrow && !kpis) {
    return (
      <Panel titleId="snapshot-title" className="@5xl:col-span-4">
        <PanelHeader id="snapshot-title" title={title} />
        <div className="p-5 pt-3"><BlockError what="chỉ số thư viện" onRetry={onRetry} /></div>
      </Panel>
    );
  }

  const stats = canViewBorrow && kpis ? libraryStats(kpis, access) : stockStats(kpis, stockRisk, access);

  return (
    <Panel titleId="snapshot-title" className="overflow-hidden @5xl:col-span-4">
      <PanelHeader id="snapshot-title" title={title} />
      <div className="@container mt-3 flex flex-1 flex-col">
        {/* 1px seams come from the border colour showing through a gap-px grid. */}
        <div className="grid flex-1 auto-rows-fr grid-cols-1 gap-px border-t border-border bg-border @2xl:grid-cols-4">
          {stats.map((stat) => <StatCell key={stat.key} stat={stat} />)}
        </div>
      </div>
    </Panel>
  );
}
