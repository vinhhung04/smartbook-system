import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { motion } from 'motion/react';
import { BookMarked, Users, CalendarClock, CircleAlert, ArrowRight, RefreshCw } from 'lucide-react';
import { StatCard, SectionCard } from '@/components/ui';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import { borrowService, type Customer, type Reservation, type Loan } from '@/services/borrow';
import { getApiErrorMessage } from '@/services/api';
import { toast } from 'sonner';

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

      {/* Stats Grid */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.1, ease: 'easeOut' }}
        className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4"
      >
        <StatCard
          label="Khách hàng đang hoạt động"
          value={loading ? '-' : summary.activeCustomers}
          icon={Users}
          variant="success"
        />
        <StatCard
          label="Đặt trước chờ xác nhận"
          value={loading ? '-' : summary.pendingReservations}
          icon={CalendarClock}
          variant="warning"
        />
        <StatCard
          label="Sẵn sàng lấy sách"
          value={loading ? '-' : summary.readyReservations}
          icon={BookMarked}
          variant="info"
        />
        <StatCard
          label="Đang mượn"
          value={loading ? '-' : summary.activeLoans}
          icon={BookMarked}
          variant="default"
        />
        <StatCard
          label="Dư nợ phạt"
          value={loading ? '-' : `${summary.totalFineBalance.toLocaleString('vi-VN')} VND`}
          icon={CircleAlert}
          variant="danger"
        />
      </motion.div>

      {/* Navigation Cards */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.2, ease: 'easeOut' }}
        className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4"
      >
        <Link
          to="/borrow/customers"
          className="group bg-card rounded-xl border border-border p-5 hover:border-rose-200 hover:shadow-md transition-all duration-200"
        >
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-foreground">Quản lý khách hàng</p>
              <p className="text-xs text-muted-foreground mt-1">Tạo, cập nhật và kiểm tra điều kiện khách hàng.</p>
            </div>
            <ArrowRight className="w-4 h-4 text-muted-foreground group-hover:text-rose-600 transition-colors" />
          </div>
        </Link>

        <Link
          to="/borrow/reservations"
          className="group bg-card rounded-xl border border-border p-5 hover:border-rose-200 hover:shadow-md transition-all duration-200"
        >
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-foreground">Quản lý đặt trước</p>
              <p className="text-xs text-muted-foreground mt-1">Tạo, liệt kê và hủy đặt trước với tồn kho thực.</p>
            </div>
            <ArrowRight className="w-4 h-4 text-muted-foreground group-hover:text-rose-600 transition-colors" />
          </div>
        </Link>

        <Link
          to="/borrow/loans"
          className="group bg-card rounded-xl border border-border p-5 hover:border-rose-200 hover:shadow-md transition-all duration-200"
        >
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-foreground">Quản lý phiếu mượn</p>
              <p className="text-xs text-muted-foreground mt-1">Chuyển đặt trước thành phiếu mượn và xử lý trả sách.</p>
            </div>
            <ArrowRight className="w-4 h-4 text-muted-foreground group-hover:text-rose-600 transition-colors" />
          </div>
        </Link>

        <Link
          to="/borrow/fines"
          className="group bg-card rounded-xl border border-border p-5 hover:border-rose-200 hover:shadow-md transition-all duration-200"
        >
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-foreground">Quản lý tiền phạt</p>
              <p className="text-xs text-muted-foreground mt-1">Xem chi tiết, ghi nhận thanh toán, miễn giảm tiền phạt.</p>
            </div>
            <ArrowRight className="w-4 h-4 text-muted-foreground group-hover:text-rose-600 transition-colors" />
          </div>
        </Link>
      </motion.div>
    </div>
  );
}
