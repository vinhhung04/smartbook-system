import { useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { CircleAlert, RefreshCw, Wallet, Receipt } from 'lucide-react';
import { toast } from 'sonner';
import { SectionCard, FilterBar, EmptyState } from '@/components/ui';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import { SkeletonTableRow } from '@/components/ui/loading-state';
import { StatusBadge } from '@/components/status-badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
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
import { borrowService, type Fine } from '@/services/borrow';
import { getApiErrorMessage } from '@/services/api';

const STATUS_LABELS: Record<string, string> = {
  ALL: 'Tất cả',
  UNPAID: 'Chưa trả',
  PARTIALLY_PAID: 'Trả một phần',
  PAID: 'Đã trả',
  WAIVED: 'Đã miễn',
};

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  CASH: 'Tiền mặt',
  CARD: 'Thẻ',
  TRANSFER: 'Chuyển khoản',
  EWALLET: 'Ví điện tử',
};

const PAGE_SIZE = 20;
// Backend caps pageSize at 100 (see fine.controller.js parsePagination) — fetch the max
// in one request instead of the previous unparameterized call, which silently defaulted
// to only 20 fines with no way to see the rest.
const FETCH_PAGE_SIZE = 100;

function formatVnd(amount: number | string | undefined | null): string {
  return `${Number(amount || 0).toLocaleString('vi-VN')} VND`;
}

function remainingClass(status: string, remaining: number): string {
  if (remaining <= 0) return 'text-muted-foreground';
  if (status === 'UNPAID') return 'text-rose-600 dark:text-rose-400 font-semibold';
  if (status === 'PARTIALLY_PAID') return 'text-amber-600 dark:text-amber-400 font-semibold';
  return 'text-foreground font-medium';
}

export function BorrowFinesPage() {
  const [fines, setFines] = useState<Fine[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'UNPAID' | 'PARTIALLY_PAID' | 'PAID' | 'WAIVED'>('ALL');
  const [page, setPage] = useState(1);

  const [detailFine, setDetailFine] = useState<Fine | null>(null);
  const [detailLoadingId, setDetailLoadingId] = useState<string | null>(null);

  const [paymentDialogFine, setPaymentDialogFine] = useState<Fine | null>(null);
  const [paymentForm, setPaymentForm] = useState({ amount: '', method: 'CASH' as 'CASH' | 'CARD' | 'TRANSFER' | 'EWALLET', reference: '' });
  const [submittingPayment, setSubmittingPayment] = useState(false);

  const [waiveDialogFine, setWaiveDialogFine] = useState<Fine | null>(null);
  const [waiveForm, setWaiveForm] = useState({ amount: '', note: '' });
  const [submittingWaive, setSubmittingWaive] = useState(false);

  const loadFines = async () => {
    try {
      setLoading(true);
      const response = await borrowService.getFines({ pageSize: FETCH_PAGE_SIZE });
      setFines(response.data ?? []);
    } catch (error) {
      toast.error(getApiErrorMessage(error, 'Không tải được danh sách tiền phạt'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadFines();
  }, []);

  useEffect(() => {
    setPage(1);
  }, [query, statusFilter]);

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return fines.filter((fine) => {
      if (statusFilter !== 'ALL' && fine.status !== statusFilter) return false;
      if (!keyword) return true;
      return (
        fine.id.toLowerCase().includes(keyword)
        || fine.customers?.full_name?.toLowerCase().includes(keyword)
        || fine.customers?.customer_code?.toLowerCase().includes(keyword)
        || fine.fine_type.toLowerCase().includes(keyword)
      );
    });
  }, [fines, query, statusFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const paged = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  const openDetail = async (fine: Fine) => {
    setDetailLoadingId(fine.id);
    try {
      const detail = await borrowService.getFineById(fine.id);
      setDetailFine(detail.data);
    } catch (error) {
      toast.error(getApiErrorMessage(error, 'Không tải được chi tiết tiền phạt'));
    } finally {
      setDetailLoadingId(null);
    }
  };

  const openPaymentDialog = (fine: Fine) => {
    const remaining = Number(fine.summary?.remaining_balance || 0);
    setPaymentForm({ amount: remaining > 0 ? String(remaining) : '', method: 'CASH', reference: '' });
    setPaymentDialogFine(fine);
  };

  const openWaiveDialog = (fine: Fine) => {
    const remaining = Number(fine.summary?.remaining_balance || 0);
    setWaiveForm({ amount: remaining > 0 ? String(remaining) : '', note: '' });
    setWaiveDialogFine(fine);
  };

  const submitPayment = async () => {
    if (!paymentDialogFine) return;
    const remaining = Number(paymentDialogFine.summary?.remaining_balance || 0);
    const amount = Number(paymentForm.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error('Số tiền thanh toán phải là số dương');
      return;
    }
    if (amount > remaining) {
      toast.error(`Số tiền thanh toán không được vượt quá số còn lại (${formatVnd(remaining)})`);
      return;
    }

    setSubmittingPayment(true);
    try {
      await borrowService.recordFinePayment(paymentDialogFine.id, {
        amount,
        payment_method: paymentForm.method,
        transaction_reference: paymentForm.reference.trim() || undefined,
      });
      toast.success('Đã ghi nhận thanh toán tiền phạt');
      setPaymentDialogFine(null);
      await loadFines();
    } catch (error) {
      toast.error(getApiErrorMessage(error, 'Ghi nhận thanh toán thất bại'));
    } finally {
      setSubmittingPayment(false);
    }
  };

  const submitWaive = async () => {
    if (!waiveDialogFine) return;
    const remaining = Number(waiveDialogFine.summary?.remaining_balance || 0);
    const amount = Number(waiveForm.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error('Số tiền miễn giảm phải là số dương');
      return;
    }
    if (amount > remaining) {
      toast.error(`Số tiền miễn giảm không được vượt quá số còn lại (${formatVnd(remaining)})`);
      return;
    }

    setSubmittingWaive(true);
    try {
      await borrowService.waiveFine(waiveDialogFine.id, {
        amount,
        note: waiveForm.note.trim() || undefined,
      });
      toast.success('Đã miễn giảm tiền phạt');
      setWaiveDialogFine(null);
      await loadFines();
    } catch (error) {
      toast.error(getApiErrorMessage(error, 'Miễn giảm tiền phạt thất bại'));
    } finally {
      setSubmittingWaive(false);
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
          icon={CircleAlert}
          title="Tiền phạt mượn trả"
          description={`${fines.length} khoản phạt`}
          iconBg="bg-gradient-to-br from-amber-100 to-orange-50 border border-amber-200/40 shadow-sm dark:from-amber-500/15 dark:to-orange-500/10 dark:border-amber-500/20"
          iconColor="text-amber-600 dark:text-amber-400"
          actions={
            <Button
              variant="outline"
              size="sm"
              onClick={() => void loadFines()}
              className="gap-2"
            >
              <RefreshCw className="w-4 h-4" />
              Làm mới
            </Button>
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
          searchPlaceholder="Tìm tiền phạt..."
          filters={
            <div className="flex items-center gap-1 bg-card border border-border rounded-lg p-1">
              {(['ALL', 'UNPAID', 'PARTIALLY_PAID', 'PAID', 'WAIVED'] as const).map((status) => (
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
        transition={{ duration: 0.3, delay: 0.2, ease: 'easeOut' }}
      >
        <SectionCard noPadding>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  {['Mã phạt', 'Khách hàng', 'Loại phạt', 'Số tiền', 'Còn lại', 'Trạng thái', 'Thao tác'].map((header) => (
                    <th key={header} className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wider px-5 py-3">
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <SkeletonTableRow columns={7} rows={5} />
                ) : paged.length === 0 ? (
                  <tr>
                    <td colSpan={7}>
                      <EmptyState
                        variant="no-results"
                        title="Không tìm thấy tiền phạt"
                        description="Thử điều chỉnh tìm kiếm hoặc bộ lọc."
                        className="py-12"
                      />
                    </td>
                  </tr>
                ) : (
                  paged.map((fine, index) => {
                    const total = Number(fine.amount || 0);
                    const paid = Number(fine.summary?.paid_amount || 0);
                    const remaining = Number(fine.summary?.remaining_balance || 0);
                    const paidPct = total > 0 ? Math.min(100, Math.round((paid / total) * 100)) : 0;
                    return (
                      <motion.tr
                        key={fine.id}
                        initial={{ opacity: 0, y: 5 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.15, delay: index * 0.02 }}
                        className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors"
                      >
                        <td className="px-5 py-3.5 text-sm font-mono text-muted-foreground">{fine.id.slice(0, 8)}</td>
                        <td className="px-5 py-3.5">
                          <p className="text-sm text-foreground">{fine.customers?.full_name || fine.customer_id}</p>
                          {fine.customers?.customer_code ? (
                            <p className="font-mono text-[11px] text-muted-foreground">{fine.customers.customer_code}</p>
                          ) : null}
                        </td>
                        <td className="px-5 py-3.5 text-sm text-muted-foreground">{fine.fine_type}</td>
                        <td className="px-5 py-3.5 text-sm font-mono tabular-nums text-right text-muted-foreground">{formatVnd(total)}</td>
                        <td className="px-5 py-3.5">
                          <div className="text-sm font-mono tabular-nums text-right">
                            <span className={remainingClass(fine.status, remaining)}>{formatVnd(remaining)}</span>
                          </div>
                          {total > 0 && (
                            <div className="mt-1.5 h-1 w-24 ml-auto overflow-hidden rounded-full bg-muted">
                              <div className="h-full rounded-full bg-emerald-500 transition-all duration-300" style={{ width: `${paidPct}%` }} />
                            </div>
                          )}
                        </td>
                        <td className="px-5 py-3.5">
                          <StatusBadge label={fine.status} variant={getStatusVariant('fine', fine.status)} dot />
                        </td>
                        <td className="px-5 py-3.5">
                          <div className="flex items-center gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              loading={detailLoadingId === fine.id}
                              onClick={() => void openDetail(fine)}
                            >
                              Chi tiết
                            </Button>
                            <Button
                              size="sm"
                              variant="success-outline"
                              onClick={() => openPaymentDialog(fine)}
                              disabled={remaining <= 0}
                            >
                              Thanh toán
                            </Button>
                            <Button
                              size="sm"
                              variant="warning-outline"
                              onClick={() => openWaiveDialog(fine)}
                              disabled={remaining <= 0}
                            >
                              Miễn giảm
                            </Button>
                          </div>
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
                Hiển thị <span className="font-medium text-foreground">{paged.length}</span> / {filtered.length} khoản phạt
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

      {/* Chi tiết khoản phạt — thay cho toast.message() trước đây, giờ hiển thị đúng lịch sử thanh toán */}
      <Dialog open={detailFine !== null} onOpenChange={(open) => !open && setDetailFine(null)}>
        <DialogContent className="sm:max-w-md">
          {detailFine && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <span className="font-mono text-muted-foreground">#{detailFine.id.slice(0, 8)}</span>
                  <StatusBadge label={detailFine.status} variant={getStatusVariant('fine', detailFine.status)} dot />
                </DialogTitle>
                <DialogDescription>
                  {detailFine.fine_type} · {detailFine.customers?.full_name || detailFine.customer_id}
                </DialogDescription>
              </DialogHeader>

              <div className="grid grid-cols-3 gap-3 rounded-lg border border-border bg-muted/30 p-3">
                <div>
                  <p className="text-[11px] text-muted-foreground">Tổng tiền phạt</p>
                  <p className="font-mono text-sm font-semibold tabular-nums">{formatVnd(detailFine.amount)}</p>
                </div>
                <div>
                  <p className="text-[11px] text-muted-foreground">Đã trả</p>
                  <p className="font-mono text-sm font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
                    {formatVnd(detailFine.summary?.paid_amount)}
                  </p>
                </div>
                <div>
                  <p className="text-[11px] text-muted-foreground">Còn lại</p>
                  <p className={cn('font-mono text-sm font-semibold tabular-nums', remainingClass(detailFine.status, Number(detailFine.summary?.remaining_balance || 0)))}>
                    {formatVnd(detailFine.summary?.remaining_balance)}
                  </p>
                </div>
              </div>

              <div>
                <p className="mb-2 text-[12px] font-medium text-foreground">Lịch sử thanh toán</p>
                {detailFine.fine_payments && detailFine.fine_payments.length > 0 ? (
                  <div className="divide-y divide-border rounded-lg border border-border">
                    {detailFine.fine_payments.map((payment) => (
                      <div key={payment.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
                        <div className="min-w-0">
                          <p className="font-mono text-sm font-medium tabular-nums">{formatVnd(payment.amount)}</p>
                          <p className="text-[11px] text-muted-foreground">
                            {PAYMENT_METHOD_LABELS[payment.payment_method] ?? payment.payment_method} · {new Date(payment.paid_at).toLocaleString('vi-VN')}
                          </p>
                        </div>
                        {payment.note ? <p className="shrink-0 max-w-[40%] truncate text-[11px] text-muted-foreground" title={payment.note}>{payment.note}</p> : null}
                      </div>
                    ))}
                  </div>
                ) : (
                  <EmptyState icon={Receipt} title="Chưa có thanh toán nào" description="Khoản phạt này chưa ghi nhận lần thanh toán nào." className="py-6" />
                )}
              </div>

              <DialogFooter>
                <Button
                  variant="warning-outline"
                  disabled={Number(detailFine.summary?.remaining_balance || 0) <= 0}
                  onClick={() => {
                    openWaiveDialog(detailFine);
                    setDetailFine(null);
                  }}
                >
                  Miễn giảm
                </Button>
                <Button
                  variant="success-outline"
                  disabled={Number(detailFine.summary?.remaining_balance || 0) <= 0}
                  onClick={() => {
                    openPaymentDialog(detailFine);
                    setDetailFine(null);
                  }}
                >
                  Thanh toán
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Thanh toán — thay cho window.prompt() trước đây */}
      <Dialog open={paymentDialogFine !== null} onOpenChange={(open) => !open && setPaymentDialogFine(null)}>
        <DialogContent className="sm:max-w-sm">
          {paymentDialogFine && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <Wallet className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                  Thanh toán tiền phạt
                </DialogTitle>
                <DialogDescription>
                  {paymentDialogFine.customers?.full_name || paymentDialogFine.customer_id}
                  {paymentDialogFine.customers?.customer_code ? ` · ${paymentDialogFine.customers.customer_code}` : ''}
                </DialogDescription>
              </DialogHeader>

              <p className="text-[12px] text-muted-foreground">
                Còn lại{' '}
                <span className="font-mono text-base font-semibold text-foreground">
                  {formatVnd(paymentDialogFine.summary?.remaining_balance)}
                </span>
              </p>

              <div className="space-y-3">
                <div className="space-y-1.5">
                  <label className="text-[12px] font-medium text-foreground">Số tiền thanh toán</label>
                  <Input
                    type="number"
                    min={0}
                    step="1000"
                    value={paymentForm.amount}
                    onChange={(event) => setPaymentForm((current) => ({ ...current, amount: event.target.value }))}
                    className="font-mono"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[12px] font-medium text-foreground">Phương thức thanh toán</label>
                  <Select
                    value={paymentForm.method}
                    onValueChange={(value) => setPaymentForm((current) => ({ ...current, method: value as typeof current.method }))}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(['CASH', 'CARD', 'TRANSFER', 'EWALLET'] as const).map((method) => (
                        <SelectItem key={method} value={method}>
                          {PAYMENT_METHOD_LABELS[method]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {paymentForm.method !== 'CASH' && (
                  <div className="space-y-1.5">
                    <label className="text-[12px] font-medium text-foreground">Mã giao dịch (không bắt buộc)</label>
                    <Input
                      value={paymentForm.reference}
                      onChange={(event) => setPaymentForm((current) => ({ ...current, reference: event.target.value }))}
                    />
                  </div>
                )}
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => setPaymentDialogFine(null)} disabled={submittingPayment}>
                  Huỷ
                </Button>
                <Button variant="success-outline" loading={submittingPayment} onClick={() => void submitPayment()}>
                  Xác nhận thanh toán
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Miễn giảm — thay cho 2 lần window.prompt() trước đây */}
      <Dialog open={waiveDialogFine !== null} onOpenChange={(open) => !open && setWaiveDialogFine(null)}>
        <DialogContent className="sm:max-w-sm">
          {waiveDialogFine && (
            <>
              <DialogHeader>
                <DialogTitle>Miễn giảm tiền phạt</DialogTitle>
                <DialogDescription>
                  {waiveDialogFine.customers?.full_name || waiveDialogFine.customer_id}
                  {waiveDialogFine.customers?.customer_code ? ` · ${waiveDialogFine.customers.customer_code}` : ''}
                </DialogDescription>
              </DialogHeader>

              <p className="text-[12px] text-muted-foreground">
                Còn lại{' '}
                <span className="font-mono text-base font-semibold text-foreground">
                  {formatVnd(waiveDialogFine.summary?.remaining_balance)}
                </span>
              </p>

              <div className="space-y-3">
                <div className="space-y-1.5">
                  <label className="text-[12px] font-medium text-foreground">Số tiền miễn giảm</label>
                  <Input
                    type="number"
                    min={0}
                    step="1000"
                    value={waiveForm.amount}
                    onChange={(event) => setWaiveForm((current) => ({ ...current, amount: event.target.value }))}
                    className="font-mono"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[12px] font-medium text-foreground">Lý do (không bắt buộc)</label>
                  <Textarea
                    rows={2}
                    value={waiveForm.note}
                    onChange={(event) => setWaiveForm((current) => ({ ...current, note: event.target.value }))}
                  />
                </div>
              </div>

              <p className="text-[11px] text-amber-700 dark:text-amber-400">Miễn giảm không thể hoàn tác.</p>

              <DialogFooter>
                <Button variant="outline" onClick={() => setWaiveDialogFine(null)} disabled={submittingWaive}>
                  Huỷ
                </Button>
                <Button variant="warning-outline" loading={submittingWaive} onClick={() => void submitWaive()}>
                  Xác nhận miễn giảm
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
