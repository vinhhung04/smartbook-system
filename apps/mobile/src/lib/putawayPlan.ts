import type { CompartmentCandidate } from '../types/putaway';

export type ReceivingStock = {
  id: string;
  location_code: string;
  location_type: string;
  // Stock waiting in a receiving bin is on hand but not "available" (not sellable/
  // reservable yet), so available_qty is 0 there. The transfer endpoint checks on_hand_qty.
  items: { variant_id: string; on_hand_qty: number }[];
};

export type SourceOption = { id: string; location_code: string; location_type: string; available: number };

/**
 * A warehouse can have several RECEIVING/STAGING locations. The source of a putaway is
 * the one that actually holds this edition — taking receivings[0] blindly sent the
 * transfer from an empty bin (rejected) or, worse, from the wrong pile.
 */
export function sourcesHoldingVariant(receivings: ReceivingStock[], variantId: string): SourceOption[] {
  return receivings
    .map((receiving) => ({
      id: receiving.id,
      location_code: receiving.location_code,
      location_type: receiving.location_type,
      available: receiving.items
        .filter((item) => item.variant_id === variantId)
        .reduce((sum, item) => sum + Math.max(0, Number(item.on_hand_qty) || 0), 0),
    }))
    .filter((source) => source.available > 0)
    .sort((a, b) => b.available - a.available);
}

export type PutawayLimit = { max: number; reason: string };

/** The tightest of: what the receipt still owes, what the source bin holds, what the target bin fits. */
export function putawayLimit(itemRemaining: number, sourceAvailable: number | null, target: Pick<CompartmentCandidate, 'remaining_capacity'> | null): PutawayLimit {
  const limits: PutawayLimit[] = [{ max: Math.max(0, itemRemaining), reason: 'còn lại của phiếu' }];
  if (sourceAvailable !== null) limits.push({ max: Math.max(0, sourceAvailable), reason: 'đang có ở khu chờ cất' });
  if (target && Number.isFinite(target.remaining_capacity)) {
    limits.push({ max: Math.max(0, target.remaining_capacity), reason: 'sức chứa còn trống của vị trí' });
  }
  return limits.reduce((tightest, limit) => (limit.max < tightest.max ? limit : tightest));
}
