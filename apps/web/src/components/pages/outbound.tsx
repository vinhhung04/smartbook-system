import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, CheckCircle2, PackageCheck, ScanLine, UserCheck } from 'lucide-react';
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
import { Button, IconButton } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';

function taskLabel(taskType: 'outbound' | 'transfer'): string {
  return taskType === 'transfer' ? 'Chuyển kho' : 'Xuất kho';
}

function outboundStatusBadge(status: string): { label: string; variant: string } {
  switch (status) {
    case 'APPROVED':     return { label: 'Đã duyệt', variant: 'info' };
    case 'PICKING':      return { label: 'Đang lấy', variant: 'info' };
    case 'PARTIAL_PICKED': return { label: 'Lấy một phần', variant: 'amber' };
    case 'REPICKING':    return { label: 'Đang re-pick', variant: 'warning' };
    case 'READY_FOR_OUTBOUND':
    case 'READY_TO_SHIP': return { label: 'Sẵn xuất kho', variant: 'success' };
    case 'COMPLETED':    return { label: 'Hoàn tất', variant: 'neutral' };
    case 'CANCELLED':    return { label: 'Đã hủy', variant: 'danger' };
    default:             return { label: status, variant: 'neutral' };
  }
}

function canConfirmOutbound(status: string, aggregateRemaining?: number): boolean {
  if (status === 'READY_FOR_OUTBOUND' || status === 'READY_TO_SHIP') return true;
  // REPICKING allowed when aggregate pick + repick chain is complete
  if (status === 'REPICKING') return (aggregateRemaining ?? 1) === 0;
  return false;
}

export function OutboundPage() {
  const [loading, setLoading] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [selectedWarehouseId, setSelectedWarehouseId] = useState('');

  const [query, setQuery] = useState('');
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

  const filteredQueue = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return queue;

    return queue.filter((item) => (
      item.order_number.toLowerCase().includes(keyword)
      || String(item.source_warehouse_code || '').toLowerCase().includes(keyword)
      || String(item.target_warehouse_code || '').toLowerCase().includes(keyword)
      || taskLabel(item.task_type).toLowerCase().includes(keyword)
    ));
  }, [queue, query]);

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
      } else if (response.data.destination_receipt_number) {
        toast.success(`Đã xuất kho. Phiếu nhập tại kho đích: ${response.data.destination_receipt_number}`);
      } else {
        toast.success('Đã xác nhận xuất kho thành công');
      }

      await loadQueue(canManageQueue ? (selectedWarehouseId || undefined) : undefined);
      setDetail(null);
      setSelectedTaskId('');
      setSelectedTaskType(null);
      setScanCode('');
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
    ? ['Mã đơn', 'Loại', 'Kho nguồn', 'Kho đích', 'Trạng thái', 'Tổng SL', 'Sẵn sàng', 'Nhân viên xuất kho', 'Thao tác']
    : ['Mã đơn', 'Loại', 'Kho nguồn', 'Kho đích', 'Trạng thái', 'Tổng SL', 'Sẵn sàng', 'Thao tác'];

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
          <FadeItem>
            <FilterBar
              searchValue={query}
              onSearchChange={setQuery}
              searchPlaceholder="Mã đơn / kho / loại đơn"
              filters={canManageQueue ? (
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
              ) : undefined}
            />
          </FadeItem>

          <FadeItem>
            <SectionCard noPadding>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border bg-gradient-to-r from-sky-50/30 to-transparent">
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
                      <td colSpan={tableHeads.length}>
                        <EmptyState variant="no-data" title="Không có đơn nào cần xuất kho" className="py-10" />
                      </td>
                    </tr>
                  ) : filteredQueue.map((task) => {
                    const key = `${task.task_type}:${task.task_id}`;
                    const selectedStaffId = assigningStaffByTask[key] || '';
                    const assignedName = getAssignedStaffName(task.outbound_assigned_user_id);
                    const isAssigning = assigningTaskKey === key;

                    return (
                      <tr key={key} className="border-b border-border last:border-0 hover:bg-muted/50 transition-colors">
                        <td className="px-4 py-3 text-[12px] font-semibold">
                          <div>{task.order_number}</div>
                          {(task.repick_count ?? 0) > 0 && (
                            <div className="mt-0.5 text-[10px] text-amber-600 dark:text-amber-400">
                              {task.repick_count} repick{(task.active_repick_count ?? 0) > 0 ? ` · ${task.active_repick_count} chưa xong` : ''}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3 text-[12px] text-muted-foreground">{taskLabel(task.task_type)}</td>
                        <td className="px-4 py-3 text-[12px] text-muted-foreground">{task.source_warehouse_code || '-'}</td>
                        <td className="px-4 py-3 text-[12px] text-muted-foreground">{task.target_warehouse_code || '-'}</td>
                        <td className="px-4 py-3 text-[12px]">
                          {(() => { const b = outboundStatusBadge(task.status); return (
                            <StatusBadge label={b.label} variant={b.variant} dot />
                          ); })()}
                        </td>
                        <td className="px-4 py-3 text-[12px] text-muted-foreground">{task.total_quantity}</td>
                        <td className="px-4 py-3 text-[12px] font-semibold">{task.ready_quantity}</td>
                        {canManageQueue ? (
                          <td className="px-4 py-3">
                            {assignedName && !selectedStaffId ? (
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] text-emerald-700 font-semibold dark:bg-emerald-500/10 dark:text-emerald-400">
                                  <UserCheck className="w-3 h-3" /> {assignedName}
                                </span>
                                <button
                                  onClick={() => setAssigningStaffByTask((prev) => ({ ...prev, [key]: 'PICK' }))}
                                  className="text-[10px] text-muted-foreground hover:text-foreground underline"
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
                          </td>
                        ) : null}
                        <td className="px-4 py-3">
                          <Button size="sm" variant="outline" onClick={() => void handleOpen(task)}>
                            Xem & xuất <ArrowRight className="w-3 h-3" />
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            </SectionCard>
          </FadeItem>
        </>
      ) : (
        <>
          <FadeItem>
            <div className="rounded-xl border border-border bg-card p-5 shadow-[0_1px_4px_rgba(0,0,0,0.03)]">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div>
                  <p className="text-[11px] text-muted-foreground font-semibold">Đơn đang thao tác xuất kho</p>
                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                    <h2 className="text-[15px] font-semibold">{detail.order_number} · {taskLabel(detail.task_type)}</h2>
                    {(() => { const b = outboundStatusBadge(detail.status); return (
                      <StatusBadge label={b.label} variant={b.variant} dot />
                    ); })()}
                  </div>
                  <p className="text-[12px] text-muted-foreground mt-1">
                    Nguồn: {detail.source_warehouse_code || '-'}
                    {detail.target_warehouse_code ? ` | Đích: ${detail.target_warehouse_code}` : ''}
                    {` | Số dòng: ${detail.lines.length}`}
                  </p>
                  {detail.aggregate_requested_qty !== undefined && (
                    <p className="text-[11px] text-muted-foreground mt-1">
                      Tổng: <span className="font-semibold">{detail.aggregate_picked_qty}</span>/{detail.aggregate_requested_qty} cuốn
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
                <Button
                  variant="outline"
                  onClick={() => {
                    setDetail(null);
                    setSelectedTaskId('');
                    setSelectedTaskType(null);
                    setScanCode('');
                  }}
                >
                  Quay lại hàng đợi
                </Button>
              </div>
            </div>
          </FadeItem>

          <FadeItem>
            <div className="rounded-xl border border-border bg-card p-5 shadow-[0_1px_4px_rgba(0,0,0,0.03)]">
              <h3 className="text-[14px] font-semibold mb-3">Quét mã và xác nhận xuất kho</h3>
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
                  className="flex-1 min-w-[200px] h-auto py-2.5"
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
                  disabled={!canConfirmOutbound(detail.status, detail.aggregate_remaining_qty)}
                  loading={confirming}
                  title={!canConfirmOutbound(detail.status, detail.aggregate_remaining_qty) ? `Đơn đang ở trạng thái ${detail.status} — chưa thể xuất kho` : undefined}
                  className="bg-gradient-to-r from-blue-600 to-indigo-600 hover:opacity-90"
                >
                  Xác nhận xuất kho
                </Button>
              </div>

              {loadingDetail ? <p className="text-[12px] text-muted-foreground mt-3">Đang tải chi tiết...</p> : null}
            </div>
          </FadeItem>

          <FadeItem>
            <div className="overflow-hidden rounded-xl border border-border bg-card shadow-[0_1px_4px_rgba(0,0,0,0.03)]">
              <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border bg-gradient-to-r from-sky-50/30 to-transparent">
                    <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">Sản phẩm</th>
                    <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">SKU/Mã vạch</th>
                    <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground w-[100px]">Yêu cầu</th>
                    <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground w-[100px]">Đã lấy</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.lines.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-4 py-6 text-[12px] text-muted-foreground text-center">Không có dòng nào</td>
                    </tr>
                  ) : detail.lines.map((line) => (
                    <tr key={line.line_id} className="border-b border-border last:border-0 text-[12px]">
                      <td className="px-4 py-3">
                        <p className="text-foreground font-medium">{line.book_title}</p>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{line.sku || line.barcode || '-'}</td>
                      <td className="px-4 py-3 text-muted-foreground">{line.quantity}</td>
                      <td className="px-4 py-3 font-semibold">{line.ready_qty}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            </div>
          </FadeItem>

          {/* Execution chain: PICK task + REPICK children */}
          {(detail.pick_task || (detail.repick_tasks && detail.repick_tasks.length > 0)) && (
            <FadeItem>
              <div className="rounded-xl border border-border/80 bg-card p-4 shadow-[0_1px_4px_rgba(0,0,0,0.03)]">
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
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                          detail.pick_task.status === 'COMPLETED' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400'
                          : detail.pick_task.status === 'PICKING' ? 'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-400'
                          : 'bg-muted text-muted-foreground'}`}>
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
                          <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                            rt.status === 'COMPLETED' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400'
                            : rt.status === 'PICKING' ? 'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-400'
                            : 'bg-muted text-muted-foreground'}`}>
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
