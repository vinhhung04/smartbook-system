const DEFAULT_DAYS = 30;

function createHttpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.expose = true;
  return error;
}

function parseDate(value, fieldName) {
  if (!value) return null;
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) {
    throw createHttpError(400, `${fieldName} must be a valid ISO date`);
  }
  return date;
}

function parseDateRange(query, options = {}) {
  const defaultDays = Number(options.defaultDays || DEFAULT_DAYS);
  const now = new Date();
  const to = parseDate(query.to, 'to') || now;
  const defaultFrom = new Date(to);
  defaultFrom.setDate(defaultFrom.getDate() - defaultDays);
  const from = parseDate(query.from, 'from') || defaultFrom;

  if (from > to) {
    throw createHttpError(400, 'from must be before or equal to to');
  }

  return { from, to };
}

function parseGranularity(value) {
  const granularity = String(value || 'day').toLowerCase();
  if (!['day', 'month'].includes(granularity)) {
    throw createHttpError(400, 'granularity must be day or month');
  }
  return granularity;
}

function parseLimit(value, defaultValue = 10, maxValue = 50) {
  const limit = Number(value || defaultValue);
  if (!Number.isInteger(limit) || limit < 1 || limit > maxValue) {
    throw createHttpError(400, `limit must be an integer from 1 to ${maxValue}`);
  }
  return limit;
}

function formatBucketDate(value, granularity) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const iso = date.toISOString();
  return granularity === 'month' ? iso.slice(0, 7) : iso.slice(0, 10);
}

function round(value, digits = 2) {
  const number = Number(value || 0);
  const scale = 10 ** digits;
  return Math.round(number * scale) / scale;
}

module.exports = {
  createHttpError,
  parseDateRange,
  parseGranularity,
  parseLimit,
  formatBucketDate,
  round,
};
