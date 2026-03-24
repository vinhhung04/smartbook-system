import { useEffect, useState } from 'react';
import { NavLink, useNavigate } from 'react-router';
import { motion } from 'motion/react';
import { AlertCircle, Bell, BookOpen, CalendarClock, HandCoins, ReceiptText, Wallet, ChevronRight, ShieldCheck } from 'lucide-react';
import { customerService, MembershipInfo } from '@/services/customer';
import { customerBorrowService } from '@/services/customer-borrow';
import { getApiErrorMessage } from '@/services/api';
import { SectionCard } from '@/components/ui/section-card';
import { StatCard } from '@/components/ui/stat-card';
import { EmptyState } from '@/components/ui/empty-state';
import { LoanCard } from './_shared/loan-card';
import { ReservationCard } from './_shared/reservation-card';

function formatCurrencyVnd(amount: number) {
  return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(amount).replace('₫', '').trim() + ' VND';
}

export function CustomerDashboardPage() {
  const navigate = useNavigate();
  const [membership, setMembership] = useState<MembershipInfo | null>(null);
  const [walletBalance, setWalletBalance] = useState<number>(0);
  const [fineBalance, setFineBalance] = useState<number>(0);
  const [recentLoans, setRecentLoans] = useState<any[]>([]);
  const [recentReservations, setRecentReservations] = useState<any[]>([]);
  const [recentNotifications, setRecentNotifications] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const run = async () => {
      try {
        setIsLoading(true);
        setError(null);

        const [membershipData, accountResponse] = await Promise.all([
          customerService.getMyMembership(),
          customerBorrowService.getMyAccount(),
        ]);

        const [loansResponse, reservationsResponse, finesResponse, notificationsResponse] = await Promise.all([
          customerBorrowService.getMyLoans(),
          customerBorrowService.getMyReservations(),
          customerBorrowService.getMyFines(),
          customerBorrowService.getMyNotifications(),
        ]);

        setMembership(membershipData);
        setWalletBalance(Number(accountResponse?.data?.available_balance || 0));
        setFineBalance(Number(finesResponse?.data?.total_fine_balance || 0));
        setRecentLoans(Array.isArray(loansResponse?.data) ? loansResponse.data.slice(0, 3) : []);
        setRecentReservations(Array.isArray(reservationsResponse?.data) ? reservationsResponse.data.slice(0, 3) : []);
        setRecentNotifications(Array.isArray(notificationsResponse?.data) ? notificationsResponse.data.slice(0, 4) : []);
      } catch (err) {
        setError(getApiErrorMessage(err, 'Failed to load customer dashboard'));
      } finally {
        setIsLoading(false);
      }
    };

    void run();
  }, []);

  if (isLoading) {
    return (
      <div className="space-y-6 p-6 lg:p-8 max-w-7xl mx-auto">
        {/* Hero skeleton */}
        <div className="rounded-2xl bg-gradient-to-r from-indigo-600 via-blue-600 to-violet-600 p-6 h-32 animate-pulse" />
        {/* Stats skeleton */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[1,2,3,4].map(i => (
            <div key={i} className="rounded-xl border bg-card p-5 h-28 animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 lg:p-8 max-w-7xl mx-auto">
        <EmptyState
          variant="error"
          title="Failed to load dashboard"
          description={error}
          action={
            <NavLink to="/customer" className="text-primary font-medium hover:underline">
              Try again
            </NavLink>
          }
        />
      </div>
    );
  }

  if (!membership) {
    return (
      <div className="p-6 lg:p-8 max-w-7xl mx-auto">
        <EmptyState
          variant="no-data"
          title="No membership data available"
          description="Please contact support to set up your account."
        />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6 lg:p-8 max-w-7xl mx-auto">
      {/* Hero Welcome Banner */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
        className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-indigo-600 via-blue-600 to-violet-600 p-6 shadow-xl shadow-indigo-500/20"
      >
        {/* Decorative */}
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_85%_15%,rgba(255,255,255,0.1),transparent_50%)]" />
        <div className="absolute top-0 right-0 w-64 h-64 bg-white/5 rounded-full -translate-y-1/2 translate-x-1/4" />
        <div className="absolute bottom-0 left-0 w-40 h-40 bg-white/5 rounded-full translate-y-1/3 -translate-x-1/4" />

        <div className="relative flex items-center justify-between gap-4">
          <div className="text-white">
            <h1 className="text-[22px] tracking-tight text-white" style={{ fontWeight: 700 }}>
              Welcome back, {membership.customer_name || 'Reader'}
            </h1>
            <p className="text-white/65 text-[13px] mt-1">
              {new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })} — Here is your library overview
            </p>
          </div>
          <div className="hidden sm:flex items-center gap-2.5">
            <NavLink
              to="/customer/books"
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-white text-indigo-700 text-[13px] shadow-lg hover:shadow-xl transition-all"
              style={{ fontWeight: 600 }}
            >
              Browse Books <ChevronRight className="w-4 h-4" />
            </NavLink>
          </div>
        </div>
      </motion.div>

      {/* Stats Row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05, duration: 0.3 }}>
          <StatCard
            label="Membership"
            value={membership.plan_name || 'Standard'}
            hint={<span className="text-indigo-600">{membership.plan_code}</span>}
            icon={ShieldCheck}
            variant="primary"
          />
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1, duration: 0.3 }}>
          <StatCard
            label="Active Loans"
            value={membership.active_loan_count}
            hint={`${membership.remaining_loan_slots} slots remaining`}
            icon={BookOpen}
            variant="info"
          />
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15, duration: 0.3 }}>
          <StatCard
            label="Outstanding Fines"
            value={formatCurrencyVnd(fineBalance)}
            hint={fineBalance > 500000 ? 'Please pay promptly' : 'Good standing'}
            icon={ReceiptText}
            variant={fineBalance > 500000 ? 'danger' : fineBalance > 0 ? 'warning' : 'success'}
          />
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2, duration: 0.3 }}>
          <StatCard
            label="Wallet Balance"
            value={formatCurrencyVnd(walletBalance)}
            hint={walletBalance < 100000 ? 'Low balance — top up soon' : 'Ready for borrows'}
            icon={Wallet}
            variant={walletBalance < 100000 ? 'warning' : 'success'}
          />
        </motion.div>
      </div>

      {/* Quick Actions */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2, duration: 0.3 }}
      >
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[
            { to: '/customer/books', title: 'Browse Books', desc: 'Find titles to reserve', icon: BookOpen, color: 'from-indigo-500 to-blue-500' },
            { to: '/customer/loans', title: 'My Loans', desc: 'Track due dates', icon: HandCoins, color: 'from-emerald-500 to-teal-500' },
            { to: '/customer/reservations', title: 'Reservations', desc: 'Pickup ready items', icon: CalendarClock, color: 'from-amber-500 to-orange-500' },
            { to: '/customer/notifications', title: 'Notifications', desc: 'View updates', icon: Bell, color: 'from-cyan-500 to-sky-500' },
          ].map((action) => (
            <motion.div key={action.to} whileHover={{ y: -2 }} transition={{ duration: 0.15 }}>
              <NavLink
                to={action.to}
                className="group flex items-center gap-3 rounded-xl border border-black/5 bg-card p-4 hover:border-indigo-200/60 hover:shadow-md hover:shadow-indigo-500/5 transition-all"
              >
                <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${action.color} flex items-center justify-center shrink-0 shadow-sm`}>
                  <action.icon className="w-5 h-5 text-white" />
                </div>
                <div className="min-w-0">
                  <p className="text-[13px] font-semibold text-foreground truncate">{action.title}</p>
                  <p className="text-[11px] text-muted-foreground truncate">{action.desc}</p>
                </div>
                <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0 ml-auto opacity-0 group-hover:opacity-100 transition-opacity" />
              </NavLink>
            </motion.div>
          ))}
        </div>
      </motion.div>

      {/* Content Grid */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        {/* Recent Loans */}
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25, duration: 0.3 }} className="xl:col-span-2">
          <SectionCard
            title="Recent Loans"
            subtitle="Your latest active or pending loan records"
            actions={
              <NavLink to="/customer/loans" className="text-[12px] text-primary font-medium hover:underline">
                View all
              </NavLink>
            }
          >
            {recentLoans.length === 0 ? (
              <EmptyState
                variant="inbox"
                title="No loans yet"
                description="Start by browsing our catalog and reserving your first book."
                action={
                  <NavLink to="/customer/books" className="text-primary font-medium hover:underline">
                    Browse catalog
                  </NavLink>
                }
              />
            ) : (
              <div className="space-y-2.5">
                {recentLoans.map((row) => (
                  <LoanCard key={row.id} item={row} onView={(id) => navigate(`/customer/loans/${id}`)} />
                ))}
              </div>
            )}
          </SectionCard>
        </motion.div>

        {/* Membership Summary */}
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3, duration: 0.3 }}>
          <SectionCard title="Membership Policy" subtitle="Your current borrowing limits">
            <div className="space-y-3">
              {[
                { label: 'Max active loans', value: `${membership.limits.max_active_loans} items` },
                { label: 'Max loan period', value: `${membership.limits.max_loan_days} days` },
                { label: 'Fine per overdue day', value: `${membership.limits.fine_per_day}` },
                { label: 'Max reservations', value: `${membership.limits.max_active_reservations || '—'} items` },
              ].map((item) => (
                <div key={item.label} className="flex items-center justify-between rounded-xl border border-border bg-muted/30 px-4 py-3">
                  <p className="text-[12px] text-muted-foreground">{item.label}</p>
                  <p className="text-[13px] font-semibold text-foreground">{item.value}</p>
                </div>
              ))}
            </div>
          </SectionCard>
        </motion.div>
      </div>

      {/* Bottom Row */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        {/* Recent Reservations */}
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.35, duration: 0.3 }}>
          <SectionCard
            title="Recent Reservations"
            subtitle="Pending and ready-to-pickup items"
            actions={
              <NavLink to="/customer/reservations" className="text-[12px] text-primary font-medium hover:underline">
                View all
              </NavLink>
            }
          >
            {recentReservations.length === 0 ? (
              <EmptyState
                variant="inbox"
                title="No reservations yet"
                description="Browse the catalog and reserve books that interest you."
              />
            ) : (
              <div className="space-y-2.5">
                {recentReservations.map((row) => (
                  <ReservationCard key={row.id} item={row} onCancel={() => navigate('/customer/reservations')} />
                ))}
              </div>
            )}
          </SectionCard>
        </motion.div>

        {/* Activity */}
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4, duration: 0.3 }}>
          <SectionCard
            title="Recent Activity"
            subtitle="Latest account updates and notifications"
            actions={
              <NavLink to="/customer/notifications" className="text-[12px] text-primary font-medium hover:underline">
                View all
              </NavLink>
            }
          >
            {recentNotifications.length === 0 ? (
              <EmptyState variant="inbox" title="No recent activity" description="System updates will appear here." />
            ) : (
              <div className="space-y-2.5">
                {recentNotifications.map((row) => (
                  <div key={row.id} className="flex items-start gap-3 rounded-xl border border-border bg-muted/20 px-4 py-3">
                    <div className="w-2 h-2 rounded-full bg-primary mt-1.5 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="text-[12px] font-semibold text-foreground truncate">{row.subject || row.template_code || 'Activity'}</p>
                      <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2">{row.body || 'System update available.'}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </SectionCard>
        </motion.div>
      </div>

      {/* Reminder Banner */}
      {fineBalance > 0 && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.45 }}
          className="rounded-xl border border-amber-200 bg-gradient-to-r from-amber-50 to-orange-50 p-4 flex items-center gap-3"
        >
          <AlertCircle className="w-5 h-5 text-amber-600 shrink-0" />
          <div>
            <p className="text-[13px] font-semibold text-amber-800">Outstanding fine balance</p>
            <p className="text-[12px] text-amber-700 mt-0.5">
              You have {formatCurrencyVnd(fineBalance)} in outstanding fines. Pay early to avoid borrow restrictions.
            </p>
          </div>
          <NavLink to="/customer/fines" className="ml-auto shrink-0 text-[12px] text-primary font-medium hover:underline">
            Pay fines
          </NavLink>
        </motion.div>
      )}
    </div>
  );
}
