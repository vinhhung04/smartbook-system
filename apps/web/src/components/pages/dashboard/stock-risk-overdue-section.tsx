import { NavLink } from 'react-router';
import { AlertOctagon, AlertTriangle, CheckCircle2, ChevronRight } from 'lucide-react';
import { cn } from '@/components/ui/utils';
import type { OverdueSummary, WarehouseStockRiskItem } from '@/services/analytics';
import { BlockEmpty, BlockError, Panel, PanelBody, PanelHeader, PanelLink } from './panel';
import { formatDate, formatNumber } from './utils';

/** Both lists stop at the same length so the two panels end level. */
const ROW_LIMIT = 6;

type Risk = 'out' | 'low' | 'ok';

const RISK: Record<Risk, { label: string; icon: typeof AlertOctagon; className: string }> = {
  out: { label: 'Có đầu sách hết hàng', icon: AlertOctagon, className: 'text-rose-700 dark:text-rose-300' },
  low: { label: 'Dưới ngưỡng tồn', icon: AlertTriangle, className: 'text-amber-700 dark:text-amber-300' },
  ok: { label: 'Ổn định', icon: CheckCircle2, className: 'text-muted-foreground' },
};

function riskOf(item: WarehouseStockRiskItem): Risk {
  if (item.out_of_stock_variants > 0) return 'out';
  if (item.low_stock_variants > 0) return 'low';
  return 'ok';
}

function RiskStatus({ item }: { item: WarehouseStockRiskItem }) {
  const risk = RISK[riskOf(item)];
  const Icon = risk.icon;
  return (
    <span className={cn('mt-0.5 inline-flex items-center gap-1 text-[12px] leading-5', risk.className)} title={item.reasoning || undefined}>
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      {risk.label}
    </span>
  );
}

function countClass(value: number, tone: 'warn' | 'danger') {
  if (value <= 0) return 'text-muted-foreground';
  return tone === 'danger' ? 'font-semibold text-rose-700 dark:text-rose-300' : 'font-semibold text-amber-700 dark:text-amber-300';
}

interface StockRiskOverdueSectionProps {
  canViewBorrow: boolean;
  access: { inventory: boolean; borrow: boolean };
  stockRisk: WarehouseStockRiskItem[] | null;
  overdue: OverdueSummary | null;
  onRetry: () => void;
}

function StockRiskPanel({ stockRisk, canOpenInventory, wide, onRetry, className }: { stockRisk: WarehouseStockRiskItem[] | null; canOpenInventory: boolean; wide: boolean; onRetry: () => void; className?: string }) {
  const rows = [...(stockRisk ?? [])].sort((a, b) =>
    b.out_of_stock_variants - a.out_of_stock_variants
    || b.low_stock_variants - a.low_stock_variants
    || a.warehouse_name.localeCompare(b.warehouse_name, 'vi'));
  const risky = rows.filter((item) => riskOf(item) !== 'ok').length;
  const shown = wide ? rows : rows.slice(0, ROW_LIMIT);
  const hidden = rows.slice(shown.length);
  const hiddenRisky = hidden.filter((item) => riskOf(item) !== 'ok').length;

  return (
    <Panel titleId="stock-risk-title" className={className}>
      <PanelHeader
        id="stock-risk-title"
        title="Rủi ro tồn kho theo kho"
        description={stockRisk && rows.length
          ? <><span className="font-medium text-foreground">{formatNumber(risky)}/{formatNumber(rows.length)}</span> kho có đầu sách dưới ngưỡng hoặc hết hàng</>
          : 'Số đầu sách sắp hết và hết hàng ở từng kho'}
        aside={canOpenInventory ? <PanelLink to="/inventory">Xem tồn kho</PanelLink> : null}
      />
      <PanelBody className="@container pt-2">
        {!stockRisk ? (
          <BlockError what="rủi ro tồn kho" onRetry={onRetry} />
        ) : !rows.length ? (
          <BlockEmpty>Chưa có dữ liệu tồn kho cho kho nào.</BlockEmpty>
        ) : (
          <>
            <table className="hidden w-full text-[13px] @lg:table">
              <caption className="sr-only">Rủi ro tồn kho theo kho, sắp theo mức rủi ro</caption>
              <thead>
                <tr className="border-b border-border text-[12px] text-muted-foreground [&>th]:h-9 [&>th]:whitespace-nowrap [&>th]:font-normal">
                  <th scope="col" className="pr-3 text-left">Kho</th>
                  <th scope="col" className="px-3 text-right">Sắp hết</th>
                  <th scope="col" className="px-3 text-right">Hết hàng</th>
                  <th scope="col" className="hidden px-3 text-right @2xl:table-cell">Giữ chỗ</th>
                  <th scope="col" className="hidden px-3 text-right @2xl:table-cell">Đang mượn</th>
                  <th scope="col" className="pl-3 text-right">Sẵn có</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((item) => (
                  <tr key={item.warehouse_id} className="border-b border-border/70 last:border-0">
                    <th scope="row" className="py-2.5 pr-3 text-left font-normal">
                      <span className="block font-medium leading-5 text-foreground">{item.warehouse_name}</span>
                      <RiskStatus item={item} />
                    </th>
                    <td className={cn('px-3 text-right tabular-nums', countClass(item.low_stock_variants, 'warn'))}>{formatNumber(item.low_stock_variants)}</td>
                    <td className={cn('px-3 text-right tabular-nums', countClass(item.out_of_stock_variants, 'danger'))}>{formatNumber(item.out_of_stock_variants)}</td>
                    <td className="hidden px-3 text-right tabular-nums text-muted-foreground @2xl:table-cell">{formatNumber(item.total_reserved_qty)}</td>
                    <td className="hidden px-3 text-right tabular-nums text-muted-foreground @2xl:table-cell">{formatNumber(item.total_borrowed_qty)}</td>
                    <td className="pl-3 text-right font-medium tabular-nums text-foreground">{formatNumber(item.total_available_qty)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Narrow panels: the same fields as two-line rows, nothing dropped. */}
            <ul className="@lg:hidden">
              {shown.map((item) => (
                <li key={item.warehouse_id} className="border-b border-border/70 py-2.5 last:border-0">
                  <p className="flex items-baseline justify-between gap-3">
                    <span className="min-w-0 truncate text-[13px] font-medium text-foreground">{item.warehouse_name}</span>
                    <span className="shrink-0 text-[13px] font-medium tabular-nums text-foreground">{formatNumber(item.total_available_qty)} <span className="font-normal text-muted-foreground">sẵn có</span></span>
                  </p>
                  <RiskStatus item={item} />
                  <p className="text-[12px] leading-5 text-muted-foreground tabular-nums">
                    Sắp hết <span className={countClass(item.low_stock_variants, 'warn')}>{formatNumber(item.low_stock_variants)}</span>
                    {' · '}Hết hàng <span className={countClass(item.out_of_stock_variants, 'danger')}>{formatNumber(item.out_of_stock_variants)}</span>
                    {' · '}Giữ chỗ {formatNumber(item.total_reserved_qty)}
                  </p>
                </li>
              ))}
            </ul>

            {hidden.length ? (
              <p className="mt-2 text-[12px] leading-5 text-muted-foreground">
                Còn {formatNumber(hidden.length)} kho chưa hiển thị
                {hiddenRisky > 0 ? `, trong đó ${formatNumber(hiddenRisky)} kho có rủi ro` : ', đều ổn định'}.
              </p>
            ) : null}
          </>
        )}
      </PanelBody>
    </Panel>
  );
}

function overdueTone(days: number) {
  if (days >= 30) return 'text-rose-700 dark:text-rose-300';
  if (days >= 7) return 'text-amber-700 dark:text-amber-300';
  return 'text-foreground';
}

function OverduePanel({ overdue, canOpenLoans, onRetry, className }: { overdue: OverdueSummary | null; canOpenLoans: boolean; onRetry: () => void; className?: string }) {
  const items = overdue ? overdue.items.slice(0, ROW_LIMIT) : [];

  return (
    <Panel titleId="overdue-title" className={className}>
      <PanelHeader
        id="overdue-title"
        title="Mượn quá hạn"
        description={overdue && overdue.total_overdue_loans > 0 ? (
          <>
            <span className="font-medium text-foreground">{formatNumber(overdue.total_overdue_loans)}</span> phiếu · {formatNumber(overdue.total_overdue_items)} cuốn · trễ trung bình {formatNumber(Math.round(overdue.average_overdue_days))} ngày
          </>
        ) : overdue ? 'Không có phiếu mượn nào quá hạn' : 'Phiếu mượn đã quá hạn trả'}
        aside={canOpenLoans && overdue && overdue.total_overdue_loans > 0 ? <PanelLink to="/borrow/loans?tab=overdue">Xem tất cả</PanelLink> : null}
      />
      <PanelBody className="pt-2">
        {!overdue ? (
          <BlockError what="phiếu mượn quá hạn" onRetry={onRetry} />
        ) : !items.length ? (
          <BlockEmpty>Mọi phiếu mượn đều còn trong hạn.</BlockEmpty>
        ) : (
          <>
            <div className="flex h-9 items-center justify-between border-b border-border text-[12px] text-muted-foreground" aria-hidden="true">
              <span>Bạn đọc · phiếu mượn</span>
              <span className={canOpenLoans ? 'pr-6' : undefined}>Trễ hạn</span>
            </div>
            <ul aria-label="Phiếu trễ hạn lâu nhất">
              {items.map((item) => {
                const body = (
                  <>
                    <span className="min-w-0">
                      <span className="block truncate text-[13px] font-medium leading-5 text-foreground">{item.customer_name}</span>
                      <span className="mt-0.5 block truncate text-[12px] leading-5 text-muted-foreground">
                        <span className="font-mono">{item.loan_number}</span> · hạn {formatDate(item.due_date)}
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      <span className={cn('text-[13px] font-semibold tabular-nums', overdueTone(item.overdue_days))}>{formatNumber(item.overdue_days)} ngày</span>
                      {canOpenLoans ? <ChevronRight className="h-4 w-4 text-muted-foreground/50 transition-colors group-hover:text-foreground" aria-hidden="true" /> : null}
                    </span>
                  </>
                );
                const row = 'flex items-center justify-between gap-3 py-2.5';
                return (
                  <li key={item.loan_id} className="border-b border-border/70 last:border-0">
                    {canOpenLoans ? (
                      <NavLink
                        to={`/borrow/loans/${item.loan_id}`}
                        className={cn(row, 'group -mx-2 rounded-md px-2 transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40')}
                      >
                        {body}
                      </NavLink>
                    ) : (
                      <div className={row}>{body}</div>
                    )}
                  </li>
                );
              })}
            </ul>
            {overdue.total_overdue_loans > items.length ? (
              <p className="mt-2 text-[12px] leading-5 text-muted-foreground">
                {formatNumber(items.length)} phiếu trễ lâu nhất trong {formatNumber(overdue.total_overdue_loans)} phiếu quá hạn.
              </p>
            ) : null}
          </>
        )}
      </PanelBody>
    </Panel>
  );
}

export function StockRiskOverdueSection({ canViewBorrow, access, stockRisk, overdue, onRetry }: StockRiskOverdueSectionProps) {
  if (!canViewBorrow) {
    return <StockRiskPanel stockRisk={stockRisk} canOpenInventory={access.inventory} wide onRetry={onRetry} />;
  }
  return (
    <div className="grid grid-cols-1 gap-5 @5xl:grid-cols-12">
      <StockRiskPanel stockRisk={stockRisk} canOpenInventory={access.inventory} wide={false} onRetry={onRetry} className="@5xl:col-span-7" />
      <OverduePanel overdue={overdue} canOpenLoans={access.borrow} onRetry={onRetry} className="@5xl:col-span-5" />
    </div>
  );
}
