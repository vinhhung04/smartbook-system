import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Cpu,
  Database,
  RefreshCw,
  Server,
  ShieldCheck,
  Timer,
  Wifi,
  XCircle,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Wifi as WifiData, WifiOff as WifiOffData } from 'lucide'; // icon data (not components) — MorphIcon needs this, not lucide-react
import { MorphIcon } from 'morphicons/react';
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

const HEADER_TONE: Record<MonitorStatus, string> = {
  ok: 'border-border bg-card',
  degraded: 'border-amber-200/70 bg-amber-50/40 dark:border-amber-500/20 dark:bg-amber-500/[0.06]',
  down: 'border-rose-200/80 bg-rose-50/50 dark:border-rose-500/25 dark:bg-rose-500/[0.06]',
};

const CARD_ACCENT_TONE: Record<MonitorStatus, string> = {
  ok: 'border-l-emerald-500',
  degraded: 'border-l-amber-500',
  down: 'border-l-rose-500',
};

const BAR_SEGMENT_TONE: Record<MonitorStatus, string> = {
  ok: 'bg-emerald-500',
  degraded: 'bg-amber-500',
  down: 'bg-rose-500',
};

function getLatencyTone(ms: number | null) {
  if (ms == null) return 'bg-muted-foreground/40';
  if (ms < 200) return 'bg-emerald-500';
  if (ms < 800) return 'bg-amber-500';
  return 'bg-rose-500';
}

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
      className={`rounded-xl border border-l-4 border-border bg-card p-4 shadow-[0_1px_2px_rgba(0,0,0,0.03)] transition-shadow hover:shadow-[0_3px_14px_rgba(15,23,42,0.08)] dark:hover:shadow-none ${CARD_ACCENT_TONE[service.status]}`}
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
          <p className="mt-1 flex items-center gap-1.5 font-semibold text-foreground">
            <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${getLatencyTone(service.latencyMs)}`} />
            {formatLatency(service.latencyMs)}
          </p>
        </div>
        <div className="rounded-lg bg-muted/45 px-3 py-2">
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <MorphIcon icon={service.status === 'down' ? WifiOffData : WifiData} className="h-3.5 w-3.5" />
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

function LegendStat({ status, value }: { status: MonitorStatus; value: number }) {
  const meta = STATUS_META[status];
  return (
    <span className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground">
      <span className={`h-2 w-2 rounded-full ${BAR_SEGMENT_TONE[status]}`} />
      {meta.label} <span className="font-semibold text-foreground">{value}</span>
    </span>
  );
}

function HealthOverview({ summary }: { summary: MonitorSnapshot['summary'] }) {
  const { total, ok, degraded, down, averageLatencyMs } = summary;
  const pct = (value: number) => (total > 0 ? (value / total) * 100 : 0);

  return (
    <div className="rounded-xl border border-border bg-card px-5 py-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <div>
            <p className="text-[12px] text-muted-foreground">Services</p>
            <p className="text-2xl font-semibold tracking-tight text-foreground">{total}</p>
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
            <LegendStat status="ok" value={ok} />
            <LegendStat status="degraded" value={degraded} />
            <LegendStat status="down" value={down} />
          </div>
        </div>
        <div className="text-right">
          <p className="text-[12px] text-muted-foreground">Avg latency</p>
          <p className="text-lg font-semibold text-foreground">{formatLatency(averageLatencyMs)}</p>
        </div>
      </div>

      <div className="mt-3 flex h-2 w-full overflow-hidden rounded-full bg-muted">
        {total > 0 ? (
          <>
            <div className={BAR_SEGMENT_TONE.ok} style={{ width: `${pct(ok)}%` }} />
            <div className={BAR_SEGMENT_TONE.degraded} style={{ width: `${pct(degraded)}%` }} />
            <div className={BAR_SEGMENT_TONE.down} style={{ width: `${pct(down)}%` }} />
          </>
        ) : null}
      </div>
    </div>
  );
}

export function AdminMonitorPage() {
  const [snapshot, setSnapshot] = useState<MonitorSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const { connected } = useSocket();

  const toggleExpanded = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

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
        <section className={`rounded-xl border px-5 py-5 shadow-[0_1px_2px_rgba(0,0,0,0.03)] transition-colors ${HEADER_TONE[overallStatus]}`}>
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-start gap-3">
              <div className={`relative flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border ${overallMeta.tone}`}>
                {overallStatus === 'down' && (
                  <span className="absolute -right-1 -top-1 flex h-3 w-3">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-rose-400 opacity-75" />
                    <span className="relative inline-flex h-3 w-3 rounded-full bg-rose-500" />
                  </span>
                )}
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
                <MorphIcon icon={autoRefresh ? WifiData : WifiOffData} className="h-4 w-4" />
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
              <MorphIcon icon={connected ? WifiData : WifiOffData} className={`h-3.5 w-3.5 ${connected ? 'text-emerald-600' : 'text-amber-600'}`} />
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
            <HealthOverview summary={snapshot.summary} />
          </FadeItem>

          <FadeItem>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {snapshot.services.map((service) => (
                <ServiceCard key={service.id} service={service} />
              ))}
            </div>
          </FadeItem>

          <FadeItem>
            <SectionCard title="Chi tiết health response" subtitle="Bấm vào từng service để xem response gốc từ health endpoint" icon={Activity} noPadding>
              <div>
                {detailRows.map((service) => {
                  const isExpanded = expandedIds.has(service.id);
                  return (
                    <div key={service.id} className="border-b border-border/70 last:border-0">
                      <button
                        type="button"
                        onClick={() => toggleExpanded(service.id)}
                        className="flex w-full items-center justify-between gap-3 px-5 py-3 text-left text-[13px] transition-colors hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                        aria-expanded={isExpanded}
                      >
                        <div className="flex min-w-0 items-center gap-3">
                          <ChevronDown className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                          <span className="truncate font-medium text-foreground">{service.name}</span>
                          <StatusBadge status={service.status} />
                        </div>
                        <div className="hidden shrink-0 items-center gap-4 text-[12px] text-muted-foreground sm:flex">
                          <span className="flex items-center gap-1.5">
                            <span className={`h-1.5 w-1.5 rounded-full ${getLatencyTone(service.latencyMs)}`} />
                            {formatLatency(service.latencyMs)}
                          </span>
                          <span className="max-w-[220px] truncate" title={service.url}>{service.url}</span>
                        </div>
                      </button>
                      {isExpanded && (
                        <div className="px-5 pb-4 pl-12">
                          {service.error ? (
                            <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] text-rose-700 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-400">
                              {service.error}
                            </div>
                          ) : (
                            <pre className="max-h-64 overflow-auto rounded-lg bg-muted px-3 py-2 text-[12px] text-foreground">
                              {JSON.stringify(service.response || {}, null, 2)}
                            </pre>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
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
