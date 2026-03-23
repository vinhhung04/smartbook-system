function parseId(value) {
  return String(value || '').trim() || null;
}

function toInt(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  return Math.trunc(num);
}

function normalizeText(value) {
  const text = String(value || '').trim();
  return text || null;
}

function normalizeIsbn13(value) {
  const normalized = String(value || '').trim().replace(/[^0-9]/g, '');
  return normalized || null;
}

function normalizeLocationType(value) {
  return String(value || '').trim().toUpperCase();
}

function normalizeTaskType(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'outbound' || normalized === 'transfer') return normalized;
  return null;
}

module.exports = {
  parseId,
  toInt,
  normalizeText,
  normalizeIsbn13,
  normalizeLocationType,
  normalizeTaskType,
};
