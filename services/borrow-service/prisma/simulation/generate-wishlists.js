// Wishlists arise two ways: (1) discovery - the reader comes across a book
// they like (drawn from their own P(book | user), excluding what they already
// borrowed or saved), and (2) wanting a book that is currently unavailable
// (see generate-alerts.js). Wishlisted books get a selection boost in later
// borrow sessions (wishlist -> borrow chain); some are removed once borrowed.

const { WISHLIST } = require('./config');
const { chooseBook } = require('./preferences');

function addWishlist(customer, book, t) {
  if (customer.wishlist.has(book.id)) return false;
  customer.wishlist.set(book.id, { created_at: t, removed: false });
  return true;
}

function discoveriesPerDay(customer) {
  const t = customer.traits;
  return (WISHLIST.discoveriesPerYearMax * t.wishlist_tendency * (0.25 + t.activity_level)) / 365;
}

function discover(ctx, customer, t) {
  const exclude = new Set([...customer.wishlist.keys(), ...customer.borrowed]);
  const pick = chooseBook(ctx.rng, customer, { catalog: ctx.catalog, exclude, now: t.getTime() });
  if (pick) addWishlist(customer, pick.book, t);
}

function wishlistRows(ctx) {
  const rows = [];
  for (const customer of ctx.customers) {
    for (const [bookId, w] of customer.wishlist) {
      if (!w.removed) rows.push({ id: ctx.idRng.uuid(), customer_id: customer.id, book_id: bookId, created_at: w.created_at });
    }
  }
  return rows;
}

module.exports = { addWishlist, discover, discoveriesPerDay, wishlistRows };
