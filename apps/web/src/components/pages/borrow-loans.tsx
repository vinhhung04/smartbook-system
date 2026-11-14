import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { AlertTriangle, BookOpen, BookX, CalendarPlus, Plus, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { PageWrapper, FadeItem } from '../motion-utils';
import { FilterBar, EmptyState, ConfirmDialog } from '@/components/ui';
import { Button, IconButton } from '@/components/ui/button';
import { RowsSkeleton } from '@/components/ops/ops-kit';
import { warehouseService } from '@/services/warehouse';
import { PageHeader } from '@/components/ui/page-header';
import { StatusBadge } from '@/components/status-badge';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/components/ui/utils';
import { getBorrowLabel, getStatusVariant } from '@/lib/status-registry';
import { borrowService, type Loan, type LoanStatus, type RenewalRequest } from '@/services/borrow';
import { getApiErrorMessage } from '@/services/api';
import { type StageTab } from './borrow-shared/stage-tabs';
import { ListFooter } from './borrow-shared/list-footer';
import { BorrowFormDialog } from './borrow-shared/borrow-form-dialog';
import { sumCounts, useServerList } from './borrow-shared/use-server-list';
import { useBookTitles } from './borrow-shared/use-book-titles';

const PAGE_SIZE = 20;

// "Đang mượn" (incl. overdue) is the working list, so it is the default; history and
// problem loans are one click away. "Tất cả" also covers rare statuses (RESERVED, CANCELLED).
const TABS = [
  { key: 'active', label: 'Đang mượn', statuses: ['BORROWED', 'OVERDUE'] },
  { key: 'overdue', label: 'Quá hạn', statuses: ['OVERDUE'], attention: true },
  { key: 'returned', label: 'Đã trả', statuses: ['RETURNED', 'RETURNED_LATE'] },
  { key: 'problem', label: 'Mất / hư hỏng', statuses: ['LOST', 'DAMAGED'] },
  { key: 'all', label: 'Tất cả', statuses: [], separated: true },
] as const satisfies readonly { key: string; label: string; statuses: readonly LoanStatus[]; attention?: boolean; separated?: boolean }[];

type TabKey = (typeof TABS)[number]['key'];

const ACTIVE_LOAN_STATUSES: LoanStatus[] = ['BORROWED', 'OVERDUE', 'RESERVED'];

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
  danger: 'font-semibold text-red-700 dark:text-red-400',
  warning: 'font-semibold text-amber-700 dark:text-amber-300',
  muted: 'text-muted-foreground',
} as const;

function isTabKey(value: string | null): value is TabKey {
  return TABS.some((tab) => tab.key === value);
}

export function BorrowLoansPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab');
  const tab: TabKey = isTabKey(tabParam) ? tabParam : 'active';
  const activeTab = TABS.find((item) => item.key === tab) ?? TABS[0];

  const list = useServerList(borrowService.getLoans, {
    pageSize: PAGE_SIZE,
    errorMessage: 'Không tải được danh sách phiếu mượn',
    params: {
      ...(activeTab.statuses.length ? { status: activeTab.statuses.join(',') } : {}),
      // Loans still out: earliest due first, so the longest-overdue are on top.
      ...(tab === 'active' || tab === 'overdue' ? { sort: 'due_date' } : {}),
    },
  });
  const bookTitle = useBookTitles();

  const [renewalRequests, setRenewalRequests] = useState<RenewalRequest[]>([]);
  const [renewalDialog, setRenewalDialog] = useState<{ request: RenewalRequest; decision: 'APPROVE' | 'REJECT' } | null>(null);
  const [renewalReason, setRenewalReason] = useState('');
  const [submittingRenewal, setSubmittingRenewal] = useState(false);
  const [directLoanOpen, setDirectLoanOpen] = useState(false);
  const [confirmState, setConfirmState] = useState<{
    open: boolean;
    title: string;
    description?: string;
    variant: 'default' | 'destructive';
    onConfirm: () => Promise<void>;
  }>({ open: false, title: '', variant: 'default', onConfirm: async () => {} });

  const loadRenewals = async () => {
    try {
      const renewals = await borrowService.getRenewalRequests({ status: 'PENDING', pageSize: 20 });
      setRenewalRequests(renewals.data ?? []);
    } catch (error) {
      toast.error(getApiErrorMessage(error, 'Không tải được yêu cầu gia hạn'));
    }
  };

  useEffect(() => {
    void loadRenewals();
  }, []);

  const refresh = async () => {
    await Promise.all([list.reload(), loadRenewals()]);
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
      if (key === 'active') next.delete('tab'); else next.set('tab', key);
      return next;
    }, { replace: true });
  };

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
          await list.reload();
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
          await list.reload();
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
          await list.reload();
        } catch (error) {
          toast.error(getApiErrorMessage(error, 'Đánh dấu mất thất bại'));
        }
      },
    );
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
      await refresh();
    } catch (error) {
      toast.error(getApiErrorMessage(error, renewalDialog.decision === 'APPROVE' ? 'Duyệt gia hạn thất bại' : 'Từ chối gia hạn thất bại'));
    } finally {
      setSubmittingRenewal(false);
    }
  };

  /** "Tên sách" or "Tên sách + 2 cuốn khác" for the books on a loan. */
  const booksLine = (loan: Loan) => {
    const items = loan.loan_items ?? [];
    if (items.length === 0) return `${loan.total_items} cuốn`;
    const first = bookTitle(items[0].variant_id);
    return items.length > 1 ? `${first} và ${items.length - 1} cuốn khác` : first;
  };

  // Which branch lent the books: a read-only lookup, the same list the warehouse pages load.
  const [branchNames, setBranchNames] = useState<Map<string, string>>(new Map());
  useEffect(() => {
    let active = true;
    warehouseService.getAll()
      .then((rows) => { if (active) setBranchNames(new Map((Array.isArray(rows) ? rows : []).map((w) => [w.id, w.name || w.code]))); })
      .catch(() => undefined);
    return () => { active = false; };
  }, []);

  const vn = (value: number) => value.toLocaleString('vi-VN');
  const lede = !counts
    ? 'Theo dõi sách đang cho mượn, thu hồi phiếu quá hạn và xử lý trả sách.'
    : `${vn((counts.BORROWED ?? 0) + (counts.OVERDUE ?? 0))} phiếu đang mượn, trong đó ${vn(counts.OVERDUE ?? 0)} quá hạn.${
        renewalRequests.length ? ` ${vn(renewalRequests.length)} yêu cầu gia hạn chờ duyệt.` : ''
      } ${vn((counts.RETURNED ?? 0) + (counts.RETURNED_LATE ?? 0))} phiếu đã trả${(counts.LOST ?? 0) + (counts.DAMAGED ?? 0) ? `, ${vn((counts.LOST ?? 0) + (counts.DAMAGED ?? 0))} mất hoặc hư hỏng` : ''}.`;
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
          icon={BookOpen}
          title="Phiếu mượn sách"
          description={lede}
          actions={
            <>
              <Button variant="outline" size="sm" onClick={() => void refresh()} disabled={list.loading} className="gap-2">
                <RefreshCw className={cn('h-4 w-4 motion-reduce:animate-none', list.loading && 'animate-spin')} /> Làm mới
              </Button>
              <Button size="sm" onClick={() => setDirectLoanOpen(true)} className="gap-2">
                <Plus className="h-4 w-4" /> Mượn trực tiếp
              </Button>
            </>
          }
        />
      </FadeItem>

      {renewalRequests.length > 0 && (
        <FadeItem>
          <section aria-labelledby="renewal-title" className="rounded-2xl border border-amber-200 bg-amber-50/60 p-5 dark:border-amber-500/25 dark:bg-amber-500/[0.06]">
            <h2 id="renewal-title" className="font-display text-[18px] font-semibold tracking-tight text-foreground">Yêu cầu gia hạn đang chờ</h2>
            <p className="mt-0.5 text-[13px] text-muted-foreground">{vn(renewalRequests.length)} yêu cầu cần duyệt. Duyệt sẽ dời hạn trả của phiếu.</p>
            <ul className="mt-3 divide-y divide-amber-200/70 overflow-hidden rounded-xl border border-amber-200/70 bg-card dark:divide-amber-500/20 dark:border-amber-500/20">
              {renewalRequests.map((request) => (
                <li key={request.request_id} className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                  <div className="flex min-w-0 flex-1 items-start gap-3">
                    <CalendarPlus className="mt-0.5 h-4 w-4 shrink-0 text-amber-700 dark:text-amber-300" aria-hidden="true" />
                    <div className="min-w-0">
                      <p className="text-[14px] font-semibold text-foreground">
                        {request.customer?.full_name || request.customer?.customer_code || 'Khách hàng'}
                      </p>
                      <p className="text-[13px] text-muted-foreground">
                        <span className="font-mono">{request.loan?.loan_number || 'Phiếu không xác định'}</span>, xin thêm {request.requested_extension_days ?? '-'} ngày, gửi lúc {new Date(request.requested_at).toLocaleString('vi-VN')}
                      </p>
                    </div>
                  </div>
                  {request.loan?.id ? (
                    <div className="flex shrink-0 items-center gap-2">
                      <Button size="sm" variant="ghost" onClick={() => openRenewalDialog(request, 'REJECT')}>Từ chối</Button>
                      <Button size="sm" onClick={() => openRenewalDialog(request, 'APPROVE')}>Duyệt</Button>
                    </div>
                  ) : (
                    <span className="shrink-0 text-[12px] text-muted-foreground">Tham chiếu phiếu mượn không hợp lệ</span>
                  )}
                </li>
              ))}
            </ul>
          </section>
        </FadeItem>
      )}

      <FadeItem>
        {/* Named so the toolbar inside the list (its own container) can still ask whether the rail is showing. */}
        <div className="@container/page">
          <div className="grid grid-cols-1 items-start gap-4 @4xl/page:grid-cols-[232px_minmax(0,1fr)]">
            <nav aria-label="Bộ lọc phiếu mượn" className="hidden rounded-2xl border border-border bg-card p-3 @4xl/page:sticky @4xl/page:top-4 @4xl/page:block">
              <div role="group" aria-label="Lọc theo tình trạng">
                {tabs.filter((item) => !item.separated).map(railButton)}
                <div className="mt-3 border-t border-border pt-3">
                  {tabs.filter((item) => item.separated).map(railButton)}
                </div>
              </div>
            </nav>
            <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:thin] @4xl/page:hidden" role="group" aria-label="Lọc theo tình trạng">
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

            <section aria-label="Danh sách phiếu mượn" className="@container min-w-0 overflow-hidden rounded-2xl border border-border bg-card">
              <div className="px-5 pb-1 pt-4">
                <h2 className="font-display text-[18px] font-semibold tracking-tight">{activeTab.key === 'all' ? 'Tất cả phiếu mượn' : activeTab.label}</h2>
                <p className="mt-0.5 text-[13px] text-muted-foreground">
                  {tab === 'active' || tab === 'overdue' ? 'Hạn trả sớm nhất ở trên, nên phiếu quá hạn lâu nhất nằm đầu.' : 'Mới nhất ở trên.'}
                </p>
              </div>
              <div className="border-b border-border px-4 py-3">
                <FilterBar
                  searchValue={list.search}
                  onSearchChange={list.setSearch}
                  searchPlaceholder="Tìm phiếu mượn..."
                  showSearchClear
                />
              </div>

              {list.loading && list.rows.length === 0 ? (
                <RowsSkeleton rows={6} />
              ) : list.rows.length === 0 ? (
                <div className="px-5 py-10">
                  <EmptyState
                    variant={list.search ? 'no-results' : 'no-data'}
                    title={list.search ? 'Không tìm thấy phiếu mượn' : `Không có phiếu nào ở mục "${activeTab.label}"`}
                    description={list.search ? 'Thử tìm theo mã phiếu, tên hoặc mã khách hàng.' : 'Phiếu mượn mới sẽ xuất hiện ở đây.'}
                    className="py-0"
                  />
                </div>
              ) : (
                <Table className="table-fixed">
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="pl-5 text-[12px] font-normal text-muted-foreground">Phiếu mượn</TableHead>
                      <TableHead className="hidden w-[30%] text-[12px] font-normal text-muted-foreground @3xl:table-cell">Sách</TableHead>
                      <TableHead className="hidden w-[140px] text-[12px] font-normal text-muted-foreground @2xl:table-cell">Hạn trả</TableHead>
                      <TableHead className="w-[132px] pr-5 text-right @2xl:w-[176px] text-[12px] font-normal text-muted-foreground">Trạng thái</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {list.rows.map((loan) => {
                      const due = dueInfo(loan);
                      const isActive = ACTIVE_LOAN_STATUSES.includes(loan.status);
                      const branch = branchNames.get(loan.warehouse_id);
                      const books = (
                        <>
                          <span className="line-clamp-2 text-[13px] text-foreground">{booksLine(loan)}</span>
                          <span className="block text-[12px] text-muted-foreground">
                            Mượn {new Date(loan.borrow_date).toLocaleDateString('vi-VN')}{branch ? ` tại ${branch}` : ''}
                          </span>
                        </>
                      );
                      const dueBlock = (
                        <>
                          {due ? <span className={cn('block text-[13px]', DUE_TONE_CLASS[due.tone])}>{due.text}</span> : null}
                          <span className="block text-[12px] tabular-nums text-muted-foreground">
                            {loan.closed_at ? `Trả ${new Date(loan.closed_at).toLocaleDateString('vi-VN')}` : `Hạn ${new Date(loan.due_date).toLocaleDateString('vi-VN')}`}
                          </span>
                        </>
                      );
                      return (
                        <TableRow key={loan.id} className={cn('hover:bg-muted/30', list.loading && 'opacity-60')}>
                          <TableCell className="whitespace-normal py-3.5 pl-5 pr-3 align-top">
                            <span className="block text-[14px] font-semibold text-foreground">{loan.customers?.full_name || 'Khách hàng'}</span>
                            <Link to={`/borrow/loans/${loan.id}`} className="font-mono text-[12px] text-primary underline-offset-2 hover:underline">
                              {loan.loan_number}
                            </Link>
                            <span className="block text-[12px] tabular-nums text-muted-foreground">{loan.total_items} cuốn{loan.customers?.customer_code ? `, khách ${loan.customers.customer_code}` : ''}</span>
                            {/* Columns the container hides move here, so no field is dropped. */}
                            <span className="mt-1.5 block @3xl:hidden">{books}</span>
                            <span className="mt-1 block @2xl:hidden">{dueBlock}</span>
                            {loan.notes ? <span className="mt-1 line-clamp-2 block max-w-prose text-[12px] text-muted-foreground" title={loan.notes}>Ghi chú: {loan.notes}</span> : null}
                          </TableCell>
                          <TableCell className="hidden whitespace-normal py-3.5 align-top @3xl:table-cell">{books}</TableCell>
                          <TableCell className="hidden whitespace-normal py-3.5 align-top @2xl:table-cell">{dueBlock}</TableCell>
                          <TableCell className="py-3.5 pr-5 text-right align-top">
                            <div className="flex flex-col items-end gap-1.5">
                              <StatusBadge label={getBorrowLabel('loan', loan.status)} variant={getStatusVariant('loan', loan.status)} dot />
                              {isActive ? (
                                <div className="flex flex-wrap items-center justify-end gap-0.5">
                                  <Button size="sm" variant="outline" onClick={() => returnLoan(loan.id)} className="mr-1">
                                    Trả sách
                                  </Button>
                                  <IconButton
                                    variant="ghost"
                                    size="sm-icon"
                                    label={`Báo hư hỏng phiếu ${loan.loan_number}`}
                                    title="Báo hư hỏng"
                                    onClick={() => reportDamage(loan.id)}
                                    className="text-muted-foreground hover:text-amber-700 dark:hover:text-amber-300"
                                  >
                                    <AlertTriangle className="h-3.5 w-3.5" />
                                  </IconButton>
                                  <IconButton
                                    variant="ghost"
                                    size="sm-icon"
                                    label={`Đánh dấu mất phiếu ${loan.loan_number}`}
                                    title="Đánh dấu mất"
                                    onClick={() => markLost(loan.id)}
                                    className="text-muted-foreground hover:text-red-700 dark:hover:text-red-400"
                                  >
                                    <BookX className="h-3.5 w-3.5" />
                                  </IconButton>
                                </div>
                              ) : null}
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
                noun="phiếu mượn"
                onPageChange={list.setPage}
              />
            </section>
          </div>
        </div>
      </FadeItem>

      <BorrowFormDialog
        open={directLoanOpen}
        mode="DIRECT_LOAN"
        onOpenChange={setDirectLoanOpen}
        onCreated={() => void list.reload()}
      />

      <ConfirmDialog
        open={confirmState.open}
        onOpenChange={(open) => setConfirmState((s) => ({ ...s, open }))}
        title={confirmState.title}
        description={confirmState.description}
        variant={confirmState.variant}
        onConfirm={confirmState.onConfirm}
      />

      <Dialog open={renewalDialog !== null} onOpenChange={(open) => !open && setRenewalDialog(null)}>
        <DialogContent className="sm:max-w-sm">
          {renewalDialog && (
            <>
              <DialogHeader>
                <DialogTitle>{renewalDialog.decision === 'APPROVE' ? 'Duyệt gia hạn' : 'Từ chối gia hạn'}</DialogTitle>
                <DialogDescription>
                  {renewalDialog.request.loan?.loan_number || renewalDialog.request.loan?.id},{' '}
                  {renewalDialog.request.customer?.full_name || renewalDialog.request.customer?.customer_code},
                  {' '}gia hạn thêm {renewalDialog.request.requested_extension_days ?? '-'} ngày
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-1.5">
                <label htmlFor="renewal-reason" className="text-[13px] font-medium text-foreground">
                  Lý do {renewalDialog.decision === 'APPROVE' ? 'chấp thuận' : 'từ chối'} (không bắt buộc)
                </label>
                <Textarea id="renewal-reason" rows={2} value={renewalReason} onChange={(event) => setRenewalReason(event.target.value)} />
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => setRenewalDialog(null)} disabled={submittingRenewal}>Huỷ</Button>
                <Button
                  variant={renewalDialog.decision === 'APPROVE' ? 'default' : 'destructive'}
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
    </PageWrapper>
  );
}
