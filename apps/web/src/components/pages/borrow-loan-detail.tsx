import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { Printer } from 'lucide-react';
import { toast } from 'sonner';
import { PageWrapper, FadeItem } from '../motion-utils';
import { StatusBadge } from '../status-badge';
import { borrowService, type Loan } from '@/services/borrow';
import { bookService } from '@/services/book';
import { getApiErrorMessage } from '@/services/api';
import { printLoanReceipt } from '@/lib/print-utils';
import { LoadingOverlay } from '@/components/ui/loading-state';
import { EmptyState } from '@/components/ui/empty-state';

function getVariant(status: string) {
  if (status === 'BORROWED') return 'info';
  if (status === 'RETURNED') return 'success';
  if (status === 'OVERDUE' || status === 'LOST') return 'warning';
  if (status === 'CANCELLED') return 'neutral';
  return 'primary';
}

export function BorrowLoanDetailPage() {
  const { id } = useParams();
  const [loan, setLoan] = useState<Loan | null>(null);
  const [books, setBooks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;

    const load = async () => {
      try {
        setLoading(true);
        const [loanResp, booksResp] = await Promise.allSettled([
          borrowService.getLoanById(id),
          bookService.getAll(),
        ]);
        if (loanResp.status === 'fulfilled') setLoan(loanResp.value.data);
        if (booksResp.status === 'fulfilled' && Array.isArray(booksResp.value)) setBooks(booksResp.value);
      } catch (error) {
        toast.error(getApiErrorMessage(error, 'Failed to load loan detail'));
      } finally {
        setLoading(false);
      }
    };

    void load();
  }, [id]);

  const getBookTitle = (variantId: string) =>
    books.find((b) => b.variant_id === variantId)?.title ?? variantId;

  return (
    <PageWrapper className="space-y-5">
      <FadeItem>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="tracking-[-0.02em]">Loan Detail</h1>
            <p className="text-[12px] text-muted-foreground mt-0.5">Review loan items and status</p>
          </div>
          <div className="flex items-center gap-2">
            {loan && (
              <button onClick={() => printLoanReceipt({ ...loan, customer_name: loan.customers?.full_name })}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-[10px] border border-indigo-200 bg-indigo-50 text-indigo-700 text-[13px] hover:bg-indigo-100 dark:border-indigo-500/20 dark:bg-indigo-500/10 dark:text-indigo-400 dark:hover:bg-indigo-500/15" style={{ fontWeight: 550 }}>
                <Printer className="w-3.5 h-3.5" /> Print
              </button>
            )}
            <Link to="/borrow/loans" className="px-3.5 py-2 rounded-[10px] border border-border bg-card text-muted-foreground text-[13px] hover:bg-muted" style={{ fontWeight: 550 }}>
              Back to Loans
            </Link>
          </div>
        </div>
      </FadeItem>

      {loading ? (
        <FadeItem>
          <div className="bg-card border border-border rounded-[14px] p-8">
            <LoadingOverlay />
          </div>
        </FadeItem>
      ) : !loan ? (
        <FadeItem>
          <div className="bg-card border border-border rounded-[14px] p-8">
            <EmptyState variant="no-data" title="Loan not found" />
          </div>
        </FadeItem>
      ) : (
        <>
          <FadeItem>
            <div className="bg-card border border-border rounded-[14px] p-4 grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <p className="text-[11px] text-muted-foreground">Loan Number</p>
                <p className="text-[14px] text-foreground" style={{ fontWeight: 600 }}>{loan.loan_number}</p>
              </div>
              <div>
                <p className="text-[11px] text-muted-foreground">Customer</p>
                <p className="text-[14px] text-foreground" style={{ fontWeight: 600 }}>{loan.customers?.full_name || loan.customer_id}</p>
              </div>
              <div>
                <p className="text-[11px] text-muted-foreground">Status</p>
                <StatusBadge label={loan.status} variant={getVariant(loan.status)} dot />
              </div>
              <div>
                <p className="text-[11px] text-muted-foreground">Borrow Date</p>
                <p className="text-[13px] text-foreground">{new Date(loan.borrow_date).toLocaleString('vi-VN')}</p>
              </div>
              <div>
                <p className="text-[11px] text-muted-foreground">Due Date</p>
                <p className="text-[13px] text-foreground">{new Date(loan.due_date).toLocaleString('vi-VN')}</p>
              </div>
              <div>
                <p className="text-[11px] text-muted-foreground">Items</p>
                <p className="text-[13px] text-foreground">{loan.total_items}</p>
              </div>
            </div>
          </FadeItem>

          <FadeItem>
            <div className="bg-card border border-border rounded-[14px] overflow-hidden">
              <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border bg-muted/80">
                    {['Loan Item', 'Sách', 'Due Date', 'Return Date', 'Status', 'Fine'].map((header) => (
                      <th key={header} className="text-left text-[11px] text-muted-foreground px-4 py-3 uppercase tracking-[0.05em]" style={{ fontWeight: 550 }}>
                        {header}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(loan.loan_items || []).map((item) => (
                    <tr key={item.id} className="border-b border-border/50 last:border-0">
                      <td className="px-4 py-3 text-[12px] text-foreground">{item.item_barcode || item.id}</td>
                      <td className="px-4 py-3 text-[12px] text-foreground">{getBookTitle(item.variant_id)}</td>
                      <td className="px-4 py-3 text-[12px] text-muted-foreground">{new Date(item.due_date).toLocaleString('vi-VN')}</td>
                      <td className="px-4 py-3 text-[12px] text-muted-foreground">{item.return_date ? new Date(item.return_date).toLocaleString('vi-VN') : '-'}</td>
                      <td className="px-4 py-3 text-[12px] text-foreground">{item.status}</td>
                      <td className="px-4 py-3 text-[12px] text-foreground">{Number(item.fine_amount || 0).toLocaleString('vi-VN')} VND</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            </div>
          </FadeItem>
        </>
      )}
    </PageWrapper>
  );
}
