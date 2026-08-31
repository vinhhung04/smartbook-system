import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { motion } from 'motion/react';
import { BookMarked, Users, CalendarClock, CircleAlert, ArrowRight, ChevronRight, RefreshCw, type LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import { cn } from '@/components/ui/utils';
import { borrowService, type Customer, type Reservation, type Loan } from '@/services/borrow';
import { getApiErrorMessage } from '@/services/api';
import { toast } from 'sonner';

interface JourneyStep {
  to: string;
  icon: LucideIcon;
  label: string;
  desc: string;
  metric: string | number;
  metricLabel: string;
  secondaryMetric?: string | number;
  secondaryLabel?: string;
  danger?: boolean;
}

export function BorrowPage() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [loans, setLoans] = useState<Loan[]>([]);
  const [loading, setLoading] = useState(true);

  const loadDashboard = async () => {
    try {
      setLoading(true);
      const [customerResp, reservationResp, loanResp] = await Promise.all([
        borrowService.getCustomers({ pageSize: 200 }),
        borrowService.getReservations({ pageSize: 200 }),
        borrowService.getLoans({ pageSize: 200 }),
      ]);
      setCustomers(customerResp.data || []);
      setReservations(reservationResp.data || []);
      setLoans(loanResp.data || []);
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
    const activeCustomers = customers.filter((customer) => customer.status === 'ACTIVE').length;
    const pendingReservations = reservations.filter((reservation) => reservation.status === 'PENDING').length;
    const readyReservations = reservations.filter((reservation) => reservation.status === 'READY_FOR_PICKUP').length;
    const activeLoans = loans.filter((loan) => loan.status === 'BORROWED' || loan.status === 'OVERDUE' || loan.status === 'RESERVED').length;
    const totalFineBalance = customers.reduce((sum, customer) => sum + Number(customer.total_fine_balance || 0), 0);
    return {
      activeCustomers,
      pendingReservations,
      readyReservations,
      activeLoans,
      totalFineBalance,
    };
  }, [customers, reservations, loans]);

  const journeySteps: JourneyStep[] = [
    {
      to: '/borrow/customers',
      icon: Users,
      label: 'Khách hàng',
      desc: 'Tạo, cập nhật và kiểm tra điều kiện khách hàng.',
      metric: loading ? '-' : summary.activeCustomers,
      metricLabel: 'đang hoạt động',
    },
    {
      to: '/borrow/reservations',
      icon: CalendarClock,
      label: 'Đặt trước',
      desc: 'Tạo, liệt kê và hủy đặt trước với tồn kho thực.',
      metric: loading ? '-' : summary.pendingReservations,
      metricLabel: 'chờ xác nhận',
      secondaryMetric: loading ? undefined : summary.readyReservations,
      secondaryLabel: 'sẵn sàng lấy',
    },
    {
      to: '/borrow/loans',
      icon: BookMarked,
      label: 'Phiếu mượn',
      desc: 'Chuyển đặt trước thành phiếu mượn và xử lý trả sách.',
      metric: loading ? '-' : summary.activeLoans,
      metricLabel: 'đang mượn',
    },
    {
      to: '/borrow/fines',
      icon: CircleAlert,
      label: 'Tiền phạt',
      desc: 'Xem chi tiết, ghi nhận thanh toán, miễn giảm tiền phạt.',
      metric: loading ? '-' : summary.totalFineBalance.toLocaleString('vi-VN'),
      metricLabel: 'VND dư nợ',
      danger: summary.totalFineBalance > 0,
    },
  ];

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
      {/* Hero Header */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: 'easeOut' }}
      >
        <PageHeader
          icon={BookMarked}
          title="Quản lý mượn trả"
          description="Luồng khách hàng và đặt trước thời gian thực"
          iconBg="bg-gradient-to-br from-rose-100 to-pink-50 border border-rose-200/40 shadow-sm dark:from-rose-500/15 dark:to-pink-500/10 dark:border-rose-500/20"
          iconColor="text-rose-600 dark:text-rose-400"
          actions={
            <Button
              variant="outline"
              size="sm"
              onClick={() => void loadDashboard()}
              className="gap-2"
            >
              <RefreshCw className="w-4 h-4" />
              Làm mới
            </Button>
          }
        />
      </motion.div>

      {/* Patron journey — the four sections in the order a book actually moves
          through them (reserve → check out → return/fine), each card carrying
          its own live count instead of a separate, disconnected stats row. */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.1, ease: 'easeOut' }}
      >
        <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground mb-3">Hành trình một lượt mượn sách</p>
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto_1fr_auto_1fr_auto_1fr] gap-3 items-stretch">
          {journeySteps.flatMap((step, i, arr) => {
            const card = (
              <Link
                key={step.to}
                to={step.to}
                className="group relative flex flex-col bg-card rounded-xl border border-border p-5 hover:border-rose-200 dark:hover:border-rose-500/30 hover:shadow-md transition-all duration-200"
              >
                <div className="flex items-center justify-between mb-3">
                  <div className="w-10 h-10 rounded-xl bg-rose-50 dark:bg-rose-500/10 flex items-center justify-center">
                    <step.icon className="w-5 h-5 text-rose-600 dark:text-rose-400" />
                  </div>
                  <ArrowRight className="w-4 h-4 text-muted-foreground group-hover:text-rose-600 group-hover:translate-x-0.5 transition-all" />
                </div>
                <p className="text-sm font-semibold text-foreground">{step.label}</p>
                <p className="text-xs text-muted-foreground mt-1 mb-4 flex-1">{step.desc}</p>
                <div className="pt-3 border-t border-border">
                  <div className="flex items-end gap-1.5">
                    <span className={cn('font-mono text-[22px] font-bold tabular-nums leading-none', step.danger ? 'text-rose-600 dark:text-rose-400' : 'text-foreground')}>
                      {step.metric}
                    </span>
                    <span className="text-[11px] text-muted-foreground mb-0.5">{step.metricLabel}</span>
                  </div>
                  {step.secondaryMetric !== undefined && (
                    <div className="flex items-center gap-1.5 mt-1.5">
                      <span className="font-mono text-[13px] font-semibold tabular-nums text-sky-600 dark:text-sky-400">{step.secondaryMetric}</span>
                      <span className="text-[11px] text-muted-foreground">{step.secondaryLabel}</span>
                    </div>
                  )}
                </div>
              </Link>
            );

            if (i === arr.length - 1) return [card];
            return [
              card,
              <div key={`${step.to}-arrow`} className="hidden lg:flex items-center justify-center" aria-hidden="true">
                <ChevronRight className="w-5 h-5 text-muted-foreground/40" />
              </div>,
            ];
          })}
        </div>
      </motion.div>
    </div>
  );
}
