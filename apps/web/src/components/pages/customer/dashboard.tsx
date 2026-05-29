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
        setError(getApiErrorMessage(err, 'Không tải được bảng điều khiển'));
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
          title="Không tải được bảng điều khiển"
          description={error}
          action={
            <NavLink to="/customer" className="text-primary font-medium hover:underline">
              Thử lại
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
          title="Không có dữ liệu hội viên"
          description="Vui lòng liên hệ hỗ trợ để thiết lập tài khoản."
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
              Chào mừng trở lại, {membership.customer_name || 'Bạn đọc'}
            </h1>
            <p className="text-white/65 text-[13px] mt-1">
              {new Date().toLocaleDateString('vi-VN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })} — Tổng quan thư viện của bạn
            </p>
          </div>
          <div className="hidden sm:flex items-center gap-2.5">
            <NavLink
              to="/customer/books"
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-white text-indigo-700 text-[13px] shadow-lg hover:shadow-xl transition-all"
              style={{ fontWeight: 600 }}
            >
              Xem sách <ChevronRight className="w-4 h-4" />
            </NavLink>
          </div>
        </div>
      </motion.div>

      {/* Việc cần làm */}
      {(() => {
        const overdueLoans = recentLoans.filter((l: any) => l.status === 'OVERDUE');
        const readyReservations = recentReservations.filter((r: any) => r.status === 'READY_FOR_PICKUP');
        const hasActions = overdueLoans.length > 0 || readyReservations.length > 0 || fineBalance > 0;
        if (!hasActions) return null;
        return (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.03, duration: 0.3 }}>
            <SectionCard>
              <div className="flex items-center gap-2 mb-3">
                <AlertCircle className="h-4 w-4 text-red-500" />
                <h2 className="text-[14px] font-semibold">Việc bạn cần làm</h2>
              </div>
              <div className="space-y-2">
                {overdueLoans.map((loan: any) => (
                  <NavLink key={loan.id} to="/customer/loans"
                    className="flex items-center justify-between rounded-lg border border-red-100 bg-red-50 px-3 py-2.5 hover:bg-red-100 transition-colors">
                    <div className="flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full bg-red-500 shrink-0" />
                      <span className="text-[13px] text-red-800">
                        Sách quá hạn: <span className="font-medium">{loan.loan_number || loan.id?.slice(0, 8)}</span>
                      </span>
                    </div>
                    <ChevronRight className="h-4 w-4 text-red-400" />
                  </NavLink>
                ))}
                {readyReservations.map((res: any) => (
                  <NavLink key={res.id} to="/customer/reservations"
                    className="flex items-center justify-between rounded-lg border border-emerald-100 bg-emerald-50 px-3 py-2.5 hover:bg-emerald-100 transition-colors">
                    <div className="flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full bg-emerald-500 shrink-0" />
                      <span className="text-[13px] text-emerald-800">
                        Sách sẵn sàng nhận: <span className="font-medium">{res.book_title || res.id?.slice(0, 8)}</span>
                      </span>
                    </div>
                    <ChevronRight className="h-4 w-4 text-emerald-400" />
                  </NavLink>
                ))}
                {fineBalance > 0 && (
                  <NavLink to="/customer/fines"
                    className="flex items-center justify-between rounded-lg border border-amber-100 bg-amber-50 px-3 py-2.5 hover:bg-amber-100 transition-colors">
                    <div className="flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full bg-amber-500 shrink-0" />
                      <span className="text-[13px] text-amber-800">
                        Tiền phạt chưa thanh toán: <span className="font-medium">{formatCurrencyVnd(fineBalance)}</span>
                      </span>
                    </div>
                    <ChevronRight className="h-4 w-4 text-amber-400" />
                  </NavLink>
                )}
              </div>
            </SectionCard>
          </motion.div>
        );
      })()}

      {/* Stats Row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05, duration: 0.3 }}>
          <StatCard
            label="Hội viên"
            value={membership.plan_name || 'Tiêu chuẩn'}
            hint={<span className="text-indigo-600">{membership.plan_code}</span>}
            icon={ShieldCheck}
            variant="primary"
          />
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1, duration: 0.3 }}>
          <StatCard
            label="Đang mượn"
            value={membership.active_loan_count}
            hint={`${membership.remaining_loan_slots} suất còn lại`}
            icon={BookOpen}
            variant="info"
          />
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15, duration: 0.3 }}>
          <StatCard
            label="Tiền phạt"
            value={formatCurrencyVnd(fineBalance)}
            hint={fineBalance > 500000 ? 'Vui lòng thanh toán sớm' : 'Không có nợ phạt'}
            icon={ReceiptText}
            variant={fineBalance > 500000 ? 'danger' : fineBalance > 0 ? 'warning' : 'success'}
          />
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2, duration: 0.3 }}>
          <StatCard
            label="Số dư ví"
            value={formatCurrencyVnd(walletBalance)}
            hint={walletBalance < 100000 ? 'Số dư thấp — nạp tiền sớm' : 'Sẵn sàng mượn sách'}
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
            { to: '/customer/books', title: 'Xem sách', desc: 'Tìm đầu sách để đặt trước', icon: BookOpen, color: 'from-indigo-500 to-blue-500' },
            { to: '/customer/loans', title: 'Phiếu mượn', desc: 'Theo dõi hạn trả', icon: HandCoins, color: 'from-emerald-500 to-teal-500' },
            { to: '/customer/reservations', title: 'Đặt trước', desc: 'Nhận sách sẵn sàng', icon: CalendarClock, color: 'from-amber-500 to-orange-500' },
            { to: '/customer/notifications', title: 'Thông báo', desc: 'Xem cập nhật', icon: Bell, color: 'from-cyan-500 to-sky-500' },
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
            title="Mượn gần đây"
            subtitle="Phiếu mượn mới nhất"
            actions={
              <NavLink to="/customer/loans" className="text-[12px] text-primary font-medium hover:underline">
                Xem tất cả
              </NavLink>
            }
          >
            {recentLoans.length === 0 ? (
              <EmptyState
                variant="inbox"
                title="Chưa có phiếu mượn"
                description="Khám phá danh mục và đặt trước cuốn sách đầu tiên."
                action={
                  <NavLink to="/customer/books" className="text-primary font-medium hover:underline">
                    Xem danh mục
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
          <SectionCard title="Chính sách hội viên" subtitle="Giới hạn mượn hiện tại">
            <div className="space-y-3">
              {[
                { label: 'Tối đa đang mượn', value: `${membership.limits.max_active_loans} cuốn` },
                { label: 'Tối đa số ngày', value: `${membership.limits.max_loan_days} ngày` },
                { label: 'Phạt/ngày quá hạn', value: `${membership.limits.fine_per_day}` },
                { label: 'Tối đa đặt trước', value: `${membership.limits.max_active_reservations || '—'} cuốn` },
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
            title="Đặt trước gần đây"
            subtitle="Chờ xác nhận và sẵn lấy sách"
            actions={
              <NavLink to="/customer/reservations" className="text-[12px] text-primary font-medium hover:underline">
                Xem tất cả
              </NavLink>
            }
          >
            {recentReservations.length === 0 ? (
              <EmptyState
                variant="inbox"
                title="Chưa có đặt trước"
                description="Khám phá danh mục và đặt trước sách bạn yêu thích."
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
            title="Hoạt động gần đây"
            subtitle="Cập nhật và thông báo mới nhất"
            actions={
              <NavLink to="/customer/notifications" className="text-[12px] text-primary font-medium hover:underline">
                Xem tất cả
              </NavLink>
            }
          >
            {recentNotifications.length === 0 ? (
              <EmptyState variant="inbox" title="Chưa có hoạt động" description="Cập nhật hệ thống sẽ hiển thị ở đây." />
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
            <p className="text-[13px] font-semibold text-amber-800">Còn tiền phạt chưa trả</p>
            <p className="text-[12px] text-amber-700 mt-0.5">
              Bạn còn {formatCurrencyVnd(fineBalance)} tiền phạt. Trả sớm để tránh bị hạn chế mượn sách.
            </p>
          </div>
          <NavLink to="/customer/fines" className="ml-auto shrink-0 text-[12px] text-primary font-medium hover:underline">
            Trả tiền phạt
          </NavLink>
        </motion.div>
      )}
    </div>
  );
}
