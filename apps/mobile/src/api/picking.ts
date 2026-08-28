import { apiFetch } from './client';
import type {
  AvailableTask,
  ConfirmLineResult,
  LookupBarcodeResult,
  PickingTaskDetail,
  PickingTaskListItem,
  PickingTaskType,
  PresenceResult,
} from '../types/picking';

export function getMyTasks() {
  return apiFetch<{ data: PickingTaskListItem[] }>('/api/picking/tasks');
}

export function getAvailableTasks() {
  return apiFetch<{ data: AvailableTask[] }>('/api/my-warehouse-tasks/available');
}

export function claimSelf(taskType: PickingTaskType, taskId: string) {
  return apiFetch(`/api/picking/tasks/${taskType}/${taskId}/claim-self`, { method: 'POST' });
}

export function getTaskDetail(taskType: PickingTaskType, taskId: string) {
  return apiFetch<PickingTaskDetail>(`/api/picking/tasks/${taskType}/${taskId}`);
}

export function confirmPresence(taskType: PickingTaskType, taskId: string, currentLocationInput: string) {
  return apiFetch<PresenceResult>(`/api/picking/tasks/${taskType}/${taskId}/presence`, {
    method: 'POST',
    body: { current_location_input: currentLocationInput },
  });
}

export function lookupVariantByBarcode(barcode: string) {
  return apiFetch<LookupBarcodeResult>(`/api/picking/lookup/variant-by-barcode?barcode=${encodeURIComponent(barcode)}`);
}

export function confirmLine(
  taskType: PickingTaskType,
  taskId: string,
  lineId: string,
  body: {
    quantity: number;
    scanned_location_input: string;
    scanned_product_barcode?: string;
    scanned_variant_id?: string;
  },
) {
  return apiFetch<ConfirmLineResult>(`/api/picking/tasks/${taskType}/${taskId}/lines/${lineId}/confirm`, {
    method: 'POST',
    body,
  });
}
