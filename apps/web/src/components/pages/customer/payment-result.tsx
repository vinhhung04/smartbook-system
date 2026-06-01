import { useEffect, useState } from 'react';
import { useSearchParams, Link } from 'react-router';
import { CheckCircle, XCircle, Loader2, ReceiptText } from 'lucide-react';
import { customerBorrowService } from '@/services/customer-borrow';
import { formatCurrencyVnd } from './_shared/customer-format';

export function CustomerPaymentResultPage() {
  const [searchParams] = useSearchParams();
  const orderId = searchParams.get('orderId') || '';
  const urlResultCode = searchParams.get('resultCode');

  const [status, setStatus] = useState<'loading' | 'paid' | 'failed' | 'pending'>('loading');
  const [amount, setAmount] = useState<number | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!orderId) {
      setStatus(urlResultCode === '0' ? 'paid' : 'failed');
      return;
    }

    let attempts = 0;
    const MAX = 20;

    const poll = async () => {
      attempts++;
      try {
        const res = await customerBorrowService.getMomoPaymentStatus(orderId);
        const s = res.data.status;
        setAmount(res.data.amount);
        setMessage(res.data.message);
        if (s === 'PAID') {
          setStatus('paid');
          return true;
        }
        if (s === 'FAILED' || s === 'CANCELLED' || s === 'EXPIRED') {
          setStatus('failed');
          return true;
        }
      } catch {
        // ignore
      }
      return false;
    };

    const run = async () => {
      const done = await poll();
      if (!done && attempts < MAX) {
        const id = setInterval(async () => {
          const finished = await poll();
          if (finished || attempts >= MAX) {
            clearInterval(id);
            if (attempts >= MAX) setStatus('pending');
          }
        }, 3000);
        return () => clearInterval(id);
      } else if (!done) {
        setStatus('pending');
      }
    };

    void run();
  }, [orderId, urlResultCode]);

  return (
    <div className="flex min-h-[60vh] items-center justify-center p-6">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-8 shadow-sm text-center">
        {status === 'loading' && (
          <>
            <Loader2 className="mx-auto mb-4 h-12 w-12 animate-spin text-[#ae2070]" />
            <h2 className="text-lg font-semibold">Đang xác nhận thanh toán...</h2>
            <p className="mt-2 text-[13px] text-muted-foreground">Vui lòng đợi trong giây lát</p>
          </>
        )}

        {status === 'paid' && (
          <>
            <CheckCircle className="mx-auto mb-4 h-14 w-14 text-emerald-500" />
            <h2 className="text-xl font-bold text-emerald-700">Thanh toán thành công!</h2>
            {amount != null && (
              <p className="mt-2 text-[15px] font-semibold text-foreground">{formatCurrencyVnd(amount)}</p>
            )}
            <p className="mt-1 text-[13px] text-muted-foreground">Phí phạt đã được cập nhật trong hệ thống</p>
          </>
        )}

        {status === 'failed' && (
          <>
            <XCircle className="mx-auto mb-4 h-14 w-14 text-rose-500" />
            <h2 className="text-xl font-bold text-rose-700">Thanh toán thất bại</h2>
            {message && <p className="mt-2 text-[13px] text-muted-foreground">{message}</p>}
            <p className="mt-1 text-[13px] text-muted-foreground">Giao dịch không hoàn tất. Vui lòng thử lại.</p>
          </>
        )}

        {status === 'pending' && (
          <>
            <Loader2 className="mx-auto mb-4 h-12 w-12 text-amber-500" />
            <h2 className="text-lg font-semibold text-amber-700">Đang xử lý</h2>
            <p className="mt-2 text-[13px] text-muted-foreground">Hệ thống chưa nhận được xác nhận. Vui lòng kiểm tra lại sau ít phút.</p>
          </>
        )}

        <div className="mt-6 flex flex-col gap-2">
          <Link
            to="/customer/fines"
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-[13px] font-semibold text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            <ReceiptText className="h-4 w-4" />
            Xem phiếu phạt
          </Link>
          {status === 'failed' && (
            <button
              onClick={() => window.history.back()}
              className="rounded-xl border border-border px-4 py-2.5 text-[13px] text-muted-foreground hover:bg-muted transition-colors"
            >
              Quay lại
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
