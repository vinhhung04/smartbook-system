function normalizeIsbn(value) {
  return String(value || '').replace(/[^0-9Xx]/g, '').toUpperCase();
}

// EAN-13 check digit (an ISBN-13 is an EAN-13 with a 978/979 prefix and shares it).
function ean13CheckDigitOk(digits) {
  return /^\d{13}$/.test(digits)
    && [...digits].reduce((sum, d, i) => sum + Number(d) * (i % 2 ? 3 : 1), 0) % 10 === 0;
}

function isbn10CheckDigitOk(code) {
  return /^\d{9}[\dX]$/.test(code)
    && [...code].reduce((sum, c, i) => sum + (c === 'X' ? 10 : Number(c)) * (10 - i), 0) % 11 === 0;
}

// ISBN-13 only: 978/979 + a correct check digit. A retail EAN-13 (e.g. 893...) is not an ISBN.
function normalizeIsbn13(value) {
  const normalized = normalizeIsbn(value);
  return /^97[89]\d{10}$/.test(normalized) && ean13CheckDigitOk(normalized) ? normalized : null;
}

function normalizeIsbn10(value) {
  const normalized = normalizeIsbn(value);
  return isbn10CheckDigitOk(normalized) ? normalized : null;
}

/**
 * What a book code is, decided before it is stored or compared:
 * ISBN13 | ISBN10 | EAN13 (valid check digit, not an ISBN) | INVALID (ISBN/EAN shape,
 * wrong check digit) | OTHER (an internal code such as a SKU-like label) | EMPTY.
 */
function classifyBookCode(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return { kind: 'EMPTY', code: null };
  const compact = normalizeIsbn(raw);
  const codeShaped = /^[\dXx\s-]+$/.test(raw);
  if (codeShaped && /^\d{13}$/.test(compact)) {
    if (!ean13CheckDigitOk(compact)) return { kind: 'INVALID', code: compact };
    return { kind: /^97[89]/.test(compact) ? 'ISBN13' : 'EAN13', code: compact };
  }
  if (codeShaped && /^\d{9}[\dX]$/.test(compact)) {
    return { kind: isbn10CheckDigitOk(compact) ? 'ISBN10' : 'INVALID', code: compact };
  }
  return { kind: 'OTHER', code: raw };
}

/**
 * book_variants.internal_barcode: a valid EAN-13 (a retail 893... code, or the ISBN-13
 * printed as the Bookland barcode) or any other internal code (<= 50 chars).
 * null = empty, undefined = refused (13 digits with a wrong EAN-13 check digit, or too long).
 */
function normalizeInternalBarcode(value) {
  const { kind, code } = classifyBookCode(value);
  if (kind === 'EMPTY') return null;
  if (kind === 'EAN13' || kind === 'ISBN13') return code;
  if (kind === 'INVALID' && code.length === 13) return undefined;
  const raw = String(value).trim();
  return raw.length <= 50 ? raw : undefined;
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

module.exports = { normalizeIsbn, normalizeIsbn13, normalizeIsbn10, classifyBookCode, normalizeInternalBarcode, normalizeCoverImageUrl, normalizeLanguageCode, normalizePublishYear, normalizePageCount, normalizeKeywords };
