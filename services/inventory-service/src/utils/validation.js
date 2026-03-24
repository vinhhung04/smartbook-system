function parseId(value) {
  return String(value || "").trim() || null;
}

function toInt(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  return Math.trunc(num);
}

function normalizeText(value) {
  const text = String(value || "").trim();
  return text || null;
}

function normalizeIsbn13(value) {
  const normalized = String(value || "")
    .trim()
    .replace(/[^0-9]/g, "");
  return normalized || null;
}

function normalizeLocationType(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function normalizeTaskType(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (normalized === "outbound" || normalized === "transfer") return normalized;
  return null;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function normalizeRequiredUserId(value) {
  const raw = String(value || "").trim();
  if (!raw || !UUID_RE.test(raw)) {
    const err = new Error(`Invalid required user ID: ${raw}`);
    err.statusCode = 400;
    throw err;
  }
  return raw;
}

function normalizeOptionalUserId(value) {
  const raw = String(value || "").trim();
  if (!raw || !UUID_RE.test(raw)) return null;
  return raw;
}

module.exports = {
  parseId,
  toInt,
  normalizeText,
  normalizeIsbn13,
  normalizeLocationType,
  normalizeTaskType,
  normalizeRequiredUserId,
  normalizeOptionalUserId,
};
