import { useState } from 'react';
import { toast } from 'sonner';
import { customerBorrowService } from '@/services/customer-borrow';
import { getApiErrorMessage } from '@/services/api';
import { formatCurrencyVnd, formatDateTime } from './customer-format';
import { StatusBadge } from './status-badge';

interface FineItemProps {
  fine: any;
}

export function FineItem({ fine }: FineItemProps) {
  const [isStartingPayment, setIsStartingPayment] = useState(false);
  const paid = (fine?.fine_payments || []).reduce((sum: number, row: any) => sum + Number(row?.amount || 0), 0);
  const remaining = Math.max(0, Number(fine?.amount || 0) - Number(fine?.waived_amount || 0) - paid);
  const status = String(fine?.status || '').toUpperCase();
  const isHighRemaining = remaining >= 500000;

  async function handlePayOnline() {
    setIsStartingPayment(true);
    try {
      const result = await customerBorrowService.createVnpayFinePayment(fine.id);
      window.location.href = result.data.payment_url;
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Không thể khởi tạo thanh toán VNPay'));
      setIsStartingPayment(false);
    }
  }

  const toneClassName = status === 'UNPAID'
    ? 'border-rose-200 bg-rose-50/60 dark:border-rose-900/40 dark:bg-rose-950/20'
    : status === 'PARTIALLY_PAID'
      ? 'border-amber-200 bg-amber-50/60 dark:border-amber-900/40 dark:bg-amber-950/20'
      : status === 'PAID' || status === 'WAIVED'
        ? 'border-emerald-200 bg-emerald-50/50 dark:border-emerald-900/40 dark:bg-emerald-950/20'
        : 'border-border bg-card';

  return (
    <div className={`rounded-[12px] border p-4 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_8px_20px_rgba(15,23,42,0.06)] ${toneClassName}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[13px] text-foreground" style={{ fontWeight: 700 }}>{fine.fine_type}</div>
          <div className="mt-1 text-[11px] uppercase tracking-[0.04em] text-slate-400 dark:text-slate-500">Trạng thái phạt</div>
          <div className="mt-1 text-[12px] text-muted-foreground">Ngày phát hành: {formatDateTime(fine.issued_at)}</div>
          <div className="mt-1"><StatusBadge status={fine.status} /></div>
        </div>
        <div className="text-right text-[12px] text-slate-600 dark:text-slate-300">
          <div>Tổng: {formatCurrencyVnd(fine.amount)}</div>
          <div className={isHighRemaining ? 'text-rose-700 dark:text-rose-400' : ''} style={{ fontWeight: 700 }}>Còn lại: {formatCurrencyVnd(remaining)}</div>
        </div>
      </div>

      {remaining > 0 ? (
        <div className="mt-3 space-y-2">
          <button
            onClick={handlePayOnline}
            disabled={isStartingPayment}
            className="w-full rounded-[10px] bg-primary px-3 py-2.5 text-[12px] font-semibold text-primary-foreground hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {isStartingPayment ? 'Đang khởi tạo...' : 'Thanh toán online qua VNPay'}
          </button>
          <p className="text-center text-[11px] text-muted-foreground">
            Hoặc thanh toán trực tiếp tại quầy thư viện — nhân viên sẽ ghi nhận vào hệ thống.
          </p>
        </div>
      ) : null}
    </div>
  );
}
