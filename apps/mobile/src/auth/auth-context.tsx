import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Alert, AppState } from 'react-native';

import * as authApi from '../api/auth';
import { ApiError, setRefreshHandler, setUnauthorizedHandler } from '../api/client';
import type { LoginChallengeResponse, User } from '../types/auth';
import { createSingleFlight, decodeJwtPayload, msUntilExpiry, userFromClaims, type RefreshResult } from './session';
import { clearToken, getRefreshToken, getToken, setSessionTokens } from './token-storage';

/** A login either signs in or needs an emailed code first (kept in screen state only). */
export type LoginOutcome = { kind: 'signed-in' } | { kind: 'challenge'; response: LoginChallengeResponse };

type AuthContextValue = {
  user: User | null;
  isLoading: boolean;
  login: (username: string, password: string) => Promise<LoginOutcome>;
  /** Finishes an OTP_REQUIRED login; only now are tokens stored. */
  completeOtpLogin: (challengeId: string, code: string) => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

const SESSION_CHECK_INTERVAL_MS = 60_000;
// With a refresh token the access token is renewed this long before it expires, so a
// long scan session never hits "Token expired" mid-task.
const PROACTIVE_REFRESH_MS = 5 * 60_000;
const EXPIRY_WARNING_THRESHOLD_MS = 5 * 60_000;

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const hasWarnedExpiryRef = useRef(false);

  const userRef = useRef<User | null>(null);
  useEffect(() => {
    userRef.current = user;
  }, [user]);

  const endSession = useCallback(async (message?: string) => {
    // Parallel requests can all fail at once; tell the user only once.
    const wasSignedIn = userRef.current !== null;
    userRef.current = null;
    await clearToken().catch(() => {});
    setUser(null);
    if (message && wasSignedIn) Alert.alert('Phiên đăng nhập đã kết thúc', message);
  }, []);

  // One shared, single-flight refresh for every caller (api client, startup, timer).
  const [refresh] = useState(() =>
    createSingleFlight(async (): Promise<RefreshResult> => {
      const refreshToken = await getRefreshToken();
      if (!refreshToken) return { kind: 'invalid' };
      try {
        const result = await authApi.refreshSession(refreshToken);
        await setSessionTokens(result.token, result.refresh_token);
        setUser(result.user);
        return { kind: 'ok', token: result.token };
      } catch (err) {
        // 401 = the refresh token is expired, revoked or was reused: the session is over.
        if (err instanceof ApiError && err.kind === 'http' && err.status === 401) return { kind: 'invalid' };
        return { kind: 'transient' };
      }
    }),
  );

  useEffect(() => {
    setUnauthorizedHandler(() => {
      void endSession('Vui lòng đăng nhập lại để tiếp tục.');
    });
    setRefreshHandler(async () => {
      const result = await refresh();
      if (result.kind === 'ok') return { token: result.token };
      return { failed: result.kind };
    });
    return () => {
      setUnauthorizedHandler(null);
      setRefreshHandler(null);
    };
  }, [endSession, refresh]);

  useEffect(() => {
    // Restore: a still-valid access token is trusted until its exp; an expired one is
    // renewed with the refresh token. Offline at launch keeps the session (the refresh
    // is retried on the next request) instead of logging the user out.
    (async () => {
      const token = await getToken();
      if (!token) return;
      const claims = decodeJwtPayload(token);
      if (!claims) {
        await clearToken();
        return;
      }
      const remaining = msUntilExpiry(token);
      if (remaining !== null && remaining > 30_000) {
        setUser(userFromClaims(claims));
        // Then the server's current view (full name, permissions changed since login).
        authApi
          .getMe()
          .then((result) => {
            if (userRef.current?.id === result.user.id) setUser(result.user);
          })
          .catch(() => {});
        return;
      }
      const result = await refresh();
      if (result.kind === 'transient' && (await getRefreshToken())) {
        setUser(userFromClaims(claims));
      } else if (result.kind !== 'ok') {
        await clearToken();
      }
    })()
      .catch(() => {})
      .finally(() => setIsLoading(false));
  }, [refresh]);

  useEffect(() => {
    if (!user) return;
    hasWarnedExpiryRef.current = false;

    const check = async () => {
      const token = await getToken();
      if (!token) return;
      const remainingMs = msUntilExpiry(token);
      if (remainingMs === null) return;
      const hasRefresh = Boolean(await getRefreshToken());

      if (hasRefresh) {
        if (remainingMs <= PROACTIVE_REFRESH_MS) {
          const result = await refresh();
          if (result.kind === 'invalid') await endSession('Vui lòng đăng nhập lại để tiếp tục.');
        }
        return;
      }

      // Session from an older login without a refresh token: warn, then end cleanly.
      if (remainingMs <= 0) {
        await endSession('Vui lòng đăng nhập lại để tiếp tục.');
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
    };

    const interval = setInterval(() => void check(), SESSION_CHECK_INTERVAL_MS);
    // Timers do not run while the app is in the background; check as soon as it is back.
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void check();
    });
    return () => {
      clearInterval(interval);
      subscription.remove();
    };
  }, [user, refresh, endSession]);

  const login = useCallback(async (username: string, password: string): Promise<LoginOutcome> => {
    const response = await authApi.login(username, password);
    // No token yet: nothing is stored and the app stays signed out until the code.
    if (authApi.isLoginChallenge(response)) return { kind: 'challenge', response };
    await setSessionTokens(response.token, response.refresh_token);
    setUser(response.user);
    return { kind: 'signed-in' };
  }, []);

  const completeOtpLogin = useCallback(async (challengeId: string, code: string) => {
    const response = await authApi.verifyLoginOtp(challengeId, code);
    await setSessionTokens(response.token, response.refresh_token);
    setUser(response.user);
  }, []);

  const logout = useCallback(async () => {
    const [token, refreshToken] = await Promise.all([getToken(), getRefreshToken()]);
    await clearToken();
    setUser(null);
    // After local sign-out, so a slow or offline network never keeps the user waiting.
    void authApi.logoutRemote(token, refreshToken);
  }, []);

  return (
    <AuthContext.Provider value={{ user, isLoading, login, completeOtpLogin, logout }}>
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
