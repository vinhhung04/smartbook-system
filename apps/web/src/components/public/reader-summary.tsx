import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { AlertTriangle, ArrowRight, BookOpen, CalendarClock, Clock3, PackageCheck } from 'lucide-react';
import { customerBorrowService } from '@/services/customer-borrow';
import type { PublicBranch } from '@/services/public-catalog';
import { cn } from '@/components/ui/utils';
import { BookCover } from './book-cover';

const DAY_MS = 24 * 60 * 60 * 1000;
const DUE_SOON_DAYS = 3;
const MAX_ITEMS = 4;

interface Loan {
  id: string;
  status: string;
  due_date: string | null;
  primary_book_title?: string | null;
  extra_item_count?: number | null;
}

interface Reservation {
  id: string;
  status: string;
  book_title?: string | null;
  book_author?: string | null;
  book_cover_url?: string | null;
  warehouse_id?: string | null;
  pickup_code?: string | null;
  pickup_code_expires_at?: string | null;
  expires_at?: string | null;
}

type Tone = 'red' | 'emerald' | 'amber' | 'neutral' | 'indigo';

interface Item {
  key: string;
  tone: Tone;
  /** Lower comes first: what needs the reader soonest. */
  rank: number;
  label: string;
  title: string;
  detail: string;
  to: string;
  code?: string | null;
  cover?: { title: string; author?: string | null; url?: string | null };
}

const TONES: Record<Tone, { card: string; label: string; icon: typeof BookOpen }> = {
  red: { card: 'border-red-200 bg-red-50/70 dark:border-red-500/30 dark:bg-red-950/25', label: 'text-red-700 dark:text-red-300', icon: AlertTriangle },
  emerald: { card: 'border-emerald-200 bg-emerald-50/70 dark:border-emerald-500/30 dark:bg-emerald-950/25', label: 'text-emerald-700 dark:text-emerald-300', icon: PackageCheck },
  amber: { card: 'border-amber-200 bg-amber-50/70 dark:border-amber-500/30 dark:bg-amber-950/25', label: 'text-amber-700 dark:text-amber-300', icon: CalendarClock },
  neutral: { card: 'border-border bg-card', label: 'text-muted-foreground', icon: BookOpen },
  indigo: { card: 'border-indigo-200 bg-indigo-50/60 dark:border-indigo-500/30 dark:bg-indigo-950/25', label: 'text-indigo-700 dark:text-indigo-300', icon: Clock3 },
};

const dateFormat = new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: '2-digit' });
const dateTimeFormat = new Intl.DateTimeFormat('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' });

/** Whole days from now until `iso` (negative once it has passed). */
function daysUntil(iso: string, now: number) {
  return Math.ceil((new Date(iso).getTime() - now) / DAY_MS);
}

function loanItem(loan: Loan, now: number): Item {
  const title = loan.primary_book_title || 'Phiếu mượn';
  const extra = loan.extra_item_count ? ` và ${loan.extra_item_count} cuốn khác` : '';
  const days = loan.due_date ? daysUntil(loan.due_date, now) : null;
  const base = { key: `loan-${loan.id}`, title: `${title}${extra}`, to: `/customer/loans/${loan.id}` };
  if (loan.status === 'OVERDUE' || (days !== null && days < 0)) {
    const late = days !== null ? Math.max(1, -days) : null;
    return { ...base, tone: 'red', rank: 0, label: late ? `Quá hạn ${late} ngày` : 'Quá hạn', detail: 'Trả sớm để tránh tiền phạt tăng thêm.' };
  }
  if (days !== null && days <= DUE_SOON_DAYS) {
    return { ...base, tone: 'amber', rank: 2, label: days === 0 ? 'Hạn trả hôm nay' : `Còn ${days} ngày`, detail: `Hạn trả ${dateFormat.format(new Date(loan.due_date!))}. Có thể gia hạn trong Sách của tôi.` };
  }
  return { ...base, tone: 'neutral', rank: 3, label: 'Đang mượn', detail: loan.due_date ? `Hạn trả ${dateFormat.format(new Date(loan.due_date))}` : 'Đang mượn' };
}

function reservationItem(reservation: Reservation, branchName: (id?: string | null) => string | null): Item {
  const title = reservation.book_title || 'Sách đặt trước';
  const cover = { title, author: reservation.book_author, url: reservation.book_cover_url };
  const where = branchName(reservation.warehouse_id);
  if (reservation.status === 'READY_FOR_PICKUP') {
    const until = reservation.pickup_code_expires_at || reservation.expires_at;
    return {
      key: `res-${reservation.id}`, tone: 'emerald', rank: 1, label: 'Sẵn sàng nhận', title, cover,
      code: reservation.pickup_code,
      detail: [where ? `Tại ${where}` : null, until ? `nhận trước ${dateTimeFormat.format(new Date(until))}` : null].filter(Boolean).join(' · '),
      to: '/customer/reservations',
    };
  }
  const confirmed = reservation.status === 'CONFIRMED';
  return {
    key: `res-${reservation.id}`, tone: 'indigo', rank: 4, title, cover,
    label: confirmed ? 'Đang chuẩn bị sách' : 'Chờ xác nhận',
    detail: confirmed
      ? (where ? `Thư viện đang chuẩn bị sách tại ${where}` : 'Thư viện đang chuẩn bị sách')
      : (where ? `Nhận tại ${where} khi thư viện xác nhận` : 'Thư viện sẽ xác nhận đặt trước của bạn'),
    to: '/customer/reservations',
  };
}

interface Activity {
  loans: Loan[];
  reservations: Reservation[];
}

async function loadActivity(): Promise<Activity> {
  const list = (response: { data?: unknown } | undefined) => (Array.isArray(response?.data) ? response.data : []);
  const byStatus = (status: string, kind: 'loans' | 'reservations') => (kind === 'loans'
    ? customerBorrowService.getMyLoans({ status, pageSize: 20 })
    : customerBorrowService.getMyReservations({ status, pageSize: 20 })).then(list);
  const [borrowed, overdue, ready, pending, confirmed] = await Promise.all([
    byStatus('BORROWED', 'loans'),
    byStatus('OVERDUE', 'loans'),
    byStatus('READY_FOR_PICKUP', 'reservations'),
    byStatus('PENDING', 'reservations'),
    byStatus('CONFIRMED', 'reservations'),
  ]);
  return { loans: [...overdue, ...borrowed] as Loan[], reservations: [...ready, ...pending, ...confirmed] as Reservation[] };
}

function toItems({ loans, reservations }: Activity, branches: PublicBranch[]): Item[] {
  const now = Date.now();
  const names = new Map(branches.map((branch) => [branch.id, branch.name]));
  const branchName = (id?: string | null) => (id ? names.get(id) ?? null : null);
  return [
    ...loans.map((loan) => loanItem(loan, now)),
    ...reservations.map((reservation) => reservationItem(reservation, branchName)),
  ].sort((a, b) => a.rank - b.rank);
}

/**
 * "Sách của tôi" at a glance, for signed-in readers only: what is overdue or
 * due soon, what is ready to pick up (with the pickup code), what is still
 * being prepared. Optional section — it hides itself if the account API fails.
 */
export function ReaderSummary({ name, branches }: { name?: string | null; branches: PublicBranch[] }) {
  const [activity, setActivity] = useState<Activity | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    loadActivity()
      .then((next) => { if (alive) setActivity(next); })
      .catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, []);

  // Branch names arrive separately (home loads them for its branch section).
  const items = useMemo(() => (activity ? toItems(activity, branches) : null), [activity, branches]);

  if (failed) return null;
  const shown = items?.slice(0, MAX_ITEMS) ?? [];
  const hidden = (items?.length ?? 0) - shown.length;
  const urgent = items?.filter((item) => item.rank <= 1).length ?? 0;

  return (
    <section aria-labelledby="sach-cua-toi" className="rounded-2xl border border-border bg-card/70 p-5 shadow-[0_18px_40px_-30px_rgba(15,23,42,0.4)] backdrop-blur sm:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-indigo-700 dark:text-indigo-300">Sách của tôi</p>
          <h2 id="sach-cua-toi" className="mt-1 font-serif text-[22px] font-semibold tracking-tight sm:text-[24px]">Chào {name || 'bạn đọc'}</h2>
          {items ? (
            <p className="mt-0.5 text-[13.5px] text-muted-foreground">
              {items.length === 0 ? 'Bạn chưa mượn hay đặt trước cuốn nào.' : urgent > 0 ? `${urgent} việc cần bạn để ý` : `${items.length} cuốn đang theo dõi`}
            </p>
          ) : null}
        </div>
        <Link to="/customer" className="group inline-flex h-9 items-center gap-1.5 rounded-full border border-border bg-card px-3.5 text-[13px] font-semibold hover:border-indigo-300 hover:text-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/50 dark:hover:text-indigo-300">
          Mở Sách của tôi <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
        </Link>
      </div>

      {!items ? (
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-busy="true" aria-label="Đang tải sách của bạn">
          {Array.from({ length: 2 }).map((_, index) => <div key={index} className="h-[5.5rem] animate-pulse rounded-xl bg-muted/60" />)}
        </div>
      ) : items.length === 0 ? (
        <p className="mt-3 text-[13.5px] text-muted-foreground">
          Tìm một cuốn ở ô phía trên hoặc{' '}
          <Link to="/books?availability=available" className="font-semibold text-indigo-700 hover:underline dark:text-indigo-300">xem sách đang có trên kệ</Link>
          {' '}— sách bạn mượn và mã nhận sách sẽ hiện ở đây.
        </p>
      ) : (
        <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {shown.map((item) => {
            const tone = TONES[item.tone];
            const Icon = tone.icon;
            return (
              <li key={item.key} className="min-w-0">
                <Link to={item.to} className={cn('group flex h-full gap-3 rounded-xl border p-3.5 transition-shadow hover:shadow-[0_12px_28px_-18px_rgba(15,23,42,0.45)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/50', tone.card)}>
                  {item.cover ? <BookCover title={item.cover.title} author={item.cover.author} imageUrl={item.cover.url} className="w-11 shrink-0 self-start rounded-[3px]" /> : null}
                  <span className="min-w-0 flex-1">
                    <span className={cn('flex items-center gap-1.5 text-[12px] font-semibold', tone.label)}>
                      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /> {item.label}
                    </span>
                    <span className="mt-1 line-clamp-2 block text-[13.5px] font-semibold leading-snug text-foreground group-hover:underline">{item.title}</span>
                    {item.code ? (
                      <span className="mt-1.5 inline-flex items-baseline gap-1.5 rounded-md bg-white/80 px-2 py-0.5 ring-1 ring-emerald-600/20 dark:bg-white/5">
                        <span className="text-[11px] text-muted-foreground">Mã nhận</span>
                        <span className="font-mono text-[13px] font-bold tracking-wider text-foreground">{item.code}</span>
                      </span>
                    ) : null}
                    {item.detail ? <span className="mt-1 block text-[12px] leading-snug text-muted-foreground">{item.detail}</span> : null}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      {hidden > 0 ? (
        <p className="mt-3 text-[12.5px] text-muted-foreground">
          và {hidden} mục khác trong <Link to="/customer" className="font-semibold text-indigo-700 hover:underline dark:text-indigo-300">Sách của tôi</Link>.
        </p>
      ) : null}
    </section>
  );
}
