import { useEffect, useMemo, useState } from 'react';
import confetti from 'canvas-confetti';
import { ArrowRight, Boxes, CheckCircle2, Clock, ListChecks, PackageCheck, ScanLine, Truck, UserCheck } from 'lucide-react';
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
import { StatCard } from '@/components/ui/stat-card';
import { WorkflowStepper, type WorkflowStep } from '@/components/ui';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Progress } from '@/components/ui/progress';
import { Button, IconButton } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  Pagination, PaginationContent, PaginationEllipsis, PaginationItem, PaginationLink,
  PaginationNext, PaginationPrevious,
} from '@/components/ui/pagination';
import { getPaginationRange } from '@/lib/pagination';
import { cn } from '@/components/ui/utils';
import { getPickingTaskStatusVariant, getStatusVariant, TONE_CLASSNAME } from '@/lib/status-registry';
import { Alert, AlertDescription } from '@/components/ui/alert';
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

  const tableHeads = canManageQueue
    ? ['Mã đơn', 'Loại', 'Kho nguồn', 'Kho đích', 'Trạng thái', 'Tiến độ', 'Nhân viên xuất kho', 'Thao tác']
    : ['Mã đơn', 'Loại', 'Kho nguồn', 'Kho đích', 'Trạng thái', 'Tiến độ', 'Thao tác'];

  const detailAccentBorder = detail
    ? (detail.status === 'CANCELLED'
      ? 'border-l-red-500'
      : detail.status === 'COMPLETED'
        ? 'border-l-muted-foreground/30'
        : READY_STATUSES.has(detail.status)
          ? 'border-l-emerald-500'
          : 'border-l-sky-500')
    : '';

  const detailConfirmable = detail ? canConfirmOutbound(detail.status, detail.aggregate_remaining_qty) : false;

  return (
    <PageWrapper className="space-y-5">
      <FadeItem>
        <NavLink
          to="/orders"
          className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-muted-foreground transition-colors hover:text-blue-600 dark:hover:text-blue-400"
        >
          <ArrowRight className="h-3.5 w-3.5 rotate-180" /> Quay lại danh sách
        </NavLink>
      </FadeItem>

      <FadeItem>
        <PageHeader
          icon={PackageCheck}
          title="Xuất kho"
          description={canManageQueue ? 'Giao task và xác nhận xuất kho cho đơn đã lấy xong (READY_FOR_OUTBOUND)' : 'Xác nhận xuất kho cho task được giao'}
          iconBg="bg-gradient-to-br from-sky-100 to-blue-50 dark:from-sky-500/20 dark:to-blue-500/10"
          iconColor="text-sky-600 dark:text-sky-400"
        />
      </FadeItem>

      {!detail ? (
        <>
          {canManageQueue && (
            <FadeItem>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <StatCard label="Tổng đơn" value={queueStats.total} icon={Boxes} variant="primary" animateValue />
                <StatCard label="Sẵn xuất kho" value={queueStats.ready} icon={PackageCheck} variant="success" animateValue />
                <StatCard label="Đang xử lý" value={queueStats.processing} icon={ListChecks} variant="info" animateValue />
                <StatCard
                  label="Chưa giao"
                  value={queueStats.unassigned}
                  icon={Clock}
                  variant={queueStats.unassigned > 0 ? 'danger' : 'default'}
                  animateValue
                />
              </div>
            </FadeItem>
          )}

          <FadeItem>
            <FilterBar
              searchValue={query}
              onSearchChange={setQuery}
              searchPlaceholder="Mã đơn / kho / loại đơn"
              filters={(
                <div className="flex items-center gap-2 flex-wrap">
                  <SegmentedControl
                    options={[
                      { value: 'ALL', label: 'Tất cả' },
                      { value: 'READY', label: 'Sẵn xuất kho' },
                      { value: 'PROCESSING', label: 'Đang xử lý' },
                    ]}
                    value={statusFilter}
                    onChange={(value) => setStatusFilter(value as 'ALL' | 'READY' | 'PROCESSING')}
                    layoutId="outbound-status-filter"
                    gradientClassName="from-blue-600 to-indigo-600"
                  />
                  {canManageQueue && (
                    <Select value={selectedWarehouseId || 'all'} onValueChange={(value) => setSelectedWarehouseId(value === 'all' ? '' : value)}>
                      <SelectTrigger className="w-[220px]">
                        <SelectValue placeholder="Chọn kho" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Chọn kho</SelectItem>
                        {warehouses.map((warehouse) => (
                          <SelectItem key={warehouse.id} value={warehouse.id}>{warehouse.code} - {warehouse.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>
              )}
            />
          </FadeItem>

          <FadeItem>
            <SectionCard noPadding>
              <Table>
                <TableHeader>
                  <TableRow className="bg-gradient-to-r from-sky-50/30 to-transparent hover:bg-transparent dark:from-sky-500/5">
                    {tableHeads.map((head) => (
                      <TableHead key={head} className="text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">
                        {head}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pagedQueue.length === 0 ? (
                    <TableRow className="hover:bg-transparent">
                      <TableCell colSpan={tableHeads.length} className="whitespace-normal">
                        <EmptyState variant="no-data" title="Không có đơn nào cần xuất kho" className="py-10" />
                      </TableCell>
                    </TableRow>
                  ) : pagedQueue.map((task) => {
                    const key = `${task.task_type}:${task.task_id}`;
                    const selectedStaffId = assigningStaffByTask[key] || '';
                    const assignedName = getAssignedStaffName(task.outbound_assigned_user_id);
                    const isAssigning = assigningTaskKey === key;
                    const progressPct = task.total_quantity > 0 ? Math.min(100, Math.round((task.ready_quantity / task.total_quantity) * 100)) : 0;

                    return (
                      <TableRow key={key}>
                        <TableCell className="text-[12px] font-semibold">
                          <div>{task.order_number}</div>
                          {(task.repick_count ?? 0) > 0 && (
                            <div className="mt-0.5 text-[10px] text-amber-600 dark:text-amber-400">
                              {task.repick_count} repick{(task.active_repick_count ?? 0) > 0 ? ` · ${task.active_repick_count} chưa xong` : ''}
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="text-[12px] text-muted-foreground">{taskLabel(task.task_type)}</TableCell>
                        <TableCell className="text-[12px] text-muted-foreground">{task.source_warehouse_code || '-'}</TableCell>
                        <TableCell className="text-[12px] text-muted-foreground">{task.target_warehouse_code || '-'}</TableCell>
                        <TableCell className="text-[12px]">
                          {(() => { const b = outboundStatusBadge(task.status); return (
                            <StatusBadge label={b.label} variant={b.variant} dot />
                          ); })()}
                        </TableCell>
                        <TableCell className="text-[12px] w-[140px]">
                          <div className="flex items-center gap-2">
                            <Progress value={progressPct} className="h-1.5 w-16" />
                            <span className="font-mono text-[11px] font-semibold tabular-nums text-foreground whitespace-nowrap">
                              {task.ready_quantity}/{task.total_quantity}
                            </span>
                          </div>
                        </TableCell>
                        {canManageQueue ? (
                          <TableCell>
                            {assignedName && !selectedStaffId ? (
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] text-emerald-700 font-semibold dark:bg-emerald-500/10 dark:text-emerald-400">
                                  <UserCheck className="w-3 h-3" /> {assignedName}
                                </span>
                                <button
                                  onClick={() => setAssigningStaffByTask((prev) => ({ ...prev, [key]: 'PICK' }))}
                                  className="text-[10px] text-muted-foreground hover:text-foreground underline cursor-pointer"
                                >
                                  Đổi
                                </button>
                              </div>
                            ) : (
                              <div className="flex items-center gap-2">
                                <Select
                                  value={selectedStaffId === 'PICK' ? 'none' : (selectedStaffId || 'none')}
                                  onValueChange={(value) => setAssigningStaffByTask((prev) => ({ ...prev, [key]: value === 'none' ? '' : value }))}
                                >
                                  <SelectTrigger className="h-8 min-w-[140px] text-[11px]">
                                    <SelectValue placeholder="Chọn nhân viên" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {warehouseStaff.map((staff) => (
                                      <SelectItem key={staff.id} value={staff.id}>
                                        {staff.full_name || staff.username}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                                <Button
                                  size="sm"
                                  onClick={() => void handleAssignOutbound(task)}
                                  disabled={!selectedStaffId || selectedStaffId === 'PICK'}
                                  loading={isAssigning}
                                >
                                  Giao
                                </Button>
                              </div>
                            )}
                          </TableCell>
                        ) : null}
                        <TableCell>
                          <Button size="sm" variant="outline" onClick={() => void handleOpen(task)}>
                            Xem & xuất <ArrowRight className="w-3 h-3" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>

              {filteredQueue.length > 0 && (
                <div className="flex flex-col gap-3 border-t border-border px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-[12px] text-muted-foreground">
                    Hiển thị <span className="font-medium text-foreground">{pagedQueue.length}</span> / {filteredQueue.length} đơn
                  </p>
                  {totalPages > 1 && (
                    <Pagination className="mx-0 w-auto justify-end">
                      <PaginationContent>
                        <PaginationItem>
                          <PaginationPrevious
                            onClick={(event) => {
                              event.preventDefault();
                              setPage((current) => Math.max(1, current - 1));
                            }}
                            className={cn('cursor-pointer', page === 1 && 'pointer-events-none opacity-50')}
                          />
                        </PaginationItem>
                        {getPaginationRange(page, totalPages).map((item) => (
                          <PaginationItem key={item}>
                            {typeof item === 'number' ? (
                              <PaginationLink
                                isActive={item === page}
                                onClick={(event) => {
                                  event.preventDefault();
                                  setPage(item);
                                }}
                                className="cursor-pointer"
                              >
                                {item}
                              </PaginationLink>
                            ) : (
                              <PaginationEllipsis />
                            )}
                          </PaginationItem>
                        ))}
                        <PaginationItem>
                          <PaginationNext
                            onClick={(event) => {
                              event.preventDefault();
                              setPage((current) => Math.min(totalPages, current + 1));
                            }}
                            className={cn('cursor-pointer', page === totalPages && 'pointer-events-none opacity-50')}
                          />
                        </PaginationItem>
                      </PaginationContent>
                    </Pagination>
                  )}
                </div>
              )}
            </SectionCard>
          </FadeItem>
        </>
      ) : (
        <>
          <FadeItem>
            <div className="relative">
              <div className="pointer-events-none absolute -top-2 left-6 z-10 h-4 w-4 rounded-full border border-border bg-background" />
              <div className="pointer-events-none absolute -top-2 right-6 z-10 h-4 w-4 rounded-full border border-border bg-background" />
              <div className={cn('rounded-xl border bg-card p-5 pt-4 shadow-[0_1px_4px_rgba(0,0,0,0.03)] dark:shadow-none border-l-4', detailAccentBorder)}>
                <p className="mb-3 border-b border-dashed border-border pb-3 font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                  Phiếu xuất kho
                </p>
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <p className="font-mono text-[20px] font-bold leading-tight text-foreground">#{detail.order_number}</p>
                    <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                      <span className="font-mono text-[11px] text-muted-foreground">{taskLabel(detail.task_type)}</span>
                      {(() => { const b = outboundStatusBadge(detail.status); return (
                        <StatusBadge label={b.label} variant={b.variant} dot />
                      ); })()}
                    </div>
                    <p className="text-[12px] text-muted-foreground mt-2">
                      Nguồn: {detail.source_warehouse_code || '-'}
                      {detail.target_warehouse_code ? ` | Đích: ${detail.target_warehouse_code}` : ''}
                      {` | Số dòng: ${detail.lines.length}`}
                    </p>
                    {detail.aggregate_requested_qty !== undefined && (
                      <p className="text-[11px] text-muted-foreground mt-1">
                        Tổng: <span className="font-mono font-semibold tabular-nums">{detail.aggregate_picked_qty}</span>/{detail.aggregate_requested_qty} cuốn
                        {(detail.aggregate_remaining_qty ?? 0) > 0 && (
                          <span className="text-amber-600 dark:text-amber-400"> · Còn thiếu: {detail.aggregate_remaining_qty}</span>
                        )}
                      </p>
                    )}
                    {detail.outbound_assigned_user_id ? (
                      <p className="text-[11px] text-emerald-700 dark:text-emerald-400 mt-1 font-semibold">
                        Nhân viên xuất kho: {getAssignedStaffName(detail.outbound_assigned_user_id)}
                      </p>
                    ) : null}
                  </div>
                  <Button variant="outline" onClick={handleBackToQueue}>
                    Quay lại hàng đợi
                  </Button>
                </div>
              </div>
            </div>
          </FadeItem>

          <FadeItem>
            <SectionCard title="Tiến trình xuất kho">
              <WorkflowStepper steps={outboundWorkflowSteps(detail.status)} compact />
            </SectionCard>
          </FadeItem>

          <FadeItem>
            <div className="rounded-xl border border-border bg-card p-5 shadow-[0_1px_4px_rgba(0,0,0,0.03)] dark:shadow-none">
              <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
                <h3 className="text-[14px] font-semibold">Quét mã và xác nhận xuất kho</h3>
                {detailConfirmable ? (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1.5 font-mono text-[11px] font-semibold uppercase tracking-wide text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400">
                    <ScanLine className="h-3.5 w-3.5 animate-pulse" /> Sẵn sàng quét
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-3 py-1.5 font-mono text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Chưa thể xuất kho
                  </span>
                )}
              </div>
              <p className="text-[11px] text-muted-foreground mb-3">Nhập tay hoặc quét mã đơn để xác nhận xuất kho.</p>
              <div className="flex gap-2 flex-wrap">
                <Input
                  value={scanCode}
                  onChange={(event) => setScanCode(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      void handleConfirm();
                    }
                  }}
                  placeholder="Mã đơn / mã quét"
                  className="flex-1 min-w-[200px] h-auto py-2.5 font-mono tracking-wide"
                />
                <IconButton
                  variant="outline"
                  onClick={() => setShowScanModal(true)}
                  disabled={confirming}
                  label="Quét mã đơn"
                >
                  <ScanLine className="w-4 h-4" />
                </IconButton>
                <Button
                  onClick={() => void handleConfirm()}
                  disabled={!detailConfirmable}
                  loading={confirming}
                  className="bg-gradient-to-r from-blue-600 to-indigo-600 hover:opacity-90"
                >
                  Xác nhận xuất kho
                </Button>
              </div>

              {scanCode && (
                <p className="mt-2 font-mono text-[11px] text-muted-foreground">
                  Đã nhập mã: <span className="text-foreground font-semibold">{scanCode}</span>
                </p>
              )}

              {!detailConfirmable && (
                <p className="mt-2 text-[11px] font-medium text-amber-600 dark:text-amber-400">
                  Đơn đang ở trạng thái "{outboundStatusBadge(detail.status).label}" — chưa thể xuất kho.
                </p>
              )}

              {loadingDetail ? <p className="text-[12px] text-muted-foreground mt-3">Đang tải chi tiết...</p> : null}
            </div>
          </FadeItem>

          <FadeItem>
            <SectionCard noPadding>
              <Table>
                <TableHeader>
                  <TableRow className="bg-gradient-to-r from-sky-50/30 to-transparent hover:bg-transparent dark:from-sky-500/5">
                    <TableHead className="text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">Sản phẩm</TableHead>
                    <TableHead className="text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">SKU/Mã vạch</TableHead>
                    <TableHead className="text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground w-[150px]">Tiến độ</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {detail.lines.length === 0 ? (
                    <TableRow className="hover:bg-transparent">
                      <TableCell colSpan={3} className="whitespace-normal py-6 text-center text-[12px] text-muted-foreground">Không có dòng nào</TableCell>
                    </TableRow>
                  ) : detail.lines.map((line) => {
                    const short = line.ready_qty < line.quantity;
                    const linePct = line.quantity > 0 ? Math.min(100, Math.round((line.ready_qty / line.quantity) * 100)) : 0;

                    return (
                      <TableRow key={line.line_id} className={cn('border-dashed', short && 'bg-amber-50/40 dark:bg-amber-500/5')}>
                        <TableCell className="whitespace-normal text-[12px]">
                          <p className="text-foreground font-medium">{line.book_title}</p>
                        </TableCell>
                        <TableCell className="font-mono text-[12px] text-muted-foreground">{line.sku || line.barcode || '-'}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Progress value={linePct} className="h-1.5 w-16" />
                            <span className={cn(
                              'font-mono text-[11px] font-semibold tabular-nums whitespace-nowrap',
                              short ? 'text-amber-600 dark:text-amber-400' : 'text-foreground',
                            )}>
                              {line.ready_qty}/{line.quantity}
                            </span>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </SectionCard>
          </FadeItem>

          {/* Execution chain: PICK task + REPICK children */}
          {(detail.pick_task || (detail.repick_tasks && detail.repick_tasks.length > 0)) && (
            <FadeItem>
              <div className="rounded-xl border border-border/80 bg-card p-4 shadow-[0_1px_4px_rgba(0,0,0,0.03)] dark:shadow-none">
                <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-3">Execution Chain</p>
                <div className="space-y-2">
                  {/* PICK root task */}
                  {detail.pick_task && (
                    <div className="rounded-[10px] border border-sky-100 bg-sky-50/50 p-3 dark:border-sky-500/20 dark:bg-sky-500/10">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="rounded-full bg-sky-100 text-sky-700 px-2 py-0.5 text-[10px] font-bold dark:bg-sky-500/15 dark:text-sky-400">PICK</span>
                          <span className="text-[12px] font-semibold text-sky-900 dark:text-sky-300">{detail.pick_task.task_number}</span>
                        </div>
                        <span className={cn('rounded-full border px-2 py-0.5 text-[10px] font-semibold', TONE_CLASSNAME[getPickingTaskStatusVariant(detail.pick_task.status)])}>
                          {detail.pick_task.status}
                        </span>
                      </div>
                      {detail.pick_task.items.length > 0 && (
                        <div className="mt-2 text-[11px] text-muted-foreground">
                          Yêu cầu: {detail.pick_task.items.reduce((s, i) => s + i.requested_qty, 0)} ·
                          Đã lấy: {detail.pick_task.items.reduce((s, i) => s + i.picked_qty, 0)}
                        </div>
                      )}
                    </div>
                  )}

                  {/* REPICK children */}
                  {(detail.repick_tasks || []).map((rt, idx) => (
                    <div key={rt.picking_task_id} className="ml-4 rounded-[10px] border border-amber-100 bg-amber-50/40 p-3 dark:border-amber-500/20 dark:bg-amber-500/10">
                      <div className="flex items-center gap-1 mb-1">
                        <span className="text-muted-foreground text-[11px]">{idx === (detail.repick_tasks!.length - 1) ? '└─' : '├─'}</span>
                        <div className="flex items-center justify-between flex-1">
                          <div className="flex items-center gap-2">
                            <span className="rounded-full bg-amber-100 text-amber-700 px-2 py-0.5 text-[10px] font-bold dark:bg-amber-500/15 dark:text-amber-400">REPICK</span>
                            <span className="text-[12px] font-semibold text-amber-900 dark:text-amber-300">{rt.task_number}</span>
                          </div>
                          <span className={cn('rounded-full border px-2 py-0.5 text-[10px] font-semibold', TONE_CLASSNAME[getPickingTaskStatusVariant(rt.status)])}>
                            {rt.status}
                          </span>
                        </div>
                      </div>
                      {rt.items.length > 0 && (
                        <div className="ml-5 text-[11px] text-muted-foreground">
                          Yêu cầu: {rt.items.reduce((s, i) => s + i.requested_qty, 0)} ·
                          Đã lấy: {rt.items.reduce((s, i) => s + i.picked_qty, 0)}
                          {rt.items.reduce((s, i) => s + i.short_qty, 0) > 0 && (
                            <span className="text-amber-600 dark:text-amber-400"> · Thiếu: {rt.items.reduce((s, i) => s + i.short_qty, 0)}</span>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </FadeItem>
          )}

          <FadeItem>
            <Alert className="border-emerald-200/60 bg-emerald-50/50 dark:border-emerald-500/20 dark:bg-emerald-500/10">
              <CheckCircle2 className="text-emerald-600 dark:text-emerald-400" />
              <AlertDescription className="text-emerald-800 dark:text-emerald-300">
                {detail.task_type === 'transfer'
                  ? 'Sau khi xác nhận xuất kho chuyển kho, hàng chuyển sang trạng thái IN_TRANSIT. Manager kho đích cần giao task nhận hàng cho nhân viên.'
                  : 'Sau khi xác nhận xuất kho, đơn sẽ chuyển sang trạng thái COMPLETED.'}
              </AlertDescription>
            </Alert>
          </FadeItem>

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
