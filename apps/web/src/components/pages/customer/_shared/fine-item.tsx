import { formatCurrencyVnd, formatDateTime } from './customer-format';
import { StatusBadge } from './status-badge';

interface FineItemProps {
  fine: any;
  paying: boolean;
  onPay: (fine: any, mode: 'PARTIAL' | 'FULL') => void;
}

export function FineItem({ fine, paying, onPay }: FineItemProps) {
  const paid = (fine?.fine_payments || []).reduce((sum: number, row: any) => sum + Number(row?.amount || 0), 0);
  const remaining = Math.max(0, Number(fine?.amount || 0) - Number(fine?.waived_amount || 0) - paid);
  const disabled = remaining <= 0 || paying;
  const status = String(fine?.status || '').toUpperCase();
  const isHighRemaining = remaining >= 500000;

  const toneClassName = status === 'UNPAID'
    ? 'border-rose-200 bg-rose-50/60'
    : status === 'PARTIALLY_PAID'
      ? 'border-amber-200 bg-amber-50/60'
      : status === 'PAID' || status === 'WAIVED'
        ? 'border-emerald-200 bg-emerald-50/50'
        : 'border-slate-200 bg-white';

  return (
    <div className={`rounded-[12px] border p-4 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_8px_20px_rgba(15,23,42,0.06)] ${toneClassName}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[13px] text-slate-900" style={{ fontWeight: 700 }}>{fine.fine_type}</div>
          <div className="mt-1 text-[11px] uppercase tracking-[0.04em] text-slate-400">Trạng thái phạt</div>
          <div className="mt-1 text-[12px] text-slate-500">Ngày phát hành: {formatDateTime(fine.issued_at)}</div>
          <div className="mt-1"><StatusBadge status={fine.status} /></div>
        </div>
        <div className="text-right text-[12px] text-slate-600">
          <div>Tổng: {formatCurrencyVnd(fine.amount)}</div>
          <div className={isHighRemaining ? 'text-rose-700' : ''} style={{ fontWeight: 700 }}>Còn lại: {formatCurrencyVnd(remaining)}</div>
        </div>
      </div>

      <div className="mt-3 flex gap-2">
        <button
          disabled={disabled}
          onClick={() => onPay(fine, 'PARTIAL')}
          className="rounded-[10px] border border-slate-200 bg-white px-3 py-2 text-[12px] text-slate-700 hover:bg-slate-50 disabled:opacity-60"
          style={{ fontWeight: 600 }}
        >
          Trả 50%
        </button>
        <button
          disabled={disabled}
          onClick={() => onPay(fine, 'FULL')}
          className="rounded-[10px] bg-indigo-600 px-3 py-2 text-[12px] text-white hover:bg-indigo-700 disabled:opacity-60"
          style={{ fontWeight: 600 }}
        >
          Trả đầy đủ
        </button>
      </div>
    </div>
  );
}
