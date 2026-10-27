import { apiFetch } from './client';
import type { LoginResponse, RefreshResponse, User, WarehouseStaffOption } from '../types/auth';

export function login(username: string, password: string) {
  return apiFetch<LoginResponse>('/auth/login', {
    method: 'POST',
    // "mobile" asks auth-service for a rotating refresh token alongside the JWT.
    body: { username, password, client: 'mobile' },
    skipAuth: true,
  });
}

export function refreshSession(refreshToken: string) {
  return apiFetch<RefreshResponse>('/auth/refresh', {
    method: 'POST',
    body: { refresh_token: refreshToken },
    skipAuth: true,
  });
}

/** Best effort: blacklists the access token (if still valid) and ends the refresh-token family. */
export async function logoutRemote(accessToken: string | null, refreshToken: string | null) {
  const tasks: Promise<unknown>[] = [];
  if (accessToken) {
    tasks.push(
      apiFetch('/auth/logout', {
        method: 'POST',
        body: refreshToken ? { refresh_token: refreshToken } : {},
        skipAuth: true,
        headers: { Authorization: `Bearer ${accessToken}` },
        timeoutMs: 5000,
      }),
    );
  }
  if (refreshToken) {
    tasks.push(apiFetch('/auth/refresh/revoke', { method: 'POST', body: { refresh_token: refreshToken }, skipAuth: true, timeoutMs: 5000 }));
  }
  await Promise.allSettled(tasks);
}

/** Current user with roles/permissions read fresh from auth-service (the JWT copy can be stale). */
export function getMe() {
  return apiFetch<{ user: User }>('/auth/me');
}

export function getWarehouseStaff() {
  return apiFetch<{ data: WarehouseStaffOption[] }>('/auth/warehouse-staff');
}
