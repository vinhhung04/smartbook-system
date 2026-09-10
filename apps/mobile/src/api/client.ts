import { getToken } from '../auth/token-storage';

const BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL ?? 'http://localhost:3000';
const REQUEST_TIMEOUT_MS = 15000;
// Only GET is safe to retry automatically — POST/PATCH/DELETE could double-apply a
// mutation (e.g. double-count a picked quantity) if the request actually succeeded
// server-side but the response was lost to the network drop.
const GET_RETRY_ATTEMPTS = 2;
const GET_RETRY_DELAY_MS = 800;

export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

let onUnauthorized: (() => void) | null = null;

export function setUnauthorizedHandler(handler: (() => void) | null) {
  onUnauthorized = handler;
}

// Backend auth middlewares (auth/inventory/borrow-service) return 401 only when the
// Authorization header itself is missing/malformed, but 403 for an expired or invalid
// token — the same status code legitimate permission-denied errors also use (e.g.
// "Forbidden", "Task is assigned to another picker"). Matching on these exact messages
// is how we tell "your session is dead, log in again" apart from "you can't do that".
const AUTH_FAILURE_MESSAGES = new Set([
  'Token expired',
  'Invalid token',
  'Authorization header is required',
  'Invalid authorization format. Use Bearer <token>',
]);

type ApiFetchOptions = {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  skipAuth?: boolean;
  headers?: Record<string, string>;
};

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export async function apiFetch<T>(path: string, options: ApiFetchOptions = {}): Promise<T> {
  // FormData (multipart uploads, e.g. cover-photo search) must not be JSON-encoded,
  // and must not get an explicit Content-Type — fetch sets its own multipart
  // boundary from the FormData instance itself.
  const isFormData = typeof FormData !== 'undefined' && options.body instanceof FormData;
  const headers: Record<string, string> = isFormData
    ? { ...options.headers }
    : { 'Content-Type': 'application/json', ...options.headers };

  if (!options.skipAuth) {
    const token = await getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  const method = options.method ?? 'GET';
  const init: RequestInit = {
    method,
    headers,
    body:
      options.body === undefined
        ? undefined
        : isFormData
          ? (options.body as FormData)
          : JSON.stringify(options.body),
  };

  const attempts = method === 'GET' ? GET_RETRY_ATTEMPTS + 1 : 1;
  let response: Response | undefined;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      response = await fetchWithTimeout(`${BASE_URL}${path}`, init);
      break;
    } catch {
      if (attempt === attempts) {
        throw new ApiError(0, 'Mất kết nối mạng. Vui lòng kiểm tra Internet và thử lại.');
      }
      await sleep(GET_RETRY_DELAY_MS);
    }
  }

  const text = await response!.text();
  const data = text ? JSON.parse(text) : null;

  if (!response!.ok) {
    const message = data?.message ?? data?.error ?? `Request failed (${response!.status})`;

    if (
      !options.skipAuth &&
      (response!.status === 401 || (response!.status === 403 && AUTH_FAILURE_MESSAGES.has(message)))
    ) {
      onUnauthorized?.();
    }

    throw new ApiError(response!.status, message);
  }

  return data as T;
}
