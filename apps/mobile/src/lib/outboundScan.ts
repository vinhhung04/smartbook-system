import { matchesCode } from '../scanner/matching';
import type { AvailableOutboundTask, OutboundTaskListItem } from '../types/outbound';
import { canConfirmOutbound } from './outboundRules';

export type OutboundMode = 'outbound' | 'transfer';

export type ResolvedTask =
  | { kind: 'claim-then-confirm'; taskId: string; taskType: OutboundMode; claimEndpoint: string; orderNumber: string }
  | { kind: 'confirm'; taskId: string; taskType: OutboundMode; orderNumber: string }
  | { kind: 'not-found' }
  | { kind: 'wrong-mode'; correctMode: OutboundMode };

/**
 * Finds which order a scanned/typed code refers to among the tasks the session
 * screen already has loaded — the backend has no "confirm by code" endpoint, only
 * "confirm by task id", so the mobile session flow resolves code -> task locally
 * before calling claim-self (if unclaimed) and confirm.
 */
export function resolveScannedCode(
  code: string,
  mode: OutboundMode,
  available: AvailableOutboundTask[],
  mine: OutboundTaskListItem[],
): ResolvedTask {
  const availableMatch = available.find((t) => t.task_type === mode && matchesCode([t.title], code));
  if (availableMatch) {
    return {
      kind: 'claim-then-confirm',
      taskId: availableMatch.id,
      taskType: mode,
      claimEndpoint: availableMatch.claim_endpoint,
      orderNumber: availableMatch.title,
    };
  }

  const mineMatch = mine.find(
    (t) => t.task_type === mode && matchesCode([t.order_number], code) && canConfirmOutbound(t.status),
  );
  if (mineMatch) {
    return { kind: 'confirm', taskId: mineMatch.task_id, taskType: mode, orderNumber: mineMatch.order_number };
  }

  const otherMode: OutboundMode = mode === 'outbound' ? 'transfer' : 'outbound';
  const inOtherMode =
    available.some((t) => t.task_type === otherMode && matchesCode([t.title], code)) ||
    mine.some((t) => t.task_type === otherMode && matchesCode([t.order_number], code));
  if (inOtherMode) {
    return { kind: 'wrong-mode', correctMode: otherMode };
  }

  return { kind: 'not-found' };
}
