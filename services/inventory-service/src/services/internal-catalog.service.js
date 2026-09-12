// Extracted from internal-catalog.routes.js (the ai-service cover-search
// gallery feed) so the auth guard and row-shaping are unit-testable without a
// running Express server or a real database.

/** Constant-shape comparison isn't needed here — this guard exists to keep an
 * internal background job (ai-service's gallery builder) from being called by
 * anything without the shared secret, not to resist timing attacks. */
function isValidInternalKey(providedKey, expectedKey) {
  const provided = String(providedKey || '').trim();
  const expected = String(expectedKey || '').trim();
  return Boolean(provided) && provided === expected;
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

module.exports = { isValidInternalKey, mapCoverGalleryItem };
