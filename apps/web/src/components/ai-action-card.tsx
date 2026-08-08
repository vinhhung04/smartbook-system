import { useState, useEffect } from 'react';
import { Sparkles, CheckCircle, XCircle, AlertTriangle, FileText, ShoppingCart, Bell, ClipboardList, BookOpen } from 'lucide-react';
import { aiService, type PendingAction } from '@/services/ai';
import { warehouseService, type Warehouse } from '@/services/warehouse';
import { userService, type WarehouseStaffOption } from '@/services/user';
import { supplierService, type Supplier } from '@/services/supplier';
import { toast } from 'sonner';
import { getApiErrorMessage } from '@/services/http-clients';

// Shared confirm/cancel card for an AI-proposed action (PendingAction). Used by both
// the floating chatbot widget (ai-chatbot.tsx) and the Decision Assistant page
// (pages/ai-assistant.tsx) so the two surfaces render the same action UX.

function RiskBadge({ risk }: { risk: string }) {
  const map: Record<string, string> = {
    LOW: 'bg-emerald-100 text-emerald-700',
    MEDIUM: 'bg-amber-100 text-amber-700',
    HIGH: 'bg-red-100 text-red-700',
  };
  return (
    <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${map[risk] ?? 'bg-gray-100 text-gray-600'}`}>
      {risk}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    PENDING_CONFIRMATION: 'bg-blue-100 text-blue-700',
    EXECUTED: 'bg-emerald-100 text-emerald-700',
    CANCELLED: 'bg-gray-100 text-gray-500',
    EXPIRED: 'bg-red-100 text-red-600',
    FAILED: 'bg-red-100 text-red-700',
  };
  const label: Record<string, string> = {
    PENDING_CONFIRMATION: 'Chờ xác nhận',
    EXECUTED: 'Đã thực thi',
    CANCELLED: 'Đã hủy',
    EXPIRED: 'Hết hạn',
    FAILED: 'Thất bại',
  };
  return (
    <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${map[status] ?? 'bg-gray-100 text-gray-500'}`}>
      {label[status] ?? status}
    </span>
  );
}

function ActionTypeIcon({ type }: { type: string }) {
  const icons: Record<string, React.ReactNode> = {
    CREATE_REORDER_DRAFT: <ShoppingCart size={13} className="text-indigo-600" />,
    CREATE_REPORT_DRAFT: <FileText size={13} className="text-indigo-600" />,
    CREATE_RESERVATION_DRAFT: <BookOpen size={13} className="text-indigo-600" />,
    CREATE_STOCK_ALERT: <Bell size={13} className="text-indigo-600" />,
    CREATE_STAFF_TASK_DRAFT: <ClipboardList size={13} className="text-indigo-600" />,
  };
  return <>{icons[type] ?? <Sparkles size={13} className="text-indigo-600" />}</>;
}

const ACTION_TYPE_LABEL: Record<string, string> = {
  CREATE_REORDER_DRAFT: 'Đề xuất nhập sách',
  CREATE_REPORT_DRAFT: 'Tạo báo cáo',
  CREATE_RESERVATION_DRAFT: 'Đặt chỗ sách',
  CREATE_STOCK_ALERT: 'Cảnh báo tồn kho',
  CREATE_STAFF_TASK_DRAFT: 'Task cho staff',
};

// ── Payload preview by action type ────────────────────────────────────────────

function PayloadPreview({ action }: { action: PendingAction }) {
  const p = action.payload;

  if (action.type === 'CREATE_REORDER_DRAFT') {
    const items: any[] = p.items || [];
    if (!items.length) return <p className="text-gray-500 italic">Không có dữ liệu items.</p>;

    // Group items by warehouse, collect supplier suggestion per warehouse
    const itemsWithWh = items.filter((it: any) => it.warehouse_id);
    const itemsNoWh = items.filter((it: any) => !it.warehouse_id);
    const byWarehouse: Record<string, { name: string; code: string; items: any[]; supplierName: string }> = {};
    for (const it of itemsWithWh) {
      const key = it.warehouse_id;
      if (!byWarehouse[key]) byWarehouse[key] = { name: it.warehouse_name || it.warehouse_code || key, code: it.warehouse_code || '', items: [], supplierName: '' };
      byWarehouse[key].items.push(it);
      // Use first available supplier suggestion for this warehouse group
      if (!byWarehouse[key].supplierName && it.suggested_supplier_name) {
        byWarehouse[key].supplierName = it.suggested_supplier_name;
      }
    }
    const warehouseGroups = Object.values(byWarehouse);

    return (
      <div className="space-y-1.5">
        {warehouseGroups.length > 0 && (
          <p className="font-medium text-gray-600 text-[11px]">
            Theo kho ({warehouseGroups.length} kho, {itemsWithWh.length} dòng):
          </p>
        )}
        {warehouseGroups.map((group, gi) => (
          <div key={gi} className="space-y-0.5">
            <p className="text-[10px] font-semibold text-indigo-700">
              🏭 {group.name}{group.code ? ` (${group.code})` : ''} — {group.items.length} sách
              {group.supplierName && (
                <span className="ml-1.5 font-normal text-gray-500">· NCC: {group.supplierName}</span>
              )}
            </p>
            <div className="space-y-0.5 max-h-20 overflow-y-auto">
              {group.items.map((item: any, i: number) => (
                <div key={i} className="flex items-center justify-between bg-white rounded px-2 py-0.5 border border-gray-100">
                  <span className="truncate flex-1 text-gray-700 text-[11px]" title={item.title}>{item.title || 'Unknown'}</span>
                  <div className="flex items-center gap-1.5 ml-2 shrink-0">
                    <span className="text-gray-400 text-[10px]">Còn: {item.current_stock ?? '?'}</span>
                    <span className="text-indigo-600 font-medium text-[10px]">Nhập: {item.suggested_quantity ?? 1}</span>
                    {item.priority === 'HIGH' && <span className="text-[9px] px-1 rounded bg-red-100 text-red-600">HIGH</span>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
        {itemsNoWh.length > 0 && (
          <div className="space-y-0.5">
            <p className="text-[10px] font-semibold text-amber-700">⚠ Chưa xác định kho ({itemsNoWh.length} sách):</p>
            {itemsNoWh.slice(0, 4).map((item: any, i: number) => (
              <div key={i} className="flex items-center justify-between bg-amber-50 rounded px-2 py-0.5 border border-amber-100">
                <span className="truncate flex-1 text-gray-700 text-[11px]">{item.title || 'Unknown'}</span>
                <span className="text-gray-400 text-[10px]">Nhập: {item.suggested_quantity ?? 1}</span>
              </div>
            ))}
            {itemsNoWh.length > 4 && <p className="text-gray-400 text-[10px] text-center">... và {itemsNoWh.length - 4} sách khác</p>}
          </div>
        )}
        {items.length > 10 && <p className="text-gray-400 text-[10px] text-center">Tổng: {items.length} dòng</p>}
      </div>
    );
  }

  if (action.type === 'CREATE_REPORT_DRAFT') {
    const lines = (p.report_markdown || '').split('\n').slice(0, 6);
    return (
      <div className="space-y-1">
        <p className="font-medium text-gray-600">{p.report_title || 'Báo cáo SmartBook AI'}</p>
        <pre className="text-[10px] text-gray-600 bg-white rounded p-2 border border-gray-100 whitespace-pre-wrap max-h-24 overflow-y-auto">
          {lines.join('\n')}{lines.length >= 6 ? '\n...' : ''}
        </pre>
      </div>
    );
  }

  if (action.type === 'CREATE_RESERVATION_DRAFT') {
    return (
      <div className="space-y-1">
        <div className="bg-white rounded p-2 border border-gray-100 space-y-1">
          <p><span className="text-gray-500">Sách:</span> <span className="font-medium">{p.title_query || 'N/A'}</span></p>
          <p><span className="text-gray-500">Variant ID:</span> {p.variant_id || p.book_variant_id || <span className="text-amber-600">Chưa có</span>}</p>
          <p><span className="text-gray-500">Warehouse ID:</span> {p.warehouse_id || <span className="text-amber-600">Chưa có</span>}</p>
          <p><span className="text-gray-500">Số lượng:</span> {p.quantity || 1}</p>
        </div>
        {p.requires_review && (
          <p className="text-amber-600 text-[10px]">⚠ Thiếu variant_id hoặc warehouse_id. Sẽ lưu draft, không gọi API thật.</p>
        )}
      </div>
    );
  }

  if (action.type === 'CREATE_STOCK_ALERT') {
    const items: any[] = p.items || [];
    const itemsWithWh = items.filter((it: any) => it.warehouse_id);
    const itemsNoWh = items.filter((it: any) => !it.warehouse_id);
    const byWarehouse: Record<string, { name: string; code: string; items: any[] }> = {};
    for (const it of itemsWithWh) {
      const key = it.warehouse_id;
      if (!byWarehouse[key]) byWarehouse[key] = { name: it.warehouse_name || it.warehouse_code || key, code: it.warehouse_code || '', items: [] };
      byWarehouse[key].items.push(it);
    }
    const warehouseGroups = Object.values(byWarehouse);

    return (
      <div className="space-y-1.5">
        <p className="font-medium text-gray-600 text-[11px]">
          Loại: <span className="text-red-600">{p.alert_type || 'LOW_STOCK'}</span>
          {' '}· Mức độ: <RiskBadge risk={p.severity || 'MEDIUM'} />
        </p>
        {warehouseGroups.length > 0 && (
          <p className="text-[10px] text-gray-500 font-medium">Theo kho ({warehouseGroups.length} kho):</p>
        )}
        {warehouseGroups.map((group, gi) => (
          <div key={gi} className="space-y-0.5">
            <p className="text-[10px] font-semibold text-red-700">🏭 {group.name}{group.code ? ` (${group.code})` : ''} — {group.items.length} cảnh báo</p>
            <div className="space-y-0.5 max-h-16 overflow-y-auto">
              {group.items.map((item: any, i: number) => (
                <div key={i} className="flex items-center justify-between bg-white rounded px-2 py-0.5 border border-gray-100">
                  <span className="truncate flex-1 text-gray-700 text-[11px]">{item.title || 'Unknown'}</span>
                  <div className="flex items-center gap-1.5 ml-2 shrink-0">
                    <span className="text-gray-400 text-[10px]">Tồn: {item.current_stock ?? '?'}</span>
                    {item.priority === 'HIGH' && <span className="text-[9px] px-1 rounded bg-red-100 text-red-600">HIGH</span>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
        {itemsNoWh.length > 0 && (
          <div className="space-y-0.5">
            <p className="text-[10px] font-semibold text-amber-700">⚠ Chưa xác định kho ({itemsNoWh.length} sách):</p>
            {itemsNoWh.slice(0, 3).map((item: any, i: number) => (
              <div key={i} className="flex items-center justify-between bg-amber-50 rounded px-2 py-0.5 border border-amber-100">
                <span className="truncate flex-1 text-gray-700 text-[11px]">{item.title || 'Unknown'}</span>
                <span className="text-gray-400 text-[10px]">Tồn: {item.current_stock ?? '?'}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  if (action.type === 'CREATE_STAFF_TASK_DRAFT') {
    const relatedItems: any[] = p.related_items || [];
    return (
      <div className="space-y-1.5">
        <div className="bg-white rounded p-2 border border-gray-100 space-y-1">
          <p><span className="text-gray-500">Tiêu đề:</span> <span className="font-medium">{p.task_title || p.title || 'N/A'}</span></p>
          <p><span className="text-gray-500">Loại task:</span> {p.task_type || 'N/A'}</p>
          <p><span className="text-gray-500">Ưu tiên:</span> {p.priority || 'MEDIUM'}</p>
          {!p.assignee_user_id && (
            <p className="text-amber-600 text-[10px]">⚠ Chưa có người thực hiện — chọn nhân viên bên dưới.</p>
          )}
        </div>
        {relatedItems.length > 0 && (
          <div className="space-y-0.5">
            <p className="text-[10px] text-gray-500 font-medium">Sách liên quan ({relatedItems.length}):</p>
            <div className="max-h-16 overflow-y-auto space-y-0.5">
              {relatedItems.map((item: any, i: number) => (
                <div key={i} className="flex items-center justify-between bg-white rounded px-2 py-0.5 border border-gray-100">
                  <span className="truncate flex-1 text-gray-700 text-[10px]">{item.title || 'Unknown'}</span>
                  <span className="text-gray-400 ml-2 text-[10px]">Còn: {item.quantity ?? '?'}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  return null;
}

// ── ActionCard component ───────────────────────────────────────────────────────

interface ActionCardProps {
  action: PendingAction;
  onConfirmed: (actionId: string, result: any, actionType: string) => void;
  onCancelled: (actionId: string) => void;
}

export function ActionCard({ action, onConfirmed, onCancelled }: ActionCardProps) {
  const [localStatus, setLocalStatus] = useState(action.status);
  const [confirming, setConfirming] = useState(false);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [selectedWarehouseId, setSelectedWarehouseId] = useState<string>('');
  const [warehouseLoadError, setWarehouseLoadError] = useState<string | null>(null);
  const [staffList, setStaffList] = useState<WarehouseStaffOption[]>([]);
  const [selectedAssigneeId, setSelectedAssigneeId] = useState<string>('');
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [selectedSupplierId, setSelectedSupplierId] = useState<string>('');
  const [selectedSupplierName, setSelectedSupplierName] = useState<string>('');

  const isReorder = action.type === 'CREATE_REORDER_DRAFT';
  const isStockAlert = action.type === 'CREATE_STOCK_ALERT';
  const isStaffTask = action.type === 'CREATE_STAFF_TASK_DRAFT';
  const isDone = localStatus !== 'PENDING_CONFIRMATION';

  // Warehouse resolution metadata from AI planner
  const warehouseResolutionStatus = action.payload?.warehouse_resolution_status as string | undefined;
  const warehouseCandidates: { id: string; code: string; name: string }[] =
    action.payload?.warehouse_candidates || [];
  const warehouseHint: string = action.payload?.warehouse_hint || '';
  const resolvedWarehouseCode: string = action.payload?.resolved_warehouse_code || '';
  const resolvedWarehouseName: string = action.payload?.resolved_warehouse_name || '';

  // Check if any item is missing warehouse_id (needs fallback selector)
  const reorderHasItemsWithoutWarehouse = isReorder && (action.payload?.items || []).some((it: any) => !it.warehouse_id);
  const alertHasItemsWithoutWarehouse = isStockAlert && (action.payload?.items || []).some((it: any) => !it.warehouse_id);
  // Show warehouse selector when: ambiguous/not-found resolution, stock alert, or missing-warehouse reorder items
  const needsWarehouseSelector =
    alertHasItemsWithoutWarehouse ||
    reorderHasItemsWithoutWarehouse ||
    warehouseResolutionStatus === 'AMBIGUOUS' ||
    warehouseResolutionStatus === 'NOT_FOUND';

  // Load warehouses for stock alert and reorder items missing warehouse
  useEffect(() => {
    if (!needsWarehouseSelector || isDone) return;
    warehouseService.getAll({ is_active: true }).then((data: any) => {
      const list: Warehouse[] = Array.isArray(data) ? data : (data?.data ?? []);
      setWarehouses(list);
      if (list.length === 1) setSelectedWarehouseId(list[0].id);
    }).catch(() => {
      setWarehouseLoadError('Không tải được danh sách kho. Vui lòng thử lại.');
      toast.error('Không tải được danh sách kho.');
    });
  }, [needsWarehouseSelector, isDone]);

  // Load suppliers for reorder (optional selection)
  useEffect(() => {
    if (!isReorder || isDone) return;
    supplierService.getAll()
      .then((data: any) => {
        const list: Supplier[] = Array.isArray(data) ? data : (data?.data ?? []);
        setSuppliers(list.filter((s: any) => s.status === 'ACTIVE'));
      })
      .catch(() => { /* silent — supplier list is optional */ });
  }, [isReorder, isDone]);

  // Load warehouse staff list for staff task picker
  useEffect(() => {
    if (!isStaffTask || isDone) return;
    userService.getWarehouseStaff()
      .then((resp) => setStaffList(resp.data || []))
      .catch(() => {
        toast.error('Không tải được danh sách nhân viên kho.');
      });
  }, [isStaffTask, isDone]);

  const handleConfirm = async () => {
    if (confirming || isDone) return;
    if (needsWarehouseSelector && warehouseLoadError) {
      toast.error('Danh sách kho chưa tải được. Vui lòng thử lại.');
      return;
    }
    // Require warehouse selection when items are missing one, or when resolution was ambiguous/not found
    const isWarehouseRequired =
      alertHasItemsWithoutWarehouse ||
      reorderHasItemsWithoutWarehouse ||
      warehouseResolutionStatus === 'AMBIGUOUS' ||
      warehouseResolutionStatus === 'NOT_FOUND';
    if (isWarehouseRequired && !selectedWarehouseId) {
      toast.error(
        warehouseResolutionStatus === 'AMBIGUOUS'
          ? `Tìm thấy nhiều kho khớp với "${warehouseHint}". Vui lòng chọn đúng kho cần tạo phiếu.`
          : 'Vui lòng chọn kho trước khi xác nhận.'
      );
      return;
    }
    // Staff task requires assignee selection if not already in payload
    if (isStaffTask && !action.payload?.assignee_user_id && !selectedAssigneeId) {
      toast.error('Vui lòng chọn nhân viên trước khi xác nhận.');
      return;
    }
    setConfirming(true);
    try {
      const overrideMap: Record<string, string> = {};
      const isWarehouseRequired =
        alertHasItemsWithoutWarehouse ||
        reorderHasItemsWithoutWarehouse ||
        warehouseResolutionStatus === 'AMBIGUOUS' ||
        warehouseResolutionStatus === 'NOT_FOUND';
      if (isWarehouseRequired && selectedWarehouseId) {
        overrideMap.warehouse_id = selectedWarehouseId;
      }
      if (isReorder && selectedSupplierId) {
        overrideMap.supplier_id = selectedSupplierId;
        overrideMap.supplier_name = selectedSupplierName;
      }
      if (isStaffTask && selectedAssigneeId) {
        overrideMap.assignee_user_id = selectedAssigneeId;
      }
      const override = Object.keys(overrideMap).length > 0 ? overrideMap : undefined;
      const resp = await aiService.confirmAction(action.id, override);
      setLocalStatus(resp.status);
      onConfirmed(action.id, resp.result, action.type);
    } catch (err: any) {
      const status = err?.response?.status;
      if (status === 403) {
        toast.error('Bạn không có quyền xác nhận hành động này.');
      } else if (status === 410) {
        toast.error('Hành động đã hết hạn, vui lòng yêu cầu AI tạo lại.');
        setLocalStatus('EXPIRED');
      } else {
        toast.error(getApiErrorMessage(err, 'Không thể xác nhận hành động.'));
      }
    } finally {
      setConfirming(false);
    }
  };

  const handleCancel = async () => {
    if (confirming || isDone) return;
    try {
      await aiService.cancelAction(action.id);
      setLocalStatus('CANCELLED');
      onCancelled(action.id);
    } catch {
      toast.error('Không thể hủy hành động.');
    }
  };

  return (
    <div className="mt-2 rounded-xl border border-indigo-100 bg-indigo-50/80 p-3 space-y-2 text-[11px]">
      {/* Header */}
      <div className="flex items-center gap-1.5">
        <ActionTypeIcon type={action.type} />
        <span className="font-semibold text-indigo-700 flex-1">
          {ACTION_TYPE_LABEL[action.type] ?? action.type}
        </span>
        <RiskBadge risk={action.risk} />
        <StatusBadge status={localStatus} />
      </div>

      {/* Summary */}
      <p className="text-gray-700">{action.summary}</p>

      {/* Review warning */}
      {action.requires_review && (
        <div className="flex items-start gap-1.5 bg-amber-50 border border-amber-200 rounded-lg p-2 text-amber-700">
          <AlertTriangle size={11} className="mt-0.5 shrink-0" />
          <span>Cần xem xét thêm trước khi xác nhận. Có thể chỉ tạo draft, không gọi API thật.</span>
        </div>
      )}

      {/* Warnings */}
      {action.warnings && action.warnings.length > 0 && (
        <div className="space-y-0.5">
          {action.warnings.slice(0, 3).map((w, i) => (
            <p key={i} className="text-amber-600 text-[10px]">⚠ {w}</p>
          ))}
        </div>
      )}

      {/* Payload preview */}
      <PayloadPreview action={action} />

      {/* Warehouse resolution status banners */}
      {isReorder && !isDone && warehouseResolutionStatus === 'RESOLVED' && resolvedWarehouseCode && (
        <div className="text-[10px] bg-green-50 border border-green-200 rounded-lg px-2 py-1.5 text-green-700">
          Kho xác định từ yêu cầu của bạn: <strong>{resolvedWarehouseCode} — {resolvedWarehouseName}</strong>
        </div>
      )}
      {isReorder && !isDone && warehouseResolutionStatus === 'AMBIGUOUS' && (
        <div className="text-[10px] bg-yellow-50 border border-yellow-200 rounded-lg px-2 py-1.5 text-yellow-700">
          ⚠ AI tìm thấy {warehouseCandidates.length} kho khớp với &ldquo;{warehouseHint}&rdquo;. Vui lòng chọn đúng kho cần tạo phiếu bên dưới.
        </div>
      )}
      {isReorder && !isDone && warehouseResolutionStatus === 'NOT_FOUND' && warehouseHint && (
        <div className="text-[10px] bg-red-50 border border-red-200 rounded-lg px-2 py-1.5 text-red-700">
          ⚠ Không tìm thấy kho phù hợp với &ldquo;{warehouseHint}&rdquo;. Vui lòng chọn kho từ danh sách.
        </div>
      )}

      {/* Warehouse selector for stock alerts, reorder fallback, ambiguous/not-found resolution */}
      {needsWarehouseSelector && !isDone && (
        <div className="space-y-1">
          <label className="text-[10px] font-medium text-gray-600">
            {warehouseResolutionStatus === 'AMBIGUOUS'
              ? `Chọn kho (tìm thấy ${warehouseCandidates.length} kho khớp)`
              : warehouseResolutionStatus === 'NOT_FOUND'
              ? 'Chọn kho (không tìm thấy kho phù hợp)'
              : isStockAlert
              ? 'Chọn kho tạo cảnh báo'
              : 'Chọn kho dự phòng cho sách chưa xác định kho'}
            <span className="text-red-500"> *</span>
          </label>
          {warehouseLoadError ? (
            <p className="text-[10px] text-red-500">{warehouseLoadError}</p>
          ) : warehouses.length === 0 && warehouseCandidates.length === 0 ? (
            <p className="text-[10px] text-gray-400 italic">Đang tải danh sách kho...</p>
          ) : (
            <select
              value={selectedWarehouseId}
              onChange={(e) => setSelectedWarehouseId(e.target.value)}
              className="w-full text-[11px] border border-gray-200 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:ring-1 focus:ring-indigo-400"
            >
              <option value="">-- Chọn kho --</option>
              {(warehouseResolutionStatus === 'AMBIGUOUS' && warehouseCandidates.length > 0
                ? warehouseCandidates
                : warehouses
              ).map((wh) => (
                <option key={wh.id} value={wh.id}>
                  {wh.name} ({wh.code})
                </option>
              ))}
            </select>
          )}
        </div>
      )}

      {/* Supplier selector for reorder drafts (optional) */}
      {isReorder && !isDone && (
        <div className="space-y-1">
          <label className="text-[10px] font-medium text-gray-600">
            Nhà cung cấp{' '}
            <span className="text-gray-400 font-normal">(tùy chọn — ghi vào phiếu như gợi ý cho quản lý)</span>
          </label>
          {suppliers.length === 0 ? (
            <p className="text-[10px] text-gray-400 italic">Đang tải hoặc chưa có NCC trong hệ thống...</p>
          ) : (
            <select
              value={selectedSupplierId}
              onChange={(e) => {
                setSelectedSupplierId(e.target.value);
                const s = suppliers.find((sup) => sup.id === e.target.value);
                setSelectedSupplierName(s?.name || '');
              }}
              className="w-full text-[11px] border border-gray-200 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:ring-1 focus:ring-indigo-400"
            >
              <option value="">-- Dùng NCC gợi ý tự động theo từng sách --</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}{s.code ? ` (${s.code})` : ''}
                </option>
              ))}
            </select>
          )}
          {!selectedSupplierId && (
            <p className="text-[10px] text-gray-400">
              Hệ thống sẽ dùng NCC liên kết với từng đầu sách (nếu có). Nếu chưa có liên kết, phiếu vẫn được tạo và quản lý chọn NCC khi duyệt.
            </p>
          )}
        </div>
      )}

      {/* Staff assignee selector for staff task drafts */}
      {isStaffTask && !action.payload?.assignee_user_id && !isDone && (
        <div className="space-y-1">
          <label className="text-[10px] font-medium text-gray-600">
            Giao cho nhân viên <span className="text-red-500">*</span>
          </label>
          {staffList.length === 0 ? (
            <p className="text-[10px] text-gray-400 italic">Đang tải danh sách nhân viên...</p>
          ) : (
            <select
              value={selectedAssigneeId}
              onChange={(e) => setSelectedAssigneeId(e.target.value)}
              className="w-full text-[11px] border border-gray-200 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:ring-1 focus:ring-indigo-400"
            >
              <option value="">-- Chọn nhân viên --</option>
              {staffList.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.full_name || s.username}
                </option>
              ))}
            </select>
          )}
        </div>
      )}

      {/* Buttons */}
      {!isDone && (
        <div className="flex gap-2 pt-0.5">
          <button
            onClick={() => void handleConfirm()}
            disabled={confirming || (needsWarehouseSelector && !!warehouseLoadError)}
            className="flex-1 py-1.5 bg-indigo-600 text-white rounded-lg text-[11px] font-medium hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-1"
          >
            {confirming ? (
              <>
                <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Đang xử lý...
              </>
            ) : (
              <>
                <CheckCircle size={11} />
                Xác nhận
              </>
            )}
          </button>
          <button
            onClick={() => void handleCancel()}
            disabled={confirming}
            className="flex-1 py-1.5 border border-gray-200 text-gray-600 rounded-lg text-[11px] hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-1"
          >
            <XCircle size={11} />
            Hủy
          </button>
        </div>
      )}

      {/* Done states */}
      {localStatus === 'EXECUTED' && (
        <div className="flex items-center gap-1 text-emerald-600 font-medium">
          <CheckCircle size={11} />
          Đã xác nhận. Xem kết quả bên dưới.
        </div>
      )}
      {localStatus === 'CANCELLED' && (
        <p className="text-gray-400">Hành động đã bị hủy.</p>
      )}
      {localStatus === 'EXPIRED' && (
        <p className="text-red-500">Hành động đã hết hạn. Hãy hỏi AI để tạo lại.</p>
      )}
    </div>
  );
}
