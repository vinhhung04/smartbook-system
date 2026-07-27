import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { LoaderCircle, Printer } from 'lucide-react';
import { toast } from 'sonner';
import { PageWrapper, FadeItem } from '../motion-utils';
import { StatusBadge } from '../status-badge';
import { borrowService, type Loan } from '@/services/borrow';
import { getApiErrorMessage } from '@/services/api';
import { printLoanReceipt } from '@/lib/print-utils';

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
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;

    const load = async () => {
      try {
        setLoading(true);
        const response = await borrowService.getLoanById(id);
        setLoan(response.data);
      } catch (error) {
        toast.error(getApiErrorMessage(error, 'Failed to load loan detail'));
      } finally {
        setLoading(false);
      }
    };

    void load();
  }, [id]);

  return (
    <PageWrapper className="space-y-5">
      <FadeItem>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="tracking-[-0.02em]">Loan Detail</h1>
            <p className="text-[12px] text-slate-400 mt-0.5">Review loan items and status</p>
          </div>
          <div className="flex items-center gap-2">
            {loan && (
              <button onClick={() => printLoanReceipt({ ...loan, customer_name: loan.customers?.full_name })}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-[10px] border border-indigo-200 bg-indigo-50 text-indigo-700 text-[13px] hover:bg-indigo-100" style={{ fontWeight: 550 }}>
                <Printer className="w-3.5 h-3.5" /> Print
              </button>
            )}
            <Link to="/borrow/loans" className="px-3.5 py-2 rounded-[10px] border border-slate-200 bg-white text-slate-600 text-[13px] hover:bg-slate-50" style={{ fontWeight: 550 }}>
              Back to Loans
            </Link>
          </div>
        </div>
      </FadeItem>

      {loading ? (
        <FadeItem>
          <div className="bg-white border border-slate-200 rounded-[14px] p-8 text-center text-slate-500 text-[13px]">
            <LoaderCircle className="w-4 h-4 inline mr-2 animate-spin" /> Loading loan detail...
          </div>
        </FadeItem>
      ) : !loan ? (
        <FadeItem>
          <div className="bg-white border border-slate-200 rounded-[14px] p-8 text-center text-slate-500 text-[13px]">Loan not found</div>
        </FadeItem>
      ) : (
        <>
          <FadeItem>
            <div className="bg-white border border-slate-200 rounded-[14px] p-4 grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <p className="text-[11px] text-slate-400">Loan Number</p>
                <p className="text-[14px] text-slate-800" style={{ fontWeight: 600 }}>{loan.loan_number}</p>
              </div>
              <div>
                <p className="text-[11px] text-slate-400">Customer</p>
                <p className="text-[14px] text-slate-800" style={{ fontWeight: 600 }}>{loan.customers?.full_name || loan.customer_id}</p>
              </div>
              <div>
                <p className="text-[11px] text-slate-400">Status</p>
                <StatusBadge label={loan.status} variant={getVariant(loan.status)} dot />
              </div>
              <div>
                <p className="text-[11px] text-slate-400">Borrow Date</p>
                <p className="text-[13px] text-slate-700">{new Date(loan.borrow_date).toLocaleString('vi-VN')}</p>
              </div>
              <div>
                <p className="text-[11px] text-slate-400">Due Date</p>
                <p className="text-[13px] text-slate-700">{new Date(loan.due_date).toLocaleString('vi-VN')}</p>
              </div>
              <div>
                <p className="text-[11px] text-slate-400">Items</p>
                <p className="text-[13px] text-slate-700">{loan.total_items}</p>
              </div>
            </div>
          </FadeItem>

          <FadeItem>
            <div className="bg-white border border-slate-200 rounded-[14px] overflow-hidden">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50/80">
                    {['Loan Item', 'Variant', 'Due Date', 'Return Date', 'Status', 'Fine'].map((header) => (
                      <th key={header} className="text-left text-[11px] text-slate-400 px-4 py-3 uppercase tracking-[0.05em]" style={{ fontWeight: 550 }}>
                        {header}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(loan.loan_items || []).map((item) => (
                    <tr key={item.id} className="border-b border-slate-50 last:border-0">
                      <td className="px-4 py-3 text-[12px] text-slate-700">{item.item_barcode || item.id}</td>
                      <td className="px-4 py-3 text-[12px] text-slate-500">{item.variant_id}</td>
                      <td className="px-4 py-3 text-[12px] text-slate-500">{new Date(item.due_date).toLocaleString('vi-VN')}</td>
                      <td className="px-4 py-3 text-[12px] text-slate-500">{item.return_date ? new Date(item.return_date).toLocaleString('vi-VN') : '-'}</td>
                      <td className="px-4 py-3 text-[12px] text-slate-700">{item.status}</td>
                      <td className="px-4 py-3 text-[12px] text-slate-700">{Number(item.fine_amount || 0).toLocaleString('vi-VN')} VND</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </FadeItem>
        </>
      )}
    </PageWrapper>
  );
}
