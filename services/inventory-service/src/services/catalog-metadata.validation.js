function normalizeIsbn(value) {
  return String(value || '').replace(/[^0-9Xx]/g, '').toUpperCase();
}

function normalizeIsbn13(value) {
  const normalized = normalizeIsbn(value);
  return /^\d{13}$/.test(normalized) ? normalized : null;
}

function normalizeIsbn10(value) {
  const normalized = normalizeIsbn(value);
  return /^\d{9}[\dX]$/.test(normalized) ? normalized : null;
}

function normalizeCoverImageUrl(value) {
  const normalized = String(value || '').trim();
  if (!normalized) return null;
  return normalized.startsWith('data:image/') || normalized.startsWith('https://') || normalized.startsWith('http://') ? normalized : null;
}

function normalizeLanguageCode(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized ? normalized.slice(0, 10) : null;
}

function normalizePublishYear(value) {
  if (value === undefined || value === null || String(value).trim() === '') return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1000 && parsed <= 2100 ? parsed : undefined;
}

function normalizePageCount(value) {
  if (value === undefined || value === null || String(value).trim() === '') return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 10000 ? parsed : undefined;
}

function normalizeKeywords(value) {
  if (!Array.isArray(value)) return value === undefined ? undefined : null;
  return [...new Set(value.filter((item) => typeof item === 'string').map((item) => item.trim()).filter((item) => item && item.length <= 50))].slice(0, 15);
}

module.exports = { normalizeIsbn, normalizeIsbn13, normalizeIsbn10, normalizeCoverImageUrl, normalizeLanguageCode, normalizePublishYear, normalizePageCount, normalizeKeywords };
