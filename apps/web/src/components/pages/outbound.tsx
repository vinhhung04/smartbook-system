import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, CheckCircle2, ScanLine, Send } from 'lucide-react';
import { toast } from 'sonner';
import { motion } from 'motion/react';
import { PageWrapper, FadeItem } from '../motion-utils';
import { BarcodeScanModal } from '@/components/barcode-scan-modal';
import { getApiErrorMessage } from '@/services/api.ts';
import { warehouseService, type Warehouse } from '@/services/warehouse';
import { outboundService, type OutboundQueueItem, type OutboundOrderDetail } from '@/services/outbound';
import { SectionCard } from '@/components/ui/section-card';
import { EmptyState } from '@/components/ui/empty-state';
import { FilterBar } from '@/components/ui/filter-bar';

function taskLabel(taskType: 'outbound' | 'transfer'): string {
  return taskType === 'transfer' ? 'Warehouse Transfer' : 'Outbound';
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
        const rows = await warehouseService.getAll();
        const list = Array.isArray(rows) ? rows : [];

        setWarehouses(list);
        const preferredWarehouseId = list[0]?.id || '';
        setSelectedWarehouseId(preferredWarehouseId);
        await loadQueue(preferredWarehouseId || undefined);
      } catch (error) {
        toast.error(getApiErrorMessage(error, 'Khong tai duoc outbound queue'));
      } finally {
        setLoading(false);
      }
    };

    void run();
  }, []);

  useEffect(() => {
    if (!selectedWarehouseId) {
      setQueue([]);
      return;
    }

    void loadQueue(selectedWarehouseId).catch((error) => {
      toast.error(getApiErrorMessage(error, 'Khong tai duoc queue theo warehouse'));
    });
  }, [selectedWarehouseId]);

  const handleOpen = async (task: OutboundQueueItem) => {
    try {
      await loadDetail(task.task_type, task.task_id);
    } catch (error) {
      toast.error(getApiErrorMessage(error, 'Khong mo duoc chi tiet outbound order'));
    }
  };

  const handleConfirm = async () => {
    if (!selectedTaskType || !selectedTaskId || !detail) {
      toast.error('Chua chon don can outbound');
      return;
    }

    try {
      setConfirming(true);
      const normalizedCode = scanCode.trim() || null;
      const response = await outboundService.confirmOutbound(selectedTaskType, selectedTaskId, normalizedCode);
      const destinationReceiptNumber = response.data.destination_receipt_number;

      if (destinationReceiptNumber) {
        toast.success(`Da outbound. Receipt dich: ${destinationReceiptNumber}`);
      } else {
        toast.success('Da confirm outbound thanh cong');
      }

      await loadQueue(selectedWarehouseId || undefined);
      setDetail(null);
      setSelectedTaskId('');
      setSelectedTaskType(null);
      setScanCode('');
    } catch (error) {
      toast.error(getApiErrorMessage(error, 'Confirm outbound that bai'));
    } finally {
      setConfirming(false);
    }
  };

  if (loading) {
    return (
      <PageWrapper>
        <p className="text-[13px] text-muted-foreground">Dang tai outbound queue...</p>
      </PageWrapper>
    );
  }

  return (
    <PageWrapper className="space-y-5">
      <FadeItem>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-sky-100 to-cyan-50 flex items-center justify-center border border-sky-200/40">
            <Send className="w-5 h-5 text-sky-700" />
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Outbound</h1>
            <p className="text-[12px] text-muted-foreground mt-0.5">Xac nhan xuat kho cho don da pick xong (READY_FOR_OUTBOUND)</p>
          </div>
        </div>
      </FadeItem>

      {!detail ? (
        <>
          <FadeItem>
            <SectionCard>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <p className="text-[11px] text-muted-foreground mb-1 font-medium">Warehouse</p>
                  <select
                    value={selectedWarehouseId}
                    onChange={(event) => setSelectedWarehouseId(event.target.value)}
                    className="w-full rounded-lg border border-input px-3 py-2 text-[12px]"
                  >
                    <option value="">Chon warehouse</option>
                    {warehouses.map((warehouse) => (
                      <option key={warehouse.id} value={warehouse.id}>{warehouse.code} - {warehouse.name}</option>
                    ))}
                  </select>
                </div>

                <div className="md:col-span-2">
                  <p className="text-[11px] text-muted-foreground mb-1 font-medium">Tim don outbound</p>
                  <FilterBar
                    searchValue={query}
                    onSearchChange={setQuery}
                    searchPlaceholder="Ma don / kho / loai don"
                    showSearchClear
                  />
                </div>
              </div>
            </SectionCard>
          </FadeItem>

          <FadeItem>
            <SectionCard noPadding>
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border bg-muted/40">
                    {["Ma don", "Loai", "Kho nguon", "Kho dich", "Trang thai", "Tong qty", "San sang", "Action"].map((head) => (
                      <th key={head} className="text-left text-[11px] text-muted-foreground px-4 py-3 uppercase tracking-wider font-medium">
                        {head}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredQueue.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="py-10 text-center">
                        <EmptyState variant="no-data" title="Khong co don nao cho outbound" description="Cac don da pick xong se hien o day" className="py-0" />
                      </td>
                    </tr>
                  ) : filteredQueue.map((task) => (
                    <tr key={`${task.task_type}:${task.task_id}`} className="border-b border-border last:border-0 hover:bg-muted/40">
                      <td className="px-4 py-3 text-[12px] font-semibold">{task.order_number}</td>
                      <td className="px-4 py-3 text-[12px]">{taskLabel(task.task_type)}</td>
                      <td className="px-4 py-3 text-[12px]">{task.source_warehouse_code || '-'}</td>
                      <td className="px-4 py-3 text-[12px]">{task.target_warehouse_code || '-'}</td>
                      <td className="px-4 py-3 text-[12px] text-sky-700 font-semibold">{task.status}</td>
                      <td className="px-4 py-3 text-[12px]">{task.total_quantity}</td>
                      <td className="px-4 py-3 text-[12px] font-semibold">{task.ready_quantity}</td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => void handleOpen(task)}
                          className="inline-flex items-center gap-1 rounded-lg border border-input px-2.5 py-1.5 text-[11px] hover:bg-muted"
                        >
                          Xem & outbound <ArrowRight className="w-3 h-3" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </SectionCard>
          </FadeItem>
        </>
      ) : (
        <>
          <FadeItem>
            <SectionCard>
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div>
                  <p className="text-[12px] text-muted-foreground font-medium">Don dang thao tac outbound</p>
                  <h2 className="text-[15px] font-semibold mt-1">{detail.order_number} · {taskLabel(detail.task_type)}</h2>
                  <p className="text-[12px] text-muted-foreground mt-1">
                    Nguon: {detail.source_warehouse_code || '-'}
                    {detail.target_warehouse_code ? ` | Dich: ${detail.target_warehouse_code}` : ''}
                    {` | Lines: ${detail.lines.length}`}
                  </p>
                </div>
                <button
                  onClick={() => {
                    setDetail(null);
                    setSelectedTaskId('');
                    setSelectedTaskType(null);
                    setScanCode('');
                  }}
                  className="rounded-xl border border-input px-3 py-2 text-[12px] hover:bg-muted"
                >
                  Quay lai queue
                </button>
              </div>
            </SectionCard>
          </FadeItem>

          <FadeItem>
            <SectionCard title="Scan code va confirm outbound" subtitle="Nhap tay hoac scan ma don de xac nhan outbound.">
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
                  placeholder="Ma don scan code"
                  className="flex-1 min-w-[200px] rounded-lg border border-input px-3 py-2 text-[12px]"
                />
                <button
                  onClick={() => setShowScanModal(true)}
                  disabled={confirming}
                  className="rounded-lg border border-input px-3 py-2 text-[12px] hover:bg-muted disabled:opacity-60"
                  title="Scan ma don"
                >
                  <ScanLine className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => void handleConfirm()}
                  disabled={confirming}
                  className="rounded-xl bg-sky-600 text-white px-4 py-2.5 text-[12px] font-semibold disabled:opacity-60"
                >
                  {confirming ? 'Dang outbound...' : 'Confirm outbound'}
                </button>
              </div>

              {loadingDetail ? <p className="text-[12px] text-muted-foreground mt-2">Dang tai chi tiet...</p> : null}
            </SectionCard>
          </FadeItem>

          <FadeItem>
            <SectionCard noPadding>
              <table className="w-full">
                <thead>
                  <tr className="bg-muted/50 border-b border-border text-[11px] text-muted-foreground">
                    <th className="text-left px-3 py-2 font-medium">San pham</th>
                    <th className="text-left px-3 py-2 font-medium">SKU/Barcode</th>
                    <th className="text-left px-3 py-2 w-[120px] font-medium">Yeu cau</th>
                    <th className="text-left px-3 py-2 w-[120px] font-medium">Da pick</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.lines.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-3 py-4 text-[12px] text-muted-foreground text-center">Khong co line nao</td>
                    </tr>
                  ) : detail.lines.map((line) => (
                    <tr key={line.line_id} className="border-b border-border last:border-0 text-[12px]">
                      <td className="px-3 py-2">
                        <p className="text-foreground font-medium">{line.book_title}</p>
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">{line.sku || line.barcode || '-'}</td>
                      <td className="px-3 py-2">{line.quantity}</td>
                      <td className="px-3 py-2 font-semibold">{line.ready_qty}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </SectionCard>
          </FadeItem>

          <FadeItem>
            <SectionCard className="border-emerald-200 bg-emerald-50/50">
              <div className="flex items-center gap-2.5">
                <CheckCircle2 className="w-4 h-4 text-emerald-700" />
                <p className="text-[12px] text-emerald-800">Transfer sau khi confirm outbound se tu dong tao Goods Receipt DRAFT o kho dich.</p>
              </div>
            </SectionCard>
          </FadeItem>

          <BarcodeScanModal
            isOpen={showScanModal}
            onClose={() => setShowScanModal(false)}
            onDetected={(code) => {
              setScanCode(code);
              toast.success(`Da quet ma don: ${code}`);
            }}
            title="Quet ma don outbound"
          />
        </>
      )}
    </PageWrapper>
  );
}
