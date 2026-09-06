import { apiFetch } from './client';
import type {
  AvailableTask,
  ConfirmLineResult,
  DeclareShortageResult,
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

// Manager-only: /claim (unlike /claim-self) accepts an arbitrary picker_user_id and
// is allowed to override a task that's already assigned to someone else — this is
// the same endpoint the web "Giao task" button uses for manager reassignment.
export function assignTask(taskType: PickingTaskType, taskId: string, pickerUserId: string) {
  return apiFetch<{
    task_type: PickingTaskType;
    task_id: string;
    assigned_picker_user_id: string | null;
    status: string;
  }>(`/api/picking/tasks/${taskType}/${taskId}/claim`, {
    method: 'POST',
    body: { picker_user_id: pickerUserId },
  });
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

export function declareShortage(taskType: PickingTaskType, taskId: string) {
  return apiFetch<DeclareShortageResult>(`/api/picking/tasks/${taskType}/${taskId}/declare-shortage`, {
    method: 'POST',
  });
}
