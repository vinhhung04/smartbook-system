import { useState } from 'react';

export type SubmitLock = {
  /** Runs fn unless a previous run is still in flight; returns undefined when skipped. */
  run<T>(fn: () => Promise<T>): Promise<T | undefined>;
  readonly busy: boolean;
};

/**
 * A `disabled={isSubmitting}` prop only takes effect after React re-renders, so two
 * taps (or a scanner's Enter plus a tap) inside the same frame both reach onPress.
 * This lock is synchronous, so the second call is dropped before any request starts.
 */
export function createSubmitLock(): SubmitLock {
  let busy = false;
  return {
    async run<T>(fn: () => Promise<T>) {
      if (busy) return undefined;
      busy = true;
      try {
        return await fn();
      } finally {
        busy = false;
      }
    },
    get busy() {
      return busy;
    },
  };
}

export function useSubmitLock(): SubmitLock {
  const [lock] = useState(createSubmitLock);
  return lock;
}
