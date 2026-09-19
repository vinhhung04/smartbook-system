import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import { motion } from 'motion/react';
import { AlertTriangle, BookOpen, BookX, CheckCircle2, Loader2, RefreshCw, Plus, X } from 'lucide-react';
import { toast } from 'sonner';
import { SectionCard, FilterBar, EmptyState, ConfirmDialog } from '@/components/ui';
import { Button } from '@/components/ui/button';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { PageHeader } from '@/components/ui/page-header';
import { SkeletonTableRow } from '@/components/ui/loading-state';
import { StatusBadge } from '@/components/status-badge';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from '@/components/ui/pagination';
import { getPaginationRange } from '@/lib/pagination';
import { cn } from '@/components/ui/utils';
import { getStatusVariant } from '@/lib/status-registry';
import { borrowService, type Loan, type LoanStatus, type RenewalRequest, type WarehouseLookupItem } from '@/services/borrow';
import { bookService } from '@/services/book';
import { getApiErrorMessage } from '@/services/api';
import { useDialogA11y } from '@/hooks/useDialogA11y';

const statuses: LoanStatus[] = ['RESERVED', 'BORROWED', 'RETURNED', 'OVERDUE', 'LOST', 'CANCELLED'];

const PAGE_SIZE = 20;
// Backend caps pageSize at 100 (see loan.controller.js parsePagination) — fetch the max in
// one request instead of the previous unparameterized call, which silently capped at 20 loans.
const FETCH_PAGE_SIZE = 100;

const ACTIVE_LOAN_STATUSES: LoanStatus[] = ['BORROWED', 'OVERDUE', 'RESERVED'];
const ICON_BUTTON_CLASS = 'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30';

/** Relative due date for loans still out, so staff see urgency without comparing timestamps. */
function dueInfo(loan: Loan): { text: string; tone: 'danger' | 'warning' | 'muted' } | null {
  if (loan.status !== 'BORROWED' && loan.status !== 'OVERDUE') return null;
  const diff = new Date(loan.due_date).getTime() - Date.now();
  if (Number.isNaN(diff)) return null;
  const DAY = 24 * 60 * 60 * 1000;
  if (loan.status === 'OVERDUE' || diff < 0) return { text: `Quá hạn ${Math.max(1, Math.ceil(-diff / DAY))} ngày`, tone: 'danger' };
  const days = Math.floor(diff / DAY);
  if (days === 0) return { text: 'Đến hạn hôm nay', tone: 'warning' };
  return { text: `Còn ${days} ngày`, tone: days <= 3 ? 'warning' : 'muted' };
}

const DUE_TONE_CLASS = {
  danger: 'font-semibold text-rose-600 dark:text-rose-400',
  warning: 'font-semibold text-amber-600 dark:text-amber-400',
  muted: 'text-muted-foreground',
} as const;

const STATUS_LABELS: Record<string, string> = {
  ALL: 'Tất cả',
  RESERVED: 'Đã đặt trước',
  BORROWED: 'Đang mượn',
  RETURNED: 'Đã trả',
  OVERDUE: 'Quá hạn',
  LOST: 'Mất sách',
  CANCELLED: 'Đã hủy',
};

export function BorrowLoansPage() {
  const [loans, setLoans] = useState<Loan[]>([]);
  const [renewalRequests, setRenewalRequests] = useState<RenewalRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | LoanStatus>('ALL');
  const [page, setPage] = useState(1);
  const [renewalDialog, setRenewalDialog] = useState<{ request: RenewalRequest; decision: 'APPROVE' | 'REJECT' } | null>(null);
  const [renewalReason, setRenewalReason] = useState('');
  const [submittingRenewal, setSubmittingRenewal] = useState(false);
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
        borrowService.getLoans({ pageSize: FETCH_PAGE_SIZE }),
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

  useEffect(() => {
    setPage(1);
  }, [query, statusFilter]);

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

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const paged = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

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

  const openRenewalDialog = (request: RenewalRequest, decision: 'APPROVE' | 'REJECT') => {
    setRenewalReason('');
    setRenewalDialog({ request, decision });
  };

  const submitRenewalReview = async () => {
    if (!renewalDialog?.request.loan?.id) return;
    setSubmittingRenewal(true);
    try {
      await borrowService.reviewLoanRenewal(renewalDialog.request.loan.id, {
        decision: renewalDialog.decision,
        reason: renewalReason.trim() || undefined,
      });
      toast.success(renewalDialog.decision === 'APPROVE' ? 'Đã duyệt gia hạn' : 'Đã từ chối gia hạn');
      setRenewalDialog(null);
      await loadLoans();
    } catch (error) {
      toast.error(getApiErrorMessage(error, renewalDialog.decision === 'APPROVE' ? 'Duyệt gia hạn thất bại' : 'Từ chối gia hạn thất bại'));
    } finally {
      setSubmittingRenewal(false);
    }
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
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
            <div className="max-w-full overflow-x-auto">
              <SegmentedControl
                layoutId="loan-filter"
                value={statusFilter}
                onChange={setStatusFilter}
                options={(['ALL', ...statuses] as const).map((status) => ({
                  value: status,
                  label: `${STATUS_LABELS[status] ?? status} (${status === 'ALL' ? loans.length : loans.filter((item) => item.status === status).length})`,
                }))}
                className="w-max"
              />
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
            <p className="flex items-center gap-2 text-[13px] text-muted-foreground">
              <CheckCircle2 className="h-4 w-4 text-emerald-500" aria-hidden="true" />
              Không có yêu cầu gia hạn nào đang chờ.
            </p>
          ) : (
            <div className="space-y-3">
              {renewalRequests.map((request) => (
                <div key={request.request_id} className="flex flex-col gap-3 rounded-lg border border-border bg-muted/30 p-4 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground">
                      {request.loan?.loan_number || request.loan?.id || 'Phiếu không xác định'} - {request.customer?.full_name || request.customer?.customer_code || 'Khách hàng không xác định'}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Gia hạn thêm {request.requested_extension_days ?? '-'} ngày · yêu cầu lúc {new Date(request.requested_at).toLocaleString('vi-VN')}
                    </p>
                  </div>
                  {request.loan?.id ? (
                    <div className="flex shrink-0 items-center gap-2">
                      <Button size="sm" variant="success-outline" onClick={() => openRenewalDialog(request, 'APPROVE')}>
                        Duyệt
                      </Button>
                      <Button size="sm" variant="danger-outline" onClick={() => openRenewalDialog(request, 'REJECT')}>
                        Từ chối
                      </Button>
                    </div>
                  ) : (
                    <span className="shrink-0 text-xs text-muted-foreground">Tham chiếu phiếu mượn không hợp lệ</span>
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
            <table className="w-full table-fixed">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  {[
                    { label: 'Phiếu mượn', className: '' },
                    { label: 'Hạn trả', className: 'hidden w-[190px] md:table-cell' },
                    { label: 'Trạng thái', className: 'hidden w-[140px] sm:table-cell' },
                    { label: 'Thao tác', className: 'w-[190px] text-right' },
                  ].map((header) => (
                    <th key={header.label} className={cn('px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground', header.className)}>
                      {header.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <SkeletonTableRow columns={4} rows={5} />
                ) : paged.length === 0 ? (
                  <tr>
                    <td colSpan={4}>
                      <EmptyState
                        variant="no-results"
                        title="Không tìm thấy phiếu mượn"
                        description="Thử điều chỉnh tìm kiếm hoặc bộ lọc."
                        className="py-12"
                      />
                    </td>
                  </tr>
                ) : (
                  paged.map((loan, index) => {
                    const due = dueInfo(loan);
                    const isActive = ACTIVE_LOAN_STATUSES.includes(loan.status);
                    return (
                    <motion.tr
                      key={loan.id}
                      initial={{ opacity: 0, y: 5 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.15, delay: Math.min(index, 10) * 0.02 }}
                      className={cn(
                        'border-b border-border last:border-0 hover:bg-muted/30 transition-colors',
                        loan.status === 'OVERDUE' && 'bg-rose-50/40 dark:bg-rose-500/[0.04]',
                      )}
                    >
                      <td className="px-4 py-3">
                        <Link to={`/borrow/loans/${loan.id}`} className="block truncate text-sm font-semibold text-primary hover:underline">
                          {loan.loan_number}
                        </Link>
                        <p className="truncate text-xs text-muted-foreground" title={loan.customers?.full_name || loan.customer_id}>
                          {loan.customers?.full_name || loan.customer_id}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          {loan.total_items} cuốn · mượn {new Date(loan.borrow_date).toLocaleDateString('vi-VN')}
                        </p>
                        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 sm:hidden">
                          <StatusBadge label={loan.status} variant={getStatusVariant('loan', loan.status)} dot />
                          {due ? <span className={cn('text-xs', DUE_TONE_CLASS[due.tone])}>{due.text}</span> : null}
                        </div>
                      </td>
                      <td className="hidden px-4 py-3 md:table-cell">
                        {due ? <p className={cn('text-sm', DUE_TONE_CLASS[due.tone])}>{due.text}</p> : null}
                        <p className="text-xs text-muted-foreground">{new Date(loan.due_date).toLocaleString('vi-VN')}</p>
                      </td>
                      <td className="hidden px-4 py-3 sm:table-cell">
                        <StatusBadge label={loan.status} variant={getStatusVariant('loan', loan.status)} dot />
                      </td>
                      <td className="px-4 py-3">
                        {isActive ? (
                          <div className="flex items-center justify-end gap-1.5">
                            <Button size="sm" variant="success-outline" onClick={() => void returnLoan(loan.id)}>
                              Trả sách
                            </Button>
                            <button
                              type="button"
                              aria-label={`Báo hư hỏng phiếu ${loan.loan_number}`}
                              title="Báo hư hỏng"
                              onClick={() => void reportDamage(loan.id)}
                              className={cn(ICON_BUTTON_CLASS, 'border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-400 dark:hover:bg-amber-500/20')}
                            >
                              <AlertTriangle className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              aria-label={`Đánh dấu mất phiếu ${loan.loan_number}`}
                              title="Đánh dấu mất"
                              onClick={() => void markLost(loan.id)}
                              className={cn(ICON_BUTTON_CLASS, 'border-red-200 bg-red-50 text-red-700 hover:bg-red-100 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-400 dark:hover:bg-red-500/20')}
                            >
                              <BookX className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        ) : (
                          <span className="block text-right text-xs text-muted-foreground">-</span>
                        )}
                      </td>
                    </motion.tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {!loading && filtered.length > 0 && (
            <div className="flex flex-col gap-3 border-t border-border px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-[12px] text-muted-foreground">
                Hiển thị <span className="font-medium text-foreground">{paged.length}</span> / {filtered.length} phiếu mượn
              </p>
              {totalPages > 1 && (
                <Pagination className="mx-0 w-auto justify-end">
                  <PaginationContent>
                    <PaginationItem>
                      <PaginationPrevious
                        onClick={(event) => {
                          event.preventDefault();
                          setPage((current) => Math.max(1, current - 1));
                        }}
                        className={cn('cursor-pointer', currentPage === 1 && 'pointer-events-none opacity-50')}
                      />
                    </PaginationItem>
                    {getPaginationRange(currentPage, totalPages).map((item, i) => (
                      <PaginationItem key={typeof item === 'number' ? item : `${item}-${i}`}>
                        {typeof item === 'number' ? (
                          <PaginationLink
                            isActive={item === currentPage}
                            onClick={(event) => {
                              event.preventDefault();
                              setPage(item);
                            }}
                            className="cursor-pointer"
                          >
                            {item}
                          </PaginationLink>
                        ) : (
                          <PaginationEllipsis />
                        )}
                      </PaginationItem>
                    ))}
                    <PaginationItem>
                      <PaginationNext
                        onClick={(event) => {
                          event.preventDefault();
                          setPage((current) => Math.min(totalPages, current + 1));
                        }}
                        className={cn('cursor-pointer', currentPage === totalPages && 'pointer-events-none opacity-50')}
                      />
                    </PaginationItem>
                  </PaginationContent>
                </Pagination>
              )}
            </div>
          )}
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

      {/* Duyệt/từ chối gia hạn — thay cho window.prompt() trước đây */}
      <Dialog open={renewalDialog !== null} onOpenChange={(open) => !open && setRenewalDialog(null)}>
        <DialogContent className="sm:max-w-sm">
          {renewalDialog && (
            <>
              <DialogHeader>
                <DialogTitle>
                  {renewalDialog.decision === 'APPROVE' ? 'Duyệt gia hạn' : 'Từ chối gia hạn'}
                </DialogTitle>
                <DialogDescription>
                  {renewalDialog.request.loan?.loan_number || renewalDialog.request.loan?.id} ·{' '}
                  {renewalDialog.request.customer?.full_name || renewalDialog.request.customer?.customer_code}
                  {' '}· Gia hạn thêm {renewalDialog.request.requested_extension_days ?? '-'} ngày
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-1.5">
                <label className="text-[12px] font-medium text-foreground">
                  Lý do {renewalDialog.decision === 'APPROVE' ? 'chấp thuận' : 'từ chối'} (không bắt buộc)
                </label>
                <Textarea rows={2} value={renewalReason} onChange={(event) => setRenewalReason(event.target.value)} />
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => setRenewalDialog(null)} disabled={submittingRenewal}>
                  Huỷ
                </Button>
                <Button
                  variant={renewalDialog.decision === 'APPROVE' ? 'success-outline' : 'danger-outline'}
                  loading={submittingRenewal}
                  onClick={() => void submitRenewalReview()}
                >
                  {renewalDialog.decision === 'APPROVE' ? 'Xác nhận duyệt' : 'Xác nhận từ chối'}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
