import axios, { AxiosInstance } from 'axios';

const authBaseURL = import.meta.env.VITE_AUTH_BASE_URL || 'http://localhost:3002';
const inventoryBaseURL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001';
const gatewayBaseURL = import.meta.env.VITE_GATEWAY_BASE_URL || 'http://localhost:3000';
const aiBaseURL = import.meta.env.VITE_AI_BASE_URL || `${gatewayBaseURL}/ai`;

export const TOKEN_KEY = 'token';
export const USER_KEY = 'auth_user';

export const authAPI: AxiosInstance = axios.create({
  baseURL: authBaseURL,
  headers: {
    'Content-Type': 'application/json',
  },
});

export const inventoryAPI: AxiosInstance = axios.create({
  baseURL: inventoryBaseURL,
  headers: {
    'Content-Type': 'application/json',
  },
});

export const aiAPI: AxiosInstance = axios.create({
  baseURL: aiBaseURL,
  headers: {
    'Content-Type': 'application/json',
  },
});

export const gatewayAPI: AxiosInstance = axios.create({
  baseURL: gatewayBaseURL,
  headers: {
    'Content-Type': 'application/json',
  },
});

export const domainAPIs = {
  auth: authAPI,
  inventory: inventoryAPI,
  ai: aiAPI,
  gateway: gatewayAPI,
};

const addTokenInterceptor = (api: AxiosInstance) => {
  api.interceptors.request.use((config) => {
    const token = localStorage.getItem(TOKEN_KEY);
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  });
};

addTokenInterceptor(authAPI);
addTokenInterceptor(inventoryAPI);
addTokenInterceptor(aiAPI);
addTokenInterceptor(gatewayAPI);

interface StoredAuthUser {
  is_superuser?: boolean;
  permissions?: string[];
}

function getCurrentUserFromStorage(): StoredAuthUser | null {
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? (JSON.parse(raw) as StoredAuthUser) : null;
  } catch {
    return null;
  }
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string, user?: unknown): void {
  localStorage.setItem(TOKEN_KEY, token);
  if (user) {
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  }
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

export function hasPermission(permission: string): boolean {
  const user = getCurrentUserFromStorage();
  if (!user) return false;
  if (user.is_superuser) return true;
  return Array.isArray(user.permissions) && user.permissions.includes(permission);
}

export function hasAnyPermission(permissions: string[]): boolean {
  if (!Array.isArray(permissions) || permissions.length === 0) return true;
  return permissions.some((permission) => hasPermission(permission));
}

export function hasAllPermissions(permissions: string[]): boolean {
  if (!Array.isArray(permissions) || permissions.length === 0) return true;
  return permissions.every((permission) => hasPermission(permission));
}

export function getApiErrorMessage(error: unknown, fallback = 'Request failed'): string {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data as { message?: string; error?: string } | undefined;
    if (data?.message) return data.message;
    if (data?.error) return data.error;
    if (error.message) return error.message;
  }
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}
