import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Alert } from 'react-native';

import * as authApi from '../api/auth';
import { ApiError, setUnauthorizedHandler } from '../api/client';
import type { User } from '../types/auth';
import { clearToken, getToken, setToken } from './token-storage';

type AuthContextValue = {
  user: User | null;
  isLoading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

type JwtClaims = {
  sub: string;
  username: string;
  email: string;
  roles?: string[];
  permissions?: string[];
  exp?: number;
};

function decodeJwtPayload(token: string): JwtClaims | null {
  try {
    const payloadSegment = token.split('.')[1];
    const base64 = payloadSegment.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
    const json = decodeURIComponent(
      atob(padded)
        .split('')
        .map((c) => `%${c.charCodeAt(0).toString(16).padStart(2, '0')}`)
        .join('')
    );
    return JSON.parse(json);
  } catch {
    return null;
  }
}

const SESSION_CHECK_INTERVAL_MS = 60_000;
const EXPIRY_WARNING_THRESHOLD_MS = 5 * 60_000;

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const hasWarnedExpiryRef = useRef(false);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      clearToken().catch(() => {});
      setUser(null);
    });
    return () => setUnauthorizedHandler(null);
  }, []);

  useEffect(() => {
    // No refresh/verify endpoint exists, so we restore the session by decoding
    // the JWT payload locally and trusting it until its own `exp` claim expires.
    getToken()
      .then((token) => {
        if (!token) return;
        const claims = decodeJwtPayload(token);
        if (!claims || !claims.exp || claims.exp * 1000 <= Date.now()) {
          clearToken().catch(() => {});
          return;
        }
        setUser({
          id: claims.sub,
          username: claims.username,
          email: claims.email,
          roles: claims.roles ?? [],
          permissions: claims.permissions ?? [],
        });
      })
      .finally(() => setIsLoading(false));
  }, []);

  useEffect(() => {
    if (!user) return;
    hasWarnedExpiryRef.current = false;

    // No refresh endpoint exists (see above), so the best we can do is warn before the
    // JWT's own exp claim runs out and log the user out cleanly instead of letting them
    // hit a confusing "Token expired" failure on their next action mid-task.
    const interval = setInterval(async () => {
      const token = await getToken();
      if (!token) return;
      const claims = decodeJwtPayload(token);
      if (!claims?.exp) return;

      const remainingMs = claims.exp * 1000 - Date.now();

      if (remainingMs <= 0) {
        await clearToken();
        setUser(null);
        Alert.alert('Phiên đăng nhập đã hết hạn', 'Vui lòng đăng nhập lại để tiếp tục.');
        return;
      }

      if (remainingMs <= EXPIRY_WARNING_THRESHOLD_MS && !hasWarnedExpiryRef.current) {
        hasWarnedExpiryRef.current = true;
        const minutesLeft = Math.max(1, Math.ceil(remainingMs / 60_000));
        Alert.alert(
          'Phiên đăng nhập sắp hết hạn',
          `Còn khoảng ${minutesLeft} phút. Vui lòng lưu công việc đang làm và đăng nhập lại sớm.`,
        );
      }
    }, SESSION_CHECK_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [user]);

  async function login(username: string, password: string) {
    const response = await authApi.login(username, password);
    await setToken(response.token);
    setUser(response.user);
  }

  async function logout() {
    await clearToken();
    setUser(null);
  }

  return (
    <AuthContext.Provider value={{ user, isLoading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

export { ApiError };
