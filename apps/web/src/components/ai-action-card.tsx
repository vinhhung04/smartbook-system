import { useState, useEffect, useMemo, type ReactNode } from 'react';
import { CheckCircle, AlertTriangle, FileText, ShoppingCart, Bell, ClipboardList, BookOpen, Sparkles, Building2, XCircle, SlidersHorizontal } from 'lucide-react';
import { aiService, type PendingAction } from '@/services/ai';
import { warehouseService, type Warehouse } from '@/services/warehouse';
import { userService, type WarehouseStaffOption } from '@/services/user';
import { supplierService, type Supplier } from '@/services/supplier';
import { authService } from '@/services/auth';
import { toast } from 'sonner';
import { getApiErrorMessage } from '@/services/http-clients';
import { StatusBadge } from '@/components/status-badge';
import { getStatusVariant } from '@/lib/status-registry';
import { AI_ACTION_STATUS_LABEL } from '@/lib/ai-action-labels';
import {
  summarizeStockLines, groupLinesByWarehouse, priorityLabel, priorityTone, canUserConfirmAction,
  type StockLine,
} from '@/lib/ai-decision';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AIDecisionCard, DecisionSection, EvidenceList, DecisionWarnings } from '@/components/ai/decision-card';

// Shared decision card for an AI-proposed action (PendingAction), used by both
// the floating chatbot widget (ai-chatbot.tsx) and the Decision Assistant page
// (pages/ai-assistant.tsx). Layout: decision -> status -> why -> what happens
// on confirm -> details (collapsed) -> inputs the person must supply -> actions.
// Nothing runs until the person presses the action-specific create button.

const RISK_LABEL: Record<string, string> = { LOW: 'Rủi ro thấp', MEDIUM: 'Rủi ro vừa', HIGH: 'Rủi ro cao' };
const ROLE_LABEL: Record<string, string> = { WAREHOUSE_MANAGER: 'Quản lý kho', WAREHOUSE_STAFF: 'Nhân viên kho', ADMIN: 'Quản trị viên', LIBRARIAN: 'Thủ thư' };
const TASK_TYPE_LABEL: Record<string, string> = {
  GENERAL: 'Tổng quát', CHECK_SHELF: 'Kiểm tra kệ', STOCK_CHECK: 'Kiểm kê', LOW_STOCK_REVIEW: 'Xử lý tồn kho thấp',
  EXCEPTION_FOLLOW_UP: 'Xử lý ngoại lệ', REORDER_REVIEW: 'Xem xét nhập sách', RESERVATION_FOLLOW_UP: 'Theo dõi đặt trước',
  INVENTORY_AUDIT: 'Kiểm toán kho', OTHER: 'Khác',
};

const CONFIRM_LABEL: Record<string, string> = {
  CREATE_REORDER_DRAFT: 'Tạo phiếu đề xuất nhập',
  CREATE_STOCK_ALERT: 'Tạo cảnh báo',
  CREATE_STAFF_TASK_DRAFT: 'Tạo nhiệm vụ',
  CREATE_RESERVATION_DRAFT: 'Tạo đặt trước',
  CREATE_REPORT_DRAFT: 'Tạo báo cáo nháp',
};

function ActionTypeIcon({ type }: { type: string }) {
  const cls = 'h-3.5 w-3.5';
  const icons: Record<string, ReactNode> = {
    CREATE_REORDER_DRAFT: <ShoppingCart className={cls} aria-hidden="true" />,
    CREATE_REPORT_DRAFT: <FileText className={cls} aria-hidden="true" />,
    CREATE_RESERVATION_DRAFT: <BookOpen className={cls} aria-hidden="true" />,
    CREATE_STOCK_ALERT: <Bell className={cls} aria-hidden="true" />,
    CREATE_STAFF_TASK_DRAFT: <ClipboardList className={cls} aria-hidden="true" />,
  };
  return <>{icons[type] ?? <Sparkles className={cls} aria-hidden="true" />}</>;
}

const fmt = (n: number) => new Intl.NumberFormat('vi-VN').format(n);

// ── Book lines: stacked rows in a narrow card, a compact table when wide ──────

interface LineEditState {
  quantities: Record<number, number>;
  excluded: Set<number>;
}

function StockLines({
  lines,
  showQuantity,
  edit,
  onEdit,
}: {
  lines: Array<StockLine & { _index: number }>;
  showQuantity: boolean;
  edit?: LineEditState | null;
  onEdit?: (next: LineEditState) => void;
}) {
  const groups = groupLinesByWarehouse(lines);
  const qtyOf = (l: StockLine & { _index: number }) => edit?.quantities[l._index] ?? Math.max(1, Number(l.suggested_quantity) || 1);
  const setQty = (index: number, value: number) => edit && onEdit?.({ ...edit, quantities: { ...edit.quantities, [index]: value } });
  const toggle = (index: number) => {
    if (!edit || !onEdit) return;
    const excluded = new Set(edit.excluded);
    if (excluded.has(index)) excluded.delete(index); else excluded.add(index);
    onEdit({ ...edit, excluded });
  };

  return (
    <div className="space-y-3">
      {groups.map((group) => (
        <div key={group.key ?? 'none'} className="space-y-1.5">
          <p className={`flex items-center gap-1.5 text-[12px] font-semibold ${group.key ? 'text-foreground' : 'text-amber-700 dark:text-amber-400'}`}>
            {group.key ? <Building2 className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" /> : <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />}
            {group.label} · {group.lines.length} đầu sách
          </p>
          <ul className="divide-y divide-border rounded-lg border border-border">
            <li className="hidden grid-cols-[1fr_5rem_7rem_7rem] gap-2 bg-muted/40 px-3 py-1.5 text-[11px] font-medium text-muted-foreground @lg:grid" aria-hidden="true">
              <span>Sách</span><span className="text-right">Tồn kho</span>
              <span className="text-right">{showQuantity ? 'SL đề xuất' : 'Mức tối thiểu'}</span><span className="text-right">Ưu tiên</span>
            </li>
            {group.lines.map((line) => {
              const excluded = edit?.excluded.has(line._index);
              const minimum = line.reorder_point ?? line.threshold;
              return (
                <li key={line._index} className={`grid grid-cols-[1fr_auto] gap-x-2 gap-y-1 px-3 py-2 text-[13px] @lg:grid-cols-[1fr_5rem_7rem_7rem] @lg:items-center ${excluded ? 'opacity-50' : ''}`}>
                  <span className="col-span-2 flex min-w-0 items-center gap-2 font-medium text-foreground @lg:col-span-1">
                    {edit && (
                      <input
                        type="checkbox"
                        className="h-4 w-4 shrink-0 accent-primary"
                        checked={!excluded}
                        onChange={() => toggle(line._index)}
                        aria-label={`Giữ "${line.title}" trong phiếu`}
                      />
                    )}
                    <span className="truncate" title={line.title ?? undefined}>{line.title}</span>
                  </span>
                  <span className="text-[12px] text-muted-foreground @lg:text-right @lg:text-[13px] @lg:text-foreground">
                    <span className="@lg:hidden">Tồn: </span>{line.current_stock ?? '—'}
                  </span>
                  <span className="text-right text-[12px] @lg:text-[13px]">
                    {showQuantity ? (
                      edit && !excluded ? (
                        <Input
                          type="number"
                          min={1}
                          value={qtyOf(line)}
                          onChange={(e) => setQty(line._index, Math.max(1, Math.floor(Number(e.target.value) || 1)))}
                          className="ml-auto h-8 w-20 text-right text-[13px]"
                          aria-label={`Số lượng nhập cho "${line.title}"`}
                        />
                      ) : (
                        <span className="font-semibold text-foreground"><span className="font-normal text-muted-foreground @lg:hidden">Nhập: </span>{qtyOf(line)}</span>
                      )
                    ) : (
                      <span className="text-muted-foreground"><span className="@lg:hidden">Tối thiểu: </span>{minimum ?? '—'}</span>
                    )}
                  </span>
                  <span className="col-span-2 @lg:col-span-1 @lg:text-right">
                    <StatusBadge label={priorityLabel(line.priority)} variant={priorityTone(line.priority)} />
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}

// ── ActionCard ─────────────────────────────────────────────────────────────────

interface ActionCardProps {
  action: PendingAction;
  onConfirmed: (actionId: string, result: any, actionType: string) => void;
  onCancelled: (actionId: string) => void;
}

export function ActionCard({ action, onConfirmed, onCancelled }: ActionCardProps) {
  const [localStatus, setLocalStatus] = useState(action.status);
  const [confirming, setConfirming] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [selectedWarehouseId, setSelectedWarehouseId] = useState<string>('');
  const [warehouseLoadError, setWarehouseLoadError] = useState<string | null>(null);
  const [staffList, setStaffList] = useState<WarehouseStaffOption[] | null>(null);
  const [staffLoadError, setStaffLoadError] = useState(false);
  const [selectedAssigneeId, setSelectedAssigneeId] = useState<string>('');
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [selectedSupplierId, setSelectedSupplierId] = useState<string>('');
  const [edit, setEdit] = useState<LineEditState | null>(null);

  const p = action.payload || {};
  const isReorder = action.type === 'CREATE_REORDER_DRAFT';
  const isStockAlert = action.type === 'CREATE_STOCK_ALERT';
  const isStaffTask = action.type === 'CREATE_STAFF_TASK_DRAFT';
  const isReservation = action.type === 'CREATE_RESERVATION_DRAFT';
  const isReport = action.type === 'CREATE_REPORT_DRAFT';
  const isDone = localStatus !== 'PENDING_CONFIRMATION';
  const canConfirm = canUserConfirmAction(authService.getCurrentUser(), action);

  const lines = useMemo(
    () => ((p.items || []) as StockLine[])
      .map((line, _index) => ({ ...line, _index }))
      .filter((line) => line && line.title),
    [p.items],
  );
  const summary = useMemo(() => summarizeStockLines(lines), [lines]);

  // Warehouse resolution metadata from the AI planner
  const warehouseResolutionStatus = p.warehouse_resolution_status as string | undefined;
  const warehouseCandidates: { id: string; code: string; name: string }[] = p.warehouse_candidates || [];
  const warehouseHint: string = p.warehouse_hint || '';

  // A warehouse must be picked only when the planner could not pin one down.
  const needsWarehouseSelector =
    ((isReorder || isStockAlert) && summary.missingWarehouseCount > 0) ||
    warehouseResolutionStatus === 'AMBIGUOUS' ||
    warehouseResolutionStatus === 'NOT_FOUND';
  const needsAssignee = isStaffTask && !p.assignee_user_id;
  const warehouseOptions = warehouseResolutionStatus === 'AMBIGUOUS' && warehouseCandidates.length ? warehouseCandidates : warehouses;

  useEffect(() => {
    if (!needsWarehouseSelector || isDone) return;
    warehouseService.getAll({ is_active: true }).then((data: any) => {
      const list: Warehouse[] = Array.isArray(data) ? data : (data?.data ?? []);
      setWarehouses(list);
      if (list.length === 1) setSelectedWarehouseId(list[0].id);
    }).catch(() => {
      setWarehouseLoadError('Không tải được danh sách kho. Vui lòng thử lại.');
    });
  }, [needsWarehouseSelector, isDone]);

  // Supplier override is part of "Điều chỉnh trước khi tạo" — load only then.
  useEffect(() => {
    if (!isReorder || isDone || !edit || suppliers.length) return;
    supplierService.getAll()
      .then((data: any) => {
        const list: Supplier[] = Array.isArray(data) ? data : (data?.data ?? []);
        setSuppliers(list.filter((s: any) => s.status === 'ACTIVE'));
      })
      .catch(() => { /* optional field — the draft falls back to per-book suppliers */ });
  }, [isReorder, isDone, edit, suppliers.length]);

  useEffect(() => {
    if (!needsAssignee || isDone) return;
    userService.getWarehouseStaff()
      .then((resp) => setStaffList(resp.data || []))
      .catch(() => { setStaffLoadError(true); setStaffList([]); });
  }, [needsAssignee, isDone]);

  const keptLineCount = edit ? lines.filter((l) => !edit.excluded.has(l._index)).length : lines.length;
  const blockingReason =
    !canConfirm ? 'Tài khoản của bạn không có quyền xác nhận đề xuất này.'
    : needsWarehouseSelector && warehouseLoadError ? warehouseLoadError
    : needsWarehouseSelector && !selectedWarehouseId ? 'Cần chọn kho trước khi tạo.'
    : needsAssignee && !selectedAssigneeId ? 'Cần chọn người thực hiện trước khi tạo.'
    : isReorder && edit && keptLineCount === 0 ? 'Cần giữ lại ít nhất một đầu sách.'
    : null;

  const handleConfirm = async () => {
    if (confirming || isDone || blockingReason) return;
    setConfirming(true);
    try {
      const override: Record<string, unknown> = {};
      if (needsWarehouseSelector && selectedWarehouseId) {
        override.warehouse_id = selectedWarehouseId;
        // Sent so result messages can name the warehouse instead of showing its id.
        const chosen = warehouseOptions.find((wh) => wh.id === selectedWarehouseId);
        if (chosen) { override.warehouse_name = chosen.name; override.warehouse_code = chosen.code; }
      }
      if (isReorder && selectedSupplierId) {
        override.supplier_id = selectedSupplierId;
        override.supplier_name = suppliers.find((s) => s.id === selectedSupplierId)?.name || '';
      }
      if (isReorder && edit) {
        // The confirm endpoint shallow-merges override_payload into the payload,
        // and the executor reads items[].suggested_quantity - so adjusted
        // quantities and removed lines are applied for real.
        override.items = (p.items || [])
          .map((item: any, index: number) => ({ item, index }))
          .filter(({ item, index }: { item: any; index: number }) => !item?.title || !edit.excluded.has(index))
          .map(({ item, index }: { item: any; index: number }) => (
            item?.title && edit.quantities[index] ? { ...item, suggested_quantity: edit.quantities[index] } : item
          ));
      }
      if (needsAssignee && selectedAssigneeId) override.assignee_user_id = selectedAssigneeId;
      const resp = await aiService.confirmAction(action.id, Object.keys(override).length ? override : undefined);
      setLocalStatus(resp.status);
      onConfirmed(action.id, resp.result, action.type);
    } catch (err: any) {
      const status = err?.response?.status;
      if (status === 403) toast.error('Bạn không có quyền xác nhận đề xuất này.');
      else if (status === 410) { toast.error('Đề xuất đã hết hạn, vui lòng yêu cầu hệ thống tạo lại.'); setLocalStatus('EXPIRED'); }
      else toast.error(getApiErrorMessage(err, 'Không thể thực hiện đề xuất.'));
    } finally {
      setConfirming(false);
    }
  };

  const handleReject = async () => {
    if (confirming || rejecting || isDone) return;
    setRejecting(true);
    try {
      await aiService.cancelAction(action.id);
      setLocalStatus('CANCELLED');
      onCancelled(action.id);
    } catch {
      toast.error('Không thể từ chối đề xuất. Vui lòng thử lại.');
    } finally {
      setRejecting(false);
    }
  };

  // ── Per-type content ────────────────────────────────────────────────────────
  let eyebrow = 'Đề xuất hành động';
  let title: ReactNode = action.summary;
  let facts: Array<{ label: string; value: ReactNode }> = [];
  const why: Array<{ text: ReactNode; tone?: 'danger' | 'warning' | 'success' | 'neutral' | 'info' }> = [];
  let onConfirmEffect: string[] = [];
  let details: ReactNode = null;
  let detailsTitle = 'Chi tiết dữ liệu';

  const warehouseFact = summary.warehouses.length === 1 ? summary.warehouses[0]
    : summary.warehouses.length > 1 ? `${summary.warehouses.length} kho`
    : 'Cần chọn kho';

  if (isReorder) {
    eyebrow = 'Đề xuất nhập bổ sung';
    const kept = edit ? lines.filter((l) => !edit.excluded.has(l._index)) : lines;
    const keptSummary = summarizeStockLines(kept.map((l) => ({ ...l, suggested_quantity: edit?.quantities[l._index] ?? l.suggested_quantity })));
    const qty = keptSummary.totalSuggestedQty;
    title = `Nhập thêm ${fmt(qty)} bản cho ${keptLineCount} đầu sách`;
    facts = [
      { label: 'Đầu sách', value: keptLineCount },
      { label: 'Tổng số bản', value: fmt(qty) },
      { label: 'Ưu tiên cao', value: keptSummary.highPriorityCount },
      { label: 'Kho', value: warehouseFact },
    ];
    if (summary.outOfStockCount) why.push({ tone: 'danger', text: `${summary.outOfStockCount} đầu sách đã hết hàng (tồn kho = 0)` });
    if (summary.belowMinimumCount) why.push({ tone: 'warning', text: `${summary.belowMinimumCount} đầu sách dưới mức tồn tối thiểu` });
    if (summary.highPriorityCount) why.push({ tone: 'warning', text: `${summary.highPriorityCount} đầu sách được đánh dấu ưu tiên cao` });
    why.push({ tone: 'neutral', text: `Tổng tồn kho hiện tại của các đầu sách này: ${fmt(summary.currentStockTotal)} bản` });
    if (summary.withSupplierCount) why.push({ tone: 'neutral', text: `${summary.withSupplierCount} đầu sách đã có nhà cung cấp liên kết` });
    onConfirmEffect = [
      `Tạo ${keptLineCount} phiếu đề xuất nhập ở trạng thái chờ quản lý duyệt — chưa đặt hàng với nhà cung cấp.`,
      `Nếu được duyệt và nhập đủ: tồn kho các đầu sách này từ ${fmt(keptSummary.currentStockTotal)} lên ${fmt(keptSummary.currentStockTotal + qty)} bản.`,
    ];
    detailsTitle = `Xem ${lines.length} đầu sách`;
    details = <StockLines lines={lines} showQuantity edit={edit} onEdit={setEdit} />;
  } else if (isStockAlert) {
    eyebrow = 'Cảnh báo tồn kho';
    title = `${summary.lineCount} đầu sách cần chú ý`;
    facts = [
      { label: 'Đầu sách', value: summary.lineCount },
      { label: 'Ưu tiên cao', value: summary.highPriorityCount },
      { label: 'Hết hàng', value: summary.outOfStockCount },
      { label: 'Kho', value: warehouseFact },
    ];
    if (summary.outOfStockCount) why.push({ tone: 'danger', text: `${summary.outOfStockCount} đầu sách đã hết hàng` });
    if (summary.belowMinimumCount) why.push({ tone: 'warning', text: `${summary.belowMinimumCount} đầu sách dưới mức tồn tối thiểu` });
    const roles = ((p.target_roles || []) as string[]).map((r) => ROLE_LABEL[r] || r);
    onConfirmEffect = [
      `Tạo ${summary.lineCount} cảnh báo tồn kho${roles.length ? `, hiển thị cho ${roles.join(', ')}` : ''}.`,
      'Không thay đổi số lượng tồn kho.',
    ];
    detailsTitle = `Xem ${summary.lineCount} đầu sách theo kho`;
    details = <StockLines lines={lines} showQuantity={false} />;
  } else if (isStaffTask) {
    eyebrow = 'Đề xuất tạo nhiệm vụ kho';
    title = p.task_title || p.title || action.summary;
    const related: any[] = p.related_items || [];
    const assignee = staffList?.find((s) => s.id === selectedAssigneeId);
    facts = [
      { label: 'Loại nhiệm vụ', value: TASK_TYPE_LABEL[p.task_type] || p.task_type || '—' },
      { label: 'Ưu tiên', value: priorityLabel(p.priority) },
      { label: 'Sách liên quan', value: related.length },
      { label: 'Người thực hiện', value: assignee ? (assignee.full_name || assignee.username) : p.assignee_user_id ? 'Đã chỉ định' : 'Chưa chọn' },
    ];
    if (p.instructions) why.push({ tone: 'neutral', text: p.instructions });
    onConfirmEffect = ['Tạo nhiệm vụ và giao cho người được chọn; nhiệm vụ xuất hiện trong danh sách việc của họ.'];
    if (related.length) {
      detailsTitle = `Xem ${related.length} sách liên quan`;
      details = (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {related.map((item, i) => (
            <li key={i} className="flex items-center justify-between gap-2 px-3 py-2 text-[13px]">
              <span className="truncate text-foreground">{item.title || 'Không rõ tên'}</span>
              <span className="shrink-0 text-[12px] text-muted-foreground">Tồn: {item.quantity ?? '—'}</span>
            </li>
          ))}
        </ul>
      );
    }
  } else if (isReservation) {
    eyebrow = 'Đề xuất đặt trước sách';
    const bookTitle = p.book_title || p.title_query || '—';
    const ready = Boolean((p.variant_id || p.book_variant_id) && p.warehouse_id) && !p.requires_review;
    // Without a book_id the planner never matched the catalog: its "title" is
    // just the user's own words, so say so instead of presenting it as a book.
    title = p.book_id ? `Đặt trước “${bookTitle}”` : `Chưa tìm thấy sách khớp với “${p.title_query || bookTitle}”`;
    facts = [
      { label: 'Sách', value: <span className="line-clamp-2 text-[13px]">{p.book_id ? bookTitle : 'Chưa xác định'}</span> },
      { label: 'Kho', value: p.warehouse_id ? 'Đã xác định' : 'Chưa xác định' },
      { label: 'Số lượng', value: p.quantity || 1 },
      { label: 'Trạng thái', value: ready ? 'Đủ thông tin' : 'Thiếu thông tin' },
    ];
    onConfirmEffect = ready
      ? ['Tạo đặt trước và giữ sách trong thời gian giữ chỗ theo gói thành viên.']
      : ['Chỉ lưu bản nháp — chưa tạo đặt trước thật vì chưa xác định được biến thể sách hoặc kho.'];
    detailsTitle = 'Chi tiết kỹ thuật';
    details = (
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[12px]">
        <dt className="text-muted-foreground">variant_id</dt><dd className="break-all font-mono text-foreground">{p.variant_id || p.book_variant_id || '—'}</dd>
        <dt className="text-muted-foreground">warehouse_id</dt><dd className="break-all font-mono text-foreground">{p.warehouse_id || '—'}</dd>
      </dl>
    );
  } else if (isReport) {
    eyebrow = 'Đề xuất tạo báo cáo';
    title = p.report_title || action.summary;
    onConfirmEffect = ['Lưu báo cáo nháp để xem và xuất; không thay đổi dữ liệu thư viện.'];
    detailsTitle = 'Xem trước nội dung';
    details = (
      <pre className="max-h-64 overflow-y-auto whitespace-pre-wrap rounded-lg border border-border bg-muted/40 p-3 text-[12px] text-foreground">
        {p.report_markdown || ''}
      </pre>
    );
  }

  const warnings = (action.warnings || []).filter((w) => !(needsAssignee && /người thực hiện/i.test(w)));
  const sources = (p.sources || action.sources || []).map((s: any) => (typeof s === 'string' ? s : s?.name)).filter(Boolean);

  const keptMissingWarehouse = lines.filter((l) => !l.warehouse_id && !edit?.excluded.has(l._index)).length;
  const warehouseLabel = warehouseResolutionStatus === 'AMBIGUOUS'
    ? `Chọn kho (có ${warehouseCandidates.length} kho khớp với “${warehouseHint}”)`
    : warehouseResolutionStatus === 'NOT_FOUND'
      ? `Chọn kho (không tìm thấy kho “${warehouseHint}”)`
      : `Chọn kho cho ${keptMissingWarehouse} đầu sách chưa xác định kho`;

  return (
    <AIDecisionCard
      className="mt-2"
      aria-label={`${eyebrow}: ${typeof title === 'string' ? title : action.summary}`}
      eyebrow={eyebrow}
      icon={<ActionTypeIcon type={action.type} />}
      title={title}
      facts={facts}
      badges={(
        <>
          <StatusBadge label={RISK_LABEL[action.risk] ?? action.risk} variant={getStatusVariant('pendingActionRisk', action.risk)} />
          <StatusBadge label={AI_ACTION_STATUS_LABEL[localStatus] ?? localStatus} variant={getStatusVariant('aiAction', localStatus)} />
        </>
      )}
      footer={isDone ? (
        <p className={`flex items-center gap-1.5 text-[13px] font-medium ${localStatus === 'EXECUTED' ? 'text-emerald-700 dark:text-emerald-400' : localStatus === 'CANCELLED' ? 'text-muted-foreground' : 'text-red-600 dark:text-red-400'}`} role="status">
          {localStatus === 'EXECUTED' ? <CheckCircle className="h-4 w-4" aria-hidden="true" /> : <XCircle className="h-4 w-4" aria-hidden="true" />}
          {localStatus === 'EXECUTED' ? 'Đã thực hiện theo xác nhận của bạn. Xem kết quả bên dưới.'
            : localStatus === 'CANCELLED' ? 'Bạn đã từ chối đề xuất này. Không có thay đổi nào được thực hiện.'
            : localStatus === 'EXPIRED' ? 'Đề xuất đã hết hạn. Hãy yêu cầu hệ thống tạo lại.'
            : 'Không thực hiện được đề xuất.'}
        </p>
      ) : (
        <div className="space-y-3">
          {needsWarehouseSelector && (
            <div className="space-y-1">
              <label className="text-[12px] font-medium text-foreground" htmlFor={`wh-${action.id}`}>{warehouseLabel} <span className="text-red-600">*</span></label>
              {warehouseLoadError ? (
                <p className="text-[12px] text-red-600 dark:text-red-400" role="alert">{warehouseLoadError}</p>
              ) : warehouseOptions.length === 0 ? (
                <p className="text-[12px] text-muted-foreground">Đang tải danh sách kho…</p>
              ) : (
                <Select value={selectedWarehouseId} onValueChange={setSelectedWarehouseId}>
                  <SelectTrigger id={`wh-${action.id}`} size="sm" className="w-full text-[13px]"><SelectValue placeholder="Chọn kho" /></SelectTrigger>
                  <SelectContent>
                    {warehouseOptions.map((wh) => <SelectItem key={wh.id} value={wh.id}>{wh.name} ({wh.code})</SelectItem>)}
                  </SelectContent>
                </Select>
              )}
            </div>
          )}
          {needsAssignee && (
            <div className="space-y-1">
              <label className="flex items-center gap-1.5 text-[12px] font-medium text-amber-800 dark:text-amber-300" htmlFor={`assignee-${action.id}`}>
                <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" /> Cần chọn người thực hiện <span className="text-red-600">*</span>
              </label>
              {staffLoadError ? (
                <p className="text-[12px] text-red-600 dark:text-red-400" role="alert">Không tải được danh sách nhân viên kho.</p>
              ) : staffList === null ? (
                <p className="text-[12px] text-muted-foreground">Đang tải danh sách nhân viên…</p>
              ) : staffList.length === 0 ? (
                <p className="text-[12px] text-muted-foreground">Chưa có nhân viên kho nào để giao.</p>
              ) : (
                <Select value={selectedAssigneeId} onValueChange={setSelectedAssigneeId}>
                  <SelectTrigger id={`assignee-${action.id}`} size="sm" className="w-full text-[13px]"><SelectValue placeholder="Chọn nhân viên" /></SelectTrigger>
                  <SelectContent>
                    {staffList.map((s) => <SelectItem key={s.id} value={s.id}>{s.full_name || s.username}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}
            </div>
          )}
          {blockingReason && (
            <p className="text-[12px] text-muted-foreground" id={`block-${action.id}`}>{blockingReason}</p>
          )}
          <div className="flex flex-col-reverse gap-2 @xl:flex-row @xl:items-center @xl:justify-end">
            <Button type="button" variant="ghost" size="sm" onClick={() => void handleReject()} disabled={confirming} loading={rejecting} loadingLabel="Đang từ chối…" className="text-[13px] text-muted-foreground">
              Từ chối đề xuất
            </Button>
            {isReorder && canConfirm && (
              <Button type="button" variant="outline" size="sm" onClick={() => setEdit(edit ? null : { quantities: {}, excluded: new Set() })} disabled={confirming} aria-pressed={Boolean(edit)} className="text-[13px]">
                <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
                {edit ? 'Hủy điều chỉnh' : 'Điều chỉnh trước khi tạo'}
              </Button>
            )}
            <Button
              type="button"
              size="sm"
              onClick={() => void handleConfirm()}
              disabled={Boolean(blockingReason)}
              aria-describedby={blockingReason ? `block-${action.id}` : undefined}
              loading={confirming}
              loadingLabel="Đang thực hiện…"
              className="text-[13px] font-semibold"
            >
              <CheckCircle className="h-3.5 w-3.5" aria-hidden="true" />
              {isReservation && !((p.variant_id || p.book_variant_id) && p.warehouse_id) ? 'Lưu bản nháp' : CONFIRM_LABEL[action.type] ?? 'Chấp nhận đề xuất'}
            </Button>
          </div>
        </div>
      )}
    >
      {!isDone && <DecisionWarnings items={warnings} />}

      {why.length > 0 && (
        <DecisionSection title="Tại sao hệ thống đề xuất?">
          <EvidenceList items={why} />
        </DecisionSection>
      )}

      {onConfirmEffect.length > 0 && !isDone && (
        <DecisionSection title="Khi bạn xác nhận">
          <EvidenceList items={onConfirmEffect.map((text) => ({ text, tone: 'info' as const }))} />
        </DecisionSection>
      )}

      {isReorder && edit && !isDone && (
        <div className="space-y-1 rounded-lg border border-border bg-muted/30 p-3">
          <p className="text-[12px] font-semibold text-foreground">Điều chỉnh trước khi tạo</p>
          <p className="text-[12px] text-muted-foreground">Bỏ chọn đầu sách không muốn nhập hoặc sửa số lượng trong danh sách bên dưới.</p>
          <label className="block pt-1 text-[12px] font-medium text-foreground" htmlFor={`sup-${action.id}`}>Nhà cung cấp chung (tùy chọn)</label>
          <Select value={selectedSupplierId || 'auto'} onValueChange={(v) => setSelectedSupplierId(v === 'auto' ? '' : v)}>
            <SelectTrigger id={`sup-${action.id}`} size="sm" className="w-full text-[13px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">Dùng nhà cung cấp liên kết của từng đầu sách</SelectItem>
              {suppliers.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}{s.code ? ` (${s.code})` : ''}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      )}

      {details && (
        <DecisionSection title={detailsTitle} collapsible defaultOpen={Boolean(edit)} key={edit ? 'edit' : 'view'}>
          {details}
          {sources.length > 0 && (
            <p className="pt-2 text-[11px] text-muted-foreground">Nguồn dữ liệu: {sources.join(', ')}</p>
          )}
        </DecisionSection>
      )}
    </AIDecisionCard>
  );
}
