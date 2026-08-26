import { NavLink } from 'react-router';
import { motion } from 'motion/react';
import { AlertTriangle, Clock, Receipt, ShoppingCart, Sparkles, Warehouse } from 'lucide-react';
import { DECISION_COLORS } from './types';
import { formatMoney } from './utils';

interface DecisionCenterProps {
  pendingPR: number;
  openER: number;
  lowStockVariants: number;
  overdueLoans: number;
  unpaidFineCount: number;
  unpaidFineAmount: number;
  highPriorityReorder: number;
}

export function DecisionCenter({
  pendingPR,
  openER,
  lowStockVariants,
  overdueLoans,
  unpaidFineCount,
  unpaidFineAmount,
  highPriorityReorder,
}: DecisionCenterProps) {
  const items = [
    { to: '/purchase-requests?status=PENDING', icon: ShoppingCart, count: pendingPR, label: 'Yêu cầu mua hàng chờ duyệt', color: 'orange' },
    { to: '/exception-reports?status=OPEN', icon: AlertTriangle, count: openER, label: 'Báo cáo sự cố chưa xử lý', color: 'red' },
    { to: '/inventory', icon: Warehouse, count: lowStockVariants, label: 'Đầu sách tồn kho thấp', color: 'amber' },
    { to: '/borrow/loans?status=OVERDUE', icon: Clock, count: overdueLoans, label: 'Phiếu mượn quá hạn', color: 'rose' },
    {
      to: '/borrow/fines?status=UNPAID',
      icon: Receipt,
      count: unpaidFineCount,
      label: unpaidFineCount > 0 ? `Tiền phạt chưa thu (${formatMoney(unpaidFineAmount)})` : 'Tiền phạt chưa thu',
      color: 'violet',
    },
    { to: '/reorder-suggestions', icon: Sparkles, count: highPriorityReorder, label: 'Cần nhập thêm hàng', color: 'blue' },
  ] as const;

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <div>
          <h2 className="text-[15px] font-semibold text-foreground">Việc cần xử lý hôm nay</h2>
          <p className="text-[12px] text-muted-foreground mt-0.5">Các mục cần quyết định hoặc theo dõi ngay</p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {items.map((item, index) => {
          const active = item.count > 0;
          const colors = DECISION_COLORS[item.color];
          const Icon = item.icon;
          return (
            <NavLink key={item.to} to={item.to}>
              <motion.div
                initial={{ opacity: 0, scale: 0.92 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.2, delay: index * 0.03 }}
                whileHover={{ scale: 1.03 }}
                whileTap={{ scale: 0.98 }}
                className={`inline-flex h-11 items-center gap-2 rounded-full border pl-3 pr-3.5 transition-colors cursor-pointer ${active ? colors.pill : 'border-border bg-muted/50 hover:bg-muted'}`}
              >
                <Icon className={`h-4 w-4 shrink-0 ${active ? colors.iconColor : 'text-muted-foreground'}`} />
                <span className={`text-[13px] font-bold tabular-nums ${active ? colors.text : 'text-muted-foreground'}`}>{item.count}</span>
                <span className="text-[13px] text-foreground">{item.label}</span>
              </motion.div>
            </NavLink>
          );
        })}
      </div>
    </div>
  );
}
