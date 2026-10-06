// Client-side bookkeeping for the customer notification center (list page and
// header bell). Import-free on purpose: tests/notification-state.test.mjs
// transpiles it on Node 20. The server stays the source of truth — these rules
// only keep the visible list, totals and unread badge consistent between
// round trips, and never let a count go negative or a page go out of range.

export type NotificationFilter = 'ALL' | 'UNREAD' | 'READ';

export interface NotificationRowLike {
  id: string;
  read_at?: string | null;
}

export interface NotificationListState<T extends NotificationRowLike> {
  rows: T[];
  /** Total matching the current filter (across all pages). */
  total: number;
  unreadCount: number;
  page: number;
  totalPages: number;
  pageSize: number;
}

export function pageCount(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(Math.max(0, total) / Math.max(1, pageSize)));
}

function withTotal<T extends NotificationRowLike>(state: NotificationListState<T>, total: number): NotificationListState<T> {
  const safeTotal = Math.max(0, total);
  const totalPages = pageCount(safeTotal, state.pageSize);
  return { ...state, total: safeTotal, totalPages, page: Math.min(state.page, totalPages) };
}

/**
 * One notification was marked read on the server.
 * UNREAD view: the row leaves the list and the filter total drops by one.
 * ALL view: the row stays, now read; the total is unchanged.
 * READ view: nothing visible changes (unread rows are not listed there).
 * Marking an already-read or unknown row changes nothing.
 */
export function applyMarkedRead<T extends NotificationRowLike>(
  state: NotificationListState<T>,
  id: string,
  filter: NotificationFilter,
  readAt: string,
): NotificationListState<T> {
  const row = state.rows.find((item) => item.id === id);
  if (!row || row.read_at) return state;
  const unreadCount = Math.max(0, state.unreadCount - 1);
  if (filter === 'UNREAD') {
    return withTotal({ ...state, unreadCount, rows: state.rows.filter((item) => item.id !== id) }, state.total - 1);
  }
  return { ...state, unreadCount, rows: state.rows.map((item) => (item.id === id ? { ...item, read_at: readAt } : item)) };
}

/** "Đọc tất cả" succeeded on the server. */
export function applyAllRead<T extends NotificationRowLike>(
  state: NotificationListState<T>,
  filter: NotificationFilter,
  readAt: string,
): NotificationListState<T> {
  if (filter === 'UNREAD') return { ...state, rows: [], unreadCount: 0, total: 0, totalPages: 1, page: 1 };
  if (filter === 'READ') return { ...state, unreadCount: 0 };
  return { ...state, unreadCount: 0, rows: state.rows.map((item) => (item.read_at ? item : { ...item, read_at: readAt })) };
}

/** Remembers the last `limit` notification ids received over the socket
 *  (bounded memory). Checked synchronously when the event arrives, so a
 *  duplicate emit is dropped before it touches any state. */
export function createRecentIds(limit = 200) {
  const order: string[] = [];
  const ids = new Set<string>();
  return {
    /** True the first time an id is seen, false for a repeat. */
    addIfNew(id: string): boolean {
      if (ids.has(id)) return false;
      ids.add(id);
      order.push(id);
      if (order.length > limit) ids.delete(order.shift() as string);
      return true;
    },
    get size() { return ids.size; },
  };
}

/**
 * A new `notification:new` event (already de-duplicated by createRecentIds).
 * Still idempotent against what is on screen: a notification already listed
 * (e.g. loaded by a fetch that raced the event) does not count again. A new
 * notification is unread and the newest, so it joins page 1 of ALL/UNREAD.
 */
export function applyIncoming<T extends NotificationRowLike>(
  state: NotificationListState<T>,
  item: T,
  filter: NotificationFilter,
): NotificationListState<T> {
  if (!item?.id || state.rows.some((row) => row.id === item.id)) return state;
  const next = { ...state, unreadCount: state.unreadCount + 1 };
  if (filter === 'READ') return next;
  const rows = next.page === 1 ? [{ ...item, read_at: null }, ...next.rows].slice(0, next.pageSize) : next.rows;
  return withTotal({ ...next, rows }, next.total + 1);
}
