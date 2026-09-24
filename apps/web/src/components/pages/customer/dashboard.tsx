import { useCallback, useEffect, useState } from 'react';
import { NavLink, useNavigate } from 'react-router';
import { motion } from 'motion/react';
import { AlertCircle, BookOpen, ChevronRight } from 'lucide-react';
import { customerService, MembershipInfo } from '@/services/customer';
import { customerBorrowService } from '@/services/customer-borrow';
import { getApiErrorMessage } from '@/services/api';
import { SectionCard } from '@/components/ui/section-card';
import { EmptyState } from '@/components/ui/empty-state';
import { cn } from '@/components/ui/utils';
import { CustomerPageHeader } from './_shared/customer-page-header';
import { LoanCard } from './_shared/loan-card';
import { ReservationCard } from './_shared/reservation-card';

const RECENT_LIMIT = 3;
const ACTIVE_RESERVATION_STATUSES = ['PENDING', 'CONFIRMED', 'READY_FOR_PICKUP'];

function formatCurrencyVnd(amount: number) {
  return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(amount).replace('₫', '').trim() + ' VND';
}

interface TodoItem {
  key: string;
  to: string;
  tone: 'red' | 'emerald' | 'amber';
  text: React.ReactNode;
}

const TODO_TONE: Record<TodoItem['tone'], { row: string; dot: string; text: string; chevron: string }> = {
  red: {
    row: 'border-red-100 bg-red-50 hover:bg-red-100 dark:border-red-900/40 dark:bg-red-950/30 dark:hover:bg-red-900/40',
    dot: 'bg-red-500', text: 'text-red-800 dark:text-red-300', chevron: 'text-red-400',
  },
  emerald: {
    row: 'border-emerald-100 bg-emerald-50 hover:bg-emerald-100 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:hover:bg-emerald-900/40',
    dot: 'bg-emerald-500', text: 'text-emerald-800 dark:text-emerald-300', chevron: 'text-emerald-400',
  },
  amber: {
    row: 'border-amber-100 bg-amber-50 hover:bg-amber-100 dark:border-amber-900/40 dark:bg-amber-950/30 dark:hover:bg-amber-900/40',
    dot: 'bg-amber-500', text: 'text-amber-800 dark:text-amber-300', chevron: 'text-amber-400',
  },
};

export function CustomerDashboardPage() {
  const navigate = useNavigate();
  const [membership, setMembership] = useState<MembershipInfo | null>(null);
  const [walletBalance, setWalletBalance] = useState<number>(0);
  const [fineBalance, setFineBalance] = useState<number>(0);
  const [loans, setLoans] = useState<any[]>([]);
  const [reservations, setReservations] = useState<any[]>([]);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
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
      setLoans(Array.isArray(loansResponse?.data) ? loansResponse.data : []);
      setReservations(Array.isArray(reservationsResponse?.data) ? reservationsResponse.data : []);
      setNotifications(Array.isArray(notificationsResponse?.data) ? notificationsResponse.data : []);
    } catch (err) {
      setError(getApiErrorMessage(err, 'Không tải được bảng điều khiển'));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (isLoading) {
    return (
      <div className="mx-auto max-w-7xl space-y-5 p-4 sm:p-6 lg:p-8" aria-busy="true">
        <div className="h-20 animate-pulse rounded-2xl border bg-card" />
        <div className="h-28 animate-pulse rounded-xl border bg-card" />
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
          <div className="h-64 animate-pulse rounded-xl border bg-card xl:col-span-2" />
          <div className="h-64 animate-pulse rounded-xl border bg-card" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto max-w-7xl p-4 sm:p-6 lg:p-8">
        <EmptyState
          variant="error"
          title="Không tải được bảng điều khiển"
          description={error}
          action={
            <button type="button" onClick={() => void load()} className="font-medium text-primary hover:underline">
              Thử lại
            </button>
          }
        />
      </div>
    );
  }

  if (!membership) {
    return (
      <div className="mx-auto max-w-7xl p-4 sm:p-6 lg:p-8">
        <EmptyState
          variant="no-data"
          title="Không có dữ liệu hội viên"
          description="Vui lòng liên hệ hỗ trợ để thiết lập tài khoản."
          action={<NavLink to="/customer/support" className="font-medium text-primary hover:underline">Xem thông tin liên hệ</NavLink>}
        />
      </div>
    );
  }

  // "To do" is computed from the full lists: the old version only looked at the 3 most recent
  // items, so an overdue loan or a ready pickup could be missed.
  const overdueLoans = loans.filter((l: any) => l.status === 'OVERDUE');
  const readyReservations = reservations.filter((r: any) => r.status === 'READY_FOR_PICKUP');
  const todos: TodoItem[] = [
    ...overdueLoans.map((loan: any) => ({
      key: `loan-${loan.id}`, to: '/customer/loans', tone: 'red' as const,
      text: <>Sách quá hạn: <span className="font-medium">{loan.loan_number || loan.id?.slice(0, 8)}</span></>,
    })),
    ...readyReservations.map((res: any) => ({
      key: `res-${res.id}`, to: '/customer/reservations', tone: 'emerald' as const,
      text: <>Sách sẵn sàng nhận: <span className="font-medium">{res.book_title || res.id?.slice(0, 8)}</span></>,
    })),
    ...(fineBalance > 0
      ? [{
        key: 'fines', to: '/customer/fines', tone: 'amber' as const,
        text: <>Tiền phạt chưa thanh toán: <span className="font-medium">{formatCurrencyVnd(fineBalance)}</span>. Trả sớm để tránh bị hạn chế mượn sách.</>,
      }]
      : []),
  ];

  const maxLoans = Number(membership.limits.max_active_loans) || 0;
  const loanUsagePct = maxLoans > 0 ? Math.min(100, Math.round((membership.active_loan_count / maxLoans) * 100)) : 0;
  const activeReservations = reservations.filter((r: any) => ACTIVE_RESERVATION_STATUSES.includes(r.status)).length;
  const today = new Date().toLocaleDateString('vi-VN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  const summary = [
    {
      label: 'Đang mượn',
      value: `${membership.active_loan_count}${maxLoans ? ` / ${maxLoans}` : ''}`,
      hint: `${membership.remaining_loan_slots} suất còn lại`,
      tone: 'text-foreground',
      bar: loanUsagePct,
    },
    {
      label: 'Đặt trước',
      value: String(activeReservations),
      hint: readyReservations.length > 0 ? `${readyReservations.length} cuốn sẵn sàng nhận` : 'đang chờ xử lý',
      tone: readyReservations.length > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-foreground',
    },
    {
      label: 'Tiền phạt',
      value: formatCurrencyVnd(fineBalance),
      hint: fineBalance > 0 ? 'chưa thanh toán' : 'không có nợ phạt',
      tone: fineBalance > 500000 ? 'text-rose-600 dark:text-rose-400' : fineBalance > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400',
    },
    {
      label: 'Số dư ví',
      value: formatCurrencyVnd(walletBalance),
      hint: walletBalance < 100000 ? 'số dư thấp, nên nạp thêm' : 'sẵn sàng mượn sách',
      tone: walletBalance < 100000 ? 'text-amber-600 dark:text-amber-400' : 'text-foreground',
    },
  ];

  return (
    <div className="mx-auto max-w-7xl space-y-5 p-4 sm:p-6 lg:p-8">
      <CustomerPageHeader
        title={`Xin chào, ${membership.customer_name || 'bạn đọc'}`}
        subtitle={`${today} · Gói ${membership.plan_name || 'Tiêu chuẩn'}${membership.plan_code ? ` (${membership.plan_code})` : ''}`}
        actions={
          <NavLink
            to="/customer/books"
            className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-[13px] font-semibold text-white transition-colors hover:bg-indigo-700"
          >
            <BookOpen className="h-4 w-4" /> Khám phá sách
          </NavLink>
        }
      />

      {todos.length > 0 && (
        <motion.section
          aria-label="Việc bạn cần làm"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="rounded-xl border border-border bg-card p-4 sm:p-5"
        >
          <h2 className="mb-3 flex items-center gap-2 text-[14px] font-semibold">
            <AlertCircle className="h-4 w-4 text-red-500" aria-hidden="true" />
            Việc bạn cần làm
            <span className="rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-semibold text-red-700 dark:bg-red-500/15 dark:text-red-400">{todos.length}</span>
          </h2>
          <ul className="space-y-2">
            {todos.map((todo) => {
              const tone = TODO_TONE[todo.tone];
              return (
                <li key={todo.key}>
                  <NavLink to={todo.to} className={cn('flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5 transition-colors', tone.row)}>
                    <span className="flex min-w-0 items-center gap-2">
                      <span className={cn('h-2 w-2 shrink-0 rounded-full', tone.dot)} />
                      <span className={cn('text-[13px]', tone.text)}>{todo.text}</span>
                    </span>
                    <ChevronRight className={cn('h-4 w-4 shrink-0', tone.chevron)} aria-hidden="true" />
                  </NavLink>
                </li>
              );
            })}
          </ul>
        </motion.section>
      )}

      <motion.section
        aria-label="Tổng quan tài khoản"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.05, duration: 0.3 }}
        className="rounded-xl border border-border bg-card p-4 sm:p-5"
      >
        <dl className="grid grid-cols-2 gap-x-6 gap-y-4 lg:grid-cols-4">
          {summary.map((item) => (
            <div key={item.label} className="min-w-0">
              <dt className="text-[12px] text-muted-foreground">{item.label}</dt>
              <dd className={cn('mt-1 truncate font-mono text-[22px] font-bold leading-none tabular-nums', item.tone)}>{item.value}</dd>
              {item.bar !== undefined ? (
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted" role="img" aria-label={`Đã dùng ${item.bar}% số suất mượn`}>
                  <div className="h-full rounded-full bg-indigo-500" style={{ width: `${item.bar}%` }} />
                </div>
              ) : null}
              <p className="mt-1.5 truncate text-[11px] text-muted-foreground">{item.hint}</p>
            </div>
          ))}
        </dl>
      </motion.section>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <div className="space-y-5 xl:col-span-2">
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1, duration: 0.3 }}>
            <SectionCard
              title="Mượn gần đây"
              subtitle="Phiếu mượn mới nhất"
              actions={<NavLink to="/customer/loans" className="text-[12px] font-medium text-primary hover:underline">Xem tất cả</NavLink>}
            >
              {loans.length === 0 ? (
                <EmptyState
                  variant="inbox"
                  title="Chưa có phiếu mượn"
                  description="Khám phá danh mục và đặt trước cuốn sách đầu tiên."
                  action={<NavLink to="/customer/books" className="font-medium text-primary hover:underline">Xem danh mục</NavLink>}
                />
              ) : (
                <div className="space-y-2.5">
                  {loans.slice(0, RECENT_LIMIT).map((row) => (
                    <LoanCard key={row.id} item={row} onView={(id) => navigate(`/customer/loans/${id}`)} />
                  ))}
                </div>
              )}
            </SectionCard>
          </motion.div>

          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15, duration: 0.3 }}>
            <SectionCard
              title="Đặt trước gần đây"
              subtitle="Chờ xác nhận và sẵn sàng lấy sách"
              actions={<NavLink to="/customer/reservations" className="text-[12px] font-medium text-primary hover:underline">Xem tất cả</NavLink>}
            >
              {reservations.length === 0 ? (
                <EmptyState variant="inbox" title="Chưa có đặt trước" description="Khám phá danh mục và đặt trước sách bạn yêu thích." />
              ) : (
                <div className="space-y-2.5">
                  {reservations.slice(0, RECENT_LIMIT).map((row) => (
                    <ReservationCard key={row.id} item={row} onCancel={() => navigate('/customer/reservations')} />
                  ))}
                </div>
              )}
            </SectionCard>
          </motion.div>
        </div>

        <div className="space-y-5">
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2, duration: 0.3 }}>
            <SectionCard
              title="Quyền lợi hội viên"
              subtitle={`Gói ${membership.plan_name || 'Tiêu chuẩn'}`}
              actions={<NavLink to="/customer/membership" className="text-[12px] font-medium text-primary hover:underline">Chi tiết</NavLink>}
            >
              <dl className="space-y-2.5 text-[13px]">
                {[
                  { label: 'Tối đa đang mượn', value: `${membership.limits.max_active_loans} cuốn` },
                  { label: 'Thời hạn mỗi lượt mượn', value: `${membership.limits.max_loan_days} ngày` },
                  { label: 'Phạt mỗi ngày quá hạn', value: formatCurrencyVnd(Number(membership.limits.fine_per_day) || 0) },
                  { label: 'Tối đa đặt trước', value: membership.limits.max_active_reservations ? `${membership.limits.max_active_reservations} cuốn` : '—' },
                ].map((item) => (
                  <div key={item.label} className="flex items-center justify-between gap-3 border-b border-border pb-2.5 last:border-0 last:pb-0">
                    <dt className="text-muted-foreground">{item.label}</dt>
                    <dd className="text-right font-semibold text-foreground">{item.value}</dd>
                  </div>
                ))}
              </dl>
            </SectionCard>
          </motion.div>

          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25, duration: 0.3 }}>
            <SectionCard
              title="Thông báo mới"
              actions={<NavLink to="/customer/notifications" className="text-[12px] font-medium text-primary hover:underline">Xem tất cả</NavLink>}
            >
              {notifications.length === 0 ? (
                <EmptyState variant="inbox" title="Chưa có thông báo" description="Cập nhật từ thư viện sẽ hiển thị ở đây." />
              ) : (
                <ul className="space-y-3">
                  {notifications.slice(0, 4).map((row) => (
                    <li key={row.id} className="flex items-start gap-3">
                      <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary" aria-hidden="true" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13px] font-semibold text-foreground">{row.subject || row.template_code || 'Thông báo'}</p>
                        <p className="mt-0.5 line-clamp-2 text-[12px] text-muted-foreground">{row.body || 'Có cập nhật mới từ thư viện.'}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </SectionCard>
          </motion.div>
        </div>
      </div>
    </div>
  );
}
