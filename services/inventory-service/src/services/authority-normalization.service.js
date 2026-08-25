const CATEGORY_ALIASES = new Map([
  ['programming', 'lap trinh phan mem'],
  ['software engineering', 'lap trinh phan mem'],
  ['computer programming', 'lap trinh phan mem'],
]);

function canonicalKey(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function cleanDisplayValue(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function similarity(left, right) {
  const a = new Set(canonicalKey(left).split(' ').filter(Boolean));
  const b = new Set(canonicalKey(right).split(' ').filter(Boolean));
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const token of a) if (b.has(token)) shared += 1;
  return (2 * shared) / (a.size + b.size);
}

function matchAuthority(rawValue, entities, aliases, nameField, entityType) {
  const raw = cleanDisplayValue(rawValue);
  const normalizedValue = canonicalKey(raw);
  if (!raw) {
    return { rawValue: raw, normalizedValue, matchedEntity: null, confidence: 0, sources: [], reason: 'No value supplied.', status: 'NEW_ENTITY', provenance: 'EXTERNAL' };
  }

  const exact = entities.find((entity) => canonicalKey(entity[nameField]) === normalizedValue);
  if (exact) {
    return { rawValue: raw, normalizedValue, matchedEntity: { id: exact.id, name: exact[nameField] }, confidence: 1, sources: ['catalog'], reason: `Exact normalized ${entityType} match.`, status: 'AUTO_MATCH', provenance: 'RULE' };
  }

  const approvedAlias = aliases.find((alias) => alias.status === 'APPROVED' && alias.normalized_alias === normalizedValue);
  if (approvedAlias) {
    const entity = approvedAlias[nameField === 'full_name' ? 'authors' : 'publishers'];
    return { rawValue: raw, normalizedValue, matchedEntity: { id: entity.id, name: entity[nameField] }, confidence: 0.98, sources: ['approved_alias'], reason: `Matched approved ${entityType} alias.`, status: 'AUTO_MATCH', provenance: 'RULE' };
  }

  const closest = entities
    .map((entity) => ({ entity, score: similarity(raw, entity[nameField]) }))
    .sort((a, b) => b.score - a.score)[0];
  if (closest && closest.score >= 0.72) {
    return { rawValue: raw, normalizedValue, matchedEntity: { id: closest.entity.id, name: closest.entity[nameField] }, confidence: Number(closest.score.toFixed(3)), sources: ['catalog'], reason: `Similar ${entityType} name requires staff review.`, status: 'REVIEW_REQUIRED', provenance: 'RULE' };
  }
  return { rawValue: raw, normalizedValue, matchedEntity: null, confidence: Number((closest?.score || 0).toFixed(3)), sources: [], reason: `No safe ${entityType} match found.`, status: 'NEW_ENTITY', provenance: 'RULE' };
}

function normalizeCategory(rawValue, categories) {
  const raw = cleanDisplayValue(rawValue);
  const key = canonicalKey(raw);
  const mappedKey = CATEGORY_ALIASES.get(key) || key;
  const exact = categories.find((category) => canonicalKey(category.name) === mappedKey);
  if (exact) {
    return { rawValue: raw, normalizedValue: exact.name, matchedEntity: { id: exact.id, name: exact.name }, confidence: key === mappedKey ? 1 : 0.95, sources: key === mappedKey ? ['catalog'] : ['taxonomy_rule'], reason: key === mappedKey ? 'Exact internal taxonomy match.' : 'Mapped external category to internal taxonomy.', status: 'AUTO_MATCH', provenance: 'RULE' };
  }
  const closest = categories.map((category) => ({ category, score: similarity(mappedKey, category.name) })).sort((a, b) => b.score - a.score)[0];
  if (closest && closest.score >= 0.72) {
    return { rawValue: raw, normalizedValue: closest.category.name, matchedEntity: { id: closest.category.id, name: closest.category.name }, confidence: Number(closest.score.toFixed(3)), sources: ['catalog'], reason: 'Similar internal taxonomy match requires staff review.', status: 'REVIEW_REQUIRED', provenance: 'RULE' };
  }
  return { rawValue: raw, normalizedValue: raw, matchedEntity: null, confidence: Number((closest?.score || 0).toFixed(3)), sources: [], reason: 'No matching internal taxonomy exists; a manager may explicitly create one.', status: 'NEW_ENTITY', provenance: 'RULE' };
}

function normalizeLanguage(value) {
  const key = canonicalKey(value);
  const map = { vietnamese: 'vi', 'tieng viet': 'vi', english: 'en', japanese: 'ja', korean: 'ko', chinese: 'zh', french: 'fr' };
  return map[key] || (/^[a-z]{2,3}$/.test(key) ? key : null);
}

function reconcileMetadata(raw, authorities) {
  const authors = Array.isArray(raw.authors) ? raw.authors : [];
  const authorNormalization = authors.map((value) => matchAuthority(value, authorities.authors || [], authorities.authorAliases || [], 'full_name', 'author'));
  const publisherNormalization = matchAuthority(raw.publisher, authorities.publishers || [], authorities.publisherAliases || [], 'name', 'publisher');
  const categoryNormalization = (Array.isArray(raw.categories) ? raw.categories : []).map((value) => normalizeCategory(value, authorities.categories || []));
  const pageCount = Number(raw.pageCount);
  const normalized = {
    title: cleanDisplayValue(raw.title) || null,
    authors: authorNormalization.map((item) => item.matchedEntity?.name || item.rawValue).filter(Boolean),
    publisher: publisherNormalization.matchedEntity?.name || publisherNormalization.rawValue || null,
    categories: categoryNormalization.map((item) => item.normalizedValue).filter(Boolean),
    language: normalizeLanguage(raw.language),
    publishedDate: /^\d{4}(-\d{2}(-\d{2})?)?$/.test(String(raw.publishedDate || '')) ? String(raw.publishedDate) : null,
    pageCount: Number.isInteger(pageCount) && pageCount > 0 && pageCount <= 10000 ? pageCount : null,
    coverFormat: cleanDisplayValue(raw.coverFormat).toUpperCase() || null,
    description: typeof raw.description === 'string' ? raw.description.trim() : null,
  };
  const qualityWarnings = [
    !normalized.title && 'MISSING_TITLE',
    !raw.isbn && 'MISSING_ISBN',
    raw.pageCount != null && !normalized.pageCount && 'ABNORMAL_PAGE_COUNT',
    raw.publishedDate && !normalized.publishedDate && 'ABNORMAL_PUBLISHED_DATE',
    raw.language && !normalized.language && 'ABNORMAL_LANGUAGE',
    normalized.description && normalized.description.length < 80 && 'DESCRIPTION_TOO_SHORT',
    /<[^>]+>/.test(normalized.description || '') && 'DESCRIPTION_CONTAINS_HTML',
    ...(Array.isArray(raw.conflicts) ? raw.conflicts.map((conflict) => `SOURCE_CONFLICT:${conflict.field}`) : []),
  ].filter(Boolean);
  return { normalized, authorNormalization, publisherNormalization, categoryNormalization, authorityMatches: { authors: authorNormalization, publisher: publisherNormalization, categories: categoryNormalization }, qualityWarnings };
}

module.exports = { canonicalKey, cleanDisplayValue, similarity, matchAuthority, normalizeCategory, normalizeLanguage, reconcileMetadata };
