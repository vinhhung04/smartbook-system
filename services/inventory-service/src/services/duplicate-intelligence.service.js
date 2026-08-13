const { canonicalKey, similarity } = require('./authority-normalization.service');

function normalizeIsbn(value) {
  return String(value || '').replace(/[^0-9Xx]/g, '').toUpperCase();
}

function sameAuthors(inputAuthors = [], candidateAuthors = []) {
  const input = new Set(inputAuthors.map(canonicalKey).filter(Boolean));
  const candidate = new Set(candidateAuthors.map(canonicalKey).filter(Boolean));
  if (!input.size || !candidate.size) return false;
  return [...input].some((name) => candidate.has(name));
}

function signalsFor(input, candidate) {
  const variants = candidate.book_variants || candidate.variants || [];
  const isbn = normalizeIsbn(input.isbn || input.isbn13 || input.isbn10);
  const barcode = String(input.barcode || input.sku || '').trim();
  const isbnMatch = Boolean(isbn && variants.some((variant) => [variant.isbn13, variant.isbn10].map(normalizeIsbn).includes(isbn)));
  const barcodeMatch = Boolean(barcode && variants.some((variant) => [variant.internal_barcode, variant.sku].includes(barcode)));
  const titleScore = similarity(input.title, candidate.title);
  const candidateAuthors = (candidate.book_authors || []).map((entry) => entry.authors?.full_name || entry.full_name).filter(Boolean);
  const authorMatch = sameAuthors(input.authors, candidateAuthors);
  const publisherMatch = Boolean(input.publisher && candidate.publishers?.name && canonicalKey(input.publisher) === canonicalKey(candidate.publishers.name));
  const inputYear = String(input.publishedDate || input.publishYear || '').slice(0, 4);
  const candidateYear = String(variants[0]?.publish_year || candidate.published_date || '').slice(0, 4);
  const yearMatch = Boolean(inputYear && candidateYear && inputYear === candidateYear);
  const languageMatch = Boolean(input.language && (candidate.default_language || variants[0]?.language_code) && canonicalKey(input.language) === canonicalKey(candidate.default_language || variants[0]?.language_code));
  return { isbnMatch, barcodeMatch, titleScore: Number(titleScore.toFixed(3)), authorMatch, publisherMatch, yearMatch, languageMatch };
}

function classifyCandidate(input, candidate) {
  const signals = signalsFor(input, candidate);
  let classification = 'NEW_TITLE';
  let score = 0;
  if (signals.isbnMatch) { classification = 'EXACT_DUPLICATE'; score = 1; }
  else if (signals.barcodeMatch) { classification = 'SAME_EDITION'; score = 0.99; }
  else if (signals.titleScore === 1 && signals.authorMatch) {
    classification = signals.publisherMatch || (signals.yearMatch && signals.languageMatch) ? 'SAME_EDITION' : 'SAME_WORK_DIFFERENT_EDITION';
    score = classification === 'SAME_EDITION' ? 0.95 : 0.9;
  } else if (signals.titleScore >= 0.75 && signals.authorMatch) { classification = 'POSSIBLE_DUPLICATE'; score = Number((0.55 + signals.titleScore * 0.4).toFixed(3)); }
  const explanation = [
    signals.isbnMatch && 'ISBN matches an existing variant.',
    signals.barcodeMatch && 'Barcode/SKU matches an existing variant.',
    signals.titleScore >= 0.75 && `Normalized title similarity is ${Math.round(signals.titleScore * 100)}%.`,
    signals.authorMatch && 'At least one canonical author matches.',
    classification === 'SAME_WORK_DIFFERENT_EDITION' && !signals.publisherMatch && 'Publisher differs.',
    classification === 'SAME_WORK_DIFFERENT_EDITION' && !signals.yearMatch && 'Publication year differs.',
    classification === 'SAME_WORK_DIFFERENT_EDITION' && !signals.languageMatch && 'Language differs.',
  ].filter(Boolean);
  return { bookId: candidate.id, variantIds: (candidate.book_variants || candidate.variants || []).map((variant) => variant.id), title: candidate.title, classification, score, signals, explanation };
}

function checkDuplicates(input, candidates) {
  const classified = candidates.map((candidate) => classifyCandidate(input, candidate)).filter((candidate) => candidate.classification !== 'NEW_TITLE');
  const ranking = { EXACT_DUPLICATE: 5, SAME_EDITION: 4, SAME_WORK_DIFFERENT_EDITION: 3, POSSIBLE_DUPLICATE: 2, NEW_TITLE: 1 };
  classified.sort((a, b) => ranking[b.classification] - ranking[a.classification] || b.score - a.score);
  const primary = classified[0] || { classification: 'NEW_TITLE', score: 0, signals: {}, explanation: ['No sufficiently reliable duplicate signal was found.'] };
  return { classification: primary.classification, similarityScore: primary.score, candidates: classified, explanation: primary.explanation };
}

module.exports = { normalizeIsbn, signalsFor, classifyCandidate, checkDuplicates };
