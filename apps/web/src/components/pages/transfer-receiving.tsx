import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, CheckCircle2, PackageCheck, UserCheck } from 'lucide-react';
import { toast } from 'sonner';
import { NavLink } from 'react-router';
import { FadeItem, PageWrapper } from '../motion-utils';
import { getApiErrorMessage } from '@/services/api.ts';
import { authService } from '@/services/auth';
import { warehouseService, type Warehouse } from '@/services/warehouse';
import { transferReceivingService, type TransferReceivingItem, type TransferReceivingLine } from '@/services/transfer-receiving';
import { userService, type WarehouseStaffOption } from '@/services/user';
import { canManageReceiving } from '@/lib/rbac';
import { PageHeader } from '@/components/ui/page-header';
import { LoadingOverlay } from '@/components/ui/loading-state';
import { EmptyState } from '@/components/ui/empty-state';
import { StatusBadge } from '@/components/status-badge';
import { SectionCard } from '@/components/ui/section-card';
import { FilterBar } from '@/components/ui/filter-bar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { cn } from '@/components/ui/utils';

type LineCount = { delivered: number; damaged: number; rejected: number };

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

  const [countingItem, setCountingItem] = useState<TransferReceivingItem | null>(null);
  const [lines, setLines] = useState<TransferReceivingLine[]>([]);
  const [loadingLines, setLoadingLines] = useState(false);
  const [counts, setCounts] = useState<Record<string, LineCount>>({});

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

  const finishConfirm = async (item: TransferReceivingItem, items?: Parameters<typeof transferReceivingService.confirmReceiving>[1]) => {
    try {
      setConfirming(item.id);
      const result = await transferReceivingService.confirmReceiving(item.id, items);
      toast.success(
        `Đã nhận hàng từ chuyển kho ${item.transfer_number}. Phiếu nhập: ${result.data.goods_receipt_number}`
      );
      setCountingItem(null);
      await loadQueue(canManageQueue ? (selectedWarehouseId || undefined) : undefined);
    } catch (error) {
      toast.error(getApiErrorMessage(error, 'Xác nhận nhận hàng thất bại'));
    } finally {
      setConfirming('');
    }
  };

  // "Đã nhận hàng" opens the counting step instead of confirming outright - what was
  // shipped is not what necessarily arrived; staff must say so explicitly (quick
  // "nhận đủ" action further below is the one exception, and it is still a click).
  const openCounting = async (item: TransferReceivingItem) => {
    setCountingItem(item);
    setLines([]);
    setCounts({});
    try {
      setLoadingLines(true);
      const response = await transferReceivingService.getLines(item.id);
      const nextLines = response.data.items;
      setLines(nextLines);
      setCounts(Object.fromEntries(nextLines.map((line) => [
        line.transfer_order_item_id,
        { delivered: line.shipped_qty, damaged: 0, rejected: 0 },
      ])));
    } catch (error) {
      toast.error(getApiErrorMessage(error, 'Không tải được chi tiết chuyến hàng'));
      setCountingItem(null);
    } finally {
      setLoadingLines(false);
    }
  };

  const handleConfirmFull = (item: TransferReceivingItem) => void finishConfirm(item);

  const handleConfirmCounted = () => {
    if (!countingItem) return;
    const payload = lines.map((line) => {
      const count = counts[line.transfer_order_item_id] || { delivered: line.shipped_qty, damaged: 0, rejected: 0 };
      return {
        transfer_order_item_id: line.transfer_order_item_id,
        delivered_qty: count.delivered,
        damaged_qty: count.damaged,
        rejected_qty: count.rejected,
      };
    });
    void finishConfirm(countingItem, payload);
  };

  const setLineCount = (lineId: string, field: keyof LineCount, value: number) => {
    setCounts((current) => ({
      ...current,
      [lineId]: { ...(current[lineId] || { delivered: 0, damaged: 0, rejected: 0 }), [field]: Math.max(0, Math.floor(value) || 0) },
    }));
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
          <span className="inline-flex items-center gap-1 text-[13px] font-medium text-primary">
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
          description={queue.length === 0
            ? (canManageQueue ? 'Không có chuyến nào đang đến kho này. Chuyến mới hiện ở đây khi kho nguồn xác nhận xuất kho.' : 'Chưa có chuyến nào được giao cho bạn.')
            : `${queue.length} chuyến đang đến${canManageQueue && unassigned > 0 ? `, ${unassigned} chưa có người nhận` : ''}. ${canManageQueue ? 'Giao người nhận rồi xác nhận khi hàng tới.' : 'Xác nhận khi hàng tới kho.'}`}
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
        <ol aria-label="Các bước nhận hàng chuyển kho" className="grid grid-cols-1 gap-px overflow-hidden rounded-2xl border border-border bg-border md:grid-cols-3">
          {flow.map((step, index) => (
            <li key={step.title} className="flex gap-3 bg-card px-4 py-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-border text-[12px] font-semibold tabular-nums text-foreground">
                {index + 1}
              </span>
              <div className="min-w-0">
                <p className="text-[13px] font-medium text-foreground">{step.title}</p>
                <p className="text-[12px] text-muted-foreground">{step.text}</p>
              </div>
            </li>
          ))}
        </ol>
      </FadeItem>

      <FadeItem>
        <section aria-labelledby="transfer-queue-title" className="@container overflow-hidden rounded-2xl border border-border bg-card">
          <div className="px-5 pb-3 pt-4">
            <h2 id="transfer-queue-title" className="font-display text-[18px] font-semibold tracking-tight">Chuyến đang đến</h2>
            <p className="mt-0.5 text-[13px] text-muted-foreground">{`${queue.length} chuyến${canManageQueue && unassigned > 0 ? `, ${unassigned} chưa có người nhận` : ''}`}</p>
          </div>
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
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  {[
                    { label: 'Chuyển kho', className: 'pl-5' },
                    { label: 'Tuyến', className: 'hidden w-[180px] @5xl:table-cell' },
                    { label: 'Số lượng', className: 'hidden w-[100px] text-right @2xl:table-cell' },
                    { label: 'Xuất lúc', className: 'hidden w-[110px] @3xl:table-cell' },
                    ...(canManageQueue ? [{ label: 'Người nhận', className: 'hidden w-[250px] @3xl:table-cell' }] : []),
                    { label: 'Thao tác', className: 'w-[160px] pr-5 text-right' },
                  ].map((header) => (
                    <TableHead key={header.label} className={cn('px-4 py-3 text-[12px] font-normal text-muted-foreground', header.className)}>
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
                      <TableCell className="whitespace-normal py-3 pl-5 pr-4 align-top">
                        <p className="truncate font-mono text-[14px] font-semibold text-foreground">{item.transfer_number}</p>
                        <div className="mt-1 flex flex-wrap items-center gap-2">
                          <StatusBadge label={statusLabel(item.status)} variant="warning" dot />
                          <span className="font-mono text-[12px] text-muted-foreground @5xl:hidden">{route}</span>
                        </div>
                        {/* Columns the container hides move here, so no field is dropped. */}
                        <p className="mt-1 text-[12px] tabular-nums text-muted-foreground @2xl:hidden">{item.total_quantity} cuốn, xuất {shippedAt(item)}</p>
                        <p className="mt-1 hidden text-[12px] tabular-nums text-muted-foreground @2xl:block @3xl:hidden">Xuất {shippedAt(item)}</p>
                        {canManageQueue && <div className="mt-2 @3xl:hidden">{assignControl(item)}</div>}
                      </TableCell>
                      <TableCell className="hidden px-4 py-3 align-top font-mono text-[12px] text-muted-foreground @5xl:table-cell">{route}</TableCell>
                      <TableCell className="hidden px-4 py-3 text-right align-top @2xl:table-cell">
                        <span className="text-[14px] font-semibold tabular-nums">{item.total_quantity}</span>
                        <span className="text-[12px] text-muted-foreground"> cuốn</span>
                      </TableCell>
                      <TableCell className="hidden px-4 py-3 align-top text-[13px] tabular-nums text-muted-foreground @3xl:table-cell">{shippedAt(item)}</TableCell>
                      {canManageQueue && <TableCell className="hidden px-4 py-3 align-top @3xl:table-cell">{assignControl(item)}</TableCell>}
                      <TableCell className="py-3 pl-4 pr-5 text-right align-top">
                        <Button
                          size="sm"
                          onClick={() => void openCounting(item)}
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
        </section>
      </FadeItem>

      <Dialog open={Boolean(countingItem)} onOpenChange={(open) => { if (!open) setCountingItem(null); }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Kiểm đếm hàng nhận — {countingItem?.transfer_number}</DialogTitle>
            <DialogDescription>
              Số lượng đã xuất không phải là số lượng chắc chắn đã nhận. Kiểm đếm từng dòng trước khi xác nhận, hoặc chọn "Nhận đủ" nếu đã kiểm tra và không có vấn đề gì.
            </DialogDescription>
          </DialogHeader>

          {loadingLines ? (
            <div className="py-8 text-center text-[13px] text-muted-foreground">Đang tải...</div>
          ) : (
            <div className="max-h-[50vh] overflow-y-auto rounded-xl border border-border">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="bg-muted/30 text-left text-[12px] text-muted-foreground">
                    <th className="px-3 py-2">Sách</th>
                    <th className="px-2 py-2 text-right">Đã xuất</th>
                    <th className="px-2 py-2 text-right">Thực nhận</th>
                    <th className="px-2 py-2 text-right">Hỏng</th>
                    <th className="px-2 py-2 text-right">Từ chối</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line) => {
                    const count = counts[line.transfer_order_item_id] || { delivered: line.shipped_qty, damaged: 0, rejected: 0 };
                    return (
                      <tr key={line.transfer_order_item_id} className="border-t border-border">
                        <td className="px-3 py-2">
                          <span className="font-medium">{line.title || '-'}</span>
                          <span className="block font-mono text-[11px] text-muted-foreground">{line.isbn13 || line.sku || ''}</span>
                        </td>
                        <td className="px-2 py-2 text-right tabular-nums">{line.shipped_qty}</td>
                        <td className="px-2 py-2 text-right">
                          <Input
                            type="number"
                            min={0}
                            inputMode="numeric"
                            aria-label={`Số thực nhận — ${line.title || line.transfer_order_item_id}`}
                            value={count.delivered}
                            onChange={(event) => setLineCount(line.transfer_order_item_id, 'delivered', Number(event.target.value))}
                            className="ml-auto h-8 w-20 text-right tabular-nums"
                          />
                        </td>
                        <td className="px-2 py-2 text-right">
                          <Input
                            type="number"
                            min={0}
                            inputMode="numeric"
                            aria-label={`Số hỏng — ${line.title || line.transfer_order_item_id}`}
                            value={count.damaged}
                            onChange={(event) => setLineCount(line.transfer_order_item_id, 'damaged', Number(event.target.value))}
                            className="ml-auto h-8 w-16 text-right tabular-nums"
                          />
                        </td>
                        <td className="px-2 py-2 text-right">
                          <Input
                            type="number"
                            min={0}
                            inputMode="numeric"
                            aria-label={`Số từ chối — ${line.title || line.transfer_order_item_id}`}
                            value={count.rejected}
                            onChange={(event) => setLineCount(line.transfer_order_item_id, 'rejected', Number(event.target.value))}
                            className="ml-auto h-8 w-16 text-right tabular-nums"
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <DialogFooter className="gap-2 sm:justify-between">
            <Button
              variant="outline"
              onClick={() => countingItem && handleConfirmFull(countingItem)}
              loading={countingItem ? confirming === countingItem.id : false}
            >
              Nhận đủ, không có vấn đề gì
            </Button>
            <Button
              onClick={handleConfirmCounted}
              disabled={loadingLines || lines.length === 0}
              loading={countingItem ? confirming === countingItem.id : false}
            >
              Xác nhận theo số đã kiểm đếm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageWrapper>
  );
}
