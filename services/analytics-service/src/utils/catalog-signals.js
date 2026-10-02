// Per-book discovery signals for the public SmartBook website (popular, trending,
// top rated). Every number is a plain count/average read from borrow-domain
// tables — no blended "score" is invented here, so the public UI can show
// exactly what each ranking is based on.

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function emptySignal(bookId) {
  return {
    book_id: bookId,
    borrow_count: 0,
    recent_borrow_count: 0,
    recent_reservation_count: 0,
    recent_wishlist_count: 0,
    rating_avg: 0,
    rating_count: 0,
  };
}

/**
 * Loans and reservations are recorded per variant, wishlists and reviews per
 * book, so variant rows are folded into their book first. Variants that no
 * longer resolve to a book (deleted) are dropped rather than guessed.
 */
function mergeCatalogSignals({ loanRows = [], reservationRows = [], wishlistRows = [], ratingRows = [], variantBookRows = [] }) {
  const bookByVariant = new Map(variantBookRows.map((row) => [String(row.variant_id), String(row.book_id)]));
  const byBook = new Map();
  const signalFor = (bookId) => {
    if (!byBook.has(bookId)) byBook.set(bookId, emptySignal(bookId));
    return byBook.get(bookId);
  };

  for (const row of loanRows) {
    const bookId = bookByVariant.get(String(row.variant_id));
    if (!bookId) continue;
    const signal = signalFor(bookId);
    signal.borrow_count += toNumber(row.borrow_count);
    signal.recent_borrow_count += toNumber(row.recent_borrow_count);
  }

  for (const row of reservationRows) {
    const bookId = bookByVariant.get(String(row.variant_id));
    if (!bookId) continue;
    signalFor(bookId).recent_reservation_count += toNumber(row.reservation_count);
  }

  for (const row of wishlistRows) {
    if (!row.book_id) continue;
    signalFor(String(row.book_id)).recent_wishlist_count += toNumber(row.wishlist_count);
  }

  for (const row of ratingRows) {
    if (!row.book_id) continue;
    const signal = signalFor(String(row.book_id));
    signal.rating_count = toNumber(row.rating_count);
    signal.rating_avg = Math.round(toNumber(row.rating_avg) * 10) / 10;
  }

  return Array.from(byBook.values());
}

module.exports = { mergeCatalogSignals };
