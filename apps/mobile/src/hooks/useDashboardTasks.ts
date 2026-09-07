import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';

import * as myWarehouseTasksApi from '../api/myWarehouseTasks';
import * as stockAuditApi from '../api/stockAudit';
import { ApiError } from '../auth/auth-context';
import type { MyWarehouseTask, MyWarehouseTaskSummary } from '../types/myWarehouseTasks';

export type DashboardCounts = {
  picking: number;
  putaway: number;
  outbound: number;
  exceptions: number;
  audit: number;
};

export type DashboardData = {
  tasks: MyWarehouseTask[];
  summary: MyWarehouseTaskSummary;
  counts: DashboardCounts;
  total: number;
};

const EMPTY: DashboardData = {
  tasks: [],
  summary: {},
  counts: { picking: 0, putaway: 0, outbound: 0, exceptions: 0, audit: 0 },
  total: 0,
};

/**
 * Shared by the Home dashboard and the "Việc của tôi" tab. Every tile that
 * has a matching key in /api/my-warehouse-tasks's `summary` reads from that
 * one object; only `audit` (no summary key exists for stock audits) falls
 * back to a separate call. `total` is the sum of the 5 displayed tile
 * counts specifically (not every raw summary key, some of which — staff
 * tasks, purchase requests — aren't shown as tiles at all) so the hero
 * number always matches what the tiles below it add up to.
 */
export function useDashboardTasks() {
  const [data, setData] = useState<DashboardData>(EMPTY);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [tasksResult, audits] = await Promise.all([
        myWarehouseTasksApi.getMyWarehouseTasks(),
        stockAuditApi.getMyAudits(),
      ]);
      const summary = tasksResult.summary ?? {};
      const counts: DashboardCounts = {
        picking: summary.picking ?? 0,
        putaway: summary.putaway ?? 0,
        outbound: summary.outbound ?? 0,
        exceptions: summary.exception_report ?? 0,
        audit: audits.data.length,
      };
      setData({
        tasks: tasksResult.data,
        summary,
        counts,
        total: counts.picking + counts.putaway + counts.outbound + counts.exceptions + counts.audit,
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Không tải được dữ liệu ca làm việc');
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      setIsLoading(true);
      load().finally(() => setIsLoading(false));
    }, [load]),
  );

  return { data, isLoading, error, refetch: load };
}
