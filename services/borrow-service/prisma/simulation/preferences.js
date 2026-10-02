// Individual taste and the user-conditioned book choice P(book | user).
//
//   P(book | user) = sum_c P(c | user) * P(book | c, user)
//
//   P(c | user)       = (1 - exploration) * pref(c) * habit(c) / Z   (exploit)
//                     +      exploration  * 1/|C|                   (explore)
//   P(book | c, user) ∝ popularity(book) * author(book) * novelty(book)
//                       * wishlist(book) * availability(book)
//
// Every factor is floored above zero (no single component can zero out a book
// the user could plausibly pick), except books the user currently holds.

const { CATEGORY_SLUGS, PERSONAS, OCCUPATION_CATEGORY_BOOST } = require('./personas');
const { SELECTION } = require('./config');

function sampleCategoryPreferences(rng, personaKey, occupation, categoriesPresent) {
  const prior = PERSONAS[personaKey].categories;
  const boost = OCCUPATION_CATEGORY_BOOST[occupation] || {};
  const raw = {};
  for (const slug of CATEGORY_SLUGS) {
    raw[slug] = prior[slug] * (boost[slug] || 1) * Math.exp(rng.gaussian(0, SELECTION.categoryNoiseSd));
  }
  const max = Math.max(...Object.values(raw));
  const relative = Object.fromEntries(CATEGORY_SLUGS.map((s) => [s, raw[s] / max]));
  // Effective choice distribution only over categories that have books.
  const total = categoriesPresent.reduce((sum, s) => sum + relative[s], 0);
  const effective = Object.fromEntries(categoriesPresent.map((s) => [s, relative[s] / total]));
  return { relative, effective };
}

// 0-3 latent favourite authors, drawn from books the reader is likely to meet.
function sampleAuthorAffinity(rng, catalog, effective) {
  const affinity = {};
  const count = rng.weightedIndex([0.25, 0.4, 0.25, 0.1]);
  const weights = catalog.books.map((b) => Math.max(...b.categories.map((c) => effective[c] || 0)) * b.popularity);
  for (let i = 0; i < count; i += 1) {
    const book = catalog.books[rng.weightedIndex(weights)];
    const author = book.authors[0];
    if (author) affinity[author] = rng.range(1.5, SELECTION.authorAffinityMax);
  }
  return affinity;
}

// Latent favourite-author multiplier, times a boost for authors the reader
// rated >= 4 stars in reviews written before `now` (learned taste).
function authorFactor(user, book, now) {
  let factor = 1;
  for (const author of book.authors) {
    factor = Math.max(factor, user.authorAffinity[author] || 1);
    const liked = (user.likedAuthors.get(author) || []).filter((at) => at < now).length;
    if (liked) factor *= 1 + Math.min(SELECTION.likedAuthorBoost * liked, SELECTION.likedAuthorBoostCap);
  }
  return factor;
}

/**
 * user: { prefs.effective, traits.exploration, traits.digital_affinity, authorAffinity,
 *         likedAuthors: Map<author, reviewTimes[]>, borrowed: Set, held: Map<bookId, untilMs>,
 *         wishlist: Map, recentCategories: [] }
 * opts: { catalog, now (ms), isAvailable?(book) -> bool, exclude?: Set }
 * @returns {{ book, explored: boolean } | null}
 */
function chooseBook(rng, user, { catalog, now, isAvailable, exclude }) {
  const candidate = (b) => !((user.held.get(b.id) || 0) > now) && !(exclude && exclude.has(b.id));
  const categories = catalog.categoriesPresent.filter((c) => catalog.booksByCategory.get(c).some(candidate));
  if (!categories.length) return null;

  const explored = rng.chance(user.traits.exploration);
  let category;
  if (explored) {
    category = rng.pick(categories);
  } else {
    const recent = user.recentCategories;
    const weights = categories.map((c) => {
      const habit = recent.length ? recent.filter((x) => x === c).length / recent.length : 0;
      return user.prefs.effective[c] * (1 + SELECTION.habitWeight * habit);
    });
    category = categories[rng.weightedIndex(weights)];
  }

  const books = catalog.booksByCategory.get(category).filter(candidate);
  const weights = books.map((b) => {
    let w = b.popularity * authorFactor(user, b, now);
    if (user.borrowed.has(b.id)) w *= SELECTION.rereadFactor;
    if (user.wishlist.has(b.id)) w *= SELECTION.wishlistBoost;
    if (isAvailable && !isAvailable(b)) w *= 1 - SELECTION.unavailablePenaltyDigital * user.traits.digital_affinity;
    return w;
  });
  return { book: books[rng.weightedIndex(weights)], explored };
}

// How well a book matches the reader's latent taste, in [0, 1].
function tasteMatch(user, book) {
  const cat = Math.max(...book.categories.map((c) => user.prefs.relative[c] ?? 0));
  const author = book.authors.some((a) => (user.authorAffinity[a] || 1) > 1) ? 1.2 : 1;
  return Math.min(1, cat * author);
}

module.exports = { sampleCategoryPreferences, sampleAuthorAffinity, chooseBook, tasteMatch, authorFactor };
