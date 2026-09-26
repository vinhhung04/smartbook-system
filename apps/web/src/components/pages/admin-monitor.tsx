import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, ChevronDown, RefreshCw, XCircle } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { PageWrapper, FadeItem } from '@/components/motion-utils';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { LoadingOverlay } from '@/components/ui/loading-state';
import { SectionCard } from '@/components/ui/section-card';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/components/ui/utils';
import { monitorService, type MonitorServiceHealth, type MonitorSnapshot, type MonitorStatus } from '@/services/monitor';
import { useSocket } from '@/lib/socket';
import { toast } from 'sonner';

const AUTO_REFRESH_MS = 30000;
const HISTORY_LENGTH = 30;

type Check = { status: MonitorStatus; latencyMs: number | null; checkedAt: string };

const STATUS_META: Record<MonitorStatus, { label: string; icon: typeof CheckCircle2; text: string; fill: string; description: string }> = {
  ok: { label: 'Hoạt động', icon: CheckCircle2, text: 'text-emerald-600 dark:text-emerald-400', fill: 'bg-emerald-500', description: 'Phản hồi bình thường' },
  degraded: { label: 'Suy giảm', icon: AlertTriangle, text: 'text-amber-600 dark:text-amber-400', fill: 'bg-amber-500', description: 'Có phản hồi nhưng một dependency bất thường' },
  down: { label: 'Ngừng', icon: XCircle, text: 'text-rose-600 dark:text-rose-400', fill: 'bg-rose-500', description: 'Không lấy được health check' },
};

function latencyTone(ms: number | null) {
  if (ms == null) return 'text-muted-foreground';
  if (ms < 200) return 'text-foreground';
  if (ms < 800) return 'text-amber-600 dark:text-amber-400';
  return 'text-rose-600 dark:text-rose-400';
}

function formatTime(value?: string | null) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date(value));
}

function formatLatency(value: number | null) {
  return typeof value === 'number' ? `${value.toLocaleString('vi-VN')} ms` : '—';
}

function formatUptime(seconds: number) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days} ngày ${hours} giờ`;
  if (hours > 0) return `${hours} giờ ${minutes} phút`;
  return `${minutes} phút`;
}

function getOverallStatus(snapshot: MonitorSnapshot): MonitorStatus {
  if (snapshot.summary.down > 0) return 'down';
  if (snapshot.summary.degraded > 0) return 'degraded';
  return 'ok';
}

function overallHeadline(snapshot: MonitorSnapshot) {
  const { total, down, degraded } = snapshot.summary;
  if (down > 0) return `${down} / ${total} dịch vụ đang ngừng hoạt động`;
  if (degraded > 0) return `${degraded} / ${total} dịch vụ đang suy giảm`;
  return 'Tất cả dịch vụ hoạt động bình thường';
}

function getDependencyRows(service: MonitorServiceHealth) {
  const response = service.response || {};
  const rows: Array<{ label: string; value: string; healthy: boolean | null }> = [];
  const push = (label: string, value: unknown, healthy: boolean | null = null) => rows.push({ label, value: String(value), healthy });

  if (typeof response.version === 'string') push('Phiên bản', response.version);
  if (typeof response.redis === 'string') push('Redis', response.redis, response.redis.toLowerCase() === 'connected');
  const databases = response.databases;
  if (typeof databases === 'object' && databases && !Array.isArray(databases)) {
    Object.entries(databases as Record<string, unknown>).forEach(([key, value]) => push(`Database ${key}`, value, String(value).toLowerCase() === 'ok'));
  }
  if (typeof response.llm_provider === 'string') push('Nhà cung cấp LLM', response.llm_provider);
  if (typeof response.model === 'string') push('Model văn bản', response.model);
  if (typeof response.assistant_model === 'string') push('Model trợ lý', response.assistant_model);
  if (typeof response.vision_model === 'string') push('Model thị giác', response.vision_model);
  if (typeof response.embed_model === 'string') push('Model embedding', response.embed_model);
  if (typeof response.connected_sockets === 'number') push('Socket đang kết nối', response.connected_sockets);
  if (typeof response.uptime_seconds === 'number') push('Thời gian chạy', formatUptime(response.uptime_seconds));
  return rows;
}

function HistoryStrip({ checks, name }: { checks: Check[]; name: string }) {
  const slots = Array.from({ length: HISTORY_LENGTH }, (_, index) => checks[checks.length - HISTORY_LENGTH + index] ?? null);
  const failures = checks.filter((check) => check.status !== 'ok').length;
  return (
    <div
      className="flex h-6 items-stretch gap-[2px]"
      role="img"
      aria-label={`${name}: ${checks.length} lần kiểm tra, ${failures} lần bất thường`}
    >
      {slots.map((check, index) => (
        <span
          key={index}
          className={cn('w-1.5 rounded-[2px]', check ? STATUS_META[check.status].fill : 'bg-muted')}
          title={check ? `${formatTime(check.checkedAt)} · ${STATUS_META[check.status].label} · ${formatLatency(check.latencyMs)}` : undefined}
        />
      ))}
    </div>
  );
}

function ServiceRow({ service, checks, expanded, onToggle }: {
  service: MonitorServiceHealth;
  checks: Check[];
  expanded: boolean;
  onToggle: () => void;
}) {
  const shouldReduceMotion = useReducedMotion();
  const meta = STATUS_META[service.status];
  const Icon = meta.icon;
  const dependencies = getDependencyRows(service);
  const panelId = `monitor-detail-${service.id}`;

  return (
    <li className="border-b border-border last:border-0">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        aria-controls={panelId}
        className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-6 gap-y-3 px-5 py-4 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/30 lg:grid-cols-[minmax(0,1fr)_auto_auto_auto]"
      >
        <span className="flex min-w-0 items-start gap-3">
          <Icon className={cn('mt-0.5 h-5 w-5 shrink-0', meta.text)} aria-hidden="true" />
          <span className="min-w-0">
            <span className="block text-[14px] font-semibold text-foreground">{service.name}</span>
            <span className="block truncate text-[12px] text-muted-foreground">{service.description}</span>
          </span>
        </span>
        <span className="order-last col-span-2 lg:order-none lg:col-span-1">
          <HistoryStrip checks={checks} name={service.name} />
        </span>
        <span className="hidden text-right lg:block">
          <span className={cn('block text-[13px] font-semibold tabular-nums', latencyTone(service.latencyMs))}>{formatLatency(service.latencyMs)}</span>
          <span className={cn('block text-[12px]', meta.text)}>{meta.label}</span>
        </span>
        <span className="flex items-center gap-3">
          <span className="text-right lg:hidden">
            <span className={cn('block text-[13px] font-semibold tabular-nums', latencyTone(service.latencyMs))}>{formatLatency(service.latencyMs)}</span>
            <span className={cn('block text-[12px]', meta.text)}>{meta.label}</span>
          </span>
          <ChevronDown className={cn('h-4 w-4 text-muted-foreground transition-transform', expanded && 'rotate-180')} aria-hidden="true" />
        </span>
      </button>

      <AnimatePresence initial={false}>
        {expanded ? (
          <motion.div
            id={panelId}
            initial={shouldReduceMotion ? false : { height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={shouldReduceMotion ? undefined : { height: 0, opacity: 0 }}
            transition={{ duration: shouldReduceMotion ? 0 : 0.2, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden"
          >
            <div className="grid gap-5 px-5 pb-5 lg:grid-cols-2 lg:pl-13">
              <dl className="space-y-2 text-[13px]">
                <div className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">Endpoint</dt>
                  <dd className="truncate font-mono text-[12px] text-foreground" title={service.url}>{service.url}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">Kiểm tra lúc</dt>
                  <dd className="tabular-nums text-foreground">{formatTime(service.checkedAt)}</dd>
                </div>
                {dependencies.map((row) => (
                  <div key={row.label} className="flex justify-between gap-4">
                    <dt className="text-muted-foreground">{row.label}</dt>
                    <dd className={cn('truncate', row.healthy === false ? 'font-medium text-rose-600 dark:text-rose-400' : 'text-foreground')} title={row.value}>{row.value}</dd>
                  </div>
                ))}
                {service.error ? (
                  <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] text-rose-700 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-300">{service.error}</p>
                ) : dependencies.length === 0 ? (
                  <p className="text-[12px] text-muted-foreground">{meta.description}</p>
                ) : null}
              </dl>
              <div className="min-w-0">
                <p className="mb-1.5 text-[12px] text-muted-foreground">Response gốc</p>
                <pre className="max-h-56 overflow-auto rounded-lg bg-muted/60 px-3 py-2.5 font-mono text-[12px] leading-5 text-foreground">
                  {service.response ? JSON.stringify(service.response, null, 2) : 'Không có nội dung'}
                </pre>
              </div>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </li>
  );
}

export function AdminMonitorPage() {
  const [snapshot, setSnapshot] = useState<MonitorSnapshot | null>(null);
  const [history, setHistory] = useState<Record<string, Check[]>>({});
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
      setHistory((prev) => {
        const next = { ...prev };
        for (const service of nextSnapshot.services) {
          next[service.id] = [...(prev[service.id] || []), { status: service.status, latencyMs: service.latencyMs, checkedAt: service.checkedAt }].slice(-HISTORY_LENGTH);
        }
        return next;
      });
      // A failing service opens itself so the error is visible without a click.
      setExpandedIds((prev) => {
        const failing = nextSnapshot.services.filter((service) => service.status !== 'ok').map((service) => service.id);
        return failing.length ? new Set([...prev, ...failing]) : prev;
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Không thể tải dữ liệu giám sát.';
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

  const overall = snapshot ? getOverallStatus(snapshot) : null;
  const OverallIcon = overall ? STATUS_META[overall].icon : CheckCircle2;
  const checksSoFar = Math.max(0, ...Object.values(history).map((checks) => checks.length));

  return (
    <PageWrapper className="space-y-5">
      <FadeItem>
        <header className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex items-start gap-3">
            <span
              className={cn(
                'flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border',
                overall === 'down' ? 'border-rose-200 bg-rose-50 dark:border-rose-500/25 dark:bg-rose-500/10'
                  : overall === 'degraded' ? 'border-amber-200 bg-amber-50 dark:border-amber-500/25 dark:bg-amber-500/10'
                    : 'border-emerald-200 bg-emerald-50 dark:border-emerald-500/25 dark:bg-emerald-500/10',
              )}
              aria-hidden="true"
            >
              <OverallIcon className={cn('h-5 w-5', overall ? STATUS_META[overall].text : 'text-muted-foreground')} />
            </span>
            <div>
              <h1 className="text-xl font-semibold tracking-tight text-foreground" aria-live="polite">
                {snapshot ? overallHeadline(snapshot) : 'Giám sát hệ thống'}
              </h1>
              <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-muted-foreground">
                <span>Kiểm tra lúc <span className="tabular-nums text-foreground">{formatTime(snapshot?.checkedAt)}</span></span>
                <span aria-hidden="true">·</span>
                <span className="inline-flex items-center gap-1.5">
                  <span className={cn('h-1.5 w-1.5 rounded-full', connected ? 'bg-emerald-500' : 'bg-amber-500')} aria-hidden="true" />
                  Realtime {connected ? 'đã kết nối' : 'mất kết nối'}
                </span>
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <label className="inline-flex cursor-pointer items-center gap-2 text-[13px] text-foreground">
              <Switch checked={autoRefresh} onCheckedChange={setAutoRefresh} aria-label="Tự động kiểm tra mỗi 30 giây" />
              Tự động mỗi 30 giây
            </label>
            <Button type="button" variant="outline" onClick={() => void loadSnapshot(true)} loading={refreshing} loadingLabel="Đang kiểm tra lại">
              <RefreshCw className="h-4 w-4" />
              Kiểm tra ngay
            </Button>
          </div>
        </header>
      </FadeItem>

      {loading ? (
        <SectionCard>
          <LoadingOverlay />
        </SectionCard>
      ) : error && !snapshot ? (
        <SectionCard>
          <EmptyState
            variant="error"
            title="Không thể tải dữ liệu giám sát"
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
        <FadeItem>
          <section aria-labelledby="services-title" className="overflow-hidden rounded-xl border border-border bg-card">
            <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-b border-border px-5 py-3.5">
              <h2 id="services-title" className="text-[14px] font-semibold text-foreground">
                Dịch vụ <span className="font-normal text-muted-foreground">· {snapshot.summary.ok}/{snapshot.summary.total} hoạt động</span>
              </h2>
              <p className="text-[12px] text-muted-foreground">
                Độ trễ trung bình <span className="font-semibold tabular-nums text-foreground">{formatLatency(snapshot.summary.averageLatencyMs)}</span>
                <span aria-hidden="true"> · </span>
                {checksSoFar} / {HISTORY_LENGTH} lần kiểm tra gần nhất trong phiên này
              </p>
            </div>
            <ul>
              {snapshot.services.map((service) => (
                <ServiceRow
                  key={service.id}
                  service={service}
                  checks={history[service.id] || []}
                  expanded={expandedIds.has(service.id)}
                  onToggle={() => toggleExpanded(service.id)}
                />
              ))}
            </ul>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border px-5 py-3 text-[12px] text-muted-foreground">
              {(Object.keys(STATUS_META) as MonitorStatus[]).map((status) => (
                <span key={status} className="inline-flex items-center gap-1.5">
                  <span className={cn('h-2.5 w-1.5 rounded-[2px]', STATUS_META[status].fill)} aria-hidden="true" />
                  {STATUS_META[status].label}
                </span>
              ))}
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-1.5 rounded-[2px] bg-muted" aria-hidden="true" />
                Chưa kiểm tra
              </span>
              <span className="ml-auto">Độ trễ: dưới 200 ms là tốt, trên 800 ms là chậm</span>
            </div>
            {!snapshot.detailed ? (
              <p className="flex items-start gap-2 border-t border-border bg-muted/30 px-5 py-3 text-[12px] text-muted-foreground">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" aria-hidden="true" />
                Không lấy được chi tiết từng dịch vụ (cần quyền quản trị) — đang hiển thị kiểm tra công khai gộp.
              </p>
            ) : null}
          </section>
        </FadeItem>
      ) : (
        <SectionCard>
          <EmptyState variant="no-data" title="Chưa có dữ liệu giám sát" description="Bấm “Kiểm tra ngay” để kiểm tra các dịch vụ." />
        </SectionCard>
      )}
    </PageWrapper>
  );
}
