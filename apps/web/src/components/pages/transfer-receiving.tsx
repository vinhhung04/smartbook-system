import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, CheckCircle2, PackageCheck, UserCheck } from 'lucide-react';
import { toast } from 'sonner';
import { NavLink } from 'react-router';
import { FadeItem, PageWrapper } from '../motion-utils';
import { getApiErrorMessage } from '@/services/api.ts';
import { authService } from '@/services/auth';
import { warehouseService, type Warehouse } from '@/services/warehouse';
import { transferReceivingService, type TransferReceivingItem } from '@/services/transfer-receiving';
import { userService, type WarehouseStaffOption } from '@/services/user';
import { canManageReceiving } from '@/lib/rbac';
import { PageHeader } from '@/components/ui/page-header';
import { LoadingOverlay } from '@/components/ui/loading-state';
import { EmptyState } from '@/components/ui/empty-state';
import { StatusBadge } from '@/components/status-badge';

export function TransferReceivingPage() {
  const [loading, setLoading] = useState(true);
  const [confirming, setConfirming] = useState('');

  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [selectedWarehouseId, setSelectedWarehouseId] = useState('');
  const [query, setQuery] = useState('');
  const [queue, setQueue] = useState<TransferReceivingItem[]>([]);

  const [warehouseStaff, setWarehouseStaff] = useState<WarehouseStaffOption[]>([]);
  const [assigningStaffById, setAssigningStaffById] = useState<Record<string, string>>({});
  const [assigningId, setAssigningId] = useState('');

  const currentUser = authService.getCurrentUser();
  const canManageQueue = canManageReceiving(currentUser);

  const filteredQueue = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return queue;
    return queue.filter((item) =>
      item.transfer_number.toLowerCase().includes(keyword)
      || String(item.from_warehouse_code || '').toLowerCase().includes(keyword)
      || String(item.to_warehouse_code || '').toLowerCase().includes(keyword)
    );
  }, [queue, query]);

  const loadQueue = async (warehouseId?: string) => {
    const response = await transferReceivingService.getQueue(warehouseId);
    setQueue(response.data || []);
  };

  useEffect(() => {
    const run = async () => {
      try {
        setLoading(true);
        const [warehouseRows, staffRows] = await Promise.all([
          canManageQueue ? warehouseService.getAll() : Promise.resolve([]),
          canManageQueue ? userService.getWarehouseStaff() : Promise.resolve({ data: [] }),
        ]);

        const list = Array.isArray(warehouseRows) ? warehouseRows : [];
        setWarehouses(list);
        setWarehouseStaff(Array.isArray(staffRows?.data) ? staffRows.data : []);

        const preferredWarehouseId = list[0]?.id || '';
        setSelectedWarehouseId(preferredWarehouseId);
        await loadQueue(canManageQueue ? (preferredWarehouseId || undefined) : undefined);
      } catch (error) {
        toast.error(getApiErrorMessage(error, 'Không tải được hàng đợi nhận hàng chuyển kho'));
      } finally {
        setLoading(false);
      }
    };

    void run();
  }, [canManageQueue]);

  useEffect(() => {
    if (!canManageQueue) return;
    if (!selectedWarehouseId) {
      setQueue([]);
      return;
    }
    void loadQueue(selectedWarehouseId).catch((error) => {
      toast.error(getApiErrorMessage(error, 'Không tải được hàng đợi theo kho'));
    });
  }, [canManageQueue, selectedWarehouseId]);

  const handleAssign = async (item: TransferReceivingItem) => {
    const staffId = assigningStaffById[item.id];
    if (!staffId) {
      toast.error('Chọn nhân viên trước khi giao task');
      return;
    }
    try {
      setAssigningId(item.id);
      await transferReceivingService.assignReceiving(item.id, staffId);
      await loadQueue(canManageQueue ? (selectedWarehouseId || undefined) : undefined);
      setAssigningStaffById((prev) => ({ ...prev, [item.id]: '' }));
      toast.success(`Đã giao task nhận hàng ${item.transfer_number}`);
    } catch (error) {
      toast.error(getApiErrorMessage(error, 'Giao task nhận hàng thất bại'));
    } finally {
      setAssigningId('');
    }
  };

  const handleConfirmReceiving = async (item: TransferReceivingItem) => {
    try {
      setConfirming(item.id);
      const result = await transferReceivingService.confirmReceiving(item.id);
      toast.success(
        `Đã nhận hàng từ chuyển kho ${item.transfer_number}. Phiếu nhập: ${result.data.goods_receipt_number}`
      );
      await loadQueue(canManageQueue ? (selectedWarehouseId || undefined) : undefined);
    } catch (error) {
      toast.error(getApiErrorMessage(error, 'Xác nhận nhận hàng thất bại'));
    } finally {
      setConfirming('');
    }
  };

  const getAssignedStaffName = (userId: string | null) => {
    if (!userId) return null;
    const staff = warehouseStaff.find((s) => s.id === userId);
    return staff ? (staff.full_name || staff.username) : userId.slice(0, 8) + '...';
  };

  if (loading) {
    return (
      <PageWrapper>
        <LoadingOverlay />
      </PageWrapper>
    );
  }

  const tableHeads = canManageQueue
    ? ['Mã chuyển kho', 'Kho xuất', 'Kho nhận', 'Trạng thái', 'Tổng SL', 'Xuất lúc', 'Nhân viên nhận hàng', 'Thao tác']
    : ['Mã chuyển kho', 'Kho xuất', 'Kho nhận', 'Trạng thái', 'Tổng SL', 'Xuất lúc', 'Thao tác'];

  return (
    <PageWrapper className="space-y-6">
      <FadeItem>
        <NavLink
          to="/my-warehouse-tasks"
          className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-muted-foreground transition-colors hover:text-blue-600 dark:hover:text-blue-400"
        >
          <ArrowRight className="h-3.5 w-3.5 rotate-180" /> Quay lại task kho
        </NavLink>
      </FadeItem>

      <FadeItem>
        <PageHeader
          icon={PackageCheck}
          title="Nhận hàng chuyển kho"
          description={
            canManageQueue
              ? 'Giao task và xác nhận nhận hàng từ chuyển kho (đang IN_TRANSIT)'
              : 'Xác nhận nhận hàng cho task được giao'
          }
          iconBg="bg-amber-100 dark:bg-amber-500/15"
          iconColor="text-amber-600 dark:text-amber-400"
        />
      </FadeItem>

      <FadeItem>
        <div className="rounded-xl border border-amber-200/60 dark:border-amber-500/20 bg-amber-50/50 dark:bg-amber-500/10 p-4">
          <div className="flex items-center gap-2.5">
            <PackageCheck className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
            <p className="text-[12px] text-amber-800 dark:text-amber-300">
              Các chuyển kho xuất hiện ở đây khi đã được xác nhận xuất kho tại kho nguồn (trạng thái IN_TRANSIT).
              Sau khi nhân viên xác nhận nhận hàng, hệ thống sẽ tự tạo Phiếu nhập tại kho đích và đưa hàng vào khu nhận.
            </p>
          </div>
        </div>
      </FadeItem>

      <FadeItem>
        <div className="rounded-xl border border-border bg-card p-5 shadow-[0_1px_3px_rgba(0,0,0,0.04)] dark:shadow-none">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {canManageQueue ? (
              <div>
                <p className="text-[11px] text-muted-foreground mb-1.5 font-semibold">Kho đích</p>
                <select
                  value={selectedWarehouseId}
                  onChange={(e) => setSelectedWarehouseId(e.target.value)}
                  className="w-full rounded-[10px] border border-border bg-background px-3 py-2.5 text-[13px]"
                >
                  <option value="">Chọn kho</option>
                  {warehouses.map((w) => (
                    <option key={w.id} value={w.id}>{w.code} - {w.name}</option>
                  ))}
                </select>
              </div>
            ) : null}
            <div className={canManageQueue ? 'md:col-span-2' : 'md:col-span-3'}>
              <p className="text-[11px] text-muted-foreground mb-1.5 font-semibold">Tìm chuyển kho</p>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Mã chuyển kho / kho"
                className="w-full rounded-[10px] border border-border bg-background px-3 py-2.5 text-[13px]"
              />
            </div>
          </div>
        </div>
      </FadeItem>

      <FadeItem>
        <div className="overflow-hidden rounded-xl border border-border bg-card shadow-[0_1px_3px_rgba(0,0,0,0.04)] dark:shadow-none">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border bg-gradient-to-r from-amber-50/30 to-transparent dark:from-amber-500/10">
                  {tableHeads.map((head) => (
                    <th key={head} className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">
                      {head}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredQueue.length === 0 ? (
                  <tr>
                    <td colSpan={tableHeads.length} className="py-10">
                      <EmptyState variant="no-data" title="Không có chuyển kho nào đang chờ nhận hàng" />
                    </td>
                  </tr>
                ) : filteredQueue.map((item) => {
                  const assignedName = getAssignedStaffName(item.received_by_user_id);
                  const selectedStaffId = assigningStaffById[item.id] || '';
                  const isAssigning = assigningId === item.id;
                  const isConfirming = confirming === item.id;

                  return (
                    <tr key={item.id} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
                      <td className="px-4 py-3 text-[12px] font-semibold">{item.transfer_number}</td>
                      <td className="px-4 py-3 text-[12px] text-muted-foreground">{item.from_warehouse_code || '-'}</td>
                      <td className="px-4 py-3 text-[12px] text-muted-foreground">{item.to_warehouse_code || '-'}</td>
                      <td className="px-4 py-3">
                        <StatusBadge label={item.status} variant="warning" />
                      </td>
                      <td className="px-4 py-3 text-[12px] text-muted-foreground">{item.total_quantity}</td>
                      <td className="px-4 py-3 text-[12px] text-muted-foreground">
                        {item.shipped_at ? new Date(item.shipped_at).toLocaleDateString('vi-VN') : '-'}
                      </td>
                      {canManageQueue ? (
                        <td className="px-4 py-3">
                          {assignedName && !selectedStaffId ? (
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 dark:bg-emerald-500/10 px-2 py-0.5 text-[11px] text-emerald-700 dark:text-emerald-400 font-semibold">
                                <UserCheck className="w-3 h-3" /> {assignedName}
                              </span>
                              <button
                                onClick={() => setAssigningStaffById((prev) => ({ ...prev, [item.id]: 'PICK' }))}
                                className="text-[10px] text-muted-foreground hover:text-foreground underline"
                              >
                                Đổi
                              </button>
                            </div>
                          ) : (
                            <div className="flex items-center gap-2">
                              <select
                                value={selectedStaffId === 'PICK' ? '' : selectedStaffId}
                                onChange={(e) => setAssigningStaffById((prev) => ({ ...prev, [item.id]: e.target.value }))}
                                className="h-8 min-w-[140px] rounded-[8px] border border-border bg-background px-2 text-[11px] text-foreground"
                              >
                                <option value="">Chọn nhân viên</option>
                                {warehouseStaff.map((staff) => (
                                  <option key={staff.id} value={staff.id}>
                                    {staff.full_name || staff.username}
                                  </option>
                                ))}
                              </select>
                              <button
                                onClick={() => void handleAssign(item)}
                                disabled={isAssigning || !selectedStaffId || selectedStaffId === 'PICK'}
                                className="h-8 rounded-[8px] bg-blue-600 px-3 text-[11px] font-semibold text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
                              >
                                {isAssigning ? '...' : 'Giao'}
                              </button>
                            </div>
                          )}
                        </td>
                      ) : null}
                      <td className="px-4 py-3">
                        <button
                          onClick={() => void handleConfirmReceiving(item)}
                          disabled={isConfirming || (!canManageQueue && !item.received_by_user_id)}
                          className="inline-flex items-center gap-1.5 rounded-[8px] bg-emerald-600 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-emerald-700 disabled:opacity-50 transition-colors"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          {isConfirming ? 'Đang nhận...' : 'Xác nhận nhận hàng'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </FadeItem>
    </PageWrapper>
  );
}
