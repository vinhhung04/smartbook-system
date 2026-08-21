import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Cpu,
  Database,
  RefreshCw,
  Server,
  ShieldCheck,
  Timer,
  Wifi,
  WifiOff,
  XCircle,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { motion } from 'motion/react';
import { PageWrapper, FadeItem } from '@/components/motion-utils';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { LoadingOverlay } from '@/components/ui/loading-state';
import { SectionCard } from '@/components/ui/section-card';
import { monitorService, type MonitorServiceHealth, type MonitorSnapshot, type MonitorStatus } from '@/services/monitor';
import { useSocket } from '@/lib/socket';
import { toast } from 'sonner';

const AUTO_REFRESH_MS = 30000;

const SERVICE_ICONS: Record<string, LucideIcon> = {
  'api-gateway': Wifi,
  'core-services': Server,
  'auth-service': ShieldCheck,
  'inventory-service': Database,
  'borrow-service': Server,
  'analytics-service': Activity,
  'ai-service': Cpu,
};

const STATUS_META: Record<MonitorStatus, { label: string; tone: string; icon: typeof CheckCircle2; description: string }> = {
  ok: {
    label: 'OK',
    tone: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-400',
    icon: CheckCircle2,
    description: 'Service phản hồi bình thường',
  },
  degraded: {
    label: 'Degraded',
    tone: 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-400',
    icon: AlertTriangle,
    description: 'Service phản hồi nhưng có dependency bất thường',
  },
  down: {
    label: 'Down',
    tone: 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-400',
    icon: XCircle,
    description: 'Không thể lấy health check',
  },
};

function formatDateTime(value?: string | null) {
  if (!value) return 'Chưa cập nhật';
  return new Intl.DateTimeFormat('vi-VN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(new Date(value));
}

function formatLatency(value: number | null) {
  return typeof value === 'number' ? `${value} ms` : 'N/A';
}

function getOverallStatus(snapshot: MonitorSnapshot | null): MonitorStatus {
  if (!snapshot) return 'degraded';
  if (snapshot.summary.down > 0) return 'down';
  if (snapshot.summary.degraded > 0) return 'degraded';
  return 'ok';
}

function getMetadataRows(service: MonitorServiceHealth) {
  const response = service.response || {};
  const rows: Array<{ label: string; value: string }> = [];

  if (typeof response.service === 'string') rows.push({ label: 'Service', value: response.service });
  if (typeof response.redis === 'string') rows.push({ label: 'Redis', value: response.redis });
  if (typeof response.model === 'string') rows.push({ label: 'Model', value: response.model });
  if (typeof response.ollama_host === 'string') rows.push({ label: 'Ollama', value: response.ollama_host });
  if (typeof response.connectedSockets === 'number') rows.push({ label: 'Sockets', value: String(response.connectedSockets) });

  const databases = response.databases;
  if (typeof databases === 'object' && databases && !Array.isArray(databases)) {
    Object.entries(databases as Record<string, unknown>).forEach(([key, value]) => {
      rows.push({ label: `DB ${key}`, value: String(value) });
    });
  }

  return rows;
}

function StatusBadge({ status }: { status: MonitorStatus }) {
  const meta = STATUS_META[status];
  const Icon = meta.icon;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] font-medium ${meta.tone}`}>
      <Icon className="h-3.5 w-3.5" />
      {meta.label}
    </span>
  );
}

function ServiceCard({ service }: { service: MonitorServiceHealth }) {
  const Icon = SERVICE_ICONS[service.id] || Server;
  const metadataRows = getMetadataRows(service);

  return (
    <motion.article
      whileHover={{ y: -2 }}
      transition={{ duration: 0.18 }}
      className="rounded-xl border border-border bg-card p-4 shadow-[0_1px_2px_rgba(0,0,0,0.03)] transition-shadow hover:shadow-[0_3px_14px_rgba(15,23,42,0.08)] dark:hover:shadow-none"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border bg-muted">
            <Icon className="h-5 w-5 text-muted-foreground" />
          </div>
          <div className="min-w-0">
            <h2 className="truncate text-[14px] font-semibold text-foreground">{service.name}</h2>
            <p className="mt-0.5 line-clamp-2 text-[12px] leading-5 text-muted-foreground">{service.description}</p>
          </div>
        </div>
        <StatusBadge status={service.status} />
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 text-[12px]">
        <div className="rounded-lg bg-muted/45 px-3 py-2">
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <Timer className="h-3.5 w-3.5" />
            Latency
          </div>
          <p className="mt-1 font-semibold text-foreground">{formatLatency(service.latencyMs)}</p>
        </div>
        <div className="rounded-lg bg-muted/45 px-3 py-2">
          <div className="flex items-center gap-1.5 text-muted-foreground">
            {service.status === 'down' ? <WifiOff className="h-3.5 w-3.5" /> : <Wifi className="h-3.5 w-3.5" />}
            Endpoint
          </div>
          <p className="mt-1 truncate font-semibold text-foreground" title={service.url}>{service.url.replace(/^https?:\/\//, '')}</p>
        </div>
      </div>

      <div className="mt-4 space-y-2">
        {service.error ? (
          <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] text-rose-700 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-400">
            {service.error}
          </div>
        ) : metadataRows.length ? (
          metadataRows.slice(0, 4).map((row) => (
            <div key={`${service.id}-${row.label}`} className="flex items-center justify-between gap-3 text-[12px]">
              <span className="text-muted-foreground">{row.label}</span>
              <span className="truncate font-medium text-foreground" title={row.value}>{row.value}</span>
            </div>
          ))
        ) : (
          <p className="text-[12px] text-muted-foreground">{STATUS_META[service.status].description}</p>
        )}
      </div>
    </motion.article>
  );
}

function SummaryTile({ label, value, icon: Icon, tone }: { label: string; value: string | number; icon: typeof CheckCircle2; tone: string }) {
  return (
    <div className="rounded-xl border border-border bg-card px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[12px] text-muted-foreground">{label}</span>
        <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${tone}`}>
          <Icon className="h-4 w-4" />
        </div>
      </div>
      <p className="mt-2 text-2xl font-semibold tracking-tight text-foreground">{value}</p>
    </div>
  );
}

export function AdminMonitorPage() {
  const [snapshot, setSnapshot] = useState<MonitorSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { connected } = useSocket();

  const loadSnapshot = useCallback(async (showSpinner = false) => {
    try {
      if (showSpinner) setRefreshing(true);
      setError(null);
      const nextSnapshot = await monitorService.getSystemHealthSnapshot();
      setSnapshot(nextSnapshot);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Không thể tải dữ liệu monitor.';
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadSnapshot();
  }, [loadSnapshot]);

  useEffect(() => {
    if (!autoRefresh) return;
    const intervalId = window.setInterval(() => void loadSnapshot(), AUTO_REFRESH_MS);
    return () => window.clearInterval(intervalId);
  }, [autoRefresh, loadSnapshot]);

  const overallStatus = getOverallStatus(snapshot);
  const overallMeta = STATUS_META[overallStatus];
  const OverallIcon = overallMeta.icon;
  const detailRows = useMemo(() => snapshot?.services || [], [snapshot?.services]);

  return (
    <PageWrapper className="space-y-5">
      <FadeItem>
        <section className="rounded-xl border border-border bg-card px-5 py-5 shadow-[0_1px_2px_rgba(0,0,0,0.03)]">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-start gap-3">
              <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border ${overallMeta.tone}`}>
                <OverallIcon className="h-5 w-5" />
              </div>
              <div>
                <p className="text-[12px] font-medium uppercase tracking-[0.08em] text-muted-foreground">Admin Monitor</p>
                <h1 className="mt-1 text-2xl font-semibold tracking-tight text-foreground">Giám sát hệ thống</h1>
                <p className="mt-1 text-[13px] text-muted-foreground">
                  Health check service, dependency và kết nối realtime của SmartBook.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setAutoRefresh((value) => !value)}
                className={`inline-flex h-9 items-center gap-2 rounded-lg border px-3 text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  autoRefresh ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-400' : 'border-border bg-background text-muted-foreground hover:bg-muted'
                }`}
                aria-pressed={autoRefresh}
              >
                {autoRefresh ? <Wifi className="h-4 w-4" /> : <WifiOff className="h-4 w-4" />}
                Auto 30s
              </button>
              <Button type="button" variant="outline" onClick={() => void loadSnapshot(true)} loading={refreshing} loadingLabel="Đang làm mới monitor">
                <RefreshCw className="h-4 w-4" />
                Làm mới
              </Button>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2 text-[12px] text-muted-foreground">
            <StatusBadge status={overallStatus} />
            <span>Lần cập nhật: {formatDateTime(snapshot?.checkedAt)}</span>
            <span className="hidden sm:inline">•</span>
            <span className="inline-flex items-center gap-1.5">
              {connected ? <Wifi className="h-3.5 w-3.5 text-emerald-600" /> : <WifiOff className="h-3.5 w-3.5 text-amber-600" />}
              WebSocket UI {connected ? 'connected' : 'not connected'}
            </span>
          </div>
        </section>
      </FadeItem>

      {loading ? (
        <SectionCard>
          <LoadingOverlay />
        </SectionCard>
      ) : error ? (
        <SectionCard>
          <EmptyState
            variant="error"
            title="Không thể tải monitor"
            description={error}
            action={
              <Button type="button" onClick={() => void loadSnapshot(true)}>
                <RefreshCw className="h-4 w-4" />
                Thử lại
              </Button>
            }
          />
        </SectionCard>
      ) : snapshot ? (
        <>
          <FadeItem>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
              <SummaryTile label="Services" value={snapshot.summary.total} icon={Server} tone="bg-muted text-muted-foreground" />
              <SummaryTile label="OK" value={snapshot.summary.ok} icon={CheckCircle2} tone="bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400" />
              <SummaryTile label="Degraded" value={snapshot.summary.degraded} icon={AlertTriangle} tone="bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400" />
              <SummaryTile label="Down" value={snapshot.summary.down} icon={XCircle} tone="bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-400" />
              <SummaryTile label="Avg latency" value={formatLatency(snapshot.summary.averageLatencyMs)} icon={Timer} tone="bg-sky-50 text-sky-700 dark:bg-sky-500/10 dark:text-sky-400" />
            </div>
          </FadeItem>

          <FadeItem>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {snapshot.services.map((service) => (
                <ServiceCard key={service.id} service={service} />
              ))}
            </div>
          </FadeItem>

          <FadeItem>
            <SectionCard title="Chi tiết health response" subtitle="Response gốc từ từng endpoint health để admin đối chiếu nhanh" icon={Activity} noPadding>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] text-left text-[13px]">
                  <thead className="border-b border-border bg-muted/30 text-[11px] uppercase text-muted-foreground">
                    <tr>
                      <th className="px-5 py-3 font-medium">Service</th>
                      <th className="px-5 py-3 font-medium">Status</th>
                      <th className="px-5 py-3 font-medium">Latency</th>
                      <th className="px-5 py-3 font-medium">Endpoint</th>
                      <th className="px-5 py-3 font-medium">Response / Error</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detailRows.map((service) => (
                      <tr key={service.id} className="border-b border-border/70 last:border-0 hover:bg-muted/30">
                        <td className="px-5 py-3 font-medium text-foreground">{service.name}</td>
                        <td className="px-5 py-3"><StatusBadge status={service.status} /></td>
                        <td className="px-5 py-3 text-muted-foreground">{formatLatency(service.latencyMs)}</td>
                        <td className="px-5 py-3">
                          <span className="block max-w-[220px] truncate text-muted-foreground" title={service.url}>{service.url}</span>
                        </td>
                        <td className="px-5 py-3">
                          <code className="block max-w-[360px] truncate rounded-md bg-muted px-2 py-1 text-[12px] text-foreground" title={service.error || JSON.stringify(service.response || {})}>
                            {service.error || JSON.stringify(service.response || {})}
                          </code>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </SectionCard>
          </FadeItem>
        </>
      ) : (
        <SectionCard>
          <EmptyState variant="no-data" title="Chưa có dữ liệu monitor" description="Bấm làm mới để kiểm tra health các service." />
        </SectionCard>
      )}
    </PageWrapper>
  );
}
