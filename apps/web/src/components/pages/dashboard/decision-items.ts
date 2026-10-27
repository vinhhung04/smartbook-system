import type { DashboardKpis, FineSummary, OverdueSummary } from '@/services/analytics';
import type { ReorderSummary } from './types';
import { formatMoney, formatNumber } from './utils';

export type Severity = 'urgent' | 'decide' | 'watch';

export interface ActionItem {
  key: string;
  severity: Severity;
  label: string;
  /** `null` when the source request failed: shown as a dash, never as a zero. */
  count: number | null;
  /** Display value when it is not the count itself (money). */
  value?: string;
  detail: string;
  /** Omitted when the user cannot open the destination: the row stays informative but is not a link. */
  to?: string;
  action: string;
}

export const SEVERITY: Record<Severity, { label: string; rank: number; tag: string; count: string }> = {
  urgent: {
    label: 'Khẩn cấp',
    rank: 0,
    tag: 'bg-rose-50 text-rose-700 ring-rose-200 dark:bg-rose-500/10 dark:text-rose-300 dark:ring-rose-500/25',
    count: 'text-rose-700 dark:text-rose-300',
  },
  decide: {
    label: 'Cần quyết định',
    rank: 1,
    tag: 'bg-amber-50 text-amber-800 ring-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-500/25',
    count: 'text-foreground',
  },
  watch: {
    label: 'Theo dõi',
    rank: 2,
    tag: 'bg-muted text-muted-foreground ring-border',
    count: 'text-foreground',
  },
};

export interface DecisionAccess {
  borrow: boolean;
  purchaseRequests: boolean;
  exceptions: boolean;
  reorder: boolean;
  inventory: boolean;
}

export interface DecisionInputs {
  /** analytics.borrow.read: loans and fines rows exist only for these users. */
  canViewBorrow: boolean;
  access: DecisionAccess;
  kpis: DashboardKpis | null;
  overdue: OverdueSummary | null;
  fines: FineSummary | null;
  pendingPR: number | null;
  openER: number | null;
  reorder: ReorderSummary | null;
}

/**
 * One list feeds both the header sentence and the Decision Center, so they never disagree.
 * A row exists only when the user may see its data; it links only when they may open the destination.
 */
export function buildDecisionItems({ canViewBorrow, access, kpis, overdue, fines, pendingPR, openER, reorder }: DecisionInputs): ActionItem[] {
  const items: ActionItem[] = [];
  if (canViewBorrow) {
    items.push({
      key: 'overdue',
      severity: 'urgent',
      label: 'Phiếu mượn quá hạn',
      count: kpis ? kpis.overdue_loans : null,
      detail: overdue && overdue.total_overdue_loans > 0
        ? `${formatNumber(overdue.total_overdue_items)} cuốn chưa trả · lâu nhất ${formatNumber(overdue.oldest_overdue_days)} ngày`
        : 'Bạn đọc chưa trả sách đúng hạn',
      to: access.borrow ? '/borrow/loans?tab=overdue' : undefined,
      action: 'Xử lý',
    });
  }
  if (access.exceptions) {
    items.push({
      key: 'exceptions',
      severity: 'urgent',
      label: 'Sự cố kho chưa xử lý',
      count: openER,
      detail: 'Nhân viên kho báo cáo, đang chờ xử lý',
      to: '/exception-reports',
      action: 'Xem sự cố',
    });
  }
  if (access.purchaseRequests) {
    items.push({
      key: 'purchase-requests',
      severity: 'decide',
      label: 'Yêu cầu mua hàng chờ duyệt',
      count: pendingPR,
      detail: 'Duyệt để chuyển thành đơn mua',
      to: '/purchase-requests',
      action: 'Duyệt',
    });
  }
  if (access.reorder) {
    items.push({
      key: 'reorder',
      severity: 'decide',
      label: 'Đề xuất nhập thêm ưu tiên cao',
      count: reorder ? reorder.high_priority : null,
      detail: reorder && reorder.total_candidates > 0
        ? `Trong ${formatNumber(reorder.total_candidates)} đề xuất · khoảng ${formatNumber(reorder.estimated_total_reorder_qty)} cuốn`
        : 'Gợi ý từ lượt mượn và đặt trước',
      to: '/reorder-suggestions',
      action: 'Xem đề xuất',
    });
  }
  if (access.inventory) {
    items.push({
      key: 'low-stock',
      severity: 'decide',
      label: 'Đầu sách dưới ngưỡng tồn',
      count: kpis ? kpis.low_stock_variants : null,
      detail: 'Cần bổ sung trước khi hết hàng',
      to: '/inventory',
      action: 'Xem tồn kho',
    });
  }
  if (canViewBorrow) {
    items.push({
      key: 'fines',
      severity: 'watch',
      label: 'Tiền phạt chưa thu',
      count: fines ? fines.unpaid_count : null,
      value: fines ? formatMoney(fines.total_unpaid) : undefined,
      detail: fines ? `${formatNumber(fines.unpaid_count)} khoản chưa thu` : 'Khoản phạt bạn đọc chưa trả',
      to: access.borrow ? '/borrow/fines?tab=open' : undefined,
      action: 'Xem khoản phạt',
    });
  }
  return items;
}
