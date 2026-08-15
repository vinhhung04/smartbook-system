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

export const MONITOR_SERVICE_CONFIGS: MonitorServiceConfig[] = [
  {
    id: 'api-gateway',
    name: 'API Gateway',
    description: 'HTTP proxy, WebSocket gateway, realtime rooms',
    url: env.VITE_GATEWAY_HEALTH_URL || 'http://localhost:3000/health',
  },
  {
    id: 'core-services',
    name: 'Core Services',
    description: 'Auth, inventory, borrow and analytics readiness',
    url: env.VITE_GATEWAY_READY_URL || 'http://localhost:3000/ready',
  },
  {
    id: 'ai-service',
    name: 'AI Service',
    description: 'Assistant, OCR, Ollama-backed AI workflows',
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

export async function getSystemHealthSnapshot(): Promise<MonitorSnapshot> {
  const settled = await Promise.allSettled(MONITOR_SERVICE_CONFIGS.map(fetchServiceHealth));
  const checkedAt = new Date().toISOString();
  const services = settled.map((result, index) => {
    if (result.status === 'fulfilled') return result.value;

    const config = MONITOR_SERVICE_CONFIGS[index];
    return {
      ...config,
      status: 'down' as const,
      latencyMs: null,
      checkedAt,
      response: null,
      error: result.reason instanceof Error ? result.reason.message : 'Health check failed',
    };
  });

  return {
    checkedAt,
    services,
    summary: buildSummary(services),
  };
}

export const monitorService = {
  getSystemHealthSnapshot,
};
