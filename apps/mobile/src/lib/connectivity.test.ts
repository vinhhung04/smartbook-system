import { getConnectivity, reportRequestOutcome, resetConnectivity, subscribeConnectivity } from './connectivity';

beforeEach(() => resetConnectivity());

describe('connectivity', () => {
  it('does not flip offline on a single failed request', () => {
    reportRequestOutcome('unreachable');
    expect(getConnectivity().online).toBe(true);
  });

  it('goes offline after consecutive failures and back online on any answer', () => {
    const seen: boolean[] = [];
    subscribeConnectivity((state) => seen.push(state.online));
    reportRequestOutcome('unreachable');
    reportRequestOutcome('unreachable');
    expect(getConnectivity().online).toBe(false);
    reportRequestOutcome('reachable');
    expect(getConnectivity().online).toBe(true);
    expect(seen).toEqual([false, true]);
  });

  it('a success in between resets the failure count', () => {
    reportRequestOutcome('unreachable');
    reportRequestOutcome('reachable');
    reportRequestOutcome('unreachable');
    expect(getConnectivity().online).toBe(true);
  });

  it('unsubscribe stops notifications', () => {
    const listener = jest.fn();
    const unsubscribe = subscribeConnectivity(listener);
    unsubscribe();
    reportRequestOutcome('unreachable');
    reportRequestOutcome('unreachable');
    expect(listener).not.toHaveBeenCalled();
  });
});
