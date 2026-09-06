import { useCallback, useEffect, useState } from 'react';
import { CalendarClock, RefreshCw } from 'lucide-react';
import { customerBorrowService } from '@/services/customer-borrow';
import { getApiErrorMessage } from '@/services/api';
import { toast } from 'sonner';
import { SectionCard } from '@/components/ui/section-card';
import { StatCard } from '@/components/ui/stat-card';
import { EmptyState } from '@/components/ui/empty-state';
import { LoadingOverlay } from '@/components/ui/loading-state';
import { ReservationCard } from './_shared/reservation-card';

const PAGE_SIZE = 20;

export function CustomerReservationsPage() {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await customerBorrowService.getMyReservations({ page, pageSize: PAGE_SIZE });
      setRows(Array.isArray(response?.data) ? response.data : []);
      setTotalPages(response?.meta?.totalPages || 1);
    } catch (err) {
      setError(getApiErrorMessage(err, 'Không tải được đặt trước'));
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => { void load(); }, [load]);

  const handleCancel = async (id: string) => {
    try {
      await customerBorrowService.cancelReservation(id);
      toast.success('Đã hủy đặt trước');
      await load();
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Hủy đặt trước thất bại'));
    }
  };

  const pendingCount = rows.filter(r => r.status === 'PENDING').length;
  const readyCount = rows.filter(r => r.status === 'READY_FOR_PICKUP').length;
  const completedCount = rows.filter(r => r.status === 'CONVERTED_TO_LOAN' || r.status === 'CANCELLED' || r.status === 'EXPIRED').length;

  return (
    <div className="p-6 lg:p-8 max-w-5xl mx-auto space-y-6">
      {/* Hero */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-100 to-orange-50 dark:from-amber-950/40 dark:to-orange-950/20 flex items-center justify-center border border-amber-200/40 dark:border-amber-800/40">
            <CalendarClock className="w-5 h-5 text-amber-600 dark:text-amber-400" />
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Đặt trước của tôi</h1>
            <p className="text-[13px] text-muted-foreground">Theo dõi đặt trước đang chờ và sẵn sàng nhận sách</p>
          </div>
        </div>
        <button
          onClick={() => void load()}
          disabled={loading}
          className="inline-flex items-center gap-1.5 h-9 rounded-xl border border-input bg-card px-3 text-[12px] text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          Làm mới
        </button>
      </div>

      {/* Stats */}
      {!loading && (
        <div className="grid grid-cols-3 gap-3">
          <StatCard label="Chờ xác nhận" value={pendingCount} icon={CalendarClock} variant="warning" />
          <StatCard label="Sẵn lấy sách" value={readyCount} icon={CalendarClock} variant="info" />
          <StatCard label="Hoàn thành / Hủy" value={completedCount} icon={CalendarClock} variant="default" />
        </div>
      )}

      {/* Content */}
      {loading ? (
        <LoadingOverlay />
      ) : error ? (
        <EmptyState
          variant="error"
          title="Không tải được đặt trước"
          description={error}
          action={<button onClick={() => void load()} className="text-primary font-medium hover:underline">Thử lại</button>}
        />
      ) : rows.length === 0 ? (
        <SectionCard>
          <EmptyState
            variant="no-data"
            title="Chưa có đặt trước"
            description="Khám phá danh mục và đặt trước sách bạn muốn mượn."
            action={
              <button onClick={() => void load()} className="text-primary font-medium hover:underline">
                Làm mới
              </button>
            }
          />
        </SectionCard>
      ) : (
        <div className="space-y-3">
          {rows.map((row) => (
            <ReservationCard key={row.id} item={row} onCancel={(id) => void handleCancel(id)} />
          ))}
          {totalPages > 1 && (
            <div className="flex items-center justify-between pt-2 text-[12px] text-muted-foreground">
              <span>Trang {page} / {totalPages}</span>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  className="px-3 py-1 rounded border border-input text-amber-700 dark:text-amber-400 cursor-pointer hover:bg-amber-50 dark:hover:bg-amber-500/10 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
                >
                  Trước
                </button>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                  className="px-3 py-1 rounded border border-input text-amber-700 dark:text-amber-400 cursor-pointer hover:bg-amber-50 dark:hover:bg-amber-500/10 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
                >
                  Tiếp
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
