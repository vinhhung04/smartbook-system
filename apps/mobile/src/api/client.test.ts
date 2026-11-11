import { ApiError, apiFetch, isOutcomeUnknown, setRefreshHandler, setUnauthorizedHandler } from './client';

// jest.mock calls are hoisted above the import by babel-jest.
jest.mock('../auth/token-storage', () => ({ getToken: jest.fn(async () => 'old-token') }));
jest.mock('./config', () => ({ resolveApiBaseUrl: () => 'https://api.test' }));


type FetchMock = jest.Mock<Promise<Response>, [string, RequestInit]>;

function jsonResponse(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) } as Response;
}

function textResponse(status: number, body: string): Response {
  return { ok: status >= 200 && status < 300, status, text: async () => body } as Response;
}

function hangingFetch(_url: string, init: RequestInit): Promise<Response> {
  return new Promise((_resolve, reject) => {
    init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
  });
}

let fetchMock: FetchMock;

beforeEach(() => {
  fetchMock = jest.fn();
  (globalThis as any).fetch = fetchMock;
  setRefreshHandler(null);
  setUnauthorizedHandler(null);
});

describe('apiFetch', () => {
  it('returns parsed JSON and sends the bearer token', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { ok: 1 }));
    await expect(apiFetch('/x')).resolves.toEqual({ ok: 1 });
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.test/x');
    expect((fetchMock.mock.calls[0][1].headers as Record<string, string>).Authorization).toBe('Bearer old-token');
  });

  it('classifies a timeout on a write as outcome-unknown and never retries it', async () => {
    fetchMock.mockImplementation(hangingFetch);
    const error: any = await apiFetch('/write', { method: 'POST', body: {}, timeoutMs: 20 }).catch((e: any) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error.kind).toBe('timeout');
    expect(isOutcomeUnknown(error)).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('treats a timed-out read as a plain timeout without retrying', async () => {
    fetchMock.mockImplementation(hangingFetch);
    const error: any = await apiFetch('/read', { timeoutMs: 20 }).catch((e: any) => e);
    expect(error.kind).toBe('timeout');
    expect(error.outcomeUnknown).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries a read after a dropped connection, then succeeds', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Network request failed')).mockResolvedValueOnce(jsonResponse(200, { ok: 2 }));
    await expect(apiFetch('/read')).resolves.toEqual({ ok: 2 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('marks a dropped write as outcome-unknown', async () => {
    fetchMock.mockRejectedValue(new TypeError('Network request failed'));
    const error: any = await apiFetch('/write', { method: 'PATCH' }).catch((e: any) => e);
    expect(error.kind).toBe('network');
    expect(error.outcomeUnknown).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('reports a caller abort as aborted', async () => {
    fetchMock.mockImplementation(hangingFetch);
    const controller = new AbortController();
    const pending = apiFetch('/read', { signal: controller.signal, timeoutMs: 5000 }).catch((e: any) => e);
    controller.abort();
    const error: any = await pending;
    expect(error.kind).toBe('aborted');
  });

  it('turns an HTML proxy error page into a readable server error', async () => {
    fetchMock.mockResolvedValue(textResponse(502, '<html>Bad Gateway</html>'));
    const error: any = await apiFetch('/x').catch((e: any) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(502);
    expect(error.message).toContain('Máy chủ');
  });

  it('refreshes once on an expired token and replays the request', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(403, { message: 'Token expired' }))
      .mockResolvedValueOnce(jsonResponse(200, { ok: 3 }));
    const refresh = jest.fn(async () => ({ token: 'new-token' }));
    setRefreshHandler(refresh);
    await expect(apiFetch('/x', { method: 'POST', body: {} })).resolves.toEqual({ ok: 3 });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect((fetchMock.mock.calls[1][1].headers as Record<string, string>).Authorization).toBe('Bearer new-token');
  });

  it('logs out when the refresh fails', async () => {
    fetchMock.mockResolvedValue(jsonResponse(403, { message: 'Token expired' }));
    setRefreshHandler(async () => ({ failed: 'invalid' as const }));
    const unauthorized = jest.fn();
    setUnauthorizedHandler(unauthorized);
    const error: any = await apiFetch('/x').catch((e: any) => e);
    expect(error.status).toBe(403);
    expect(unauthorized).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('keeps the session when the refresh only failed for lack of network', async () => {
    fetchMock.mockResolvedValue(jsonResponse(403, { message: 'Token expired' }));
    setRefreshHandler(async () => ({ failed: 'transient' as const }));
    const unauthorized = jest.fn();
    setUnauthorizedHandler(unauthorized);
    const error: any = await apiFetch('/x').catch((e: any) => e);
    expect(error.kind).toBe('network');
    expect(unauthorized).not.toHaveBeenCalled();
  });

  it('does not treat a permission 403 as a dead session', async () => {
    fetchMock.mockResolvedValue(jsonResponse(403, { message: 'Forbidden' }));
    const refresh = jest.fn(async () => ({ token: 'new-token' }));
    const unauthorized = jest.fn();
    setRefreshHandler(refresh);
    setUnauthorizedHandler(unauthorized);
    await apiFetch('/x').catch(() => undefined);
    expect(refresh).not.toHaveBeenCalled();
    expect(unauthorized).not.toHaveBeenCalled();
  });
});
