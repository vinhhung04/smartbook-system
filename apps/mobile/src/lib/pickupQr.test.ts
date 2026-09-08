import { buildPickupQrValue, isPickupCodeExpired } from './pickupQr';

describe('buildPickupQrValue', () => {
  it('prefixes the raw pickup code with the SMARTBOOK QR scheme', () => {
    expect(buildPickupQrValue('PU-AB12-CD34')).toBe('SMARTBOOK:PICKUP:PU-AB12-CD34');
  });
});

describe('isPickupCodeExpired', () => {
  it('is not expired when there is no expiry date', () => {
    expect(isPickupCodeExpired(null)).toBe(false);
  });

  it('is expired when the expiry date is in the past', () => {
    expect(isPickupCodeExpired(new Date(Date.now() - 60_000).toISOString())).toBe(true);
  });

  it('is not expired when the expiry date is in the future', () => {
    expect(isPickupCodeExpired(new Date(Date.now() + 60_000).toISOString())).toBe(false);
  });
});
