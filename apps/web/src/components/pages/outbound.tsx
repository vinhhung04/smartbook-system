import { useEffect, useMemo, useState } from 'react';
import confetti from 'canvas-confetti';
import { ArrowRight, CheckCircle2, Clock, ListChecks, PackageCheck, ScanLine, Truck, UserCheck } from 'lucide-react';
import { toast } from 'sonner';
import { NavLink } from 'react-router';
import { FadeItem, PageWrapper } from '../motion-utils';
import { BarcodeScanModal } from '@/components/barcode-scan-modal';
import { LoadingOverlay } from '@/components/ui/loading-state';
import { getApiErrorMessage } from '@/services/api.ts';
import { authService } from '@/services/auth';
import { warehouseService, type Warehouse } from '@/services/warehouse';
import { outboundService, type OutboundQueueItem, type OutboundOrderDetail } from '@/services/outbound';
import { userService, type WarehouseStaffOption } from '@/services/user';
import { canManageReceiving } from '@/lib/rbac';
import { PageHeader } from '@/components/ui/page-header';
import { SectionCard } from '@/components/ui/section-card';
import { FilterBar } from '@/components/ui/filter-bar';
import { StatusBadge } from '@/components/status-badge';
import { WorkflowStepper, type WorkflowStep } from '@/components/ui';
import { StageTabs, type StageTab } from './borrow-shared/stage-tabs';
import { ListFooter } from './borrow-shared/list-footer';
import { Progress } from '@/components/ui/progress';
import { Button, IconButton } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/components/ui/utils';
import { getPickingTaskStatusVariant, getStatusVariant, TONE_CLASSNAME } from '@/lib/status-registry';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';

const PAGE_SIZE = 10;
const READY_STATUSES = new Set(['READY_FOR_OUTBOUND', 'READY_TO_SHIP']);

function taskLabel(taskType: 'outbound' | 'transfer'): string {
  return taskType === 'transfer' ? 'Chuyển kho' : 'Xuất kho';
}

const OUTBOUND_STATUS_LABEL: Record<string, string> = {
  APPROVED: 'Đã duyệt',
  PICKING: 'Đang lấy',
  PARTIAL_PICKED: 'Lấy một phần',
  REPICKING: 'Đang re-pick',
  READY_FOR_OUTBOUND: 'Sẵn xuất kho',
  READY_TO_SHIP: 'Sẵn xuất kho',
  COMPLETED: 'Hoàn tất',
  CANCELLED: 'Đã hủy',
};

function outboundStatusBadge(status: string): { label: string; variant: string } {
  return {
    label: OUTBOUND_STATUS_LABEL[status] || status,
    variant: getStatusVariant('outbound', status),
  };
}

function canConfirmOutbound(status: string, aggregateRemaining?: number): boolean {
  if (READY_STATUSES.has(status)) return true;
  // REPICKING allowed when aggregate pick + repick chain is complete
  if (status === 'REPICKING') return (aggregateRemaining ?? 1) === 0;
  return false;
}

function outboundWorkflowSteps(status: string): WorkflowStep[] {
  const cancelled = status === 'CANCELLED';
  const readyDone = READY_STATUSES.has(status) || status === 'COMPLETED';
  const readyActive = READY_STATUSES.has(status);
  const dispatched = status === 'COMPLETED';

  return [
    { id: 'approved', label: 'Đã duyệt', icon: CheckCircle2, status: cancelled ? 'error' : 'completed' },
    {
      id: 'picking',
      label: 'Đang lấy hàng',
      icon: ListChecks,
      status: readyDone ? 'completed' : cancelled ? 'pending' : 'active',
    },
    {
      id: 'ready',
      label: 'Sẵn xuất kho',
      icon: PackageCheck,
      status: dispatched ? 'completed' : readyActive ? 'active' : 'pending',
    },
    { id: 'done', label: 'Đã xuất kho', icon: Truck, status: dispatched ? 'completed' : 'pending' },
  ];
}

export function OutboundPage() {
  const [loading, setLoading] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [selectedWarehouseId, setSelectedWarehouseId] = useState('');

  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'READY' | 'PROCESSING'>('ALL');
  const [page, setPage] = useState(1);
  const [queue, setQueue] = useState<OutboundQueueItem[]>([]);

  const [selectedTaskType, setSelectedTaskType] = useState<'outbound' | 'transfer' | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState('');
  const [detail, setDetail] = useState<OutboundOrderDetail | null>(null);
  const [scanCode, setScanCode] = useState('');
  const [showScanModal, setShowScanModal] = useState(false);

  const [warehouseStaff, setWarehouseStaff] = useState<WarehouseStaffOption[]>([]);
  const [assigningStaffByTask, setAssigningStaffByTask] = useState<Record<string, string>>({});
  const [assigningTaskKey, setAssigningTaskKey] = useState('');

  const currentUser = authService.getCurrentUser();
  const canManageQueue = canManageReceiving(currentUser);

  const queueStats = useMemo(() => {
    const ready = queue.filter((item) => READY_STATUSES.has(item.status)).length;
    const unassigned = queue.filter((item) => !item.outbound_assigned_user_id).length;
    return { total: queue.length, ready, processing: queue.length - ready, unassigned };
  }, [queue]);

  const filteredQueue = useMemo(() => {
    const statusFiltered = statusFilter === 'ALL'
      ? queue
      : queue.filter((item) => (statusFilter === 'READY' ? READY_STATUSES.has(item.status) : !READY_STATUSES.has(item.status)));

    const keyword = query.trim().toLowerCase();
    if (!keyword) return statusFiltered;

    return statusFiltered.filter((item) => (
      item.order_number.toLowerCase().includes(keyword)
      || String(item.source_warehouse_code || '').toLowerCase().includes(keyword)
      || String(item.target_warehouse_code || '').toLowerCase().includes(keyword)
      || taskLabel(item.task_type).toLowerCase().includes(keyword)
    ));
  }, [queue, query, statusFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredQueue.length / PAGE_SIZE));
  const pagedQueue = useMemo(
    () => filteredQueue.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [filteredQueue, page],
  );

  useEffect(() => {
    setPage(1);
  }, [query, statusFilter]);

  useEffect(() => {
    setPage((current) => Math.min(current, totalPages));
  }, [totalPages]);

  const loadQueue = async (warehouseId?: string) => {
    const response = await outboundService.getQueue(warehouseId);
    setQueue(response.data || []);
  };

  const loadDetail = async (taskType: 'outbound' | 'transfer', taskId: string) => {
    setLoadingDetail(true);
    try {
      const data = await outboundService.getOrderDetail(taskType, taskId);
      setDetail(data);
      setSelectedTaskType(taskType);
      setSelectedTaskId(taskId);
      setScanCode('');
    } finally {
      setLoadingDetail(false);
    }
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
        toast.error(getApiErrorMessage(error, 'Không tải được hàng đợi xuất kho'));
      } finally {
        setLoading(false);
      }
    };

    void run();
  }, [canManageQueue]);

  useEffect(() => {
    if (!canManageQueue) {
      return;
    }

    if (!selectedWarehouseId) {
      setQueue([]);
      return;
    }

    void loadQueue(selectedWarehouseId).catch((error) => {
      toast.error(getApiErrorMessage(error, 'Không tải được hàng đợi theo kho'));
    });
  }, [canManageQueue, selectedWarehouseId]);

  const handleOpen = async (task: OutboundQueueItem) => {
    try {
      await loadDetail(task.task_type, task.task_id);
    } catch (error) {
      toast.error(getApiErrorMessage(error, 'Không mở được chi tiết đơn xuất kho'));
    }
  };

  const handleBackToQueue = () => {
    setDetail(null);
    setSelectedTaskId('');
    setSelectedTaskType(null);
    setScanCode('');
  };

  const handleAssignOutbound = async (task: OutboundQueueItem) => {
    const key = `${task.task_type}:${task.task_id}`;
    const staffId = assigningStaffByTask[key];
    if (!staffId) {
      toast.error('Chọn nhân viên trước khi giao task');
      return;
    }
    try {
      setAssigningTaskKey(key);
      await outboundService.assignOutboundTask(task.task_type, task.task_id, staffId);
      await loadQueue(canManageQueue ? (selectedWarehouseId || undefined) : undefined);
      setAssigningStaffByTask((prev) => ({ ...prev, [key]: '' }));
      toast.success(`Đã giao task xuất kho ${task.order_number}`);
    } catch (error) {
      toast.error(getApiErrorMessage(error, 'Giao task xuất kho thất bại'));
    } finally {
      setAssigningTaskKey('');
    }
  };

  const handleConfirm = async () => {
    if (!selectedTaskType || !selectedTaskId || !detail) {
      toast.error('Chưa chọn đơn cần xuất kho');
      return;
    }

    try {
      setConfirming(true);
      const normalizedCode = scanCode.trim() || null;
      const response = await outboundService.confirmOutbound(selectedTaskType, selectedTaskId, normalizedCode);

      if (selectedTaskType === 'transfer') {
        toast.success('Đã xác nhận xuất kho. Hàng đang vận chuyển — chờ kho đích xác nhận nhận hàng.');
      } else {
        confetti({ particleCount: 60, spread: 55, origin: { y: 0.7 } });
        if (response.data.destination_receipt_number) {
          toast.success(`Đã xuất kho. Phiếu nhập tại kho đích: ${response.data.destination_receipt_number}`);
        } else {
          toast.success('Đã xác nhận xuất kho thành công');
        }
      }

      await loadQueue(canManageQueue ? (selectedWarehouseId || undefined) : undefined);
      handleBackToQueue();
    } catch (error) {
      toast.error(getApiErrorMessage(error, 'Xác nhận xuất kho thất bại'));
    } finally {
      setConfirming(false);
    }
  };

  const getAssignedStaffName = (assignedUserId: string | null) => {
    if (!assignedUserId) return null;
    const staff = warehouseStaff.find((s) => s.id === assignedUserId);
    return staff ? (staff.full_name || staff.username) : assignedUserId.slice(0, 8) + '...';
  };

  if (loading) {
    return (
      <PageWrapper>
        <LoadingOverlay />
      </PageWrapper>
    );
  }

  const detailConfirmable = detail ? canConfirmOutbound(detail.status, detail.aggregate_remaining_qty) : false;

  const tabs: StageTab<'ALL' | 'READY' | 'PROCESSING'>[] = [
    { key: 'ALL', label: 'Tất cả đơn', count: queueStats.total },
    { key: 'PROCESSING', label: 'Đang lấy hàng', count: queueStats.processing },
    { key: 'READY', label: 'Sẵn xuất kho', count: queueStats.ready, attention: true },
  ];

  const warehouseSelect = canManageQueue ? (
    <Select value={selectedWarehouseId || 'all'} onValueChange={(value) => setSelectedWarehouseId(value === 'all' ? '' : value)}>
      <SelectTrigger className="h-9 w-full sm:w-[300px]" aria-label="Kho xuất">
        <SelectValue placeholder="Chọn kho" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">Chọn kho</SelectItem>
        {warehouses.map((warehouse) => (
          <SelectItem key={warehouse.id} value={warehouse.id}>{warehouse.code} - {warehouse.name}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  ) : null;

  const assignControl = (task: OutboundQueueItem) => {
    const key = `${task.task_type}:${task.task_id}`;
    const selectedStaffId = assigningStaffByTask[key] || '';
    const assignedName = getAssignedStaffName(task.outbound_assigned_user_id);
    if (assignedName && !selectedStaffId) {
      return (
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1 text-[12px] font-medium text-emerald-700 dark:text-emerald-400">
            <UserCheck className="h-3.5 w-3.5" /> {assignedName}
          </span>
          <button
            type="button"
            onClick={() => setAssigningStaffByTask((prev) => ({ ...prev, [key]: 'PICK' }))}
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
          onValueChange={(value) => setAssigningStaffByTask((prev) => ({ ...prev, [key]: value }))}
        >
          <SelectTrigger className="h-8 min-w-0 flex-1 text-[12px]" aria-label={`Nhân viên xuất kho cho ${task.order_number}`}>
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
          onClick={() => void handleAssignOutbound(task)}
          disabled={!selectedStaffId || selectedStaffId === 'PICK'}
          loading={assigningTaskKey === key}
        >
          Giao
        </Button>
      </div>
    );
  };

  const statusBadge = (status: string) => {
    const b = outboundStatusBadge(status);
    return <StatusBadge label={b.label} variant={b.variant} dot />;
  };

  return (
    <PageWrapper className="space-y-5">
      <FadeItem>
        <NavLink
          to="/orders"
          className="inline-flex items-center gap-1.5 rounded text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ArrowRight className="h-3.5 w-3.5 rotate-180" /> Quay lại danh sách
        </NavLink>
      </FadeItem>

      {!detail ? (
        <>
          <FadeItem>
            <PageHeader
              icon={PackageCheck}
              title="Xuất kho"
              description={canManageQueue ? 'Giao việc và xác nhận xuất kho cho các đơn đã lấy hàng xong' : 'Xác nhận xuất kho cho các đơn được giao cho bạn'}
              iconBg="bg-sky-50 dark:bg-sky-500/10"
              iconColor="text-sky-600 dark:text-sky-400"
              actions={warehouseSelect}
            />
          </FadeItem>

          <FadeItem>
            <div className="rounded-xl border border-border bg-card">
              <StageTabs label="Lọc theo tình trạng đơn" tabs={tabs} value={statusFilter} onChange={setStatusFilter} />
              <div className="border-t border-border px-4 py-3">
                <FilterBar searchValue={query} onSearchChange={setQuery} searchPlaceholder="Tìm mã đơn, mã kho hoặc loại đơn..." showSearchClear />
              </div>
            </div>
          </FadeItem>

          {canManageQueue && queueStats.unassigned > 0 && (
            <FadeItem>
              <p className="flex items-center gap-2 text-[13px] text-amber-700 dark:text-amber-400">
                <Clock className="h-4 w-4 shrink-0" aria-hidden="true" />
                {queueStats.unassigned} đơn chưa có nhân viên xuất kho. Chọn nhân viên cho từng đơn rồi bấm Giao.
              </p>
            </FadeItem>
          )}

          <FadeItem>
            <SectionCard noPadding>
              {pagedQueue.length === 0 ? (
                <EmptyState
                  variant={query ? 'no-results' : 'inbox'}
                  title={query ? 'Không tìm thấy đơn phù hợp' : 'Không có đơn nào cần xuất kho'}
                  description={query ? 'Thử tìm theo mã đơn hoặc mã kho.' : 'Đơn xuất kho và chuyển kho đã duyệt sẽ hiện ở đây cùng tiến độ lấy hàng.'}
                  className="py-12"
                />
              ) : (
                <Table className="table-fixed">
                  <TableHeader className="bg-muted/50">
                    <TableRow className="hover:bg-transparent">
                      {[
                        { label: 'Đơn', className: '' },
                        { label: 'Tuyến', className: 'hidden w-[180px] xl:table-cell' },
                        { label: 'Trạng thái', className: 'hidden w-[150px] md:table-cell' },
                        { label: 'Đã lấy', className: 'hidden w-[140px] sm:table-cell' },
                        ...(canManageQueue ? [{ label: 'Nhân viên', className: 'hidden w-[250px] lg:table-cell' }] : []),
                        { label: 'Thao tác', className: 'w-[124px] text-right' },
                      ].map((header) => (
                        <TableHead key={header.label} className={cn('px-4 py-3 text-xs font-medium text-muted-foreground', header.className)}>
                          {header.label}
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pagedQueue.map((task) => {
                      const key = `${task.task_type}:${task.task_id}`;
                      const progressPct = task.total_quantity > 0 ? Math.min(100, Math.round((task.ready_quantity / task.total_quantity) * 100)) : 0;
                      const route = `${task.source_warehouse_code || '-'} → ${task.target_warehouse_code || '-'}`;
                      const ready = READY_STATUSES.has(task.status);
                      return (
                        <TableRow key={key} className={cn('hover:bg-muted/30', ready && 'bg-emerald-50/40 dark:bg-emerald-500/[0.04]')}>
                          <TableCell className="px-4 py-3 align-top">
                            <button
                              type="button"
                              onClick={() => void handleOpen(task)}
                              className="block max-w-full truncate rounded text-left text-sm font-semibold text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            >
                              {task.order_number}
                            </button>
                            <p className="truncate text-xs text-muted-foreground">
                              {taskLabel(task.task_type)}<span className="xl:hidden">, {route}</span>
                            </p>
                            {(task.repick_count ?? 0) > 0 && (
                              <p className="text-xs text-amber-700 dark:text-amber-400">
                                {task.repick_count} lần lấy bù{(task.active_repick_count ?? 0) > 0 ? `, ${task.active_repick_count} chưa xong` : ''}
                              </p>
                            )}
                            <div className="mt-1.5 flex flex-wrap items-center gap-2 md:hidden">
                              {statusBadge(task.status)}
                              <span className="font-mono text-xs tabular-nums text-muted-foreground sm:hidden">{task.ready_quantity}/{task.total_quantity}</span>
                            </div>
                            {canManageQueue && <div className="mt-2 lg:hidden">{assignControl(task)}</div>}
                          </TableCell>
                          <TableCell className="hidden px-4 py-3 align-top font-mono text-xs text-muted-foreground xl:table-cell">{route}</TableCell>
                          <TableCell className="hidden px-4 py-3 align-top md:table-cell">{statusBadge(task.status)}</TableCell>
                          <TableCell className="hidden px-4 py-3 align-top sm:table-cell">
                            <p className="font-mono text-xs font-semibold tabular-nums text-foreground">{task.ready_quantity}/{task.total_quantity} cuốn</p>
                            <Progress value={progressPct} className="mt-1.5 h-1.5" aria-label={`Đã lấy ${progressPct}%`} />
                          </TableCell>
                          {canManageQueue && <TableCell className="hidden px-4 py-3 align-top lg:table-cell">{assignControl(task)}</TableCell>}
                          <TableCell className="px-4 py-3 text-right align-top">
                            <Button size="sm" variant={ready ? 'default' : 'outline'} onClick={() => void handleOpen(task)} className="gap-1">
                              {ready ? 'Xuất kho' : 'Xem'} <ArrowRight className="h-3 w-3" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
              <ListFooter
                page={page}
                pageSize={PAGE_SIZE}
                total={filteredQueue.length}
                totalPages={totalPages}
                shown={pagedQueue.length}
                noun="đơn"
                onPageChange={setPage}
              />
            </SectionCard>
          </FadeItem>
        </>
      ) : (
        <>
          <FadeItem>
            <PageHeader
              icon={PackageCheck}
              title={`${taskLabel(detail.task_type)} ${detail.order_number}`}
              description={`Từ ${detail.source_warehouse_code || '-'}${detail.target_warehouse_code ? ` đến ${detail.target_warehouse_code}` : ''}, ${detail.lines.length} dòng sách`}
              iconBg="bg-sky-50 dark:bg-sky-500/10"
              iconColor="text-sky-600 dark:text-sky-400"
              actions={<Button variant="outline" size="sm" onClick={handleBackToQueue}>Quay lại hàng đợi</Button>}
            />
          </FadeItem>

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
            <div className="space-y-5 lg:col-span-2">
              <FadeItem>
                <SectionCard
                  title="Tiến trình"
                  actions={statusBadge(detail.status)}
                >
                  <WorkflowStepper steps={outboundWorkflowSteps(detail.status)} compact />
                  {detail.aggregate_requested_qty !== undefined && (
                    <p className="mt-4 text-[13px] text-muted-foreground">
                      Đã lấy <span className="font-mono font-semibold tabular-nums text-foreground">{detail.aggregate_picked_qty}/{detail.aggregate_requested_qty}</span> cuốn
                      {(detail.aggregate_remaining_qty ?? 0) > 0 && (
                        <span className="text-amber-700 dark:text-amber-400">, còn thiếu {detail.aggregate_remaining_qty}</span>
                      )}
                      {detail.outbound_assigned_user_id ? <span>. Nhân viên xuất kho: <span className="font-medium text-foreground">{getAssignedStaffName(detail.outbound_assigned_user_id)}</span></span> : null}
                    </p>
                  )}
                </SectionCard>
              </FadeItem>

              <FadeItem>
                <SectionCard noPadding title="Sách trong đơn" subtitle="Dòng tô vàng là dòng chưa lấy đủ số lượng">
                  <Table className="table-fixed">
                    <TableHeader className="bg-muted/50">
                      <TableRow className="hover:bg-transparent">
                        <TableHead className="px-4 py-3 text-xs font-medium text-muted-foreground">Sách</TableHead>
                        <TableHead className="hidden w-[180px] px-4 py-3 text-xs font-medium text-muted-foreground sm:table-cell">SKU / mã vạch</TableHead>
                        <TableHead className="w-[130px] px-4 py-3 text-xs font-medium text-muted-foreground">Đã lấy</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {detail.lines.length === 0 ? (
                        <TableRow className="hover:bg-transparent">
                          <TableCell colSpan={3} className="whitespace-normal py-6 text-center text-[13px] text-muted-foreground">Đơn không có dòng sách nào</TableCell>
                        </TableRow>
                      ) : detail.lines.map((line) => {
                        const short = line.ready_qty < line.quantity;
                        const linePct = line.quantity > 0 ? Math.min(100, Math.round((line.ready_qty / line.quantity) * 100)) : 0;
                        return (
                          <TableRow key={line.line_id} className={cn(short && 'bg-amber-50/50 dark:bg-amber-500/5')}>
                            <TableCell className="whitespace-normal px-4 py-3">
                              <p className="text-[13px] font-medium text-foreground">{line.book_title}</p>
                              <p className="font-mono text-xs text-muted-foreground sm:hidden">{line.sku || line.barcode || '-'}</p>
                            </TableCell>
                            <TableCell className="hidden px-4 py-3 font-mono text-xs text-muted-foreground sm:table-cell">{line.sku || line.barcode || '-'}</TableCell>
                            <TableCell className="px-4 py-3">
                              <span className={cn('font-mono text-xs font-semibold tabular-nums', short ? 'text-amber-700 dark:text-amber-400' : 'text-foreground')}>
                                {line.ready_qty}/{line.quantity}
                              </span>
                              <Progress value={linePct} className="mt-1.5 h-1.5" aria-label={`Đã lấy ${linePct}%`} />
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </SectionCard>
              </FadeItem>

              {(detail.pick_task || (detail.repick_tasks && detail.repick_tasks.length > 0)) && (
                <FadeItem>
                  <SectionCard title="Lượt lấy hàng" subtitle="Lượt lấy chính và các lượt lấy bù khi thiếu hàng">
                    <ol className="space-y-2">
                      {[
                        ...(detail.pick_task ? [{ kind: 'Lấy hàng', task: detail.pick_task }] : []),
                        ...(detail.repick_tasks || []).map((task) => ({ kind: 'Lấy bù', task })),
                      ].map(({ kind, task }) => {
                        const requested = task.items.reduce((s, i) => s + i.requested_qty, 0);
                        const picked = task.items.reduce((s, i) => s + i.picked_qty, 0);
                        const shortQty = task.items.reduce((s, i) => s + i.short_qty, 0);
                        return (
                          <li key={task.task_number} className={cn('flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border px-3 py-2.5', kind === 'Lấy bù' && 'ml-4')}>
                            <div className="min-w-0">
                              <p className="text-[13px] font-medium text-foreground">
                                {kind} <span className="font-mono text-xs text-muted-foreground">{task.task_number}</span>
                              </p>
                              {task.items.length > 0 && (
                                <p className="text-xs text-muted-foreground">
                                  Đã lấy {picked}/{requested}
                                  {shortQty > 0 && <span className="text-amber-700 dark:text-amber-400">, thiếu {shortQty}</span>}
                                </p>
                              )}
                            </div>
                            <span className={cn('rounded-full border px-2 py-0.5 text-[11px] font-medium', TONE_CLASSNAME[getPickingTaskStatusVariant(task.status)])}>
                              {task.status}
                            </span>
                          </li>
                        );
                      })}
                    </ol>
                  </SectionCard>
                </FadeItem>
              )}
            </div>

            <FadeItem className="lg:sticky lg:top-4 lg:self-start">
              <SectionCard title="Xác nhận xuất kho">
                {detailConfirmable ? (
                  <p className="mb-3 flex items-center gap-1.5 text-[13px] font-medium text-emerald-700 dark:text-emerald-400">
                    <ScanLine className="h-4 w-4" aria-hidden="true" /> Đơn đã sẵn sàng. Quét hoặc nhập mã đơn để xác nhận.
                  </p>
                ) : (
                  <p className="mb-3 text-[13px] text-amber-700 dark:text-amber-400">
                    Đơn đang ở trạng thái "{outboundStatusBadge(detail.status).label}", chưa thể xuất kho.
                  </p>
                )}
                <label htmlFor="outbound-scan-code" className="mb-1.5 block text-[12px] font-medium text-foreground">Mã đơn hoặc mã quét</label>
                <div className="flex gap-2">
                  <Input
                    id="outbound-scan-code"
                    value={scanCode}
                    onChange={(event) => setScanCode(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        void handleConfirm();
                      }
                    }}
                    placeholder={detail.order_number}
                    className="h-10 flex-1 font-mono"
                  />
                  <IconButton variant="outline" onClick={() => setShowScanModal(true)} disabled={confirming} label="Quét mã đơn">
                    <ScanLine className="h-4 w-4" />
                  </IconButton>
                </div>
                <Button onClick={() => void handleConfirm()} disabled={!detailConfirmable} loading={confirming} className="mt-3 w-full">
                  Xác nhận xuất kho
                </Button>
                <p className="mt-3 flex items-start gap-2 text-xs text-muted-foreground">
                  <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  {detail.task_type === 'transfer'
                    ? 'Sau khi xác nhận, hàng chuyển sang trạng thái đang vận chuyển. Quản lý kho đích cần giao việc nhận hàng cho nhân viên.'
                    : 'Sau khi xác nhận, đơn chuyển sang trạng thái hoàn tất.'}
                </p>
                {loadingDetail ? <p className="mt-3 text-[12px] text-muted-foreground">Đang tải chi tiết...</p> : null}
              </SectionCard>
            </FadeItem>
          </div>

          <BarcodeScanModal
            isOpen={showScanModal}
            onClose={() => setShowScanModal(false)}
            onDetected={(code) => {
              setScanCode(code);
              toast.success(`Đã quét mã đơn: ${code}`);
            }}
            title="Quét mã đơn xuất kho"
          />
        </>
      )}
    </PageWrapper>
  );
}
