import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { motion } from 'motion/react';
import { BookMarked, Users, CalendarClock, CircleAlert, ChevronRight, RefreshCw, CheckCircle2, type LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import { SectionCard } from '@/components/ui/section-card';
import { cn } from '@/components/ui/utils';
import { borrowService, type Loan } from '@/services/borrow';
import { getApiErrorMessage } from '@/services/api';
import { toast } from 'sonner';

const DAY_MS = 24 * 60 * 60 * 1000;
const DUE_SOON_DAYS = 3;
const WORKLIST_LIMIT = 8;
const WORKLIST_FETCH = 30;

type Tone = 'rose' | 'sky' | 'amber';

const TONE_CLASS: Record<Tone, { value: string; ring: string }> = {
  rose: { value: 'text-rose-600 dark:text-rose-400', ring: 'hover:border-rose-200 dark:hover:border-rose-500/30' },
  sky: { value: 'text-sky-600 dark:text-sky-400', ring: 'hover:border-sky-200 dark:hover:border-sky-500/30' },
  amber: { value: 'text-amber-600 dark:text-amber-400', ring: 'hover:border-amber-200 dark:hover:border-amber-500/30' },
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

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-4 sm:p-6 lg:p-8">
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, ease: 'easeOut' }}>
        <PageHeader
          icon={BookMarked}
          title="Quản lý mượn trả"
          description="Việc cần xử lý hôm nay và lối vào từng khâu"
          iconBg="bg-gradient-to-br from-rose-100 to-pink-50 border border-rose-200/40 shadow-sm dark:from-rose-500/15 dark:to-pink-500/10 dark:border-rose-500/20"
          iconColor="text-rose-600 dark:text-rose-400"
          actions={
            <Button variant="outline" size="sm" onClick={() => void loadDashboard()} disabled={loading} className="gap-2">
              <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
              Làm mới
            </Button>
          }
        />
      </motion.div>

      <motion.section
        aria-label="Cần xử lý"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.05, ease: 'easeOut' }}
        className="grid grid-cols-2 gap-3 lg:grid-cols-4"
      >
        {tiles.map((tile) => {
          const active = !loading && tile.value > 0;
          return (
            <Link
              key={tile.label}
              to={tile.to}
              className={cn(
                'group rounded-xl border border-border bg-card p-4 transition-all duration-200 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30',
                TONE_CLASS[tile.tone].ring,
              )}
            >
              <p className="text-[12px] font-medium text-muted-foreground">{tile.label}</p>
              <p
                className={cn(
                  'mt-2 font-mono text-[28px] font-bold leading-none tabular-nums',
                  active ? TONE_CLASS[tile.tone].value : 'text-foreground/40',
                )}
              >
                {loading ? '-' : tile.display ?? tile.value}
              </p>
              <p className="mt-2 truncate text-[11px] text-muted-foreground">{active || loading ? tile.hint : 'Không có gì cần xử lý'}</p>
            </Link>
          );
        })}
      </motion.section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <motion.div
          className="lg:col-span-2"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.1, ease: 'easeOut' }}
        >
          <SectionCard
            title="Phiếu mượn cần theo dõi"
            subtitle={`Quá hạn và đến hạn trong ${DUE_SOON_DAYS} ngày tới`}
            noPadding
            actions={
              <Button asChild variant="ghost" size="sm">
                <Link to="/borrow/loans">Xem tất cả</Link>
              </Button>
            }
          >
            {loading ? (
              <div className="space-y-2 p-4" aria-busy="true">
                {[0, 1, 2, 3].map((i) => (
                  <div key={i} className="h-12 animate-pulse rounded-lg bg-muted/60" />
                ))}
              </div>
            ) : visibleWork.length === 0 ? (
              <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
                <CheckCircle2 className="h-8 w-8 text-emerald-500" aria-hidden="true" />
                <p className="text-[14px] font-semibold text-foreground">Không có phiếu nào quá hạn hoặc sắp đến hạn</p>
                <p className="text-[12px] text-muted-foreground">Danh sách này tự cập nhật khi bạn bấm Làm mới.</p>
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {visibleWork.map(({ loan, overdue, label }) => (
                  <li key={loan.id}>
                    <Link
                      to={`/borrow/loans/${loan.id}`}
                      className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:outline-none sm:px-5"
                    >
                      <span
                        aria-hidden="true"
                        className={cn('h-8 w-1 shrink-0 rounded-full', overdue ? 'bg-rose-500' : 'bg-amber-400')}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13px] font-semibold text-foreground">{loan.customers?.full_name || 'Khách hàng'}</p>
                        <p className="truncate text-[12px] text-muted-foreground">
                          {loan.loan_number} · {loan.total_items} cuốn · hạn {formatDate(loan.due_date)}
                        </p>
                      </div>
                      <span
                        className={cn(
                          'shrink-0 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px] font-semibold',
                          overdue
                            ? 'bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-400'
                            : 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400',
                        )}
                      >
                        {label}
                      </span>
                      <ChevronRight className="hidden h-4 w-4 shrink-0 text-muted-foreground/50 sm:block" aria-hidden="true" />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            {hiddenOverdue > 0 ? (
              <div className="border-t border-border px-5 py-3 text-[12px] text-muted-foreground">
                và {hiddenOverdue.toLocaleString('vi-VN')} phiếu quá hạn khác — <Link to="/borrow/loans?tab=overdue" className="font-medium text-foreground underline-offset-2 hover:underline">xem danh sách quá hạn</Link>
              </div>
            ) : null}
          </SectionCard>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.15, ease: 'easeOut' }}
        >
          <SectionCard title="Hành trình một lượt mượn" subtitle="Theo thứ tự sách đi qua các khâu">
            <ol className="relative space-y-1">
              <span aria-hidden="true" className="absolute bottom-8 left-[19px] top-8 w-px bg-border" />
              {journeySteps.map((step) => (
                <li key={step.to + step.label} className="relative">
                  <Link
                    to={step.to}
                    className="group flex items-center gap-3 rounded-lg p-2 transition-colors hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none"
                  >
                    <span className="relative z-10 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-rose-200/60 bg-rose-50 dark:border-rose-500/20 dark:bg-rose-500/10">
                      <step.icon className="h-4 w-4 text-rose-600 dark:text-rose-400" aria-hidden="true" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] font-semibold text-foreground">{step.label}</span>
                      <span className="block truncate text-[11px] text-muted-foreground">{step.desc}</span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="block font-mono text-[14px] font-bold tabular-nums text-foreground">{step.metric}</span>
                      <span className="block text-[10px] text-muted-foreground">{step.metricLabel}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ol>
          </SectionCard>
        </motion.div>
      </div>
    </div>
  );
}
