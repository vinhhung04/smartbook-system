import { canConfirmOutbound } from './outboundRules';

describe('canConfirmOutbound', () => {
  it('allows confirming when the order is READY_FOR_OUTBOUND', () => {
    expect(canConfirmOutbound('READY_FOR_OUTBOUND')).toBe(true);
  });

  it('allows confirming when the order is READY_TO_SHIP', () => {
    expect(canConfirmOutbound('READY_TO_SHIP')).toBe(true);
  });

  it('blocks confirming while REPICKING with quantity still outstanding', () => {
    expect(canConfirmOutbound('REPICKING', 3)).toBe(false);
  });

  it('blocks confirming while REPICKING and aggregateRemaining is unknown', () => {
    expect(canConfirmOutbound('REPICKING', undefined)).toBe(false);
  });

  it('allows confirming once REPICKING has nothing left outstanding', () => {
    expect(canConfirmOutbound('REPICKING', 0)).toBe(true);
  });

  it('blocks confirming for any other status', () => {
    expect(canConfirmOutbound('APPROVED')).toBe(false);
    expect(canConfirmOutbound('PICKING')).toBe(false);
    expect(canConfirmOutbound('PARTIAL_PICKED')).toBe(false);
    expect(canConfirmOutbound('COMPLETED')).toBe(false);
    expect(canConfirmOutbound('CANCELLED')).toBe(false);
  });
});
