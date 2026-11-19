import { Link } from 'react-router';
import { AlertTriangle, ArrowRight } from 'lucide-react';
import { cn } from '@/components/ui/utils';
import type { MonitoringOverview } from '@/services/incidents';
import type { MonitorSnapshot } from '@/services/monitor';
import { EVENT_LABEL, SEVERITY_META, formatDateTime, formatDuration } from './incident-format';
import { SeverityBadge } from './incident-badges';

const PROMETHEUS_REASON: Record<string, string> = {
  PROMETHEUS_URL_NOT_SET: 'monitoring-service chưa được cấu hình địa chỉ Prometheus',
  PROMETHEUS_TIMEOUT: 'Prometheus không phản hồi trong 3 giây',
  PROMETHEUS_UNAVAILABLE: 'không kết nối được Prometheus (chưa chạy hoặc đang lỗi)',
};

function percent(value: number | null | undefined, digits = 1) {
  return typeof value === 'number' ? `${value.toLocaleString('vi-VN', { maximumFractionDigits: digits })}%` : null;
}

function Metric({ label, value, hint, tone }: { label: string; value: string | null; hint?: string; tone?: string }) {
  return (
    <div className="px-5 py-4">
      <dt className="text-[13px] text-muted-foreground">{label}</dt>
      <dd className={cn('mt-1 leading-tight tabular-nums', value ? cn('font-display text-[24px] font-semibold', tone || 'text-foreground') : 'pt-2 text-[13px] text-muted-foreground')}>
        {value ?? 'Chưa có dữ liệu'}
      </dd>
      {hint ? <p className="mt-0.5 text-[12px] text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function usageTone(value: number | null | undefined, warn: number, bad: number) {
  if (typeof value !== 'number') return undefined;
  if (value >= bad) return 'text-red-700 dark:text-red-400';
  if (value >= warn) return 'text-amber-700 dark:text-amber-300';
  return 'text-foreground';
}

export function OverviewTab({ snapshot, overview, overviewError }: {
  snapshot: MonitorSnapshot | null;
  overview: MonitoringOverview | null;
  overviewError: string | null;
}) {
  const host = overview?.prometheus.available ? overview.prometheus.host : undefined;
  const critical = overview?.incidents.by_severity.CRITICAL ?? null;
  const overall = !snapshot ? null : snapshot.summary.down > 0 ? 'down' : snapshot.summary.degraded > 0 || (critical ?? 0) > 0 ? 'degraded' : 'ok';
  const overallLabel = overall === 'down' ? 'Có dịch vụ ngừng hoạt động' : overall === 'degraded' ? 'Hệ thống đang suy giảm' : overall === 'ok' ? 'Hệ thống hoạt động bình thường' : 'Đang kiểm tra';
  const errorRate = host?.api_error_rate;

  return (
    <div className="space-y-5">
      <section aria-labelledby="overview-status" className="overflow-hidden rounded-2xl border border-border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-3.5">
          <h2 id="overview-status" className="font-display text-[18px] font-semibold tracking-tight text-foreground">Trạng thái chung</h2>
          <span className={cn('inline-flex items-center gap-2 text-[13px] font-semibold', overall === 'down' ? 'text-red-700 dark:text-red-400' : overall === 'degraded' ? 'text-amber-700 dark:text-amber-300' : 'text-primary')}>
            <span className={cn('h-2 w-2 rounded-full', overall === 'down' ? 'bg-red-600' : overall === 'degraded' ? 'bg-amber-500' : 'bg-primary')} aria-hidden="true" />
            {overallLabel}
          </span>
        </div>
        <dl className="grid grid-cols-2 gap-px bg-border sm:grid-cols-3 lg:grid-cols-6 [&>*]:bg-card">
          <Metric label="Tổng số dịch vụ" value={snapshot ? String(snapshot.summary.total) : null} />
          <Metric label="Hoạt động" value={snapshot ? String(snapshot.summary.ok) : null} />
          <Metric label="Suy giảm" value={snapshot ? String(snapshot.summary.degraded) : null} tone={snapshot?.summary.degraded ? 'text-amber-700 dark:text-amber-300' : undefined} />
          <Metric label="Ngừng" value={snapshot ? String(snapshot.summary.down) : null} tone={snapshot?.summary.down ? 'text-red-700 dark:text-red-400' : undefined} />
          <Metric label="Sự cố đang mở" value={overview ? String(overview.incidents.open) : null} tone={overview?.incidents.open ? 'text-amber-700 dark:text-amber-300' : undefined} />
          <Metric label="Sự cố nghiêm trọng" value={critical === null ? null : String(critical)} tone={critical ? 'text-red-700 dark:text-red-400' : undefined} />
        </dl>
      </section>

      <section aria-labelledby="overview-resources" className="overflow-hidden rounded-2xl border border-border bg-card">
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-b border-border px-5 py-3.5">
          <h2 id="overview-resources" className="font-display text-[18px] font-semibold tracking-tight text-foreground">Tài nguyên và API</h2>
          <p className="text-[12px] text-muted-foreground">
            {host ? `Từ Prometheus lúc ${formatDateTime(overview?.prometheus.checked_at, true)}` : 'Số liệu từ Prometheus (node-exporter, gateway)'}
          </p>
        </div>
        {!host ? (
          <p className="flex items-start gap-2 px-5 py-4 text-[13px] text-muted-foreground">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700 dark:text-amber-300" aria-hidden="true" />
            Chưa có số liệu tài nguyên: {overviewError || PROMETHEUS_REASON[overview?.prometheus.reason || ''] || 'đang tải'}.
          </p>
        ) : (
          <dl className="grid grid-cols-2 gap-px bg-border sm:grid-cols-3 lg:grid-cols-6 [&>*]:bg-card">
            <Metric label="CPU" value={percent(host.cpu_percent)} tone={usageTone(host.cpu_percent, 75, 90)} />
            <Metric label="RAM" value={percent(host.memory_percent)} tone={usageTone(host.memory_percent, 80, 90)} />
            <Metric label="Ổ đĩa /" value={percent(host.disk_percent)} tone={usageTone(host.disk_percent, 75, 85)} />
            <Metric label="Thời gian chạy VPS" value={formatDuration(host.host_uptime_seconds)} />
            <Metric label="Tỷ lệ lỗi API (5xx)" value={typeof errorRate === 'number' ? percent(errorRate * 100, 2) : null} hint="5 phút gần nhất" tone={usageTone(typeof errorRate === 'number' ? errorRate * 100 : null, 1, 5)} />
            <Metric label="Độ trễ API p95" value={typeof host.api_p95_ms === 'number' ? `${Math.round(host.api_p95_ms).toLocaleString('vi-VN')} ms` : null} hint="5 phút gần nhất" />
          </dl>
        )}
      </section>

      <section aria-labelledby="overview-activity" className="overflow-hidden rounded-2xl border border-border bg-card">
        <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-3.5">
          <h2 id="overview-activity" className="font-display text-[18px] font-semibold tracking-tight text-foreground">Hoạt động cảnh báo gần đây</h2>
        </div>
        {!overview ? (
          <p className="px-5 py-4 text-[13px] text-muted-foreground">{overviewError || 'Đang tải…'}</p>
        ) : overview.recent_activity.length === 0 ? (
          <p className="px-5 py-4 text-[13px] text-muted-foreground">Chưa có cảnh báo nào được ghi nhận.</p>
        ) : (
          <ul>
            {overview.recent_activity.map((event) => (
              <li key={event.id} className="border-b border-border last:border-0">
                <Link to={`/admin/monitor/incidents/${event.incident.id}`} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-5 py-3 transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/30">
                  <span className={cn('h-2 w-2 rounded-full', SEVERITY_META[event.incident.severity].dot)} aria-hidden="true" />
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] font-semibold text-foreground">{event.incident.title}</span>
                    <span className="block truncate text-[12px] text-muted-foreground">
                      {EVENT_LABEL[event.event_type] || event.event_type} · {event.incident.service_name}{event.actor_name ? ` · ${event.actor_name}` : ''}
                    </span>
                  </span>
                  <span className="flex items-center gap-3">
                    <SeverityBadge severity={event.incident.severity} className="hidden sm:inline-flex" />
                    <span className="text-[12px] tabular-nums text-muted-foreground">{formatDateTime(event.created_at)}</span>
                    <ArrowRight className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
