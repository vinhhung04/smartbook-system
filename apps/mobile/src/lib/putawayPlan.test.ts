import { putawayLimit, sourcesHoldingVariant } from './putawayPlan';

describe('sourcesHoldingVariant', () => {
  const receivings = [
    { id: 'r1', location_code: 'RCV-01', location_type: 'RECEIVING', items: [{ variant_id: 'other', on_hand_qty: 9 }] },
    { id: 'r2', location_code: 'STG-01', location_type: 'STAGING', items: [{ variant_id: 'v1', on_hand_qty: 2 }] },
    { id: 'r3', location_code: 'RCV-02', location_type: 'RECEIVING', items: [{ variant_id: 'v1', on_hand_qty: 5 }, { variant_id: 'v1', on_hand_qty: 1 }] },
  ];

  it('skips receiving bins that do not hold the edition (the old receivings[0] bug)', () => {
    expect(sourcesHoldingVariant(receivings, 'v1').map((s) => s.id)).toEqual(['r3', 'r2']);
  });

  it('sums the available quantity per bin', () => {
    expect(sourcesHoldingVariant(receivings, 'v1')[0].available).toBe(6);
  });

  it('counts on-hand stock: receiving bins report available_qty 0 by design', () => {
    const live = [{ id: 'r', location_code: 'RECEIVING-01', location_type: 'RECEIVING', items: [{ variant_id: 'v', on_hand_qty: 67, available_qty: 0 }] }];
    expect(sourcesHoldingVariant(live, 'v')).toEqual([{ id: 'r', location_code: 'RECEIVING-01', location_type: 'RECEIVING', available: 67 }]);
  });

  it('returns nothing when no bin has it', () => {
    expect(sourcesHoldingVariant(receivings, 'missing')).toEqual([]);
  });
});

describe('putawayLimit', () => {
  it('is bounded by the receipt remainder', () => {
    expect(putawayLimit(3, 10, { remaining_capacity: 50 })).toEqual({ max: 3, reason: 'còn lại của phiếu' });
  });

  it('is bounded by what the source bin holds', () => {
    expect(putawayLimit(10, 4, null)).toEqual({ max: 4, reason: 'đang có ở khu chờ cất' });
  });

  it('is bounded by target capacity', () => {
    expect(putawayLimit(10, 10, { remaining_capacity: 2 })).toEqual({ max: 2, reason: 'sức chứa còn trống của vị trí' });
  });

  it('never goes negative', () => {
    expect(putawayLimit(5, null, { remaining_capacity: -3 }).max).toBe(0);
  });
});
