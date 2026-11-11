/**
 * Whether the SmartBook API is reachable, learned from real traffic: a request that got
 * any HTTP answer proves the server is reachable; one that got none (no network, DNS,
 * gateway down, timeout) suggests it is not. This tracks what matters to the app — the
 * VPS, not just "Wi-Fi is on" — and needs no native module.
 */
export type ConnectivityState = { online: boolean; since: number };

type Listener = (state: ConnectivityState) => void;

// A single slow response is not an outage: only consecutive transport failures flip it.
const FAILURES_BEFORE_OFFLINE = 2;

let state: ConnectivityState = { online: true, since: Date.now() };
let consecutiveFailures = 0;
const listeners = new Set<Listener>();

function set(online: boolean, now = Date.now()) {
  if (state.online === online) return;
  state = { online, since: now };
  listeners.forEach((listener) => listener(state));
}

export function getConnectivity(): ConnectivityState {
  return state;
}

export function subscribeConnectivity(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Called by apiFetch after every request. */
export function reportRequestOutcome(outcome: 'reachable' | 'unreachable', now = Date.now()) {
  if (outcome === 'reachable') {
    consecutiveFailures = 0;
    set(true, now);
    return;
  }
  consecutiveFailures += 1;
  if (consecutiveFailures >= FAILURES_BEFORE_OFFLINE) set(false, now);
}

/** Test helper. */
export function resetConnectivity() {
  state = { online: true, since: Date.now() };
  consecutiveFailures = 0;
  listeners.clear();
}
