import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { customerBorrowService } from '@/services/customer-borrow';
import { getApiErrorMessage } from '@/services/api';
import { EmptyState } from '@/components/ui/empty-state';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { cn } from '@/components/ui/utils';
import { CustomerPageHeader } from './_shared/customer-page-header';
import { LoanCard } from './_shared/loan-card';

const FETCH_PAGE_SIZE = 100;
const MAX_FETCH_PAGES = 5;
const SHOW_STEP = 10;
const OPEN_STATUSES = ['BORROWED', 'OVERDUE', 'RESERVED'];

type View = 'open' | 'history' | 'all';

export function CustomerLoansPage() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>('open');
  const [visibleCount, setVisibleCount] = useState(SHOW_STEP);

  // The counts and the "currently borrowed" list must reflect ALL of the customer's loans, not just
  // the first page of 20 (the old stat cards were computed from whichever page was showing).
  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      let all: any[] = [];
      for (let page = 1; page <= MAX_FETCH_PAGES; page += 1) {
        const response = await customerBorrowService.getMyLoans({ page, pageSize: FETCH_PAGE_SIZE });
        const data = Array.isArray(response?.data) ? response.data : [];
        all = all.concat(data);
        if (page >= (response?.meta?.totalPages || 1) || data.length < FETCH_PAGE_SIZE) break;
      }
      setRows(all);
    } catch (err) {
      setError(getApiErrorMessage(err, 'Không tải được phiếu mượn'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { setVisibleCount(SHOW_STEP); }, [view]);

  const openLoans = useMemo(
    () => rows
      .filter((r) => OPEN_STATUSES.includes(String(r.status).toUpperCase()))
      // Overdue first, then the soonest due date.
      .sort((a, b) => {
        const aOverdue = a.status === 'OVERDUE' ? 0 : 1;
        const bOverdue = b.status === 'OVERDUE' ? 0 : 1;
        if (aOverdue !== bOverdue) return aOverdue - bOverdue;
        return new Date(a.due_date).getTime() - new Date(b.due_date).getTime();
      }),
    [rows],
  );
  const historyLoans = useMemo(() => rows.filter((r) => !OPEN_STATUSES.includes(String(r.status).toUpperCase())), [rows]);
  const overdueCount = openLoans.filter((r) => r.status === 'OVERDUE').length;

  const shown = view === 'open' ? openLoans : view === 'history' ? historyLoans : [...openLoans, ...historyLoans];
  const visible = shown.slice(0, visibleCount);

  return (
    <div className="mx-auto max-w-4xl space-y-5 p-4 sm:p-6 lg:p-8">
      <CustomerPageHeader
        title="Phiếu mượn của tôi"
        subtitle="Theo dõi hạn trả và sách đang mượn"
        actions={
          <button
            onClick={() => void load()}
            disabled={loading}
            className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-input bg-card px-3 text-[12px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
            Làm mới
          </button>
        }
      />

      {!loading && !error && overdueCount > 0 && (
        <div role="alert" className="flex items-start gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-[13px] text-rose-800 dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-300">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <p>
            Bạn có <span className="font-semibold">{overdueCount} phiếu mượn quá hạn</span>. Hãy mang sách đến trả sớm để tránh phát sinh thêm tiền phạt.
          </p>
        </div>
      )}

      {!loading && !error && rows.length > 0 && (
        <div className="max-w-full overflow-x-auto">
          <SegmentedControl
            layoutId="customer-loans-view"
            value={view}
            onChange={(value) => setView(value as View)}
            options={[
              { value: 'open', label: `Đang mượn (${openLoans.length})` },
              { value: 'history', label: `Lịch sử (${historyLoans.length})` },
              { value: 'all', label: `Tất cả (${rows.length})` },
            ]}
            gradientClassName="from-emerald-600 to-teal-600"
            className="w-max"
          />
        </div>
      )}

      {loading ? (
        <div className="space-y-3" aria-busy="true">
          {[0, 1, 2].map((i) => <div key={i} className="h-24 animate-pulse rounded-xl border bg-card" />)}
        </div>
      ) : error ? (
        <EmptyState
          variant="error"
          title="Không tải được phiếu mượn"
          description={error}
          action={<button onClick={() => void load()} className="font-medium text-primary hover:underline">Thử lại</button>}
        />
      ) : rows.length === 0 ? (
        <EmptyState
          variant="no-data"
          title="Chưa có phiếu mượn"
          description="Bắt đầu bằng cách khám phá danh mục và mượn cuốn sách đầu tiên."
          action={
            <button onClick={() => navigate('/customer/books')} className="font-medium text-primary hover:underline">
              Xem danh mục
            </button>
          }
        />
      ) : shown.length === 0 ? (
        <EmptyState
          variant="inbox"
          title={view === 'open' ? 'Bạn không có sách nào đang mượn' : 'Chưa có lịch sử mượn'}
          description={view === 'open' ? 'Khám phá danh mục để tìm cuốn sách tiếp theo.' : 'Các phiếu đã trả sẽ hiển thị ở đây.'}
          action={
            view === 'open' ? (
              <button onClick={() => navigate('/customer/books')} className="font-medium text-primary hover:underline">Xem danh mục</button>
            ) : undefined
          }
        />
      ) : (
        <div className="space-y-3">
          {visible.map((row) => (
            <LoanCard key={row.id} item={row} onView={(id) => navigate(`/customer/loans/${id}`)} />
          ))}
          {shown.length > visible.length && (
            <div className="flex justify-center pt-1">
              <button
                onClick={() => setVisibleCount((count) => count + SHOW_STEP)}
                className="rounded-xl border border-input bg-card px-4 py-2 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                Xem thêm ({shown.length - visible.length} phiếu)
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
