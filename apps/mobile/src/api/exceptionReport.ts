import { apiFetch } from './client';
import type {
  ExceptionReport,
  ExceptionReportCreateInput,
  MyWarehouseTaskOption,
  WarehouseOption,
} from '../types/exceptionReport';

export function getMyReports() {
  return apiFetch<{ data: ExceptionReport[] }>('/api/exception-reports/my');
}

export function createReport(input: ExceptionReportCreateInput) {
  return apiFetch<{ data: ExceptionReport }>('/api/exception-reports', {
    method: 'POST',
    body: input,
  });
}

export function getWarehouses() {
  return apiFetch<{ data: WarehouseOption[] }>('/api/receiving-context/warehouses');
}

const OPERATIONAL_TASK_TYPES = new Set(['RECEIVING', 'PUTAWAY', 'PICKING', 'OUTBOUND']);

export async function getMyOperationalTasks() {
  const result = await apiFetch<{ data: MyWarehouseTaskOption[] }>('/api/my-warehouse-tasks');
  return result.data.filter((task) => OPERATIONAL_TASK_TYPES.has(task.type));
}
