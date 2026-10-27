import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

const TOKEN_KEY = 'smartbook_mobile_token';
const REFRESH_KEY = 'smartbook_mobile_refresh_token';

// expo-secure-store does not support the web platform; fall back to
// localStorage there so the app is testable in a browser during development.
const isWeb = Platform.OS === 'web';

async function read(key: string): Promise<string | null> {
  if (isWeb) return typeof window === 'undefined' ? null : window.localStorage.getItem(key);
  return SecureStore.getItemAsync(key);
}

async function write(key: string, value: string): Promise<void> {
  if (isWeb) {
    if (typeof window !== 'undefined') window.localStorage.setItem(key, value);
    return;
  }
  await SecureStore.setItemAsync(key, value);
}

async function remove(key: string): Promise<void> {
  if (isWeb) {
    if (typeof window !== 'undefined') window.localStorage.removeItem(key);
    return;
  }
  await SecureStore.deleteItemAsync(key);
}

export function getToken(): Promise<string | null> {
  return read(TOKEN_KEY);
}

export function setToken(token: string): Promise<void> {
  return write(TOKEN_KEY, token);
}

export function getRefreshToken(): Promise<string | null> {
  return read(REFRESH_KEY);
}

export async function setSessionTokens(token: string, refreshToken: string | null | undefined): Promise<void> {
  await write(TOKEN_KEY, token);
  if (refreshToken) await write(REFRESH_KEY, refreshToken);
  else await remove(REFRESH_KEY);
}

export async function clearToken(): Promise<void> {
  await Promise.all([remove(TOKEN_KEY), remove(REFRESH_KEY)]);
}
