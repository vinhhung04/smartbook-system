import { useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { CircleAlert, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { SectionCard, FilterBar, EmptyState } from '@/components/ui';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import { SkeletonTableRow } from '@/components/ui/loading-state';
import { StatusBadge } from '@/components/status-badge';
import { borrowService, type Fine } from '@/services/borrow';
import { getApiErrorMessage } from '@/services/api';

const STATUS_LABELS: Record<string, string> = {
  ALL: 'Tất cả',
  UNPAID: 'Chưa trả',
  PARTIALLY_PAID: 'Trả một phần',
  PAID: 'Đã trả',
  WAIVED: 'Đã miễn',
};

function getStatusVariant(status: string) {
  if (status === 'PAID') return 'success';
  if (status === 'WAIVED') return 'neutral';
  if (status === 'UNPAID') return 'danger';
  return 'warning';
}

export function BorrowFinesPage() {
  const [fines, setFines] = useState<Fine[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'UNPAID' | 'PARTIALLY_PAID' | 'PAID' | 'WAIVED'>('ALL');

  const loadFines = async () => {
    try {
      setLoading(true);
      const response = await borrowService.getFines();
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

  const viewDetail = async (id: string) => {
    try {
      const detail = await borrowService.getFineById(id);
      const remaining = Number(detail.data.summary?.remaining_balance || 0).toLocaleString('vi-VN');
      toast.message(`Phạt ${id}`, {
        description: `Loại: ${detail.data.fine_type} | Còn lại: ${remaining} VND | Trạng thái: ${detail.data.status}`,
      });
    } catch (error) {
      toast.error(getApiErrorMessage(error, 'Không tải được chi tiết tiền phạt'));
    }
  };

  const recordPayment = async (fine: Fine) => {
    const remaining = Number(fine.summary?.remaining_balance || 0);
    if (remaining <= 0) {
      toast.error('Không còn số dư để thanh toán');
      return;
    }

    const raw = window.prompt(`Nhập số tiền thanh toán (còn lại ${remaining.toLocaleString('vi-VN')} VND):`, String(remaining));
    if (!raw) return;
    const amount = Number(raw);
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error('Số tiền thanh toán phải là số dương');
      return;
    }

    try {
      await borrowService.recordFinePayment(fine.id, {
        amount,
        payment_method: 'CASH',
      });
      toast.success('Đã ghi nhận thanh toán tiền phạt');
      await loadFines();
    } catch (error) {
      toast.error(getApiErrorMessage(error, 'Ghi nhận thanh toán thất bại'));
    }
  };

  const waiveFine = async (fine: Fine) => {
    const remaining = Number(fine.summary?.remaining_balance || 0);
    if (remaining <= 0) {
      toast.error('Không còn số dư để miễn giảm');
      return;
    }

    const raw = window.prompt(`Nhập số tiền miễn giảm (còn lại ${remaining.toLocaleString('vi-VN')} VND):`, String(remaining));
    if (!raw) return;
    const amount = Number(raw);
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error('Số tiền miễn giảm phải là số dương');
      return;
    }

    const note = window.prompt('Lý do miễn giảm (không bắt buộc):', '') || undefined;

    try {
      await borrowService.waiveFine(fine.id, { amount, note });
      toast.success('Đã miễn giảm tiền phạt');
      await loadFines();
    } catch (error) {
      toast.error(getApiErrorMessage(error, 'Miễn giảm tiền phạt thất bại'));
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
                ) : filtered.length === 0 ? (
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
                  filtered.map((fine, index) => (
                    <motion.tr
                      key={fine.id}
                      initial={{ opacity: 0, y: 5 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.15, delay: index * 0.02 }}
                      className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors"
                    >
                      <td className="px-5 py-3.5 text-sm font-medium text-muted-foreground">{fine.id.slice(0, 8)}</td>
                      <td className="px-5 py-3.5 text-sm">{fine.customers?.full_name || fine.customer_id}</td>
                      <td className="px-5 py-3.5 text-sm text-muted-foreground">{fine.fine_type}</td>
                      <td className="px-5 py-3.5 text-sm text-muted-foreground">{Number(fine.amount || 0).toLocaleString('vi-VN')} VND</td>
                      <td className="px-5 py-3.5 text-sm text-muted-foreground">{Number(fine.summary?.remaining_balance || 0).toLocaleString('vi-VN')} VND</td>
                      <td className="px-5 py-3.5">
                        <StatusBadge label={fine.status} variant={getStatusVariant(fine.status)} dot />
                      </td>
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => void viewDetail(fine.id)}
                          >
                            Chi tiết
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="border-emerald-200 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-500/20 dark:text-emerald-400 dark:hover:bg-emerald-500/10"
                            onClick={() => void recordPayment(fine)}
                            disabled={Number(fine.summary?.remaining_balance || 0) <= 0}
                          >
                            Thanh toán
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="border-amber-200 text-amber-700 hover:bg-amber-50 dark:border-amber-500/20 dark:text-amber-400 dark:hover:bg-amber-500/10"
                            onClick={() => void waiveFine(fine)}
                            disabled={Number(fine.summary?.remaining_balance || 0) <= 0}
                          >
                            Miễn giảm
                          </Button>
                        </div>
                      </td>
                    </motion.tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </SectionCard>
      </motion.div>
    </div>
  );
}
