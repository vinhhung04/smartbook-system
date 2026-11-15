import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { motion } from 'motion/react';
import { BookMarked, Users, CalendarClock, CircleAlert, ChevronRight, RefreshCw, CheckCircle2, type LucideIcon } from 'lucide-react';
import { useBookTitles } from './borrow-shared/use-book-titles';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import { cn } from '@/components/ui/utils';
import { borrowService, type Loan } from '@/services/borrow';
import { getApiErrorMessage } from '@/services/api';
import { toast } from 'sonner';

const DAY_MS = 24 * 60 * 60 * 1000;
const DUE_SOON_DAYS = 3;
const WORKLIST_LIMIT = 8;
const WORKLIST_FETCH = 30;

type Tone = 'rose' | 'sky' | 'amber';

const TONE_VALUE: Record<Tone, string> = {
  rose: 'text-red-700 dark:text-red-400',
  sky: 'text-foreground',
  amber: 'text-amber-700 dark:text-amber-300',
};

interface AttentionTile {
  to: string;
  label: string;
  hint: string;
  value: number;
  display?: string;
  tone: Tone;
}

interface WorklistItem {
  loan: Loan;
  overdue: boolean;
  label: string;
  days: number;
}

interface JourneyStep {
  to: string;
  icon: LucideIcon;
  label: string;
  desc: string;
  metric: string | number;
  metricLabel: string;
}

/** "494,4 tr" — the full amount does not fit a stat tile once it reaches hundreds of millions. */
function formatCompactVnd(value: number) {
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toLocaleString('vi-VN', { maximumFractionDigits: 1 })} tỷ`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toLocaleString('vi-VN', { maximumFractionDigits: 1 })} tr`;
  return value.toLocaleString('vi-VN');
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '-' : date.toLocaleDateString('vi-VN');
}

export function BorrowPage() {
  const [loanCounts, setLoanCounts] = useState<Record<string, number>>({});
  const [reservationCounts, setReservationCounts] = useState<Record<string, number>>({});
  const [customerCounts, setCustomerCounts] = useState<Record<string, number>>({});
  const [fineOutstanding, setFineOutstanding] = useState(0);
  const [fineSummary, setFineSummary] = useState<{ collected: number; open_count: number } | null>(null);
  const bookTitle = useBookTitles();
  const [openLoans, setOpenLoans] = useState<Loan[]>([]);
  const [loading, setLoading] = useState(true);

  // Counts come from the server's per-status totals; the worklist is the loans still out,
  // earliest due first (so the longest overdue lead).
  const loadDashboard = async () => {
    try {
      setLoading(true);
      const [loanResp, reservationResp, customerResp, fineResp] = await Promise.all([
        borrowService.getLoans({ status: 'BORROWED,OVERDUE', sort: 'due_date', pageSize: WORKLIST_FETCH }),
        borrowService.getReservations({ pageSize: 1 }),
        borrowService.getCustomers({ pageSize: 1 }),
        borrowService.getFines({ pageSize: 1, summary: 1 }),
      ]);
      setOpenLoans(loanResp.data || []);
      setLoanCounts(loanResp.meta.status_counts ?? {});
      setReservationCounts(reservationResp.meta.status_counts ?? {});
      setCustomerCounts(customerResp.meta.status_counts ?? {});
      setFineOutstanding(fineResp.meta.summary?.outstanding ?? 0);
      setFineSummary(fineResp.meta.summary ? { collected: fineResp.meta.summary.collected ?? 0, open_count: fineResp.meta.summary.open_count ?? 0 } : null);
    } catch (error) {
      toast.error(getApiErrorMessage(error, 'Không tải được tổng quan mượn trả'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadDashboard();
  }, []);

  const summary = useMemo(() => {
    const now = Date.now();
    const worklist: WorklistItem[] = [];
    for (const loan of openLoans) {
      const due = new Date(loan.due_date).getTime();
      if (Number.isNaN(due)) continue;
      if (loan.status === 'OVERDUE' || due < now) {
        const days = Math.max(1, Math.ceil((now - due) / DAY_MS));
        worklist.push({ loan, overdue: true, days, label: `Quá hạn ${days} ngày` });
      } else if (due - now <= DUE_SOON_DAYS * DAY_MS) {
        const days = Math.floor((due - now) / DAY_MS);
        worklist.push({ loan, overdue: false, days, label: days === 0 ? 'Đến hạn hôm nay' : `Còn ${days} ngày` });
      }
    }

    return {
      activeCustomers: customerCounts.ACTIVE ?? 0,
      pendingReservations: reservationCounts.PENDING ?? 0,
      inProgressReservations: (reservationCounts.PENDING ?? 0) + (reservationCounts.CONFIRMED ?? 0) + (reservationCounts.READY_FOR_PICKUP ?? 0),
      readyReservations: reservationCounts.READY_FOR_PICKUP ?? 0,
      activeLoans: (loanCounts.BORROWED ?? 0) + (loanCounts.OVERDUE ?? 0) + (loanCounts.RESERVED ?? 0),
      overdueCount: loanCounts.OVERDUE ?? 0,
      totalFineBalance: fineOutstanding,
      worklist,
    };
  }, [openLoans, loanCounts, reservationCounts, customerCounts, fineOutstanding]);

  const tiles: AttentionTile[] = [
    { to: '/borrow/loans?tab=overdue', label: 'Quá hạn', hint: 'phiếu mượn cần thu hồi', value: summary.overdueCount, tone: 'rose' },
    { to: '/borrow/reservations?tab=ready', label: 'Chờ khách lấy', hint: 'đặt trước chờ khách đến', value: summary.readyReservations, tone: 'sky' },
    { to: '/borrow/reservations?tab=pending', label: 'Chờ xác nhận', hint: 'đặt trước chưa xử lý', value: summary.pendingReservations, tone: 'amber' },
    {
      to: '/borrow/fines',
      label: 'Dư nợ tiền phạt',
      hint: `${summary.totalFineBalance.toLocaleString('vi-VN')} VND chưa thu`,
      value: summary.totalFineBalance,
      display: formatCompactVnd(summary.totalFineBalance),
      tone: 'rose',
    },
  ];

  const journeySteps: JourneyStep[] = [
    {
      to: '/borrow/customers',
      icon: Users,
      label: 'Khách hàng',
      desc: 'Tạo, cập nhật, kiểm tra điều kiện mượn',
      metric: loading ? '-' : summary.activeCustomers,
      metricLabel: 'đang hoạt động',
    },
    {
      to: '/borrow/reservations',
      icon: CalendarClock,
      label: 'Đặt trước',
      desc: 'Đặt, xác nhận và hủy theo tồn kho thực',
      metric: loading ? '-' : summary.inProgressReservations,
      metricLabel: 'đang xử lý',
    },
    {
      to: '/borrow/loans',
      icon: BookMarked,
      label: 'Phiếu mượn',
      desc: 'Lập phiếu từ đặt trước, xử lý trả sách',
      metric: loading ? '-' : summary.activeLoans,
      metricLabel: 'đang mượn',
    },
    {
      to: '/borrow/fines',
      icon: CircleAlert,
      label: 'Tiền phạt',
      desc: 'Ghi nhận thanh toán, miễn giảm',
      metric: loading ? '-' : formatCompactVnd(summary.totalFineBalance),
      metricLabel: 'VND dư nợ',
    },
  ];

  const visibleWork = summary.worklist.slice(0, WORKLIST_LIMIT);
  // The worklist only holds the first few loans; the rest of the overdue total is linked.
  const hiddenOverdue = Math.max(0, summary.overdueCount - visibleWork.filter((item) => item.overdue).length);

  const vn = (value: number) => value.toLocaleString('vi-VN');
  const onTime = loanCounts.BORROWED ?? 0;
  const lede = loading
    ? 'Việc cần xử lý hôm nay và lối vào từng khâu mượn trả.'
    : `${vn(summary.overdueCount)} phiếu mượn quá hạn, ${vn(onTime)} phiếu còn trong hạn. ${
        summary.totalFineBalance > 0 ? `${formatCompactVnd(summary.totalFineBalance)} VND tiền phạt chưa thu${fineSummary?.open_count ? ` trên ${vn(fineSummary.open_count)} khoản` : ''}.` : 'Không còn tiền phạt chưa thu.'
      }${summary.inProgressReservations === 0 ? ' Không có đặt trước nào chờ xử lý.' : ` ${vn(summary.inProgressReservations)} đặt trước đang xử lý.`}`;
  const bookList = (loan: Loan) => {
    const titles = (loan.loan_items ?? []).map((item) => bookTitle(item.variant_id));
    if (titles.length === 0) return `${loan.total_items} cuốn`;
    return titles.length > 1 ? `${titles[0]} và ${titles.length - 1} cuốn khác` : titles[0];
  };
  const breakdown: Array<{ title: string; to: string; rows: Array<{ label: string; value: string; tone?: string }> }> = [
    {
      title: 'Phiếu mượn',
      to: '/borrow/loans',
      rows: [
        { label: 'Đang mượn, trong hạn', value: vn(onTime) },
        { label: 'Quá hạn', value: vn(loanCounts.OVERDUE ?? 0), tone: (loanCounts.OVERDUE ?? 0) > 0 ? 'text-red-700 dark:text-red-400' : undefined },
        { label: 'Báo mất', value: vn(loanCounts.LOST ?? 0) },
        { label: 'Đã trả', value: vn((loanCounts.RETURNED ?? 0) + (loanCounts.RETURNED_LATE ?? 0)) },
      ],
    },
    {
      title: 'Đặt trước',
      to: '/borrow/reservations',
      rows: [
        { label: 'Đang xử lý', value: vn(summary.inProgressReservations) },
        { label: 'Đã thành phiếu mượn', value: vn(reservationCounts.CONVERTED_TO_LOAN ?? 0) },
        { label: 'Hết hạn', value: vn(reservationCounts.EXPIRED ?? 0) },
        { label: 'Đã hủy', value: vn(reservationCounts.CANCELLED ?? 0) },
      ],
    },
    {
      title: 'Tiền phạt',
      to: '/borrow/fines',
      rows: [
        { label: 'Chưa thu', value: `${formatCompactVnd(summary.totalFineBalance)} VND`, tone: summary.totalFineBalance > 0 ? 'text-red-700 dark:text-red-400' : undefined },
        { label: 'Đã thu', value: fineSummary ? `${formatCompactVnd(fineSummary.collected)} VND` : '-' },
        { label: 'Khoản chưa tất toán', value: fineSummary ? vn(fineSummary.open_count) : '-' },
      ],
    },
    {
      title: 'Bạn đọc',
      to: '/borrow/customers',
      rows: [
        { label: 'Đang hoạt động', value: vn(summary.activeCustomers) },
        { label: 'Tạm khóa', value: vn(customerCounts.SUSPENDED ?? 0) },
      ],
    },
  ];

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-4 sm:p-6 lg:p-8">
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, ease: 'easeOut' }}>
        <PageHeader
          icon={BookMarked}
          title="Quản lý mượn trả"
          description={lede}
          actions={
            <Button variant="outline" size="sm" onClick={() => void loadDashboard()} disabled={loading} className="gap-2">
              <RefreshCw className={cn('h-4 w-4 motion-reduce:animate-none', loading && 'animate-spin')} />
              Làm mới
            </Button>
          }
        />
      </motion.div>

      {/* What needs a person today: one strip, each cell opens its filtered list. */}
      <motion.section
        aria-label="Cần xử lý"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.05, ease: 'easeOut' }}
        className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-border bg-border lg:grid-cols-4"
      >
        {tiles.map((tile) => {
          const active = !loading && tile.value > 0;
          return (
            <Link
              key={tile.label}
              to={tile.to}
              className="group bg-card p-4 transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40 sm:p-5"
            >
              <span className="flex items-center justify-between gap-2 text-[13px] text-muted-foreground">
                {tile.label}
                <ChevronRight className="h-4 w-4 shrink-0 opacity-0 transition-opacity group-hover:opacity-100" aria-hidden="true" />
              </span>
              <span className={cn('mt-1 block font-display text-[28px] font-semibold leading-tight tabular-nums', active ? TONE_VALUE[tile.tone] : 'text-muted-foreground')}>
                {loading ? '-' : tile.display ?? vn(tile.value)}
              </span>
              <span className="mt-1 block truncate text-[12px] text-muted-foreground">{active || loading ? tile.hint : 'Không có gì cần xử lý'}</span>
            </Link>
          );
        })}
      </motion.section>

      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <motion.section
          aria-labelledby="borrow-worklist-title"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.1, ease: 'easeOut' }}
          className="min-w-0 overflow-hidden rounded-2xl border border-border bg-card"
        >
          <div className="flex flex-wrap items-start justify-between gap-3 px-5 pb-3 pt-4">
            <div className="min-w-0">
              <h2 id="borrow-worklist-title" className="font-display text-[18px] font-semibold tracking-tight">Phiếu mượn cần theo dõi</h2>
              <p className="mt-0.5 text-[13px] text-muted-foreground">Quá hạn lâu nhất ở trên, rồi các phiếu đến hạn trong {DUE_SOON_DAYS} ngày tới.</p>
            </div>
            <Button asChild variant="ghost" size="sm">
              <Link to="/borrow/loans">Xem tất cả</Link>
            </Button>
          </div>
          {loading ? (
            <div className="space-y-2 border-t border-border p-4" aria-busy="true">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="h-14 animate-pulse rounded-lg bg-muted/60" />
              ))}
            </div>
          ) : visibleWork.length === 0 ? (
            <div className="flex flex-col items-center gap-2 border-t border-border px-6 py-12 text-center">
              <CheckCircle2 className="h-8 w-8 text-primary" aria-hidden="true" />
              <p className="text-[14px] font-semibold text-foreground">Không có phiếu nào quá hạn hoặc sắp đến hạn</p>
              <p className="text-[13px] text-muted-foreground">Danh sách này tự cập nhật khi bạn bấm Làm mới.</p>
            </div>
          ) : (
            <ul className="divide-y divide-border border-t border-border">
              {visibleWork.map(({ loan, overdue, label }) => (
                <li key={loan.id}>
                  <Link
                    to={`/borrow/loans/${loan.id}`}
                    className="flex items-start gap-3 px-5 py-3 transition-colors hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:outline-none"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[14px] font-semibold text-foreground">{loan.customers?.full_name || 'Khách hàng'}</p>
                      <p className="truncate text-[13px] text-foreground/80" title={bookList(loan)}>{bookList(loan)}</p>
                      <p className="mt-0.5 flex flex-wrap gap-x-2 text-[12px] text-muted-foreground">
                        <span className="font-mono">{loan.loan_number}</span>
                        <span className="tabular-nums">{loan.total_items} cuốn, hạn {formatDate(loan.due_date)}</span>
                      </p>
                    </div>
                    <span className={cn('shrink-0 whitespace-nowrap pt-0.5 text-[13px] font-semibold tabular-nums', overdue ? 'text-red-700 dark:text-red-400' : 'text-amber-700 dark:text-amber-300')}>
                      {label}
                    </span>
                    <ChevronRight className="mt-0.5 hidden h-4 w-4 shrink-0 text-muted-foreground/60 sm:block" aria-hidden="true" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {hiddenOverdue > 0 ? (
            <div className="border-t border-border px-5 py-3 text-[13px] text-muted-foreground">
              và {vn(hiddenOverdue)} phiếu quá hạn khác. <Link to="/borrow/loans?tab=overdue" className="font-medium text-primary underline-offset-2 hover:underline">Xem danh sách quá hạn</Link>
            </div>
          ) : null}
        </motion.section>

        <motion.aside
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.15, ease: 'easeOut' }}
          className="space-y-5"
        >
          <section aria-labelledby="borrow-journey-title" className="rounded-2xl border border-border bg-card p-5">
            <h2 id="borrow-journey-title" className="font-display text-[18px] font-semibold tracking-tight">Hành trình một lượt mượn</h2>
            <p className="mt-0.5 text-[13px] text-muted-foreground">Theo thứ tự sách đi qua các khâu.</p>
            <ol className="relative mt-3 space-y-1">
              <span aria-hidden="true" className="absolute bottom-7 left-[17px] top-7 w-px bg-border" />
              {journeySteps.map((step, index) => (
                <li key={step.to + step.label} className="relative">
                  <Link
                    to={step.to}
                    className="group flex items-center gap-3 rounded-lg p-1.5 transition-colors hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none"
                  >
                    <span className="relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[13px] font-semibold tabular-nums text-primary" aria-hidden="true">
                      {index + 1}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[14px] font-semibold text-foreground">{step.label}</span>
                      <span className="block text-[12px] text-muted-foreground">{step.desc}</span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="block font-display text-[17px] font-semibold tabular-nums text-foreground">{typeof step.metric === 'number' ? vn(step.metric) : step.metric}</span>
                      <span className="block text-[11px] text-muted-foreground">{step.metricLabel}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ol>
          </section>

          {/* The per-status totals the API already returns, kept for the record rather than the to-do. */}
          <section aria-labelledby="borrow-breakdown-title" className="rounded-2xl border border-border bg-card p-5">
            <h2 id="borrow-breakdown-title" className="font-display text-[18px] font-semibold tracking-tight">Số liệu theo trạng thái</h2>
            <div className="mt-3 space-y-4">
              {breakdown.map((group) => (
                <div key={group.title}>
                  <Link to={group.to} className="text-[13px] font-semibold text-foreground underline-offset-2 hover:text-primary hover:underline">{group.title}</Link>
                  <dl className="mt-1 space-y-1">
                    {group.rows.map((row) => (
                      <div key={row.label} className="flex items-baseline justify-between gap-3 text-[13px]">
                        <dt className="text-muted-foreground">{row.label}</dt>
                        <dd className={cn('tabular-nums text-foreground', row.tone)}>{loading ? '-' : row.value}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              ))}
            </div>
          </section>
        </motion.aside>
      </div>
    </div>
  );
}
