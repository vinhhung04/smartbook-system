/**
 * Client-generated Idempotency-Key for mutating customer endpoints
 * (create/cancel reservation, renew-request, fine payment) — mirrors the
 * `c-resv-...` scheme apps/web/src/services/customer-borrow.ts already uses,
 * so a retried request after a dropped response never double-applies.
 */
export function createIdempotencyKey(prefix: string): string {
  const time = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 10);
  return `c-${prefix}-${time}-${random}`;
}
