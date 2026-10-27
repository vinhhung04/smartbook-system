import { useCallback, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';

import * as myWarehouseTasksApi from '../api/myWarehouseTasks';
import * as putawayApi from '../api/putaway';
import * as stockAuditApi from '../api/stockAudit';
import { ApiError } from '../api/client';
import { canUseStaffFeature } from '../auth/access';
import { useAuth } from '../auth/auth-context';
import {
  countTaskPhases,
  getTaskPhase,
  getTaskStatusLabel,
  pickNextTask,
  resolveTaskRoute,
  type PutawayReadiness,
  type TaskCounts,
  type TaskPhase,
  type TaskRoute,
} from '../lib/taskRoutes';
import type { MyWarehouseTask } from '../types/myWarehouseTasks';
import type { StockAuditSummary } from '../types/stockAudit';

export type TaskEntry = {
  key: string;
  task: MyWarehouseTask;
  phase: TaskPhase;
  route: TaskRoute;
  statusLabel: string;
};

export type FeatureCounts = {
  picking: number;
  putaway: number;
  outbound: number;
  exceptions: number;
  audit: number;
  transferReceiving: number;
};

export type DashboardData = {
  entries: TaskEntry[];
  counts: TaskCounts;
  features: FeatureCounts;
  next: TaskEntry | null;
  /** Sources that failed while the rest loaded — numbers that depend on them are partial. */
  warnings: string[];
};

const EMPTY: DashboardData = {
  entries: [],
  counts: { todo: 0, in_progress: 0, waiting: 0, done: 0 },
  features: { picking: 0, putaway: 0, outbound: 0, exceptions: 0, audit: 0, transferReceiving: 0 },
  next: null,
  warnings: [],
};

function auditAsTask(audit: StockAuditSummary): MyWarehouseTask {
  return {
    id: audit.id,
    type: 'STOCK_AUDIT',
    title: audit.audit_number,
    status: audit.status,
    warehouse: audit.warehouse_code,
    created_at: null,
    completed_at: null,
    action_path: null,
    description: `${audit.line_count} dòng cần đếm`,
  };
}

/**
 * Shared by the Home dashboard and the "Việc của tôi" tab. Every number is derived from
 * each task's own phase (todo / in progress / done) — a resolved exception or a receipt
 * that is fully shelved no longer counts as waiting work. Stock audits (not part of
 * /api/my-warehouse-tasks) are merged in as tasks of their own.
 */
export function useDashboardTasks() {
  const { user } = useAuth();
  const [data, setData] = useState<DashboardData>(EMPTY);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestRef = useRef(0);
  // Re-load only when what decides routes/permissions changes — not when the user object
  // is merely replaced (e.g. by the /auth/me refresh after launch), which fetched twice.
  const accessKey = user ? [user.id, user.is_superuser, user.roles.join(','), user.permissions.join(',')].join('|') : '';
  const userRef = useRef(user);
  userRef.current = user;

  const load = useCallback(async () => {
    const user = userRef.current;
    const requestId = ++requestRef.current;
    setError(null);
    const canAudit = canUseStaffFeature(user, 'audit');
    const canPutaway = canUseStaffFeature(user, 'putaway');
    const [tasksResult, auditsResult, receiptsResult] = await Promise.allSettled([
      myWarehouseTasksApi.getMyWarehouseTasks(),
      canAudit ? stockAuditApi.getMyAudits() : Promise.resolve({ data: [] as StockAuditSummary[] }),
      canPutaway ? putawayApi.getReadyReceipts() : Promise.resolve(null),
    ]);
    // A slower, older request (e.g. focus + pull-to-refresh) must not overwrite a newer one.
    if (requestId !== requestRef.current) return;

    if (tasksResult.status === 'rejected') {
      const err = tasksResult.reason;
      setError(err instanceof ApiError ? err.message : 'Không tải được dữ liệu ca làm việc');
      return;
    }

    const warnings: string[] = [];
    let readiness: PutawayReadiness | undefined;
    if (receiptsResult.status === 'fulfilled' && receiptsResult.value) {
      readiness = new Map(
        receiptsResult.value.map((r) => [r.id, { remaining: r.remaining_quantity, assigneeId: r.putaway_assignee_user_id, putawayQty: r.putaway_quantity }]),
      );
    } else if (receiptsResult.status === 'rejected') {
      warnings.push('Chưa tải được tiến độ cất hàng — phiếu cất hàng có thể đã xong vẫn hiện là cần làm.');
    }
    const audits = auditsResult.status === 'fulfilled' ? auditsResult.value.data : [];
    if (auditsResult.status === 'rejected') warnings.push('Chưa tải được phiếu kiểm kê.');

    const tasks = [...tasksResult.value.data, ...audits.map(auditAsTask)];
    const entries: TaskEntry[] = tasks.map((task, index) => {
      const phase = getTaskPhase(task, readiness, user?.id);
      return {
        key: `${task.type}-${task.id}-${index}`,
        task,
        phase,
        route: resolveTaskRoute(task, user, phase),
        statusLabel: getTaskStatusLabel(task, phase),
      };
    });

    const pendingOf = (type: string) => entries.filter((e) => e.task.type === type && (e.phase === 'todo' || e.phase === 'in_progress')).length;
    setData({
      entries,
      counts: countTaskPhases(entries.map((e) => e.phase)),
      features: {
        picking: pendingOf('PICKING'),
        putaway: pendingOf('PUTAWAY'),
        outbound: pendingOf('OUTBOUND'),
        exceptions: pendingOf('EXCEPTION_REPORT'),
        audit: pendingOf('STOCK_AUDIT'),
        transferReceiving: pendingOf('TRANSFER_RECEIVING'),
      },
      next: pickNextTask(entries),
      warnings,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- accessKey stands for the user fields read above
  }, [accessKey]);

  useFocusEffect(
    useCallback(() => {
      setIsLoading(true);
      load().finally(() => setIsLoading(false));
    }, [load]),
  );

  const refetch = useCallback(async () => {
    setIsRefreshing(true);
    try {
      await load();
    } finally {
      setIsRefreshing(false);
    }
  }, [load]);

  return { data, isLoading, isRefreshing, error, refetch };
}
