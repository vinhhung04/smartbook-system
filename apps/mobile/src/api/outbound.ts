import { apiFetch } from './client';
import type {
  AvailableOutboundTask,
  ConfirmOutboundResult,
  OutboundOrderStatusDetail,
  OutboundTaskListItem,
} from '../types/outbound';

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

// Only used to check aggregate_remaining_qty for a REPICKING-status order before
// attempting to confirm it — see resolveScannedCode + outboundRules.canConfirmOutbound.
export function getOrderStatusDetail(taskType: 'outbound' | 'transfer', taskId: string) {
  return apiFetch<OutboundOrderStatusDetail>(`/api/outbound/orders/${taskType}/${taskId}`);
}
