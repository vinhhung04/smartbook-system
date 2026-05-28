import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { HandCoins, RefreshCw } from 'lucide-react';
import { customerBorrowService } from '@/services/customer-borrow';
import { getApiErrorMessage } from '@/services/api';
import { SectionCard } from '@/components/ui/section-card';
import { StatCard } from '@/components/ui/stat-card';
import { EmptyState } from '@/components/ui/empty-state';
import { LoadingOverlay } from '@/components/ui/loading-state';
import { LoanCard } from './_shared/loan-card';

export function CustomerLoansPage() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await customerBorrowService.getMyLoans();
      setRows(Array.isArray(response?.data) ? response.data : []);
    } catch (err) {
      setError(getApiErrorMessage(err, 'Không tải được phiếu mượn'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const activeLoans = rows.filter(r => r.status === 'BORROWED' || r.status === 'OVERDUE' || r.status === 'RESERVED').length;
  const overdueLoans = rows.filter(r => r.status === 'OVERDUE').length;
  const returnedLoans = rows.filter(r => r.status === 'RETURNED').length;

  return (
    <div className="p-6 lg:p-8 max-w-5xl mx-auto space-y-6">
      {/* Hero */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-100 to-teal-50 flex items-center justify-center border border-emerald-200/40">
            <HandCoins className="w-5 h-5 text-emerald-600" />
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Phiếu mượn của tôi</h1>
            <p className="text-[13px] text-muted-foreground">Theo dõi hạn trả và quản lý sách đang mượn</p>
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

      {!loading && (
        <div className="grid grid-cols-3 gap-3">
          <StatCard label="Đang mượn" value={activeLoans} icon={HandCoins} variant="info" />
          <StatCard label="Quá hạn" value={overdueLoans} icon={HandCoins} variant="danger" />
          <StatCard label="Đã trả" value={returnedLoans} icon={HandCoins} variant="success" />
        </div>
      )}

      {/* Content */}
      {loading ? (
        <LoadingOverlay />
      ) : error ? (
        <EmptyState
          variant="error"
          title="Không tải được phiếu mượn"
          description={error}
          action={<button onClick={() => void load()} className="text-primary font-medium hover:underline">Thử lại</button>}
        />
      ) : rows.length === 0 ? (
        <SectionCard>
          <EmptyState
            variant="no-data"
            title="Chưa có phiếu mượn"
            description="Bắt đầu bằng cách khám phá danh mục và mượn cuốn sách đầu tiên."
            action={
              <button onClick={() => navigate('/customer/books')} className="text-primary font-medium hover:underline">
                Xem danh mục
              </button>
            }
          />
        </SectionCard>
      ) : (
        <div className="space-y-3">
          {rows.map((row) => (
            <LoanCard key={row.id} item={row} onView={(id) => navigate(`/customer/loans/${id}`)} />
          ))}
        </div>
      )}
    </div>
  );
}
