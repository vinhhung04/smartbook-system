// Client side of the AI Copilot 3.0 visualization contract
// (services/ai-service/copilot_visualization.py). The backend builds and
// validates every spec from tool data; this module re-checks what arrives
// (live answers and conversations reopened from history alike) before
// anything is rendered: whitelisted types only, finite numbers only, bounded
// sizes. A spec that fails is dropped - never "repaired" into a guess.
// Pure functions, no imports: unit-tested with `node --test`.

export type VizType = 'line' | 'bar' | 'area' | 'pie' | 'kpi' | 'table';
export type VizValueKind = 'count' | 'currency' | 'percent' | 'days' | 'rate' | 'rank' | 'text' | 'date';
export type VizCell = string | number | null;

export interface VizField {
  key: string;
  label: string;
  unit: string;
  kind: VizValueKind;
  scope_note: string;
  hidden: boolean;
}

export interface VizKpi {
  key: string;
  label: string;
  value: number | null;
  unit: string;
  kind: VizValueKind;
  note: string;
  delta: number | null;
  delta_unit: string;
  delta_label: string;
}

export interface VizBudgetControl {
  min: number;
  max: number;
  step: number;
  current: number[];
}

export interface CopilotVisualizationSpec {
  id: string;
  type: VizType;
  title: string;
  description: string;
  x_key: string | null;
  x_label: string;
  x_kind: 'time' | 'category' | null;
  y_label: string;
  series: VizField[];
  data: Array<Record<string, VizCell>>;
  kpis: VizKpi[];
  source: { tools: string[]; endpoints: string[] };
  scope: { level: 'system' | 'warehouse' | 'warehouses' | 'item'; label: string };
  time_range: { label: string; start?: string | null; end?: string | null } | null;
  data_as_of: string;
  is_partial: boolean;
  limitations: string[];
  annotations: Array<{ x: string; note: string }>;
  summary: Record<string, VizCell>;
  interactions: {
    allowed_types: VizType[];
    can_toggle_series: boolean;
    sortable: boolean;
    filterable: boolean;
    followups: string[];
    budget: VizBudgetControl | null;
  };
  snapshot: boolean;
}

export const VIZ_TYPES: readonly VizType[] = ['line', 'bar', 'area', 'pie', 'kpi', 'table'];
export const CHART_TYPES: readonly VizType[] = ['line', 'bar', 'area', 'pie'];
export const VIZ_LIMITS = { visualizations: 4, chartPoints: 60, tableRows: 50, series: 4, pieSlices: 8, kpis: 6, text: 200 };
const NUMERIC_KINDS: readonly VizValueKind[] = ['count', 'currency', 'percent', 'days', 'rate', 'rank'];
const KINDS: readonly VizValueKind[] = [...NUMERIC_KINDS, 'text', 'date'];

export const VIZ_TYPE_LABELS: Record<VizType, string> = {
  line: 'Đường',
  bar: 'Cột',
  area: 'Miền',
  pie: 'Tròn',
  kpi: 'Chỉ số',
  table: 'Bảng',
};

type Raw = Record<string, unknown>;

const isObject = (value: unknown): value is Raw => typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown, limit = VIZ_LIMITS.text): string =>
  typeof value === 'string' ? (value.length > limit ? `${value.slice(0, limit - 1)}…` : value) : '';
const finiteOrNull = (value: unknown): number | null | undefined => {
  if (value === null) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  return undefined;
};

function readField(raw: unknown): VizField | null {
  if (!isObject(raw) || typeof raw.key !== 'string' || !/^[a-z][a-z0-9_]{0,40}$/.test(raw.key)) return null;
  const kind = KINDS.includes(raw.kind as VizValueKind) ? (raw.kind as VizValueKind) : 'count';
  return {
    key: raw.key,
    label: text(raw.label) || raw.key,
    unit: text(raw.unit, 20),
    kind,
    scope_note: text(raw.scope_note),
    hidden: raw.hidden === true,
  };
}

function readKpi(raw: unknown): VizKpi | null {
  if (!isObject(raw) || typeof raw.key !== 'string' || !text(raw.label)) return null;
  const value = finiteOrNull(raw.value ?? null);
  const delta = finiteOrNull(raw.delta ?? null);
  if (value === undefined || delta === undefined) return null;
  return {
    key: raw.key,
    label: text(raw.label),
    value,
    unit: text(raw.unit, 20),
    kind: KINDS.includes(raw.kind as VizValueKind) ? (raw.kind as VizValueKind) : 'count',
    note: text(raw.note),
    delta,
    delta_unit: text(raw.delta_unit, 20),
    delta_label: text(raw.delta_label),
  };
}

/** One spec, or null when anything about it is off. */
export function sanitizeVisualization(raw: unknown): CopilotVisualizationSpec | null {
  if (!isObject(raw)) return null;
  const type = raw.type as VizType;
  if (!VIZ_TYPES.includes(type) || typeof raw.id !== 'string' || !text(raw.title)) return null;
  const interactions = isObject(raw.interactions) ? raw.interactions : {};
  const allowed = (Array.isArray(interactions.allowed_types) ? interactions.allowed_types : [type])
    .filter((t): t is VizType => VIZ_TYPES.includes(t as VizType));
  if (!allowed.includes(type)) allowed.unshift(type);

  const series = (Array.isArray(raw.series) ? raw.series : []).map(readField);
  if (series.some((f) => f === null)) return null;
  const fields = series as VizField[];

  const kpis = (Array.isArray(raw.kpis) ? raw.kpis : []).map(readKpi);
  if (kpis.some((k) => k === null)) return null;

  const rows = Array.isArray(raw.data) ? raw.data : [];
  const data: Array<Record<string, VizCell>> = [];
  for (const row of rows) {
    if (!isObject(row)) return null;
    const clean: Record<string, VizCell> = {};
    for (const [key, value] of Object.entries(row)) {
      if (typeof value === 'string') clean[key] = text(value);
      else {
        const num = finiteOrNull(value);
        if (num === undefined) return null; // NaN, Infinity, objects, booleans
        clean[key] = num;
      }
    }
    for (const field of fields) {
      const cell = clean[field.key];
      if (NUMERIC_KINDS.includes(field.kind) && cell !== undefined && cell !== null && typeof cell !== 'number') return null;
    }
    data.push(clean);
  }

  const xKey = typeof raw.x_key === 'string' ? raw.x_key : null;
  if (type === 'kpi') {
    if (kpis.length < 1 || kpis.length > VIZ_LIMITS.kpis) return null;
  } else {
    if (!data.length || !fields.length) return null;
    if (type === 'table' ? data.length > VIZ_LIMITS.tableRows : data.length > VIZ_LIMITS.chartPoints) return null;
    if (type !== 'table') {
      if (!xKey || fields.length > VIZ_LIMITS.series) return null;
      if (new Set(fields.map((f) => `${f.unit}|${f.kind}`)).size !== 1) return null; // one unit per chart
      if (type === 'pie' && (fields.length !== 1 || data.length > VIZ_LIMITS.pieSlices
        || data.some((row) => typeof row[fields[0].key] !== 'number' || (row[fields[0].key] as number) < 0))) return null;
    }
  }

  const source = isObject(raw.source) ? raw.source : {};
  const scope = isObject(raw.scope) ? raw.scope : {};
  const timeRange = isObject(raw.time_range) ? raw.time_range : null;
  const budget = isObject(interactions.budget) ? interactions.budget : null;
  const budgetOk = budget && [budget.min, budget.max, budget.step].every((v) => typeof v === 'number' && Number.isFinite(v))
    && (budget.max as number) > (budget.min as number) && (budget.step as number) > 0;
  const summary: Record<string, VizCell> = {};
  if (isObject(raw.summary)) {
    for (const [k, v] of Object.entries(raw.summary)) {
      if (typeof v === 'string' || (typeof v === 'number' && Number.isFinite(v)) || v === null) summary[k] = v as VizCell;
    }
  }
  return {
    id: raw.id,
    type,
    title: text(raw.title),
    description: text(raw.description, 400),
    x_key: xKey,
    x_label: text(raw.x_label),
    x_kind: raw.x_kind === 'time' || raw.x_kind === 'category' ? raw.x_kind : null,
    y_label: text(raw.y_label),
    series: fields,
    data,
    kpis: kpis as VizKpi[],
    source: {
      tools: (Array.isArray(source.tools) ? source.tools : []).filter((t): t is string => typeof t === 'string'),
      endpoints: (Array.isArray(source.endpoints) ? source.endpoints : []).filter((t): t is string => typeof t === 'string'),
    },
    scope: {
      level: (['system', 'warehouse', 'warehouses', 'item'] as const).includes(scope.level as never)
        ? (scope.level as CopilotVisualizationSpec['scope']['level']) : 'system',
      label: text(scope.label),
    },
    time_range: timeRange ? { label: text(timeRange.label), start: text(timeRange.start) || null, end: text(timeRange.end) || null } : null,
    data_as_of: text(raw.data_as_of, 40),
    is_partial: raw.is_partial === true,
    limitations: (Array.isArray(raw.limitations) ? raw.limitations : []).map((l) => text(l)).filter(Boolean).slice(0, 6),
    annotations: (Array.isArray(raw.annotations) ? raw.annotations : [])
      .filter(isObject).map((a) => ({ x: text(a.x), note: text(a.note) })).filter((a) => a.x && a.note),
    summary,
    interactions: {
      allowed_types: allowed,
      can_toggle_series: interactions.can_toggle_series === true,
      sortable: interactions.sortable === true,
      filterable: interactions.filterable === true,
      followups: (Array.isArray(interactions.followups) ? interactions.followups : []).map((f) => text(f)).filter(Boolean).slice(0, 3),
      budget: budgetOk ? {
        min: budget.min as number, max: budget.max as number, step: budget.step as number,
        current: (Array.isArray(budget.current) ? budget.current : []).filter((v): v is number => typeof v === 'number' && Number.isFinite(v)),
      } : null,
    },
    snapshot: raw.snapshot !== false,
  };
}

/** Every spec that passes, at most VIZ_LIMITS.visualizations. Anything else -> []. */
export function sanitizeVisualizations(raw: unknown): CopilotVisualizationSpec[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(sanitizeVisualization).filter((v): v is CopilotVisualizationSpec => v !== null).slice(0, VIZ_LIMITS.visualizations);
}

// ── formatting (vi-VN) ───────────────────────────────────────────────────────

const NUMBER = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 1 });
const COMPACT = new Intl.NumberFormat('vi-VN', { notation: 'compact', maximumFractionDigits: 1 });

/** Missing stays visibly missing ("—"), never 0. */
export function formatValue(value: VizCell | undefined, unit = '', kind: VizValueKind = 'count'): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'string') return value;
  if (kind === 'rank') return `#${NUMBER.format(value)}`;
  if (kind === 'currency' || unit === '₫') return `${NUMBER.format(Math.round(value))} ₫`;
  if (kind === 'percent' || unit === '%') return `${NUMBER.format(value)}%`;
  return unit ? `${NUMBER.format(value)} ${unit}` : NUMBER.format(value);
}

/** Short axis tick ("1,5 Tr", "20 N") - full value lives in the tooltip. */
export function formatAxisTick(value: number, kind: VizValueKind = 'count'): string {
  if (!Number.isFinite(value)) return '';
  if (kind === 'percent') return `${NUMBER.format(value)}%`;
  return Math.abs(value) >= 10_000 ? COMPACT.format(value) : NUMBER.format(value);
}

export function formatDataAsOf(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function truncateLabel(label: string, max = 18): string {
  return label.length > max ? `${label.slice(0, max - 1)}…` : label;
}

// ── tables ───────────────────────────────────────────────────────────────────

/** Columns of the table view: a chart's x column first, then its fields. */
export function tableColumns(spec: CopilotVisualizationSpec): VizField[] {
  const columns = [...spec.series];
  if (spec.x_key && !columns.some((c) => c.key === spec.x_key)) {
    columns.unshift({ key: spec.x_key, label: spec.x_label || 'Nhãn', unit: '', kind: 'text', scope_note: '', hidden: false });
  }
  return columns;
}

export type SortDirection = 'asc' | 'desc';

/** Sorted copy. Missing values always sink to the bottom, whatever the direction. */
export function sortRows(rows: Array<Record<string, VizCell>>, key: string, direction: SortDirection) {
  const sign = direction === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const x = a[key];
    const y = b[key];
    if (x === null || x === undefined) return y === null || y === undefined ? 0 : 1;
    if (y === null || y === undefined) return -1;
    if (typeof x === 'number' && typeof y === 'number') return (x - y) * sign;
    return String(x).localeCompare(String(y), 'vi') * sign;
  });
}

const fold = (value: string) => value.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();

/** Rows whose text cells contain `query`, accent-insensitive ("ha noi" finds "Hà Nội"). */
export function filterRows(rows: Array<Record<string, VizCell>>, query: string) {
  const needle = fold(query.trim());
  if (!needle) return rows;
  return rows.filter((row) => Object.values(row).some((cell) => typeof cell === 'string' && fold(cell).includes(needle)));
}

/** Types the user may switch this spec to, excluding the current one. */
export function switchableTypes(spec: CopilotVisualizationSpec): VizType[] {
  return spec.interactions.allowed_types.filter((t) => t !== spec.type && t !== 'kpi');
}

/** What the slider sends as a chat turn - the backend recomputes, the UI never interpolates. */
export function budgetPrompt(budgets: number[]): string {
  const fmt = (v: number) => (v % 1_000_000 === 0 ? `${v / 1_000_000} triệu` : `${NUMBER.format(v)} đồng`);
  return `Nếu ngân sách nhập sách là ${budgets.map(fmt).join(', ')} thì sao? Hiển thị biểu đồ.`;
}
