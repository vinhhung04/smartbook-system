import { useEffect, useState } from 'react';
import { ReceiptText, RefreshCw, Wallet } from 'lucide-react';
import { customerBorrowService } from '@/services/customer-borrow';
import { getApiErrorMessage } from '@/services/api';
import { toast } from 'sonner';
import { formatCurrencyVnd, formatDateTime } from './_shared/customer-format';
import { SectionCard } from '@/components/ui/section-card';
import { StatCard } from '@/components/ui/stat-card';
import { EmptyState } from '@/components/ui/empty-state';
import { LoadingOverlay } from '@/components/ui/loading-state';
import { FineCard } from './_shared/fine-card';

export function CustomerFinesPage() {
  const [data, setData] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [payingFineId, setPayingFineId] = useState<string | null>(null);
  const [topupAmount, setTopupAmount] = useState('50000');
  const [isTopupLoading, setIsTopupLoading] = useState(false);
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
      setError(getApiErrorMessage(err, 'Failed to load fines'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void loadFines(); }, []);

  const getRemainingBalance = (fine: any) => {
    const paid = (fine?.fine_payments || []).reduce(
      (sum: number, payment: any) => sum + Number(payment?.amount || 0),
      0
    );
    return Math.max(0, Number(fine?.amount || 0) - Number(fine?.waived_amount || 0) - paid);
  };

  const payFine = async (fine: any, mode: 'FULL' | 'PARTIAL') => {
    const remaining = getRemainingBalance(fine);
    if (remaining <= 0) {
      toast.info('This fine is already settled');
      return;
    }
    const amount = mode === 'FULL' ? remaining : Number((remaining / 2).toFixed(2));
    try {
      setPayingFineId(String(fine.id));
      await customerBorrowService.payFine({ fine_id: fine.id, amount, payment_method: 'EWALLET' });
      toast.success(mode === 'FULL' ? 'Fine paid successfully' : 'Partial payment recorded');
      await loadFines();
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Failed to pay fine'));
    } finally {
      setPayingFineId(null);
    }
  };

  const handleTopup = async () => {
    const amount = Number(topupAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error('Topup amount must be greater than 0');
      return;
    }
    try {
      setIsTopupLoading(true);
      await customerBorrowService.topupMyAccount({ amount, note: 'Topup from customer portal' });
      toast.success('Wallet topup successful');
      await loadFines();
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Failed to topup wallet'));
    } finally {
      setIsTopupLoading(false);
    }
  };

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
            <h1 className="text-xl font-semibold tracking-tight">My Fines & Wallet</h1>
            <p className="text-[13px] text-muted-foreground">Manage outstanding balances and wallet topups</p>
          </div>
        </div>
        <button
          onClick={() => void loadFines()}
          disabled={loading}
          className="inline-flex items-center gap-1.5 h-9 rounded-xl border border-input bg-white px-3 text-[12px] text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {loading ? (
        <LoadingOverlay />
      ) : error ? (
        <EmptyState variant="error" title="Failed to load fines" description={error} action={<button onClick={() => void loadFines()} className="text-primary font-medium hover:underline">Try again</button>} />
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatCard label="Outstanding Fines" value={formatCurrencyVnd(totalFine)} icon={ReceiptText} variant={totalFine > 0 ? 'danger' : 'success'} />
            <StatCard label="Wallet Balance" value={formatCurrencyVnd(walletBalance)} icon={Wallet} variant={walletBalance < 100000 ? 'warning' : 'success'} />
            <StatCard label="Fine Records" value={(data?.fines || []).length} icon={ReceiptText} variant="default" />
            <StatCard label="Payments Made" value={(data?.fine_payments || []).length} icon={ReceiptText} variant="info" />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            <div>
              <div className="rounded-xl border border-black/5 bg-card shadow-[0_1px_3px_rgba(0,0,0,0.04)] p-5">
                <div className="flex items-center gap-2 mb-4">
                  <div className="w-7 h-7 rounded-lg bg-indigo-100 flex items-center justify-center">
                    <Wallet className="w-3.5 h-3.5 text-indigo-600" />
                  </div>
                  <h3 className="text-[14px] font-semibold">Top Up Wallet</h3>
                </div>
                <p className="text-[12px] text-muted-foreground mb-3">Balance: <strong className="text-foreground">{formatCurrencyVnd(walletBalance)}</strong></p>
                <div className="flex items-center gap-2">
                  <input value={topupAmount} onChange={(e) => setTopupAmount(e.target.value)} className="flex-1 h-10 rounded-xl border border-input bg-background px-3 text-[13px] outline-none focus:ring-2 focus:ring-primary/10 focus:border-primary/40" inputMode="numeric" />
                  <button onClick={() => void handleTopup()} disabled={isTopupLoading} className="h-10 rounded-xl bg-primary text-primary-foreground px-4 text-[13px] font-semibold hover:bg-primary/90 disabled:opacity-50 transition-colors whitespace-nowrap">
                    {isTopupLoading ? 'Processing...' : 'Top Up'}
                  </button>
                </div>
                <div className="mt-2 flex gap-2">
                  {['50000', '100000', '200000'].map(amt => (
                    <button key={amt} onClick={() => setTopupAmount(amt)} className="text-[11px] rounded-lg border border-input px-2 py-1 text-muted-foreground hover:bg-muted transition-colors">
                      {Number(amt).toLocaleString()} VND
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="lg:col-span-2">
              <SectionCard title="Fine Records" subtitle={`${(data?.fines || []).length} record(s)`}>
                {(data?.fines || []).length === 0 ? (
                  <EmptyState variant="no-data" title="No fines" description="You have no outstanding fines. Keep reading!" />
                ) : (
                  <div className="space-y-3">
                    {(data?.fines || []).map((fine: any) => (
                      <FineCard key={fine.id} fine={fine} paying={payingFineId === String(fine.id)} onPay={(item, mode) => void payFine(item, mode)} />
                    ))}
                  </div>
                )}
              </SectionCard>
            </div>
          </div>

          <SectionCard title="Recent Wallet Activity" subtitle="Latest transactions">
            {ledgerRows.length === 0 ? (
              <EmptyState variant="inbox" title="No transactions yet" description="Your wallet transactions will appear here." />
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
