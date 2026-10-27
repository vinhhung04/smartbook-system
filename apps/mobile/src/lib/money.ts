import type { Fine, Money } from '../types/borrow';

/** Decimal columns arrive as strings; anything unparsable counts as 0, never NaN. */
export function toMoney(value: Money | null | undefined): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function formatVnd(amount: Money | null | undefined): string {
  return `${Math.round(toMoney(amount)).toLocaleString('vi-VN')} đ`;
}

/**
 * What is still owed on a fine. The server's remaining_amount is the source of truth
 * (same formula VNPay checkout uses); the local fallback exists only for an older
 * borrow-service that does not send it — and adds numbers, not "5000.00" strings.
 */
export function fineRemaining(fine: Pick<Fine, 'amount' | 'waived_amount' | 'fine_payments' | 'remaining_amount'>): number {
  if (typeof fine.remaining_amount === 'number' && Number.isFinite(fine.remaining_amount)) return Math.max(0, fine.remaining_amount);
  const paid = (fine.fine_payments ?? []).reduce((sum, payment) => sum + toMoney(payment.amount), 0);
  return Math.max(0, toMoney(fine.amount) - toMoney(fine.waived_amount) - paid);
}
