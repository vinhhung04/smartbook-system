import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { motion } from 'motion/react';
import { BookMarked, Users, CalendarClock, CircleAlert, ArrowRight, RefreshCw } from 'lucide-react';
import { StatCard, SectionCard } from '@/components/ui';
import { Button } from '@/components/ui/button';
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
      toast.error(getApiErrorMessage(error, 'Failed to load borrow dashboard'));
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
        className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4"
      >
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-rose-100 to-pink-50 flex items-center justify-center border border-rose-200/40 shadow-sm">
            <BookMarked className="w-6 h-6 text-rose-600" />
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Borrow Management</h1>
            <p className="text-sm text-muted-foreground">Realtime customer and reservation flow</p>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void loadDashboard()}
          className="gap-2"
        >
          <RefreshCw className="w-4 h-4" />
          Refresh
        </Button>
      </motion.div>

      {/* Stats Grid */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.1, ease: 'easeOut' }}
        className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4"
      >
        <StatCard
          label="Active Customers"
          value={loading ? '-' : summary.activeCustomers}
          icon={Users}
          variant="success"
        />
        <StatCard
          label="Pending Reservations"
          value={loading ? '-' : summary.pendingReservations}
          icon={CalendarClock}
          variant="warning"
        />
        <StatCard
          label="Ready For Pickup"
          value={loading ? '-' : summary.readyReservations}
          icon={BookMarked}
          variant="info"
        />
        <StatCard
          label="Active Loans"
          value={loading ? '-' : summary.activeLoans}
          icon={BookMarked}
          variant="default"
        />
        <StatCard
          label="Fine Balance"
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
              <p className="text-sm font-semibold text-foreground">Manage Customers</p>
              <p className="text-xs text-muted-foreground mt-1">Create, update and review customer eligibility.</p>
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
              <p className="text-sm font-semibold text-foreground">Manage Reservations</p>
              <p className="text-xs text-muted-foreground mt-1">Create, list and cancel reservations with real stock reserve.</p>
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
              <p className="text-sm font-semibold text-foreground">Manage Loans</p>
              <p className="text-xs text-muted-foreground mt-1">Convert reservation to loan and process return flow.</p>
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
              <p className="text-sm font-semibold text-foreground">Manage Fines</p>
              <p className="text-xs text-muted-foreground mt-1">View details, record payment, and waive/reduce fines.</p>
            </div>
            <ArrowRight className="w-4 h-4 text-muted-foreground group-hover:text-rose-600 transition-colors" />
          </div>
        </Link>
      </motion.div>
    </div>
  );
}
