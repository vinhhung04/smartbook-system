// Postgres storage for lib/email-otp.js. Every state change is a single conditional
// UPDATE, so the checks hold under concurrent requests without row locks.

const COLUMNS = `id, user_id, purpose, email, code_hash, attempts, send_count, expires_at, last_sent_at, consumed_at, invalidated_at, created_at`;

function createPrismaOtpStore(prisma) {
  async function one(sql, ...params) {
    const rows = await prisma.$queryRawUnsafe(sql, ...params);
    return rows[0] || null;
  }

  return {
    findById(id) {
      return one(`SELECT ${COLUMNS} FROM email_otp_challenges WHERE id = $1::uuid`, id);
    },

    findLatestOpen(userId, purpose) {
      return one(
        `SELECT ${COLUMNS} FROM email_otp_challenges
          WHERE user_id = $1::uuid AND purpose = $2 AND consumed_at IS NULL AND invalidated_at IS NULL
          ORDER BY created_at DESC LIMIT 1`,
        userId,
        purpose,
      );
    },

    // The newest challenge is the only live one for this user + purpose.
    async createChallenge(row) {
      return prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(
          `UPDATE email_otp_challenges SET invalidated_at = $3::timestamptz
            WHERE user_id = $1::uuid AND purpose = $2 AND consumed_at IS NULL AND invalidated_at IS NULL`,
          row.user_id,
          row.purpose,
          row.created_at,
        );
        const rows = await tx.$queryRawUnsafe(
          `INSERT INTO email_otp_challenges (id, user_id, purpose, email, code_hash, expires_at, last_sent_at, created_at)
           VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6::timestamptz, $7::timestamptz, $8::timestamptz)
           RETURNING ${COLUMNS}`,
          row.id, row.user_id, row.purpose, row.email, row.code_hash, row.expires_at, row.last_sent_at, row.created_at,
        );
        return rows[0];
      });
    },

    // Resend: a new code with a fresh attempt budget. send_count acts as a version so
    // two resends racing for one challenge cannot both win.
    replaceCode(id, fields, expectedSendCount) {
      return one(
        `UPDATE email_otp_challenges
            SET code_hash = $2, expires_at = $3::timestamptz, last_sent_at = $4::timestamptz,
                attempts = 0, send_count = send_count + 1
          WHERE id = $1::uuid AND consumed_at IS NULL AND invalidated_at IS NULL AND send_count = $5
          RETURNING ${COLUMNS}`,
        id, fields.code_hash, fields.expires_at, fields.last_sent_at, expectedSendCount,
      );
    },

    async markSendFailed(id, lastSentAt) {
      await prisma.$executeRawUnsafe(
        `UPDATE email_otp_challenges SET last_sent_at = $2::timestamptz WHERE id = $1::uuid`,
        id,
        lastSentAt,
      );
    },

    reserveAttempt(id, maxAttempts, at) {
      return one(
        `UPDATE email_otp_challenges SET attempts = attempts + 1
          WHERE id = $1::uuid AND consumed_at IS NULL AND invalidated_at IS NULL
            AND expires_at > $3::timestamptz AND attempts < $2
          RETURNING ${COLUMNS}`,
        id,
        maxAttempts,
        at,
      );
    },

    async consume(id, codeHash, at, apply) {
      return prisma.$transaction(async (tx) => {
        const rows = await tx.$queryRawUnsafe(
          `UPDATE email_otp_challenges SET consumed_at = $3::timestamptz
            WHERE id = $1::uuid AND code_hash = $2 AND consumed_at IS NULL AND invalidated_at IS NULL
            RETURNING ${COLUMNS}`,
          id,
          codeHash,
          at,
        );
        const consumed = rows[0] || null;
        if (consumed && apply) await apply(tx, consumed);
        return consumed;
      });
    },

    async countRecentSends(userId, since) {
      const row = await one(
        `SELECT COALESCE(SUM(send_count), 0)::int AS sent FROM email_otp_challenges
          WHERE user_id = $1::uuid AND last_sent_at >= $2::timestamptz`,
        userId,
        since,
      );
      return Number(row?.sent || 0);
    },
  };
}

module.exports = { createPrismaOtpStore };
