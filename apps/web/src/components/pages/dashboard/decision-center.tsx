import { NavLink } from 'react-router';
import { AlertTriangle, CheckCircle2, ChevronRight, Clock, Receipt, ShoppingCart, Sparkles, Warehouse, type LucideIcon } from 'lucide-react';
import { cn } from '@/components/ui/utils';

type Severity = 'urgent' | 'decide' | 'watch';

interface ActionItem {
  to: string;
  icon: LucideIcon;
  count: number;
  value?: string;
  label: string;
  detail?: string;
}

const GROUPS: { severity: Severity; title: string; hint: string }[] = [
  { severity: 'urgent', title: 'Khẩn cấp', hint: 'Ảnh hưởng trực tiếp tới bạn đọc hoặc kho' },
  { severity: 'decide', title: 'Chờ quyết định', hint: 'Cần bạn duyệt hoặc lên kế hoạch' },
  { severity: 'watch', title: 'Theo dõi', hint: 'Không gấp nhưng đang tồn đọng' },
];

const SEVERITY_STYLE: Record<Severity, { dot: string; icon: string; count: string }> = {
  urgent: { dot: 'bg-rose-500', icon: 'bg-rose-50 text-rose-600 dark:bg-rose-500/10 dark:text-rose-400', count: 'text-rose-700 dark:text-rose-300' },
  decide: { dot: 'bg-amber-500', icon: 'bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-400', count: 'text-foreground' },
  watch: { dot: 'bg-slate-400', icon: 'bg-muted text-muted-foreground', count: 'text-foreground' },
};

function compactMoney(value: number) {
  return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND', notation: 'compact', maximumFractionDigits: 1 }).format(value || 0);
}

function ActionRow({ item, severity }: { item: ActionItem; severity: Severity }) {
  const Icon = item.icon;
  const done = item.count === 0;
  const style = SEVERITY_STYLE[severity];
  return (
    <li>
      <NavLink
        to={item.to}
        className="group -mx-2 flex items-center gap-3 rounded-lg px-2 py-2.5 transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
      >
        <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg', done ? 'bg-muted text-muted-foreground' : style.icon)}>
          {done ? <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> : <Icon className="h-4 w-4" aria-hidden="true" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className={cn('block text-[13px] font-medium', done ? 'text-muted-foreground' : 'text-foreground')}>{item.label}</span>
          <span className="block truncate text-[12px] text-muted-foreground">{done ? 'Không có mục nào' : item.detail}</span>
        </span>
        {done ? null : (
          <span className={cn('shrink-0 text-[20px] font-semibold leading-none', style.count)}>{item.value ?? item.count.toLocaleString('vi-VN')}</span>
        )}
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/40 transition-colors group-hover:text-muted-foreground" aria-hidden="true" />
      </NavLink>
    </li>
  );
}

interface DecisionCenterProps {
  pendingPR: number;
  openER: number;
  lowStockVariants: number;
  overdueLoans: number;
  overdueItems: number;
  oldestOverdueDays: number;
  unpaidFineCount: number;
  unpaidFineAmount: number;
  highPriorityReorder: number;
  reorderCandidates: number;
  reorderQty: number;
}

export function DecisionCenter({
  pendingPR,
  openER,
  lowStockVariants,
  overdueLoans,
  overdueItems,
  oldestOverdueDays,
  unpaidFineCount,
  unpaidFineAmount,
  highPriorityReorder,
  reorderCandidates,
  reorderQty,
}: DecisionCenterProps) {
  const items: Record<Severity, ActionItem[]> = {
    urgent: [
      {
        to: '/borrow/loans?status=OVERDUE',
        icon: Clock,
        count: overdueLoans,
        label: 'Phiếu mượn quá hạn',
        detail: `${overdueItems.toLocaleString('vi-VN')} cuốn chưa trả · lâu nhất ${oldestOverdueDays.toLocaleString('vi-VN')} ngày`,
      },
      { to: '/exception-reports?status=OPEN', icon: AlertTriangle, count: openER, label: 'Sự cố chưa xử lý', detail: 'Báo cáo từ nhân viên kho đang mở' },
    ],
    decide: [
      { to: '/purchase-requests?status=PENDING', icon: ShoppingCart, count: pendingPR, label: 'Yêu cầu mua hàng chờ duyệt', detail: 'Duyệt để chuyển sang mua hàng' },
      {
        to: '/reorder-suggestions',
        icon: Sparkles,
        count: highPriorityReorder,
        label: 'Đề xuất nhập thêm ưu tiên cao',
        detail: reorderCandidates > 0
          ? `Trong ${reorderCandidates.toLocaleString('vi-VN')} đề xuất · tổng ~${reorderQty.toLocaleString('vi-VN')} cuốn`
          : 'Gợi ý từ lượt mượn và đặt trước',
      },
      { to: '/inventory', icon: Warehouse, count: lowStockVariants, label: 'Đầu sách sắp hết hàng', detail: 'Tồn dưới ngưỡng cảnh báo' },
    ],
    watch: [
      {
        to: '/borrow/fines?status=UNPAID',
        icon: Receipt,
        count: unpaidFineCount,
        value: compactMoney(unpaidFineAmount),
        label: 'Tiền phạt chưa thu',
        detail: `${unpaidFineCount.toLocaleString('vi-VN')} khoản chưa trả`,
      },
    ],
  };

  const openCount = Object.values(items).flat().filter((item) => item.count > 0).length;

  return (
    <section aria-labelledby="decision-center-title" className="rounded-xl border border-border bg-card">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-border px-5 py-4">
        <h2 id="decision-center-title" className="text-[16px] font-semibold text-foreground">Việc cần xử lý hôm nay</h2>
        <p className="text-[13px] text-muted-foreground">
          {openCount > 0 ? <><span className="font-semibold text-foreground">{openCount}</span> đầu việc đang chờ</> : 'Mọi thứ đã được xử lý'}
        </p>
      </div>
      <div className="grid grid-cols-1 divide-y divide-border lg:grid-cols-3 lg:divide-x lg:divide-y-0">
        {GROUPS.map((group) => (
          <div key={group.severity} className="px-5 py-4">
            <div className="mb-1.5 flex items-center gap-2">
              <span className={cn('h-2 w-2 rounded-full', SEVERITY_STYLE[group.severity].dot)} aria-hidden="true" />
              <h3 className="text-[12px] font-semibold text-foreground" title={group.hint}>{group.title}</h3>
            </div>
            <ul>
              {items[group.severity].map((item) => <ActionRow key={item.to} item={item} severity={group.severity} />)}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
