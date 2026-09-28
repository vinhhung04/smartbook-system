import { useCallback, useEffect, useState } from 'react';
import { NavLink, useParams } from 'react-router';
import { customerBorrowService } from '@/services/customer-borrow';
import { customerCatalogService } from '@/services/customer-catalog';
import { getApiErrorMessage } from '@/services/api';
import { toast } from 'sonner';
import { ChevronLeft, Printer } from 'lucide-react';
import { EmptyState } from '@/components/ui/empty-state';
import { CustomerPageHeader } from './_shared/customer-page-header';
import { formatDateTime } from './_shared/customer-format';
import { getStatusTone } from './_shared/customer-status';
import { printLoanReceipt } from '@/lib/print-utils';

export function CustomerLoanDetailPage() {
  const { id } = useParams();
  const [loan, setLoan] = useState<any | null>(null);
  const [books, setBooks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSubmittingRenew, setIsSubmittingRenew] = useState(false);

  const getBookTitle = (item: any) =>
    item.book_title || books.find((b) => b.variant_id === item.variant_id)?.title || 'Sách chưa xác định';

  const load = useCallback(async () => {
    if (!id) return;
    try {
      setLoading(true);
      setError(null);
      const [loanResp, booksResp] = await Promise.allSettled([
        customerBorrowService.getMyLoanById(id),
        customerCatalogService.getBooks(),
      ]);
      if (loanResp.status === 'fulfilled') setLoan(loanResp.value?.data || null);
      if (booksResp.status === 'fulfilled') setBooks(booksResp.value);
    } catch (err) {
      setError(getApiErrorMessage(err, 'Không tải được chi tiết phiếu mượn'));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleRenewRequest = async () => {
    if (!id) return;
    try {
      setIsSubmittingRenew(true);
      await customerBorrowService.requestLoanRenewal(id);
      toast.success('Đã gửi yêu cầu gia hạn');
      await load();
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Gửi yêu cầu gia hạn thất bại'));
    } finally {
      setIsSubmittingRenew(false);
    }
  };

  if (loading) {
    return (
      <div className="mx-auto max-w-3xl space-y-5 p-4 sm:p-6 lg:p-8" aria-busy="true">
        <div className="h-10 w-1/2 animate-pulse rounded-lg bg-muted" />
        <div className="h-32 animate-pulse rounded-xl border bg-card" />
        <div className="h-48 animate-pulse rounded-xl border bg-card" />
      </div>
    );
  }
  if (error || !loan) {
    return (
      <div className="mx-auto max-w-3xl p-4 sm:p-6 lg:p-8">
        <EmptyState
          variant={error ? 'error' : 'no-data'}
          title={error ? 'Không tải được phiếu mượn' : 'Không tìm thấy phiếu mượn'}
          description={error || 'Phiếu mượn này không tồn tại hoặc không thuộc về bạn.'}
          action={<NavLink to="/customer/loans" className="font-medium text-primary hover:underline">Quay lại phiếu mượn</NavLink>}
        />
      </div>
    );
  }

  const loanStatus = String(loan.status || '').toUpperCase();
  const canRequestRenewal = ['BORROWED', 'OVERDUE'].includes(loanStatus);
  const tone = getStatusTone(loan.status);
  const items: any[] = loan.loan_items || [];
  const summary = [
    { label: 'Ngày mượn', value: formatDateTime(loan.borrow_date) },
    { label: 'Hạn trả', value: formatDateTime(loan.due_date), emphasis: loanStatus === 'OVERDUE' },
    { label: 'Số cuốn', value: String(loan.total_items ?? items.length) },
  ];

  return (
    <div className="mx-auto max-w-3xl space-y-5 p-4 sm:p-6 lg:p-8">
      <NavLink to="/customer/loans" className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground transition-colors hover:text-foreground">
        <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" /> Quay lại phiếu mượn
      </NavLink>

      <CustomerPageHeader
        title={loan.loan_number}
        subtitle="Hạn trả, danh sách sách và yêu cầu gia hạn"
        actions={
          <div className="flex items-center gap-2">
            <button
              onClick={() => printLoanReceipt({ ...loan, customer_name: loan.customers?.full_name })}
              className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-input bg-card px-3 text-[13px] font-medium text-foreground transition-colors hover:bg-muted"
            >
              <Printer className="h-4 w-4" aria-hidden="true" /> In phiếu
            </button>
            <button
              onClick={() => void handleRenewRequest()}
              disabled={isSubmittingRenew || !canRequestRenewal}
              className="inline-flex h-9 items-center rounded-xl bg-indigo-600 px-4 text-[13px] font-semibold text-white transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
              title={canRequestRenewal ? 'Yêu cầu gia hạn' : 'Chỉ phiếu đang mượn hoặc quá hạn mới được gia hạn'}
            >
              {isSubmittingRenew ? 'Đang gửi...' : 'Yêu cầu gia hạn'}
            </button>
          </div>
        }
      />

      <section className="rounded-xl border border-border bg-card p-4 sm:p-5" aria-label="Tóm tắt phiếu mượn">
        <div className="flex items-center gap-2">
          <span className="text-[13px] text-muted-foreground">Trạng thái</span>
          <span className={`inline-flex rounded-lg border px-2 py-0.5 text-[12px] font-medium ${tone.className}`}>{tone.label}</span>
        </div>
        <dl className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
          {summary.map((item) => (
            <div key={item.label}>
              <dt className="text-[12px] text-muted-foreground">{item.label}</dt>
              <dd className={`mt-0.5 text-[14px] font-semibold ${item.emphasis ? 'text-rose-600 dark:text-rose-400' : 'text-foreground'}`}>{item.value}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="rounded-xl border border-border bg-card" aria-labelledby="loan-books">
        <h2 id="loan-books" className="border-b border-border px-4 py-3 text-[14px] font-semibold sm:px-5">Sách trong phiếu ({items.length})</h2>
        {items.length === 0 ? (
          <p className="px-4 py-6 text-center text-[13px] text-muted-foreground">Phiếu này không có sách.</p>
        ) : (
          <ul className="divide-y divide-border">
            {items.map((item) => {
              const itemTone = getStatusTone(item.status);
              return (
                <li key={item.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3 sm:px-5">
                  <div className="min-w-0">
                    <p className="truncate text-[14px] font-medium text-foreground">{getBookTitle(item)}</p>
                    <p className="text-[12px] text-muted-foreground">Hạn: {formatDateTime(item.due_date)}</p>
                  </div>
                  <span className={`inline-flex rounded-lg border px-2 py-0.5 text-[11px] font-medium ${itemTone.className}`}>{itemTone.label}</span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
