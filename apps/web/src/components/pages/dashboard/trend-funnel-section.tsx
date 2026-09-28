import { useMemo } from 'react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { EmptyState } from '@/components/ui/empty-state';
import { cn } from '@/components/ui/utils';
import type { DashboardKpis, ReservationFunnel } from '@/services/analytics';
import { formatPercent } from './utils';

// Validated categorical trio (dataviz validator, light + dark): indigo / cyan / amber.
// Reservations also carry a dashed stroke because cyan↔indigo sits near the tritan floor in dark mode.
const SERIES = [
  { key: 'loans', label: 'Mượn', color: 'var(--series-loans)', dash: undefined },
  { key: 'returns', label: 'Trả', color: 'var(--series-returns)', dash: undefined },
  { key: 'reservations', label: 'Đặt trước', color: 'var(--series-reservations)', dash: '5 3' },
] as const;

const SERIES_VARS = '[--series-loans:#4f46e5] [--series-returns:#06b6d4] [--series-reservations:#f59e0b] dark:[--series-loans:#6366f1] dark:[--series-returns:#0891b2] dark:[--series-reservations:#d97706]';
const DAY_MS = 86_400_000;

type TrendRow = { date: string; loans: number; returns: number; reservations: number };

/** Continuous daily series from the first to the last reported day, so quiet days read as zero. */
function zeroFill(rows: TrendRow[]): TrendRow[] {
  const valid = rows.filter((row) => /^\d{4}-\d{2}-\d{2}/.test(row.date));
  if (valid.length === 0) return rows;
  const byDay = new Map(valid.map((row) => [row.date.slice(0, 10), row]));
  const days = [...byDay.keys()].sort();
  const out: TrendRow[] = [];
  for (let t = Date.parse(`${days[0]}T00:00:00Z`); t <= Date.parse(`${days[days.length - 1]}T00:00:00Z`); t += DAY_MS) {
    const key = new Date(t).toISOString().slice(0, 10);
    const row = byDay.get(key);
    out.push({ date: key, loans: Number(row?.loans || 0), returns: Number(row?.returns || 0), reservations: Number(row?.reservations || 0) });
  }
  return out;
}

function dayLabel(date: string) {
  const [, month, day] = date.split('-');
  return day && month ? `${day}/${month}` : date;
}

function TrendTooltip({ active, payload, label }: { active?: boolean; payload?: { dataKey?: string; value?: number }[]; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2 text-[12px] shadow-[0_6px_16px_-6px_rgba(15,23,42,0.25)]">
      <p className="mb-1 font-medium text-foreground">{dayLabel(label || '')}</p>
      {SERIES.map((series) => (
        <p key={series.key} className="flex items-center justify-between gap-4 text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-0.5 w-3 rounded-full" style={{ background: series.color }} aria-hidden="true" />
            {series.label}
          </span>
          <span className="font-semibold tabular-nums text-foreground">{Number(payload.find((entry) => entry.dataKey === series.key)?.value || 0).toLocaleString('vi-VN')}</span>
        </p>
      ))}
    </div>
  );
}

interface TrendFunnelSectionProps {
  trendData: TrendRow[];
  funnel: ReservationFunnel;
  kpis: DashboardKpis;
}

export function TrendFunnelSection({ trendData, funnel, kpis }: TrendFunnelSectionProps) {
  const series = useMemo(() => zeroFill(trendData), [trendData]);
  const totals = useMemo(() => series.reduce(
    (acc, row) => ({ loans: acc.loans + row.loans, returns: acc.returns + row.returns, reservations: acc.reservations + row.reservations }),
    { loans: 0, returns: 0, reservations: 0 },
  ), [series]);

  const open = funnel.pending + funnel.confirmed + funnel.ready_for_pickup;
  const outcomes = [
    { key: 'converted', label: 'Đã đến lấy', value: funnel.converted_to_loan, color: 'bg-emerald-500' },
    { key: 'expired', label: 'Hết hạn không lấy', value: funnel.expired, color: 'bg-amber-500' },
    { key: 'cancelled', label: 'Đã hủy', value: funnel.cancelled, color: 'bg-slate-400' },
    { key: 'open', label: 'Đang xử lý', value: open, color: 'bg-indigo-400' },
  ].filter((outcome) => outcome.value > 0);
  const outcomeTotal = outcomes.reduce((sum, outcome) => sum + outcome.value, 0);

  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
      <section aria-labelledby="trend-title" className={cn('rounded-xl border border-border bg-card p-5 xl:col-span-2', SERIES_VARS)}>
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <div>
            <h3 id="trend-title" className="text-[14px] font-semibold text-foreground">Mượn, trả và đặt trước theo ngày</h3>
            {series.length ? (
              <p className="mt-1 text-[13px] text-muted-foreground">
                {series.length} ngày gần nhất · <span className="font-semibold text-foreground">{totals.loans.toLocaleString('vi-VN')}</span> lượt mượn,{' '}
                <span className="font-semibold text-foreground">{totals.returns.toLocaleString('vi-VN')}</span> lượt trả
              </p>
            ) : null}
          </div>
          <ul className="flex flex-wrap items-center gap-x-4 gap-y-1" aria-label="Chú thích">
            {SERIES.map((item) => (
              <li key={item.key} className="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground">
                <svg width="16" height="6" aria-hidden="true"><line x1="0" y1="3" x2="16" y2="3" stroke={item.color} strokeWidth="2" strokeDasharray={item.dash} strokeLinecap="round" /></svg>
                {item.label}
              </li>
            ))}
          </ul>
        </div>
        <div className="mt-4">
          {series.length ? (
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={series} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid stroke="rgba(148,163,184,0.22)" vertical={false} />
                <XAxis dataKey="date" tickFormatter={dayLabel} tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} minTickGap={24} />
                <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} width={36} allowDecimals={false} />
                <Tooltip content={<TrendTooltip />} cursor={{ stroke: 'rgba(148,163,184,0.5)', strokeWidth: 1 }} />
                {SERIES.map((item) => (
                  <Line
                    key={item.key}
                    type="linear"
                    dataKey={item.key}
                    name={item.label}
                    stroke={item.color}
                    strokeWidth={2}
                    strokeDasharray={item.dash}
                    dot={false}
                    activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--card)' }}
                    isAnimationActive={false}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <EmptyState variant="no-data" title="Chưa có dữ liệu xu hướng" description="Chưa có hoạt động mượn/đặt trong khoảng thời gian này." />
          )}
        </div>
      </section>

      <section aria-labelledby="reservation-title" className="rounded-xl border border-border bg-card p-5">
        <h3 id="reservation-title" className="text-[14px] font-semibold text-foreground">Đặt trước</h3>
        <p className="mt-1 text-[13px] text-muted-foreground">
          Tỷ lệ khách đến lấy <span className="font-semibold text-foreground">{formatPercent(funnel.conversion_rate)}</span>
        </p>

        <div className="mt-4">
          <p className="text-[12px] font-medium text-muted-foreground">Đang chờ xử lý</p>
          <dl className="mt-2 grid grid-cols-3 divide-x divide-border rounded-lg border border-border">
            {[
              { label: 'Chờ xác nhận', value: kpis.pending_reservations },
              { label: 'Đã xác nhận', value: kpis.confirmed_reservations },
              { label: 'Sẵn sàng lấy', value: kpis.ready_for_pickup_reservations },
            ].map((stat) => (
              <div key={stat.label} className="px-3 py-2.5">
                <dt className="text-[11px] leading-4 text-muted-foreground">{stat.label}</dt>
                <dd className="mt-0.5 text-[18px] font-semibold text-foreground">{stat.value.toLocaleString('vi-VN')}</dd>
              </div>
            ))}
          </dl>
          {kpis.pickup_codes_expiring_soon > 0 ? (
            <p className="mt-2 text-[12px] font-medium text-amber-700 dark:text-amber-400">{kpis.pickup_codes_expiring_soon} mã lấy sách sắp hết hạn</p>
          ) : null}
        </div>

        <div className="mt-5">
          <p className="text-[12px] font-medium text-muted-foreground">
            Kết quả {outcomeTotal > 0 ? `${outcomeTotal.toLocaleString('vi-VN')} lượt đặt trước` : ''}
          </p>
          {outcomeTotal > 0 ? (
            <>
              <div className="mt-2 flex h-2.5 w-full gap-[2px] overflow-hidden rounded-full" role="img" aria-label="Tỷ trọng kết quả đặt trước">
                {outcomes.map((outcome) => (
                  <span key={outcome.key} className={cn('h-full', outcome.color)} style={{ width: `${(outcome.value / outcomeTotal) * 100}%`, minWidth: 3 }} />
                ))}
              </div>
              <ul className="mt-3 space-y-1.5">
                {outcomes.map((outcome) => (
                  <li key={outcome.key} className="flex items-center justify-between gap-3 text-[13px]">
                    <span className="inline-flex items-center gap-2 text-foreground">
                      <span className={cn('h-2.5 w-2.5 rounded-[3px]', outcome.color)} aria-hidden="true" />
                      {outcome.label}
                    </span>
                    <span className="tabular-nums text-muted-foreground">
                      <span className="font-semibold text-foreground">{outcome.value.toLocaleString('vi-VN')}</span> · {Math.round((outcome.value / outcomeTotal) * 100)}%
                    </span>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="mt-2 text-[13px] text-muted-foreground">Chưa có lượt đặt trước nào.</p>
          )}
        </div>
      </section>
    </div>
  );
}
