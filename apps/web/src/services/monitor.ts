import { getToken } from './http-clients';

export type MonitorStatus = 'ok' | 'degraded' | 'down';

export interface MonitorServiceConfig {
  id: string;
  name: string;
  description: string;
  url: string;
}

export interface MonitorServiceHealth {
  id: string;
  name: string;
  description: string;
  url: string;
  status: MonitorStatus;
  latencyMs: number | null;
  checkedAt: string;
  response: Record<string, unknown> | null;
  error: string | null;
}

export interface MonitorSnapshot {
  checkedAt: string;
  /** false when the admin breakdown was unavailable and only public health boundaries were checked. */
  detailed: boolean;
  services: MonitorServiceHealth[];
  summary: {
    total: number;
    ok: number;
    degraded: number;
    down: number;
    averageLatencyMs: number | null;
  };
}

const TIMEOUT_MS = 5000;

const env = import.meta.env;

const GATEWAY_CONFIG: MonitorServiceConfig = {
  id: 'api-gateway',
  name: 'API Gateway',
  description: 'Cổng HTTP, WebSocket và phòng realtime',
  url: env.VITE_GATEWAY_HEALTH_URL || 'http://localhost:3000/health',
};

const SYSTEM_HEALTH_URL = env.VITE_GATEWAY_SYSTEM_HEALTH_URL || 'http://localhost:3000/system/health';

// Fallback when the caller cannot read the admin breakdown: the public, topology-free boundaries.
export const MONITOR_SERVICE_CONFIGS: MonitorServiceConfig[] = [
  {
    id: 'core-services',
    name: 'Dịch vụ lõi',
    description: 'Auth, inventory, borrow và analytics (kiểm tra gộp)',
    url: env.VITE_GATEWAY_READY_URL || 'http://localhost:3000/ready',
  },
  {
    id: 'ai-service',
    name: 'AI Service',
    description: 'Trợ lý AI, OCR và gợi ý metadata qua OpenRouter',
    url: env.VITE_AI_HEALTH_URL || 'http://localhost:3000/ai/health',
  },
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasUnhealthyDependency(response: Record<string, unknown>) {
  const redis = response.redis;
  if (typeof redis === 'string' && redis.toLowerCase() !== 'connected') {
    return true;
  }

  const databases = response.databases;
  if (isRecord(databases)) {
    return Object.values(databases).some((value) => String(value).toLowerCase() !== 'ok');
  }

  return false;
}

function normalizeStatus(httpOk: boolean, response: Record<string, unknown> | null): MonitorStatus {
  if (!httpOk) return 'down';
  if (!response) return 'degraded';

  const rawStatus = String(response.status || '').toLowerCase();
  if (rawStatus && !['ok', 'healthy', 'ready'].includes(rawStatus)) {
    return rawStatus === 'down' ? 'down' : 'degraded';
  }

  return hasUnhealthyDependency(response) ? 'degraded' : 'ok';
}

async function fetchServiceHealth(config: MonitorServiceConfig): Promise<MonitorServiceHealth> {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), TIMEOUT_MS);
  const startedAt = performance.now();
  const checkedAt = new Date().toISOString();

  try {
    const response = await fetch(config.url, {
      method: 'GET',
      signal: controller.signal,
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
      },
    });
    const latencyMs = Math.round(performance.now() - startedAt);
    let body: Record<string, unknown> | null = null;

    try {
      const parsed = await response.json();
      body = isRecord(parsed) ? parsed : { value: parsed };
    } catch {
      body = null;
    }

    return {
      ...config,
      status: normalizeStatus(response.ok, body),
      latencyMs,
      checkedAt,
      response: body,
      error: response.ok ? null : `HTTP ${response.status}`,
    };
  } catch (error) {
    const latencyMs = Math.round(performance.now() - startedAt);
    const isTimeout = error instanceof DOMException && error.name === 'AbortError';
    return {
      ...config,
      status: 'down',
      latencyMs,
      checkedAt,
      response: null,
      error: isTimeout ? `Request timed out after ${TIMEOUT_MS / 1000}s` : error instanceof Error ? error.message : 'Health check failed',
    };
  } finally {
    window.clearTimeout(timeoutId);
  }
}

function buildSummary(services: MonitorServiceHealth[]): MonitorSnapshot['summary'] {
  const latencyValues = services
    .map((service) => service.latencyMs)
    .filter((value): value is number => typeof value === 'number');

  return {
    total: services.length,
    ok: services.filter((service) => service.status === 'ok').length,
    degraded: services.filter((service) => service.status === 'degraded').length,
    down: services.filter((service) => service.status === 'down').length,
    averageLatencyMs: latencyValues.length
      ? Math.round(latencyValues.reduce((sum, value) => sum + value, 0) / latencyValues.length)
      : null,
  };
}

interface SystemHealthBreakdown {
  checked_at: string;
  gateway: { version: string; uptime_seconds: number; connected_sockets: number };
  services: Array<{
    id: string;
    name: string;
    description: string;
    status: 'ok' | 'down';
    latency_ms: number | null;
    error: string | null;
    details: unknown;
  }>;
}

/** Admin-only per-service breakdown measured by the gateway itself; null when unavailable or not permitted. */
async function fetchSystemBreakdown(): Promise<SystemHealthBreakdown | null> {
  const token = getToken();
  if (!token) return null;
  try {
    const response = await fetch(SYSTEM_HEALTH_URL, {
      cache: 'no-store',
      headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const body = await response.json();
    return isRecord(body) && Array.isArray(body.services) ? (body as unknown as SystemHealthBreakdown) : null;
  } catch {
    return null;
  }
}

export async function getSystemHealthSnapshot(): Promise<MonitorSnapshot> {
  const [gateway, breakdown] = await Promise.all([fetchServiceHealth(GATEWAY_CONFIG), fetchSystemBreakdown()]);
  const checkedAt = new Date().toISOString();

  let services: MonitorServiceHealth[];
  if (breakdown) {
    services = [
      { ...gateway, response: gateway.response ? { ...gateway.response, uptime_seconds: breakdown.gateway.uptime_seconds, connected_sockets: breakdown.gateway.connected_sockets } : gateway.response },
      ...breakdown.services.map((service) => {
        const details = isRecord(service.details) ? service.details : null;
        return {
          id: service.id,
          name: service.name,
          description: service.description,
          url: `Gateway → ${service.id}`,
          status: normalizeStatus(service.status === 'ok', details),
          latencyMs: service.latency_ms,
          checkedAt: breakdown.checked_at,
          response: details,
          error: service.error,
        };
      }),
    ];
  } else {
    services = [gateway, ...(await Promise.all(MONITOR_SERVICE_CONFIGS.map(fetchServiceHealth)))];
  }

  return {
    checkedAt,
    detailed: Boolean(breakdown),
    services,
    summary: buildSummary(services),
  };
}

export const monitorService = {
  getSystemHealthSnapshot,
};
