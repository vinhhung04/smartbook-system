import { matchesCode } from '../scanner/matching';
import type { AvailableOutboundTask, OutboundTaskListItem } from '../types/outbound';

export type OutboundMode = 'outbound' | 'transfer';

export type ResolvedTask =
  | { kind: 'claim-then-confirm'; taskId: string; taskType: OutboundMode; claimEndpoint: string; orderNumber: string; status: string }
  | { kind: 'confirm'; taskId: string; taskType: OutboundMode; orderNumber: string; status: string }
  | { kind: 'not-found' }
  | { kind: 'wrong-mode'; correctMode: OutboundMode };

/**
 * Finds which order a scanned/typed code refers to among the tasks the session
 * screen already has loaded — the backend has no "confirm by code" endpoint, only
 * "confirm by task id", so the mobile session flow resolves code -> task locally
 * before calling claim-self (if unclaimed) and confirm.
 *
 * This only matches the code to a task — it does NOT decide whether the task is
 * ready to confirm. A REPICKING order can be ready (repick chain fully picked) or
 * not, and that requires an extra aggregate-quantity lookup the caller performs;
 * see canConfirmOutbound in outboundRules.ts.
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
      status: availableMatch.status,
    };
  }

  const mineMatch = mine.find((t) => t.task_type === mode && matchesCode([t.order_number], code));
  if (mineMatch) {
    return {
      kind: 'confirm',
      taskId: mineMatch.task_id,
      taskType: mode,
      orderNumber: mineMatch.order_number,
      status: mineMatch.status,
    };
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
