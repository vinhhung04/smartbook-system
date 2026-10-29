import { getToken } from '../auth/token-storage';
import { resolveApiBaseUrl } from './config';
import { reportRequestOutcome } from '../lib/connectivity';

const BASE_URL = resolveApiBaseUrl();
export const DEFAULT_TIMEOUT_MS = 15000;
// OCR/vision calls (cover search, OCR on CPU) routinely run past a minute — the
// regular 15s budget made them fail before the server ever answered.
export const AI_TIMEOUT_MS = parseTimeout(process.env.EXPO_PUBLIC_AI_TIMEOUT_MS, 150000);
// Only GET is safe to retry automatically — POST/PATCH/DELETE could double-apply a
// mutation (e.g. double-count a picked quantity) if the request actually succeeded
// server-side but the response was lost to the network drop.
const GET_RETRY_ATTEMPTS = 2;
const GET_RETRY_DELAY_MS = 800;

function parseTimeout(raw: string | undefined, fallback: number): number {
  const value = Number(raw);
  return Number.isFinite(value) && value >= 1000 ? value : fallback;
}

/**
 * - network: the request never got a response (offline, DNS, refused).
 * - timeout: no response within the budget — for a write the server may still have applied it.
 * - aborted: the caller cancelled (screen left, newer request started).
 * - http: the server answered with a non-2xx status.
 */
export type ApiErrorKind = 'network' | 'timeout' | 'aborted' | 'http';

export class ApiError extends Error {
  status: number;
  kind: ApiErrorKind;
  /** True when a write may or may not have reached the server — never report it as a plain failure. */
  outcomeUnknown: boolean;
  code: string | null;
  /** The error response body (e.g. attempts_remaining / retry_after_seconds of an OTP error). */
  details: Record<string, unknown> | null;

  constructor(status: number, message: string, kind: ApiErrorKind = 'http', outcomeUnknown = false, code: string | null = null, details: Record<string, unknown> | null = null) {
    super(message);
    this.status = status;
    this.kind = kind;
    this.outcomeUnknown = outcomeUnknown;
    this.code = code;
    this.details = details;
  }
}

export function isOutcomeUnknown(error: unknown): boolean {
  return error instanceof ApiError && error.outcomeUnknown;
}

export function isAbortError(error: unknown): boolean {
  return error instanceof ApiError && error.kind === 'aborted';
}

let onUnauthorized: (() => void) | null = null;

export function setUnauthorizedHandler(handler: (() => void) | null) {
  onUnauthorized = handler;
}

/**
 * - token: the new access token.
 * - invalid: the session is really over (no/expired/revoked refresh token) — log out.
 * - transient: could not reach the auth service — keep the session, let the user retry.
 */
export type RefreshOutcome = { token: string } | { failed: 'invalid' | 'transient' };
type RefreshHandler = () => Promise<RefreshOutcome>;
let onRefreshToken: RefreshHandler | null = null;

/** Registered by AuthProvider: exchanges the stored refresh token (single-flight). */
export function setRefreshHandler(handler: RefreshHandler | null) {
  onRefreshToken = handler;
}

// Backend auth middlewares (auth/inventory/borrow-service) return 401 only when the
// Authorization header itself is missing/malformed, but 403 for an expired or invalid
// token — the same status code legitimate permission-denied errors also use (e.g.
// "Forbidden", "Task is assigned to another picker"). Matching on these exact messages
// is how we tell "your session is dead, log in again" apart from "you can't do that".
const AUTH_FAILURE_MESSAGES = new Set([
  'Token expired',
  'Invalid token',
  'Token revoked',
  'Token has been revoked',
  'Authorization header is required',
  'Invalid authorization format. Use Bearer <token>',
]);

export function isAuthFailure(status: number, message: string): boolean {
  return status === 401 || (status === 403 && AUTH_FAILURE_MESSAGES.has(message));
}

type ApiFetchOptions = {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  skipAuth?: boolean;
  headers?: Record<string, string>;
  timeoutMs?: number;
  signal?: AbortSignal;
};

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

type FetchFailure = { failure: 'timeout' | 'aborted' | 'network' };

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number, external?: AbortSignal): Promise<Response | FetchFailure> {
  if (external?.aborted) return { failure: 'aborted' };
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const forwardAbort = () => controller.abort();
  external?.addEventListener('abort', forwardAbort);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch {
    if (timedOut) return { failure: 'timeout' };
    if (external?.aborted) return { failure: 'aborted' };
    return { failure: 'network' };
  } finally {
    clearTimeout(timer);
    external?.removeEventListener('abort', forwardAbort);
  }
}

function parseBody(text: string): any {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    // A proxy error page (HTML) or a truncated body — not something to show the user.
    return null;
  }
}

function describeHttpError(status: number, data: any): string {
  const message = data?.message ?? data?.detail ?? data?.error;
  if (typeof message === 'string' && message.trim()) return message;
  if (status === 429) return 'Bạn thao tác quá nhanh, vui lòng thử lại sau ít phút.';
  if (status >= 500) return `Máy chủ đang gặp sự cố (${status}). Vui lòng thử lại sau.`;
  return `Yêu cầu không thành công (${status})`;
}

function failureError(failure: FetchFailure['failure'], method: string): ApiError {
  const isWrite = method !== 'GET';
  if (failure === 'aborted') return new ApiError(0, 'Đã hủy yêu cầu.', 'aborted');
  if (failure === 'timeout') {
    return isWrite
      ? new ApiError(0, 'Máy chủ phản hồi quá lâu — chưa rõ thao tác đã được ghi nhận hay chưa. Hãy kiểm tra lại trước khi thử lại.', 'timeout', true)
      : new ApiError(0, 'Máy chủ phản hồi quá lâu. Vui lòng thử lại.', 'timeout');
  }
  return isWrite
    ? new ApiError(0, 'Mất kết nối khi đang gửi — chưa rõ thao tác đã được ghi nhận hay chưa. Hãy kiểm tra lại trước khi thử lại.', 'network', true)
    : new ApiError(0, 'Mất kết nối mạng. Vui lòng kiểm tra Internet và thử lại.', 'network');
}

async function send(path: string, options: ApiFetchOptions, token: string | null): Promise<Response | FetchFailure> {
  // FormData (multipart uploads, e.g. cover-photo search) must not be JSON-encoded,
  // and must not get an explicit Content-Type — fetch sets its own multipart
  // boundary from the FormData instance itself.
  const isFormData = typeof FormData !== 'undefined' && options.body instanceof FormData;
  const headers: Record<string, string> = isFormData
    ? { ...options.headers }
    : { 'Content-Type': 'application/json', ...options.headers };
  if (token) headers.Authorization = `Bearer ${token}`;

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
  let result: Response | FetchFailure = { failure: 'network' };
  for (let attempt = 1; attempt <= attempts; attempt++) {
    result = await fetchWithTimeout(`${BASE_URL}${path}`, init, options.timeoutMs ?? DEFAULT_TIMEOUT_MS, options.signal);
    // Only a dropped connection is worth an automatic retry: a timeout already
    // spent the whole budget, and an abort was the caller's choice.
    if (!('failure' in result) || result.failure !== 'network' || attempt === attempts) break;
    await sleep(GET_RETRY_DELAY_MS);
  }
  if (!('failure' in result)) reportRequestOutcome('reachable');
  else if (result.failure !== 'aborted') reportRequestOutcome('unreachable');
  return result;
}

/** Cheap reachability probe for the offline banner's "Thử lại" (gateway /health, no auth). */
export async function probeApi(): Promise<boolean> {
  const result = await fetchWithTimeout(`${BASE_URL}/health`, { method: 'GET' }, 5000);
  const reachable = !('failure' in result);
  reportRequestOutcome(reachable ? 'reachable' : 'unreachable');
  return reachable;
}

export async function apiFetch<T>(path: string, options: ApiFetchOptions = {}): Promise<T> {
  const method = options.method ?? 'GET';
  let token = options.skipAuth ? null : await getToken();
  let response = await send(path, options, token);
  if ('failure' in response) throw failureError(response.failure, method);

  let data = parseBody(await response.text());

  if (!response.ok && !options.skipAuth && token && isAuthFailure(response.status, describeHttpError(response.status, data)) && onRefreshToken) {
    // One refresh attempt per request: the access token is short-lived, the refresh
    // token rotates. A request is replayed only after the server rejected it as
    // unauthenticated, so it was never applied — replaying a write is safe here.
    const outcome: RefreshOutcome = await onRefreshToken().catch(() => ({ failed: 'transient' as const }));
    if ('token' in outcome) {
      token = outcome.token;
      response = await send(path, options, token);
      if ('failure' in response) throw failureError(response.failure, method);
      data = parseBody(await response.text());
    } else if (outcome.failed === 'transient') {
      // The request was rejected before it ran, so nothing was applied; the session may
      // still be renewable once the network is back — do not throw the user out.
      throw new ApiError(0, 'Không làm mới được phiên đăng nhập do mất kết nối. Vui lòng thử lại.', 'network');
    }
  }

  if (!response.ok) {
    const message = describeHttpError(response.status, data);
    if (!options.skipAuth && isAuthFailure(response.status, message)) {
      onUnauthorized?.();
    }
    throw new ApiError(response.status, message, 'http', false, typeof data?.code === 'string' ? data.code : null, data && typeof data === 'object' ? data : null);
  }

  return data as T;
}
