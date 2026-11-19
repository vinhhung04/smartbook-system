import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { BadgePercent, CircleAlert, Eye, RefreshCw, Wallet, Receipt } from 'lucide-react';
import { toast } from 'sonner';
import { PageWrapper, FadeItem } from '../motion-utils';
import { FilterBar, EmptyState } from '@/components/ui';
import { Button, IconButton } from '@/components/ui/button';
import { RowsSkeleton } from '@/components/ops/ops-kit';
import { PageHeader } from '@/components/ui/page-header';
import { StatusBadge } from '@/components/status-badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { hasPermission } from '@/services/http-clients';
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
import { type StageTab } from './borrow-shared/stage-tabs';
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

function remainingClass(status: string, remaining: number): string {
  if (remaining <= 0) return 'text-muted-foreground';
  if (status === 'UNPAID') return 'text-red-700 dark:text-red-400 font-semibold';
  if (status === 'PARTIALLY_PAID') return 'text-amber-700 dark:text-amber-300 font-semibold';
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
  const [paymentRequestKey, setPaymentRequestKey] = useState('');
  const [paymentForm, setPaymentForm] = useState({ amount: '', method: 'CASH' as 'CASH' | 'CARD' | 'TRANSFER' | 'EWALLET', reference: '' });
  const [submittingPayment, setSubmittingPayment] = useState(false);

  const [waiveDialogFine, setWaiveDialogFine] = useState<Fine | null>(null);
  const [waiveForm, setWaiveForm] = useState({ amount: '', note: '', waiveFuture: false });
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
    // A failed/unknown response may already have committed. Keep this key for
    // every retry in the dialog; only opening a new payment starts a new key.
    setPaymentRequestKey(crypto.randomUUID());
    setPaymentForm({ amount: remaining > 0 ? String(remaining) : '', method: 'CASH', reference: '' });
    setPaymentDialogFine(fine);
  };

  const openWaiveDialog = (fine: Fine) => {
    const remaining = Number(fine.summary?.remaining_balance || 0);
    setWaiveForm({ amount: remaining > 0 ? String(remaining) : '', note: '', waiveFuture: false });
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
      }, paymentRequestKey);
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
    if (waiveForm.waiveFuture && !waiveForm.note.trim()) {
      toast.error('Nhập lý do miễn phạt cả thời gian tiếp theo');
      return;
    }
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
        ...(waiveForm.waiveFuture ? { waive_future: true } : {}),
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

  const vn = (value: number) => value.toLocaleString('vi-VN');
  const day = (value: string | null | undefined) => (value ? new Date(value).toLocaleDateString('vi-VN') : '');
  const lede = !totals
    ? 'Thu tiền phạt trả trễ, mất hoặc hư hỏng sách và miễn giảm khi cần.'
    : totals.open_count > 0
      ? `Còn ${formatVnd(totals.outstanding)} phải thu trên ${vn(totals.open_count)} khoản chưa thu xong. Đã thu ${formatVnd(totals.collected)}.`
      : `Không còn khoản phạt nào phải thu. Đã thu ${formatVnd(totals.collected)}.`;
  const railButton = (item: StageTab<TabKey>) => {
    const active = tab === item.key;
    return (
      <button
        key={item.key}
        type="button"
        onClick={() => selectTab(item.key)}
        aria-pressed={active}
        className={cn(
          'flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
          active ? 'bg-primary/[0.08] text-primary' : 'text-foreground hover:bg-muted/60',
        )}
      >
        <span className={cn('min-w-0 truncate text-[13px]', active ? 'font-semibold' : 'font-medium')}>{item.label}</span>
        <span
          className={cn(
            'min-w-6 shrink-0 rounded-full px-1.5 text-center text-[12px] tabular-nums',
            item.attention && item.count > 0 ? 'bg-amber-100 font-semibold text-amber-800 dark:bg-amber-500/15 dark:text-amber-300' : active ? 'text-primary' : 'text-muted-foreground',
          )}
        >
          {!counts ? '–' : vn(item.count)}
        </span>
      </button>
    );
  };

  return (
    <PageWrapper className="space-y-5">
      <FadeItem>
        <PageHeader
          icon={CircleAlert}
          title="Tiền phạt mượn trả"
          description={lede}
          actions={
            <Button variant="outline" size="sm" onClick={() => void refresh()} disabled={list.loading} className="gap-2">
              <RefreshCw className={cn('h-4 w-4 motion-reduce:animate-none', list.loading && 'animate-spin')} />
              Làm mới
            </Button>
          }
        />
      </FadeItem>

      <FadeItem>
        <section aria-label="Tổng quan tiền phạt" className="grid grid-cols-1 divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card sm:grid-cols-3 sm:divide-x sm:divide-y-0">
          <div className="flex items-baseline justify-between gap-3 px-5 py-3 sm:block sm:py-4">
            <p className="text-[13px] text-muted-foreground">Còn phải thu, VND</p>
            <p className={cn('font-display text-[22px] font-semibold leading-tight tabular-nums sm:mt-1 sm:text-[28px]', totals && totals.outstanding > 0 ? 'text-red-700 dark:text-red-400' : 'text-foreground')}>
              {totals ? vn(totals.outstanding) : '–'}
            </p>
          </div>
          <div className="flex items-baseline justify-between gap-3 px-5 py-3 sm:block sm:py-4">
            <p className="text-[13px] text-muted-foreground">Đã thu, VND</p>
            <p className="font-display text-[22px] font-semibold leading-tight tabular-nums sm:mt-1 sm:text-[28px] text-foreground">
              {totals ? vn(totals.collected) : '–'}
            </p>
          </div>
          <div className="flex items-baseline justify-between gap-3 px-5 py-3 sm:block sm:py-4">
            <p className="text-[13px] text-muted-foreground">Khoản chưa thu xong</p>
            <p className="font-display text-[22px] font-semibold leading-tight tabular-nums sm:mt-1 sm:text-[28px] text-foreground">
              {totals ? vn(totals.open_count) : '–'}
            </p>
          </div>
        </section>
      </FadeItem>

      <FadeItem>
        <div className="@container/page">
          <div className="grid grid-cols-1 items-start gap-4 @4xl/page:grid-cols-[232px_minmax(0,1fr)]">
            <nav aria-label="Bộ lọc tiền phạt" className="hidden rounded-2xl border border-border bg-card p-3 @4xl/page:sticky @4xl/page:top-4 @4xl/page:block">
              <div role="group" aria-label="Lọc theo tình trạng thanh toán">
                {tabs.filter((item) => !item.separated).map(railButton)}
                <div className="mt-3 border-t border-border pt-3">
                  {tabs.filter((item) => item.separated).map(railButton)}
                </div>
              </div>
              <p className="mt-3 border-t border-border px-3 pt-3 text-[12px] leading-relaxed text-muted-foreground">
                Tiền phạt phát sinh khi trả trễ, mất hoặc hư hỏng sách. Thu một phần vẫn được, phần còn lại ở mục Chưa thu xong.
              </p>
            </nav>
            <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:thin] @4xl/page:hidden" role="group" aria-label="Lọc theo tình trạng thanh toán">
              {tabs.map((item) => {
                const active = tab === item.key;
                return (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => selectTab(item.key)}
                    aria-pressed={active}
                    className={cn(
                      'flex shrink-0 items-center gap-2 rounded-full border px-3.5 py-1.5 text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
                      active ? 'border-primary/30 bg-primary/[0.08] font-semibold text-primary' : 'border-border bg-card font-medium hover:bg-muted/60',
                    )}
                  >
                    <span className="whitespace-nowrap">{item.label}</span>
                    <span className="tabular-nums text-muted-foreground">{!counts ? '–' : vn(item.count)}</span>
                  </button>
                );
              })}
            </div>

            <section aria-label="Danh sách tiền phạt" className="@container min-w-0 overflow-hidden rounded-2xl border border-border bg-card">
              <div className="px-5 pb-1 pt-4">
                <h2 className="font-display text-[18px] font-semibold tracking-tight">{activeTab.key === 'all' ? 'Tất cả khoản phạt' : activeTab.label}</h2>
                <p className="mt-0.5 text-[13px] text-muted-foreground">
                  {tab === 'open' ? 'Bấm Thanh toán khi khách nộp tiền tại quầy, hoặc miễn giảm khi có lý do.' : 'Mới phát sinh ở trên.'}
                </p>
              </div>
              <div className="border-b border-border px-4 py-3">
                <FilterBar
                  searchValue={list.search}
                  onSearchChange={list.setSearch}
                  searchPlaceholder="Tìm theo tên, mã khách hoặc mã phiếu mượn..."
                  showSearchClear
                />
              </div>

              {list.loading && list.rows.length === 0 ? (
                <RowsSkeleton rows={6} />
              ) : list.rows.length === 0 ? (
                <div className="px-5 py-10">
                  <EmptyState
                    variant={list.search ? 'no-results' : 'no-data'}
                    title={list.search ? 'Không tìm thấy tiền phạt' : `Không có khoản phạt nào ở mục "${activeTab.label}"`}
                    description={list.search ? 'Thử tìm theo tên, mã khách hoặc mã phiếu mượn.' : 'Tiền phạt phát sinh khi trả trễ, mất hoặc hư hỏng sách.'}
                    className="py-0"
                  />
                </div>
              ) : (
                <Table className="table-fixed">
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="pl-5 text-[12px] font-normal text-muted-foreground">Khoản phạt</TableHead>
                      <TableHead className="hidden w-[168px] text-right text-[12px] font-normal text-muted-foreground @3xl:table-cell">Số tiền, VND</TableHead>
                      <TableHead className="hidden w-[160px] text-right text-[12px] font-normal text-muted-foreground @2xl:table-cell">Còn lại, VND</TableHead>
                      <TableHead className="w-[148px] pr-5 text-right text-[12px] font-normal text-muted-foreground @2xl:w-[196px]">Trạng thái</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {list.rows.map((fine) => {
                      const total = Number(fine.amount || 0);
                      const paid = Number(fine.summary?.paid_amount || 0);
                      const waived = Number(fine.waived_amount || 0);
                      const remaining = Number(fine.summary?.remaining_balance || 0);
                      const paidPct = total > 0 ? Math.min(100, Math.round((paid / total) * 100)) : 0;
                      const customerName = fine.customers?.full_name || 'Khách hàng';
                      const loanNumber = fine.loan_items?.loan_transactions?.loan_number;
                      const amountBlock = (
                        <>
                          <span className="block text-[13px] tabular-nums text-foreground">{vn(total)}</span>
                          {paid > 0 ? <span className="block text-[12px] tabular-nums text-muted-foreground">đã trả {vn(paid)}</span> : null}
                          {waived > 0 ? <span className="block text-[12px] tabular-nums text-muted-foreground">miễn {vn(waived)}</span> : null}
                        </>
                      );
                      const remainingBlock = (
                        <>
                          <span className={cn('block text-[13px] tabular-nums', remainingClass(fine.status, remaining))}>{vn(remaining)}</span>
                          {total > 0 && (
                            <span className="mt-1.5 block h-1 w-24 overflow-hidden rounded-full bg-muted @2xl:ml-auto" role="img" aria-label={`Đã trả ${paidPct}%`}>
                              <span className="block h-full rounded-full bg-primary" style={{ width: `${paidPct}%` }} />
                            </span>
                          )}
                        </>
                      );
                      return (
                        <TableRow key={fine.id} className={cn('hover:bg-muted/30', list.loading && 'opacity-60')}>
                          <TableCell className="whitespace-normal py-3.5 pl-5 pr-3 align-top">
                            <span className="block text-[14px] font-semibold text-foreground">{customerName}</span>
                            <span className="block text-[13px] text-muted-foreground">
                              {getBorrowLabel('fineType', fine.fine_type)}
                              {fine.customers?.customer_code ? `, khách ${fine.customers.customer_code}` : ''}
                            </span>
                            {loanNumber && fine.loan_items ? (
                              <Link to={`/borrow/loans/${fine.loan_items.loan_id}`} className="font-mono text-[12px] text-primary underline-offset-2 hover:underline">
                                {loanNumber}
                              </Link>
                            ) : null}
                            <span className="block text-[12px] tabular-nums text-muted-foreground">
                              Phát sinh {day(fine.issued_at)}{fine.paid_at ? `, trả xong ${day(fine.paid_at)}` : ''}
                            </span>
                            {/* Columns the container hides move here, so no field is dropped. */}
                            <span className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 @2xl:hidden">
                              <span>
                                <span className="block text-[12px] text-muted-foreground">Số tiền, VND</span>
                                {amountBlock}
                              </span>
                              <span>
                                <span className="block text-[12px] text-muted-foreground">Còn lại, VND</span>
                                {remainingBlock}
                              </span>
                            </span>
                            <span className="mt-1.5 hidden @2xl:block @3xl:hidden">
                              <span className="text-[12px] text-muted-foreground">Số tiền </span>
                              <span className="text-[12px] tabular-nums text-foreground">{vn(total)}</span>
                              {paid > 0 ? <span className="text-[12px] tabular-nums text-muted-foreground">, đã trả {vn(paid)}</span> : null}
                              {waived > 0 ? <span className="text-[12px] tabular-nums text-muted-foreground">, miễn {vn(waived)}</span> : null}
                            </span>
                            {fine.note ? <span className="mt-1 line-clamp-2 block max-w-prose text-[12px] text-muted-foreground" title={fine.note}>Ghi chú: {fine.note}</span> : null}
                          </TableCell>
                          <TableCell className="hidden py-3.5 text-right align-top @3xl:table-cell">{amountBlock}</TableCell>
                          <TableCell className="hidden py-3.5 text-right align-top @2xl:table-cell">{remainingBlock}</TableCell>
                          <TableCell className="py-3.5 pr-5 text-right align-top">
                            <div className="flex flex-col items-end gap-1.5">
                              <StatusBadge label={getBorrowLabel('fine', fine.status)} variant={getStatusVariant('fine', fine.status)} dot />
                              <div className="flex flex-wrap items-center justify-end gap-0.5">
                                <Button size="sm" variant="outline" onClick={() => openPaymentDialog(fine)} disabled={remaining <= 0} className="mr-1">
                                  Thanh toán
                                </Button>
                                <IconButton
                                  variant="ghost"
                                  size="sm-icon"
                                  label={`Xem chi tiết khoản phạt của ${customerName}`}
                                  title="Chi tiết"
                                  loading={detailLoadingId === fine.id}
                                  onClick={() => void openDetail(fine)}
                                  className="text-muted-foreground hover:text-foreground"
                                >
                                  <Eye className="h-3.5 w-3.5" />
                                </IconButton>
                                <IconButton
                                  variant="ghost"
                                  size="sm-icon"
                                  label={`Miễn giảm khoản phạt của ${customerName}`}
                                  title="Miễn giảm"
                                  disabled={remaining <= 0}
                                  onClick={() => openWaiveDialog(fine)}
                                  className="text-muted-foreground hover:text-amber-700 dark:hover:text-amber-300"
                                >
                                  <BadgePercent className="h-3.5 w-3.5" />
                                </IconButton>
                              </div>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
              <ListFooter
                page={list.page}
                pageSize={PAGE_SIZE}
                total={list.meta.total}
                totalPages={list.meta.totalPages}
                shown={list.rows.length}
                noun="khoản phạt"
                onPageChange={list.setPage}
              />
            </section>
          </div>
        </div>
      </FadeItem>

      {/* Chi tiết khoản phạt — thay cho toast.message() trước đây, giờ hiển thị đúng lịch sử thanh toán */}
      <Dialog open={detailFine !== null} onOpenChange={(open) => !open && setDetailFine(null)}>
        <DialogContent className="sm:max-w-md">
          {detailFine && (
            <>
              <DialogHeader>
                <DialogTitle className="flex flex-wrap items-center gap-2">
                  <span className="font-display text-[18px]">{getBorrowLabel('fineType', detailFine.fine_type)}</span>
                  <StatusBadge label={getBorrowLabel('fine', detailFine.status)} variant={getStatusVariant('fine', detailFine.status)} dot />
                </DialogTitle>
                <DialogDescription>
                  {detailFine.customers?.full_name || 'Khách hàng'}
                  {detailFine.customers?.customer_code ? `, khách ${detailFine.customers.customer_code}` : ''}
                  {detailFine.loan_items?.loan_transactions?.loan_number ? `, phiếu ${detailFine.loan_items.loan_transactions.loan_number}` : ''}
                </DialogDescription>
              </DialogHeader>

              <dl className="grid grid-cols-3 divide-x divide-border overflow-hidden rounded-xl border border-border">
                <div className="px-3 py-2.5">
                  <dt className="text-[12px] text-muted-foreground">Tổng, VND</dt>
                  <dd className="font-display text-[17px] font-semibold tabular-nums">{vn(Number(detailFine.amount || 0))}</dd>
                </div>
                <div className="px-3 py-2.5">
                  <dt className="text-[12px] text-muted-foreground">Đã trả, VND</dt>
                  <dd className="font-display text-[17px] font-semibold tabular-nums">{vn(Number(detailFine.summary?.paid_amount || 0))}</dd>
                </div>
                <div className="px-3 py-2.5">
                  <dt className="text-[12px] text-muted-foreground">Còn lại, VND</dt>
                  <dd className={cn('font-display text-[17px] tabular-nums', remainingClass(detailFine.status, Number(detailFine.summary?.remaining_balance || 0)))}>
                    {vn(Number(detailFine.summary?.remaining_balance || 0))}
                  </dd>
                </div>
              </dl>

              {detailFine.fine_type === 'OVERDUE' && (
                <p className="text-[13px] text-muted-foreground">
                  {detailFine.accrual_from_days != null && detailFine.accrual_through_days != null
                    ? `Khoản này tính từ ngày quá hạn ${detailFine.accrual_from_days + 1} đến ${detailFine.accrual_through_days}. `
                    : ''}
                  {detailFine.loan_items?.overdue_fine_episode?.waived_future
                    ? 'Đã được duyệt miễn phạt cho thời gian tiếp theo của cuốn sách này.'
                    : 'Thanh toán hoặc miễn khoản này chỉ chốt phần đã phát sinh; các ngày giữ sách tiếp theo tiếp tục tính phạt.'}
                </p>
              )}

              <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-[13px]">
                <dt className="text-muted-foreground">Phát sinh</dt>
                <dd className="tabular-nums">{new Date(detailFine.issued_at).toLocaleString('vi-VN')}</dd>
                {Number(detailFine.waived_amount || 0) > 0 ? (
                  <>
                    <dt className="text-muted-foreground">Đã miễn</dt>
                    <dd className="tabular-nums">{formatVnd(detailFine.waived_amount)}</dd>
                  </>
                ) : null}
                {detailFine.loan_items?.item_barcode ? (
                  <>
                    <dt className="text-muted-foreground">Mã vạch sách</dt>
                    <dd className="font-mono text-[12px]">{detailFine.loan_items.item_barcode}</dd>
                  </>
                ) : null}
                {detailFine.note ? (
                  <>
                    <dt className="text-muted-foreground">Ghi chú</dt>
                    <dd className="whitespace-pre-line">{detailFine.note}</dd>
                  </>
                ) : null}
                <dt className="text-muted-foreground">Mã khoản</dt>
                <dd className="font-mono text-[12px] text-muted-foreground">{detailFine.id.slice(0, 8)}</dd>
              </dl>

              <div>
                <h3 className="mb-2 text-[13px] font-semibold text-foreground">Lịch sử thanh toán</h3>
                {detailFine.fine_payments && detailFine.fine_payments.length > 0 ? (
                  <ul className="divide-y divide-border rounded-xl border border-border">
                    {detailFine.fine_payments.map((payment) => (
                      <li key={payment.id} className="flex items-start justify-between gap-3 px-3 py-2.5">
                        <div className="min-w-0">
                          <p className="text-[13px] font-medium tabular-nums">{formatVnd(payment.amount)}</p>
                          <p className="text-[12px] text-muted-foreground">
                            {PAYMENT_METHOD_LABELS[payment.payment_method] ?? payment.payment_method}, {new Date(payment.paid_at).toLocaleString('vi-VN')}
                          </p>
                          {payment.transaction_reference ? <p className="font-mono text-[12px] text-muted-foreground">{payment.transaction_reference}</p> : null}
                        </div>
                        {payment.note ? <p className="max-w-[40%] shrink-0 truncate text-[12px] text-muted-foreground" title={payment.note}>{payment.note}</p> : null}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <EmptyState icon={Receipt} title="Chưa có thanh toán nào" description="Khoản phạt này chưa ghi nhận lần thanh toán nào." className="py-6" />
                )}
              </div>

              <DialogFooter>
                <Button
                  variant="ghost"
                  disabled={Number(detailFine.summary?.remaining_balance || 0) <= 0}
                  onClick={() => {
                    openWaiveDialog(detailFine);
                    setDetailFine(null);
                  }}
                >
                  Miễn giảm
                </Button>
                <Button
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
                <DialogTitle className="flex items-center gap-2 font-display text-[18px]">
                  <Wallet className="h-4 w-4 text-primary" aria-hidden="true" />
                  Thanh toán tiền phạt
                </DialogTitle>
                <DialogDescription>
                  {paymentDialogFine.customers?.full_name || 'Khách hàng'}
                  {paymentDialogFine.customers?.customer_code ? `, khách ${paymentDialogFine.customers.customer_code}` : ''}
                </DialogDescription>
              </DialogHeader>

              <div className="rounded-xl border border-border bg-muted/30 px-4 py-3">
                <p className="text-[12px] text-muted-foreground">Còn lại, VND</p>
                <p className="font-display text-[22px] font-semibold tabular-nums text-foreground">
                  {vn(Number(paymentDialogFine.summary?.remaining_balance || 0))}
                </p>
              </div>

              <div className="space-y-3">
                <div className="space-y-1.5">
                  <label htmlFor="fine-payment-amount" className="text-[13px] font-medium text-foreground">Số tiền thanh toán, VND</label>
                  <Input
                    id="fine-payment-amount"
                    type="number"
                    min={0}
                    step="1000"
                    value={paymentForm.amount}
                    onChange={(event) => setPaymentForm((current) => ({ ...current, amount: event.target.value }))}
                    className="tabular-nums"
                  />
                </div>
                <div className="space-y-1.5">
                  <label htmlFor="fine-payment-method" className="text-[13px] font-medium text-foreground">Phương thức thanh toán</label>
                  <Select
                    value={paymentForm.method}
                    onValueChange={(value) => setPaymentForm((current) => ({ ...current, method: value as typeof current.method }))}
                  >
                    <SelectTrigger id="fine-payment-method" className="w-full">
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
                    <label htmlFor="fine-payment-reference" className="text-[13px] font-medium text-foreground">Mã giao dịch (không bắt buộc)</label>
                    <Input
                      id="fine-payment-reference"
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
                <Button loading={submittingPayment} onClick={() => void submitPayment()}>
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
                <DialogTitle className="font-display text-[18px]">Miễn giảm tiền phạt</DialogTitle>
                <DialogDescription>
                  {waiveDialogFine.customers?.full_name || 'Khách hàng'}
                  {waiveDialogFine.customers?.customer_code ? `, khách ${waiveDialogFine.customers.customer_code}` : ''}
                </DialogDescription>
              </DialogHeader>

              <div className="rounded-xl border border-border bg-muted/30 px-4 py-3">
                <p className="text-[12px] text-muted-foreground">Còn lại, VND</p>
                <p className="font-display text-[22px] font-semibold tabular-nums text-foreground">
                  {vn(Number(waiveDialogFine.summary?.remaining_balance || 0))}
                </p>
              </div>

              <div className="space-y-3">
                {waiveDialogFine.fine_type === 'OVERDUE' && hasPermission('borrow.fines.manage') && (
                  <label className="flex items-start gap-2 text-[13px]">
                    <Checkbox checked={waiveForm.waiveFuture} onCheckedChange={checked => setWaiveForm(current => ({ ...current, waiveFuture: checked === true }))} />
                    <span>Miễn cả tiền phạt quá hạn phát sinh trong thời gian tiếp theo của cuốn sách này</span>
                  </label>
                )}
                <div className="space-y-1.5">
                  <label htmlFor="fine-waive-amount" className="text-[13px] font-medium text-foreground">Số tiền miễn giảm, VND</label>
                  <Input
                    id="fine-waive-amount"
                    type="number"
                    min={0}
                    step="1000"
                    value={waiveForm.amount}
                    onChange={(event) => setWaiveForm((current) => ({ ...current, amount: event.target.value }))}
                    className="tabular-nums"
                  />
                </div>
                <div className="space-y-1.5">
                  <label htmlFor="fine-waive-note" className="text-[13px] font-medium text-foreground">Lý do {waiveForm.waiveFuture ? '(bắt buộc)' : '(không bắt buộc)'}</label>
                  <Textarea
                    id="fine-waive-note"
                    rows={2}
                    value={waiveForm.note}
                    onChange={(event) => setWaiveForm((current) => ({ ...current, note: event.target.value }))}
                  />
                </div>
              </div>

              <p className="rounded-lg border border-amber-200 bg-amber-50/60 px-3 py-2 text-[12px] text-amber-800 dark:border-amber-500/25 dark:bg-amber-500/[0.06] dark:text-amber-300">
                Miễn giảm không thể hoàn tác.
              </p>

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
