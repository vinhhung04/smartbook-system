import { Fragment } from 'react';
import { NavLink } from 'react-router';
import { Clock, Warehouse } from 'lucide-react';
import { SectionCard } from '@/components/ui/section-card';
import { EmptyState } from '@/components/ui/empty-state';
import type { OverdueSummary, WarehouseStockRiskItem } from '@/services/analytics';

interface StockRiskOverdueSectionProps {
  stockRisk: WarehouseStockRiskItem[];
  overdue: OverdueSummary;
}

export function StockRiskOverdueSection({ stockRisk, overdue }: StockRiskOverdueSectionProps) {
  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
      <SectionCard title="Rủi ro tồn kho theo kho" subtitle="Biến thể sắp hết và hết hàng theo kho" icon={Warehouse}>
        {stockRisk.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-left text-[13px]">
              <thead className="text-[11px] uppercase text-muted-foreground">
                <tr className="border-b border-border">
                  <th className="py-2 pr-3 font-medium">Kho</th>
                  <th className="py-2 pr-3 font-medium">Sắp hết</th>
                  <th className="py-2 pr-3 font-medium">Hết hàng</th>
                  <th className="py-2 pr-3 font-medium">Khả dụng</th>
                  <th className="py-2 pr-3 font-medium">Đang đặt</th>
                  <th className="py-2 pr-3 font-medium">Đang mượn</th>
                </tr>
              </thead>
              <tbody>
                {stockRisk.map((item) => {
                  const hasRisk = item.low_stock_variants > 0 || item.out_of_stock_variants > 0;
                  return (
                    <Fragment key={item.warehouse_id}>
                      <tr className={`border-b border-border/60 last:border-0 hover:bg-muted/30 transition-colors ${hasRisk && item.reasoning ? 'border-b-0' : ''}`}>
                        <td className="py-3 pr-3 font-medium">{item.warehouse_name}</td>
                        <td className="py-3 pr-3 text-amber-700 dark:text-amber-400 font-semibold">{item.low_stock_variants}</td>
                        <td className="py-3 pr-3 text-rose-700 dark:text-rose-400 font-semibold">{item.out_of_stock_variants}</td>
                        <td className="py-3 pr-3">{item.total_available_qty}</td>
                        <td className="py-3 pr-3">{item.total_reserved_qty}</td>
                        <td className="py-3 pr-3">{item.total_borrowed_qty}</td>
                      </tr>
                      {hasRisk && item.reasoning ? (
                        <tr className="border-b border-border/60 last:border-0">
                          <td colSpan={6} className="pb-3 pt-0 text-[11px] italic text-muted-foreground">{item.reasoning}</td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState variant="no-data" title="Chưa có dữ liệu tồn kho" description="Rủi ro tồn kho sẽ hiển thị sau khi có dữ liệu tồn kho." />
        )}
      </SectionCard>

      <SectionCard
        title="Mượn quá hạn"
        subtitle={`Trung bình ${overdue.average_overdue_days} ngày · ${overdue.total_overdue_loans} phiếu · lâu nhất ${overdue.oldest_overdue_days} ngày`}
        icon={Clock}
      >
        {overdue.items.length ? (
          <div className="space-y-2">
            {overdue.items.slice(0, 6).map((item) => (
              <NavLink
                key={item.loan_id}
                to={`/borrow/loans/${item.loan_id}`}
                className="flex items-center justify-between rounded-lg border border-rose-100 bg-rose-50/40 px-3 py-2 dark:border-rose-500/15 dark:bg-rose-500/5 hover:bg-rose-50 dark:hover:bg-rose-500/10 transition-colors"
              >
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-medium">{item.loan_number}</p>
                  <p className="truncate text-[12px] text-muted-foreground">{item.customer_name}</p>
                </div>
                <div className="text-right shrink-0 ml-2">
                  <p className="text-[13px] font-semibold text-rose-700 dark:text-rose-400">{item.overdue_days} ngày</p>
                  <p className="text-[12px] text-muted-foreground">{item.due_date ? item.due_date.slice(0, 10) : 'Không có hạn'}</p>
                </div>
              </NavLink>
            ))}
          </div>
        ) : (
          <EmptyState variant="no-data" title="Không có mượn quá hạn" description="Tốt lắm — hiện tại không có mục mượn nào quá hạn." />
        )}
      </SectionCard>
    </div>
  );
}
