import { useEffect, useMemo, useState } from 'react';
import confetti from 'canvas-confetti';
import { ArrowLeft, ArrowRight, CheckCircle2, Clock, CornerDownRight, ListChecks, PackageCheck, ScanLine, Truck, UserCheck } from 'lucide-react';
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
import { canAccess, canManageReceiving, ROUTE_ACCESS } from '@/lib/rbac';
import { PageHeader } from '@/components/ui/page-header';
import { FilterBar } from '@/components/ui/filter-bar';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { StatusBadge } from '@/components/status-badge';
import { type WorkflowStep } from '@/components/ui';
import { ListFooter } from './borrow-shared/list-footer';
import { Progress } from '@/components/ui/progress';
import { Button, IconButton } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/components/ui/utils';
import { getPickingTaskStatusVariant, getStatusVariant, getWarehouseTaskStatusLabel } from '@/lib/status-registry';
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
  REPICKING: 'Đang lấy bù',
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

  const STATUS_ITEMS: Array<{ value: 'ALL' | 'READY' | 'PROCESSING'; label: string; count: number }> = [
    { value: 'ALL', label: 'Tất cả đơn', count: queueStats.total },
    { value: 'READY', label: 'Sẵn xuất kho', count: queueStats.ready },
    { value: 'PROCESSING', label: 'Đang lấy hàng', count: queueStats.processing },
  ];

  const warehouseSelect = canManageQueue ? (
    <Select value={selectedWarehouseId || 'all'} onValueChange={(value) => setSelectedWarehouseId(value === 'all' ? '' : value)}>
      <SelectTrigger size="sm" className="w-[220px]" aria-label="Kho xuất">
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
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="inline-flex min-w-0 items-center gap-1.5 text-[13px] text-foreground">
            <UserCheck className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="truncate" title={assignedName}>{assignedName}</span>
          </span>
          <button
            type="button"
            onClick={() => setAssigningStaffByTask((prev) => ({ ...prev, [key]: 'PICK' }))}
            className="rounded text-[12px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={`Đổi nhân viên xuất kho cho ${task.order_number}`}
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
          <SelectTrigger size="sm" className="h-8 min-w-0 flex-1 text-[12px]" aria-label={`Nhân viên xuất kho cho ${task.order_number}`}>
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
          variant="outline"
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

  const routeText = (taskType: 'outbound' | 'transfer', from: string | null | undefined, to: string | null | undefined) =>
    `${taskLabel(taskType)}${from ? ` từ ${from}` : ''}${to ? ` đến ${to}` : ''}`;

  if (detail) {
    const steps = outboundWorkflowSteps(detail.status);
    const requested = detail.aggregate_requested_qty;
    const picked = detail.aggregate_picked_qty ?? 0;
    const remaining = detail.aggregate_remaining_qty ?? 0;
    const pickedPct = requested ? Math.min(100, Math.round((picked / requested) * 100)) : 0;
    const assignedName = getAssignedStaffName(detail.outbound_assigned_user_id);
    const pickRuns = [
      ...(detail.pick_task ? [{ kind: 'Lấy hàng', task: detail.pick_task }] : []),
      ...(detail.repick_tasks || []).map((task) => ({ kind: 'Lấy bù', task })),
    ];

    return (
      <PageWrapper className="space-y-6">
        <FadeItem>
          <Button variant="ghost" size="sm" onClick={handleBackToQueue} className="-ml-3 text-muted-foreground">
            <ArrowLeft className="h-4 w-4" /> Hàng đợi xuất kho
          </Button>
          <div className="mt-2 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
            <div className="min-w-0">
              <h1 className="break-all font-mono text-[24px] font-semibold tracking-tight text-foreground">{detail.order_number}</h1>
              <p className="mt-1 text-[14px] text-muted-foreground">
                {routeText(detail.task_type, detail.source_warehouse_code, detail.target_warehouse_code)}, {detail.lines.length} dòng sách.
              </p>
            </div>
            {statusBadge(detail.status)}
          </div>
        </FadeItem>

        <FadeItem>
          <ol aria-label="Tiến trình đơn" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {steps.map((step, index) => (
              <li
                key={step.id}
                aria-current={step.status === 'active' ? 'step' : undefined}
                className={cn(
                  'flex items-center gap-2.5 rounded-xl border px-3 py-2.5 text-[13px]',
                  step.status === 'active' && 'border-primary/40 bg-primary/[0.06] font-semibold text-primary',
                  step.status === 'completed' && 'border-border text-foreground',
                  step.status === 'pending' && 'border-border text-muted-foreground',
                  step.status === 'error' && 'border-red-200 bg-red-50 text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300',
                )}
              >
                {step.status === 'completed' ? (
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-label="Xong" />
                ) : (
                  <span
                    className={cn(
                      'flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] tabular-nums',
                      step.status === 'active' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground',
                    )}
                    aria-hidden="true"
                  >
                    {index + 1}
                  </span>
                )}
                <span className="min-w-0">{step.label}</span>
              </li>
            ))}
          </ol>
        </FadeItem>

        <FadeItem>
          <div className="@container/page">
            <div className="grid grid-cols-1 items-start gap-5 @4xl/page:grid-cols-[minmax(0,1fr)_320px]">
              <div className="min-w-0 space-y-5">
                <section aria-labelledby="outbound-lines-title" className="@container overflow-hidden rounded-2xl border border-border bg-card">
                  <div className="px-5 pb-3 pt-4">
                    <h2 id="outbound-lines-title" className="font-serif text-[17px] font-semibold tracking-tight">Sách trong đơn</h2>
                    <p className="mt-0.5 text-[13px] text-muted-foreground">Dòng nền vàng là dòng chưa lấy đủ số lượng.</p>
                  </div>
                  <Table className="table-fixed">
                    <TableHeader>
                      <TableRow className="hover:bg-transparent">
                        <TableHead className="pl-5 text-[12px] font-medium text-muted-foreground">Sách</TableHead>
                        <TableHead className="hidden w-[220px] text-[12px] font-medium text-muted-foreground @xl:table-cell">SKU / mã vạch</TableHead>
                        <TableHead className="w-[120px] pr-5 text-[12px] font-medium text-muted-foreground">Đã lấy</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {detail.lines.length === 0 ? (
                        <TableRow className="hover:bg-transparent">
                          <TableCell colSpan={3} className="whitespace-normal py-8 text-center text-[13px] text-muted-foreground">Đơn không có dòng sách nào.</TableCell>
                        </TableRow>
                      ) : detail.lines.map((line) => {
                        const short = line.ready_qty < line.quantity;
                        const linePct = line.quantity > 0 ? Math.min(100, Math.round((line.ready_qty / line.quantity) * 100)) : 0;
                        return (
                          <TableRow key={line.line_id} className={cn(short && 'bg-amber-50/60 hover:bg-amber-50/80 dark:bg-amber-500/[0.06] dark:hover:bg-amber-500/10')}>
                            <TableCell className="whitespace-normal py-3.5 pl-5 align-top">
                              <p className="line-clamp-2 text-[14px] font-medium text-foreground" title={line.book_title}>{line.book_title}</p>
                              <p className="mt-0.5 truncate font-mono text-[12px] text-muted-foreground @xl:hidden">{line.sku || line.barcode || '-'}</p>
                            </TableCell>
                            <TableCell className="hidden py-3.5 align-top font-mono text-[12px] text-muted-foreground @xl:table-cell">
                              <span className="block truncate" title={line.sku || line.barcode || undefined}>{line.sku || line.barcode || '-'}</span>
                            </TableCell>
                            <TableCell className="py-3.5 pr-5 align-top">
                              <p className={cn('font-serif text-[17px] font-semibold leading-tight tabular-nums', short ? 'text-amber-800 dark:text-amber-300' : 'text-foreground')}>
                                {line.ready_qty}<span className="font-sans text-[12px] font-normal text-muted-foreground"> / {line.quantity}</span>
                              </p>
                              <Progress value={linePct} className="mt-1.5 h-1.5" aria-label={`Đã lấy ${linePct}%`} />
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </section>

                {pickRuns.length > 0 && (
                  <section aria-labelledby="outbound-runs-title" className="overflow-hidden rounded-2xl border border-border bg-card">
                    <div className="border-b border-border px-5 pb-3 pt-4">
                      <h2 id="outbound-runs-title" className="font-serif text-[17px] font-semibold tracking-tight">Lượt lấy hàng</h2>
                      <p className="mt-0.5 text-[13px] text-muted-foreground">Lượt lấy chính và các lượt lấy bù khi kệ thiếu hàng.</p>
                    </div>
                    <ol>
                      {pickRuns.map(({ kind, task }) => {
                        const runRequested = task.items.reduce((s, i) => s + i.requested_qty, 0);
                        const runPicked = task.items.reduce((s, i) => s + i.picked_qty, 0);
                        const shortQty = task.items.reduce((s, i) => s + i.short_qty, 0);
                        const repick = kind === 'Lấy bù';
                        return (
                          <li key={task.task_number} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 border-b border-border px-5 py-3 last:border-0">
                            <div className={cn('flex min-w-0 items-start gap-2', repick && 'pl-5')}>
                              {repick && <CornerDownRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
                              <div className="min-w-0">
                                <p className="text-[14px] font-medium text-foreground">
                                  {kind} <span className="ml-1 font-mono text-[12px] font-normal text-muted-foreground">{task.task_number}</span>
                                </p>
                                {task.items.length > 0 && (
                                  <p className="text-[12px] text-muted-foreground">
                                    Đã lấy {runPicked}/{runRequested} cuốn
                                    {shortQty > 0 && <span className="text-amber-800 dark:text-amber-300">, thiếu {shortQty}</span>}
                                  </p>
                                )}
                              </div>
                            </div>
                            <StatusBadge label={getWarehouseTaskStatusLabel(task.status)} variant={getPickingTaskStatusVariant(task.status)} />
                          </li>
                        );
                      })}
                    </ol>
                  </section>
                )}
              </div>

              <aside aria-labelledby="outbound-confirm-title" className="@4xl/page:sticky @4xl/page:top-4">
                <section className="rounded-2xl border border-border bg-card p-5">
                  <h2 id="outbound-confirm-title" className="font-serif text-[17px] font-semibold tracking-tight">Xác nhận xuất kho</h2>

                  {requested !== undefined && (
                    <div className="mt-4">
                      <p className="text-[12px] text-muted-foreground">Đã lấy</p>
                      <p className="font-serif text-[32px] font-semibold leading-none tabular-nums text-foreground">
                        {picked}<span className="font-sans text-[14px] font-normal text-muted-foreground"> / {requested} cuốn</span>
                      </p>
                      <Progress value={pickedPct} className="mt-2.5 h-1.5" aria-label={`Đã lấy ${pickedPct}%`} />
                      {remaining > 0 && <p className="mt-1.5 text-[12px] text-amber-800 dark:text-amber-300">Còn thiếu {remaining} cuốn.</p>}
                    </div>
                  )}

                  {assignedName && (
                    <p className="mt-4 flex items-center gap-1.5 text-[13px] text-muted-foreground">
                      <UserCheck className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                      Nhân viên xuất kho: <span className="truncate font-medium text-foreground">{assignedName}</span>
                    </p>
                  )}

                  <div className="mt-4 border-t border-border pt-4">
                    {detailConfirmable ? (
                      <p className="mb-3 flex items-start gap-1.5 text-[13px] font-medium text-emerald-700 dark:text-emerald-400">
                        <ScanLine className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /> Đơn đã sẵn sàng. Quét hoặc nhập mã đơn để xác nhận.
                      </p>
                    ) : (
                      <p className="mb-3 text-[13px] text-amber-800 dark:text-amber-300">
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
                        autoComplete="off"
                        className="h-11 min-w-0 flex-1 font-mono"
                      />
                      <IconButton variant="outline" onClick={() => setShowScanModal(true)} disabled={confirming} label="Quét mã đơn" className="h-11 w-11 shrink-0">
                        <ScanLine className="h-4 w-4" />
                      </IconButton>
                    </div>
                    <Button onClick={() => void handleConfirm()} disabled={!detailConfirmable} loading={confirming} className="mt-3 h-11 w-full">
                      <Truck className="h-4 w-4" /> Xác nhận xuất kho
                    </Button>
                    <p className="mt-3 text-[12px] leading-relaxed text-muted-foreground">
                      {detail.task_type === 'transfer'
                        ? 'Sau khi xác nhận, hàng chuyển sang trạng thái đang vận chuyển. Quản lý kho đích cần giao việc nhận hàng cho nhân viên.'
                        : 'Sau khi xác nhận, đơn chuyển sang trạng thái hoàn tất.'}
                    </p>
                    {loadingDetail ? <p className="mt-3 text-[12px] text-muted-foreground">Đang tải chi tiết...</p> : null}
                  </div>
                </section>
              </aside>
            </div>
          </div>
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
      </PageWrapper>
    );
  }

  const lede = queue.length === 0
    ? 'Hàng đợi xuất kho đang trống.'
    : `${queueStats.total} đơn trong hàng đợi, ${queueStats.ready} sẵn sàng xuất kho${canManageQueue && queueStats.unassigned > 0 ? `, ${queueStats.unassigned} chưa có nhân viên` : ''}.`;

  const railButton = (active: boolean, onClick: () => void, label: string, count?: number) => (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
        active ? 'bg-primary/[0.08] text-primary' : 'text-foreground hover:bg-muted/60',
      )}
    >
      <span className={cn('min-w-0 truncate text-[13px]', active ? 'font-semibold' : 'font-medium')} title={label}>{label}</span>
      {count !== undefined && <span className={cn('shrink-0 text-[12px] tabular-nums', active ? 'text-primary' : 'text-muted-foreground')}>{count}</span>}
    </button>
  );
  const columnCount = canManageQueue ? 4 : 3;

  return (
    <PageWrapper className="space-y-6">
      <FadeItem>
        <PageHeader
          icon={PackageCheck}
          title="Xuất kho"
          description={(
            <>
              {lede}
              {canAccess(currentUser, ROUTE_ACCESS.orderRequests) && (
                <>
                  {' '}Đơn mới đến từ{' '}
                  <NavLink to="/order-requests" className="whitespace-nowrap rounded font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    Yêu cầu xuất kho
                  </NavLink>
                  .
                </>
              )}
            </>
          )}
        />
      </FadeItem>

      <FadeItem>
        <div className="@container/page">
          <div className="grid grid-cols-1 items-start gap-4 @4xl/page:grid-cols-[220px_minmax(0,1fr)]">
            <nav aria-label="Lọc đơn xuất kho" className="hidden max-h-[calc(100vh-7rem)] overflow-y-auto rounded-2xl border border-border bg-card p-3 @4xl/page:sticky @4xl/page:top-4 @4xl/page:block">
              <p className="px-3 pb-1.5 text-[12px] font-semibold text-muted-foreground">Tình trạng</p>
              {STATUS_ITEMS.map((item) => (
                <div key={item.value}>{railButton(statusFilter === item.value, () => setStatusFilter(item.value), item.label, item.count)}</div>
              ))}
              {canManageQueue && warehouses.length > 0 && (
                <div className="mt-3 border-t border-border pt-3">
                  <p className="px-3 pb-1.5 text-[12px] font-semibold text-muted-foreground">Kho xuất</p>
                  {warehouses.map((warehouse) => (
                    <div key={warehouse.id}>{railButton(selectedWarehouseId === warehouse.id, () => setSelectedWarehouseId(warehouse.id), warehouse.name)}</div>
                  ))}
                </div>
              )}
            </nav>

            <section aria-labelledby="outbound-queue-title" className="@container min-w-0 overflow-hidden rounded-2xl border border-border bg-card">
              <div className="px-5 pb-1 pt-4">
                <h2 id="outbound-queue-title" className="font-serif text-[18px] font-semibold tracking-tight">
                  {statusFilter === 'READY' ? 'Đơn sẵn xuất kho' : statusFilter === 'PROCESSING' ? 'Đơn đang lấy hàng' : 'Hàng đợi xuất kho'}
                </h2>
                <p className="mt-0.5 text-[13px] text-muted-foreground">
                  {canManageQueue ? 'Giao việc và xác nhận xuất kho cho các đơn đã lấy hàng xong.' : 'Xác nhận xuất kho cho các đơn được giao cho bạn.'}
                </p>
                {canManageQueue && queueStats.unassigned > 0 && (
                  <p className="mt-2 flex items-start gap-2 text-[13px] text-amber-800 dark:text-amber-300">
                    <Clock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                    {queueStats.unassigned} đơn chưa có nhân viên xuất kho. Chọn nhân viên cho từng đơn rồi bấm Giao.
                  </p>
                )}
              </div>
              <div className="border-b border-border px-4 py-3">
                <FilterBar
                  searchValue={query}
                  onSearchChange={setQuery}
                  searchPlaceholder="Mã đơn, mã kho hoặc loại đơn"
                  showSearchClear
                  filters={(
                    <div className="flex flex-wrap items-center gap-2 @4xl/page:hidden">
                      {warehouseSelect}
                      <div className="max-w-full overflow-x-auto">
                        <SegmentedControl
                          options={STATUS_ITEMS.map((item) => ({ value: item.value, label: `${item.value === 'ALL' ? 'Tất cả' : item.label} (${item.count})` }))}
                          value={statusFilter}
                          onChange={(v) => setStatusFilter(v as 'ALL' | 'READY' | 'PROCESSING')}
                          layoutId="outbound-status-filter"
                          className="w-max"
                        />
                      </div>
                    </div>
                  )}
                />
              </div>

              <Table className="table-fixed">
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    {[
                      { label: 'Đơn hàng', className: 'pl-5' },
                      { label: 'Đã lấy', className: 'hidden w-[130px] @xl:table-cell' },
                      ...(canManageQueue ? [{ label: 'Nhân viên xuất kho', className: 'hidden w-[250px] @2xl:table-cell' }] : []),
                      { label: '', className: 'w-[130px] pr-5' },
                    ].map((head, index) => (
                      <TableHead key={index} className={cn('px-3 text-[12px] font-medium text-muted-foreground', head.className)}>
                        {head.label || <span className="sr-only">Thao tác</span>}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pagedQueue.length === 0 ? (
                    <TableRow className="hover:bg-transparent">
                      <TableCell colSpan={columnCount} className="whitespace-normal py-12 text-center">
                        <EmptyState
                          variant={query ? 'no-results' : 'inbox'}
                          title={query ? 'Không tìm thấy đơn phù hợp' : 'Không có đơn nào cần xuất kho'}
                          description={query ? 'Thử tìm theo mã đơn hoặc mã kho.' : 'Đơn xuất kho và chuyển kho đã duyệt sẽ hiện ở đây cùng tiến độ lấy hàng.'}
                        />
                      </TableCell>
                    </TableRow>
                  ) : pagedQueue.map((task) => {
                    const key = `${task.task_type}:${task.task_id}`;
                    const progressPct = task.total_quantity > 0 ? Math.min(100, Math.round((task.ready_quantity / task.total_quantity) * 100)) : 0;
                    const ready = READY_STATUSES.has(task.status);
                    return (
                      <TableRow key={key} className="hover:bg-muted/40">
                        <TableCell className="whitespace-normal py-3.5 pl-5 pr-3 align-top">
                          <button
                            type="button"
                            onClick={() => void handleOpen(task)}
                            className="block max-w-full truncate rounded text-left font-mono text-[13px] font-semibold text-foreground underline-offset-4 hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            title={task.order_number}
                          >
                            {task.order_number}
                          </button>
                          <p className="mt-0.5 line-clamp-2 text-[12px] text-muted-foreground">
                            {routeText(task.task_type, task.source_warehouse_code, task.target_warehouse_code)}
                          </p>
                          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                            {statusBadge(task.status)}
                            {(task.repick_count ?? 0) > 0 && (
                              <span className="text-[12px] text-amber-800 dark:text-amber-300">
                                {task.repick_count} lần lấy bù{(task.active_repick_count ?? 0) > 0 ? `, ${task.active_repick_count} chưa xong` : ''}
                              </span>
                            )}
                          </div>
                          <p className="mt-1.5 text-[12px] text-muted-foreground @xl:hidden">
                            Đã lấy <span className="font-semibold tabular-nums text-foreground">{task.ready_quantity}/{task.total_quantity}</span> cuốn
                          </p>
                          {canManageQueue && <div className="mt-2 @2xl:hidden">{assignControl(task)}</div>}
                        </TableCell>
                        <TableCell className="hidden px-3 py-3.5 align-top @xl:table-cell">
                          <p className="font-serif text-[18px] font-semibold leading-tight tabular-nums">
                            {task.ready_quantity}<span className="font-sans text-[12px] font-normal text-muted-foreground"> / {task.total_quantity} cuốn</span>
                          </p>
                          <Progress value={progressPct} className="mt-1.5 h-1.5" aria-label={`Đã lấy ${progressPct}%`} />
                        </TableCell>
                        {canManageQueue && <TableCell className="hidden px-3 py-3.5 align-top @2xl:table-cell">{assignControl(task)}</TableCell>}
                        <TableCell className="py-3.5 pl-3 pr-5 text-right align-top">
                          <Button size="sm" variant={ready ? 'default' : 'outline'} onClick={() => void handleOpen(task)}>
                            {ready ? <>Xuất kho <ArrowRight className="h-3.5 w-3.5" /></> : 'Xem'}
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
              <ListFooter
                page={page}
                pageSize={PAGE_SIZE}
                total={filteredQueue.length}
                totalPages={totalPages}
                shown={pagedQueue.length}
                noun="đơn"
                onPageChange={setPage}
              />
            </section>
          </div>
        </div>
      </FadeItem>
    </PageWrapper>
  );
}
