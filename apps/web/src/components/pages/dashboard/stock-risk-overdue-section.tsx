import { NavLink } from 'react-router';
import { ChevronRight } from 'lucide-react';
import { EmptyState } from '@/components/ui/empty-state';
import { cn } from '@/components/ui/utils';
import type { OverdueSummary, WarehouseStockRiskItem } from '@/services/analytics';

interface StockRiskOverdueSectionProps {
  stockRisk: WarehouseStockRiskItem[];
  overdue: OverdueSummary;
}

function formatDate(value: string | null) {
  if (!value) return 'Không có hạn';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value.slice(0, 10) : date.toLocaleDateString('vi-VN');
}

export function StockRiskOverdueSection({ stockRisk, overdue }: StockRiskOverdueSectionProps) {
  const riskyWarehouses = stockRisk.filter((item) => item.low_stock_variants > 0 || item.out_of_stock_variants > 0).length;

  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
      <section aria-labelledby="stock-risk-title" className="rounded-xl border border-border bg-card p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h3 id="stock-risk-title" className="text-[14px] font-semibold text-foreground">Rủi ro tồn kho theo kho</h3>
          <NavLink to="/inventory" className="text-[13px] font-medium text-indigo-600 hover:underline dark:text-indigo-400">Xem tồn kho</NavLink>
        </div>
        <p className="mt-1 text-[13px] text-muted-foreground">
          {stockRisk.length ? `${riskyWarehouses}/${stockRisk.length} kho có đầu sách sắp hết hoặc đã hết` : 'Số đầu sách sắp hết và hết hàng ở từng kho'}
        </p>
        <div className="mt-4">
          {stockRisk.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-border text-left text-[12px] text-muted-foreground [&>th]:whitespace-nowrap">
                    <th className="py-2 pr-3 font-medium">Kho</th>
                    <th className="py-2 pr-3 text-right font-medium">Sắp hết</th>
                    <th className="py-2 pr-3 text-right font-medium">Hết hàng</th>
                    <th className="py-2 pr-3 text-right font-medium">Sẵn có</th>
                    <th className="hidden py-2 pr-3 text-right font-medium 2xl:table-cell">Đang giữ</th>
                    <th className="hidden py-2 text-right font-medium 2xl:table-cell">Đang mượn</th>
                  </tr>
                </thead>
                <tbody>
                  {stockRisk.map((item) => {
                    const hasRisk = item.low_stock_variants > 0 || item.out_of_stock_variants > 0;
                    return (
                      <tr key={item.warehouse_id} className="border-b border-border align-top last:border-0">
                        <td className="py-3 pr-3">
                          <p className="font-medium text-foreground">{item.warehouse_name}</p>
                          {hasRisk && item.reasoning ? (
                            <p className="mt-0.5 line-clamp-2 max-w-[42ch] text-[12px] leading-4 text-muted-foreground" title={item.reasoning}>{item.reasoning}</p>
                          ) : null}
                        </td>
                        <td className={cn('py-3 pr-3 text-right tabular-nums', item.low_stock_variants > 0 ? 'font-semibold text-amber-700 dark:text-amber-400' : 'text-muted-foreground')}>{item.low_stock_variants}</td>
                        <td className={cn('py-3 pr-3 text-right tabular-nums', item.out_of_stock_variants > 0 ? 'font-semibold text-rose-700 dark:text-rose-400' : 'text-muted-foreground')}>{item.out_of_stock_variants}</td>
                        <td className="py-3 pr-3 text-right tabular-nums">{item.total_available_qty.toLocaleString('vi-VN')}</td>
                        <td className="hidden py-3 pr-3 text-right tabular-nums text-muted-foreground 2xl:table-cell">{item.total_reserved_qty.toLocaleString('vi-VN')}</td>
                        <td className="hidden py-3 text-right tabular-nums text-muted-foreground 2xl:table-cell">{item.total_borrowed_qty.toLocaleString('vi-VN')}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState variant="no-data" title="Chưa có dữ liệu tồn kho" description="Rủi ro tồn kho sẽ hiển thị sau khi có dữ liệu tồn kho." />
          )}
        </div>
      </section>

      <section aria-labelledby="overdue-title" className="rounded-xl border border-border bg-card p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h3 id="overdue-title" className="text-[14px] font-semibold text-foreground">Mượn quá hạn</h3>
          <NavLink to="/borrow/loans?status=OVERDUE" className="text-[13px] font-medium text-indigo-600 hover:underline dark:text-indigo-400">Xem tất cả</NavLink>
        </div>
        <p className="mt-1 text-[13px] text-muted-foreground">
          {overdue.total_overdue_loans > 0 ? (
            <>
              <span className="font-semibold text-foreground">{overdue.total_overdue_loans.toLocaleString('vi-VN')}</span> phiếu · trễ trung bình {Math.round(overdue.average_overdue_days).toLocaleString('vi-VN')} ngày · lâu nhất {overdue.oldest_overdue_days.toLocaleString('vi-VN')} ngày
            </>
          ) : 'Không có phiếu mượn nào quá hạn'}
        </p>
        <div className="mt-3">
          {overdue.items.length ? (
            <ul>
              {overdue.items.slice(0, 6).map((item) => (
                <li key={item.loan_id} className="border-b border-border last:border-0">
                  <NavLink
                    to={`/borrow/loans/${item.loan_id}`}
                    className="group -mx-2 flex items-center justify-between gap-3 rounded-md px-2 py-2.5 transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-[13px] font-medium text-foreground">{item.customer_name}</span>
                      <span className="block truncate font-mono text-[12px] text-muted-foreground">{item.loan_number} · hạn {formatDate(item.due_date)}</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      <span className="text-[13px] font-semibold tabular-nums text-rose-700 dark:text-rose-400">{item.overdue_days.toLocaleString('vi-VN')} ngày</span>
                      <ChevronRight className="h-4 w-4 text-muted-foreground/40 transition-colors group-hover:text-muted-foreground" aria-hidden="true" />
                    </span>
                  </NavLink>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState variant="no-data" title="Không có mượn quá hạn" description="Hiện tại không có mục mượn nào quá hạn." />
          )}
        </div>
      </section>
    </div>
  );
}
