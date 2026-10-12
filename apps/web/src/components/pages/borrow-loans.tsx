import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { AlertTriangle, BookOpen, BookX, CalendarPlus, Plus, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { PageWrapper, FadeItem } from '../motion-utils';
import { SectionCard, FilterBar, EmptyState, ConfirmDialog } from '@/components/ui';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import { SkeletonTableRow } from '@/components/ui/loading-state';
import { StatusBadge } from '@/components/status-badge';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/components/ui/utils';
import { getBorrowLabel, getStatusVariant } from '@/lib/status-registry';
import { borrowService, type Loan, type LoanStatus, type RenewalRequest } from '@/services/borrow';
import { getApiErrorMessage } from '@/services/api';
import { StageTabs, type StageTab } from './borrow-shared/stage-tabs';
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
    return items.length > 1 ? `${first} + ${items.length - 1} cuốn khác` : first;
  };

  return (
    <PageWrapper className="space-y-5">
      <FadeItem>
        <PageHeader
          icon={BookOpen}
          title="Phiếu mượn sách"
          description="Theo dõi sách đang cho mượn, thu hồi phiếu quá hạn và xử lý trả sách"
          iconBg="bg-gradient-to-br from-blue-100 to-indigo-50 border border-blue-200/40 shadow-sm dark:from-blue-500/15 dark:to-indigo-500/10 dark:border-blue-500/20"
          iconColor="text-blue-600 dark:text-blue-400"
          actions={
            <>
              <Button variant="outline" size="sm" onClick={() => void refresh()} disabled={list.loading} className="gap-2">
                <RefreshCw className={cn('h-4 w-4', list.loading && 'animate-spin')} /> Làm mới
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
          <SectionCard
            title="Yêu cầu gia hạn đang chờ"
            subtitle={`${renewalRequests.length} yêu cầu cần duyệt`}
            className="border-l-4 border-l-amber-400"
          >
            <div className="space-y-3">
              {renewalRequests.map((request) => (
                <div key={request.request_id} className="flex flex-col gap-3 rounded-lg border border-border bg-muted/30 p-4 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                  <div className="flex min-w-0 flex-1 items-start gap-3">
                    <CalendarPlus className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-foreground">
                        {request.customer?.full_name || request.customer?.customer_code || 'Khách hàng'} · {request.loan?.loan_number || 'Phiếu không xác định'}
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        Xin gia hạn thêm {request.requested_extension_days ?? '-'} ngày · gửi lúc {new Date(request.requested_at).toLocaleString('vi-VN')}
                      </p>
                    </div>
                  </div>
                  {request.loan?.id ? (
                    <div className="flex shrink-0 items-center gap-2">
                      <Button size="sm" variant="success-outline" onClick={() => openRenewalDialog(request, 'APPROVE')}>Duyệt</Button>
                      <Button size="sm" variant="danger-outline" onClick={() => openRenewalDialog(request, 'REJECT')}>Từ chối</Button>
                    </div>
                  ) : (
                    <span className="shrink-0 text-xs text-muted-foreground">Tham chiếu phiếu mượn không hợp lệ</span>
                  )}
                </div>
              ))}
            </div>
          </SectionCard>
        </FadeItem>
      )}

      <FadeItem>
        <div className="rounded-xl border border-border bg-card">
          <StageTabs label="Lọc theo tình trạng" tabs={tabs} value={tab} onChange={selectTab} loading={list.loading && !counts} />
          <div className="border-t border-border px-4 py-3">
            <FilterBar
              searchValue={list.search}
              onSearchChange={list.setSearch}
              searchPlaceholder="Tìm phiếu mượn..."
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
                  { label: 'Phiếu mượn', className: '' },
                  { label: 'Sách', className: 'hidden w-[28%] xl:table-cell' },
                  { label: 'Hạn trả', className: 'hidden w-[170px] lg:table-cell' },
                  { label: 'Trạng thái', className: 'hidden w-[150px] md:table-cell' },
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
                      title={list.search ? 'Không tìm thấy phiếu mượn' : `Không có phiếu nào ở mục "${activeTab.label}"`}
                      description={list.search ? 'Thử tìm theo mã phiếu, tên hoặc mã khách hàng.' : 'Phiếu mượn mới sẽ xuất hiện ở đây.'}
                      className="py-12"
                    />
                  </TableCell>
                </TableRow>
              ) : (
                list.rows.map((loan) => {
                  const due = dueInfo(loan);
                  const isActive = ACTIVE_LOAN_STATUSES.includes(loan.status);
                  const badge = <StatusBadge label={getBorrowLabel('loan', loan.status)} variant={getStatusVariant('loan', loan.status)} dot />;
                  return (
                    <TableRow
                      key={loan.id}
                      className={cn(
                        'hover:bg-muted/30',
                        loan.status === 'OVERDUE' && 'bg-rose-50/40 dark:bg-rose-500/[0.04]',
                        list.loading && 'opacity-60',
                      )}
                    >
                      <TableCell className="px-4 py-3">
                        <Link to={`/borrow/loans/${loan.id}`} className="block truncate text-sm font-semibold text-primary hover:underline">
                          {loan.loan_number}
                        </Link>
                        <p className="truncate text-xs text-muted-foreground">{loan.customers?.full_name || 'Khách hàng'}</p>
                        <p className="truncate text-xs text-muted-foreground xl:hidden">{booksLine(loan)}</p>
                        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 lg:hidden">
                          <span className="md:hidden">{badge}</span>
                          {due ? <span className={cn('text-xs', DUE_TONE_CLASS[due.tone])}>{due.text}</span> : null}
                        </div>
                      </TableCell>
                      <TableCell className="hidden px-4 py-3 xl:table-cell">
                        <p className="line-clamp-2 whitespace-normal text-sm">{booksLine(loan)}</p>
                        <p className="text-xs text-muted-foreground">mượn {new Date(loan.borrow_date).toLocaleDateString('vi-VN')}</p>
                      </TableCell>
                      <TableCell className="hidden px-4 py-3 lg:table-cell">
                        {due ? <p className={cn('text-sm', DUE_TONE_CLASS[due.tone])}>{due.text}</p> : null}
                        <p className="text-xs text-muted-foreground">
                          {loan.closed_at ? `trả ${new Date(loan.closed_at).toLocaleDateString('vi-VN')}` : `hạn ${new Date(loan.due_date).toLocaleDateString('vi-VN')}`}
                        </p>
                      </TableCell>
                      <TableCell className="hidden px-4 py-3 md:table-cell">{badge}</TableCell>
                      <TableCell className="px-4 py-3">
                        {isActive ? (
                          <div className="flex items-center justify-end gap-1.5">
                            <Button size="sm" variant="success-outline" onClick={() => returnLoan(loan.id)}>
                              Trả sách
                            </Button>
                            <button
                              type="button"
                              aria-label={`Báo hư hỏng phiếu ${loan.loan_number}`}
                              title="Báo hư hỏng"
                              onClick={() => reportDamage(loan.id)}
                              className={cn(ICON_BUTTON_CLASS, 'border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-400 dark:hover:bg-amber-500/20')}
                            >
                              <AlertTriangle className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              aria-label={`Đánh dấu mất phiếu ${loan.loan_number}`}
                              title="Đánh dấu mất"
                              onClick={() => markLost(loan.id)}
                              className={cn(ICON_BUTTON_CLASS, 'border-red-200 bg-red-50 text-red-700 hover:bg-red-100 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-400 dark:hover:bg-red-500/20')}
                            >
                              <BookX className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        ) : (
                          <span className="block text-right text-xs text-muted-foreground">-</span>
                        )}
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
            noun="phiếu mượn"
            onPageChange={list.setPage}
          />
        </SectionCard>
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
                <Button variant="outline" onClick={() => setRenewalDialog(null)} disabled={submittingRenewal}>Huỷ</Button>
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
    </PageWrapper>
  );
}
