/// <reference types="node" />
import fs from 'fs';
import path from 'path';

import { countTaskPhases, getTaskPhase, pickNextTask, resolveTaskRoute, type PutawayReadiness } from './taskRoutes';
import type { User } from '../types/auth';
import type { MyWarehouseTask } from '../types/myWarehouseTasks';

const ID = '4422684f-e2b0-4c5a-8752-2156ca9a8244';
const ME = 'b251a588-e31a-4e92-9ec3-e80d7c7aff29';

const STAFF: User = {
  id: ME,
  username: 'staff',
  email: 's@x.vn',
  roles: ['WAREHOUSE_STAFF'],
  permissions: ['inventory.task.read', 'inventory.task.progress', 'inventory.exception.report'],
};

function task(overrides: Partial<MyWarehouseTask>): MyWarehouseTask {
  return {
    id: ID,
    type: 'PICKING',
    title: 'T-1',
    status: 'PICKING',
    warehouse: 'WH-1',
    created_at: '2026-10-20T00:00:00Z',
    completed_at: null,
    action_path: '/picking',
    ...overrides,
  };
}

// Every href the resolver can produce must be a real screen under app/ — this is the
// guard against ever navigating to a route that does not exist on mobile again.
function appRoutePatterns(): RegExp[] {
  const appDir = path.join(__dirname, '..', '..', 'app');
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.tsx') && !entry.name.startsWith('_')) files.push(full);
    }
  };
  walk(appDir);
  return files.map((file) => {
    const route = path
      .relative(appDir, file)
      .replace(/\\/g, '/')
      .replace(/\.tsx$/, '')
      .split('/')
      .filter((segment) => !/^\(.*\)$/.test(segment))
      .filter((segment, index, all) => !(segment === 'index' && index === all.length - 1))
      .map((segment) => (/^\[.*\]$/.test(segment) ? '[^/]+' : segment))
      .join('/');
    return new RegExp(`^/${route}$`);
  });
}

function expectRealScreen(href: string) {
  const patterns = appRoutePatterns();
  expect(patterns.some((pattern) => pattern.test(href))).toBe(true);
}

describe('resolveTaskRoute', () => {
  it('never uses the web action_path', () => {
    const route = resolveTaskRoute(task({ type: 'RECEIVING', status: 'DRAFT', action_path: `/orders/${ID}`, source_type: 'GOODS_RECEIPT' }), STAFF, 'todo');
    expect(route.kind).toBe('unsupported');
  });

  it('opens the picking task itself when the source table is known', () => {
    const outbound = resolveTaskRoute(task({ source_type: 'OUTBOUND_ORDER' }), STAFF, 'in_progress');
    const transfer = resolveTaskRoute(task({ source_type: 'TRANSFER_ORDER', status: 'APPROVED' }), STAFF, 'todo');
    expect(outbound).toEqual({ kind: 'screen', href: `/picking/outbound/${ID}`, cta: 'Tiếp tục lấy hàng' });
    expect(transfer.kind === 'screen' && transfer.href).toBe(`/picking/transfer/${ID}`);
  });

  it('falls back to the picking list when the backend has no source_type', () => {
    const route = resolveTaskRoute(task({}), STAFF, 'in_progress');
    expect(route.kind === 'screen' && route.href).toBe('/picking');
  });

  it('does not open a picking order that is not pickable yet', () => {
    expect(resolveTaskRoute(task({ status: 'PENDING', source_type: 'OUTBOUND_ORDER' }), STAFF, 'todo').kind).toBe('unsupported');
  });

  it('opens the receipt for putaway, but not once it is fully shelved', () => {
    const open = resolveTaskRoute(task({ type: 'PUTAWAY', status: 'POSTED', source_type: 'GOODS_RECEIPT' }), STAFF, 'todo');
    expect(open.kind === 'screen' && open.href).toBe(`/putaway/receipt/${ID}`);
    expect(resolveTaskRoute(task({ type: 'PUTAWAY', status: 'POSTED' }), STAFF, 'done').kind).toBe('unsupported');
  });

  it('marks web-only work as unsupported with a reason', () => {
    for (const type of ['PURCHASE_REQUEST', 'STAFF_TASK', 'RECEIVING', 'SOMETHING_NEW']) {
      const route = resolveTaskRoute(task({ type, status: 'OPEN' }), STAFF, 'todo');
      expect(route.kind).toBe('unsupported');
      expect(route.kind === 'unsupported' && route.reason.length).toBeGreaterThan(0);
    }
  });

  it('respects permissions', () => {
    const readOnly: User = { ...STAFF, permissions: ['inventory.task.read'] };
    expect(resolveTaskRoute(task({ source_type: 'OUTBOUND_ORDER' }), readOnly, 'in_progress').kind).toBe('unsupported');
    const superuser: User = { ...STAFF, roles: [], permissions: [], is_superuser: true };
    expect(resolveTaskRoute(task({ source_type: 'OUTBOUND_ORDER' }), superuser, 'in_progress').kind).toBe('screen');
  });

  it('rejects ids that are not UUIDs', () => {
    expect(resolveTaskRoute(task({ id: '../../login', source_type: 'OUTBOUND_ORDER' }), STAFF, 'in_progress').kind).toBe('unsupported');
  });

  it('only ever produces hrefs that exist under app/', () => {
    const cases: [Partial<MyWarehouseTask>, Parameters<typeof resolveTaskRoute>[2]][] = [
      [{ source_type: 'OUTBOUND_ORDER' }, 'in_progress'],
      [{ source_type: 'TRANSFER_ORDER' }, 'in_progress'],
      [{}, 'in_progress'],
      [{ type: 'OUTBOUND', status: 'READY_FOR_OUTBOUND' }, 'todo'],
      [{ type: 'PUTAWAY', status: 'POSTED' }, 'todo'],
      [{ type: 'TRANSFER_RECEIVING', status: 'IN_TRANSIT' }, 'todo'],
      [{ type: 'EXCEPTION_REPORT', status: 'OPEN' }, 'todo'],
      [{ type: 'STOCK_AUDIT', status: 'IN_PROGRESS' }, 'in_progress'],
    ];
    const superuser: User = { ...STAFF, is_superuser: true };
    for (const [overrides, phase] of cases) {
      const route = resolveTaskRoute(task(overrides), superuser, phase);
      expect(route.kind).toBe('screen');
      if (route.kind === 'screen') expectRealScreen(route.href);
    }
  });
});

describe('getTaskPhase', () => {
  it('classifies statuses per task type', () => {
    expect(getTaskPhase(task({ status: 'APPROVED' }))).toBe('todo');
    expect(getTaskPhase(task({ status: 'PICKING' }))).toBe('in_progress');
    expect(getTaskPhase(task({ type: 'EXCEPTION_REPORT', status: 'RESOLVED' }))).toBe('done');
    expect(getTaskPhase(task({ type: 'EXCEPTION_REPORT', status: 'OPEN' }))).toBe('waiting');
    expect(getTaskPhase(task({ type: 'STAFF_TASK', status: 'DONE' }))).toBe('done');
    expect(getTaskPhase(task({ type: 'PURCHASE_REQUEST', status: 'PENDING' }))).toBe('waiting');
    expect(getTaskPhase(task({ type: 'STOCK_AUDIT', status: 'SUBMITTED' }))).toBe('waiting');
    expect(getTaskPhase(task({ type: 'PURCHASE_REQUEST', status: 'CONVERTED' }))).toBe('done');
    expect(getTaskPhase(task({ type: 'STOCK_AUDIT', status: 'DRAFT' }))).toBe('todo');
    expect(getTaskPhase(task({ type: 'STOCK_AUDIT', status: 'COMPLETED' }))).toBe('done');
  });

  it('uses putaway readiness, because a POSTED receipt stays POSTED after shelving', () => {
    const readiness: PutawayReadiness = new Map([[ID, { remaining: 3, assigneeId: ME, putawayQty: 2 }]]);
    const putaway = task({ type: 'PUTAWAY', status: 'POSTED' });
    expect(getTaskPhase(putaway, readiness, ME)).toBe('in_progress');
    expect(getTaskPhase(putaway, new Map(), ME)).toBe('done');
    expect(getTaskPhase(putaway, new Map([[ID, { remaining: 5, assigneeId: null, putawayQty: 0 }]]), ME)).toBe('todo');
  });
});

describe('countTaskPhases / pickNextTask', () => {
  it('never counts finished work as pending', () => {
    expect(countTaskPhases(['todo', 'done', 'done', 'in_progress', 'waiting'])).toEqual({ todo: 1, in_progress: 1, waiting: 1, done: 2 });
  });

  it('prefers work already in progress, then priority, then due date', () => {
    const screen = { kind: 'screen' as const, href: '/picking', cta: 'x' };
    const items = [
      { task: task({ id: 'a', priority: 'URGENT' }), phase: 'todo' as const, route: screen },
      { task: task({ id: 'b' }), phase: 'in_progress' as const, route: screen },
      { task: task({ id: 'c' }), phase: 'done' as const, route: screen },
      { task: task({ id: 'd', priority: 'URGENT' }), phase: 'waiting' as const, route: screen },
    ];
    expect(pickNextTask(items)?.task.id).toBe('b');
    expect(pickNextTask(items.filter((i) => i.task.id !== 'b'))?.task.id).toBe('a');
    expect(pickNextTask([{ task: task({}), phase: 'todo' as const, route: { kind: 'unsupported' as const, reason: 'x' } }])).toBeNull();
  });
});
