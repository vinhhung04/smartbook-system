import { useCallback, useEffect, useMemo, useState } from 'react';
import { isAxiosError } from 'axios';
import { Link, useParams } from 'react-router';
import { ArrowLeft, Check, Printer } from 'lucide-react';
import { toast } from 'sonner';
import { PageWrapper, FadeItem } from '../motion-utils';
import { StatusBadge } from '../status-badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { getBorrowLabel, getStatusVariant } from '@/lib/status-registry';
import { borrowService, type Loan, type ReturnPreview, type ReturnPayload, type ReturnItemResult } from '@/services/borrow';
import { bookService } from '@/services/book';
import { getApiErrorMessage } from '@/services/api';
import { LoanReceiptPrintSheet } from './loan-receipt-print-sheet';
import { AskAiPanel } from '@/components/ai-experience/ask-ai-panel';
import { LoadingOverlay } from '@/components/ui/loading-state';
import { EmptyState } from '@/components/ui/empty-state';
import { cn } from '@/components/ui/utils';
import { warehouseService } from '@/services/warehouse';

function daysOverdue(dueDate: string): number {
  const diffMs = Date.now() - new Date(dueDate).getTime();
  return Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
}

const formatVnd = (value: number | string | null | undefined) => `${Number(value || 0).toLocaleString('vi-VN')} VND`;

type ReturnMode = 'return' | 'damage' | 'lost';
type ReturnRow = { condition: 'GOOD' | 'DAMAGED' | 'LOST'; notes: string; reason: string };

const RETURN_DIALOG: Record<ReturnMode, { title: string; description: string; variant: 'default' | 'destructive'; success: string; failure: string }> = {
  return: {
    title: 'Xác nhận trả sách',
    description: 'Kiểm tra tình trạng, tiền phạt và tiền cọc của từng cuốn trước khi xác nhận.',
    variant: 'default',
    success: 'Đã trả sách thành công',
    failure: 'Trả sách thất bại',
  },
  damage: {
    title: 'Báo hư hỏng sách',
    description: 'Đánh dấu sách trả bị hư hỏng và tạo tiền phạt?',
    variant: 'destructive',
    success: 'Đã xử lý trả sách hư hỏng',
    failure: 'Báo hư hỏng thất bại',
  },
  lost: {
    title: 'Đánh dấu mất sách',
    description: 'Đánh dấu một sách đang mượn là mất và tạo tiền phạt?',
    variant: 'destructive',
    success: 'Đã xử lý sách mất',
    failure: 'Đánh dấu mất thất bại',
  },
};

export function BorrowLoanDetailPage() {
  const { id } = useParams();
  const [loan, setLoan] = useState<Loan | null>(null);
  const [books, setBooks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  // One dialog for the three return actions. itemId '' = every active book.
  const [returnDialog, setReturnDialog] = useState<{ open: boolean; mode: ReturnMode; itemId: string; reason: string }>(
    { open: false, mode: 'return', itemId: '', reason: '' },
  );
  const [preview, setPreview] = useState<ReturnPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [returnRows, setReturnRows] = useState<Record<string, ReturnRow>>({});
  const [returnKey, setReturnKey] = useState('');
  const [returnLocked, setReturnLocked] = useState(false);
  const [returnResults, setReturnResults] = useState<ReturnItemResult[]>([]);
  const [previewError, setPreviewError] = useState('');

  const load = useCallback(async () => {
    if (!id) return;
    try {
      setLoading(true);
      const [loanResp, booksResp] = await Promise.allSettled([
        borrowService.getLoanById(id),
        bookService.getAll(),
      ]);
      if (loanResp.status === 'fulfilled') setLoan(loanResp.value.data);
      if (booksResp.status === 'fulfilled' && Array.isArray(booksResp.value)) setBooks(booksResp.value);
    } catch (error) {
      toast.error(getApiErrorMessage(error, 'Không tải được chi tiết phiếu mượn'));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const getBookTitle = (variantId: string) =>
    books.find((b) => b.variant_id === variantId)?.title ?? variantId;

  const activeItems = (loan?.loan_items || []).filter((item) => item.status === 'BORROWED' || item.status === 'OVERDUE');

  const openReturnDialog = (mode: ReturnMode) => {
    if (!loan) return;
    if (mode === 'lost' && activeItems.length === 0) {
      toast.error('Không tìm thấy sách đang mượn để đánh dấu mất');
      return;
    }
    // Lost is always one book (defaults to the first active one, as before).
    setReturnDialog({ open: true, mode, itemId: mode === 'lost' ? activeItems[0].id : '', reason: '' });
    setReturnRows(Object.fromEntries(activeItems.map(item => [item.id, {
      condition: mode === 'damage' ? 'DAMAGED' : mode === 'lost' ? 'LOST' : 'GOOD', notes: '', reason: '',
    }])));
    setReturnKey(crypto.randomUUID());
    setReturnLocked(false);
    setReturnResults([]);
  };

  const returnPayload = useMemo<ReturnPayload>(() => ({ items: (loan?.loan_items || [])
    .filter(item => (item.status === 'BORROWED' || item.status === 'OVERDUE') && (!returnDialog.itemId || item.id === returnDialog.itemId))
    .map(item => ({ loan_item_id: item.id, item_condition_on_return: returnRows[item.id]?.condition || 'GOOD',
      notes: returnRows[item.id]?.notes || '', settlement_reason: returnRows[item.id]?.reason || '',
      mark_lost: returnRows[item.id]?.condition === 'LOST' })) }), [loan, returnDialog.itemId, returnRows]);

  // Deposit/fine preview for the current dialog inputs, so staff see what will be
  // refunded or still owed before they confirm.
  useEffect(() => {
    if (!loan || !returnDialog.open) return;
    let cancelled = false;
    setPreviewLoading(true);
    setPreview(null);
    setPreviewError('');
    const timer = setTimeout(() => { void borrowService
      .previewReturn(loan.id, returnPayload)
      .then((response) => { if (!cancelled) setPreview(response.data); })
      .catch(error => { if (!cancelled) setPreviewError(getApiErrorMessage(error, 'Không tải được dự toán trả sách')); })
      .finally(() => { if (!cancelled) setPreviewLoading(false); }); }, 250);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [loan, returnDialog.open, returnPayload]);

  const confirmReturn = async () => {
    if (!loan) return;
    const { mode } = returnDialog;
    const copy = RETURN_DIALOG[mode];
    if (previewLoading || !preview) {
      toast.error(previewError || 'Chờ tải dự toán tiền cọc và tiền phạt trước khi xác nhận');
      return;
    }
    if (preview.items.some(item => item.requires_reason && !returnRows[item.loan_item_id]?.reason.trim() && !returnRows[item.loan_item_id]?.notes.trim())) {
      toast.error('Nhập lý do xử lý tiền cọc cho từng cuốn hỏng hoặc mất'); return;
    }
    try {
      const response = await borrowService.returnLoan(loan.id, returnPayload, returnKey);
      setReturnResults(response.data.item_results || []);
      toast.success(copy.success);
      setReturnDialog((s) => ({ ...s, open: false }));
      await load();
    } catch (error) {
      if (isAxiosError(error) && error.response?.data?.detail?.reconciliation_queued) {
        setReturnLocked(true);
        const results = error.response.data.detail.item_results;
        if (Array.isArray(results)) setReturnResults(results);
      }
      toast.error(getApiErrorMessage(error, copy.failure));
    }
  };

  const returnLoan = () => openReturnDialog('return');
  const reportDamage = () => openReturnDialog('damage');
  const markLost = () => openReturnDialog('lost');
  const dialogCopy = RETURN_DIALOG[returnDialog.mode];

  const canAct = loan && (loan.status === 'BORROWED' || loan.status === 'OVERDUE' || loan.status === 'RESERVED');

  // Which branch lent the books: a read-only lookup, the same list the loans list loads.
  const [branchNames, setBranchNames] = useState<Map<string, string>>(new Map());
  useEffect(() => {
    let active = true;
    warehouseService.getAll()
      .then((rows) => { if (active) setBranchNames(new Map((Array.isArray(rows) ? rows : []).map((w) => [w.id, w.name || w.code]))); })
      .catch(() => undefined);
    return () => { active = false; };
  }, []);

  const day = (value: string | null | undefined) => (value ? new Date(value).toLocaleDateString('vi-VN') : '–');
  const dateTime = (value: string | null | undefined) => (value ? new Date(value).toLocaleString('vi-VN') : '–');
  const items = loan?.loan_items || [];
  const fineTotal = items.reduce((sum, item) => sum + Number(item.fine_amount || 0), 0);
  const depositTotal = items.reduce((sum, item) => sum + Number(item.loan_item_deposits?.amount || 0), 0);
  const overdueDays = loan && loan.status === 'OVERDUE' ? daysOverdue(loan.due_date) : 0;
  const closed = Boolean(loan?.closed_at) || loan?.status === 'RETURNED' || loan?.status === 'RETURNED_LATE';
  const steps = loan ? [
    { label: 'Cho mượn', detail: day(loan.borrow_date), done: true },
    { label: 'Đến hạn trả', detail: day(loan.due_date), done: closed || overdueDays > 0, alert: overdueDays > 0 && !closed },
    { label: 'Đã trả', detail: loan.closed_at ? day(loan.closed_at) : 'Chưa trả', done: closed },
  ] : [];

  return (
    <PageWrapper className="space-y-5">
      <FadeItem>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <Link to="/borrow/loans" className="inline-flex items-center gap-1.5 rounded-md text-[13px] text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
              <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" /> Phiếu mượn
            </Link>
            <h1 className="mt-2 font-mono text-[26px] font-semibold tracking-tight text-foreground sm:text-[30px]">{loan ? loan.loan_number : 'Chi tiết phiếu mượn'}</h1>
            {loan ? (
              <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[14px] text-muted-foreground">
                <span data-testid="loan-status-badge">
                  <StatusBadge label={getBorrowLabel('loan', loan.status)} variant={getStatusVariant('loan', loan.status)} dot />
                </span>
                <span>
                  {loan.customers?.full_name || loan.customer_id}, {loan.total_items} cuốn
                  {overdueDays > 0 ? <span className="font-medium text-red-700 dark:text-red-400">, quá hạn {overdueDays} ngày</span> : null}
                </span>
              </div>
            ) : null}
          </div>
          {loan ? (
            <Button variant="outline" size="sm" className="gap-1.5 self-start" onClick={() => window.print()}>
              <Printer className="h-3.5 w-3.5" /> In phiếu
            </Button>
          ) : null}
        </div>
      </FadeItem>

      {loan ? (
        <LoanReceiptPrintSheet
          loanNumber={loan.loan_number}
          statusLabel={getBorrowLabel('loan', loan.status)}
          customerName={loan.customers?.full_name || loan.customer_id}
          customerCode={loan.customers?.customer_code}
          borrowDate={loan.borrow_date}
          dueDate={loan.due_date}
          totalItems={loan.total_items}
          showFinance
          items={(loan.loan_items || []).map((item) => ({
            title: getBookTitle(item.variant_id),
            code: item.item_barcode || item.id.slice(0, 8),
            dueDate: item.due_date,
            returnDate: item.return_date,
            statusLabel: getBorrowLabel('loan', item.status),
            fineAmount: item.fine_amount,
            depositAmount: item.loan_item_deposits?.amount,
          }))}
        />
      ) : null}

      {loading ? (
        <FadeItem>
          <div className="rounded-2xl border border-border bg-card p-8">
            <LoadingOverlay />
          </div>
        </FadeItem>
      ) : !loan ? (
        <FadeItem>
          <div className="rounded-2xl border border-border bg-card p-8">
            <EmptyState variant="no-data" title="Không tìm thấy phiếu mượn" />
          </div>
        </FadeItem>
      ) : (
        <>
          <FadeItem>
            <ol aria-label="Tiến trình phiếu mượn" className="grid grid-cols-3 divide-x divide-border overflow-hidden rounded-2xl border border-border bg-card">
              {steps.map((step, index) => (
                <li key={step.label} className="flex items-start gap-3 px-4 py-3 sm:px-5" aria-current={!step.done && (index === 0 || steps[index - 1].done) ? 'step' : undefined}>
                  <span className={cn(
                    'mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold tabular-nums',
                    step.alert ? 'bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-400' : step.done ? 'bg-primary text-primary-foreground' : 'border border-border text-muted-foreground',
                  )}>
                    {step.done && !step.alert ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : index + 1}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[13px] font-semibold text-foreground">{step.label}</span>
                    <span className={cn('block text-[12px] tabular-nums', step.alert ? 'font-medium text-red-700 dark:text-red-400' : 'text-muted-foreground')}>{step.detail}</span>
                  </span>
                </li>
              ))}
            </ol>
          </FadeItem>

          <FadeItem>
            <div className="@container/page">
              <div className="grid grid-cols-1 items-start gap-5 @4xl/page:grid-cols-[minmax(0,1fr)_320px]">
                <section aria-labelledby="loan-items-title" className="@container min-w-0 overflow-hidden rounded-2xl border border-border bg-card">
                  <div className="px-5 pb-3 pt-4">
                    <h2 id="loan-items-title" className="font-display text-[18px] font-semibold tracking-tight">Sách trong phiếu</h2>
                    <p className="mt-0.5 text-[13px] text-muted-foreground">{items.length} cuốn, mỗi cuốn có hạn trả, tiền phạt và tiền cọc riêng.</p>
                  </div>
                  <table className="w-full table-fixed border-t border-border">
                    <thead>
                      <tr className="border-b border-border">
                        <th className="px-5 py-2.5 text-left text-[12px] font-normal text-muted-foreground">Sách</th>
                        <th className="hidden w-[150px] px-3 py-2.5 text-left text-[12px] font-normal text-muted-foreground @2xl:table-cell">Hạn trả</th>
                        <th className="hidden w-[150px] px-3 py-2.5 text-right text-[12px] font-normal text-muted-foreground @3xl:table-cell">Phạt, cọc</th>
                        <th className="w-[124px] px-5 py-2.5 text-right text-[12px] font-normal text-muted-foreground">Trạng thái</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((item) => {
                        const dueBlock = (
                          <>
                            <span className="block text-[13px] tabular-nums text-foreground">{day(item.due_date)}</span>
                            <span className="block text-[12px] tabular-nums text-muted-foreground">{item.return_date ? `Trả ${dateTime(item.return_date)}` : 'Chưa trả'}</span>
                          </>
                        );
                        const moneyBlock = (
                          <>
                            <span className="block text-[13px] tabular-nums text-foreground">Phạt {formatVnd(item.fine_amount)}</span>
                            {item.loan_item_deposits ? (
                              <span className="block text-[12px] tabular-nums text-muted-foreground">
                                Cọc {formatVnd(item.loan_item_deposits.amount)}, {getBorrowLabel('deposit', item.loan_item_deposits.status).toLocaleLowerCase('vi')}
                                {Number(item.loan_item_deposits.captured_amount) > 0 ? `, khấu trừ ${formatVnd(item.loan_item_deposits.captured_amount)}` : ''}
                              </span>
                            ) : <span className="block text-[12px] text-muted-foreground">Không giữ cọc</span>}
                          </>
                        );
                        return (
                          <tr key={item.id} className="border-b border-border last:border-0">
                            <td className="px-5 py-3 align-top">
                              <p className="text-[14px] font-medium text-foreground">{getBookTitle(item.variant_id)}</p>
                              <p className="font-mono text-[12px] text-muted-foreground">{item.item_barcode || item.id.slice(0, 8)}</p>
                              {item.notes ? <p className="mt-0.5 text-[12px] text-muted-foreground">Ghi chú: {item.notes}</p> : null}
                              {/* Columns the container hides move here, so no field is dropped. */}
                              <div className="mt-1.5 @2xl:hidden">{dueBlock}</div>
                              <div className="mt-1 @3xl:hidden">{moneyBlock}</div>
                            </td>
                            <td className="hidden px-3 py-3 align-top @2xl:table-cell">{dueBlock}</td>
                            <td className="hidden px-3 py-3 text-right align-top @3xl:table-cell">{moneyBlock}</td>
                            <td className="px-5 py-3 text-right align-top">
                              <StatusBadge label={getBorrowLabel('loan', item.status)} variant={getStatusVariant('loan', item.status)} dot />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </section>

                <aside className="space-y-4 @4xl/page:sticky @4xl/page:top-4">
                  <section aria-labelledby="loan-actions-title" className="rounded-2xl border border-border bg-card p-5">
                    <h2 id="loan-actions-title" className="font-display text-[17px] font-semibold tracking-tight">Việc cần làm</h2>
                    {canAct ? (
                      <>
                        <p className="mt-1 text-[13px] text-muted-foreground">
                          {activeItems.length} cuốn đang mượn. Trả sách sẽ tính tiền phạt trễ hạn và hoàn tiền cọc nếu có.
                        </p>
                        <Button className="mt-3 w-full" onClick={returnLoan} data-testid="return-loan-button">Trả sách</Button>
                        <div className="mt-2 grid grid-cols-2 gap-2">
                          <Button variant="outline" size="sm" onClick={reportDamage}>Báo hư hỏng</Button>
                          <Button variant="outline" size="sm" onClick={markLost} className="text-red-700 hover:text-red-800 dark:text-red-400">Đánh dấu mất</Button>
                        </div>
                      </>
                    ) : (
                      <p className="mt-1 text-[13px] text-muted-foreground">Phiếu đã đóng{loan.closed_at ? ` ngày ${day(loan.closed_at)}` : ''}, không còn thao tác trả sách.</p>
                    )}
                  </section>

                  <section aria-labelledby="loan-facts-title" className="rounded-2xl border border-border bg-card p-5">
                    <h2 id="loan-facts-title" className="font-display text-[17px] font-semibold tracking-tight">Thông tin phiếu</h2>
                    <dl className="mt-3 space-y-2.5 text-[13px]">
                      <div className="flex justify-between gap-4">
                        <dt className="text-muted-foreground">Khách hàng</dt>
                        <dd className="text-right">
                          <span className="block font-medium text-foreground">{loan.customers?.full_name || loan.customer_id}</span>
                          {loan.customers?.customer_code ? <span className="block font-mono text-[12px] text-muted-foreground">{loan.customers.customer_code}</span> : null}
                          {loan.customers?.phone ? <a href={`tel:${loan.customers.phone}`} className="block text-[12px] text-primary hover:underline">{loan.customers.phone}</a> : null}
                        </dd>
                      </div>
                      <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Ngày mượn</dt><dd className="text-right tabular-nums">{dateTime(loan.borrow_date)}</dd></div>
                      <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Hạn trả</dt><dd className="text-right tabular-nums">{dateTime(loan.due_date)}</dd></div>
                      {loan.closed_at ? <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Đóng phiếu</dt><dd className="text-right tabular-nums">{dateTime(loan.closed_at)}</dd></div> : null}
                      {branchNames.get(loan.warehouse_id) ? <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Chi nhánh</dt><dd className="text-right">{branchNames.get(loan.warehouse_id)}</dd></div> : null}
                      <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Nguồn</dt><dd className="text-right">{loan.source_reservation_id ? 'Từ đặt trước' : 'Mượn trực tiếp'}</dd></div>
                      <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Tổng tiền phạt</dt><dd className={cn('text-right tabular-nums', fineTotal > 0 ? 'font-medium text-red-700 dark:text-red-400' : '')}>{formatVnd(fineTotal)}</dd></div>
                      <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Tổng tiền cọc</dt><dd className="text-right tabular-nums">{formatVnd(depositTotal)}</dd></div>
                      {loan.notes ? <div className="border-t border-border pt-2.5"><dt className="text-muted-foreground">Ghi chú</dt><dd className="mt-0.5 whitespace-pre-line text-foreground">{loan.notes}</dd></div> : null}
                    </dl>
                  </section>

                  <AskAiPanel questions={[
                    { label: 'Phí nếu trả trễ', prompt: `Nếu phiếu mượn ${loan.loan_number} trả trễ thì bị phạt bao nhiêu?` },
                    { label: 'Khách còn nợ gì?', prompt: `Khách ${loan.customers?.full_name || loan.customer_id} còn phiếu quá hạn hoặc khoản phạt nào chưa thanh toán?` },
                  ]} />
                </aside>
              </div>
            </div>
          </FadeItem>
        </>
      )}

      <ConfirmDialog
        open={returnDialog.open}
        onOpenChange={(open) => setReturnDialog((s) => ({ ...s, open }))}
        title={dialogCopy.title}
        description={dialogCopy.description}
        variant={dialogCopy.variant}
        onConfirm={confirmReturn}
        confirmLabel={returnLocked ? 'Thử lại lượt trả' : 'Xác nhận'}
      >
        <div className="space-y-3 text-[13px]">
          {returnDialog.mode !== 'return' && activeItems.length > 1 && (
            <label className="block space-y-1">
              <span className="text-muted-foreground">Sách</span>
              <select
                value={returnDialog.itemId}
                onChange={(e) => setReturnDialog((s) => ({ ...s, itemId: e.target.value }))}
                disabled={returnLocked}
                className="h-9 w-full rounded-lg border border-input bg-card px-2 text-[12px] text-foreground"
              >
                {returnDialog.mode === 'damage' && <option value="">Tất cả sách đang mượn</option>}
                {activeItems.map((item) => (
                  <option key={item.id} value={item.id}>
                    {(item.item_barcode || item.id.slice(0, 8))}, {getBookTitle(item.variant_id)}
                  </option>
                ))}
              </select>
            </label>
          )}

          <div className="max-h-[45vh] space-y-3 overflow-y-auto pr-1" aria-label="Tình trạng từng cuốn trả">
            {(returnPayload.items || []).map(row => {
              const item = activeItems.find(item => item.id === row.loan_item_id)!;
              const values = returnRows[item.id] || { condition: 'GOOD', notes: '', reason: '' };
              const update = (patch: Partial<ReturnRow>) => setReturnRows(rows => ({ ...rows, [item.id]: { ...values, ...patch } }));
              const itemPreview = preview?.items.find(value => value.loan_item_id === item.id);
              return <fieldset key={item.id} disabled={returnLocked} className="space-y-2 rounded-lg border border-border p-3" data-testid={`return-item-${item.id}`}>
                <legend className="max-w-full truncate px-1 font-medium">{item.item_barcode || item.id.slice(0, 8)} · {getBookTitle(item.variant_id)}</legend>
                <label className="block space-y-1"><span>Tình trạng trả</span>
                  <select aria-label={`Tình trạng trả ${item.id}`} value={values.condition} onChange={event => update({ condition: event.target.value as ReturnRow['condition'] })} className="h-9 w-full rounded-lg border border-input bg-card px-2">
                    <option value="GOOD">Bình thường</option><option value="DAMAGED">Hư hỏng</option><option value="LOST">Mất sách</option>
                  </select>
                </label>
                <label className="block space-y-1"><span>Ghi chú</span><textarea aria-label={`Ghi chú trả ${item.id}`} value={values.notes} onChange={event => update({ notes: event.target.value })} maxLength={2000} rows={1} className="w-full rounded-lg border border-input bg-card px-2 py-1" /></label>
                {values.condition !== 'GOOD' && <label className="block space-y-1"><span>Lý do xử lý cọc{itemPreview?.requires_reason ? ' (bắt buộc)' : ''}</span>
                  <textarea aria-label={`Lý do xử lý ${item.id}`} value={values.reason} onChange={event => update({ reason: event.target.value })} maxLength={2000} rows={1} className="w-full rounded-lg border border-input bg-card px-2 py-1" />
                </label>}
                {itemPreview && <p className="text-[12px] text-muted-foreground">Phạt {formatVnd(itemPreview.penalty)} · Hoàn cọc {formatVnd(itemPreview.deposit_refunded)} · Còn phải trả {formatVnd(itemPreview.additional_due)}</p>}
              </fieldset>;
            })}
          </div>
          {previewError && <p role="alert" className="text-red-700">{previewError}</p>}
          {returnLocked && <p role="alert">Một số cuốn cần đối soát. Thử lại giữ nguyên nội dung và mã yêu cầu; không tạo lượt trả mới.</p>}
          {returnResults.length > 0 && <ul aria-label="Kết quả từng cuốn" className="space-y-1 text-[12px]">{returnResults.map(item => <li key={item.loan_item_id}>{item.loan_item_id.slice(0, 8)}: {{ RETURNED: 'Đã trả', LOST: 'Đã ghi nhận mất', RECONCILIATION_REQUIRED: 'Đã đổi tồn kho, chờ đối soát', UNKNOWN: 'Chưa xác nhận, chờ đối soát', NOT_PROCESSED: 'Chưa xử lý' }[item.status]}</li>)}</ul>}

          {previewLoading ? (
            <p className="text-muted-foreground">Đang tính tiền cọc và tiền phạt…</p>
          ) : preview && (preview.totals.deposit_amount > 0 || preview.totals.penalty > 0) ? (
            <dl className="grid grid-cols-2 gap-x-3 gap-y-1 rounded-lg border border-border bg-muted/40 p-3">
              <dt className="text-muted-foreground">Tiền cọc đang giữ</dt>
              <dd className="text-right tabular-nums">{formatVnd(preview.totals.deposit_amount)}</dd>
              <dt className="text-muted-foreground">Tiền phạt dự kiến</dt>
              <dd className="text-right tabular-nums">{formatVnd(preview.totals.penalty)}</dd>
              <dt className="text-muted-foreground">Khấu trừ từ cọc</dt>
              <dd className="text-right tabular-nums">{formatVnd(preview.totals.deposit_captured)}</dd>
              <dt className="text-muted-foreground">Hoàn về ví khách</dt>
              <dd className="text-right tabular-nums font-medium text-foreground">{formatVnd(preview.totals.deposit_refunded)}</dd>
              {preview.totals.additional_due > 0 && (
                <>
                  <dt className="text-muted-foreground">Khách còn phải trả</dt>
                  <dd className="text-right tabular-nums font-medium text-red-700 dark:text-red-400">{formatVnd(preview.totals.additional_due)}</dd>
                </>
              )}
            </dl>
          ) : null}

        </div>
      </ConfirmDialog>
    </PageWrapper>
  );
}
