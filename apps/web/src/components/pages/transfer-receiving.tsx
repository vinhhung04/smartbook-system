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
import { SectionCard } from '@/components/ui/section-card';
import { FilterBar } from '@/components/ui/filter-bar';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/components/ui/utils';

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

  const unassigned = queue.filter((item) => !item.received_by_user_id).length;
  const statusLabel = (status: string) => (status === 'IN_TRANSIT' ? 'Đang vận chuyển' : status);
  const shippedAt = (item: TransferReceivingItem) => (item.shipped_at ? new Date(item.shipped_at).toLocaleDateString('vi-VN') : '-');

  const assignControl = (item: TransferReceivingItem) => {
    const assignedName = getAssignedStaffName(item.received_by_user_id);
    const selectedStaffId = assigningStaffById[item.id] || '';
    if (assignedName && !selectedStaffId) {
      return (
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1 text-[12px] font-medium text-emerald-700 dark:text-emerald-400">
            <UserCheck className="h-3.5 w-3.5" /> {assignedName}
          </span>
          <button
            type="button"
            onClick={() => setAssigningStaffById((prev) => ({ ...prev, [item.id]: 'PICK' }))}
            className="rounded text-[12px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Đổi
          </button>
        </div>
      );
    }
    return (
      <div className="flex items-center gap-2">
        <Select
          // '' shows the placeholder; 'PICK' means "reassigning, nobody chosen yet".
          value={selectedStaffId === 'PICK' ? '' : selectedStaffId}
          onValueChange={(value) => setAssigningStaffById((prev) => ({ ...prev, [item.id]: value }))}
        >
          <SelectTrigger className="h-8 min-w-0 flex-1 text-[12px]" aria-label={`Nhân viên nhận hàng cho ${item.transfer_number}`}>
            <SelectValue placeholder="Chọn nhân viên" />
          </SelectTrigger>
          <SelectContent>
            {warehouseStaff.map((staff) => (
              <SelectItem key={staff.id} value={staff.id}>{staff.full_name || staff.username}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          size="sm"
          onClick={() => void handleAssign(item)}
          disabled={!selectedStaffId || selectedStaffId === 'PICK'}
          loading={assigningId === item.id}
        >
          Giao
        </Button>
      </div>
    );
  };

  const flow = [
    { title: 'Kho nguồn xuất hàng', text: 'Chuyển kho hiện ở đây khi kho nguồn đã xác nhận xuất kho và hàng đang vận chuyển.' },
    { title: 'Giao người nhận', text: canManageQueue ? 'Quản lý chọn nhân viên nhận hàng cho từng chuyến.' : 'Quản lý giao chuyến cho bạn nhận hàng.' },
    { title: 'Xác nhận nhận hàng', text: 'Hệ thống tự tạo phiếu nhập tại kho đích và đưa hàng vào khu nhận.' },
  ];

  return (
    <PageWrapper className="space-y-5">
      <FadeItem>
        <NavLink
          to="/my-warehouse-tasks"
          className="inline-flex items-center gap-1.5 rounded text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ArrowRight className="h-3.5 w-3.5 rotate-180" /> Quay lại task kho
        </NavLink>
      </FadeItem>

      <FadeItem>
        <PageHeader
          icon={PackageCheck}
          title="Nhận hàng chuyển kho"
          description={canManageQueue ? 'Giao việc và xác nhận nhận hàng cho các chuyến đang đến kho của bạn' : 'Xác nhận nhận hàng cho các chuyến được giao cho bạn'}
          iconBg="bg-amber-50 dark:bg-amber-500/10"
          iconColor="text-amber-600 dark:text-amber-400"
          actions={
            canManageQueue ? (
              <Select value={selectedWarehouseId || 'all'} onValueChange={(value) => setSelectedWarehouseId(value === 'all' ? '' : value)}>
                <SelectTrigger className="h-9 w-full sm:w-[300px]" aria-label="Kho đích">
                  <SelectValue placeholder="Chọn kho đích" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Chọn kho đích</SelectItem>
                  {warehouses.map((w) => (
                    <SelectItem key={w.id} value={w.id}>{w.code} - {w.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : undefined
          }
        />
      </FadeItem>

      <FadeItem>
        <ol className="grid grid-cols-1 gap-px overflow-hidden rounded-xl border border-border bg-border md:grid-cols-3">
          {flow.map((step, index) => (
            <li key={step.title} className="flex gap-3 bg-card px-4 py-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-amber-50 text-[12px] font-semibold text-amber-700 dark:bg-amber-500/10 dark:text-amber-400">
                {index + 1}
              </span>
              <div className="min-w-0">
                <p className="text-[13px] font-medium text-foreground">{step.title}</p>
                <p className="text-xs text-muted-foreground">{step.text}</p>
              </div>
            </li>
          ))}
        </ol>
      </FadeItem>

      <FadeItem>
        <SectionCard
          noPadding
          title="Chuyến đang đến"
          subtitle={`${queue.length} chuyến${canManageQueue && unassigned > 0 ? `, ${unassigned} chưa có người nhận` : ''}`}
        >
          <div className="border-t border-border px-4 py-3">
            <FilterBar searchValue={query} onSearchChange={setQuery} searchPlaceholder="Tìm mã chuyển kho hoặc mã kho..." showSearchClear />
          </div>
          {filteredQueue.length === 0 ? (
            <EmptyState
              variant={query ? 'no-results' : 'inbox'}
              title={query ? 'Không tìm thấy chuyển kho phù hợp' : 'Không có chuyển kho nào đang chờ nhận'}
              description={query ? 'Thử tìm theo mã chuyển kho hoặc mã kho.' : 'Chuyến mới sẽ hiện ở đây ngay khi kho nguồn xác nhận xuất kho.'}
              className="py-12"
            />
          ) : (
            <Table className="table-fixed">
              <TableHeader className="bg-muted/50">
                <TableRow className="hover:bg-transparent">
                  {[
                    { label: 'Chuyển kho', className: '' },
                    { label: 'Tuyến', className: 'hidden w-[180px] xl:table-cell' },
                    { label: 'Số lượng', className: 'hidden w-[100px] text-right md:table-cell' },
                    { label: 'Xuất lúc', className: 'hidden w-[110px] lg:table-cell' },
                    ...(canManageQueue ? [{ label: 'Người nhận', className: 'hidden w-[250px] lg:table-cell' }] : []),
                    { label: 'Thao tác', className: 'w-[150px] text-right' },
                  ].map((header) => (
                    <TableHead key={header.label} className={cn('px-4 py-3 text-xs font-medium text-muted-foreground', header.className)}>
                      {header.label}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredQueue.map((item) => {
                  const route = `${item.from_warehouse_code || '-'} → ${item.to_warehouse_code || '-'}`;
                  return (
                    <TableRow key={item.id} className="hover:bg-muted/30">
                      <TableCell className="px-4 py-3 align-top">
                        <p className="truncate text-sm font-semibold text-foreground">{item.transfer_number}</p>
                        <div className="mt-1 flex flex-wrap items-center gap-2">
                          <StatusBadge label={statusLabel(item.status)} variant="warning" dot />
                          <span className="text-xs text-muted-foreground xl:hidden">{route}</span>
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground md:hidden">{item.total_quantity} cuốn, xuất {shippedAt(item)}</p>
                        <p className="mt-1 hidden text-xs text-muted-foreground md:block lg:hidden">xuất {shippedAt(item)}</p>
                        {canManageQueue && <div className="mt-2 lg:hidden">{assignControl(item)}</div>}
                      </TableCell>
                      <TableCell className="hidden px-4 py-3 align-top font-mono text-xs text-muted-foreground xl:table-cell">{route}</TableCell>
                      <TableCell className="hidden px-4 py-3 text-right align-top md:table-cell">
                        <span className="text-sm font-semibold tabular-nums">{item.total_quantity}</span>
                        <span className="text-xs text-muted-foreground"> cuốn</span>
                      </TableCell>
                      <TableCell className="hidden px-4 py-3 align-top text-xs text-muted-foreground lg:table-cell">{shippedAt(item)}</TableCell>
                      {canManageQueue && <TableCell className="hidden px-4 py-3 align-top lg:table-cell">{assignControl(item)}</TableCell>}
                      <TableCell className="px-4 py-3 text-right align-top">
                        <Button
                          size="sm"
                          variant="success-outline"
                          onClick={() => void handleConfirmReceiving(item)}
                          disabled={!canManageQueue && !item.received_by_user_id}
                          loading={confirming === item.id}
                          className="gap-1.5"
                        >
                          <CheckCircle2 className="h-3.5 w-3.5" /> Đã nhận hàng
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </SectionCard>
      </FadeItem>
    </PageWrapper>
  );
}
