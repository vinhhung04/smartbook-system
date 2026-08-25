import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import { motion } from 'motion/react';
import { BookOpen, Loader2, RefreshCw, Plus, X } from 'lucide-react';
import { toast } from 'sonner';
import { SectionCard, FilterBar, EmptyState, ConfirmDialog } from '@/components/ui';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import { SkeletonTableRow } from '@/components/ui/loading-state';
import { StatusBadge } from '@/components/status-badge';
import { borrowService, type Loan, type LoanStatus, type RenewalRequest, type WarehouseLookupItem } from '@/services/borrow';
import { bookService } from '@/services/book';
import { getApiErrorMessage } from '@/services/api';
import { useDialogA11y } from '@/hooks/useDialogA11y';

const statuses: LoanStatus[] = ['RESERVED', 'BORROWED', 'RETURNED', 'OVERDUE', 'LOST', 'CANCELLED'];

const STATUS_LABELS: Record<string, string> = {
  ALL: 'Tất cả',
  RESERVED: 'Đã đặt trước',
  BORROWED: 'Đang mượn',
  RETURNED: 'Đã trả',
  OVERDUE: 'Quá hạn',
  LOST: 'Mất sách',
  CANCELLED: 'Đã hủy',
};

function getStatusVariant(status: LoanStatus) {
  if (status === 'BORROWED') return 'info';
  if (status === 'RETURNED') return 'success';
  if (status === 'OVERDUE' || status === 'LOST') return 'danger';
  if (status === 'CANCELLED') return 'neutral';
  return 'primary';
}

export function BorrowLoansPage() {
  const [loans, setLoans] = useState<Loan[]>([]);
  const [renewalRequests, setRenewalRequests] = useState<RenewalRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | LoanStatus>('ALL');
  const [showDirectLoan, setShowDirectLoan] = useState(false);
  const directLoanModalRef = useRef<HTMLDivElement>(null);
  const closeDirectLoan = () => setShowDirectLoan(false);
  useDialogA11y(showDirectLoan, closeDirectLoan, directLoanModalRef);
  const [dlCustomers, setDlCustomers] = useState<any[]>([]);
  const [dlBooks, setDlBooks] = useState<any[]>([]);
  const [dlWarehouses, setDlWarehouses] = useState<WarehouseLookupItem[]>([]);
  const [dlForm, setDlForm] = useState({ customer_id: '', warehouse_id: '', items: [{ variant_id: '', quantity: 1 }] as { variant_id: string; quantity: number }[] });
  const [dlSaving, setDlSaving] = useState(false);
  const [dlBookSearch, setDlBookSearch] = useState('');
  const [confirmState, setConfirmState] = useState<{
    open: boolean;
    title: string;
    description?: string;
    variant: 'default' | 'destructive';
    onConfirm: () => Promise<void>;
  }>({ open: false, title: '', variant: 'default', onConfirm: async () => {} });

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
      toast.error(getApiErrorMessage(error, 'Không tải được danh sách phiếu mượn'));
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

  const openConfirm = (title: string, description: string, variant: 'default' | 'destructive', action: () => Promise<void>) => {
    setConfirmState({ open: true, title, description, variant, onConfirm: action });
  };

  const returnLoan = (loanId: string) => {
    openConfirm(
      'Xác nhận trả sách',
      'Trả tất cả sách đang mượn trong phiếu này? Hành động này không thể hoàn tác.',
      'default',
      async () => {
        try {
          await borrowService.returnLoan(loanId, {});
          toast.success('Đã trả sách thành công');
          setConfirmState((s) => ({ ...s, open: false }));
          await loadLoans();
        } catch (error) {
          toast.error(getApiErrorMessage(error, 'Trả sách thất bại'));
        }
      },
    );
  };

  const reportDamage = (loanId: string) => {
    openConfirm(
      'Báo hư hỏng sách',
      'Đánh dấu sách trả bị hư hỏng và tạo tiền phạt?',
      'destructive',
      async () => {
        try {
          await borrowService.returnLoan(loanId, { item_condition_on_return: 'DAMAGED' });
          toast.success('Đã xử lý trả sách hư hỏng');
          setConfirmState((s) => ({ ...s, open: false }));
          await loadLoans();
        } catch (error) {
          toast.error(getApiErrorMessage(error, 'Báo hư hỏng thất bại'));
        }
      },
    );
  };

  const markLost = (loanId: string) => {
    openConfirm(
      'Đánh dấu mất sách',
      'Đánh dấu một sách đang mượn là mất và tạo tiền phạt?',
      'destructive',
      async () => {
        try {
          const detail = await borrowService.getLoanById(loanId);
          const activeItem = (detail.data.loan_items || []).find((item) => item.status === 'BORROWED' || item.status === 'OVERDUE');
          if (!activeItem) {
            toast.error('Không tìm thấy sách đang mượn để đánh dấu mất');
            return;
          }
          await borrowService.returnLoan(loanId, { loan_item_id: activeItem.id, mark_lost: true, item_condition_on_return: 'LOST' });
          toast.success('Đã xử lý sách mất');
          setConfirmState((s) => ({ ...s, open: false }));
          await loadLoans();
        } catch (error) {
          toast.error(getApiErrorMessage(error, 'Đánh dấu mất thất bại'));
        }
      },
    );
  };

  const openDirectLoanModal = async () => {
    setShowDirectLoan(true);
    setDlForm({ customer_id: '', warehouse_id: '', items: [{ variant_id: '', quantity: 1 }] });
    try {
      const [custRes, bookRes, warehouseRes] = await Promise.all([
        borrowService.getCustomers(),
        bookService.getAll({ page: 1, pageSize: 200 }),
        borrowService.searchWarehouses({ limit: 20 }),
      ]);
      setDlCustomers(custRes.data ?? []);
      setDlBooks(Array.isArray(bookRes) ? bookRes : bookRes?.data ?? []);
      setDlWarehouses(warehouseRes.data ?? []);
    } catch { /* ignore */ }
  };

  const submitDirectLoan = async () => {
    if (!dlForm.customer_id) { toast.error('Vui lòng chọn khách hàng'); return; }
    if (!dlForm.warehouse_id) { toast.error('Vui lòng chọn kho'); return; }
    const validItems = dlForm.items.filter((i) => i.variant_id);
    if (validItems.length === 0) { toast.error('Vui lòng thêm ít nhất một sách'); return; }
    try {
      setDlSaving(true);
      await Promise.all(validItems.map((item) => borrowService.createDirectLoan({
        customer_id: dlForm.customer_id,
        variant_id: item.variant_id,
        warehouse_id: dlForm.warehouse_id,
        quantity: item.quantity,
        source_channel: 'COUNTER',
      })));
      toast.success('Đã tạo phiếu mượn trực tiếp');
      setShowDirectLoan(false);
      await loadLoans();
    } catch (error) {
      toast.error(getApiErrorMessage(error, 'Tạo phiếu mượn thất bại'));
    } finally { setDlSaving(false); }
  };

  const reviewRenewal = async (loanId: string, decision: 'APPROVE' | 'REJECT') => {
    const reason = decision === 'REJECT'
      ? window.prompt('Lý do từ chối (không bắt buộc):', '') || undefined
      : window.prompt('Lý do chấp thuận (không bắt buộc):', '') || undefined;

    try {
      await borrowService.reviewLoanRenewal(loanId, {
        decision,
        reason,
      });
      toast.success(decision === 'APPROVE' ? 'Đã duyệt gia hạn' : 'Đã từ chối gia hạn');
      await loadLoans();
    } catch (error) {
      toast.error(getApiErrorMessage(error, decision === 'APPROVE' ? 'Duyệt gia hạn thất bại' : 'Từ chối gia hạn thất bại'));
    }
  };

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: 'easeOut' }}
      >
        <PageHeader
          icon={BookOpen}
          title="Phiếu mượn sách"
          description={`${loans.length} phiếu mượn`}
          iconBg="bg-gradient-to-br from-blue-100 to-indigo-50 border border-blue-200/40 shadow-sm dark:from-blue-500/15 dark:to-indigo-500/10 dark:border-blue-500/20"
          iconColor="text-blue-600 dark:text-blue-400"
          actions={
            <>
              <Button size="sm" onClick={() => void openDirectLoanModal()} className="gap-2">
                <Plus className="w-4 h-4" /> Mượn trực tiếp
              </Button>
              <Button variant="outline" size="sm" onClick={() => void loadLoans()} className="gap-2">
                <RefreshCw className="w-4 h-4" /> Làm mới
              </Button>
            </>
          }
        />
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.1, ease: 'easeOut' }}
      >
        <FilterBar
          searchValue={query}
          onSearchChange={setQuery}
          searchPlaceholder="Tìm phiếu mượn..."
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
                  {STATUS_LABELS[status] ?? status}
                </button>
              ))}
            </div>
          }
        />
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.15, ease: 'easeOut' }}
      >
        <SectionCard
          title="Yêu cầu gia hạn đang chờ"
          subtitle={`${renewalRequests.length} yêu cầu`}
          className="border-l-4 border-l-amber-400"
        >
          {renewalRequests.length === 0 ? (
            <EmptyState
              variant="no-data"
              title="Không có yêu cầu gia hạn đang chờ"
              description="Tất cả yêu cầu gia hạn đã được xử lý."
              className="py-8"
            />
          ) : (
            <div className="space-y-3">
              {renewalRequests.map((request) => (
                <div key={request.request_id} className="border border-border rounded-lg p-4 flex items-center justify-between gap-4 bg-muted/30">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-foreground truncate">
                      {request.loan?.loan_number || request.loan?.id || 'Phiếu không xác định'} - {request.customer?.full_name || request.customer?.customer_code || 'Khách hàng không xác định'}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Gia hạn thêm: {request.requested_extension_days ?? '-'} ngày | Yêu cầu lúc {new Date(request.requested_at).toLocaleString('vi-VN')}
                    </p>
                  </div>
                  {request.loan?.id ? (
                    <div className="flex items-center gap-2 shrink-0">
                      <Button
                        size="sm"
                        variant="outline"
                        className="border-emerald-200 text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800 dark:border-emerald-500/20 dark:text-emerald-400 dark:hover:bg-emerald-500/10"
                        onClick={() => void reviewRenewal(request.loan!.id, 'APPROVE')}
                      >
                        Duyệt
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="border-rose-200 text-rose-700 hover:bg-rose-50 hover:text-rose-800 dark:border-rose-500/20 dark:text-rose-400 dark:hover:bg-rose-500/10"
                        onClick={() => void reviewRenewal(request.loan!.id, 'REJECT')}
                      >
                        Từ chối
                      </Button>
                    </div>
                  ) : (
                    <span className="text-xs text-muted-foreground shrink-0">Tham chiếu phiếu mượn không hợp lệ</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </SectionCard>
      </motion.div>

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
                  {['Phiếu mượn', 'Khách hàng', 'Ngày mượn', 'Hạn trả', 'Sách', 'Trạng thái', 'Thao tác'].map((header) => (
                    <th key={header} className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wider px-5 py-3">
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <SkeletonTableRow columns={7} rows={5} />
                ) : filtered.length === 0 ? (
                  <tr>
                    <td colSpan={7}>
                      <EmptyState
                        variant="no-results"
                        title="Không tìm thấy phiếu mượn"
                        description="Thử điều chỉnh tìm kiếm hoặc bộ lọc."
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
                        <StatusBadge label={loan.status} variant={getStatusVariant(loan.status)} dot />
                      </td>
                      <td className="px-5 py-3.5">
                        {loan.status === 'BORROWED' || loan.status === 'OVERDUE' || loan.status === 'RESERVED' ? (
                          <div className="flex items-center gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              className="border-emerald-200 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-500/20 dark:text-emerald-400 dark:hover:bg-emerald-500/10"
                              onClick={() => void returnLoan(loan.id)}
                            >
                              Trả sách
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="border-amber-200 text-amber-700 hover:bg-amber-50 dark:border-amber-500/20 dark:text-amber-400 dark:hover:bg-amber-500/10"
                              onClick={() => void reportDamage(loan.id)}
                            >
                              Báo hư hỏng
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="border-rose-200 text-rose-700 hover:bg-rose-50 dark:border-rose-500/20 dark:text-rose-400 dark:hover:bg-rose-500/10"
                              onClick={() => void markLost(loan.id)}
                            >
                              Đánh dấu mất
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="direct-loan-modal-title">
          <motion.div ref={directLoanModalRef} initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
            className="bg-card rounded-2xl shadow-2xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 id="direct-loan-modal-title" className="text-[16px] font-semibold">Tạo phiếu mượn trực tiếp</h3>
              <button onClick={() => setShowDirectLoan(false)} aria-label="Đóng" className="text-muted-foreground hover:text-foreground"><X className="w-4 h-4" /></button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-[12px] font-medium text-muted-foreground mb-1.5">Khách hàng</label>
                <select value={dlForm.customer_id} onChange={(e) => setDlForm({ ...dlForm, customer_id: e.target.value })}
                  className="w-full h-9 px-3 rounded-lg border border-input bg-background text-[13px] focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40">
                  <option value="">Chọn khách hàng...</option>
                  {dlCustomers.map((c: any) => <option key={c.id} value={c.id}>{c.full_name} ({c.customer_code})</option>)}
                </select>
              </div>
              <div>
                <label className="block text-[12px] font-medium text-muted-foreground mb-1.5">Kho</label>
                <select value={dlForm.warehouse_id} onChange={(e) => setDlForm({ ...dlForm, warehouse_id: e.target.value })}
                  className="w-full h-9 px-3 rounded-lg border border-input bg-background text-[13px] focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40">
                  <option value="">Chọn kho...</option>
                  {dlWarehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name} ({warehouse.code})</option>)}
                </select>
              </div>
              <div>
                <label className="block text-[12px] font-medium text-muted-foreground mb-1.5">Sách</label>
                <input value={dlBookSearch} onChange={(e) => { setDlBookSearch(e.target.value); bookService.getAll({ search: e.target.value, page: 1, pageSize: 50 }).then((res: any) => setDlBooks(Array.isArray(res) ? res : res?.data ?? [])).catch(() => {}); }}
                  placeholder="Tìm sách..." className="w-full h-9 px-3 rounded-lg border border-input bg-background text-[13px] focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40 mb-2" />
                {dlForm.items.map((item, idx) => (
                  <div key={idx} className="flex gap-2 mb-2">
                    <select value={item.variant_id} onChange={(e) => { const items = [...dlForm.items]; items[idx].variant_id = e.target.value; setDlForm({ ...dlForm, items }); }}
                      className="flex-1 h-9 px-3 rounded-lg border border-input bg-background text-[13px] focus:outline-none focus:ring-2 focus:ring-primary/20">
                      <option value="">Chọn biến thể sách...</option>
                      {dlBooks.map((b: any) => (b.variants || []).map((v: any) => <option key={v.id} value={v.id}>{b.title} - {v.format || v.isbn13 || v.id.slice(0, 8)}</option>))}
                    </select>
                    <input type="number" value={item.quantity} min={1} max={5} onChange={(e) => { const items = [...dlForm.items]; items[idx].quantity = Number(e.target.value) || 1; setDlForm({ ...dlForm, items }); }}
                      className="w-16 h-9 px-2 rounded-lg border border-input bg-background text-[13px] text-center" />
                    {dlForm.items.length > 1 && (
                      <button onClick={() => { const items = dlForm.items.filter((_, i) => i !== idx); setDlForm({ ...dlForm, items }); }}
                        aria-label="Xóa sách" className="h-9 px-2 rounded-lg border border-red-200 text-red-600 hover:bg-red-50 dark:border-red-500/20 dark:text-red-400 dark:hover:bg-red-500/10"><X className="w-3.5 h-3.5" /></button>
                    )}
                  </div>
                ))}
                <button onClick={() => setDlForm({ ...dlForm, items: [...dlForm.items, { variant_id: '', quantity: 1 }] })}
                  className="text-[12px] text-indigo-600 dark:text-indigo-400 hover:underline">+ Thêm sách khác</button>
              </div>
            </div>
            <div className="mt-5 flex gap-3">
              <Button variant="outline" className="flex-1" onClick={() => setShowDirectLoan(false)}>Hủy</Button>
              <Button className="flex-1" onClick={() => void submitDirectLoan()} disabled={dlSaving}>
                {dlSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <Plus className="w-3.5 h-3.5 mr-1" />}
                {dlSaving ? 'Đang tạo...' : 'Tạo phiếu mượn'}
              </Button>
            </div>
          </motion.div>
        </div>
      )}

      <ConfirmDialog
        open={confirmState.open}
        onOpenChange={(open) => setConfirmState((s) => ({ ...s, open }))}
        title={confirmState.title}
        description={confirmState.description}
        variant={confirmState.variant}
        onConfirm={confirmState.onConfirm}
      />
    </div>
  );
}
