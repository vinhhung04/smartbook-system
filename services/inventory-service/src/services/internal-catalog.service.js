// Extracted from internal-catalog.routes.js (the ai-service cover-search
// gallery feed) so the auth guard and row-shaping are unit-testable without a
// running Express server or a real database.
const crypto = require('node:crypto');

/** Shared-secret guard for service-to-service routes. Both sides are hashed
 * first so timingSafeEqual always compares equal-length buffers: the guard
 * leaks neither the key's content nor its length through response timing. */
function isValidInternalKey(providedKey, expectedKey) {
  const provided = String(providedKey || '').trim();
  const expected = String(expectedKey || '').trim();
  if (!provided || !expected) return false;
  const digest = (value) => crypto.createHash('sha256').update(value).digest();
  return crypto.timingSafeEqual(digest(provided), digest(expected));
}

/** Shapes one book_variants row (with its books/book_authors include) into
 * the flat item ai-service's cover_gallery.py expects. */
function mapCoverGalleryItem(variant) {
  return {
    variant_id: variant.id,
    book_id: variant.book_id,
    title: variant.books?.title || null,
    author: variant.books?.book_authors?.[0]?.authors?.full_name || null,
    isbn13: variant.isbn13,
    cover_image_url: variant.cover_image_url,
  };
}

const CORPUS_PAGE_DEFAULT = 200;
const CORPUS_PAGE_MAX = 500;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Keyset pagination params for the ai-service book corpus feed. `after` is
 * the last id of the previous page (ids are UUIDs, ordered ascending), so a
 * book inserted or deactivated mid-scan never shifts later pages the way an
 * OFFSET would. Returns { error } for a malformed cursor instead of throwing. */
function parseCorpusPageParams(query = {}) {
  const rawLimit = Number.parseInt(String(query.limit ?? ''), 10);
  const limit = Number.isFinite(rawLimit) && rawLimit > 0
    ? Math.min(rawLimit, CORPUS_PAGE_MAX)
    : CORPUS_PAGE_DEFAULT;
  const after = String(query.after || '').trim() || null;
  if (after && !UUID_RE.test(after)) return { error: 'after must be a book id (UUID)' };
  return { limit, after };
}

/** One active book as ai-service's ingestion.py indexes it into the
 * BOOK_METADATA corpus (see book_index.book_text). Missing author/category
 * stay null rather than the UI placeholder "Chưa cập nhật", so a placeholder
 * string is never embedded as if it were real metadata. */
function mapCorpusBook(book) {
  const variants = book.book_variants || [];
  const firstVariant = variants[0] || null;
  return {
    id: book.id,
    title: book.title,
    subtitle: book.subtitle || null,
    description: book.description || null,
    summary_vi: book.metadata?.summary_vi || null,
    author: book.book_authors?.[0]?.authors?.full_name || null,
    category: book.book_categories?.[0]?.categories?.name || null,
    publisher: book.publishers?.name || null,
    isbn: firstVariant?.isbn13 || firstVariant?.isbn10 || null,
    is_incomplete: Boolean(book.metadata?.is_incomplete),
    updated_at: book.updated_at,
  };
}

module.exports = {
  CORPUS_PAGE_DEFAULT,
  CORPUS_PAGE_MAX,
  isValidInternalKey,
  mapCorpusBook,
  mapCoverGalleryItem,
  parseCorpusPageParams,
};
