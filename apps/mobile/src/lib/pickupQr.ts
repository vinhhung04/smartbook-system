const PICKUP_QR_PREFIX = 'SMARTBOOK:PICKUP:';

/**
 * Same client-side concatenation the web customer portal uses
 * (apps/web/src/components/pages/customer/_shared/reservation-item.tsx) —
 * the backend never returns a ready-made QR payload, only the raw
 * `pickup_code`.
 */
export function buildPickupQrValue(pickupCode: string): string {
  return `${PICKUP_QR_PREFIX}${pickupCode}`;
}

export function isPickupCodeExpired(pickupCodeExpiresAt: string | null): boolean {
  if (!pickupCodeExpiresAt) return false;
  return new Date(pickupCodeExpiresAt).getTime() <= Date.now();
}
