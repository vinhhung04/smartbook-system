import { createIdempotencyKey } from './idempotency';

describe('createIdempotencyKey', () => {
  it('includes the given prefix', () => {
    expect(createIdempotencyKey('resv')).toMatch(/^c-resv-/);
  });

  it('generates a different key on every call', () => {
    const first = createIdempotencyKey('resv');
    const second = createIdempotencyKey('resv');
    expect(first).not.toBe(second);
  });
});
