import type { DiscoverResult } from '../api/discover';

export const MIN_DISCOVER_CHARS = 3;
export const MAX_DISCOVER_CHARS = 200;

export function normalizeDiscoverQuery(raw: string): { ok: true; query: string } | { ok: false; error: string } {
  const query = raw.split(/\s+/).filter(Boolean).join(' ');
  if (query.length < MIN_DISCOVER_CHARS) return { ok: false, error: 'Hãy mô tả ít nhất vài chữ về cuốn sách bạn muốn đọc.' };
  return { ok: true, query: query.slice(0, MAX_DISCOVER_CHARS) };
}

/** The assistant's own words are fixed templates around catalog facts — never generated text. */
export function describeDiscoverResult(result: DiscoverResult): string {
  const count = result.results.length;
  const available = result.results.filter((row) => row.book.available_quantity > 0).length;
  if (result.status === 'NO_EVIDENCE' || count === 0) {
    return 'Mình chưa tìm thấy sách nào trong thư viện khớp mô tả này. Thử dùng từ khóa khác, tên tác giả hoặc thể loại nhé.';
  }
  const availability = available === count ? 'tất cả đều còn sách để đặt trước' : available > 0 ? `${available} cuốn còn sách để đặt trước` : 'hiện đều đã hết, bạn có thể đăng ký báo khi có sách';
  if (result.status === 'UNCERTAIN') {
    return `Đây là ${count} cuốn gần với mô tả của bạn nhất (độ khớp chưa cao) — ${availability}.`;
  }
  return `Mình tìm thấy ${count} cuốn phù hợp — ${availability}.`;
}
