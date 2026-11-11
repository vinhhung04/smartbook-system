import type { User } from '../types/auth';

export type JwtClaims = {
  sub: string;
  username: string;
  email: string;
  roles?: string[];
  permissions?: string[];
  is_superuser?: boolean;
  exp?: number;
};

export function decodeJwtPayload(token: string): JwtClaims | null {
  try {
    const payloadSegment = token.split('.')[1];
    const base64 = payloadSegment.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
    const json = decodeURIComponent(
      atob(padded)
        .split('')
        .map((c) => `%${c.charCodeAt(0).toString(16).padStart(2, '0')}`)
        .join(''),
    );
    return JSON.parse(json);
  } catch {
    return null;
  }
}

export function userFromClaims(claims: JwtClaims): User {
  return {
    id: claims.sub,
    username: claims.username,
    email: claims.email,
    roles: claims.roles ?? [],
    permissions: claims.permissions ?? [],
    is_superuser: Boolean(claims.is_superuser),
  };
}

/** Milliseconds until the token expires (negative when already expired); null when it has no exp. */
export function msUntilExpiry(token: string, now = Date.now()): number | null {
  const claims = decodeJwtPayload(token);
  if (!claims?.exp) return null;
  return claims.exp * 1000 - now;
}

export type RefreshResult = { kind: 'ok'; token: string } | { kind: 'invalid' } | { kind: 'transient' };

/**
 * Several requests can fail with "Token expired" at the same moment (a screen loads three
 * lists in parallel). Refresh tokens rotate on every use, so a second concurrent refresh
 * would present an already-used token and the server would revoke the whole session.
 * Every caller therefore shares the one refresh that is in flight.
 */
export function createSingleFlight(run: () => Promise<RefreshResult>): () => Promise<RefreshResult> {
  let inFlight: Promise<RefreshResult> | null = null;
  return () => {
    if (!inFlight) {
      inFlight = run().finally(() => {
        inFlight = null;
      });
    }
    return inFlight;
  };
}
