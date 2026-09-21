import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { RefreshCw } from 'lucide-react';
import { customerBorrowService } from '@/services/customer-borrow';
import { getApiErrorMessage } from '@/services/api';
import { formatCurrencyVnd, formatDateTime } from './_shared/customer-format';
import { SectionCard } from '@/components/ui/section-card';
import { EmptyState } from '@/components/ui/empty-state';
import { cn } from '@/components/ui/utils';
import { CustomerPageHeader } from './_shared/customer-page-header';
import { FineCard } from './_shared/fine-card';

function remainingOf(fine: any): number {
  const paid = (fine?.fine_payments || []).reduce((sum: number, row: any) => sum + Number(row?.amount || 0), 0);
  return Math.max(0, Number(fine?.amount || 0) - Number(fine?.waived_amount || 0) - paid);
}

export function CustomerFinesPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [data, setData] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [accountSnapshot, setAccountSnapshot] = useState<any | null>(null);
  const [ledgerRows, setLedgerRows] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);

  const loadFines = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await customerBorrowService.getMyFines();
      setData(response?.data || null);

      const [accountResponse, ledgerResponse] = await Promise.all([
        customerBorrowService.getMyAccount(),
        customerBorrowService.getMyAccountLedger({ page: 1, pageSize: 5 }),
      ]);

      setAccountSnapshot(accountResponse?.data || null);
      setLedgerRows(Array.isArray(ledgerResponse?.data) ? ledgerResponse.data : []);
    } catch (err) {
      setError(getApiErrorMessage(err, 'Không tải được tiền phạt'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void loadFines(); }, []);

  useEffect(() => {
    const payment = searchParams.get('payment');
    if (payment === 'success') {
      toast.success('Thanh toán thành công!');
      void loadFines();
      setSearchParams((prev) => { prev.delete('payment'); return prev; }, { replace: true });
    } else if (payment === 'failed') {
      toast.error('Thanh toán không thành công. Vui lòng thử lại.');
      setSearchParams((prev) => { prev.delete('payment'); return prev; }, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const totalFine = Number(data?.total_fine_balance || 0);
  const walletBalance = Number(accountSnapshot?.available_balance || 0);
  const fines: any[] = data?.fines || [];
  const openFines = fines.filter((fine) => remainingOf(fine) > 0);
  const settledFines = fines.filter((fine) => remainingOf(fine) <= 0);

  return (
    <div className="mx-auto max-w-4xl space-y-5 p-4 sm:p-6 lg:p-8">
      <CustomerPageHeader
        title="Tiền phạt & ví"
        subtitle="Số tiền phạt còn lại và lịch sử giao dịch ví của bạn"
        actions={
          <button
            onClick={() => void loadFines()}
            disabled={loading}
            className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-input bg-card px-3 text-[12px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
            Làm mới
          </button>
        }
      />

      {loading ? (
        <div className="space-y-3" aria-busy="true">
          <div className="h-32 animate-pulse rounded-xl border bg-card" />
          <div className="h-40 animate-pulse rounded-xl border bg-card" />
        </div>
      ) : error ? (
        <EmptyState variant="error" title="Không tải được tiền phạt" description={error} action={<button onClick={() => void loadFines()} className="font-medium text-primary hover:underline">Thử lại</button>} />
      ) : (
        <>
          <section aria-label="Tổng quan tiền phạt" className="grid overflow-hidden rounded-xl border border-border bg-card sm:grid-cols-2">
            <div className={cn('p-5', totalFine > 0 ? 'bg-rose-50/60 dark:bg-rose-950/20' : 'bg-emerald-50/50 dark:bg-emerald-950/15')}>
              <p className="text-[12px] font-medium text-muted-foreground">Tiền phạt còn lại</p>
              <p className={cn('mt-1.5 font-mono text-[28px] font-bold leading-none tabular-nums', totalFine > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400')}>
                {formatCurrencyVnd(totalFine)}
              </p>
              <p className="mt-2 text-[12px] text-muted-foreground">
                {totalFine > 0
                  ? 'Thanh toán online bên dưới, hoặc đến quầy thư viện — nhân viên sẽ ghi nhận ngay.'
                  : 'Bạn không có tiền phạt. Tiếp tục đọc sách nhé!'}
              </p>
            </div>
            <div className="border-t border-border p-5 sm:border-l sm:border-t-0">
              <p className="text-[12px] font-medium text-muted-foreground">Số dư ví</p>
              <p className={cn('mt-1.5 font-mono text-[28px] font-bold leading-none tabular-nums', walletBalance < 100000 ? 'text-amber-600 dark:text-amber-400' : 'text-foreground')}>
                {formatCurrencyVnd(walletBalance)}
              </p>
              <p className="mt-2 text-[12px] text-muted-foreground">
                {walletBalance < 100000 ? 'Số dư thấp, nên nạp thêm để mượn sách thuận tiện.' : 'Sẵn sàng để mượn sách.'}
              </p>
            </div>
          </section>

          {openFines.length > 0 && (
            <SectionCard title="Cần thanh toán" subtitle={`${openFines.length} phiếu phạt`}>
              <div className="space-y-3">
                {openFines.map((fine: any) => <FineCard key={fine.id} fine={fine} />)}
              </div>
            </SectionCard>
          )}

          {settledFines.length > 0 && (
            <SectionCard title="Đã thanh toán / miễn giảm" subtitle={`${settledFines.length} phiếu phạt`}>
              <div className="space-y-3">
                {settledFines.map((fine: any) => <FineCard key={fine.id} fine={fine} />)}
              </div>
            </SectionCard>
          )}

          {fines.length === 0 && (
            <EmptyState variant="no-data" title="Chưa có phiếu phạt" description="Bạn không có tiền phạt. Tiếp tục đọc sách nhé!" />
          )}

          <SectionCard title="Giao dịch ví gần đây" subtitle="5 giao dịch mới nhất">
            {ledgerRows.length === 0 ? (
              <EmptyState variant="inbox" title="Chưa có giao dịch" description="Lịch sử giao dịch ví sẽ hiển thị ở đây." />
            ) : (
              <ul className="divide-y divide-border">
                {ledgerRows.map((entry) => {
                  const amount = Number(entry.amount);
                  return (
                    <li key={entry.id} className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13px] font-medium text-foreground">{entry.entry_type || entry.reference_type || 'Giao dịch'}</p>
                        <p className="text-[11px] text-muted-foreground">{formatDateTime(entry.created_at)}</p>
                      </div>
                      <span className={cn('shrink-0 font-mono text-[14px] font-bold tabular-nums', amount >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400')}>
                        {amount >= 0 ? '+' : ''}{formatCurrencyVnd(amount)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </SectionCard>
        </>
      )}
    </div>
  );
}
