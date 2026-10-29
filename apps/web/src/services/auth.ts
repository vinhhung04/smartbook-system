import axios from 'axios';
import { authAPI } from './http-clients';

export interface LoginRequest {
  identifier: string;
  password: string;
}

export interface RegisterRequest {
  username: string;
  email: string;
  full_name: string;
  password: string;
}

export interface AuthUser {
  id: string;
  username: string;
  email: string;
  full_name: string;
  phone?: string | null;
  avatar_url?: string | null;
  last_login_at?: string | null;
  email_verified_at?: string | null;
  roles: string[];
  permissions: string[];
  is_superuser?: boolean;
}

export interface LoginResponse {
  message: string;
  token: string;
  user: AuthUser;
}

export type OtpPurpose = 'EMAIL_VERIFICATION' | 'LOGIN_2FA';

/** An emailed-code step (auth-service lib/email-otp.js). The id is not a credential. */
export interface OtpChallenge {
  id: string;
  purpose: OtpPurpose;
  masked_email: string;
  code_length: number;
  expires_at: string;
  resend_available_at: string;
  attempts_remaining: number;
}

/** /auth/login either signs in or asks for a code first (HTTP 202). */
export type LoginResult =
  | { kind: 'authenticated'; data: LoginResponse }
  | { kind: 'challenge'; status: 'OTP_REQUIRED' | 'EMAIL_VERIFICATION_REQUIRED'; challenge: OtpChallenge };

export interface RegisterResponse {
  status: 'VERIFICATION_REQUIRED' | 'REGISTERED';
  message: string;
  email_delivery?: 'SENT' | 'FAILED';
  challenge?: OtpChallenge | null;
}

interface TokenPayload {
  exp?: number;
}

export interface UpdateMeRequest {
  full_name?: string;
  email?: string;
  phone?: string;
}

const TOKEN_KEY = 'token';
const USER_KEY = 'auth_user';

function parseJwtPayload(token: string): TokenPayload | null {
  try {
    const parts = token.split('.');
    if (parts.length < 2) return null;
    const payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const decoded = atob(payload);
    return JSON.parse(decoded) as TokenPayload;
  } catch {
    return null;
  }
}

function notifyAuthChanged() {
  window.dispatchEvent(new CustomEvent('smartbook:auth-changed'));
}

function setSession(token: string, user?: AuthUser) {
  localStorage.setItem(TOKEN_KEY, token);
  if (user) {
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  }
  notifyAuthChanged();
}

function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  notifyAuthChanged();
}

export const authService = {
  login: async (data: LoginRequest): Promise<LoginResult> => {
    const response = await authAPI.post('/auth/login', {
      identifier: data.identifier,
      email: data.identifier,
      username: data.identifier,
      password: data.password,
    });
    // The challenge only lives in memory (component state), never in storage.
    if (response.status === 202 && response.data?.challenge) {
      return { kind: 'challenge', status: response.data.status, challenge: response.data.challenge };
    }
    const token = response.data.token;
    if (token) {
      setSession(token, response.data.user);
    }
    return { kind: 'authenticated', data: response.data };
  },

  /** Second step of a login that answered OTP_REQUIRED; starts the session like login does. */
  verifyLoginOtp: async (challengeId: string, code: string): Promise<LoginResponse> => {
    const response = await authAPI.post('/auth/login/verify-otp', { challenge_id: challengeId, code });
    setSession(response.data.token, response.data.user);
    return response.data;
  },

  /** Confirms an email address. No session is started: the caller logs in next. */
  verifyEmailOtp: async (challengeId: string, code: string): Promise<{ status: 'VERIFIED'; message: string }> => {
    const response = await authAPI.post('/auth/email-otp/verify', { challenge_id: challengeId, code });
    return response.data;
  },

  resendEmailOtp: async (challenge: Pick<OtpChallenge, 'id' | 'purpose'>): Promise<OtpChallenge> => {
    const response = await authAPI.post('/auth/email-otp/resend', { challenge_id: challenge.id, purpose: challenge.purpose });
    return response.data.challenge;
  },

  register: async (data: RegisterRequest): Promise<RegisterResponse> => {
    const response = await authAPI.post('/auth/register', data);
    return response.data;
  },

  logout: async () => {
    try {
      await authAPI.post('/auth/logout');
    } catch {
      // Always clear local session even if server-side logout fails.
    }
    clearSession();
  },

  getMe: async (): Promise<AuthUser> => {
    const response = await authAPI.get('/auth/me');
    const user = response.data?.user as AuthUser;
    const token = localStorage.getItem(TOKEN_KEY);
    if (token && user) {
      setSession(token, user);
    }
    return user;
  },

  updateMe: async (data: UpdateMeRequest): Promise<AuthUser> => {
    const response = await authAPI.patch('/auth/me', data);
    const user = response.data?.user as AuthUser;
    const token = localStorage.getItem(TOKEN_KEY);
    if (token && user) {
      setSession(token, user);
    }
    return user;
  },

  getToken: (): string | null => localStorage.getItem(TOKEN_KEY),

  getCurrentUser: (): AuthUser | null => {
    try {
      const raw = localStorage.getItem(USER_KEY);
      return raw ? (JSON.parse(raw) as AuthUser) : null;
    } catch {
      return null;
    }
  },

  isAuthenticated: (): boolean => {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) return false;
    const payload = parseJwtPayload(token);
    if (!payload?.exp) return true;
    return payload.exp * 1000 > Date.now();
  },

  isCustomer: (): boolean => {
    const user = authService.getCurrentUser();
    return Array.isArray(user?.roles) && user.roles.includes('CUSTOMER');
  },

  isSupplier: (): boolean => {
    const user = authService.getCurrentUser();
    return Array.isArray(user?.roles) && user.roles.includes('SUPPLIER');
  },

  changePassword: async (currentPassword: string, newPassword: string): Promise<{ message: string }> => {
    const response = await authAPI.post('/auth/change-password', {
      current_password: currentPassword,
      new_password: newPassword,
    });
    return response.data;
  },

  requestPasswordReset: async (identifier: string): Promise<{ message: string }> => {
    const response = await authAPI.post('/auth/password-reset/request', { identifier });
    return response.data;
  },

  confirmPasswordReset: async (token: string, newPassword: string): Promise<{ message: string }> => {
    const response = await authAPI.post('/auth/password-reset/confirm', { token, new_password: newPassword });
    return response.data;
  },

  resendVerification: async (): Promise<{ status: 'OTP_SENT' | 'ALREADY_VERIFIED'; message: string; challenge?: OtpChallenge }> => {
    const response = await authAPI.post('/auth/resend-verification');
    return response.data;
  },

  hydrateCurrentUser: async (): Promise<AuthUser | null> => {
    if (!authService.isAuthenticated()) {
      return null;
    }

    try {
      return await authService.getMe();
    } catch (error) {
      // Only an explicit auth rejection ends the session. Transient failures (429 rate limit,
      // 5xx, network) keep the cached user so a busy gateway doesn't log people out.
      const status = axios.isAxiosError(error) ? error.response?.status : undefined;
      if (status === 401 || status === 403) {
        clearSession();
        return null;
      }
      return authService.getCurrentUser();
    }
  },
};
