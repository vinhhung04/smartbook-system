import { apiFetch } from './client';
import type { AvailableOutboundTask, ConfirmOutboundResult, OutboundTaskListItem } from '../types/outbound';

export function getMyTasks() {
  return apiFetch<{ data: OutboundTaskListItem[] }>('/api/outbound/orders');
}

export function getAvailableTasks() {
  return apiFetch<{ data: AvailableOutboundTask[] }>('/api/my-warehouse-tasks/available');
}

export function claimSelf(claimEndpoint: string) {
  return apiFetch(claimEndpoint, { method: 'PATCH' });
}

export function confirmOutbound(taskType: 'outbound' | 'transfer', taskId: string, scanCode: string) {
  return apiFetch<ConfirmOutboundResult>(`/api/outbound/orders/${taskType}/${taskId}/confirm`, {
    method: 'POST',
    body: { scan_code: scanCode },
  });
}
