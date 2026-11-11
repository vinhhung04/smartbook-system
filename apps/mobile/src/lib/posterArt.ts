/**
 * Deterministic art for generated book covers. Most seeded books (~88% in the
 * live demo catalog) have no cover_image_url, so this is the primary cover
 * system, not a rare fallback: the same category always gets the same cloth,
 * so re-renders and re-fetches never flicker between looks.
 */
export function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash;
}

/**
 * Cloth binding colour for a generated cover: deep, slightly muted shades that
 * keep cream title text above 7:1 contrast. Same category, same cloth, so a
 * shelf of one category reads as a set.
 */
const CLOTH_POOL = ['#5B2333', '#22395E', '#2F4F3E', '#4A3365', '#6A3F1F', '#1F4A55', '#523B2A', '#3C3F66'];

export function getClothColor(category: string | null): string {
  return CLOTH_POOL[hashString(category ?? 'Chưa phân loại') % CLOTH_POOL.length];
}
