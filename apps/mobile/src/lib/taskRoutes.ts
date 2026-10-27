import { canUseStaffFeature, type StaffFeature } from '../auth/access';
import type { User } from '../types/auth';
import type { MyWarehouseTask } from '../types/myWarehouseTasks';

/**
 * /api/my-warehouse-tasks is shared with the web app, and its `action_path` is a web
 * route (/orders/:id, /staff-tasks, /transfer-receiving, ...) that has no screen on
 * mobile. Navigation is therefore decided here from the task's type, id, status and
 * the user's permissions — never by pushing a string the server sent.
 */
/** waiting = handed to a manager (approval, review) — nothing for the staff member to do now. */
export type TaskPhase = 'todo' | 'in_progress' | 'waiting' | 'done';

export type TaskRoute =
  | { kind: 'screen'; href: string; cta: string }
  | { kind: 'unsupported'; reason: string };

/** What the dashboard knows about POSTED receipts beyond the task list (from /api/putaway/receipts). */
export type PutawayReadiness = Map<string, { remaining: number; assigneeId: string | null; putawayQty: number }>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const PICKABLE = new Set(['APPROVED', 'PICKING', 'REPICKING']);
const OUTBOUND_READY = new Set(['READY_FOR_OUTBOUND', 'READY_TO_SHIP', 'REPICKING']);
const TERMINAL = new Set(['COMPLETED', 'CANCELLED', 'DONE', 'RESOLVED', 'DISMISSED', 'REJECTED', 'APPROVED', 'CONVERTED', 'RECEIVED']);

export const TASK_TYPE_LABEL: Record<string, string> = {
  RECEIVING: 'Tiếp nhận hàng',
  PUTAWAY: 'Cất hàng',
  PICKING: 'Lấy hàng',
  OUTBOUND: 'Xuất kho',
  TRANSFER_RECEIVING: 'Nhận điều chuyển',
  PURCHASE_REQUEST: 'Yêu cầu mua hàng',
  EXCEPTION_REPORT: 'Báo cáo sự cố',
  STAFF_TASK: 'Việc được giao',
  STOCK_AUDIT: 'Kiểm kê',
};

// Same wording as the web's warehouse task statuses (apps/web/src/lib/status-registry.ts).
const STATUS_LABEL: Record<string, string> = {
  DRAFT: 'Chưa bắt đầu',
  SUBMITTED: 'Chờ duyệt',
  PENDING: 'Chờ duyệt',
  OPEN: 'Mới',
  ACKNOWLEDGED: 'Đã tiếp nhận',
  APPROVED: 'Đã duyệt',
  CONVERTED: 'Đã chuyển PO',
  PICKING: 'Đang lấy',
  REPICKING: 'Đang lấy bù',
  READY_FOR_OUTBOUND: 'Sẵn xuất kho',
  READY_TO_SHIP: 'Sẵn xuất kho',
  IN_PROGRESS: 'Đang thực hiện',
  IN_TRANSIT: 'Đang vận chuyển',
  POSTED: 'Chờ cất hàng',
  RECEIVED: 'Đã nhận',
  COMPLETED: 'Hoàn tất',
  DONE: 'Hoàn thành',
  RESOLVED: 'Đã xử lý',
  DISMISSED: 'Đã bỏ qua',
  REJECTED: 'Từ chối',
  CANCELLED: 'Đã hủy',
};

export const PRIORITY_LABEL: Record<string, string> = {
  URGENT: 'Khẩn cấp',
  HIGH: 'Cao',
  MEDIUM: 'Trung bình',
  LOW: 'Thấp',
};

export function getTaskStatusLabel(task: MyWarehouseTask, phase?: TaskPhase): string {
  if (task.type === 'PUTAWAY' && phase === 'done') return 'Đã cất xong';
  if (task.type === 'PICKING' && task.status === 'APPROVED') return 'Chờ lấy hàng';
  return STATUS_LABEL[task.status] ?? task.status;
}

export function getTaskPhase(task: MyWarehouseTask, putaway?: PutawayReadiness, currentUserId?: string): TaskPhase {
  const status = String(task.status || '').toUpperCase();
  switch (task.type) {
    case 'PICKING':
      if (status === 'APPROVED') return 'todo';
      return PICKABLE.has(status) ? 'in_progress' : TERMINAL.has(status) ? 'done' : 'todo';
    case 'OUTBOUND':
      return TERMINAL.has(status) || status === 'IN_TRANSIT' ? 'done' : 'todo';
    case 'PUTAWAY': {
      // A POSTED receipt stays POSTED forever — only its movements say whether anything is
      // left to shelve. /api/putaway/receipts lists exactly the ones with remaining > 0.
      if (!putaway) return 'todo';
      const ready = putaway.get(task.id);
      if (!ready || ready.remaining <= 0) return 'done';
      return ready.putawayQty > 0 && ready.assigneeId === currentUserId ? 'in_progress' : 'todo';
    }
    case 'RECEIVING':
    case 'TRANSFER_RECEIVING':
      return status === 'RECEIVED' || status === 'CANCELLED' || status === 'POSTED' ? 'done' : 'todo';
    case 'PURCHASE_REQUEST':
      // Waiting on a manager, not on the staff member.
      return status === 'PENDING' || status === 'SUBMITTED' ? 'waiting' : 'done';
    case 'EXCEPTION_REPORT':
      // Filed by (or assigned to) the staff member; a manager resolves it.
      return status === 'OPEN' || status === 'ACKNOWLEDGED' ? 'waiting' : 'done';
    case 'STAFF_TASK':
      if (status === 'OPEN') return 'todo';
      return status === 'IN_PROGRESS' ? 'in_progress' : 'done';
    case 'STOCK_AUDIT':
      if (status === 'DRAFT') return 'todo';
      if (status === 'IN_PROGRESS') return 'in_progress';
      return status === 'SUBMITTED' ? 'waiting' : 'done';
    default:
      return TERMINAL.has(status) ? 'done' : 'todo';
  }
}

function needs(user: User | null, feature: StaffFeature, href: string, cta: string): TaskRoute {
  if (!canUseStaffFeature(user, feature)) {
    return { kind: 'unsupported', reason: 'Tài khoản của bạn chưa được cấp quyền cho nghiệp vụ này trên ứng dụng.' };
  }
  return { kind: 'screen', href, cta };
}

const WEB_ONLY = 'Nghiệp vụ này hiện chỉ thực hiện trên website SmartBook.';

export function resolveTaskRoute(task: MyWarehouseTask, user: User | null, phase: TaskPhase): TaskRoute {
  if (!UUID.test(task.id)) return { kind: 'unsupported', reason: 'Mã công việc không hợp lệ.' };
  const status = String(task.status || '').toUpperCase();

  switch (task.type) {
    case 'PICKING': {
      if (!PICKABLE.has(status)) return { kind: 'unsupported', reason: 'Đơn này chưa ở bước lấy hàng.' };
      if (task.source_type === 'OUTBOUND_ORDER') return needs(user, 'picking', `/picking/outbound/${task.id}`, 'Tiếp tục lấy hàng');
      if (task.source_type === 'TRANSFER_ORDER') return needs(user, 'picking', `/picking/transfer/${task.id}`, 'Tiếp tục lấy hàng');
      // Older backend without source_type: the id alone cannot tell outbound from transfer.
      return needs(user, 'picking', '/picking', 'Mở danh sách lấy hàng');
    }
    case 'OUTBOUND':
      if (phase === 'done' || !OUTBOUND_READY.has(status)) return { kind: 'unsupported', reason: 'Đơn này không còn chờ xuất kho.' };
      return needs(user, 'outbound', '/outbound', 'Quét xác nhận xuất kho');
    case 'PUTAWAY':
      if (phase === 'done') return { kind: 'unsupported', reason: 'Phiếu này đã cất hết lên kệ.' };
      return needs(user, 'putaway', `/putaway/receipt/${task.id}`, 'Cất hàng lên kệ');
    case 'TRANSFER_RECEIVING':
      if (status !== 'IN_TRANSIT') return { kind: 'unsupported', reason: 'Phiếu điều chuyển này đã được xử lý.' };
      return needs(user, 'transferReceiving', `/transfer-receiving/${task.id}`, 'Nhận hàng điều chuyển');
    case 'EXCEPTION_REPORT':
      return needs(user, 'exceptions', '/exceptions', 'Xem báo cáo sự cố');
    case 'STOCK_AUDIT':
      if (status !== 'DRAFT' && status !== 'IN_PROGRESS') {
        return { kind: 'unsupported', reason: status === 'SUBMITTED' ? 'Phiếu đã nộp, đang chờ quản lý duyệt.' : 'Phiếu kiểm kê đã kết thúc.' };
      }
      return needs(user, 'audit', `/audit/${task.id}`, status === 'DRAFT' ? 'Bắt đầu kiểm kê' : 'Tiếp tục kiểm kê');
    case 'RECEIVING':
    case 'PURCHASE_REQUEST':
    case 'STAFF_TASK':
      return { kind: 'unsupported', reason: WEB_ONLY };
    default:
      return { kind: 'unsupported', reason: WEB_ONLY };
  }
}

export type TaskCounts = Record<TaskPhase, number>;

export function countTaskPhases(phases: TaskPhase[]): TaskCounts {
  return phases.reduce<TaskCounts>((acc, phase) => ({ ...acc, [phase]: acc[phase] + 1 }), { todo: 0, in_progress: 0, waiting: 0, done: 0 });
}

const PRIORITY_RANK: Record<string, number> = { URGENT: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };

/**
 * The single task the dashboard puts first: something already started beats something
 * new (finish what is on the cart), then priority, then the oldest due date / creation.
 * Only tasks the app can actually open are candidates.
 */
export function pickNextTask<T extends { task: MyWarehouseTask; phase: TaskPhase; route: TaskRoute }>(items: T[]): T | null {
  const candidates = items.filter((item) => (item.phase === 'todo' || item.phase === 'in_progress') && item.route.kind === 'screen');
  if (candidates.length === 0) return null;
  const time = (iso: string | null | undefined) => (iso ? new Date(iso).getTime() : Number.MAX_SAFE_INTEGER);
  return [...candidates].sort((a, b) => {
    if (a.phase !== b.phase) return a.phase === 'in_progress' ? -1 : 1;
    const pa = PRIORITY_RANK[String(a.task.priority || 'MEDIUM').toUpperCase()] ?? 2;
    const pb = PRIORITY_RANK[String(b.task.priority || 'MEDIUM').toUpperCase()] ?? 2;
    if (pa !== pb) return pa - pb;
    const da = time(a.task.due_date);
    const db = time(b.task.due_date);
    if (da !== db) return da - db;
    return time(a.task.created_at) - time(b.task.created_at);
  })[0];
}
