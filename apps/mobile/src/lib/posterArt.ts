/**
 * Deterministic "generated book jacket" art — most seeded books (~88% in the
 * live demo catalog) have no cover_image_url, so this is the PRIMARY poster
 * system, not a rare fallback. Same category always gets the same gradient
 * and the same title always gets the same monogram, so re-renders/re-fetches
 * never flicker between looks.
 */
type CategoryGradient = [string, string];

const KNOWN_CATEGORY_GRADIENTS: Record<string, CategoryGradient> = {
  'Van hoc Viet Nam': ['#7A2E2E', '#2B0F12'],
  'Van hoc Nuoc Ngoai': ['#1F3A5F', '#0B1622'],
  'Truyen ngan': ['#3E2B5B', '#160F26'],
  'Ky nang song': ['#1F5C4F', '#0A1F1A'],
  'Chưa phân loại': ['#4A4438', '#161310'],
};

const FALLBACK_GRADIENT_POOL: CategoryGradient[] = [
  ['#5C3A21', '#1B0E06'],
  ['#2E4A3E', '#0C1712'],
  ['#4A2E4A', '#150A15'],
  ['#3A4A2E', '#0F150A'],
  ['#2E3A4A', '#0A0F15'],
  ['#4A3A2E', '#150F0A'],
];

export function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash;
}

export function getCategoryGradient(category: string | null): CategoryGradient {
  const key = category ?? 'Chưa phân loại';
  const known = KNOWN_CATEGORY_GRADIENTS[key];
  if (known) return known;
  return FALLBACK_GRADIENT_POOL[hashString(key) % FALLBACK_GRADIENT_POOL.length];
}

export function getMonogramLetter(title: string): string {
  const match = title.trim().match(/[\p{L}]/u);
  return match ? match[0].toUpperCase() : '#';
}
