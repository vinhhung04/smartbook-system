// Phase 0 risk-first check for SB-10: proves k6 can self-sign an HS256 JWT
// (via k6/crypto + k6/encoding, since k6 does NOT run on Node.js and can't
// use jsonwebtoken like the existing scripts/*.mjs integration scripts) and
// successfully authenticate against the real API through the gateway.
import http from 'k6/http';
import crypto from 'k6/crypto';
import encoding from 'k6/encoding';
import { check } from 'k6';

const BASE_URL = __ENV.BASE_URL || 'http://api-gateway:3000';
const JWT_SECRET = __ENV.JWT_SECRET;

function base64UrlEncodeJson(obj) {
  return encoding.b64encode(JSON.stringify(obj), 'rawurl');
}

function signJwt(payload, secret) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const encodedHeader = base64UrlEncodeJson(header);
  const encodedPayload = base64UrlEncodeJson(payload);
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = crypto.hmac('sha256', secret, signingInput, 'base64rawurl');
  return `${signingInput}.${signature}`;
}

export const options = {
  vus: 1,
  iterations: 1,
};

export default function () {
  const healthRes = http.get(`${BASE_URL}/health`);
  check(healthRes, { 'GET /health -> 200': (r) => r.status === 200 });

  const token = signJwt({
    id: '00000000-0000-4000-8000-000000000099',
    email: 'k6.smoke@smartbook.local',
    is_superuser: true,
    permissions: [],
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600,
  }, JWT_SECRET);

  const booksRes = http.get(`${BASE_URL}/api/books`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  check(booksRes, {
    'GET /api/books with self-signed JWT -> 200': (r) => r.status === 200,
    'response is a JSON array': (r) => Array.isArray(JSON.parse(r.body)),
  });
}
