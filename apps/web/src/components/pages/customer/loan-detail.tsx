import { useEffect, useState } from 'react';
import { NavLink, useParams } from 'react-router';
import { customerBorrowService } from '@/services/customer-borrow';
import { getApiErrorMessage } from '@/services/api';
import { toast } from 'sonner';
import { CustomerStateBlock } from './_shared/customer-state-block';
import { CustomerPageHeader } from './_shared/customer-page-header';
import { formatDateTime } from './_shared/customer-format';
import { getStatusTone } from './_shared/customer-status';
import { printLoanReceipt } from '@/lib/print-utils';

export function CustomerLoanDetailPage() {
  const { id } = useParams();
  const [loan, setLoan] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSubmittingRenew, setIsSubmittingRenew] = useState(false);

  const load = async () => {
    if (!id) return;
    try {
      setLoading(true);
      setError(null);
      const response = await customerBorrowService.getMyLoanById(id);
      setLoan(response?.data || null);
    } catch (err) {
      setError(getApiErrorMessage(err, 'Failed to load loan detail'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [id]);

  const handleRenewRequest = async () => {
    if (!id) return;
    try {
      setIsSubmittingRenew(true);
      await customerBorrowService.requestLoanRenewal(id);
      toast.success('Renewal request submitted');
      await load();
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Failed to request renewal'));
    } finally {
      setIsSubmittingRenew(false);
    }
  };

  if (loading) return <CustomerStateBlock mode="loading" message="Loading loan detail..." />;
  if (error) return <CustomerStateBlock mode="error" message={error} />;
  if (!loan) return <CustomerStateBlock mode="empty" message="Loan not found." />;

  const loanStatus = String(loan.status || '').toUpperCase();
  const canRequestRenewal = ['BORROWED', 'OVERDUE'].includes(loanStatus);

  return (
    <div className="space-y-4">
      <NavLink to="/customer/loans" className="text-[12px] text-indigo-600 hover:text-indigo-700" style={{ fontWeight: 600 }}>Back to loans</NavLink>

      <CustomerPageHeader
        title={loan.loan_number}
        subtitle="Review due date, items, and submit renewal request when eligible."
        actions={
          <div className="flex items-center gap-2">
            <button onClick={() => printLoanReceipt({ ...loan, customer_name: loan.customers?.full_name })}
              className="px-4 py-2.5 rounded-[10px] border border-indigo-200 bg-indigo-50 text-indigo-700 text-[13px]">
              Print Receipt
            </button>
            <button
              onClick={() => void handleRenewRequest()}
              disabled={isSubmittingRenew || !canRequestRenewal}
              className="px-4 py-2.5 rounded-[10px] bg-indigo-600 text-white text-[13px] disabled:opacity-60"
              title={canRequestRenewal ? 'Request renewal' : 'Only borrowed or overdue loans can request renewal'}
            >
              {isSubmittingRenew ? 'Submitting...' : 'Request Renewal'}
            </button>
          </div>
        }
      />

      <div className="rounded-[14px] border border-slate-200 bg-white p-6">
        <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-2 text-[13px]">
          <div>
            <span className="text-slate-500">Status:</span>{' '}
            <span className={`inline-flex rounded-[8px] border px-2 py-0.5 text-[11px] ${getStatusTone(loan.status).className}`}>
              {getStatusTone(loan.status).label}
            </span>
          </div>
          <div><span className="text-slate-500">Borrow date:</span> {formatDateTime(loan.borrow_date)}</div>
          <div><span className="text-slate-500">Due date:</span> {formatDateTime(loan.due_date)}</div>
          <div><span className="text-slate-500">Total items:</span> {loan.total_items}</div>
        </div>

        <div className="mt-5">
          <h3 className="text-[13px] text-slate-700" style={{ fontWeight: 600 }}>Loan Items</h3>
          {(loan.loan_items || []).length === 0 ? (
            <div className="text-[13px] text-slate-500 mt-2">No items.</div>
          ) : (
            <div className="mt-2 space-y-2">
              {loan.loan_items.map((item: any) => (
                <div key={item.id} className="rounded-[10px] border border-slate-200 p-3 text-[13px]">
                  <div><span className="text-slate-500">Variant:</span> {item.variant_id}</div>
                  <div><span className="text-slate-500">Status:</span> {getStatusTone(item.status).label}</div>
                  <div><span className="text-slate-500">Due:</span> {formatDateTime(item.due_date)}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
