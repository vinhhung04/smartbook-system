import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { PackageCheck, RefreshCw } from 'lucide-react';
import { customerBorrowService } from '@/services/customer-borrow';
import { getApiErrorMessage } from '@/services/api';
import { toast } from 'sonner';
import { EmptyState } from '@/components/ui/empty-state';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { cn } from '@/components/ui/utils';
import { CustomerPageHeader } from './_shared/customer-page-header';
import { ReservationCard } from './_shared/reservation-card';

const FETCH_PAGE_SIZE = 100;
const MAX_FETCH_PAGES = 5;
const SHOW_STEP = 10;
const LIVE_STATUSES = ['PENDING', 'CONFIRMED', 'READY_FOR_PICKUP'];

type View = 'live' | 'history' | 'all';

export function CustomerReservationsPage() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>('live');
  const [visibleCount, setVisibleCount] = useState(SHOW_STEP);
  const [cancelTarget, setCancelTarget] = useState<string | null>(null);

  // All reservations are loaded so the counts are real, not the count of whichever page is showing.
  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      let all: any[] = [];
      for (let page = 1; page <= MAX_FETCH_PAGES; page += 1) {
        const response = await customerBorrowService.getMyReservations({ page, pageSize: FETCH_PAGE_SIZE });
        const data = Array.isArray(response?.data) ? response.data : [];
        all = all.concat(data);
        if (page >= (response?.meta?.totalPages || 1) || data.length < FETCH_PAGE_SIZE) break;
      }
      setRows(all);
    } catch (err) {
      setError(getApiErrorMessage(err, 'Không tải được đặt trước'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { setVisibleCount(SHOW_STEP); }, [view]);

  const handleCancel = async () => {
    if (!cancelTarget) return;
    try {
      await customerBorrowService.cancelReservation(cancelTarget);
      toast.success('Đã hủy đặt trước');
      setCancelTarget(null);
      await load();
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Hủy đặt trước thất bại'));
    }
  };

  const liveRows = useMemo(
    () => rows
      .filter((r) => LIVE_STATUSES.includes(String(r.status).toUpperCase()))
      // Ready-for-pickup first (that is the action the reader must take), then by soonest expiry.
      .sort((a, b) => {
        const aReady = a.status === 'READY_FOR_PICKUP' ? 0 : 1;
        const bReady = b.status === 'READY_FOR_PICKUP' ? 0 : 1;
        if (aReady !== bReady) return aReady - bReady;
        return new Date(a.expires_at).getTime() - new Date(b.expires_at).getTime();
      }),
    [rows],
  );
  const historyRows = useMemo(() => rows.filter((r) => !LIVE_STATUSES.includes(String(r.status).toUpperCase())), [rows]);
  const readyCount = liveRows.filter((r) => r.status === 'READY_FOR_PICKUP').length;

  const shown = view === 'live' ? liveRows : view === 'history' ? historyRows : [...liveRows, ...historyRows];
  const visible = shown.slice(0, visibleCount);

  return (
    <div className="mx-auto max-w-4xl space-y-5 p-4 sm:p-6 lg:p-8">
      <CustomerPageHeader
        title="Đặt trước của tôi"
        subtitle="Theo dõi sách đang chờ và sách sẵn sàng để nhận"
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

      {!loading && !error && readyCount > 0 && (
        <div role="status" className="flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-[13px] text-emerald-800 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-300">
          <PackageCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <p>
            <span className="font-semibold">{readyCount} cuốn đã sẵn sàng để nhận.</span> Mang mã QR bên dưới đến quầy thư viện trước khi hết hạn.
          </p>
        </div>
      )}

      {!loading && !error && rows.length > 0 && (
        <div className="max-w-full overflow-x-auto">
          <SegmentedControl
            layoutId="customer-reservations-view"
            value={view}
            onChange={(value) => setView(value as View)}
            options={[
              { value: 'live', label: `Đang chờ (${liveRows.length})` },
              { value: 'history', label: `Lịch sử (${historyRows.length})` },
              { value: 'all', label: `Tất cả (${rows.length})` },
            ]}
            gradientClassName="from-amber-500 to-orange-500"
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
          title="Không tải được đặt trước"
          description={error}
          action={<button onClick={() => void load()} className="font-medium text-primary hover:underline">Thử lại</button>}
        />
      ) : rows.length === 0 ? (
        <EmptyState
          variant="no-data"
          title="Chưa có đặt trước"
          description="Khám phá danh mục và đặt trước sách bạn muốn mượn."
          action={<button onClick={() => navigate('/customer/books')} className="font-medium text-primary hover:underline">Xem danh mục</button>}
        />
      ) : shown.length === 0 ? (
        <EmptyState
          variant="inbox"
          title={view === 'live' ? 'Không có đặt trước nào đang chờ' : 'Chưa có lịch sử đặt trước'}
          description={view === 'live' ? 'Đặt trước sách trong danh mục để giữ chỗ cho bạn.' : 'Các đặt trước đã hoàn thành hoặc đã hủy sẽ hiển thị ở đây.'}
          action={view === 'live' ? <button onClick={() => navigate('/customer/books')} className="font-medium text-primary hover:underline">Xem danh mục</button> : undefined}
        />
      ) : (
        <div className="space-y-3">
          {visible.map((row) => (
            <ReservationCard key={row.id} item={row} onCancel={(id) => setCancelTarget(id)} />
          ))}
          {shown.length > visible.length && (
            <div className="flex justify-center pt-1">
              <button
                onClick={() => setVisibleCount((count) => count + SHOW_STEP)}
                className="rounded-xl border border-input bg-card px-4 py-2 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                Xem thêm ({shown.length - visible.length} đặt trước)
              </button>
            </div>
          )}
        </div>
      )}

      <ConfirmDialog
        open={Boolean(cancelTarget)}
        onOpenChange={(open) => { if (!open) setCancelTarget(null); }}
        title="Hủy đặt trước?"
        description="Sách sẽ được nhả lại cho người khác. Bạn có thể đặt trước lại sau nếu còn sách."
        variant="destructive"
        confirmLabel="Hủy đặt trước"
        onConfirm={handleCancel}
      />
    </div>
  );
}
