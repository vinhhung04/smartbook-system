import type { PickLine } from '@/services/borrow';

/** Copies taken per shelf, keyed by location id. */
export type PickCounts = Record<string, number>;

export function pickCountsToLines(counts: PickCounts): PickLine[] {
  return Object.entries(counts)
    .filter(([, quantity]) => quantity > 0)
    .map(([location_id, quantity]) => ({ location_id, quantity }));
}

export function pickCountsTotal(counts: PickCounts): number {
  return Object.values(counts).reduce((sum, quantity) => sum + (quantity > 0 ? quantity : 0), 0);
}
