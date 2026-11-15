import { useCallback, useEffect, useState } from 'react';
import { ArrowRight, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { customerBorrowService } from '@/services/customer-borrow';
import { getApiErrorMessage } from '@/services/api';
import { getBorrowLabel } from '@/lib/status-registry';
import {
  canRequestRenewal, daysUntil, formatVnd, isActiveLoan, mentionedLoanCodes, readerDigest,
  type DigestCard, type ReaderFine, type ReaderLoan,
} from '@/lib/chat-reader';
import { cn } from '@/components/ui/utils';
import { BookDueIcon, BookFineIcon } from './smartbook-icons';

// The reader's own loans and fines inside the floating chatbot: a short digest
// on the welcome screen, and the loans or fines an answer is about, each with
// the one action the portal already offers (request a renewal, pay by VNPay).

export interface ReaderSnapshot {
  status: 'idle' | 'loading' | 'ready' | 'error';
  loans: ReaderLoan[];
  fines: ReaderFine[];
  refresh: () => void;
}

export function useReaderSnapshot(enabled: boolean): ReaderSnapshot {
  const [state, setState] = useState<Omit<ReaderSnapshot, 'refresh'>>({ status: 'idle', loans: [], fines: [] });
  const refresh = useCallback(() => {
    if (!enabled) return;
    setState((s) => ({ ...s, status: s.status === 'ready' ? 'ready' : 'loading' }));
    Promise.all([customerBorrowService.getMyLoans({ pageSize: 100 }), customerBorrowService.getMyFines()])
      .then(([loans, fines]) => setState({
        status: 'ready',
        loans: Array.isArray(loans?.data) ? loans.data : [],
        fines: Array.isArray(fines?.data?.fines) ? fines.data.fines : [],
      }))
      .catch(() => setState((s) => ({ ...s, status: s.status === 'ready' ? 'ready' : 'error' })));
  }, [enabled]);
  useEffect(() => { refresh(); }, [refresh]);
  return { ...state, refresh };
}

const TONE: Record<DigestCard['tone'], { box: string; icon: string; title: string }> = {
  alert: {
    box: 'border-red-200 bg-red-50/70 hover:bg-red-50 dark:border-red-900/50 dark:bg-red-950/25 dark:hover:bg-red-950/40',
    icon: 'text-red-700 dark:text-red-300',
    title: 'text-red-900 dark:text-red-100',
  },
  notice: {
    box: 'border-amber-200 bg-amber-50/70 hover:bg-amber-50 dark:border-amber-900/50 dark:bg-amber-950/25 dark:hover:bg-amber-950/40',
    icon: 'text-amber-800 dark:text-amber-300',
    title: 'text-amber-950 dark:text-amber-100',
  },
  calm: {
    box: 'border-border bg-card hover:bg-muted/60',
    icon: 'text-primary',
    title: 'text-foreground',
  },
};

/** Welcome-screen digest: the loan to watch and what is owed, each opening a question. */
export function ReaderDigest({ snapshot, onAsk, disabled }: { snapshot: ReaderSnapshot; onAsk: (question: string) => void; disabled?: boolean }) {
  if (snapshot.status === 'idle') return null;
  if (snapshot.status === 'loading') {
    return (
      <div aria-hidden="true" className="space-y-2">
        <div className="h-4 w-32 rounded-full bg-muted" />
        <div className="h-[62px] animate-pulse rounded-2xl bg-muted motion-reduce:animate-none" />
      </div>
    );
  }
  if (snapshot.status === 'error') {
    return (
      <p className="px-1 text-[12.5px] leading-5 text-muted-foreground">
        Chưa tải được tình hình mượn sách của bạn.{' '}
        <button type="button" onClick={snapshot.refresh}
          className="cursor-pointer font-medium text-primary underline-offset-2 hover:underline active:opacity-80 focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-ring">
          Thử lại
        </button>
      </p>
    );
  }
  const cards = readerDigest(snapshot.loans, snapshot.fines);
  if (cards.length === 0) return null;
  return (
    <div>
      <p className="mb-2 px-1 text-[12.5px] font-medium text-muted-foreground">Tình hình của bạn</p>
      <ul className="space-y-2">
        {cards.map((card) => {
          const tone = TONE[card.tone];
          const Icon = card.question.includes('phạt') ? BookFineIcon : BookDueIcon;
          return (
            <li key={card.title}>
              <button type="button" onClick={() => onAsk(card.question)} disabled={disabled}
                className={cn('group flex w-full cursor-pointer items-center gap-3 rounded-2xl border px-4 py-3 text-left transition-colors active:opacity-90 focus-visible:outline-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50', tone.box)}>
                <Icon className={cn('h-5 w-5 shrink-0', tone.icon)} />
                <span className="min-w-0 flex-1">
                  <span className={cn('block text-[14px] font-semibold leading-5', tone.title)}>{card.title}</span>
                  <span className="mt-0.5 block text-[12.5px] leading-5 text-muted-foreground">{card.detail}</span>
                </span>
                <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 group-hover:translate-x-0.5 motion-reduce:transition-none" aria-hidden="true" />
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

const quietButton = 'inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg px-2.5 text-[12.5px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground active:bg-muted/80 focus-visible:outline-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50';
const primaryButton = 'inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg bg-primary px-3 text-[12.5px] font-semibold text-primary-foreground transition-opacity hover:opacity-90 active:opacity-80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50';

function LoanAction({ loan, onRenewed, onNavigate }: { loan: ReaderLoan; onRenewed: () => void; onNavigate: (href: string) => void }) {
  const [step, setStep] = useState<'idle' | 'confirm' | 'sending'>('idle');
  const days = loan.due_date ? daysUntil(loan.due_date, Date.now()) : null;
  const due = days === null ? null : days < 0 ? `Quá hạn ${-days} ngày` : days === 0 ? 'Đến hạn hôm nay' : `Còn ${days} ngày`;
  const renew = async () => {
    setStep('sending');
    try {
      await customerBorrowService.requestLoanRenewal(loan.id);
      toast.success(`Đã gửi yêu cầu gia hạn ${loan.loan_number}`);
      onRenewed();
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Gửi yêu cầu gia hạn thất bại'));
    }
    setStep('idle');
  };
  const href = `/customer/loans/${loan.id}`;
  return (
    <li className="rounded-xl border border-border bg-card px-3.5 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-[13.5px] font-medium leading-5 text-foreground">{loan.primary_book_title || loan.loan_number}</p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[12px] leading-5 text-muted-foreground">
            <span className="font-mono">{loan.loan_number}</span>
            {due && isActiveLoan(loan)
              ? <span className={days! < 0 ? 'font-medium text-red-700 dark:text-red-300' : undefined}>{due}</span>
              : <span>{getBorrowLabel('loan', loan.status)}</span>}
          </p>
        </div>
        <a href={href} onClick={(e) => { if (e.button !== 0 || e.metaKey || e.ctrlKey) return; e.preventDefault(); onNavigate(href); }}
          className="shrink-0 text-[12.5px] font-medium text-primary underline-offset-2 hover:underline active:opacity-80 focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-ring">
          Xem phiếu
        </a>
      </div>
      {loan.renewal?.pending ? (
        <p className="mt-2 text-[12.5px] text-muted-foreground">Đã gửi yêu cầu gia hạn, đang chờ thư viện duyệt.</p>
      ) : canRequestRenewal(loan) ? (
        step === 'idle' ? (
          <div className="mt-2.5">
            <button type="button" onClick={() => setStep('confirm')} className={primaryButton}>Gửi yêu cầu gia hạn</button>
          </div>
        ) : (
          <div className="mt-2.5 rounded-lg bg-muted/60 px-3 py-2.5" role="group" aria-label="Xác nhận gia hạn">
            <p className="text-[12.5px] leading-5 text-foreground">Gửi yêu cầu gia hạn phiếu này? Thư viện sẽ duyệt và báo kết quả cho bạn.</p>
            <div className="mt-2 flex items-center gap-1.5">
              <button type="button" onClick={() => void renew()} disabled={step === 'sending'} className={primaryButton}>
                {step === 'sending' && <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />}
                {step === 'sending' ? 'Đang gửi…' : 'Gửi yêu cầu'}
              </button>
              <button type="button" onClick={() => setStep('idle')} disabled={step === 'sending'} className={quietButton}>Hủy</button>
            </div>
          </div>
        )
      ) : null}
    </li>
  );
}

function FineAction({ fine }: { fine: ReaderFine }) {
  const [step, setStep] = useState<'idle' | 'confirm' | 'opening'>('idle');
  const remaining = Number(fine.remaining_amount || 0);
  const pay = async () => {
    setStep('opening');
    try {
      const result = await customerBorrowService.createVnpayFinePayment(fine.id);
      window.location.href = result.data.payment_url;
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Không thể khởi tạo thanh toán VNPay'));
      setStep('idle');
    }
  };
  return (
    <li className="rounded-xl border border-border bg-card px-3.5 py-3">
      <div className="flex items-start justify-between gap-3">
        <p className="min-w-0 text-[13.5px] font-medium leading-5 text-foreground">{getBorrowLabel('fineType', fine.fine_type)}</p>
        <p className="shrink-0 text-[13.5px] font-semibold tabular-nums text-foreground">Còn {formatVnd(remaining)}</p>
      </div>
      {step === 'idle' ? (
        <div className="mt-2.5">
          <button type="button" onClick={() => setStep('confirm')} className={primaryButton}>Thanh toán qua VNPay</button>
        </div>
      ) : (
        <div className="mt-2.5 rounded-lg bg-muted/60 px-3 py-2.5" role="group" aria-label="Xác nhận thanh toán">
          <p className="text-[12.5px] leading-5 text-foreground">
            Chuyển sang VNPay để thanh toán {formatVnd(remaining)}? Bạn cũng có thể trả tại quầy thư viện.
          </p>
          <div className="mt-2 flex items-center gap-1.5">
            <button type="button" onClick={() => void pay()} disabled={step === 'opening'} className={primaryButton}>
              {step === 'opening' && <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />}
              {step === 'opening' ? 'Đang mở VNPay…' : 'Tiếp tục'}
            </button>
            <button type="button" onClick={() => setStep('idle')} disabled={step === 'opening'} className={quietButton}>Hủy</button>
          </div>
        </div>
      )}
    </li>
  );
}

/** The loans an answer names and, when it is about fines, what is still owed: each with its action. */
export function ReaderActions({ snapshot, text, aboutFines, onNavigate }: {
  snapshot: ReaderSnapshot;
  text: string;
  aboutFines: boolean;
  onNavigate: (href: string) => void;
}) {
  if (snapshot.status !== 'ready') return null;
  const byCode = new Map(snapshot.loans.map((l) => [l.loan_number, l]));
  const loans = mentionedLoanCodes(text).map((code) => byCode.get(code)).filter((l): l is ReaderLoan => !!l).slice(0, 3);
  const fines = aboutFines ? snapshot.fines.filter((f) => Number(f.remaining_amount || 0) > 0).slice(0, 3) : [];
  if (loans.length === 0 && fines.length === 0) return null;
  return (
    <div className="w-full">
      <p className="mb-1.5 text-[12px] font-medium text-muted-foreground">Thao tác nhanh</p>
      <ul className="space-y-2">
        {loans.map((loan) => <LoanAction key={loan.id} loan={loan} onRenewed={snapshot.refresh} onNavigate={onNavigate} />)}
        {fines.map((fine) => <FineAction key={fine.id} fine={fine} />)}
      </ul>
    </div>
  );
}
