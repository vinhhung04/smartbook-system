// In-memory twin of lib/email-otp-store.js for tests. Each method mirrors the WHERE
// clause of its SQL and runs without an await between check and write, which is what
// the single conditional UPDATE guarantees in Postgres.
// `tx` is what apply(tx, challenge) receives (a fake prisma in controller tests).
function createMemoryOtpStore({ tx = null } = {}) {
  const rows = new Map();
  const copy = (row) => (row ? { ...row } : null);

  return {
    rows,
    async findById(id) {
      return copy(rows.get(id));
    },
    async findLatestOpen(userId, purpose) {
      const open = [...rows.values()]
        .filter((r) => r.user_id === userId && r.purpose === purpose && !r.consumed_at && !r.invalidated_at)
        .sort((a, b) => b.created_at - a.created_at);
      return copy(open[0]);
    },
    async createChallenge(row) {
      for (const r of rows.values()) {
        if (r.user_id === row.user_id && r.purpose === row.purpose && !r.consumed_at && !r.invalidated_at) r.invalidated_at = row.created_at;
      }
      const stored = { attempts: 0, send_count: 1, consumed_at: null, invalidated_at: null, ...row };
      rows.set(row.id, stored);
      return copy(stored);
    },
    async replaceCode(id, fields, expectedSendCount) {
      const r = rows.get(id);
      if (!r || r.consumed_at || r.invalidated_at || r.send_count !== expectedSendCount) return null;
      Object.assign(r, fields, { attempts: 0, send_count: r.send_count + 1 });
      return copy(r);
    },
    async markSendFailed(id, lastSentAt) {
      const r = rows.get(id);
      if (r) r.last_sent_at = lastSentAt;
    },
    async reserveAttempt(id, maxAttempts, at) {
      const r = rows.get(id);
      if (!r || r.consumed_at || r.invalidated_at || !(r.expires_at > at) || r.attempts >= maxAttempts) return null;
      r.attempts += 1;
      return copy(r);
    },
    async consume(id, codeHash, at, apply) {
      const r = rows.get(id);
      if (!r || r.code_hash !== codeHash || r.consumed_at || r.invalidated_at) return null;
      r.consumed_at = at;
      try {
        if (apply) await apply(tx, copy(r));
      } catch (error) {
        r.consumed_at = null; // the transaction rolls back
        throw error;
      }
      return copy(r);
    },
    async countRecentSends(userId, since) {
      return [...rows.values()].filter((r) => r.user_id === userId && r.last_sent_at >= since).reduce((sum, r) => sum + r.send_count, 0);
    },
  };
}

module.exports = { createMemoryOtpStore };
