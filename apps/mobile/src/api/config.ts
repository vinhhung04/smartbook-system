import { Platform } from 'react-native';
import Constants from 'expo-constants';

export type ApiUrlCheck = { ok: true; url: string } | { ok: false; reason: string };

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '[::1]', '10.0.2.2']);

/**
 * Same rules app.config.js enforces at build time (it cannot import TS, so the
 * checks are duplicated there): a release build must reach the API Gateway over
 * HTTPS at a real host — a phone cannot reach "localhost", and a "<placeholder>"
 * left in eas.json must fail loudly rather than ship.
 */
export function checkApiBaseUrl(raw: string | undefined | null, { requireHttps }: { requireHttps: boolean }): ApiUrlCheck {
  const value = String(raw ?? '').trim().replace(/\/+$/, '');
  if (!value) return { ok: false, reason: 'Chưa cấu hình EXPO_PUBLIC_API_BASE_URL.' };
  if (/[<>]/.test(value)) return { ok: false, reason: `EXPO_PUBLIC_API_BASE_URL vẫn là giá trị mẫu: ${value}` };
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return { ok: false, reason: `EXPO_PUBLIC_API_BASE_URL không phải URL hợp lệ: ${value}` };
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return { ok: false, reason: 'EXPO_PUBLIC_API_BASE_URL phải bắt đầu bằng http:// hoặc https://' };
  }
  if (requireHttps) {
    if (parsed.protocol !== 'https:') return { ok: false, reason: 'Bản phát hành phải gọi API Gateway qua HTTPS.' };
    if (LOCAL_HOSTS.has(parsed.hostname)) return { ok: false, reason: 'Bản phát hành không được trỏ tới localhost.' };
  }
  return { ok: true, url: value };
}

function devServerHostUrl(): string | null {
  // In the browser the page's own host is where the dev machine is reachable from.
  if (Platform.OS === 'web' && typeof window !== 'undefined' && window.location?.hostname) {
    return `http://${window.location.hostname}:3000`;
  }
  // In Expo Go / dev client the bundle is served from the dev machine; its LAN IP is the
  // most likely place the gateway runs during development (port 3000, see docker-compose).
  const hostUri = Constants.expoConfig?.hostUri;
  const host = hostUri?.split(':')[0];
  return host ? `http://${host}:3000` : null;
}

let configError: string | null = null;

export function resolveApiBaseUrl(): string {
  const requireHttps = !__DEV__ && process.env.EXPO_PUBLIC_ALLOW_INSECURE_API !== 'true';
  const configured = checkApiBaseUrl(process.env.EXPO_PUBLIC_API_BASE_URL, { requireHttps });
  if (configured.ok) return configured.url;
  if (__DEV__) {
    const fallback = devServerHostUrl() ?? 'http://localhost:3000';
    return fallback;
  }
  configError = configured.reason;
  // Unreachable on purpose: every request fails with a network error and the login
  // screen shows configError instead of silently talking to the wrong server.
  return 'https://invalid.invalid';
}

/** Non-null when this build was produced without a usable API URL (shown on the login screen). */
export function getApiConfigError(): string | null {
  return configError;
}
