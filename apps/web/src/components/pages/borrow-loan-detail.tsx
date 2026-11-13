import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { ArrowLeft, BookOpen, Printer } from 'lucide-react';
import { toast } from 'sonner';
import { PageWrapper, FadeItem } from '../motion-utils';
import { StatusBadge } from '../status-badge';
import { PageHeader } from '@/components/ui/page-header';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { getBorrowLabel, getStatusVariant } from '@/lib/status-registry';
import { borrowService, type Loan, type ReturnPreview } from '@/services/borrow';
import { bookService } from '@/services/book';
import { getApiErrorMessage } from '@/services/api';
import { LoanReceiptPrintSheet } from './loan-receipt-print-sheet';
import { LoadingOverlay } from '@/components/ui/loading-state';
import { EmptyState } from '@/components/ui/empty-state';

function daysOverdue(dueDate: string): number {
  const diffMs = Date.now() - new Date(dueDate).getTime();
  return Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
}

const formatVnd = (value: number | string | null | undefined) => `${Number(value || 0).toLocaleString('vi-VN')} VND`;

type ReturnMode = 'return' | 'damage' | 'lost';

const RETURN_DIALOG: Record<ReturnMode, { title: string; description: string; variant: 'default' | 'destructive'; success: string; failure: string }> = {
  return: {
    title: 'Xác nhận trả sách',
    description: 'Trả tất cả sách đang mượn trong phiếu này? Hành động này không thể hoàn tác.',
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
  };

  // Deposit/fine preview for the current dialog inputs, so staff see what will be
  // refunded or still owed before they confirm.
  useEffect(() => {
    if (!loan || !returnDialog.open) return;
    let cancelled = false;
    setPreviewLoading(true);
    setPreview(null);
    borrowService
      .previewReturn(loan.id, {
        ...(returnDialog.itemId ? { loan_item_id: returnDialog.itemId } : {}),
        item_condition_on_return: returnDialog.mode === 'damage' ? 'DAMAGED' : returnDialog.mode === 'lost' ? 'LOST' : 'GOOD',
        ...(returnDialog.mode === 'lost' ? { mark_lost: true } : {}),
      })
      .then((response) => { if (!cancelled) setPreview(response.data); })
      .catch(() => { if (!cancelled) setPreview(null); })
      .finally(() => { if (!cancelled) setPreviewLoading(false); });
    return () => { cancelled = true; };
  }, [loan, returnDialog.open, returnDialog.mode, returnDialog.itemId]);

  const confirmReturn = async () => {
    if (!loan) return;
    const { mode, itemId, reason } = returnDialog;
    const copy = RETURN_DIALOG[mode];
    if (preview?.requires_reason && !reason.trim()) {
      toast.error('Nhập lý do khấu trừ tiền cọc trước khi xác nhận');
      return;
    }
    const payload = {
      ...(itemId ? { loan_item_id: itemId } : {}),
      ...(mode === 'damage' ? { item_condition_on_return: 'DAMAGED' } : {}),
      ...(mode === 'lost' ? { mark_lost: true, item_condition_on_return: 'LOST' } : {}),
      ...(reason.trim() ? { settlement_reason: reason.trim() } : {}),
    };
    try {
      await borrowService.returnLoan(loan.id, payload);
      toast.success(copy.success);
      setReturnDialog((s) => ({ ...s, open: false }));
      await load();
    } catch (error) {
      toast.error(getApiErrorMessage(error, copy.failure));
    }
  };

  const returnLoan = () => openReturnDialog('return');
  const reportDamage = () => openReturnDialog('damage');
  const markLost = () => openReturnDialog('lost');
  const dialogCopy = RETURN_DIALOG[returnDialog.mode];

  const canAct = loan && (loan.status === 'BORROWED' || loan.status === 'OVERDUE' || loan.status === 'RESERVED');

  return (
    <PageWrapper className="space-y-5">
      <FadeItem>
        <PageHeader
          icon={BookOpen}
          title={loan ? `Phiếu mượn ${loan.loan_number}` : 'Chi tiết phiếu mượn'}
          description="Xem chi tiết từng sách và trạng thái của phiếu mượn."
          iconBg="bg-gradient-to-br from-blue-100 to-indigo-50 border border-blue-200/40 shadow-sm dark:from-blue-500/15 dark:to-indigo-500/10 dark:border-blue-500/20"
          iconColor="text-blue-600 dark:text-blue-400"
          actions={
            <>
              <Link
                to="/borrow/loans"
                className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3.5 py-2 text-[13px] font-medium text-muted-foreground hover:bg-muted"
              >
                <ArrowLeft className="h-3.5 w-3.5" /> Quay lại danh sách
              </Link>
              {loan && (
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  onClick={() => window.print()}
                >
                  <Printer className="h-3.5 w-3.5" /> In phiếu
                </Button>
              )}
            </>
          }
        />
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
          <div className="bg-card border border-border rounded-[14px] p-8">
            <LoadingOverlay />
          </div>
        </FadeItem>
      ) : !loan ? (
        <FadeItem>
          <div className="bg-card border border-border rounded-[14px] p-8">
            <EmptyState variant="no-data" title="Không tìm thấy phiếu mượn" />
          </div>
        </FadeItem>
      ) : (
        <>
          <FadeItem>
            <div className="bg-card border border-border rounded-[14px] p-4 grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <p className="text-[11px] text-muted-foreground">Mã phiếu mượn</p>
                <p className="font-mono text-[14px] font-semibold text-foreground">{loan.loan_number}</p>
              </div>
              <div>
                <p className="text-[11px] text-muted-foreground">Khách hàng</p>
                <p className="text-[14px] font-semibold text-foreground">{loan.customers?.full_name || loan.customer_id}</p>
                {loan.customers?.customer_code ? (
                  <p className="font-mono text-[11px] text-muted-foreground">{loan.customers.customer_code}</p>
                ) : null}
              </div>
              <div>
                <p className="text-[11px] text-muted-foreground">Trạng thái</p>
                <div data-testid="loan-status-badge">
                  <StatusBadge label={getBorrowLabel('loan', loan.status)} variant={getStatusVariant('loan', loan.status)} dot />
                </div>
              </div>
              <div>
                <p className="text-[11px] text-muted-foreground">Ngày mượn</p>
                <p className="text-[13px] text-foreground">{new Date(loan.borrow_date).toLocaleString('vi-VN')}</p>
              </div>
              <div>
                <p className="text-[11px] text-muted-foreground">Hạn trả</p>
                <p className="text-[13px] text-foreground">{new Date(loan.due_date).toLocaleString('vi-VN')}</p>
                {loan.status === 'OVERDUE' && daysOverdue(loan.due_date) > 0 && (
                  <p className="font-mono text-[11px] font-semibold text-rose-600 dark:text-rose-400">
                    Quá hạn {daysOverdue(loan.due_date)} ngày
                  </p>
                )}
              </div>
              <div>
                <p className="text-[11px] text-muted-foreground">Số sách</p>
                <p className="text-[13px] text-foreground">{loan.total_items}</p>
              </div>
            </div>
          </FadeItem>

          {canAct && (
            <FadeItem>
              <div className="flex flex-wrap items-center gap-2 rounded-[14px] border border-border bg-card p-3">
                <span className="mr-1 text-[12px] text-muted-foreground">Thao tác trên phiếu này:</span>
                <Button size="sm" variant="success-outline" onClick={returnLoan} data-testid="return-loan-button">Trả sách</Button>
                <Button size="sm" variant="warning-outline" onClick={reportDamage}>Báo hư hỏng</Button>
                <Button size="sm" variant="danger-outline" onClick={markLost}>Đánh dấu mất</Button>
              </div>
            </FadeItem>
          )}

          <FadeItem>
            <div className="bg-card border border-border rounded-[14px] overflow-hidden">
              <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border bg-muted/80">
                    {['Mã vạch sách', 'Sách', 'Hạn trả', 'Ngày trả', 'Trạng thái', 'Tiền phạt', 'Tiền cọc'].map((header) => (
                      <th key={header} className="text-left text-[11px] text-muted-foreground px-4 py-3 uppercase tracking-[0.05em]" style={{ fontWeight: 550 }}>
                        {header}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(loan.loan_items || []).map((item) => (
                    <tr key={item.id} className="border-b border-border/50 last:border-0">
                      <td className="px-4 py-3 font-mono text-[12px] text-foreground">{item.item_barcode || item.id.slice(0, 8)}</td>
                      <td className="px-4 py-3 text-[12px] text-foreground">{getBookTitle(item.variant_id)}</td>
                      <td className="px-4 py-3 text-[12px] text-muted-foreground">{new Date(item.due_date).toLocaleString('vi-VN')}</td>
                      <td className="px-4 py-3 text-[12px] text-muted-foreground">{item.return_date ? new Date(item.return_date).toLocaleString('vi-VN') : '-'}</td>
                      <td className="px-4 py-3">
                        <StatusBadge label={getBorrowLabel('loan', item.status)} variant={getStatusVariant('loan', item.status)} dot />
                      </td>
                      <td className="px-4 py-3 font-mono text-[12px] tabular-nums text-foreground">
                        {Number(item.fine_amount || 0).toLocaleString('vi-VN')} VND
                      </td>
                      <td className="px-4 py-3">
                        {item.loan_item_deposits ? (
                          <div className="space-y-1">
                            <p className="font-mono text-[12px] tabular-nums text-foreground">{formatVnd(item.loan_item_deposits.amount)}</p>
                            <StatusBadge
                              label={getBorrowLabel('deposit', item.loan_item_deposits.status)}
                              variant={getStatusVariant('deposit', item.loan_item_deposits.status)}
                            />
                            {Number(item.loan_item_deposits.captured_amount) > 0 && (
                              <p className="font-mono text-[11px] text-muted-foreground">Khấu trừ {formatVnd(item.loan_item_deposits.captured_amount)}</p>
                            )}
                          </div>
                        ) : (
                          <span className="text-[12px] text-muted-foreground">-</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
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
      >
        <div className="space-y-3 text-[12px]">
          {returnDialog.mode !== 'return' && activeItems.length > 1 && (
            <label className="block space-y-1">
              <span className="text-muted-foreground">Sách</span>
              <select
                value={returnDialog.itemId}
                onChange={(e) => setReturnDialog((s) => ({ ...s, itemId: e.target.value }))}
                className="h-9 w-full rounded-lg border border-input bg-card px-2 text-[12px] text-foreground"
              >
                {returnDialog.mode === 'damage' && <option value="">Tất cả sách đang mượn</option>}
                {activeItems.map((item) => (
                  <option key={item.id} value={item.id}>
                    {(item.item_barcode || item.id.slice(0, 8))} — {getBookTitle(item.variant_id)}
                  </option>
                ))}
              </select>
            </label>
          )}

          {previewLoading ? (
            <p className="text-muted-foreground">Đang tính tiền cọc và tiền phạt…</p>
          ) : preview && preview.totals.deposit_amount > 0 ? (
            <dl className="grid grid-cols-2 gap-x-3 gap-y-1 rounded-lg border border-border bg-muted/40 p-3">
              <dt className="text-muted-foreground">Tiền cọc đang giữ</dt>
              <dd className="text-right font-mono tabular-nums">{formatVnd(preview.totals.deposit_amount)}</dd>
              <dt className="text-muted-foreground">Tiền phạt dự kiến</dt>
              <dd className="text-right font-mono tabular-nums">{formatVnd(preview.totals.penalty)}</dd>
              <dt className="text-muted-foreground">Khấu trừ từ cọc</dt>
              <dd className="text-right font-mono tabular-nums">{formatVnd(preview.totals.deposit_captured)}</dd>
              <dt className="text-muted-foreground">Hoàn về ví khách</dt>
              <dd className="text-right font-mono tabular-nums text-emerald-600 dark:text-emerald-400">{formatVnd(preview.totals.deposit_refunded)}</dd>
              {preview.totals.additional_due > 0 && (
                <>
                  <dt className="text-muted-foreground">Khách còn phải trả</dt>
                  <dd className="text-right font-mono tabular-nums text-rose-600 dark:text-rose-400">{formatVnd(preview.totals.additional_due)}</dd>
                </>
              )}
            </dl>
          ) : null}

          {preview?.requires_reason && (
            <label className="block space-y-1">
              <span className="text-muted-foreground">Lý do khấu trừ tiền cọc (bắt buộc)</span>
              <textarea
                value={returnDialog.reason}
                onChange={(e) => setReturnDialog((s) => ({ ...s, reason: e.target.value }))}
                rows={2}
                maxLength={1000}
                placeholder="Mô tả tình trạng sách"
                className="w-full rounded-lg border border-input bg-card px-2 py-1.5 text-[12px] text-foreground"
              />
            </label>
          )}
        </div>
      </ConfirmDialog>
    </PageWrapper>
  );
}
