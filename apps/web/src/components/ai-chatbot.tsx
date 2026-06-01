import { useState, useRef, useEffect, useCallback } from 'react';
import { Bot, X, Send, Sparkles, RotateCcw, Database, Zap, CheckCircle, XCircle, AlertTriangle, FileText, ShoppingCart, Bell, ClipboardList, BookOpen } from 'lucide-react';
import { aiService, type ChatMessage, type SystemContext, type PendingAction } from '@/services/ai';
import { bookService } from '@/services/book';
import { borrowService } from '@/services/borrow';
import { stockMovementService } from '@/services/stock-movement';
import { warehouseService, type Warehouse } from '@/services/warehouse';
import { userService, type WarehouseStaffOption } from '@/services/user';
import { supplierService, type Supplier } from '@/services/supplier';
import { authService, type AuthUser } from '@/services/auth';
import { getPrimaryRole } from '@/lib/rbac';
import { toast } from 'sonner';
import { getApiErrorMessage } from '@/services/http-clients';

interface UIMessage {
  id: number;
  role: 'user' | 'assistant';
  text: string;
  pending_action?: PendingAction | null;
  action_result?: any;
  intent?: string;
  context_sources?: any[];
  retrieval_warnings?: string[];
  suggestions?: string[];
}

function getRoleSuggestions(user: AuthUser | null): string[] {
  if (!user) {
    return [
      'SmartBook có những tính năng gì?',
      'Hướng dẫn mượn sách.',
    ];
  }
  const role = getPrimaryRole(user);
  switch (role) {
    case 'CUSTOMER':
      return [
        'Tôi có sách nào sắp đến hạn trả?',
        'Tôi có khoản phạt nào chưa thanh toán?',
        'Gợi ý sách phù hợp với tôi.',
        'Tình trạng đặt sách của tôi?',
      ];
    case 'WAREHOUSE_STAFF':
      return [
        'Task hôm nay của tôi là gì?',
        'Tôi có đơn picking nào cần làm?',
        'Tôi có phiếu putaway nào được giao?',
        'Báo cáo ngoại lệ của tôi.',
      ];
    case 'WAREHOUSE_MANAGER':
    case 'ADMIN':
      return [
        'Tổng quan vận hành hôm nay.',
        'Có task nào chưa giao nhân viên?',
        'Sách nào tồn kho thấp?',
        'Tổng quan loan và phạt hôm nay.',
      ];
    case 'LIBRARIAN':
      return [
        'Có loan nào quá hạn?',
        'Reservation nào đang chờ xử lý?',
        'Khách nào có phạt chưa thanh toán?',
        'Tình trạng mượn trả hôm nay.',
      ];
    default:
      return [
        'Nên nhập thêm sách nào? Tạo đề xuất nhập thêm giúp tôi.',
        'Cảnh báo các sách tồn kho thấp.',
        'Tạo task cho staff kiểm tra các sách sắp hết hàng.',
        'Sách nào đang quá hạn?',
      ];
  }
}

function getPageSuggestions(pathname: string, user: AuthUser | null): string[] | null {
  if (pathname.includes('/picking')) return [
    'Task lấy hàng nào đang chờ tôi?',
    'Hướng dẫn quy trình quét barcode.',
    'Có đơn REPICK nào đang mở không?',
  ];
  if (pathname.includes('/outbound')) return [
    'Đơn xuất kho nào chưa xác nhận?',
    'Tổng hợp tình trạng xuất kho hôm nay.',
  ];
  if (pathname.includes('/putaway')) return [
    'Phiếu nhập nào đang chờ cất hàng?',
    'Vị trí kệ nào còn chỗ trống?',
  ];
  if (pathname.includes('/borrow/loans')) return [
    'Có loan nào quá hạn hôm nay?',
    'Nhắc nhở khách hàng trả sách.',
    'Loan nào đến hạn trong 3 ngày tới?',
  ];
  if (pathname.includes('/borrow/reservations')) return [
    'Đặt trước nào đang chờ xác nhận?',
    'Có reservation nào sắp hết hạn?',
  ];
  if (pathname.includes('/borrow/fines')) return [
    'Khách nào có phạt cao nhất?',
    'Tổng tiền phạt chưa thu là bao nhiêu?',
  ];
  if (pathname.includes('/purchase-orders') || pathname.includes('/purchase-requests')) return [
    'PO nào đang chờ xác nhận từ NCC?',
    'Yêu cầu mua hàng nào cần duyệt gấp?',
  ];
  if (pathname.includes('/exception-reports')) return [
    'Báo cáo sự cố nào đang mở?',
    'Tổng hợp ngoại lệ theo loại hàng.',
  ];
  if (pathname.includes('/inventory') || pathname.includes('/movements')) return [
    'Sách nào tồn kho dưới ngưỡng tối thiểu?',
    'Biến động tồn kho trong tuần này.',
    'Đề xuất nhập thêm các sách sắp hết.',
  ];
  if (pathname.includes('/my-warehouse-tasks')) return [
    'Task nào tôi có thể tự nhận ngay?',
    'Tóm tắt công việc của tôi hôm nay.',
  ];
  if (pathname.includes('/customer/loans')) return [
    'Sách nào của tôi sắp đến hạn?',
    'Tôi có thể gia hạn được không?',
  ];
  if (pathname.includes('/customer/reservations')) return [
    'Đặt trước nào của tôi đã sẵn sàng nhận?',
  ];
  return getRoleSuggestions(user);
}

function getWelcomeGreeting(user: AuthUser | null): string {
  if (!user) return 'Xin chào! Tôi là SmartBook AI 👋';
  const name = user.full_name || user.username;
  const roleLabel: Record<string, string> = {
    ADMIN: 'Admin',
    WAREHOUSE_MANAGER: 'Quản lý kho',
    LIBRARIAN: 'Thủ thư',
    WAREHOUSE_STAFF: 'Nhân viên kho',
    CUSTOMER: '',
    SUPPLIER: 'Nhà cung cấp',
  };
  const role = getPrimaryRole(user);
  const label = roleLabel[role] ?? '';
  return label
    ? `Xin chào ${label} **${name}**! 👋`
    : `Xin chào **${name}**! 👋`;
}

// ── Risk & status badge helpers ───────────────────────────────────────────────

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

function ActionCard({ action, onConfirmed, onCancelled }: ActionCardProps) {
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

// ── Report result display ─────────────────────────────────────────────────────

function ReportResult({ markdown }: { markdown: string }) {
  return (
    <pre className="mt-2 text-[10px] text-gray-700 bg-gray-50 border border-gray-200 rounded-lg p-2 whitespace-pre-wrap max-h-48 overflow-y-auto">
      {markdown}
    </pre>
  );
}

// ── MessageText ───────────────────────────────────────────────────────────────

function MessageText({ text }: { text: string }) {
  const lines = text.split('\n');

  function renderInline(line: string) {
    const parts = line.split(/\*\*(.*?)\*\*/g);
    return parts.map((part, i) =>
      i % 2 === 1 ? (
        <strong key={i} className="font-semibold">
          {part}
        </strong>
      ) : (
        part
      ),
    );
  }

  const elements: React.ReactNode[] = [];
  let listBuffer: { type: 'ul' | 'ol'; items: React.ReactNode[] } | null = null;

  function flushList() {
    if (!listBuffer) return;
    const { type, items } = listBuffer;
    const Tag = type;
    elements.push(
      <Tag key={`list-${elements.length}`} className={type === 'ul' ? 'list-disc ml-4 space-y-0.5' : 'list-decimal ml-4 space-y-0.5'}>
        {items}
      </Tag>,
    );
    listBuffer = null;
  }

  lines.forEach((line, idx) => {
    // Heading level 1: # Text
    if (/^#\s+/.test(line)) {
      flushList();
      elements.push(
        <p key={idx} className="font-semibold text-[12px] mt-2 mb-0.5">
          {renderInline(line.replace(/^#+\s+/, ''))}
        </p>,
      );
      return;
    }
    // Heading level 2: ## Text
    if (/^##\s+/.test(line)) {
      flushList();
      elements.push(
        <p key={idx} className="font-semibold text-[11px] mt-1.5 mb-0.5 text-gray-600">
          {renderInline(line.replace(/^#+\s+/, ''))}
        </p>,
      );
      return;
    }
    // Unordered list: - item or * item
    const ulMatch = line.match(/^[-*]\s+(.*)/);
    if (ulMatch) {
      if (!listBuffer || listBuffer.type !== 'ul') {
        flushList();
        listBuffer = { type: 'ul', items: [] };
      }
      listBuffer.items.push(
        <li key={idx} className="text-[11px] leading-snug">
          {renderInline(ulMatch[1])}
        </li>,
      );
      return;
    }
    // Ordered list: 1. item
    const olMatch = line.match(/^\d+\.\s+(.*)/);
    if (olMatch) {
      if (!listBuffer || listBuffer.type !== 'ol') {
        flushList();
        listBuffer = { type: 'ol', items: [] };
      }
      listBuffer.items.push(
        <li key={idx} className="text-[11px] leading-snug">
          {renderInline(olMatch[1])}
        </li>,
      );
      return;
    }
    // Blank line — flush list, add spacer
    if (line.trim() === '') {
      flushList();
      elements.push(<br key={idx} />);
      return;
    }
    // Normal text line
    flushList();
    elements.push(
      <span key={idx} className="block text-[11px] leading-snug">
        {renderInline(line)}
      </span>,
    );
  });

  flushList();

  return <div className="text-sm leading-relaxed space-y-0.5">{elements}</div>;
}

// ── System context gathering ──────────────────────────────────────────────────

async function gatherSystemContext(user: AuthUser | null): Promise<SystemContext | undefined> {
  // Backend fetches personal context for these roles; no need to send system_context.
  const role = user ? getPrimaryRole(user) : null;
  const skipRoles = new Set(['CUSTOMER', 'WAREHOUSE_STAFF', 'SUPPLIER']);
  if (role && skipRoles.has(role)) return undefined;

  const ctx: SystemContext = {};

  const [bookResp, loanResp, fineResp, movResp] = await Promise.allSettled([
    bookService.getAll(),
    borrowService.getLoans({ pageSize: 30 }),
    borrowService.getFines({ pageSize: 20 }),
    stockMovementService.getAll({ pageSize: 15 }),
  ]);

  if (bookResp.status === 'fulfilled') {
    const books = Array.isArray(bookResp.value) ? bookResp.value : [];
    const totalUnits = books.reduce(
      (s: number, b: any) => s + Number(b.quantity || 0),
      0,
    );
    const lowStock = books.filter(
      (b: any) => Number(b.quantity || 0) > 0 && Number(b.quantity || 0) <= 10,
    ).length;
    const outOfStock = books.filter(
      (b: any) => Number(b.quantity || 0) === 0,
    ).length;

    ctx.summary = {
      totalBooks: books.length,
      totalUnits,
      lowStock,
      outOfStock,
      activeLoans: 0,
      overdueLoans: 0,
      totalFines: 0,
    };

    ctx.books = books
      .map((b: any) => ({
        title: b.title || '?',
        author: b.author || '',
        quantity: Number(b.quantity || 0),
      }))
      .sort((a: any, b: any) => a.quantity - b.quantity);
  }

  if (loanResp.status === 'fulfilled') {
    const loans = Array.isArray(loanResp.value?.data)
      ? loanResp.value.data
      : [];
    const activeLoans = loans.filter(
      (l: any) => l.status === 'BORROWED' || l.status === 'OVERDUE',
    ).length;
    const overdueLoans = loans.filter(
      (l: any) => l.status === 'OVERDUE',
    ).length;

    if (ctx.summary) {
      ctx.summary.activeLoans = activeLoans;
      ctx.summary.overdueLoans = overdueLoans;
    }

    ctx.recentLoans = loans.slice(0, 15).map((l: any) => ({
      loan_number: l.loan_number || l.id?.slice(0, 8),
      customer_name: l.customers?.full_name || l.customer_id?.slice(0, 8) || '?',
      status: l.status,
      due_date: l.due_date || '',
    }));
  }

  if (fineResp.status === 'fulfilled') {
    const fines = Array.isArray(fineResp.value?.data)
      ? fineResp.value.data
      : [];
    const totalFines = fines
      .filter((f: any) => f.status !== 'PAID' && f.status !== 'WAIVED')
      .reduce((s: number, f: any) => s + Number(f.amount || 0), 0);

    if (ctx.summary) {
      ctx.summary.totalFines = totalFines;
    }

    ctx.recentFines = fines.slice(0, 10).map((f: any) => ({
      customer_name: f.customers?.full_name || f.customer_id?.slice(0, 8) || '?',
      fine_type: f.fine_type || '?',
      amount: Number(f.amount || 0),
      status: f.status || '?',
    }));
  }

  if (movResp.status === 'fulfilled') {
    const movements = Array.isArray(movResp.value) ? movResp.value : [];
    ctx.recentMovements = movements.slice(0, 10).map((m: any) => ({
      movement_type: m.movement_type || '?',
      book_title: m.book_title || m.reference_type || '?',
      quantity: Number(m.quantity || 0),
      warehouse_name: m.warehouse_name || '?',
    }));
  }

  return ctx;
}

// ── Main AIChatbot component ──────────────────────────────────────────────────

export function AIChatbot() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<UIMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [contextReady, setContextReady] = useState(true);
  const [showSuggestions, setShowSuggestions] = useState(true);
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const systemContextRef = useRef<SystemContext | undefined>(undefined);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setCurrentUser(authService.getCurrentUser());
  }, []);

  const refreshContext = useCallback(async () => {
    try {
      setContextReady(false);
      systemContextRef.current = await gatherSystemContext(currentUser);
      setContextReady(true);
    } catch {
      systemContextRef.current = undefined;
      setContextReady(true);
    }
  }, [currentUser]);

  useEffect(() => {
    if (open && !systemContextRef.current) {
      setContextReady(true);
    }
  }, [open]);

  useEffect(() => {
    if (open) bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, open, loading]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const buildHistory = useCallback((): ChatMessage[] => {
    return messages.map((m) => ({ role: m.role, content: m.text }));
  }, [messages]);

  const sendMessage = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || loading) return;

    setShowSuggestions(false);
    const userMsg: UIMessage = { id: Date.now(), role: 'user', text: trimmed };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setLoading(true);

    try {
      const history = buildHistory();
      const resp = await aiService.chat(
        trimmed,
        history,
        systemContextRef.current,
      );
      const botMsg: UIMessage = {
        id: Date.now() + 1,
        role: 'assistant',
        text: resp.reply,
        pending_action: resp.pending_action ?? null,
        intent: resp.intent,
        context_sources: resp.context_sources,
        retrieval_warnings: resp.retrieval_warnings,
      };
      setMessages((prev) => [...prev, botMsg]);
    } catch {
      const errorMsg: UIMessage = {
        id: Date.now() + 1,
        role: 'assistant',
        text: 'Xin lỗi, tôi đang gặp sự cố kết nối. Vui lòng thử lại sau! 🙏',
      };
      setMessages((prev) => [...prev, errorMsg]);
      toast.error('Không thể kết nối tới AI service');
    } finally {
      setLoading(false);
    }
  };

  const ACTION_FOLLOWUP_SUGGESTIONS: Record<string, string[]> = {
    CREATE_STOCK_ALERT: [
      'Tạo phiếu yêu cầu nhập hàng cho các sách tồn kho thấp',
      'Tạo task cho staff kiểm tra các sách hết hàng',
    ],
    CREATE_REORDER_DRAFT: [
      'Xem danh sách phiếu yêu cầu nhập vừa tạo',
      'Tạo báo cáo tổng quan tồn kho',
    ],
    CREATE_STAFF_TASK_DRAFT: [
      'Xem task của tôi hôm nay',
      'Tạo thêm task cho nhân viên khác',
    ],
    CREATE_REPORT_DRAFT: [
      'Tạo cảnh báo tồn kho thấp',
      'Nên nhập thêm sách nào?',
    ],
  };

  const handleActionConfirmed = useCallback((_actionId: string, result: any, actionType: string) => {
    const followUpSuggestions = ACTION_FOLLOWUP_SUGGESTIONS[actionType] ?? [];

    if (result?.report_markdown) {
      setMessages((prev) => [
        ...prev,
        {
          id: Date.now(),
          role: 'assistant',
          text: '✅ Hành động đã xác nhận. Xem báo cáo bên dưới.',
          action_result: result,
          suggestions: followUpSuggestions,
        },
      ]);
      return;
    }

    const modeLabelGeneral: Record<string, string> = {
      real_api: '✅ Đã tạo thật trong hệ thống.',
      partial: '⚠️ Một phần tạo thành công, một phần thất bại hoặc bị bỏ qua.',
      draft_only: '📋 Chỉ tạo bản nháp — chưa có bản ghi thật trong hệ thống.',
      generated: '✅ Hành động đã hoàn thành.',
    };

    const modeText = result?.mode ? (modeLabelGeneral[result.mode] ?? '') : '';
    const baseMessage = result?.message || 'Hành động đã được thực thi.';

    // Reorder: show PR numbers grouped by warehouse with supplier info
    const createdReqs: any[] = result?.created_requests ?? [];
    let requestLine = '';
    if (createdReqs.length > 0) {
      // Group by warehouse
      const byWh: Record<string, { wh: string; prs: string[]; supplier: string }> = {};
      for (const r of createdReqs) {
        const key = r.warehouse_name || 'Chưa rõ kho';
        if (!byWh[key]) byWh[key] = { wh: key, prs: [], supplier: r.suggested_supplier_name || '' };
        if (r.request_number) byWh[key].prs.push(r.request_number);
      }
      const whLines = Object.values(byWh)
        .map((g) => `  ${g.wh}: ${g.prs.join(', ')}${g.supplier ? ` (NCC: ${g.supplier})` : ''}`)
        .join('\n');
      requestLine = `\nĐã tạo ${createdReqs.length} phiếu:\n${whLines}`;
    }
    // Show no-warehouse skipped items
    const noWhItems: string[] = result?.no_warehouse_items ?? [];
    const noWhLine = noWhItems.length > 0
      ? `\nBỏ qua (thiếu kho): ${noWhItems.slice(0, 3).join(', ')}${noWhItems.length > 3 ? '...' : ''}`
      : '';

    // Stock alert: show created alert count
    const createdAlerts: any[] = result?.created_alerts ?? [];
    const alertLine = createdAlerts.length > 0
      ? `\nĐã tạo ${createdAlerts.length} cảnh báo tồn kho.`
      : '';
    const duplicateAlerts: string[] = result?.duplicate_items ?? [];
    const dupLine = duplicateAlerts.length > 0
      ? `\n${duplicateAlerts.length} cảnh báo đã tồn tại (bỏ qua).`
      : '';

    // Staff task: show task info
    const taskResult = result?.task;
    const taskLine = taskResult
      ? `\nTask đã tạo${taskResult.id ? ` (ID: ${String(taskResult.id).slice(0, 8)})` : ''}.`
      : '';

    // Skipped items (reorder + stock alert)
    const skippedItems: string[] = result?.skipped_items ?? [];
    const skippedLine = skippedItems.length > 0
      ? `\nBỏ qua (thiếu variant_id): ${skippedItems.slice(0, 3).join(', ')}${skippedItems.length > 3 ? '...' : ''}`
      : '';

    const fullText = [modeText, baseMessage, requestLine, noWhLine, alertLine, dupLine, taskLine, skippedLine]
      .filter(Boolean)
      .join('\n')
      .trim();

    setMessages((prev) => [
      ...prev,
      {
        id: Date.now(),
        role: 'assistant',
        text: fullText || 'Hành động đã được thực thi.',
        action_result: result,
        suggestions: followUpSuggestions,
      },
    ]);
  }, [ACTION_FOLLOWUP_SUGGESTIONS]);

  const handleActionCancelled = useCallback((_actionId: string) => {
    setMessages((prev) => [
      ...prev,
      {
        id: Date.now(),
        role: 'assistant',
        text: 'Đã hủy hành động.',
      },
    ]);
  }, []);

  const handleReset = () => {
    setMessages([]);
    setInput('');
    setShowSuggestions(true);
    systemContextRef.current = undefined;
    setContextReady(true);
  };

  const welcomeVisible = messages.length === 0 && !loading;

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col items-end gap-3">
      {open && (
        <div className="w-[400px] h-[580px] bg-white rounded-2xl shadow-2xl border border-gray-200 flex flex-col overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-200">
          {/* Header */}
          <div className="bg-gradient-to-r from-indigo-600 via-blue-600 to-violet-600 px-4 py-3 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center">
                <Bot size={16} className="text-white" />
              </div>
              <div>
                <p className="text-white text-sm font-semibold leading-none">
                  SmartBook AI Agent
                </p>
                <div className="flex items-center gap-1.5 mt-0.5">
                  {contextReady ? (
                    <>
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                      <span className="text-emerald-200 text-[10px]">
                        AI sẽ truy xuất dữ liệu khi bạn đặt câu hỏi
                      </span>
                    </>
                  ) : (
                    <>
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                      <span className="text-amber-200 text-[10px]">
                        Đang nạp fallback context...
                      </span>
                    </>
                  )}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => void refreshContext()}
                className="w-7 h-7 flex items-center justify-center rounded-md text-white/60 hover:text-white hover:bg-white/10 transition-colors"
                title="Nạp fallback context"
              >
                <Database size={13} />
              </button>
              <button
                onClick={handleReset}
                className="w-7 h-7 flex items-center justify-center rounded-md text-white/60 hover:text-white hover:bg-white/10 transition-colors"
                title="Làm mới phiên chat"
              >
                <RotateCcw size={13} />
              </button>
              <button
                onClick={() => setOpen(false)}
                className="w-7 h-7 flex items-center justify-center rounded-md text-white/60 hover:text-white hover:bg-white/10 transition-colors"
              >
                <X size={16} />
              </button>
            </div>
          </div>

          {/* Messages area */}
          <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3 bg-slate-50">
            {/* Welcome state */}
            {welcomeVisible && (
              <div className="flex flex-col items-center justify-center h-full gap-4 px-2">
                <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-indigo-100 to-violet-100 flex items-center justify-center">
                  <Sparkles size={22} className="text-indigo-600" />
                </div>
                <div className="text-center">
                  <p className="text-[14px] font-semibold text-foreground">
                    <MessageText text={getWelcomeGreeting(currentUser)} />
                  </p>
                  <p className="text-[12px] text-muted-foreground mt-1 leading-relaxed max-w-[300px]">
                    Tôi có thể truy xuất dữ liệu thời gian thực và tạo các hành động cần xác nhận của bạn.
                  </p>
                </div>
                {showSuggestions && (() => {
                  const suggestions = getPageSuggestions(window.location.pathname, currentUser);
                  const isPageSpecific = suggestions !== getRoleSuggestions(currentUser);
                  return (
                    <div className="w-full space-y-1.5">
                      <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium px-1">
                        {isPageSpecific ? 'Gợi ý cho trang này' : 'Gợi ý nhanh'}
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {(suggestions || []).map((s) => (
                          <button
                            key={s}
                            onClick={() => void sendMessage(s)}
                            disabled={loading}
                            className="px-2.5 py-1.5 rounded-lg bg-white border border-indigo-100 text-[11px] text-indigo-700 font-medium hover:bg-indigo-50 hover:border-indigo-200 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {s}
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })()}
              </div>
            )}

            {/* Messages */}
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                {msg.role === 'assistant' && (
                  <div className="w-6 h-6 rounded-full bg-indigo-100 flex items-center justify-center mr-2 mt-0.5 shrink-0">
                    <Sparkles size={12} className="text-indigo-600" />
                  </div>
                )}
                <div className={`max-w-[88%] flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                  <div
                    className={`px-3 py-2 rounded-2xl ${
                      msg.role === 'user'
                        ? 'bg-indigo-600 text-white rounded-br-sm'
                        : 'bg-white text-gray-700 shadow-sm border border-gray-100 rounded-bl-sm'
                    }`}
                  >
                    <MessageText text={msg.text} />
                  </div>

                  {/* Action card — only on assistant messages */}
                  {msg.role === 'assistant' && msg.pending_action && (
                    <div className="w-full">
                      <ActionCard
                        action={msg.pending_action}
                        onConfirmed={handleActionConfirmed}
                        onCancelled={handleActionCancelled}
                      />
                    </div>
                  )}

                  {/* Report result */}
                  {msg.role === 'assistant' && msg.action_result?.report_markdown && (
                    <div className="w-full">
                      <ReportResult markdown={msg.action_result.report_markdown} />
                    </div>
                  )}

                  {/* Retrieval warnings */}
                  {msg.role === 'assistant' && msg.retrieval_warnings && msg.retrieval_warnings.length > 0 && (
                    <div className="mt-1 space-y-0.5 w-full">
                      {msg.retrieval_warnings.slice(0, 2).map((w, i) => (
                        <p key={i} className="text-[10px] text-amber-500">⚠ {w}</p>
                      ))}
                    </div>
                  )}

                  {/* Data sources */}
                  {msg.role === 'assistant' && msg.context_sources && msg.context_sources.length > 0 && (() => {
                    const okSources = msg.context_sources
                      .filter((s: any) => s.status === 'ok')
                      .map((s: any) => s.name as string);
                    return okSources.length > 0 ? (
                      <p className="text-[9px] text-gray-400 mt-0.5">
                        Nguồn: {okSources.join(', ')}
                      </p>
                    ) : null;
                  })()}

                  {/* Follow-up suggestion chips */}
                  {msg.role === 'assistant' && msg.suggestions && msg.suggestions.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-1.5">
                      {msg.suggestions.map((s) => (
                        <button
                          key={s}
                          onClick={() => void sendMessage(s)}
                          disabled={loading}
                          className="px-2.5 py-1 rounded-lg bg-white border border-indigo-100 text-[11px] text-indigo-700 font-medium hover:bg-indigo-50 hover:border-indigo-300 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}

            {/* Typing indicator */}
            {loading && (
              <div className="flex justify-start">
                <div className="w-6 h-6 rounded-full bg-indigo-100 flex items-center justify-center mr-2 shrink-0">
                  <Sparkles size={12} className="text-indigo-600" />
                </div>
                <div className="bg-white border border-gray-100 shadow-sm rounded-2xl rounded-bl-sm px-4 py-2.5 flex items-center gap-1.5">
                  <Zap size={12} className="text-indigo-400 animate-pulse" />
                  <span className="text-[11px] text-muted-foreground">
                    Đang phân tích...
                  </span>
                  {[0, 1, 2].map((i) => (
                    <span
                      key={i}
                      className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce"
                      style={{ animationDelay: `${i * 0.15}s` }}
                    />
                  ))}
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {/* Context status bar */}
          {contextReady && systemContextRef.current?.summary && (
            <div className="px-3 py-1.5 bg-indigo-50/60 border-t border-indigo-100/50 flex items-center gap-3 text-[10px] text-indigo-600 shrink-0">
              <span>📚 {systemContextRef.current.summary.totalBooks} sách</span>
              <span>📖 {systemContextRef.current.summary.activeLoans} đang mượn</span>
              {systemContextRef.current.summary.overdueLoans > 0 && (
                <span className="text-rose-600">
                  ⚠️ {systemContextRef.current.summary.overdueLoans} quá hạn
                </span>
              )}
            </div>
          )}

          {/* Footer Input */}
          <div className="px-3 py-3 border-t border-gray-100 bg-white flex items-center gap-2 shrink-0">
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void sendMessage(input);
                }
              }}
              placeholder="Hỏi về sách, tồn kho, hoặc tạo hành động..."
              disabled={loading}
              className="flex-1 text-sm bg-slate-50 border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50"
            />
            <button
              onClick={() => void sendMessage(input)}
              disabled={!input.trim() || loading}
              className="w-9 h-9 flex items-center justify-center bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 text-white rounded-lg transition-colors shrink-0"
            >
              <Send size={15} />
            </button>
          </div>
        </div>
      )}

      {/* Floating Toggle Button */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="relative w-14 h-14 rounded-full bg-gradient-to-br from-indigo-600 via-blue-600 to-violet-600 hover:from-indigo-700 hover:via-blue-700 hover:to-violet-700 shadow-lg shadow-indigo-500/25 flex items-center justify-center text-white transition-all active:scale-95"
        aria-label="Mở chatbot AI"
      >
        {open ? <X size={22} /> : <Bot size={24} />}
        {!open && (
          <span className="absolute inset-0 rounded-full bg-indigo-500 animate-ping opacity-20" />
        )}
      </button>
    </div>
  );
}
