import type { ReorderSuggestionItem, RiskBand, RiskFactor, RiskModelEvaluation } from '@/services/analytics';

// Presentation rules for the decision center (/reorder-suggestions). Nothing here
// re-derives a forecast, a budget allocation or a risk score: it only classifies
// and totals what the analytics service returned. Kept free of runtime imports so
// tests/reorder-intelligence.test.mjs can load it directly.

// ── Reorder urgency ─────────────────────────────────────────────────────────────
// Urgency is what a buyer acts on: almost every candidate comes back HIGH priority,
// so the list is split by when the shelf runs empty relative to the supplier lead time.
export type Urgency = 'OUT' | 'BEFORE_RESTOCK' | 'LATER';
export const URGENCY_ORDER: Urgency[] = ['OUT', 'BEFORE_RESTOCK', 'LATER'];
const URGENCY_RANK: Record<Urgency, number> = { OUT: 0, BEFORE_RESTOCK: 1, LATER: 2 };

/**
 * The lead time an order placed now waits for this book: the per-item value the
 * service sized the quantity on (learned / supplier-declared), else the default.
 */
export function leadTimeOf(item: ReorderSuggestionItem, defaultLeadDays: number) {
  return item.lead_time_days ?? defaultLeadDays;
}

export function urgencyOf(item: ReorderSuggestionItem, defaultLeadDays: number): Urgency {
  if (item.available_qty <= 0) return 'OUT';
  const days = item.estimated_days_until_stockout;
  if (days !== null && days !== undefined && days <= leadTimeOf(item, defaultLeadDays)) return 'BEFORE_RESTOCK';
  return 'LATER';
}

/** Most urgent first, then soonest stockout, then strongest demand. */
export function sortByUrgency(items: ReorderSuggestionItem[], leadDays: number) {
  return [...items].sort((a, b) => {
    const ua = urgencyOf(a, leadDays);
    const ub = urgencyOf(b, leadDays);
    if (ua !== ub) return URGENCY_RANK[ua] - URGENCY_RANK[ub];
    const da = a.estimated_days_until_stockout ?? Number.POSITIVE_INFINITY;
    const db = b.estimated_days_until_stockout ?? Number.POSITIVE_INFINITY;
    return da - db || b.demand_score - a.demand_score;
  });
}

export function countByUrgency(items: ReorderSuggestionItem[], leadDays: number) {
  const counts: Record<Urgency, number> = { OUT: 0, BEFORE_RESTOCK: 0, LATER: 0 };
  for (const item of items) counts[urgencyOf(item, leadDays)] += 1;
  return counts;
}

export function stockoutText(item: ReorderSuggestionItem) {
  if (item.available_qty <= 0) return 'Đã hết hàng';
  const days = item.estimated_days_until_stockout;
  if (days === null || days === undefined) return 'Chưa xác định';
  return `Hết sau ~${Math.round(days).toLocaleString('vi-VN')} ngày`;
}

// ── Budget funding ──────────────────────────────────────────────────────────────
// With a budget the service re-sizes each line against its inventory position
// (budget_plan.cap_qty) and funds copies up to that cap. A line whose cap is 0 is
// not "over budget" - the plan simply needs nothing for it.
export type FundingStatus = 'FULL' | 'PARTIAL' | 'UNFUNDED' | 'NOT_NEEDED';

export function fundingStatus(item: ReorderSuggestionItem, hasBudget: boolean): FundingStatus | null {
  if (!hasBudget) return null;
  const cap = item.budget_plan?.cap_qty ?? item.suggested_reorder_qty;
  const funded = item.funded_qty ?? 0;
  if (cap <= 0) return 'NOT_NEEDED';
  if (funded <= 0) return 'UNFUNDED';
  if (funded < cap) return 'PARTIAL';
  return 'FULL';
}

/** Quantity the system proposes for a line: what the budget funds, else the plain suggestion. */
export function systemQty(item: ReorderSuggestionItem, hasBudget: boolean) {
  return hasBudget && item.funded_qty ? item.funded_qty : item.suggested_reorder_qty;
}

export const MAX_ORDER_QTY = 99999;

/** A typed quantity: a whole number of copies from 1 to MAX_ORDER_QTY, else null. */
export function parseQty(raw: string): number | null {
  const text = raw.trim();
  if (!/^\d+$/.test(text)) return null;
  const value = Number(text);
  return value >= 1 && value <= MAX_ORDER_QTY ? value : null;
}

/** A unit cost of 0 means the catalog has no price yet - never "free". */
export function lineCost(qty: number | null, unitCost: number): number | null {
  if (qty === null || !(unitCost > 0)) return null;
  return qty * unitCost;
}

export interface LineTotals {
  lines: number;
  qty: number;
  cost: number;
  /** Lines with a quantity but no unit cost: left out of `cost`. */
  missingCost: number;
  /** Lines without a valid order quantity (empty, 0, not a whole number). */
  invalidQty: number;
}

export function totalLines(lines: Array<{ qty: number | null; unitCost: number }>): LineTotals {
  const totals: LineTotals = { lines: lines.length, qty: 0, cost: 0, missingCost: 0, invalidQty: 0 };
  for (const line of lines) {
    if (line.qty === null || line.qty < 1) {
      totals.invalidQty += 1;
      continue;
    }
    totals.qty += line.qty;
    const cost = lineCost(line.qty, line.unitCost);
    if (cost === null) totals.missingCost += 1; else totals.cost += cost;
  }
  return totals;
}

/** One suggestion as the plan shows it: the system's quantity, the user's edit, and what it costs. */
export interface PlanLine {
  item: ReorderSuggestionItem;
  urgency: Urgency;
  /** Lead time the urgency was judged against (per book, else the default). */
  leadDays: number;
  funding: FundingStatus | null;
  systemQty: number;
  /** Raw text the user typed; undefined while the line keeps the system quantity. */
  draft: string | undefined;
  /** Order quantity, or null when there is none to order (typed text invalid, or system quantity 0). */
  qty: number | null;
  /** The user changed the quantity away from the system's. */
  manual: boolean;
  /** Copies above what the budget funds (budget mode only). */
  overFunded: number;
  cost: number | null;
}

export function buildPlanLine(item: ReorderSuggestionItem, leadDays: number, hasBudget: boolean, draft: string | undefined): PlanLine {
  const proposed = systemQty(item, hasBudget);
  const qty = draft !== undefined ? parseQty(draft) : (proposed >= 1 ? proposed : null);
  const funded = item.funded_qty ?? 0;
  return {
    item,
    urgency: urgencyOf(item, leadDays),
    leadDays: leadTimeOf(item, leadDays),
    funding: fundingStatus(item, hasBudget),
    systemQty: proposed,
    draft,
    qty,
    manual: draft !== undefined && qty !== proposed,
    overFunded: hasBudget && qty !== null ? Math.max(0, qty - funded) : 0,
    cost: lineCost(qty, item.unit_cost),
  };
}

// ── Risk models ─────────────────────────────────────────────────────────────────
/** Band cut-offs the analytics service applies: HIGH ≥ threshold, MEDIUM ≥ threshold / 2. */
export function riskBandCutoffs(evaluation: RiskModelEvaluation | undefined) {
  const high = evaluation?.best_threshold?.threshold ?? 0.5;
  return { high, medium: high / 2 };
}

export const RISK_BAND_ORDER: RiskBand[] = ['HIGH', 'MEDIUM', 'LOW'];

/** Each factor's share of the largest |contribution| in the same row (0-1), for bar lengths. */
export function factorWeights(factors: RiskFactor[]) {
  const max = Math.max(0, ...factors.map((factor) => Math.abs(factor.contribution)));
  return factors.map((factor) => ({ ...factor, weight: max > 0 ? Math.abs(factor.contribution) / max : 0 }));
}

/** The service explains INSUFFICIENT_DATA in English; known shapes get a Vietnamese reading. */
export function describeInsufficientReason(reason: string | undefined) {
  if (!reason) return null;
  let match = reason.match(/need at least (\d+) labelled samples, have (\d+)/);
  if (match) return `Cần ít nhất ${match[1]} trường hợp đã có kết quả để huấn luyện, hiện mới có ${match[2]}.`;
  match = reason.match(/need at least (\d+) positive examples and at least one negative, have (\d+)\/(\d+)/);
  if (match) return `Cần ít nhất ${match[1]} trường hợp xảy ra sự kiện và ít nhất một trường hợp không xảy ra; hiện có ${match[2]}/${match[3]}.`;
  if (reason.includes('temporal split')) return 'Sau khi tách dữ liệu theo thời gian, phần huấn luyện hoặc kiểm tra còn quá ít.';
  if (reason.includes('only one class')) return 'Dữ liệu huấn luyện chỉ có một loại kết quả nên mô hình chưa thể học sự khác biệt.';
  return null;
}

// ── Formatting ──────────────────────────────────────────────────────────────────
export function formatVnd(value: number) {
  return `${Math.round(value).toLocaleString('vi-VN')} đ`;
}

export function formatCount(value: number) {
  return value.toLocaleString('vi-VN');
}

export function formatPercent(value: number, digits = 0) {
  return `${(value * 100).toFixed(digits).replace('.', ',')}%`;
}

export function formatDateTime(value: string | null | undefined) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' });
}

export function formatDate(value: string | null | undefined) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('vi-VN');
}
