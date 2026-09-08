import { apiFetch } from './client';
import type { MyWarehouseTasksResponse } from '../types/myWarehouseTasks';

/**
 * Full { data, summary } shape from /api/my-warehouse-tasks — used by the
 * dashboard for real counts. Separate from exceptionReport.ts's
 * getMyOperationalTasks(), which calls the same endpoint but only needs
 * the filtered task array for its own task picker, not the summary.
 */
export function getMyWarehouseTasks() {
  return apiFetch<MyWarehouseTasksResponse>('/api/my-warehouse-tasks');
}
