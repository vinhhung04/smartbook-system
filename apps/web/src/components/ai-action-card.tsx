import { useState, useEffect } from 'react';
import { Sparkles, CheckCircle, XCircle, AlertTriangle, FileText, ShoppingCart, Bell, ClipboardList, BookOpen, ShieldCheck } from 'lucide-react';
import { aiService, type PendingAction } from '@/services/ai';
import { warehouseService, type Warehouse } from '@/services/warehouse';
import { userService, type WarehouseStaffOption } from '@/services/user';
import { supplierService, type Supplier } from '@/services/supplier';
import { toast } from 'sonner';
import { getApiErrorMessage } from '@/services/http-clients';
import { StatusBadge } from '@/components/status-badge';
import { getStatusVariant } from '@/lib/status-registry';
import { AI_ACTION_TYPE_LABEL, AI_ACTION_STATUS_LABEL } from '@/lib/ai-action-labels';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

// Shared confirm/cancel card for an AI-proposed action (PendingAction). Used by both
// the floating chatbot widget (ai-chatbot.tsx) and the Decision Assistant page
// (pages/ai-assistant.tsx) so the two surfaces render the same action UX.

function ActionTypeIcon({ type }: { type: string }) {
  const icons: Record<string, React.ReactNode> = {
    CREATE_REORDER_DRAFT: <ShoppingCart size={13} className="text-indigo-600 dark:text-indigo-400" />,
    CREATE_REPORT_DRAFT: <FileText size={13} className="text-indigo-600 dark:text-indigo-400" />,
    CREATE_RESERVATION_DRAFT: <BookOpen size={13} className="text-indigo-600 dark:text-indigo-400" />,
    CREATE_STOCK_ALERT: <Bell size={13} className="text-indigo-600 dark:text-indigo-400" />,
    CREATE_STAFF_TASK_DRAFT: <ClipboardList size={13} className="text-indigo-600 dark:text-indigo-400" />,
  };
  return <>{icons[type] ?? <Sparkles size={13} className="text-indigo-600 dark:text-indigo-400" />}</>;
}

// ── Payload preview by action type ────────────────────────────────────────────

function PayloadPreview({ action }: { action: PendingAction }) {
  const p = action.payload;

  if (action.type === 'CREATE_REORDER_DRAFT') {
    const items: any[] = p.items || [];
    if (!items.length) return <p className="text-muted-foreground italic">Không có dữ liệu items.</p>;

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
          <p className="font-medium text-muted-foreground text-[11px]">
            Theo kho ({warehouseGroups.length} kho, {itemsWithWh.length} dòng):
          </p>
        )}
        {warehouseGroups.map((group, gi) => (
          <div key={gi} className="space-y-0.5">
            <p className="text-[10px] font-semibold text-indigo-700 dark:text-indigo-300">
              🏭 {group.name}{group.code ? ` (${group.code})` : ''} — {group.items.length} sách
              {group.supplierName && (
                <span className="ml-1.5 font-normal text-muted-foreground">· NCC: {group.supplierName}</span>
              )}
            </p>
            <div className="space-y-0.5 max-h-20 overflow-y-auto">
              {group.items.map((item: any, i: number) => (
                <div key={i} className="flex items-center justify-between bg-card rounded px-2 py-0.5 border border-border">
                  <span className="truncate flex-1 text-foreground text-[11px]" title={item.title}>{item.title || 'Unknown'}</span>
                  <div className="flex items-center gap-1.5 ml-2 shrink-0">
                    <span className="text-muted-foreground text-[10px]">Còn: {item.current_stock ?? '?'}</span>
                    <span className="text-indigo-600 dark:text-indigo-400 font-medium text-[10px]">Nhập: {item.suggested_quantity ?? 1}</span>
                    {item.priority === 'HIGH' && <span className="text-[9px] px-1 rounded bg-red-100 text-red-600 dark:bg-red-500/10 dark:text-red-400">HIGH</span>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
        {itemsNoWh.length > 0 && (
          <div className="space-y-0.5">
            <p className="text-[10px] font-semibold text-amber-700 dark:text-amber-400">⚠ Chưa xác định kho ({itemsNoWh.length} sách):</p>
            {itemsNoWh.slice(0, 4).map((item: any, i: number) => (
              <div key={i} className="flex items-center justify-between bg-amber-50 rounded px-2 py-0.5 border border-amber-100 dark:bg-amber-500/10 dark:border-amber-500/20">
                <span className="truncate flex-1 text-foreground text-[11px]">{item.title || 'Unknown'}</span>
                <span className="text-muted-foreground text-[10px]">Nhập: {item.suggested_quantity ?? 1}</span>
              </div>
            ))}
            {itemsNoWh.length > 4 && <p className="text-muted-foreground text-[10px] text-center">... và {itemsNoWh.length - 4} sách khác</p>}
          </div>
        )}
        {items.length > 10 && <p className="text-muted-foreground text-[10px] text-center">Tổng: {items.length} dòng</p>}
      </div>
    );
  }

  if (action.type === 'CREATE_REPORT_DRAFT') {
    const lines = (p.report_markdown || '').split('\n').slice(0, 6);
    return (
      <div className="space-y-1">
        <p className="font-medium text-muted-foreground">{p.report_title || 'Báo cáo SmartBook AI'}</p>
        <pre className="text-[10px] text-muted-foreground bg-card rounded p-2 border border-border whitespace-pre-wrap max-h-24 overflow-y-auto">
          {lines.join('\n')}{lines.length >= 6 ? '\n...' : ''}
        </pre>
      </div>
    );
  }

  if (action.type === 'CREATE_RESERVATION_DRAFT') {
    return (
      <div className="space-y-1">
        <div className="bg-card rounded p-2 border border-border space-y-1">
          <p><span className="text-muted-foreground">Sách:</span> <span className="font-medium text-foreground">{p.title_query || 'N/A'}</span></p>
          <p><span className="text-muted-foreground">Variant ID:</span> {p.variant_id || p.book_variant_id || <span className="text-amber-600 dark:text-amber-400">Chưa có</span>}</p>
          <p><span className="text-muted-foreground">Warehouse ID:</span> {p.warehouse_id || <span className="text-amber-600 dark:text-amber-400">Chưa có</span>}</p>
          <p><span className="text-muted-foreground">Số lượng:</span> {p.quantity || 1}</p>
        </div>
        {p.requires_review && (
          <p className="text-amber-600 dark:text-amber-400 text-[10px]">⚠ Thiếu variant_id hoặc warehouse_id. Sẽ lưu draft, không gọi API thật.</p>
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
        <p className="font-medium text-muted-foreground text-[11px] flex flex-wrap items-center gap-1.5">
          Loại: <span className="text-red-600 dark:text-red-400">{p.alert_type || 'LOW_STOCK'}</span>
          · Mức độ: <StatusBadge label={p.severity || 'MEDIUM'} variant={getStatusVariant('pendingActionRisk', p.severity || 'MEDIUM')} />
        </p>
        {warehouseGroups.length > 0 && (
          <p className="text-[10px] text-muted-foreground font-medium">Theo kho ({warehouseGroups.length} kho):</p>
        )}
        {warehouseGroups.map((group, gi) => (
          <div key={gi} className="space-y-0.5">
            <p className="text-[10px] font-semibold text-red-700 dark:text-red-400">🏭 {group.name}{group.code ? ` (${group.code})` : ''} — {group.items.length} cảnh báo</p>
            <div className="space-y-0.5 max-h-16 overflow-y-auto">
              {group.items.map((item: any, i: number) => (
                <div key={i} className="flex items-center justify-between bg-card rounded px-2 py-0.5 border border-border">
                  <span className="truncate flex-1 text-foreground text-[11px]">{item.title || 'Unknown'}</span>
                  <div className="flex items-center gap-1.5 ml-2 shrink-0">
                    <span className="text-muted-foreground text-[10px]">Tồn: {item.current_stock ?? '?'}</span>
                    {item.priority === 'HIGH' && <span className="text-[9px] px-1 rounded bg-red-100 text-red-600 dark:bg-red-500/10 dark:text-red-400">HIGH</span>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
        {itemsNoWh.length > 0 && (
          <div className="space-y-0.5">
            <p className="text-[10px] font-semibold text-amber-700 dark:text-amber-400">⚠ Chưa xác định kho ({itemsNoWh.length} sách):</p>
            {itemsNoWh.slice(0, 3).map((item: any, i: number) => (
              <div key={i} className="flex items-center justify-between bg-amber-50 rounded px-2 py-0.5 border border-amber-100 dark:bg-amber-500/10 dark:border-amber-500/20">
                <span className="truncate flex-1 text-foreground text-[11px]">{item.title || 'Unknown'}</span>
                <span className="text-muted-foreground text-[10px]">Tồn: {item.current_stock ?? '?'}</span>
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
        <div className="bg-card rounded p-2 border border-border space-y-1">
          <p><span className="text-muted-foreground">Tiêu đề:</span> <span className="font-medium text-foreground">{p.task_title || p.title || 'N/A'}</span></p>
          <p><span className="text-muted-foreground">Loại task:</span> {p.task_type || 'N/A'}</p>
          <p><span className="text-muted-foreground">Ưu tiên:</span> {p.priority || 'MEDIUM'}</p>
          {!p.assignee_user_id && (
            <p className="text-amber-600 dark:text-amber-400 text-[10px]">⚠ Chưa có người thực hiện — chọn nhân viên bên dưới.</p>
          )}
        </div>
        {relatedItems.length > 0 && (
          <div className="space-y-0.5">
            <p className="text-[10px] text-muted-foreground font-medium">Sách liên quan ({relatedItems.length}):</p>
            <div className="max-h-16 overflow-y-auto space-y-0.5">
              {relatedItems.map((item: any, i: number) => (
                <div key={i} className="flex items-center justify-between bg-card rounded px-2 py-0.5 border border-border">
                  <span className="truncate flex-1 text-foreground text-[10px]">{item.title || 'Unknown'}</span>
                  <span className="text-muted-foreground ml-2 text-[10px]">Còn: {item.quantity ?? '?'}</span>
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
    <div className="mt-2 rounded-xl border border-indigo-200 bg-indigo-50/80 p-3 space-y-2 text-[11px] dark:border-indigo-500/20 dark:bg-indigo-500/10">
      {/* Header — framed explicitly as a recommendation awaiting sign-off, not a chat reply */}
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-indigo-600 dark:text-indigo-400">
        <ShieldCheck size={12} />
        Đề xuất hành động — cần bạn xác nhận
      </div>
      <div className="flex items-center gap-1.5">
        <ActionTypeIcon type={action.type} />
        <span className="font-semibold text-indigo-700 dark:text-indigo-300 flex-1">
          {AI_ACTION_TYPE_LABEL[action.type] ?? action.type}
        </span>
        <StatusBadge label={action.risk} variant={getStatusVariant('pendingActionRisk', action.risk)} />
        <StatusBadge label={AI_ACTION_STATUS_LABEL[localStatus] ?? localStatus} variant={getStatusVariant('aiAction', localStatus)} />
      </div>

      {/* Summary */}
      <p className="text-foreground">{action.summary}</p>

      {/* Review warning */}
      {action.requires_review && (
        <div className="flex items-start gap-1.5 bg-amber-50 border border-amber-200 rounded-lg p-2 text-amber-700 dark:bg-amber-500/10 dark:border-amber-500/20 dark:text-amber-400">
          <AlertTriangle size={11} className="mt-0.5 shrink-0" />
          <span>Cần xem xét thêm trước khi xác nhận. Có thể chỉ tạo draft, không gọi API thật.</span>
        </div>
      )}

      {/* Warnings */}
      {action.warnings && action.warnings.length > 0 && (
        <div className="space-y-0.5">
          {action.warnings.slice(0, 3).map((w, i) => (
            <p key={i} className="text-amber-600 dark:text-amber-400 text-[10px]">⚠ {w}</p>
          ))}
        </div>
      )}

      {/* Payload preview */}
      <PayloadPreview action={action} />

      {/* Warehouse resolution status banners */}
      {isReorder && !isDone && warehouseResolutionStatus === 'RESOLVED' && resolvedWarehouseCode && (
        <div className="text-[10px] bg-emerald-50 border border-emerald-200 rounded-lg px-2 py-1.5 text-emerald-700 dark:bg-emerald-500/10 dark:border-emerald-500/20 dark:text-emerald-400">
          Kho xác định từ yêu cầu của bạn: <strong>{resolvedWarehouseCode} — {resolvedWarehouseName}</strong>
        </div>
      )}
      {isReorder && !isDone && warehouseResolutionStatus === 'AMBIGUOUS' && (
        <div className="text-[10px] bg-amber-50 border border-amber-200 rounded-lg px-2 py-1.5 text-amber-700 dark:bg-amber-500/10 dark:border-amber-500/20 dark:text-amber-400">
          ⚠ AI tìm thấy {warehouseCandidates.length} kho khớp với &ldquo;{warehouseHint}&rdquo;. Vui lòng chọn đúng kho cần tạo phiếu bên dưới.
        </div>
      )}
      {isReorder && !isDone && warehouseResolutionStatus === 'NOT_FOUND' && warehouseHint && (
        <div className="text-[10px] bg-red-50 border border-red-200 rounded-lg px-2 py-1.5 text-red-700 dark:bg-red-500/10 dark:border-red-500/20 dark:text-red-400">
          ⚠ Không tìm thấy kho phù hợp với &ldquo;{warehouseHint}&rdquo;. Vui lòng chọn kho từ danh sách.
        </div>
      )}

      {/* Warehouse selector for stock alerts, reorder fallback, ambiguous/not-found resolution */}
      {needsWarehouseSelector && !isDone && (
        <div className="space-y-1">
          <label className="text-[10px] font-medium text-muted-foreground">
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
            <p className="text-[10px] text-muted-foreground italic">Đang tải danh sách kho...</p>
          ) : (
            <Select value={selectedWarehouseId} onValueChange={setSelectedWarehouseId}>
              <SelectTrigger size="sm" className="w-full text-[11px]">
                <SelectValue placeholder="-- Chọn kho --" />
              </SelectTrigger>
              <SelectContent>
                {(warehouseResolutionStatus === 'AMBIGUOUS' && warehouseCandidates.length > 0
                  ? warehouseCandidates
                  : warehouses
                ).map((wh) => (
                  <SelectItem key={wh.id} value={wh.id}>
                    {wh.name} ({wh.code})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      )}

      {/* Supplier selector for reorder drafts (optional) */}
      {isReorder && !isDone && (
        <div className="space-y-1">
          <label className="text-[10px] font-medium text-muted-foreground">
            Nhà cung cấp{' '}
            <span className="text-muted-foreground/70 font-normal">(tùy chọn — ghi vào phiếu như gợi ý cho quản lý)</span>
          </label>
          {suppliers.length === 0 ? (
            <p className="text-[10px] text-muted-foreground italic">Đang tải hoặc chưa có NCC trong hệ thống...</p>
          ) : (
            <Select
              value={selectedSupplierId}
              onValueChange={(value) => {
                setSelectedSupplierId(value);
                const s = suppliers.find((sup) => sup.id === value);
                setSelectedSupplierName(s?.name || '');
              }}
            >
              <SelectTrigger size="sm" className="w-full text-[11px]">
                <SelectValue placeholder="-- Dùng NCC gợi ý tự động theo từng sách --" />
              </SelectTrigger>
              <SelectContent>
                {suppliers.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}{s.code ? ` (${s.code})` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {!selectedSupplierId && (
            <p className="text-[10px] text-muted-foreground">
              Hệ thống sẽ dùng NCC liên kết với từng đầu sách (nếu có). Nếu chưa có liên kết, phiếu vẫn được tạo và quản lý chọn NCC khi duyệt.
            </p>
          )}
        </div>
      )}

      {/* Staff assignee selector for staff task drafts */}
      {isStaffTask && !action.payload?.assignee_user_id && !isDone && (
        <div className="space-y-1">
          <label className="text-[10px] font-medium text-muted-foreground">
            Giao cho nhân viên <span className="text-red-500">*</span>
          </label>
          {staffList.length === 0 ? (
            <p className="text-[10px] text-muted-foreground italic">Đang tải danh sách nhân viên...</p>
          ) : (
            <Select value={selectedAssigneeId} onValueChange={setSelectedAssigneeId}>
              <SelectTrigger size="sm" className="w-full text-[11px]">
                <SelectValue placeholder="-- Chọn nhân viên --" />
              </SelectTrigger>
              <SelectContent>
                {staffList.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.full_name || s.username}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      )}

      {/* Buttons */}
      {!isDone && (
        <div className="flex gap-2 pt-0.5">
          <Button
            type="button"
            size="sm"
            onClick={() => void handleConfirm()}
            disabled={confirming || (needsWarehouseSelector && !!warehouseLoadError)}
            loading={confirming}
            loadingLabel="Đang xử lý..."
            className="flex-1 text-[11px]"
          >
            <CheckCircle size={11} />
            Xác nhận
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void handleCancel()}
            disabled={confirming}
            className="flex-1 text-[11px]"
          >
            <XCircle size={11} />
            Hủy
          </Button>
        </div>
      )}

      {/* Done states */}
      {localStatus === 'EXECUTED' && (
        <div className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-medium">
          <CheckCircle size={11} />
          Đã xác nhận. Xem kết quả bên dưới.
        </div>
      )}
      {localStatus === 'CANCELLED' && (
        <p className="text-muted-foreground">Hành động đã bị hủy.</p>
      )}
      {localStatus === 'EXPIRED' && (
        <p className="text-red-500 dark:text-red-400">Hành động đã hết hạn. Hãy hỏi AI để tạo lại.</p>
      )}
    </div>
  );
}
