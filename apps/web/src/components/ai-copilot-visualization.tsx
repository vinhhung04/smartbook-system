import { Component, useId, useMemo, useState, type ReactNode } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  AlertTriangle,
  AreaChart as AreaIcon,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  BarChart3,
  Clock3,
  Database,
  LineChart as LineIcon,
  MapPin,
  Maximize2,
  MessageCircleQuestion,
  PieChart as PieIcon,
  Search,
  Table2,
} from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Slider } from '@/components/ui/slider';
import { cn } from '@/components/ui/utils';
import {
  VIZ_TYPE_LABELS,
  budgetPrompt,
  filterRows,
  formatAxisTick,
  formatDataAsOf,
  formatValue,
  sortRows,
  switchableTypes,
  tableColumns,
  truncateLabel,
  type CopilotVisualizationSpec,
  type SortDirection,
  type VizCell,
  type VizField,
  type VizType,
} from '@/lib/copilot-visualization';

// Renders the validated visualization specs of a copilot answer
// (services/ai-service/copilot_visualization.py). Data comes only from the
// spec - this file never computes a value, it formats and draws. Only the
// whitelisted types below exist; anything else was dropped by
// sanitizeVisualizations before reaching here.

// Categorical slots in fixed order (validated light + dark, dataviz validator):
// indigo / cyan / amber / pink. Cyan and amber sit under 3:1 on the light
// surface, so every chart keeps a legend and a table view (contrast relief).
const SERIES_VARS =
  '[--viz-1:#4f46e5] [--viz-2:#06b6d4] [--viz-3:#f59e0b] [--viz-4:#db2777] ' +
  'dark:[--viz-1:#6366f1] dark:[--viz-2:#0891b2] dark:[--viz-3:#d97706] dark:[--viz-4:#ec4899] ' +
  // Pie slices: the reference 8-hue categorical order (validated adjacent pairs).
  '[--pie-1:#2a78d6] [--pie-2:#eb6834] [--pie-3:#1baf7a] [--pie-4:#eda100] [--pie-5:#e87ba4] [--pie-6:#008300] [--pie-7:#4a3aa7] [--pie-8:#e34948] ' +
  'dark:[--pie-1:#3987e5] dark:[--pie-2:#d95926] dark:[--pie-3:#199e70] dark:[--pie-4:#c98500] dark:[--pie-5:#d55181] dark:[--pie-6:#008300] dark:[--pie-7:#9085e9] dark:[--pie-8:#e66767]';
const seriesColor = (i: number) => `var(--viz-${(i % 4) + 1})`;
const pieColor = (i: number) => `var(--pie-${(i % 8) + 1})`;
// Second series of a line/area chart is dashed: cyan vs indigo sits near the
// tritan floor in dark mode, so identity is never carried by hue alone.
const DASHES = [undefined, '6 3', '2 3', '8 3 2 3'];

const TYPE_ICONS: Record<VizType, typeof LineIcon> = {
  line: LineIcon, bar: BarChart3, area: AreaIcon, pie: PieIcon, table: Table2, kpi: Database,
};

const AXIS_TICK = { fontSize: 11, fill: 'var(--muted-foreground)' };
// Points of an incomplete period (half a month) are drawn hollow and amber:
// they are real values, but not comparable with the full periods beside them.
const PARTIAL_COLOR = '#d97706';

function partialXs(spec: CopilotVisualizationSpec): Set<string> {
  return new Set(spec.annotations.map((a) => a.x));
}

function makeDot(spec: CopilotVisualizationSpec, color: string) {
  const partial = partialXs(spec);
  return (props: { cx?: number; cy?: number; payload?: Row; index?: number }) => {
    const { cx, cy, payload, index } = props;
    if (cx === undefined || cy === undefined || !Number.isFinite(cx) || !Number.isFinite(cy)) return <g key={index} />;
    const isPartial = Boolean(spec.x_key && payload && partial.has(String(payload[spec.x_key])));
    return isPartial ? (
      <circle key={index} cx={cx} cy={cy} r={5} fill="var(--card)" stroke={PARTIAL_COLOR} strokeWidth={2} strokeDasharray="2 2" />
    ) : (
      <circle key={index} cx={cx} cy={cy} r={3} fill="var(--card)" stroke={color} strokeWidth={2} />
    );
  };
}

type Row = Record<string, VizCell>;

function valueField(spec: CopilotVisualizationSpec): VizField {
  return spec.series[0];
}

// ── tooltip ──────────────────────────────────────────────────────────────────

interface TooltipEntry { dataKey?: string | number; value?: number | null; color?: string; payload?: Row }

function ChartTooltip({ active, payload, label, spec, visible }: {
  active?: boolean; payload?: TooltipEntry[]; label?: string; spec: CopilotVisualizationSpec; visible: VizField[];
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload ?? {};
  const x = spec.x_key ? String(row[spec.x_key] ?? label ?? '') : String(label ?? '');
  const note = spec.annotations.find((a) => a.x === x)?.note;
  return (
    <div className="max-w-[260px] rounded-lg border border-border bg-card px-3 py-2 text-[12px] shadow-[0_6px_16px_-6px_rgba(15,23,42,0.25)]">
      <p className="mb-1 font-medium text-foreground">{x}</p>
      {visible.map((field) => {
        const index = spec.series.findIndex((f) => f.key === field.key);
        const value = row[field.key];
        return (
          <p key={field.key} className="flex items-center justify-between gap-4 text-muted-foreground">
            <span className="inline-flex min-w-0 items-center gap-1.5">
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: spec.type === 'pie' ? undefined : seriesColor(index) }} aria-hidden="true" />
              <span className="truncate">{field.label}</span>
            </span>
            <span className="shrink-0 font-semibold tabular-nums text-foreground">
              {value === null || value === undefined ? 'Không có dữ liệu' : formatValue(value, field.unit, field.kind)}
            </span>
          </p>
        );
      })}
      {note && <p className="mt-1 border-t border-border pt-1 text-[11px] text-amber-700 dark:text-amber-400">{note}</p>}
    </div>
  );
}

// ── charts ───────────────────────────────────────────────────────────────────

interface ChartProps { spec: CopilotVisualizationSpec; visible: VizField[]; height: number }

export function CopilotLineChart({ spec, visible, height }: ChartProps) {
  const field = valueField(spec);
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={spec.data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
        <XAxis dataKey={spec.x_key ?? undefined} tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: 'var(--border)' }} minTickGap={12} />
        <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} width={48}
          tickFormatter={(v: number) => formatAxisTick(v, field.kind)} allowDecimals={field.kind !== 'count'} />
        <Tooltip content={<ChartTooltip spec={spec} visible={visible} />} cursor={{ stroke: 'var(--muted-foreground)', strokeDasharray: '3 3' }} />
        {visible.map((f) => {
          const i = spec.series.findIndex((s) => s.key === f.key);
          return (
            <Line key={f.key} type="monotone" dataKey={f.key} name={f.label} stroke={seriesColor(i)} strokeWidth={2}
              strokeDasharray={DASHES[i]} dot={makeDot(spec, seriesColor(i))} activeDot={{ r: 5 }}
              connectNulls={false} isAnimationActive={false} />
          );
        })}
      </LineChart>
    </ResponsiveContainer>
  );
}

export function CopilotAreaChart({ spec, visible, height }: ChartProps) {
  const field = valueField(spec);
  const gradientId = useId().replace(/:/g, '');
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={spec.data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
        <defs>
          {visible.map((f) => {
            const i = spec.series.findIndex((s) => s.key === f.key);
            return (
              <linearGradient key={f.key} id={`${gradientId}-${f.key}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={seriesColor(i)} stopOpacity={0.28} />
                <stop offset="100%" stopColor={seriesColor(i)} stopOpacity={0.02} />
              </linearGradient>
            );
          })}
        </defs>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
        <XAxis dataKey={spec.x_key ?? undefined} tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: 'var(--border)' }} minTickGap={12} />
        <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} width={48} tickFormatter={(v: number) => formatAxisTick(v, field.kind)} />
        <Tooltip content={<ChartTooltip spec={spec} visible={visible} />} cursor={{ stroke: 'var(--muted-foreground)', strokeDasharray: '3 3' }} />
        {visible.map((f) => {
          const i = spec.series.findIndex((s) => s.key === f.key);
          return (
            <Area key={f.key} type="monotone" dataKey={f.key} name={f.label} stroke={seriesColor(i)} strokeWidth={2}
              strokeDasharray={DASHES[i]} fill={`url(#${gradientId}-${f.key})`} connectNulls={false} isAnimationActive={false} />
          );
        })}
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function CopilotBarChart({ spec, visible, height }: ChartProps) {
  const field = valueField(spec);
  const xKey = spec.x_key ?? '';
  const partial = partialXs(spec);
  const longLabels = spec.data.some((row) => String(row[xKey] ?? '').length > 12);
  // Long category names (book titles) read better as horizontal bars, whose
  // labels get the full row height instead of colliding under the axis.
  const horizontal = spec.x_kind === 'category' && (longLabels || spec.data.length > 6);
  const chartHeight = horizontal ? Math.max(height, spec.data.length * (visible.length > 1 ? 34 : 26) + 40) : height;
  return (
    <ResponsiveContainer width="100%" height={chartHeight}>
      <BarChart data={spec.data} layout={horizontal ? 'vertical' : 'horizontal'} barGap={2} barCategoryGap="22%"
        margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" horizontal={!horizontal} vertical={horizontal} stroke="var(--border)" />
        {horizontal ? (
          <>
            <XAxis type="number" tick={AXIS_TICK} tickLine={false} axisLine={false} tickFormatter={(v: number) => formatAxisTick(v, field.kind)} />
            <YAxis type="category" dataKey={xKey} tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: 'var(--border)' }} width={118}
              tickFormatter={(v: string) => truncateLabel(String(v), 17)} interval={0} />
          </>
        ) : (
          <>
            <XAxis dataKey={xKey} tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: 'var(--border)' }} interval={0}
              tickFormatter={(v: string) => truncateLabel(String(v), 14)} />
            <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} width={48} tickFormatter={(v: number) => formatAxisTick(v, field.kind)} />
          </>
        )}
        <Tooltip content={<ChartTooltip spec={spec} visible={visible} />} cursor={{ fill: 'var(--muted)', opacity: 0.5 }} />
        {visible.map((f) => {
          const i = spec.series.findIndex((s) => s.key === f.key);
          return (
            <Bar key={f.key} dataKey={f.key} name={f.label} fill={seriesColor(i)} maxBarSize={36}
              radius={horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0]} isAnimationActive={false}>
              {spec.data.map((row, j) => (
                <Cell key={j} fillOpacity={partial.has(String(row[xKey])) ? 0.35 : 1}
                  stroke={partial.has(String(row[xKey])) ? PARTIAL_COLOR : undefined} strokeDasharray="3 2" />
              ))}
            </Bar>
          );
        })}
      </BarChart>
    </ResponsiveContainer>
  );
}

export function CopilotPieChart({ spec, height }: Omit<ChartProps, 'visible'>) {
  const field = valueField(spec);
  const xKey = spec.x_key ?? '';
  const total = spec.data.reduce((sum, row) => sum + (typeof row[field.key] === 'number' ? (row[field.key] as number) : 0), 0);
  return (
    <div className="grid items-center gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <ResponsiveContainer width="100%" height={height}>
        <PieChart>
          <Pie data={spec.data} dataKey={field.key} nameKey={xKey} innerRadius="55%" outerRadius="85%" paddingAngle={1}
            stroke="var(--card)" strokeWidth={2} isAnimationActive={false}>
            {spec.data.map((row, i) => <Cell key={String(row[xKey])} fill={pieColor(i)} />)}
          </Pie>
          <Tooltip content={<ChartTooltip spec={spec} visible={[field]} />} />
        </PieChart>
      </ResponsiveContainer>
      <ul className="space-y-1 text-[12px]" aria-label="Chú giải">
        {spec.data.map((row, i) => {
          const value = row[field.key] as number;
          return (
            <li key={String(row[xKey])} className="flex items-center justify-between gap-3">
              <span className="inline-flex min-w-0 items-center gap-1.5 text-foreground">
                <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: pieColor(i) }} aria-hidden="true" />
                <span className="truncate">{String(row[xKey])}</span>
              </span>
              <span className="shrink-0 tabular-nums text-muted-foreground">
                {formatValue(value, field.unit, field.kind)} · {total ? `${((value / total) * 100).toLocaleString('vi-VN', { maximumFractionDigits: 1 })}%` : '—'}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function CopilotKpiCards({ spec }: { spec: CopilotVisualizationSpec }) {
  return (
    <dl className="grid grid-cols-[repeat(auto-fit,minmax(8.5rem,1fr))] gap-2">
      {spec.kpis.map((kpi) => (
        <div key={kpi.key} className="min-w-0 rounded-lg border border-border bg-card px-3 py-2">
          <dt className="line-clamp-2 text-[11px] leading-snug text-muted-foreground" title={kpi.label}>{kpi.label}</dt>
          <dd className="mt-0.5 text-[18px] font-semibold tabular-nums text-foreground">
            {kpi.value === null ? <span title="Không có dữ liệu">—</span> : formatValue(kpi.value, kpi.unit, kpi.kind)}
          </dd>
          {kpi.delta !== null && (
            <p className="text-[11px] tabular-nums text-muted-foreground">
              {kpi.delta > 0 ? '▲' : kpi.delta < 0 ? '▼' : '■'} {formatValue(Math.abs(kpi.delta), kpi.delta_unit)} {kpi.delta_label}
            </p>
          )}
          {kpi.note && <p className="line-clamp-2 text-[11px] text-muted-foreground" title={kpi.note}>{kpi.note}</p>}
        </div>
      ))}
    </dl>
  );
}

export function CopilotDataTable({ spec, maxHeight = 320 }: { spec: CopilotVisualizationSpec; maxHeight?: number }) {
  const columns = tableColumns(spec);
  const [sort, setSort] = useState<{ key: string; direction: SortDirection } | null>(null);
  const [query, setQuery] = useState('');
  const filterable = spec.interactions.filterable || spec.data.length > 8;
  const rows = useMemo(() => {
    const filtered = filterRows(spec.data, query);
    return sort ? sortRows(filtered, sort.key, sort.direction) : filtered;
  }, [spec.data, query, sort]);
  const toggleSort = (key: string) => setSort((current) =>
    !current || current.key !== key ? { key, direction: 'desc' }
      : current.direction === 'desc' ? { key, direction: 'asc' } : null);
  return (
    <div className="space-y-2">
      {filterable && (
        <label className="flex max-w-xs items-center gap-1.5 rounded-md border border-input bg-card px-2 py-1">
          <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Lọc theo tên..."
            aria-label={`Lọc bảng ${spec.title}`}
            className="w-full bg-transparent text-[12px] text-foreground outline-none placeholder:text-muted-foreground"
          />
        </label>
      )}
      <div className="overflow-auto rounded-lg border border-border" style={{ maxHeight }}>
        <table className="w-full min-w-[420px] border-collapse text-[12px]">
          <thead className="sticky top-0 z-10 bg-muted/90 backdrop-blur">
            <tr>
              {columns.map((col) => {
                const numeric = col.kind !== 'text' && col.kind !== 'date';
                const active = sort?.key === col.key;
                const SortIcon = !active ? ArrowUpDown : sort.direction === 'asc' ? ArrowUp : ArrowDown;
                return (
                  <th key={col.key} scope="col" aria-sort={active ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'}
                    className={cn('px-2.5 py-1.5 font-medium text-muted-foreground', numeric ? 'text-right' : 'text-left')}>
                    <button type="button" onClick={() => toggleSort(col.key)}
                      className={cn('inline-flex cursor-pointer items-center gap-1 hover:text-foreground', numeric && 'flex-row-reverse')}>
                      <span>{col.label}{col.unit && col.kind !== 'currency' && col.kind !== 'percent' ? ` (${col.unit})` : ''}</span>
                      <SortIcon className="h-3 w-3 shrink-0" aria-hidden="true" />
                    </button>
                    {col.scope_note && <span className="block text-[10px] font-normal">{col.scope_note}</span>}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i} className="border-t border-border odd:bg-card even:bg-muted/20">
                {columns.map((col) => {
                  const numeric = col.kind !== 'text' && col.kind !== 'date';
                  const cell = row[col.key];
                  const missing = cell === null || cell === undefined;
                  return (
                    <td key={col.key} title={missing ? 'Không có dữ liệu' : undefined}
                      className={cn('px-2.5 py-1.5 text-foreground', numeric ? 'text-right tabular-nums' : 'max-w-[240px] truncate', missing && 'text-muted-foreground')}>
                      {numeric ? formatValue(cell, col.kind === 'currency' || col.kind === 'percent' ? col.unit : '', col.kind)
                        : missing ? '—' : String(cell)}
                    </td>
                  );
                })}
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={columns.length} className="px-2.5 py-4 text-center text-muted-foreground">Không có dòng nào khớp bộ lọc.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── error boundary ───────────────────────────────────────────────────────────

class ChartBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

// ── one visualization card ───────────────────────────────────────────────────

function ChartBody({ spec, type, visible, height }: { spec: CopilotVisualizationSpec; type: VizType; visible: VizField[]; height: number }) {
  const view = { ...spec, type };
  if (type === 'kpi') return <CopilotKpiCards spec={spec} />;
  if (type === 'table') return <CopilotDataTable spec={spec} maxHeight={height + 80} />;
  if (!visible.length) {
    return <p className="py-8 text-center text-[12px] text-muted-foreground">Đã ẩn mọi chuỗi dữ liệu - bật lại ở chú giải bên dưới.</p>;
  }
  if (type === 'line') return <CopilotLineChart spec={view} visible={visible} height={height} />;
  if (type === 'area') return <CopilotAreaChart spec={view} visible={visible} height={height} />;
  if (type === 'pie') return <CopilotPieChart spec={view} height={height} />;
  return <CopilotBarChart spec={view} visible={visible} height={height} />;
}

function Legend({ spec, hidden, onToggle }: { spec: CopilotVisualizationSpec; hidden: Set<string>; onToggle: (key: string) => void }) {
  if (spec.series.length < 2) return null;
  const toggle = spec.interactions.can_toggle_series;
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1" role="group" aria-label="Chú giải - bấm để ẩn/hiện chuỗi">
      {spec.series.map((field, i) => {
        const off = hidden.has(field.key);
        return (
          <button key={field.key} type="button" disabled={!toggle} aria-pressed={!off} onClick={() => onToggle(field.key)}
            className={cn('inline-flex items-center gap-1.5 text-[11px] text-foreground', toggle && 'cursor-pointer hover:underline', off && 'opacity-45')}>
            <svg width="16" height="8" aria-hidden="true">
              <line x1="0" y1="4" x2="16" y2="4" stroke={seriesColor(i)} strokeWidth={spec.type === 'bar' ? 6 : 2}
                strokeDasharray={spec.type === 'bar' ? undefined : DASHES[i]} />
            </svg>
            {field.label}
          </button>
        );
      })}
    </div>
  );
}

function Footer({ spec }: { spec: CopilotVisualizationSpec }) {
  const asOf = formatDataAsOf(spec.data_as_of);
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
      {spec.time_range?.label && <span className="inline-flex min-w-0 items-start gap-1"><Clock3 className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />{spec.time_range.label}</span>}
      <span className="inline-flex min-w-0 items-start gap-1"><MapPin className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />{spec.scope.label}</span>
      <span className="inline-flex min-w-0 items-start gap-1 break-all" title={spec.source.tools.join(', ')}>
        <Database className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />Nguồn: {spec.source.endpoints.join(', ') || spec.source.tools.join(', ')}
      </span>
      {asOf && <span>Ảnh chụp dữ liệu lúc {asOf}</span>}
    </div>
  );
}

function BudgetSimulator({ spec, onAsk, disabled }: { spec: CopilotVisualizationSpec; onAsk?: (q: string) => void; disabled?: boolean }) {
  const budget = spec.interactions.budget;
  const [value, setValue] = useState(() => budget?.current[budget.current.length - 1] ?? budget?.min ?? 0);
  if (!budget || !onAsk) return null;
  return (
    <div className="rounded-lg border border-dashed border-violet-300 bg-violet-50/40 px-3 py-2 dark:border-violet-500/30 dark:bg-violet-500/5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[12px] font-medium text-foreground">Thử mức ngân sách khác</p>
        <span className="text-[12px] font-semibold tabular-nums text-violet-700 dark:text-violet-300">{formatValue(value, '₫', 'currency')}</span>
      </div>
      <Slider className="my-2" min={budget.min} max={budget.max} step={budget.step} value={[value]}
        onValueChange={(v) => setValue(v[0])} thumbLabel="Ngân sách nhập sách" disabled={disabled} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px] text-muted-foreground">Hệ thống sẽ mô phỏng lại bằng dữ liệu thật; giao diện không tự ước lượng.</p>
        <button type="button" disabled={disabled} onClick={() => onAsk(budgetPrompt([value]))}
          className="cursor-pointer rounded-md bg-violet-600 px-2.5 py-1 text-[12px] font-medium text-white hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-50">
          Mô phỏng lại
        </button>
      </div>
    </div>
  );
}

interface CardProps {
  spec: CopilotVisualizationSpec;
  onAsk?: (question: string) => void;
  disabled?: boolean;
}

export function CopilotVisualization({ spec, onAsk, disabled }: CardProps) {
  const [type, setType] = useState<VizType>(spec.type);
  const [hidden, setHidden] = useState<Set<string>>(() => new Set(spec.series.filter((s) => s.hidden).map((s) => s.key)));
  const [expanded, setExpanded] = useState(false);
  const visible = spec.series.filter((s) => !hidden.has(s.key));
  const alternatives = [spec.type, ...switchableTypes(spec)].filter((t, i, all) => all.indexOf(t) === i);
  const isKpi = spec.type === 'kpi';
  const toggleSeries = (key: string) => setHidden((current) => {
    const next = new Set(current);
    if (next.has(key)) next.delete(key);
    else if (spec.series.length - next.size > 1) next.add(key); // keep one series on
    return next;
  });
  const fallback = (
    <div className="space-y-1">
      <p className="flex items-center gap-1.5 text-[12px] text-rose-700 dark:text-rose-400">
        <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />Không hiển thị được biểu đồ này; số liệu ở dạng bảng:
      </p>
      {!isKpi && <CopilotDataTable spec={spec} />}
    </div>
  );
  const body = (height: number) => (
    <ChartBoundary fallback={fallback}>
      <ChartBody spec={spec} type={type} visible={visible} height={height} />
    </ChartBoundary>
  );

  return (
    <section
      className={cn('space-y-2 rounded-xl border border-border bg-card/70 p-3 shadow-sm', SERIES_VARS)}
      aria-label={`${VIZ_TYPE_LABELS[type]}: ${spec.title}`}
      data-viz-id={spec.id}
      data-viz-type={type}
    >
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-[10rem] flex-1">
          <h4 className="text-[13px] font-semibold leading-snug text-foreground">{spec.title}</h4>
          {spec.description && <p className="text-[12px] leading-snug text-muted-foreground">{spec.description}</p>}
        </div>
        <div className="flex flex-wrap items-center justify-end gap-1">
          {spec.is_partial && (
            <span className="rounded-md border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300"
              title={spec.limitations.join(' ')}>
              Dữ liệu chưa đầy đủ
            </span>
          )}
          {!isKpi && alternatives.length > 1 && (
            <div className="flex items-center rounded-md border border-input p-0.5" role="radiogroup" aria-label="Kiểu hiển thị">
              {alternatives.map((t) => {
                const Icon = TYPE_ICONS[t];
                return (
                  <button key={t} type="button" role="radio" aria-checked={type === t} title={`Hiển thị dạng ${VIZ_TYPE_LABELS[t].toLowerCase()}`}
                    aria-label={`Dạng ${VIZ_TYPE_LABELS[t].toLowerCase()}`} onClick={() => setType(t)}
                    className={cn('cursor-pointer rounded p-1 text-muted-foreground hover:text-foreground',
                      type === t && 'bg-violet-100 text-violet-700 dark:bg-violet-500/20 dark:text-violet-300')}>
                    <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                );
              })}
            </div>
          )}
          {!isKpi && (
            <button type="button" onClick={() => setExpanded(true)} title="Mở rộng" aria-label={`Mở rộng ${spec.title}`}
              className="cursor-pointer rounded-md border border-input p-1 text-muted-foreground hover:text-foreground">
              <Maximize2 className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          )}
        </div>
      </header>

      {body(isKpi ? 0 : 240)}
      {type !== 'table' && type !== 'pie' && !isKpi && <Legend spec={spec} hidden={hidden} onToggle={toggleSeries} />}

      {spec.annotations.length > 0 && type !== 'table' && (
        <ul className="space-y-0.5 text-[11px] text-amber-800 dark:text-amber-300" aria-label="Kỳ chưa trọn">
          {spec.annotations.map((a) => (
            <li key={a.x} className="flex items-center gap-1.5">
              <svg width="10" height="10" aria-hidden="true"><circle cx="5" cy="5" r="3.5" fill="none" stroke={PARTIAL_COLOR} strokeWidth="1.5" strokeDasharray="2 1.5" /></svg>
              <span><span className="font-medium">{a.x}</span> (kỳ chưa trọn): {a.note}</span>
            </li>
          ))}
        </ul>
      )}
      {spec.limitations.length > 0 && (
        <ul className="list-disc space-y-0.5 pl-4 text-[11px] text-muted-foreground marker:text-muted-foreground/60">
          {spec.limitations.map((l) => <li key={l}>{l}</li>)}
        </ul>
      )}
      <BudgetSimulator spec={spec} onAsk={onAsk} disabled={disabled} />
      <Footer spec={spec} />
      {onAsk && spec.interactions.followups.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {spec.interactions.followups.map((q) => (
            <button key={q} type="button" disabled={disabled} onClick={() => onAsk(q)}
              className="inline-flex cursor-pointer items-center gap-1 rounded-full border border-border px-2.5 py-0.5 text-[11px] text-foreground hover:border-violet-300 hover:bg-violet-50 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:border-violet-500/30 dark:hover:bg-violet-500/10">
              <MessageCircleQuestion className="h-3 w-3 text-violet-500" aria-hidden="true" />{q}
            </button>
          ))}
        </div>
      )}

      <Dialog open={expanded} onOpenChange={setExpanded}>
        <DialogContent className={cn('max-h-[90vh] overflow-y-auto sm:max-w-4xl', SERIES_VARS)}>
          <DialogHeader>
            <DialogTitle>{spec.title}</DialogTitle>
            <DialogDescription>{spec.description || spec.time_range?.label || spec.scope.label}</DialogDescription>
          </DialogHeader>
          {body(440)}
          {type !== 'table' && type !== 'pie' && <Legend spec={spec} hidden={hidden} onToggle={toggleSeries} />}
          <Footer spec={spec} />
        </DialogContent>
      </Dialog>
    </section>
  );
}

/** A list of visualizations, in the order given (the backend orders them KPI → charts → tables). */
export function CopilotVisualizations({ items, onAsk, disabled }: { items: CopilotVisualizationSpec[]; onAsk?: (q: string) => void; disabled?: boolean }) {
  if (!items.length) return null;
  return (
    <div className="space-y-3">
      {items.map((spec) => <CopilotVisualization key={spec.id} spec={spec} onAsk={onAsk} disabled={disabled} />)}
    </div>
  );
}

export function CopilotVisualizationNotes({ notes }: { notes: string[] }) {
  if (!notes.length) return null;
  return (
    <ul className="space-y-0.5 text-[11px] text-muted-foreground" aria-label="Ghi chú trực quan hóa">
      {notes.map((note) => (
        <li key={note} className="flex gap-1.5"><BarChart3 className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />{note}</li>
      ))}
    </ul>
  );
}
