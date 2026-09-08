import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { ArrowLeft, BookOpen, Printer } from 'lucide-react';
import { toast } from 'sonner';
import { PageWrapper, FadeItem } from '../motion-utils';
import { StatusBadge } from '../status-badge';
import { PageHeader } from '@/components/ui/page-header';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { getStatusVariant } from '@/lib/status-registry';
import { borrowService, type Loan } from '@/services/borrow';
import { bookService } from '@/services/book';
import { getApiErrorMessage } from '@/services/api';
import { printLoanReceipt } from '@/lib/print-utils';
import { LoadingOverlay } from '@/components/ui/loading-state';
import { EmptyState } from '@/components/ui/empty-state';

function daysOverdue(dueDate: string): number {
  const diffMs = Date.now() - new Date(dueDate).getTime();
  return Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
}

export function BorrowLoanDetailPage() {
  const { id } = useParams();
  const [loan, setLoan] = useState<Loan | null>(null);
  const [books, setBooks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirmState, setConfirmState] = useState<{
    open: boolean;
    title: string;
    description?: string;
    variant: 'default' | 'destructive';
    onConfirm: () => Promise<void>;
  }>({ open: false, title: '', variant: 'default', onConfirm: async () => {} });

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

  const openConfirm = (title: string, description: string, variant: 'default' | 'destructive', action: () => Promise<void>) => {
    setConfirmState({ open: true, title, description, variant, onConfirm: action });
  };

  const returnLoan = () => {
    if (!loan) return;
    openConfirm(
      'Xác nhận trả sách',
      'Trả tất cả sách đang mượn trong phiếu này? Hành động này không thể hoàn tác.',
      'default',
      async () => {
        try {
          await borrowService.returnLoan(loan.id, {});
          toast.success('Đã trả sách thành công');
          setConfirmState((s) => ({ ...s, open: false }));
          await load();
        } catch (error) {
          toast.error(getApiErrorMessage(error, 'Trả sách thất bại'));
        }
      },
    );
  };

  const reportDamage = () => {
    if (!loan) return;
    openConfirm(
      'Báo hư hỏng sách',
      'Đánh dấu sách trả bị hư hỏng và tạo tiền phạt?',
      'destructive',
      async () => {
        try {
          await borrowService.returnLoan(loan.id, { item_condition_on_return: 'DAMAGED' });
          toast.success('Đã xử lý trả sách hư hỏng');
          setConfirmState((s) => ({ ...s, open: false }));
          await load();
        } catch (error) {
          toast.error(getApiErrorMessage(error, 'Báo hư hỏng thất bại'));
        }
      },
    );
  };

  const markLost = () => {
    if (!loan) return;
    openConfirm(
      'Đánh dấu mất sách',
      'Đánh dấu một sách đang mượn là mất và tạo tiền phạt?',
      'destructive',
      async () => {
        try {
          const activeItem = (loan.loan_items || []).find((item) => item.status === 'BORROWED' || item.status === 'OVERDUE');
          if (!activeItem) {
            toast.error('Không tìm thấy sách đang mượn để đánh dấu mất');
            return;
          }
          await borrowService.returnLoan(loan.id, { loan_item_id: activeItem.id, mark_lost: true, item_condition_on_return: 'LOST' });
          toast.success('Đã xử lý sách mất');
          setConfirmState((s) => ({ ...s, open: false }));
          await load();
        } catch (error) {
          toast.error(getApiErrorMessage(error, 'Đánh dấu mất thất bại'));
        }
      },
    );
  };

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
                  onClick={() => printLoanReceipt({ ...loan, customer_name: loan.customers?.full_name })}
                >
                  <Printer className="h-3.5 w-3.5" /> In phiếu
                </Button>
              )}
            </>
          }
        />
      </FadeItem>

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
                <StatusBadge label={loan.status} variant={getStatusVariant('loan', loan.status)} dot />
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
                <Button size="sm" variant="success-outline" onClick={returnLoan}>Trả sách</Button>
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
                    {['Mã vạch sách', 'Sách', 'Hạn trả', 'Ngày trả', 'Trạng thái', 'Tiền phạt'].map((header) => (
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
                        <StatusBadge label={item.status} variant={getStatusVariant('loan', item.status)} dot />
                      </td>
                      <td className="px-4 py-3 font-mono text-[12px] tabular-nums text-foreground">
                        {Number(item.fine_amount || 0).toLocaleString('vi-VN')} VND
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
        open={confirmState.open}
        onOpenChange={(open) => setConfirmState((s) => ({ ...s, open }))}
        title={confirmState.title}
        description={confirmState.description}
        variant={confirmState.variant}
        onConfirm={confirmState.onConfirm}
      />
    </PageWrapper>
  );
}
