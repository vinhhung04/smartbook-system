import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { motion } from 'motion/react';
import { Loader2, RefreshCw, Plus, Search, X } from 'lucide-react';
import { toast } from 'sonner';
import { SectionCard, FilterBar, EmptyState } from '@/components/ui';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { borrowService, type Loan, type LoanStatus, type RenewalRequest } from '@/services/borrow';
import { bookService } from '@/services/book';
import { getApiErrorMessage } from '@/services/api';

const statuses: LoanStatus[] = ['RESERVED', 'BORROWED', 'RETURNED', 'OVERDUE', 'LOST', 'CANCELLED'];

function getBadgeVariant(status: LoanStatus) {
  if (status === 'BORROWED') return 'secondary';
  if (status === 'RETURNED') return 'default';
  if (status === 'OVERDUE' || status === 'LOST' || status === 'DAMAGED') return 'destructive';
  if (status === 'CANCELLED') return 'outline';
  return 'secondary';
}

export function BorrowLoansPage() {
  const [loans, setLoans] = useState<Loan[]>([]);
  const [renewalRequests, setRenewalRequests] = useState<RenewalRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | LoanStatus>('ALL');
  const [showDirectLoan, setShowDirectLoan] = useState(false);
  const [dlCustomers, setDlCustomers] = useState<any[]>([]);
  const [dlBooks, setDlBooks] = useState<any[]>([]);
  const [dlForm, setDlForm] = useState({ customer_id: '', items: [{ variant_id: '', quantity: 1 }] as { variant_id: string; quantity: number }[], borrow_days: 14 });
  const [dlSaving, setDlSaving] = useState(false);
  const [dlBookSearch, setDlBookSearch] = useState('');

  const loadLoans = async () => {
    try {
      setLoading(true);
      const [response, renewals] = await Promise.all([
        borrowService.getLoans(),
        borrowService.getRenewalRequests({ status: 'PENDING', pageSize: 20 }),
      ]);
      setLoans(response.data ?? []);
      setRenewalRequests(renewals.data ?? []);
    } catch (error) {
      toast.error(getApiErrorMessage(error, 'Failed to load loans'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadLoans();
  }, []);

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return loans.filter((loan) => {
      if (statusFilter !== 'ALL' && loan.status !== statusFilter) return false;
      if (!keyword) return true;
      return (
        loan.loan_number.toLowerCase().includes(keyword)
        || loan.customers?.full_name?.toLowerCase().includes(keyword)
        || loan.customer_id.toLowerCase().includes(keyword)
      );
    });
  }, [loans, query, statusFilter]);

  const returnLoan = async (loanId: string) => {
    if (!window.confirm('Return all active items in this loan?')) return;

    try {
      await borrowService.returnLoan(loanId, {});
      toast.success('Loan returned successfully');
      await loadLoans();
    } catch (error) {
      toast.error(getApiErrorMessage(error, 'Failed to return loan'));
    }
  };

  const reportDamage = async (loanId: string) => {
    if (!window.confirm('Mark returned items as DAMAGED and generate fine now?')) return;

    try {
      await borrowService.returnLoan(loanId, { item_condition_on_return: 'DAMAGED' });
      toast.success('Damage return processed');
      await loadLoans();
    } catch (error) {
      toast.error(getApiErrorMessage(error, 'Failed to report damage'));
    }
  };

  const markLost = async (loanId: string) => {
    if (!window.confirm('Mark one active item as LOST and generate fine now?')) return;

    try {
      const detail = await borrowService.getLoanById(loanId);
      const activeItem = (detail.data.loan_items || []).find((item) => item.status === 'BORROWED' || item.status === 'OVERDUE');

      if (!activeItem) {
        toast.error('No active loan item found to mark lost');
        return;
      }

      await borrowService.returnLoan(loanId, {
        loan_item_id: activeItem.id,
        mark_lost: true,
      });

      toast.success('Lost item processed');
      await loadLoans();
    } catch (error) {
      toast.error(getApiErrorMessage(error, 'Failed to mark lost item'));
    }
  };

  const openDirectLoanModal = async () => {
    setShowDirectLoan(true);
    setDlForm({ customer_id: '', items: [{ variant_id: '', quantity: 1 }], borrow_days: 14 });
    try {
      const [custRes, bookRes] = await Promise.all([borrowService.getCustomers(), bookService.getAll({ page: 1, pageSize: 200 })]);
      setDlCustomers(custRes.data ?? []);
      setDlBooks(Array.isArray(bookRes) ? bookRes : bookRes?.data ?? []);
    } catch { /* ignore */ }
  };

  const submitDirectLoan = async () => {
    if (!dlForm.customer_id) { toast.error('Select a customer'); return; }
    const validItems = dlForm.items.filter((i) => i.variant_id);
    if (validItems.length === 0) { toast.error('Add at least one book'); return; }
    try {
      setDlSaving(true);
      await borrowService.createDirectLoan({
        customer_id: dlForm.customer_id,
        source: 'COUNTER',
        items: validItems,
        borrow_days: dlForm.borrow_days,
      });
      toast.success('Direct loan created');
      setShowDirectLoan(false);
      await loadLoans();
    } catch (error) {
      toast.error(getApiErrorMessage(error, 'Failed to create loan'));
    } finally { setDlSaving(false); }
  };

  const reviewRenewal = async (loanId: string, decision: 'APPROVE' | 'REJECT') => {
    const reason = decision === 'REJECT'
      ? window.prompt('Reason for rejection (optional):', '') || undefined
      : window.prompt('Reason for approval (optional):', '') || undefined;

    try {
      await borrowService.reviewLoanRenewal(loanId, {
        decision,
        reason,
      });
      toast.success(decision === 'APPROVE' ? 'Renewal approved' : 'Renewal rejected');
      await loadLoans();
    } catch (error) {
      toast.error(getApiErrorMessage(error, decision === 'APPROVE' ? 'Failed to approve renewal' : 'Failed to reject renewal'));
    }
  };

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
      {/* Hero Header */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: 'easeOut' }}
        className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4"
      >
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-blue-100 to-indigo-50 flex items-center justify-center border border-blue-200/40 shadow-sm">
            <svg className="w-6 h-6 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Borrow Loans</h1>
            <p className="text-sm text-muted-foreground">{loans.length} loans</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={() => void openDirectLoanModal()} className="gap-2">
            <Plus className="w-4 h-4" /> Direct Loan
          </Button>
          <Button variant="outline" size="sm" onClick={() => void loadLoans()} className="gap-2">
            <RefreshCw className="w-4 h-4" /> Refresh
          </Button>
        </div>
      </motion.div>

      {/* Filter Bar */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.1, ease: 'easeOut' }}
      >
        <FilterBar
          searchValue={query}
          onSearchChange={setQuery}
          searchPlaceholder="Search loan..."
          filters={
            <div className="flex items-center gap-1 bg-card border border-border rounded-lg p-1">
              {(['ALL', ...statuses] as const).map((status) => (
                <button
                  key={status}
                  onClick={() => setStatusFilter(status)}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap transition-all ${
                    statusFilter === status
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                  }`}
                >
                  {status}
                </button>
              ))}
            </div>
          }
        />
      </motion.div>

      {/* Pending Renewal Requests */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.15, ease: 'easeOut' }}
      >
        <SectionCard
          title="Pending Renewal Requests"
          subtitle={`${renewalRequests.length} request(s)`}
          className="border-l-4 border-l-amber-400"
        >
          {renewalRequests.length === 0 ? (
            <EmptyState
              variant="no-data"
              title="No pending renewal requests"
              description="All renewal requests have been processed."
              className="py-8"
            />
          ) : (
            <div className="space-y-3">
              {renewalRequests.map((request) => (
                <div key={request.request_id} className="border border-border rounded-lg p-4 flex items-center justify-between gap-4 bg-muted/30">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-foreground truncate">
                      {request.loan?.loan_number || request.loan?.id || 'Unknown loan'} - {request.customer?.full_name || request.customer?.customer_code || 'Unknown customer'}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Requested extension: {request.requested_extension_days ?? '-'} day(s) | Requested at {new Date(request.requested_at).toLocaleString('vi-VN')}
                    </p>
                  </div>
                  {request.loan?.id ? (
                    <div className="flex items-center gap-2 shrink-0">
                      <Button
                        size="sm"
                        variant="outline"
                        className="border-emerald-200 text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800"
                        onClick={() => void reviewRenewal(request.loan!.id, 'APPROVE')}
                      >
                        Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="border-rose-200 text-rose-700 hover:bg-rose-50 hover:text-rose-800"
                        onClick={() => void reviewRenewal(request.loan!.id, 'REJECT')}
                      >
                        Reject
                      </Button>
                    </div>
                  ) : (
                    <span className="text-xs text-muted-foreground shrink-0">Invalid loan reference</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </SectionCard>
      </motion.div>

      {/* Loans Table */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.2, ease: 'easeOut' }}
      >
        <SectionCard noPadding>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  {['Loan', 'Customer', 'Borrow Date', 'Due Date', 'Items', 'Status', 'Action'].map((header) => (
                    <th key={header} className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wider px-5 py-3">
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={7} className="text-center py-14">
                      <div className="flex items-center justify-center gap-2 text-muted-foreground">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span className="text-sm">Loading loans...</span>
                      </div>
                    </td>
                  </tr>
                ) : filtered.length === 0 ? (
                  <tr>
                    <td colSpan={7}>
                      <EmptyState
                        variant="no-results"
                        title="No loans found"
                        description="Try adjusting your search or filters."
                        className="py-12"
                      />
                    </td>
                  </tr>
                ) : (
                  filtered.map((loan, index) => (
                    <motion.tr
                      key={loan.id}
                      initial={{ opacity: 0, y: 5 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.15, delay: index * 0.02 }}
                      className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors"
                    >
                      <td className="px-5 py-3.5">
                        <Link to={`/borrow/loans/${loan.id}`} className="text-sm font-medium text-primary hover:underline">
                          {loan.loan_number}
                        </Link>
                      </td>
                      <td className="px-5 py-3.5 text-sm">{loan.customers?.full_name || loan.customer_id}</td>
                      <td className="px-5 py-3.5 text-sm text-muted-foreground">{new Date(loan.borrow_date).toLocaleString('vi-VN')}</td>
                      <td className="px-5 py-3.5 text-sm text-muted-foreground">{new Date(loan.due_date).toLocaleString('vi-VN')}</td>
                      <td className="px-5 py-3.5 text-sm">{loan.total_items}</td>
                      <td className="px-5 py-3.5">
                        <Badge variant={getBadgeVariant(loan.status)}>{loan.status}</Badge>
                      </td>
                      <td className="px-5 py-3.5">
                        {loan.status === 'BORROWED' || loan.status === 'OVERDUE' || loan.status === 'RESERVED' ? (
                          <div className="flex items-center gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              className="border-emerald-200 text-emerald-700 hover:bg-emerald-50"
                              onClick={() => void returnLoan(loan.id)}
                            >
                              Return
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="border-amber-200 text-amber-700 hover:bg-amber-50"
                              onClick={() => void reportDamage(loan.id)}
                            >
                              Report Damage
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="border-rose-200 text-rose-700 hover:bg-rose-50"
                              onClick={() => void markLost(loan.id)}
                            >
                              Mark Lost
                            </Button>
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">-</span>
                        )}
                      </td>
                    </motion.tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </SectionCard>
      </motion.div>

      {showDirectLoan && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
            className="bg-card rounded-2xl shadow-2xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-[16px] font-semibold">Create Direct Loan</h3>
              <button onClick={() => setShowDirectLoan(false)} className="text-muted-foreground hover:text-foreground"><X className="w-4 h-4" /></button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-[12px] font-medium text-muted-foreground mb-1.5">Customer</label>
                <select value={dlForm.customer_id} onChange={(e) => setDlForm({ ...dlForm, customer_id: e.target.value })}
                  className="w-full h-9 px-3 rounded-lg border border-slate-200 text-[13px] focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400">
                  <option value="">Select customer...</option>
                  {dlCustomers.map((c: any) => <option key={c.id} value={c.id}>{c.full_name} ({c.customer_code})</option>)}
                </select>
              </div>
              <div>
                <label className="block text-[12px] font-medium text-muted-foreground mb-1.5">Borrow Days</label>
                <input type="number" value={dlForm.borrow_days} onChange={(e) => setDlForm({ ...dlForm, borrow_days: Number(e.target.value) || 14 })}
                  className="w-full h-9 px-3 rounded-lg border border-slate-200 text-[13px] focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400" min={1} max={90} />
              </div>
              <div>
                <label className="block text-[12px] font-medium text-muted-foreground mb-1.5">Books</label>
                <input value={dlBookSearch} onChange={(e) => { setDlBookSearch(e.target.value); bookService.getAll({ search: e.target.value, page: 1, pageSize: 50 }).then((res: any) => setDlBooks(Array.isArray(res) ? res : res?.data ?? [])).catch(() => {}); }}
                  placeholder="Search books..." className="w-full h-9 px-3 rounded-lg border border-slate-200 text-[13px] focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400 mb-2" />
                {dlForm.items.map((item, idx) => (
                  <div key={idx} className="flex gap-2 mb-2">
                    <select value={item.variant_id} onChange={(e) => { const items = [...dlForm.items]; items[idx].variant_id = e.target.value; setDlForm({ ...dlForm, items }); }}
                      className="flex-1 h-9 px-3 rounded-lg border border-slate-200 text-[13px] focus:outline-none focus:ring-2 focus:ring-indigo-500/20">
                      <option value="">Select book variant...</option>
                      {dlBooks.map((b: any) => (b.variants || []).map((v: any) => <option key={v.id} value={v.id}>{b.title} - {v.format || v.isbn13 || v.id.slice(0, 8)}</option>))}
                    </select>
                    <input type="number" value={item.quantity} min={1} max={5} onChange={(e) => { const items = [...dlForm.items]; items[idx].quantity = Number(e.target.value) || 1; setDlForm({ ...dlForm, items }); }}
                      className="w-16 h-9 px-2 rounded-lg border border-slate-200 text-[13px] text-center" />
                    {dlForm.items.length > 1 && (
                      <button onClick={() => { const items = dlForm.items.filter((_, i) => i !== idx); setDlForm({ ...dlForm, items }); }}
                        className="h-9 px-2 rounded-lg border border-red-200 text-red-600 hover:bg-red-50"><X className="w-3.5 h-3.5" /></button>
                    )}
                  </div>
                ))}
                <button onClick={() => setDlForm({ ...dlForm, items: [...dlForm.items, { variant_id: '', quantity: 1 }] })}
                  className="text-[12px] text-indigo-600 hover:underline">+ Add another book</button>
              </div>
            </div>
            <div className="mt-5 flex gap-3">
              <Button variant="outline" className="flex-1" onClick={() => setShowDirectLoan(false)}>Cancel</Button>
              <Button className="flex-1" onClick={() => void submitDirectLoan()} disabled={dlSaving}>
                {dlSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <Plus className="w-3.5 h-3.5 mr-1" />}
                {dlSaving ? 'Creating...' : 'Create Loan'}
              </Button>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
}
