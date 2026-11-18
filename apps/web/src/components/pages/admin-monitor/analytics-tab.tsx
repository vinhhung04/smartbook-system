import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { LoadingOverlay } from '@/components/ui/loading-state';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { cn } from '@/components/ui/utils';
import { getApiErrorMessage } from '@/services/http-clients';
import { incidentService, type MonitoringAnalytics } from '@/services/incidents';
import { CATEGORY_LABEL, CHANNEL_LABEL, SEVERITY_META, formatDuration } from './incident-format';

type Window = '7' | '30' | '90';
const WINDOWS: Array<{ value: Window; label: string }> = [{ value: '7', label: '7 ngày' }, { value: '30', label: '30 ngày' }, { value: '90', label: '90 ngày' }];

function Kpi({ label, value, hint }: { label: string; value: string | null; hint: string }) {
  return (
    <div className="px-5 py-4">
      <dt className="text-[13px] text-muted-foreground">{label}</dt>
      <dd className={cn('mt-1 leading-tight tabular-nums', value ? cn('font-display text-[24px] font-semibold', 'text-foreground') : 'pt-2 text-[13px] text-muted-foreground')}>
        {value ?? 'Chưa có dữ liệu'}
      </dd>
      <p className="mt-0.5 text-[12px] text-muted-foreground">{hint}</p>
    </div>
  );
}

/** Horizontal magnitude bars: one hue (or the severity's own state color), value labelled in text ink. */
function BarList({ rows, colorFor }: { rows: Array<{ key: string; label: string; count: number }>; colorFor?: (key: string) => string }) {
  const max = Math.max(1, ...rows.map((row) => row.count));
  if (!rows.length) return <p className="px-5 py-4 text-[13px] text-muted-foreground">Chưa có dữ liệu trong khoảng này.</p>;
  return (
    <ul className="space-y-2.5 px-5 py-4">
      {rows.map((row) => (
        <li key={row.key} className="grid grid-cols-[minmax(0,140px)_minmax(0,1fr)_40px] items-center gap-3 text-[13px]" title={`${row.label}: ${row.count}`}>
          <span className="truncate text-foreground">{row.label}</span>
          <span className="h-2.5 rounded-full bg-muted" aria-hidden="true">
            <span className={cn('block h-full rounded-full', colorFor ? colorFor(row.key) : 'bg-primary')} style={{ width: `${(row.count / max) * 100}%` }} />
          </span>
          <span className="text-right tabular-nums text-muted-foreground">{row.count.toLocaleString('vi-VN')}</span>
        </li>
      ))}
    </ul>
  );
}

function TrendChart({ trend, days, now }: { trend: MonitoringAnalytics['trend']; days: number; now: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const series = useMemo(() => {
    const totals = new Map<string, number>();
    for (const row of trend) totals.set(row.day, (totals.get(row.day) || 0) + row.count);
    const out: Array<{ day: string; count: number }> = [];
    const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' });
    for (let i = days - 1; i >= 0; i -= 1) {
      const day = formatter.format(new Date(now - i * 86_400_000));
      out.push({ day, count: totals.get(day) || 0 });
    }
    return out;
  }, [trend, days, now]);
  const max = Math.max(1, ...series.map((point) => point.count));
  const label = (day: string) => `${day.slice(8, 10)}/${day.slice(5, 7)}`;
  const active = hover !== null ? series[hover] : null;
  return (
    <div className="px-5 py-4">
      <div className="mb-2 h-5 text-[12px] text-muted-foreground" aria-live="polite">
        {active ? <span><span className="font-semibold text-foreground">{label(active.day)}</span> · {active.count.toLocaleString('vi-VN')} sự cố</span> : 'Di chuột lên một cột để xem số sự cố của ngày đó.'}
      </div>
      <div className="flex h-36 items-end gap-[2px] border-b border-border" role="img" aria-label={`Số sự cố mỗi ngày trong ${days} ngày, cao nhất ${max}`} onMouseLeave={() => setHover(null)}>
        {series.map((point, index) => (
          <button
            key={point.day}
            type="button"
            className="group flex h-full min-w-0 flex-1 items-end focus-visible:outline-none"
            onMouseEnter={() => setHover(index)}
            onFocus={() => setHover(index)}
            aria-label={`${label(point.day)}: ${point.count} sự cố`}
          >
            <span
              className={cn('block w-full rounded-t-[4px] transition-colors', point.count ? 'bg-primary/70 group-hover:bg-primary group-focus-visible:bg-primary' : 'bg-transparent')}
              style={{ height: point.count ? `${Math.max(4, (point.count / max) * 100)}%` : 0 }}
            />
          </button>
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[11px] tabular-nums text-muted-foreground">
        <span>{label(series[0].day)}</span><span>{label(series[series.length - 1].day)}</span>
      </div>
    </div>
  );
}

export function AnalyticsTab({ refreshKey }: { refreshKey: number }) {
  const [range, setRange] = useState<Window>('30');
  const [data, setData] = useState<MonitoringAnalytics | null>(null);
  const [loadedAt, setLoadedAt] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);

  // State is only set in the promise callbacks; `active` drops a stale response
  // when the range changes before the previous request finished.
  useEffect(() => {
    let active = true;
    incidentService.analytics(Number(range)).then(
      (result) => { if (active) { setData(result); setLoadedAt(Date.now()); setError(null); } },
      (err) => { if (active) setError(getApiErrorMessage(err, 'Không tải được thống kê')); },
    );
    return () => { active = false; };
  }, [range, refreshKey, retry]);
  const load = useCallback(() => { setError(null); setRetry((n) => n + 1); }, []);

  if (error) return <EmptyState variant="error" title="Không tải được thống kê" description={error} action={<Button type="button" onClick={load}>Thử lại</Button>} />;
  if (!data) return <div className="rounded-2xl border border-border bg-card"><LoadingOverlay /></div>;

  const successRate = data.deliveries.success_rate;
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[13px] text-muted-foreground">Tính từ sự cố và lượt gửi đã ghi nhận; không có ước lượng.</p>
        <SegmentedControl options={WINDOWS} value={range} onChange={setRange} layoutId="monitoring-analytics-window" />
      </div>

      <dl aria-label="Chỉ số xử lý sự cố" className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-border bg-border lg:grid-cols-5 [&>*]:bg-card">
        <Kpi label="Tổng sự cố" value={data.total.toLocaleString('vi-VN')} hint={`${data.open} chưa xử lý`} />
        <Kpi label="MTTD (độ trễ phát hiện)" value={formatDuration(data.mttd_seconds)} hint="Từ lúc Grafana báo đến lúc ghi nhận" />
        <Kpi label="MTTA (thời gian tiếp nhận)" value={formatDuration(data.mtta_seconds)} hint={`${data.acknowledged_samples} sự cố đã tiếp nhận`} />
        <Kpi label="MTTR (thời gian xử lý)" value={formatDuration(data.mttr_seconds)} hint={`${data.resolved_samples} sự cố đã xử lý`} />
        <Kpi label="Gửi thông báo thành công" value={successRate === null ? null : `${(successRate * 100).toLocaleString('vi-VN', { maximumFractionDigits: 1 })}%`} hint="Đã gửi / (đã gửi + thất bại)" />
      </dl>

      <section aria-labelledby="trend-title" className="overflow-hidden rounded-2xl border border-border bg-card">
        <h2 id="trend-title" className="border-b border-border px-5 py-3.5 font-display text-[16px] font-semibold text-foreground">Số sự cố mỗi ngày</h2>
        {data.total === 0 ? <p className="px-5 py-4 text-[13px] text-muted-foreground">Chưa có sự cố nào trong {data.window_days} ngày.</p> : <TrendChart trend={data.trend} days={data.window_days} now={loadedAt} />}
      </section>

      <div className="grid gap-5 lg:grid-cols-3">
        <section aria-labelledby="severity-title" className="overflow-hidden rounded-2xl border border-border bg-card">
          <h2 id="severity-title" className="border-b border-border px-5 py-3.5 font-display text-[16px] font-semibold text-foreground">Theo mức độ</h2>
          <BarList rows={data.by_severity.map((row) => ({ key: row.key, label: SEVERITY_META[row.key]?.label || row.key, count: row.count }))} colorFor={(key) => SEVERITY_META[key as keyof typeof SEVERITY_META]?.dot || 'bg-primary'} />
        </section>
        <section aria-labelledby="service-title" className="overflow-hidden rounded-2xl border border-border bg-card">
          <h2 id="service-title" className="border-b border-border px-5 py-3.5 font-display text-[16px] font-semibold text-foreground">Theo dịch vụ</h2>
          <BarList rows={data.by_service.map((row) => ({ key: row.key, label: row.key, count: row.count }))} />
        </section>
        <section aria-labelledby="category-title" className="overflow-hidden rounded-2xl border border-border bg-card">
          <h2 id="category-title" className="border-b border-border px-5 py-3.5 font-display text-[16px] font-semibold text-foreground">Theo phân loại</h2>
          <BarList rows={data.by_category.map((row) => ({ key: row.key, label: CATEGORY_LABEL[row.key] || row.key, count: row.count }))} />
        </section>
      </div>

      <section aria-labelledby="delivery-title" className="overflow-hidden rounded-2xl border border-border bg-card">
        <h2 id="delivery-title" className="border-b border-border px-5 py-3.5 font-display text-[16px] font-semibold text-foreground">Gửi thông báo theo kênh</h2>
        {data.deliveries.by_channel.length === 0 ? (
          <p className="px-5 py-4 text-[13px] text-muted-foreground">Chưa có lượt gửi nào trong khoảng này.</p>
        ) : (
          <table className="w-full text-left text-[13px]">
            <thead className="border-b border-border text-[12px] text-muted-foreground">
              <tr><th scope="col" className="px-5 py-2.5 font-medium">Kênh</th><th scope="col" className="px-3 py-2.5 text-right font-medium">Đã gửi</th><th scope="col" className="px-3 py-2.5 text-right font-medium">Thất bại</th><th scope="col" className="px-5 py-2.5 text-right font-medium">Đang chờ</th></tr>
            </thead>
            <tbody>
              {data.deliveries.by_channel.map((row) => (
                <tr key={row.channel} className="border-b border-border last:border-0">
                  <td className="px-5 py-2.5 text-foreground">{CHANNEL_LABEL[row.channel]}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{row.sent}</td>
                  <td className={cn('px-3 py-2.5 text-right tabular-nums', row.failed ? 'font-semibold text-red-700 dark:text-red-400' : '')}>{row.failed}</td>
                  <td className="px-5 py-2.5 text-right tabular-nums">{row.pending}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
