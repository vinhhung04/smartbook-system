import { apiFetch } from './client';
import type { LoginResponse } from '../types/auth';

export function login(username: string, password: string) {
  return apiFetch<LoginResponse>('/auth/login', {
    method: 'POST',
    body: { username, password },
    skipAuth: true,
  });
}
