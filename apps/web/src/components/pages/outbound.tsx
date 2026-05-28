import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, CheckCircle2, ScanLine } from 'lucide-react';
import { toast } from 'sonner';
import { NavLink } from 'react-router';
import { FadeItem, PageWrapper } from '../motion-utils';
import { BarcodeScanModal } from '@/components/barcode-scan-modal';
import { getApiErrorMessage } from '@/services/api.ts';
import { authService } from '@/services/auth';
import { warehouseService, type Warehouse } from '@/services/warehouse';
import { outboundService, type OutboundQueueItem, type OutboundOrderDetail } from '@/services/outbound';
import { canManageReceiving } from '@/lib/rbac';

function taskLabel(taskType: 'outbound' | 'transfer'): string {
  return taskType === 'transfer' ? 'Chuyển kho' : 'Xuất kho';
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
        const rows = canManageQueue ? await warehouseService.getAll() : [];
        const list = Array.isArray(rows) ? rows : [];

        setWarehouses(list);
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
  }, []);

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

  const handleConfirm = async () => {
    if (!selectedTaskType || !selectedTaskId || !detail) {
      toast.error('Chưa chọn đơn cần xuất kho');
      return;
    }

    try {
      setConfirming(true);
      const normalizedCode = scanCode.trim() || null;
      const response = await outboundService.confirmOutbound(selectedTaskType, selectedTaskId, normalizedCode);
      const destinationReceiptNumber = response.data.destination_receipt_number;

      if (destinationReceiptNumber) {
        toast.success(`Đã xuất kho. Phiếu nhập tại kho đích: ${destinationReceiptNumber}`);
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

  if (loading) {
    return (
      <PageWrapper>
        <p className="text-[13px] text-slate-500">Đang tải hàng đợi xuất kho...</p>
      </PageWrapper>
    );
  }

  return (
    <PageWrapper className="space-y-5">
      <FadeItem>
        <NavLink
          to="/orders"
          className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-slate-500 transition-colors hover:text-blue-600"
        >
          <ArrowRight className="h-3.5 w-3.5 rotate-180" /> Quay lại danh sách
        </NavLink>
      </FadeItem>

      <FadeItem>
        <h1 className="tracking-[-0.02em]">Xuất kho</h1>
        <p className="text-[12px] text-slate-500 mt-1">
          {canManageQueue ? 'Xác nhận xuất kho cho đơn đã lấy xong (READY_FOR_OUTBOUND)' : 'Xác nhận xuất kho cho task được giao'}
        </p>
      </FadeItem>

      {!detail ? (
        <>
          <FadeItem>
            <div className="rounded-[16px] border border-white/80 bg-white p-5 shadow-[0_1px_4px_rgba(0,0,0,0.03)]">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {canManageQueue ? (
                <div>
                  <p className="text-[11px] text-slate-500 mb-1.5 font-semibold">Kho</p>
                  <select
                    value={selectedWarehouseId}
                    onChange={(event) => setSelectedWarehouseId(event.target.value)}
                    className="w-full rounded-[10px] border border-slate-200 px-3 py-2.5 text-[13px]"
                  >
                    <option value="">Chọn kho</option>
                    {warehouses.map((warehouse) => (
                      <option key={warehouse.id} value={warehouse.id}>{warehouse.code} - {warehouse.name}</option>
                    ))}
                  </select>
                </div>
                ) : null}

                <div className={canManageQueue ? 'md:col-span-2' : 'md:col-span-3'}>
                  <p className="text-[11px] text-slate-500 mb-1.5 font-semibold">Tìm đơn xuất kho</p>
                  <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Mã đơn / kho / loại đơn"
                    className="w-full rounded-[10px] border border-slate-200 px-3 py-2.5 text-[13px]"
                  />
                </div>
              </div>
            </div>
          </FadeItem>

          <FadeItem>
            <div className="overflow-hidden rounded-[16px] border border-white/80 bg-white shadow-[0_1px_4px_rgba(0,0,0,0.03)]">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-slate-100 bg-gradient-to-r from-sky-50/30 to-transparent">
                    {["Mã đơn", "Loại", "Kho nguồn", "Kho đích", "Trạng thái", "Tổng SL", "Sẵn sàng", "Thao tác"].map((head) => (
                      <th key={head} className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.05em] text-slate-400">
                        {head}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredQueue.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="py-10 text-center text-[13px] text-slate-400">
                        Không có đơn nào cần xuất kho
                      </td>
                    </tr>
                  ) : filteredQueue.map((task) => (
                    <tr key={`${task.task_type}:${task.task_id}`} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/50 transition-colors">
                      <td className="px-4 py-3 text-[12px] font-semibold">{task.order_number}</td>
                      <td className="px-4 py-3 text-[12px] text-slate-600">{taskLabel(task.task_type)}</td>
                      <td className="px-4 py-3 text-[12px] text-slate-600">{task.source_warehouse_code || '-'}</td>
                      <td className="px-4 py-3 text-[12px] text-slate-600">{task.target_warehouse_code || '-'}</td>
                      <td className="px-4 py-3 text-[12px] text-sky-600 font-semibold">{task.status}</td>
                      <td className="px-4 py-3 text-[12px] text-slate-600">{task.total_quantity}</td>
                      <td className="px-4 py-3 text-[12px] font-semibold">{task.ready_quantity}</td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => void handleOpen(task)}
                          className="inline-flex items-center gap-1 rounded-[8px] border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] hover:bg-slate-50 transition-colors"
                        >
                          Xem & xuất <ArrowRight className="w-3 h-3" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </FadeItem>
        </>
      ) : (
        <>
          <FadeItem>
            <div className="rounded-[16px] border border-white/80 bg-white p-5 shadow-[0_1px_4px_rgba(0,0,0,0.03)]">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div>
                  <p className="text-[11px] text-slate-500 font-semibold">Đơn đang thao tác xuất kho</p>
                  <h2 className="text-[15px] font-semibold mt-1">{detail.order_number} · {taskLabel(detail.task_type)}</h2>
                  <p className="text-[12px] text-slate-500 mt-1">
                    Nguồn: {detail.source_warehouse_code || '-'}
                    {detail.target_warehouse_code ? ` | Đích: ${detail.target_warehouse_code}` : ''}
                    {` | Số dòng: ${detail.lines.length}`}
                  </p>
                </div>
                <button
                  onClick={() => {
                    setDetail(null);
                    setSelectedTaskId('');
                    setSelectedTaskType(null);
                    setScanCode('');
                  }}
                  className="rounded-[10px] border border-slate-200 bg-white px-4 py-2.5 text-[13px] font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
                >
                  Quay lại hàng đợi
                </button>
              </div>
            </div>
          </FadeItem>

          <FadeItem>
            <div className="rounded-[16px] border border-white/80 bg-white p-5 shadow-[0_1px_4px_rgba(0,0,0,0.03)]">
              <h3 className="text-[14px] font-semibold mb-3">Quét mã và xác nhận xuất kho</h3>
              <p className="text-[11px] text-slate-500 mb-3">Nhập tay hoặc quét mã đơn để xác nhận xuất kho.</p>
              <div className="flex gap-2 flex-wrap">
                <input
                  value={scanCode}
                  onChange={(event) => setScanCode(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      void handleConfirm();
                    }
                  }}
                  placeholder="Mã đơn / mã quét"
                  className="flex-1 min-w-[200px] rounded-[10px] border border-slate-200 px-3 py-2.5 text-[13px]"
                />
                <button
                  onClick={() => setShowScanModal(true)}
                  disabled={confirming}
                  className="rounded-[10px] border border-slate-200 px-3 py-2.5 text-[13px] hover:bg-slate-50 disabled:opacity-60 transition-colors"
                >
                  <ScanLine className="w-4 h-4" />
                </button>
                <button
                  onClick={() => void handleConfirm()}
                  disabled={confirming}
                  className="rounded-[10px] bg-gradient-to-r from-blue-600 to-indigo-600 px-5 py-2.5 text-[13px] font-semibold text-white hover:opacity-90 disabled:opacity-60 transition-colors"
                >
                  {confirming ? 'Đang xuất...' : 'Xác nhận xuất kho'}
                </button>
              </div>

              {loadingDetail ? <p className="text-[12px] text-slate-500 mt-3">Đang tải chi tiết...</p> : null}
            </div>
          </FadeItem>

          <FadeItem>
            <div className="overflow-hidden rounded-[16px] border border-white/80 bg-white shadow-[0_1px_4px_rgba(0,0,0,0.03)]">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-slate-100 bg-gradient-to-r from-sky-50/30 to-transparent">
                    <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.05em] text-slate-400">Sản phẩm</th>
                    <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.05em] text-slate-400">SKU/Mã vạch</th>
                    <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.05em] text-slate-400 w-[100px]">Yêu cầu</th>
                    <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.05em] text-slate-400 w-[100px]">Đã lấy</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.lines.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-4 py-6 text-[12px] text-slate-400 text-center">Không có dòng nào</td>
                    </tr>
                  ) : detail.lines.map((line) => (
                    <tr key={line.line_id} className="border-b border-slate-50 last:border-0 text-[12px]">
                      <td className="px-4 py-3">
                        <p className="text-slate-900 font-medium">{line.book_title}</p>
                      </td>
                      <td className="px-4 py-3 text-slate-500">{line.sku || line.barcode || '-'}</td>
                      <td className="px-4 py-3 text-slate-600">{line.quantity}</td>
                      <td className="px-4 py-3 font-semibold">{line.ready_qty}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </FadeItem>

          <FadeItem>
            <div className="rounded-[16px] border border-emerald-200/60 bg-emerald-50/50 p-4">
              <div className="flex items-center gap-2.5">
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                <p className="text-[12px] text-emerald-800">Sau khi xác nhận xuất kho, hệ thống tự động tạo Phiếu nhập kho NHÁP tại kho đích.</p>
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
        </>
      )}
    </PageWrapper>
  );
}
