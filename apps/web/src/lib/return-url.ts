/**
 * Where to send someone after they log in. Only same-origin paths are accepted:
 * "//evil.com", "https://evil.com" or "/\evil.com" would otherwise turn the
 * login page into an open redirect.
 */
export function safeReturnUrl(raw: string | null | undefined): string | null {
  const value = String(raw || '').trim();
  if (!value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return null;
  if ([...value].some((char) => char.charCodeAt(0) < 0x20)) return null;
  // Never bounce back onto an auth page (login loops).
  if (/^\/(customer\/)?(login|register)(\/|\?|$)/.test(value)) return null;
  return value;
}

/** Customer login URL that brings the reader back to `returnTo` afterwards. */
export function buildLoginUrl(returnTo: string, page: 'login' | 'register' = 'login'): string {
  const safe = safeReturnUrl(returnTo);
  return safe ? `/customer/${page}?returnUrl=${encodeURIComponent(safe)}` : `/customer/${page}`;
}

/** Keeps the pending returnUrl when switching between the login and register pages. */
export function withReturnUrl(path: string, returnUrl: string | null): string {
  return returnUrl ? `${path}?returnUrl=${encodeURIComponent(returnUrl)}` : path;
}
