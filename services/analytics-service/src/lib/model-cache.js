// Single-flight, in-memory TTL cache for trained risk models.
//
// Why: training issues a real SQL query against a pool of only 5 connections
// (see src/lib/db.js). Without deduplication, N concurrent requests for the
// same model would each start their own training query. With it, at most one
// training run per model key is ever in flight, and its result is reused by
// every request that asked for it (including ones that arrived after it
// started but before it finished).
//
// No persistence, no Redis - analytics-service owns no database of its own
// (see Area A design notes); training is cheap enough (one SQL scan, batch
// gradient descent over a few thousand rows) to just redo every
// RISK_MODEL_TTL_MS.

const TTL_MS = Math.max(60_000, Number(process.env.RISK_MODEL_TTL_MS || 6 * 60 * 60 * 1000));

const entries = new Map(); // key -> { value, expiresAt, inflight }

/**
 * @param {string} key
 * @param {() => Promise<any>} trainFn
 * @returns {Promise<any>}
 */
async function getOrTrain(key, trainFn) {
  const entry = entries.get(key);
  const now = Date.now();

  if (entry && entry.expiresAt > now) {
    return entry.value;
  }
  if (entry && entry.inflight) {
    return entry.inflight;
  }

  const inflight = trainFn()
    .then((value) => {
      entries.set(key, { value, expiresAt: Date.now() + TTL_MS, inflight: null });
      return value;
    })
    .catch((error) => {
      entries.delete(key);
      throw error;
    });

  entries.set(key, { value: entry ? entry.value : null, expiresAt: entry ? entry.expiresAt : 0, inflight });
  return inflight;
}

function clear() {
  entries.clear();
}

module.exports = { getOrTrain, clear };
