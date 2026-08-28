/**
 * Mirrors apps/web/src/components/pages/outbound.tsx's canConfirmOutbound —
 * an order can be shipped once fully picked, or mid-REPICKING only once the
 * aggregate pick + repick chain has nothing left outstanding.
 */
export function canConfirmOutbound(status: string, aggregateRemaining?: number): boolean {
  if (status === 'READY_FOR_OUTBOUND' || status === 'READY_TO_SHIP') return true;
  if (status === 'REPICKING') return (aggregateRemaining ?? 1) === 0;
  return false;
}
