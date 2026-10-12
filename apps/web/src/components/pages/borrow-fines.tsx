import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { BadgePercent, CircleAlert, Eye, Loader2, RefreshCw, Wallet, Receipt } from 'lucide-react';
import { toast } from 'sonner';
import { PageWrapper, FadeItem } from '../motion-utils';
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/components/ui/utils';
import { getBorrowLabel, getStatusVariant } from '@/lib/status-registry';
import { borrowService, type Fine, type PaginatedResponse } from '@/services/borrow';
import { getApiErrorMessage } from '@/services/api';
import { StageTabs, type StageTab } from './borrow-shared/stage-tabs';
import { ListFooter } from './borrow-shared/list-footer';
import { sumCounts, useServerList } from './borrow-shared/use-server-list';

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  CASH: 'Tiền mặt',
  CARD: 'Thẻ',
  TRANSFER: 'Chuyển khoản',
  EWALLET: 'Ví điện tử',
  VNPAY: 'VNPay (online)',
};

const PAGE_SIZE = 20;

// "Chưa thu xong" is what the counter works through, so it is the default.
const TABS = [
  { key: 'open', label: 'Chưa thu xong', statuses: ['UNPAID', 'PARTIALLY_PAID'], attention: true },
  { key: 'paid', label: 'Đã trả', statuses: ['PAID'] },
  { key: 'waived', label: 'Đã miễn', statuses: ['WAIVED'] },
  { key: 'all', label: 'Tất cả', statuses: [], separated: true },
] as const satisfies readonly { key: string; label: string; statuses: readonly string[]; attention?: boolean; separated?: boolean }[];

type TabKey = (typeof TABS)[number]['key'];
type MoneySummary = NonNullable<PaginatedResponse<Fine>['meta']['summary']>;

function formatVnd(amount: number | string | undefined | null): string {
  return `${Number(amount || 0).toLocaleString('vi-VN')} VND`;
}

const ICON_BUTTON_CLASS = 'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 disabled:cursor-not-allowed disabled:opacity-50';

function remainingClass(status: string, remaining: number): string {
  if (remaining <= 0) return 'text-muted-foreground';
  if (status === 'UNPAID') return 'text-rose-600 dark:text-rose-400 font-semibold';
  if (status === 'PARTIALLY_PAID') return 'text-amber-600 dark:text-amber-400 font-semibold';
  return 'text-foreground font-medium';
}

function isTabKey(value: string | null): value is TabKey {
  return TABS.some((tab) => tab.key === value);
}

export function BorrowFinesPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab');
  const tab: TabKey = isTabKey(tabParam) ? tabParam : 'open';
  const activeTab = TABS.find((item) => item.key === tab) ?? TABS[0];

  const list = useServerList(borrowService.getFines, {
    pageSize: PAGE_SIZE,
    errorMessage: 'Không tải được danh sách tiền phạt',
    params: activeTab.statuses.length ? { status: activeTab.statuses.join(',') } : {},
  });

  // Money totals cover every fine, not just the page on screen.
  const [totals, setTotals] = useState<MoneySummary | null>(null);

  const [detailFine, setDetailFine] = useState<Fine | null>(null);
  const [detailLoadingId, setDetailLoadingId] = useState<string | null>(null);

  const [paymentDialogFine, setPaymentDialogFine] = useState<Fine | null>(null);
  const [paymentForm, setPaymentForm] = useState({ amount: '', method: 'CASH' as 'CASH' | 'CARD' | 'TRANSFER' | 'EWALLET', reference: '' });
  const [submittingPayment, setSubmittingPayment] = useState(false);

  const [waiveDialogFine, setWaiveDialogFine] = useState<Fine | null>(null);
  const [waiveForm, setWaiveForm] = useState({ amount: '', note: '' });
  const [submittingWaive, setSubmittingWaive] = useState(false);

  const loadTotals = async () => {
    try {
      const response = await borrowService.getFines({ pageSize: 1, summary: 1 });
      setTotals(response.meta.summary ?? null);
    } catch (error) {
      toast.error(getApiErrorMessage(error, 'Không tải được tổng tiền phạt'));
    }
  };

  useEffect(() => {
    void loadTotals();
  }, []);

  const refresh = async () => {
    await Promise.all([list.reload(), loadTotals()]);
  };

  const counts = list.meta.status_counts;
  const tabs: StageTab<TabKey>[] = TABS.map((item) => ({
    key: item.key,
    label: item.label,
    count: item.statuses.length ? sumCounts(counts, item.statuses) : sumCounts(counts, Object.keys(counts ?? {})),
    attention: 'attention' in item ? item.attention : undefined,
    separated: 'separated' in item ? item.separated : undefined,
  }));

  const selectTab = (key: TabKey) => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      if (key === 'open') next.delete('tab'); else next.set('tab', key);
      return next;
    }, { replace: true });
  };

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
      await refresh();
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
      await refresh();
    } catch (error) {
      toast.error(getApiErrorMessage(error, 'Miễn giảm tiền phạt thất bại'));
    } finally {
      setSubmittingWaive(false);
    }
  };

  return (
    <PageWrapper className="space-y-5">
      <FadeItem>
        <PageHeader
          icon={CircleAlert}
          title="Tiền phạt mượn trả"
          description="Thu tiền phạt trả trễ, mất hoặc hư hỏng sách và miễn giảm khi cần"
          iconBg="bg-gradient-to-br from-amber-100 to-orange-50 border border-amber-200/40 shadow-sm dark:from-amber-500/15 dark:to-orange-500/10 dark:border-amber-500/20"
          iconColor="text-amber-600 dark:text-amber-400"
          actions={
            <Button variant="outline" size="sm" onClick={() => void refresh()} disabled={list.loading} className="gap-2">
              <RefreshCw className={cn('h-4 w-4', list.loading && 'animate-spin')} />
              Làm mới
            </Button>
          }
        />
      </FadeItem>

      <FadeItem>
        <section aria-label="Tổng quan tiền phạt" className="grid grid-cols-1 gap-3 lg:grid-cols-3">
          <div className="rounded-xl border border-border bg-card p-4">
            <p className="text-[12px] font-medium text-muted-foreground">Còn phải thu</p>
            <p className={cn('mt-2 font-mono text-[24px] font-bold leading-none tabular-nums', totals && totals.outstanding > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-foreground/40')}>
              {totals ? formatVnd(totals.outstanding) : '-'}
            </p>
          </div>
          <div className="rounded-xl border border-border bg-card p-4">
            <p className="text-[12px] font-medium text-muted-foreground">Đã thu</p>
            <p className="mt-2 font-mono text-[24px] font-bold leading-none tabular-nums text-emerald-600 dark:text-emerald-400">
              {totals ? formatVnd(totals.collected) : '-'}
            </p>
          </div>
          <div className="rounded-xl border border-border bg-card p-4">
            <p className="text-[12px] font-medium text-muted-foreground">Khoản chưa thu xong</p>
            <p className="mt-2 font-mono text-[24px] font-bold leading-none tabular-nums text-foreground">
              {totals ? totals.open_count.toLocaleString('vi-VN') : '-'}
              <span className="ml-1.5 text-[12px] font-normal text-muted-foreground">khoản</span>
            </p>
          </div>
        </section>
      </FadeItem>

      <FadeItem>
        <div className="rounded-xl border border-border bg-card">
          <StageTabs label="Lọc theo tình trạng thanh toán" tabs={tabs} value={tab} onChange={selectTab} loading={list.loading && !counts} />
          <div className="border-t border-border px-4 py-3">
            <FilterBar
              searchValue={list.search}
              onSearchChange={list.setSearch}
              searchPlaceholder="Tìm theo tên, mã khách hoặc mã phiếu mượn..."
              showSearchClear
            />
          </div>
        </div>
      </FadeItem>

      <FadeItem>
        <SectionCard noPadding>
          <Table className="table-fixed">
            <TableHeader>
              <TableRow className="bg-muted/50 hover:bg-muted/50">
                {[
                  { label: 'Khoản phạt', className: '' },
                  { label: 'Số tiền', className: 'hidden w-[140px] text-right xl:table-cell' },
                  { label: 'Còn lại', className: 'hidden w-[160px] text-right md:table-cell' },
                  { label: 'Trạng thái', className: 'hidden w-[150px] lg:table-cell' },
                  { label: 'Thao tác', className: 'w-[190px] text-right' },
                ].map((header) => (
                  <TableHead key={header.label} className={cn('px-4 py-3 text-xs font-medium uppercase tracking-wider text-muted-foreground', header.className)}>
                    {header.label}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.loading && list.rows.length === 0 ? (
                <SkeletonTableRow columns={5} rows={5} />
              ) : list.rows.length === 0 ? (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={5} className="whitespace-normal">
                    <EmptyState
                      variant={list.search ? 'no-results' : 'no-data'}
                      title={list.search ? 'Không tìm thấy tiền phạt' : `Không có khoản phạt nào ở mục "${activeTab.label}"`}
                      description={list.search ? 'Thử tìm theo tên, mã khách hoặc mã phiếu mượn.' : 'Tiền phạt phát sinh khi trả trễ, mất hoặc hư hỏng sách.'}
                      className="py-12"
                    />
                  </TableCell>
                </TableRow>
              ) : (
                list.rows.map((fine) => {
                  const total = Number(fine.amount || 0);
                  const paid = Number(fine.summary?.paid_amount || 0);
                  const remaining = Number(fine.summary?.remaining_balance || 0);
                  const paidPct = total > 0 ? Math.min(100, Math.round((paid / total) * 100)) : 0;
                  const customerName = fine.customers?.full_name || 'Khách hàng';
                  const loanNumber = fine.loan_items?.loan_transactions?.loan_number;
                  const badge = <StatusBadge label={getBorrowLabel('fine', fine.status)} variant={getStatusVariant('fine', fine.status)} dot />;
                  return (
                    <TableRow key={fine.id} className={cn('hover:bg-muted/30', list.loading && 'opacity-60')}>
                      <TableCell className="px-4 py-3">
                        <p className="truncate text-sm font-semibold text-foreground" title={customerName}>{customerName}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {getBorrowLabel('fineType', fine.fine_type)}
                          {fine.customers?.customer_code ? ` · ${fine.customers.customer_code}` : ''}
                        </p>
                        {loanNumber && fine.loan_items ? (
                          <Link to={`/borrow/loans/${fine.loan_items.loan_id}`} className="block truncate text-xs text-primary hover:underline">
                            {loanNumber}
                          </Link>
                        ) : null}
                        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 lg:hidden">
                          {badge}
                          <span className={cn('font-mono text-xs md:hidden', remainingClass(fine.status, remaining))}>Còn {formatVnd(remaining)}</span>
                        </div>
                      </TableCell>
                      <TableCell className="hidden px-4 py-3 text-right font-mono text-sm tabular-nums text-muted-foreground xl:table-cell">{formatVnd(total)}</TableCell>
                      <TableCell className="hidden px-4 py-3 md:table-cell">
                        <div className="text-right font-mono text-sm tabular-nums">
                          <span className={remainingClass(fine.status, remaining)}>{formatVnd(remaining)}</span>
                        </div>
                        {total > 0 && (
                          <div className="ml-auto mt-1.5 h-1 w-24 overflow-hidden rounded-full bg-muted" role="img" aria-label={`Đã trả ${paidPct}%`}>
                            <div className="h-full rounded-full bg-emerald-500 transition-all duration-300" style={{ width: `${paidPct}%` }} />
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="hidden px-4 py-3 lg:table-cell">{badge}</TableCell>
                      <TableCell className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1.5">
                          <Button size="sm" variant="success-outline" onClick={() => openPaymentDialog(fine)} disabled={remaining <= 0}>
                            Thanh toán
                          </Button>
                          <button
                            type="button"
                            aria-label={`Xem chi tiết khoản phạt của ${customerName}`}
                            title="Chi tiết"
                            disabled={detailLoadingId === fine.id}
                            onClick={() => void openDetail(fine)}
                            className={cn(ICON_BUTTON_CLASS, 'border-input hover:bg-muted')}
                          >
                            {detailLoadingId === fine.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Eye className="h-3.5 w-3.5" />}
                          </button>
                          <button
                            type="button"
                            aria-label={`Miễn giảm khoản phạt của ${customerName}`}
                            title="Miễn giảm"
                            disabled={remaining <= 0}
                            onClick={() => openWaiveDialog(fine)}
                            className={cn(ICON_BUTTON_CLASS, 'border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-400 dark:hover:bg-amber-500/20')}
                          >
                            <BadgePercent className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
          <ListFooter
            page={list.page}
            pageSize={PAGE_SIZE}
            total={list.meta.total}
            totalPages={list.meta.totalPages}
            shown={list.rows.length}
            noun="khoản phạt"
            onPageChange={list.setPage}
          />
        </SectionCard>
      </FadeItem>

      {/* Chi tiết khoản phạt — thay cho toast.message() trước đây, giờ hiển thị đúng lịch sử thanh toán */}
      <Dialog open={detailFine !== null} onOpenChange={(open) => !open && setDetailFine(null)}>
        <DialogContent className="sm:max-w-md">
          {detailFine && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <span className="font-mono text-muted-foreground">#{detailFine.id.slice(0, 8)}</span>
                  <StatusBadge label={getBorrowLabel('fine', detailFine.status)} variant={getStatusVariant('fine', detailFine.status)} dot />
                </DialogTitle>
                <DialogDescription>
                  {getBorrowLabel('fineType', detailFine.fine_type)} · {detailFine.customers?.full_name || 'Khách hàng'}
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
                  {paymentDialogFine.customers?.full_name || 'Khách hàng'}
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
                  {waiveDialogFine.customers?.full_name || 'Khách hàng'}
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
    </PageWrapper>
  );
}
