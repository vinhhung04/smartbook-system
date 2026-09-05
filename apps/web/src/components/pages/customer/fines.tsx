import { useEffect, useState } from 'react';
import { ReceiptText, RefreshCw, Wallet } from 'lucide-react';
import { customerBorrowService } from '@/services/customer-borrow';
import { getApiErrorMessage } from '@/services/api';
import { formatCurrencyVnd, formatDateTime } from './_shared/customer-format';
import { SectionCard } from '@/components/ui/section-card';
import { StatCard } from '@/components/ui/stat-card';
import { EmptyState } from '@/components/ui/empty-state';
import { LoadingOverlay } from '@/components/ui/loading-state';
import { FineCard } from './_shared/fine-card';

export function CustomerFinesPage() {
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

  const totalFine = Number(data?.total_fine_balance || 0);
  const walletBalance = Number(accountSnapshot?.available_balance || 0);

  return (
    <div className="p-6 lg:p-8 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-rose-100 to-red-50 flex items-center justify-center border border-rose-200/40">
            <ReceiptText className="w-5 h-5 text-rose-600" />
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Tiền phạt & Ví của tôi</h1>
            <p className="text-[13px] text-muted-foreground">Xem số dư phạt và lịch sử giao dịch ví</p>
          </div>
        </div>
        <button
          onClick={() => void loadFines()}
          disabled={loading}
          className="inline-flex items-center gap-1.5 h-9 rounded-xl border border-input bg-white px-3 text-[12px] text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          Làm mới
        </button>
      </div>

      {loading ? (
        <LoadingOverlay />
      ) : error ? (
        <EmptyState variant="error" title="Không tải được tiền phạt" description={error} action={<button onClick={() => void loadFines()} className="text-primary font-medium hover:underline">Thử lại</button>} />
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatCard label="Tiền phạt còn lại" value={formatCurrencyVnd(totalFine)} icon={ReceiptText} variant={totalFine > 0 ? 'danger' : 'success'} />
            <StatCard label="Số dư ví" value={formatCurrencyVnd(walletBalance)} icon={Wallet} variant={walletBalance < 100000 ? 'warning' : 'success'} />
            <StatCard label="Số phiếu phạt" value={(data?.fines || []).length} icon={ReceiptText} variant="default" />
            <StatCard label="Lần thanh toán" value={(data?.fine_payments || []).length} icon={ReceiptText} variant="info" />
          </div>

          {totalFine > 0 ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50/60 px-5 py-4 text-[13px] text-amber-800">
              Bạn còn <strong>{formatCurrencyVnd(totalFine)}</strong> tiền phạt chưa thanh toán. Vui lòng đến quầy thư viện để thanh toán trực tiếp — nhân viên sẽ ghi nhận vào hệ thống ngay khi bạn thanh toán xong.
            </div>
          ) : null}

          <SectionCard title="Phiếu phạt" subtitle={`${(data?.fines || []).length} phiếu`}>
            {(data?.fines || []).length === 0 ? (
              <EmptyState variant="no-data" title="Chưa có phiếu phạt" description="Bạn không có tiền phạt. Tiếp tục đọc sách nhé!" />
            ) : (
              <div className="space-y-3">
                {(data?.fines || []).map((fine: any) => (
                  <FineCard key={fine.id} fine={fine} />
                ))}
              </div>
            )}
          </SectionCard>

          <SectionCard title="Giao dịch ví gần đây" subtitle="Giao dịch mới nhất">
            {ledgerRows.length === 0 ? (
              <EmptyState variant="inbox" title="Chưa có giao dịch" description="Lịch sử giao dịch ví sẽ hiển thị ở đây." />
            ) : (
              <div className="space-y-2">
                {ledgerRows.map((entry) => (
                  <div key={entry.id} className="flex items-center justify-between rounded-xl border border-border bg-muted/20 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-medium text-foreground truncate">{entry.entry_type || entry.reference_type || 'Entry'}</p>
                      <p className="text-[11px] text-muted-foreground">{formatDateTime(entry.created_at)}</p>
                    </div>
                    <span className={`text-[14px] font-bold shrink-0 ml-3 ${Number(entry.amount) >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                      {Number(entry.amount) >= 0 ? '+' : ''}{formatCurrencyVnd(Number(entry.amount))}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </SectionCard>
        </>
      )}
    </div>
  );
}
