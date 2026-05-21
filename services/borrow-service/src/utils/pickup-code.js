const crypto = require('crypto');

const PICKUP_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const PICKUP_QR_PREFIX = 'SMARTBOOK:PICKUP:';

function createPickupCode() {
  let body = '';
  for (let i = 0; i < 8; i += 1) {
    body += PICKUP_CODE_ALPHABET[crypto.randomInt(PICKUP_CODE_ALPHABET.length)];
  }
  return `PU-${body.slice(0, 4)}-${body.slice(4)}`;
}

function normalizePickupCode(value) {
  let raw = String(value || '').trim();
  if (!raw) return null;

  const prefixed = raw.match(/SMARTBOOK\s*:\s*PICKUP\s*:\s*([A-Z0-9-]+)/i);
  if (prefixed) {
    raw = prefixed[1];
  }

  const compact = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!compact) return null;

  let body = compact;
  if (body.startsWith('PU')) {
    body = body.slice(2);
  }

  if (body.length === 8) {
    return `PU-${body.slice(0, 4)}-${body.slice(4)}`;
  }

  return compact;
}

function createPickupQrValue(pickupCode) {
  const normalized = normalizePickupCode(pickupCode);
  return normalized ? `${PICKUP_QR_PREFIX}${normalized}` : '';
}

async function generateUniquePickupCode(tx) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const code = createPickupCode();
    const existing = await tx.loan_reservations.findUnique({
      where: { pickup_code: code },
      select: { id: true },
    });

    if (!existing) {
      return code;
    }
  }

  throw new Error('Unable to generate a unique pickup code');
}

module.exports = {
  PICKUP_QR_PREFIX,
  createPickupQrValue,
  generateUniquePickupCode,
  normalizePickupCode,
};
