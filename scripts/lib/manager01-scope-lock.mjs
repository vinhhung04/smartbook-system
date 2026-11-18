// `warehouse-stock-data-scope-integration.mjs` temporarily overwrites manager01's
// warehouse_scopes for its test window (dropping it to a fixed {A: FULL, B: READ_ONLY}
// fixture) and restores the original scopes in a `finally`. `warehouse-assignment-integration.mjs`
// separately *assumes* manager01's real scope (FULL on HCM/HN/BR-HCM-01, nothing on DN) stays
// stable for its own checks 6 and 12. Running both in the same batch — not necessarily at the
// exact same instant, just overlapping anywhere in their respective windows — lets one observe
// manager01 mid-mutation and fail with no code bug involved. A simple exclusive file lock on disk
// serializes the two windows so a batch run behaves the same as running each script alone.
//
// Scope deliberately stays local to these two scripts' critical sections (not every script that
// merely *reads* manager01 — see scripts' own comments for which ones mutate).
import { mkdirSync, writeFileSync, unlinkSync, readFileSync, existsSync, openSync, closeSync } from 'node:fs';
import { resolve } from 'node:path';

const LOCK_PATH = resolve(import.meta.dirname, '..', '.manager01-scope.lock');
const STALE_AFTER_MS = 5 * 60 * 1000; // a crashed holder's lock is treated as abandoned after this

function tryAcquire() {
  try {
    const fd = openSync(LOCK_PATH, 'wx');
    writeFileSync(fd, JSON.stringify({ pid: process.pid, acquiredAt: Date.now() }));
    closeSync(fd);
    return true;
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    return false;
  }
}

function clearIfStale() {
  if (!existsSync(LOCK_PATH)) return;
  try {
    const { acquiredAt } = JSON.parse(readFileSync(LOCK_PATH, 'utf8'));
    if (Date.now() - acquiredAt > STALE_AFTER_MS) unlinkSync(LOCK_PATH);
  } catch {
    // unreadable/partial lock file from a crash mid-write - treat as stale
    unlinkSync(LOCK_PATH);
  }
}

/** Runs `fn` while holding the exclusive manager01-scope lock, waiting (polling) for
 * any other script's window to finish first. Releases the lock even if `fn` throws. */
export async function withManager01ScopeLock(fn) {
  mkdirSync(resolve(import.meta.dirname, '..'), { recursive: true });
  const deadline = Date.now() + 2 * 60 * 1000;
  for (;;) {
    clearIfStale();
    if (tryAcquire()) break;
    if (Date.now() > deadline) {
      throw new Error(`Timed out waiting for scripts/.manager01-scope.lock (held by another script's run) after 2 minutes`);
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  try {
    return await fn();
  } finally {
    try { unlinkSync(LOCK_PATH); } catch { /* already gone */ }
  }
}
