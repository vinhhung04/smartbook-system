// System overview from Prometheus. Only these fixed queries are ever sent: the
// client chooses nothing, so the endpoint is not a PromQL proxy.
const QUERIES = {
  cpu_percent: '100 * (1 - avg(rate(node_cpu_seconds_total{mode="idle"}[5m])))',
  memory_percent: '100 * (1 - node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes)',
  disk_percent: '100 * (1 - max(node_filesystem_avail_bytes{mountpoint="/",fstype!~"tmpfs|overlay"}) / max(node_filesystem_size_bytes{mountpoint="/",fstype!~"tmpfs|overlay"}))',
  host_uptime_seconds: 'time() - max(node_boot_time_seconds)',
  api_error_rate: 'sum(rate(http_server_request_duration_count{service_name="api-gateway",http_response_status_code=~"5.."}[5m])) / sum(rate(http_server_request_duration_count{service_name="api-gateway"}[5m]))',
  api_p95_ms: '1000 * histogram_quantile(0.95, sum(rate(http_server_request_duration_bucket{service_name="api-gateway"}[5m])) by (le))',
};
const SERVICE_QUERIES = {
  up: 'max by (service_name) (up)',
  request_rate: 'sum by (service_name) (rate(http_server_request_duration_count[5m]))',
  error_rate: 'sum by (service_name) (rate(http_server_request_duration_count{http_response_status_code=~"5.."}[5m])) / sum by (service_name) (rate(http_server_request_duration_count[5m]))',
  p95_ms: '1000 * histogram_quantile(0.95, sum by (le, service_name) (rate(http_server_request_duration_bucket[5m])))',
};

async function instant(baseUrl, query, fetchImpl) {
  const url = `${baseUrl.replace(/\/+$/, '')}/api/v1/query?query=${encodeURIComponent(query)}`;
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(3000) });
  if (!response.ok) throw new Error(`prometheus HTTP ${response.status}`);
  const body = await response.json();
  if (body.status !== 'success') throw new Error('prometheus query failed');
  return body.data.result;
}

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

async function prometheusOverview({ baseUrl = process.env.PROMETHEUS_URL, fetchImpl = fetch } = {}) {
  if (!baseUrl) return { available: false, reason: 'PROMETHEUS_URL_NOT_SET' };
  try {
    const host = {};
    await Promise.all(Object.entries(QUERIES).map(async ([key, query]) => {
      const result = await instant(baseUrl, query, fetchImpl);
      host[key] = result.length ? finite(result[0].value[1]) : null;
    }));
    const services = {};
    await Promise.all(Object.entries(SERVICE_QUERIES).map(async ([key, query]) => {
      for (const row of await instant(baseUrl, query, fetchImpl)) {
        const name = row.metric.service_name;
        if (!name) continue;
        (services[name] ??= {})[key] = finite(row.value[1]);
      }
    }));
    return { available: true, checked_at: new Date().toISOString(), host, services };
  } catch (error) {
    return { available: false, reason: error.name === 'TimeoutError' ? 'PROMETHEUS_TIMEOUT' : 'PROMETHEUS_UNAVAILABLE' };
  }
}

module.exports = { prometheusOverview, QUERIES, SERVICE_QUERIES };
