import { useMemo } from 'react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { cn } from '@/components/ui/utils';
import type { BorrowTrendItem, DashboardKpis, ReservationFunnel } from '@/services/analytics';
import { BlockEmpty, BlockError, Panel, PanelBody, PanelHeader } from './panel';
import { formatNumber, formatShare } from './utils';

// Validated categorical trio (dataviz validator, light + dark): indigo / cyan / amber.
// Reservations also carry a dashed stroke because cyan↔indigo sits near the tritan floor in dark mode.
const SERIES = [
  { key: 'loans', label: 'Mượn', unit: 'lượt mượn', color: 'var(--series-loans)', dash: undefined },
  { key: 'returns', label: 'Trả', unit: 'lượt trả', color: 'var(--series-returns)', dash: undefined },
  { key: 'reservations', label: 'Đặt trước', unit: 'lượt đặt trước', color: 'var(--series-reservations)', dash: '5 3' },
] as const;

type SeriesKey = (typeof SERIES)[number]['key'];

const SERIES_VARS = '[--series-loans:#4f46e5] [--series-returns:#06b6d4] [--series-reservations:#f59e0b] dark:[--series-loans:#6366f1] dark:[--series-returns:#0891b2] dark:[--series-reservations:#d97706]';
const DAY_MS = 86_400_000;
const AXIS_TICK = { fontSize: 12, fill: 'var(--muted-foreground)' };

type TrendRow = { date: string; loans: number; returns: number; reservations: number };

/** Continuous daily series from the first to the last reported day, so quiet days read as zero. */
function zeroFill(rows: BorrowTrendItem[]): TrendRow[] {
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

function longDayLabel(date: string) {
  const parsed = new Date(`${date}T00:00:00`);
  return Number.isNaN(parsed.getTime())
    ? date
    : parsed.toLocaleDateString('vi-VN', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' });
}

function TrendTooltip({ active, payload, label }: { active?: boolean; payload?: { dataKey?: string; value?: number }[]; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-border bg-popover px-3 py-2 text-[12px] shadow-[0_6px_16px_-6px_rgba(15,23,42,0.25)]">
      <p className="mb-1 font-medium capitalize text-foreground">{longDayLabel(label || '')}</p>
      {SERIES.map((series) => (
        <p key={series.key} className="flex items-center justify-between gap-6 leading-5 text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <svg width="14" height="6" aria-hidden="true"><line x1="0" y1="3" x2="14" y2="3" stroke={series.color} strokeWidth="2" strokeDasharray={series.dash} strokeLinecap="round" /></svg>
            {series.label}
          </span>
          <span className="font-semibold tabular-nums text-foreground">{formatNumber(Number(payload.find((entry) => entry.dataKey === series.key)?.value || 0))}</span>
        </p>
      ))}
    </div>
  );
}

function TrendPanel({ trendData, onRetry }: { trendData: BorrowTrendItem[] | null; onRetry: () => void }) {
  const series = useMemo(() => zeroFill(trendData ?? []), [trendData]);
  const totals = useMemo(() => series.reduce<Record<SeriesKey, number>>(
    (acc, row) => ({ loans: acc.loans + row.loans, returns: acc.returns + row.returns, reservations: acc.reservations + row.reservations }),
    { loans: 0, returns: 0, reservations: 0 },
  ), [series]);
  // The single busiest day across all series: named in words so a spike never goes unexplained.
  const peak = useMemo(() => {
    let best: { date: string; value: number; key: SeriesKey } | null = null;
    for (const row of series) {
      for (const item of SERIES) {
        if (row[item.key] > (best?.value ?? 0)) best = { date: row.date, value: row[item.key], key: item.key };
      }
    }
    return best;
  }, [series]);

  const first = series[0]?.date;
  const last = series[series.length - 1]?.date;
  const peakSeries = peak ? SERIES.find((item) => item.key === peak.key) : undefined;
  const summary = series.length
    ? `${series.length} ngày, từ ${dayLabel(first)} đến ${dayLabel(last)}: ${SERIES.map((item) => `${formatNumber(totals[item.key])} ${item.unit}`).join(', ')}.`
    : '';

  return (
    <Panel titleId="trend-title" className={cn('@5xl:col-span-8', SERIES_VARS)}>
      <PanelHeader
        id="trend-title"
        level={3}
        title="Mượn, trả và đặt trước theo ngày"
        description={series.length ? `${formatNumber(series.length)} ngày gần nhất · ${dayLabel(first)} – ${dayLabel(last)}` : 'Hoạt động mượn trả theo ngày'}
      />
      <PanelBody>
        {!trendData ? (
          <BlockError what="xu hướng mượn trả" onRetry={onRetry} />
        ) : !series.length ? (
          <BlockEmpty>Chưa có hoạt động mượn, trả hay đặt trước trong khoảng thời gian này.</BlockEmpty>
        ) : (
          <>
            {/* The legend carries the totals, so each swatch is read together with its number. */}
            <dl className="flex flex-wrap gap-x-8 gap-y-2">
              {SERIES.map((item) => (
                <div key={item.key}>
                  <dt className="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground">
                    <svg width="16" height="6" aria-hidden="true"><line x1="0" y1="3" x2="16" y2="3" stroke={item.color} strokeWidth="2" strokeDasharray={item.dash} strokeLinecap="round" /></svg>
                    {item.label}
                  </dt>
                  <dd className="mt-0.5 text-[18px] font-semibold leading-6 tabular-nums text-foreground">{formatNumber(totals[item.key])}</dd>
                </div>
              ))}
              {peak && peakSeries ? (
                <div className="ml-auto self-end text-right">
                  <dt className="text-[12px] text-muted-foreground">Ngày cao nhất</dt>
                  <dd className="mt-0.5 text-[13px] leading-6 text-foreground">
                    <span className="font-semibold tabular-nums">{formatNumber(peak.value)}</span> {peakSeries.unit} · {dayLabel(peak.date)}
                  </dd>
                </div>
              ) : null}
            </dl>
            <div className="mt-4" role="img" aria-label={`Biểu đồ đường: ${summary}`}>
              <ResponsiveContainer width="100%" height={240}>
                <LineChart data={series} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="date" tickFormatter={dayLabel} tick={AXIS_TICK} axisLine={{ stroke: 'var(--border)' }} tickLine={false} minTickGap={28} tickMargin={8} />
                  <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} width={40} allowDecimals={false} tickFormatter={(value: number) => formatNumber(value)} />
                  <Tooltip content={<TrendTooltip />} cursor={{ stroke: 'var(--muted-foreground)', strokeOpacity: 0.4, strokeWidth: 1 }} />
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
            </div>
          </>
        )}
      </PanelBody>
    </Panel>
  );
}

function ReservationPanel({ funnel, kpis, onRetry }: { funnel: ReservationFunnel | null; kpis: DashboardKpis | null; onRetry: () => void }) {
  const open = funnel ? funnel.pending + funnel.confirmed + funnel.ready_for_pickup : 0;
  const outcomes = funnel ? [
    { key: 'converted', label: 'Đã đến lấy', value: funnel.converted_to_loan, color: 'bg-emerald-500' },
    { key: 'expired', label: 'Hết hạn không lấy', value: funnel.expired, color: 'bg-amber-500' },
    { key: 'cancelled', label: 'Đã hủy', value: funnel.cancelled, color: 'bg-slate-400 dark:bg-slate-500' },
    { key: 'open', label: 'Đang xử lý', value: open, color: 'bg-indigo-400' },
  ].filter((outcome) => outcome.value > 0) : [];
  const outcomeTotal = outcomes.reduce((sum, outcome) => sum + outcome.value, 0);
  const stages = kpis ? [
    { label: 'Chờ xác nhận', value: kpis.pending_reservations },
    { label: 'Chuẩn bị sách', value: kpis.confirmed_reservations },
    { label: 'Chờ khách lấy', value: kpis.ready_for_pickup_reservations },
  ] : [];

  return (
    <Panel titleId="reservation-title" className="@5xl:col-span-4">
      <PanelHeader
        id="reservation-title"
        level={3}
        title="Đặt trước"
        description={outcomeTotal > 0 ? `Kết quả của ${formatNumber(outcomeTotal)} lượt đặt trước` : 'Kết quả các lượt đặt trước'}
      />
      <PanelBody>
        {!funnel ? (
          <BlockError what="kết quả đặt trước" onRetry={onRetry} />
        ) : outcomeTotal > 0 ? (
          <>
            <div className="flex h-2.5 w-full gap-0.5 overflow-hidden rounded-full" role="img" aria-label={`Tỷ trọng kết quả: ${outcomes.map((outcome) => `${outcome.label} ${formatShare(outcome.value, outcomeTotal)}`).join(', ')}`}>
              {outcomes.map((outcome) => (
                <span key={outcome.key} className={cn('h-full', outcome.color)} style={{ width: `${(outcome.value / outcomeTotal) * 100}%`, minWidth: 3 }} />
              ))}
            </div>
            <table className="mt-3 w-full text-[13px]">
              <caption className="sr-only">Kết quả đặt trước</caption>
              <tbody>
                {outcomes.map((outcome) => (
                  <tr key={outcome.key}>
                    <th scope="row" className="py-1 text-left font-normal text-foreground">
                      <span className="inline-flex items-center gap-2">
                        <span className={cn('h-2.5 w-2.5 rounded-[3px]', outcome.color)} aria-hidden="true" />
                        {outcome.label}
                      </span>
                    </th>
                    <td className="py-1 text-right font-semibold tabular-nums text-foreground">{formatNumber(outcome.value)}</td>
                    <td className="w-16 py-1 text-right tabular-nums text-muted-foreground">{formatShare(outcome.value, outcomeTotal)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        ) : (
          <BlockEmpty>Chưa có lượt đặt trước nào.</BlockEmpty>
        )}

        {stages.length ? (
          <div className="mt-5">
            <p className="text-[12px] text-muted-foreground">Đang chờ ở từng bước</p>
            <dl className="mt-1">
              {stages.map((stage) => (
                <div key={stage.label} className="flex items-center justify-between gap-3 border-b border-border/70 py-1.5 text-[13px] last:border-0">
                  <dt className="text-foreground">{stage.label}</dt>
                  <dd className={cn('font-semibold tabular-nums', stage.value > 0 ? 'text-foreground' : 'text-muted-foreground')}>{formatNumber(stage.value)}</dd>
                </div>
              ))}
            </dl>
            {kpis && kpis.pickup_codes_expiring_soon > 0 ? (
              <p className="mt-2 text-[12px] font-medium text-amber-700 dark:text-amber-300">{formatNumber(kpis.pickup_codes_expiring_soon)} mã lấy sách sắp hết hạn</p>
            ) : null}
          </div>
        ) : null}
      </PanelBody>
    </Panel>
  );
}

interface TrendFunnelSectionProps {
  trendData: BorrowTrendItem[] | null;
  funnel: ReservationFunnel | null;
  kpis: DashboardKpis | null;
  onRetry: () => void;
}

export function TrendFunnelSection({ trendData, funnel, kpis, onRetry }: TrendFunnelSectionProps) {
  return (
    <div className="grid grid-cols-1 gap-5 @5xl:grid-cols-12">
      <TrendPanel trendData={trendData} onRetry={onRetry} />
      <ReservationPanel funnel={funnel} kpis={kpis} onRetry={onRetry} />
    </div>
  );
}
