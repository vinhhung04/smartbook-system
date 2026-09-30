// Pure presentation logic for AI decision-support surfaces. No React, no
// imports with path aliases, so it can be unit-tested with plain `node --test`
// (see tests/ai-decision.test.mjs).
//
// Wording rule shared by every helper here: the system *proposes*, a person
// *decides*. Scores produced by heuristics or rankers are never rendered as
// percentages or "confidence" — they are bucketed into ordinal labels that
// describe ranking, not probability.

export type Tone = 'success' | 'warning' | 'danger' | 'neutral' | 'info';

// ── Recommendation ranking tiers ────────────────────────────────────────────
// V1: ai-service/recommendation.py returns score = 0.40*semantic + 0.35*affinity
// + 0.15*quality + 0.10*availability. It is a ranking score, NOT a calibrated
// probability of the reader liking the book, so it is shown as a tier.
// Without embeddings (semantic = 0) the maximum reachable score is 0.60, which
// is why the top tier starts well below 1.
export const RECOMMENDATION_TIER_HIGH_MIN_SCORE = 0.55;
export const RECOMMENDATION_TIER_MID_MIN_SCORE = 0.35;

export type RecommendationTier = 'STRONG' | 'GOOD' | 'EXPLORE';

export const RECOMMENDATION_TIER_LABEL: Record<RecommendationTier, string> = {
  STRONG: 'Rất phù hợp',
  GOOD: 'Phù hợp',
  EXPLORE: 'Khám phá thêm',
};

export const RECOMMENDATION_TIER_TONE: Record<RecommendationTier, Tone> = {
  STRONG: 'success',
  GOOD: 'info',
  EXPLORE: 'neutral',
};

const TIERS: readonly RecommendationTier[] = ['STRONG', 'GOOD', 'EXPLORE'];

// Recommendation V2 sends its own `tier`, derived from which signals lifted the
// book (see recommendation_v2.tier); its `score` is only a rank position inside
// the reader's candidate pool. When a valid server tier is present it wins;
// otherwise (V1) the score thresholds above apply.
export function recommendationTier(score: number | null | undefined, serverTier?: string | null): RecommendationTier {
  const t = String(serverTier || '').toUpperCase() as RecommendationTier;
  if (TIERS.includes(t)) return t;
  const s = typeof score === 'number' && Number.isFinite(score) ? score : 0;
  if (s >= RECOMMENDATION_TIER_HIGH_MIN_SCORE) return 'STRONG';
  if (s >= RECOMMENDATION_TIER_MID_MIN_SCORE) return 'GOOD';
  return 'EXPLORE';
}

export interface RecommendationBreakdown {
  semantic?: number | null;
  affinity?: number | null;
  quality?: number | null;
  availability?: number | null;
}

// V2 reason codes -> the factor line shown under "Vì sao gợi ý sách này?".
// Each code is emitted by the server only when that signal actually lifted the
// book above the reader's average candidate.
export const REASON_CODE_FACTOR: Record<string, string> = {
  MATCHED_CATEGORY: 'Thuộc thể loại bạn thường mượn',
  MATCHED_AUTHOR: 'Cùng tác giả với sách bạn đã đọc',
  SIMILAR_USERS_LIKED: 'Bạn đọc có lịch sử mượn giống bạn cũng mượn cuốn này',
  SIMILAR_CONTENT: 'Nội dung gần với những cuốn bạn đã đọc',
  POPULAR_IN_RECENT_PERIOD: 'Đang được mượn nhiều gần đây',
  POPULAR_OVERALL: 'Thuộc nhóm sách được mượn nhiều',
  HIGH_RATING: 'Được bạn đọc khác đánh giá tốt',
  NEW_ARRIVAL: 'Sách mới về thư viện',
  CURRENTLY_UNAVAILABLE: 'Hiện đang hết sách — có thể đặt trước',
  COLD_START_FALLBACK: 'Gợi ý chung khi chưa có lịch sử đọc của bạn',
};

// Thresholds mirror the ones ai-service uses to phrase its own reasons
// (_build_recommendation_reason_prompt / rule_based_reason), so the listed
// factors never contradict the text reason next to them.
export const FACTOR_AFFINITY_MIN = 0.3;
export const FACTOR_SEMANTIC_MIN = 0.6;
export const FACTOR_QUALITY_MIN = 0.7;

/** Human-readable factors that genuinely contributed to the ranking. */
export function recommendationFactors(
  breakdown: RecommendationBreakdown | null | undefined,
  reasonCodes?: string[] | null,
): string[] {
  if (Array.isArray(reasonCodes)) {
    return reasonCodes.map((code) => REASON_CODE_FACTOR[code]).filter((text): text is string => Boolean(text));
  }
  if (!breakdown) return [];
  const factors: string[] = [];
  if ((breakdown.affinity ?? 0) >= FACTOR_AFFINITY_MIN) factors.push('Cùng thể loại hoặc tác giả với sách bạn đã mượn, yêu thích hay đánh giá cao');
  if ((breakdown.semantic ?? 0) >= FACTOR_SEMANTIC_MIN) factors.push('Nội dung gần với những cuốn bạn đã đọc');
  if ((breakdown.quality ?? 0) >= FACTOR_QUALITY_MIN) factors.push('Được bạn đọc khác đánh giá tốt');
  if (typeof breakdown.availability === 'number' && breakdown.availability < 1) factors.push('Hiện đang hết sách — có thể đặt trước');
  return factors;
}

// ── Storage suggestion suitability ──────────────────────────────────────────
// inventory-service returns `confidence` HIGH/MEDIUM/LOW, but it is only a
// threshold on a rule-based score (see storage-suggestion.service.js header),
// so it is presented as suitability of the location, not certainty.
export const STORAGE_SUITABILITY: Record<string, { label: string; tone: Tone }> = {
  HIGH: { label: 'Rất phù hợp', tone: 'success' },
  MEDIUM: { label: 'Phù hợp', tone: 'info' },
  LOW: { label: 'Có thể cân nhắc', tone: 'neutral' },
};

export function storageSuitability(level: string | null | undefined): { label: string; tone: Tone } {
  return STORAGE_SUITABILITY[String(level || '').toUpperCase()] ?? STORAGE_SUITABILITY.LOW;
}

// ── Priority / risk wording ─────────────────────────────────────────────────
export const PRIORITY_LABEL: Record<string, string> = {
  HIGH: 'Ưu tiên cao',
  MEDIUM: 'Ưu tiên vừa',
  LOW: 'Ưu tiên thấp',
  URGENT: 'Khẩn cấp',
};
export const PRIORITY_TONE: Record<string, Tone> = { URGENT: 'danger', HIGH: 'danger', MEDIUM: 'warning', LOW: 'neutral' };

export function priorityLabel(priority: string | null | undefined): string {
  const key = String(priority || 'MEDIUM').toUpperCase();
  return PRIORITY_LABEL[key] ?? key;
}
export function priorityTone(priority: string | null | undefined): Tone {
  return PRIORITY_TONE[String(priority || 'MEDIUM').toUpperCase()] ?? 'neutral';
}

// ── Stock-line summaries for reorder drafts / stock alerts ──────────────────
export interface StockLine {
  title?: string | null;
  current_stock?: number | null;
  reorder_point?: number | null;
  threshold?: number | null;
  suggested_quantity?: number | null;
  priority?: string | null;
  warehouse_id?: string | null;
  warehouse_name?: string | null;
  warehouse_code?: string | null;
  suggested_supplier_name?: string | null;
  book_variant_id?: string | null;
}

export interface StockLinesSummary {
  lineCount: number;
  titleCount: number;
  totalSuggestedQty: number;
  highPriorityCount: number;
  outOfStockCount: number;
  belowMinimumCount: number;
  withSupplierCount: number;
  missingWarehouseCount: number;
  warehouses: string[];
  currentStockTotal: number;
}

function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function summarizeStockLines(lines: StockLine[]): StockLinesSummary {
  const named = lines.filter((l) => l && l.title);
  const warehouses = new Set<string>();
  const titles = new Set<string>();
  let totalSuggestedQty = 0;
  let highPriorityCount = 0;
  let outOfStockCount = 0;
  let belowMinimumCount = 0;
  let withSupplierCount = 0;
  let missingWarehouseCount = 0;
  let currentStockTotal = 0;
  for (const l of named) {
    titles.add(String(l.title));
    totalSuggestedQty += Math.max(0, num(l.suggested_quantity));
    currentStockTotal += Math.max(0, num(l.current_stock));
    if (String(l.priority || '').toUpperCase() === 'HIGH') highPriorityCount += 1;
    if (l.current_stock !== null && l.current_stock !== undefined && num(l.current_stock) === 0) outOfStockCount += 1;
    const minimum = l.reorder_point ?? l.threshold;
    if (minimum !== null && minimum !== undefined && num(l.current_stock) > 0 && num(l.current_stock) < num(minimum)) belowMinimumCount += 1;
    if (l.suggested_supplier_name) withSupplierCount += 1;
    if (l.warehouse_id) warehouses.add(l.warehouse_name || l.warehouse_code || String(l.warehouse_id));
    else missingWarehouseCount += 1;
  }
  return {
    lineCount: named.length,
    titleCount: titles.size,
    totalSuggestedQty,
    highPriorityCount,
    outOfStockCount,
    belowMinimumCount,
    withSupplierCount,
    missingWarehouseCount,
    warehouses: Array.from(warehouses),
    currentStockTotal,
  };
}

/** Groups lines by warehouse (lines without one go last under `null`). */
export function groupLinesByWarehouse<T extends StockLine>(lines: T[]): Array<{ key: string | null; label: string; lines: T[] }> {
  const groups = new Map<string | null, { key: string | null; label: string; lines: T[] }>();
  for (const l of lines) {
    if (!l || !l.title) continue;
    const key = l.warehouse_id || null;
    if (!groups.has(key)) {
      const label = key ? `${l.warehouse_name || l.warehouse_code || 'Kho'}${l.warehouse_code && l.warehouse_name ? ` (${l.warehouse_code})` : ''}` : 'Chưa xác định kho';
      groups.set(key, { key, label, lines: [] });
    }
    groups.get(key)!.lines.push(l);
  }
  return Array.from(groups.values()).sort((a, b) => (a.key === null ? 1 : b.key === null ? -1 : 0));
}

// ── Confirm permission (mirrors ai-service agent_permissions.can_confirm_action) ──
// The backend is the authority (it answers 403); this only lets the card say
// up front that the current user cannot sign off, instead of failing on click.
export interface ConfirmingUser {
  is_superuser?: boolean;
  roles?: string[];
  permissions?: string[];
}

const normalizeRole = (role: string) => String(role).toUpperCase().replace(/-/g, '_');

export function canUserConfirmAction(
  user: ConfirmingUser | null | undefined,
  action: { allowed_roles?: string[] | null; allowed_permissions?: string[] | null },
): boolean {
  if (!user) return false;
  if (user.is_superuser) return true;
  const roles = new Set((user.roles || []).map(normalizeRole));
  if ((action.allowed_roles || []).some((r) => roles.has(normalizeRole(r)))) return true;
  const perms = new Set(user.permissions || []);
  return (action.allowed_permissions || []).some((p) => perms.has(p));
}
