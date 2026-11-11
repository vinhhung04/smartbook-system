import { createSingleFlight, decodeJwtPayload, msUntilExpiry, userFromClaims } from './session';

function fakeJwt(payload: object): string {
  const encode = (value: object) => btoa(JSON.stringify(value)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  return `${encode({ alg: 'HS256' })}.${encode(payload)}.sig`;
}

describe('decodeJwtPayload / userFromClaims', () => {
  it('reads roles, permissions and the superuser flag', () => {
    const claims = decodeJwtPayload(fakeJwt({ sub: 'u1', username: 'hung', email: 'h@x.vn', roles: ['ADMIN'], permissions: ['a'], is_superuser: true }));
    expect(claims && userFromClaims(claims)).toEqual({
      id: 'u1',
      username: 'hung',
      email: 'h@x.vn',
      roles: ['ADMIN'],
      permissions: ['a'],
      is_superuser: true,
    });
  });

  it('returns null for garbage', () => {
    expect(decodeJwtPayload('not-a-jwt')).toBeNull();
  });
});

describe('msUntilExpiry', () => {
  it('computes the remaining lifetime from exp', () => {
    const now = 1_000_000_000_000;
    expect(msUntilExpiry(fakeJwt({ exp: now / 1000 + 60 }), now)).toBe(60_000);
    expect(msUntilExpiry(fakeJwt({ exp: now / 1000 - 1 }), now)).toBe(-1000);
    expect(msUntilExpiry(fakeJwt({}), now)).toBeNull();
  });
});

describe('createSingleFlight', () => {
  it('shares one refresh between concurrent callers, then allows a new one', async () => {
    let release!: (value: { kind: 'ok'; token: string }) => void;
    const run = jest.fn(() => new Promise<{ kind: 'ok'; token: string }>((resolve) => { release = resolve; }));
    const refresh = createSingleFlight(run);

    const a = refresh();
    const b = refresh();
    release({ kind: 'ok', token: 't1' });
    await expect(a).resolves.toEqual({ kind: 'ok', token: 't1' });
    await expect(b).resolves.toEqual({ kind: 'ok', token: 't1' });
    expect(run).toHaveBeenCalledTimes(1);

    const c = refresh();
    release({ kind: 'ok', token: 't2' });
    await expect(c).resolves.toEqual({ kind: 'ok', token: 't2' });
    expect(run).toHaveBeenCalledTimes(2);
  });
});
