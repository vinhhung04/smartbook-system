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

// Built from type + id rather than calling the `claim_endpoint` string the task list
// carries: the app only ever claims the outbound step it is about to confirm.
export function claimSelf(taskType: 'outbound' | 'transfer', taskId: string) {
  return apiFetch(`/api/outbound/orders/${taskType}/${encodeURIComponent(taskId)}/claim-self`, { method: 'PATCH' });
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
