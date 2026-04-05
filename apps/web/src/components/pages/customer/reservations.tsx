import { useEffect, useState } from 'react';
import { CalendarClock, RefreshCw } from 'lucide-react';
import { customerBorrowService } from '@/services/customer-borrow';
import { getApiErrorMessage } from '@/services/api';
import { toast } from 'sonner';
import { SectionCard } from '@/components/ui/section-card';
import { StatCard } from '@/components/ui/stat-card';
import { EmptyState } from '@/components/ui/empty-state';
import { LoadingOverlay } from '@/components/ui/loading-state';
import { ReservationCard } from './_shared/reservation-card';

export function CustomerReservationsPage() {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await customerBorrowService.getMyReservations();
      setRows(Array.isArray(response?.data) ? response.data : []);
    } catch (err) {
      setError(getApiErrorMessage(err, 'Failed to load reservations'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const handleCancel = async (id: string) => {
    try {
      await customerBorrowService.cancelReservation(id);
      toast.success('Reservation cancelled');
      await load();
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Failed to cancel reservation'));
    }
  };

  const pendingCount = rows.filter(r => r.status === 'PENDING').length;
  const readyCount = rows.filter(r => r.status === 'READY_FOR_PICKUP').length;
  const completedCount = rows.filter(r => r.status === 'PICKED_UP' || r.status === 'COMPLETED' || r.status === 'CANCELLED' || r.status === 'EXPIRED').length;

  return (
    <div className="p-6 lg:p-8 max-w-5xl mx-auto space-y-6">
      {/* Hero */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-100 to-orange-50 flex items-center justify-center border border-amber-200/40">
            <CalendarClock className="w-5 h-5 text-amber-600" />
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">My Reservations</h1>
            <p className="text-[13px] text-muted-foreground">Track your pending and ready-to-pickup items</p>
          </div>
        </div>
        <button
          onClick={() => void load()}
          disabled={loading}
          className="inline-flex items-center gap-1.5 h-9 rounded-xl border border-input bg-card px-3 text-[12px] text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* Stats */}
      {!loading && (
        <div className="grid grid-cols-3 gap-3">
          <StatCard label="Pending" value={pendingCount} icon={CalendarClock} variant="warning" />
          <StatCard label="Ready for Pickup" value={readyCount} icon={CalendarClock} variant="info" />
          <StatCard label="Completed / Cancelled" value={completedCount} icon={CalendarClock} variant="default" />
        </div>
      )}

      {/* Content */}
      {loading ? (
        <LoadingOverlay />
      ) : error ? (
        <EmptyState
          variant="error"
          title="Failed to load reservations"
          description={error}
          action={<button onClick={() => void load()} className="text-primary font-medium hover:underline">Try again</button>}
        />
      ) : rows.length === 0 ? (
        <SectionCard>
          <EmptyState
            variant="no-data"
            title="No reservations yet"
            description="Browse our catalog and reserve books you would like to borrow."
            action={
              <button onClick={() => void load()} className="text-primary font-medium hover:underline">
                Refresh
              </button>
            }
          />
        </SectionCard>
      ) : (
        <div className="space-y-3">
          {rows.map((row) => (
            <ReservationCard key={row.id} item={row} onCancel={(id) => void handleCancel(id)} />
          ))}
        </div>
      )}
    </div>
  );
}
