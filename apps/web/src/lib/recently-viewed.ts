// Per-browser convenience only: a short list of books this visitor opened, so the
// homepage can offer "Bạn đã xem gần đây". Never sent anywhere; storage may be
// unavailable (private mode, blocked site data), so every access is guarded.
const STORAGE_KEY = 'smartbook:recently-viewed';
const MAX_ITEMS = 8;

export interface RecentlyViewedBook {
  id: string;
  title: string;
  author: string | null;
  cover_image_url: string | null;
}

export function readRecentlyViewed(): RecentlyViewedBook[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    return Array.isArray(parsed) ? parsed.filter((item) => item && typeof item.id === 'string' && typeof item.title === 'string') : [];
  } catch {
    return [];
  }
}

export function rememberViewed(book: RecentlyViewedBook) {
  try {
    const next = [
      { id: book.id, title: book.title, author: book.author, cover_image_url: book.cover_image_url },
      ...readRecentlyViewed().filter((item) => item.id !== book.id),
    ].slice(0, MAX_ITEMS);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Storage blocked: the feature simply stays empty.
  }
}

export function clearRecentlyViewed() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
