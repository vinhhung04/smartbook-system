// SB-10 scenario 1: catalog browsing under load. Read-only (no cleanup
// needed) — a single customer login is reused by every VU, matching how a
// real customer session would browse: GET /catalog/books then GET
// /catalog/books/:id for one of the listed titles.
//
// FINDING (first real run at 100 VUs): apps/api-gateway/src/index.js already
// has a per-client rate limiter (createRateLimiter, 600 req/15min, keyed by
// client IP). Every VU in this k6 container shares one egress IP, so the
// *combined* traffic hits that budget almost immediately — this is the
// gateway's own security control working as designed, not a bug in this
// script or the backend. 429 is therefore an EXPECTED, correct response once
// the shared-IP budget is spent, not a failure — counted separately below so
// the real error rate (5xx/timeout) isn't hidden by it. This is exactly the
// kind of ceiling SB-10 is meant to surface, not to test around.
//
// No hard `thresholds` block on purpose: the roadmap explicitly asks to
// measure a baseline and iterate, not to fabricate a pass/fail number. The
// response-time check below is observational (shows up in the checks% and
// summary), it does not fail the run.
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter } from 'k6/metrics';

const BASE_URL = __ENV.BASE_URL || 'http://api-gateway:3000';
const CUSTOMER_USERNAME = __ENV.CUSTOMER_USERNAME || 'customer01';
const CUSTOMER_PASSWORD = __ENV.CUSTOMER_PASSWORD || '123456';
const RESPONSE_TIME_REFERENCE_MS = 800;

const rateLimited = new Counter('gateway_rate_limited_total');
const unexpectedErrors = new Counter('unexpected_errors_total');

export const options = {
  stages: [
    { duration: '30s', target: 100 },
    { duration: '1m', target: 100 },
    { duration: '15s', target: 0 },
  ],
};

export function setup() {
  const loginRes = http.post(`${BASE_URL}/auth/login`, JSON.stringify({
    identifier: CUSTOMER_USERNAME,
    password: CUSTOMER_PASSWORD,
  }), { headers: { 'Content-Type': 'application/json' } });

  if (loginRes.status !== 200) {
    throw new Error(`setup: login failed (${loginRes.status}): ${loginRes.body}`);
  }

  return { token: loginRes.json('token') };
}

function classify(res) {
  if (res.status === 200) return 'ok';
  if (res.status === 429) {
    rateLimited.add(1);
    return 'rate_limited';
  }
  unexpectedErrors.add(1);
  return 'error';
}

export default function (data) {
  const headers = { Authorization: `Bearer ${data.token}` };

  const listRes = http.get(`${BASE_URL}/catalog/books`, { headers });
  const listOutcome = classify(listRes);
  check(listRes, {
    'GET /catalog/books -> 200 or 429 (rate limit is expected under this load)': () => listOutcome !== 'error',
    [`GET /catalog/books responds under ${RESPONSE_TIME_REFERENCE_MS}ms (reference only)`]: (r) => r.timings.duration < RESPONSE_TIME_REFERENCE_MS,
  });

  if (listOutcome === 'ok') {
    const books = listRes.json();
    if (Array.isArray(books) && books.length > 0) {
      const pick = books[Math.floor(Math.random() * books.length)];
      const detailRes = http.get(`${BASE_URL}/catalog/books/${pick.id}`, { headers });
      const detailOutcome = classify(detailRes);
      check(detailRes, {
        'GET /catalog/books/:id -> 200 or 429 (rate limit is expected under this load)': () => detailOutcome !== 'error',
        [`GET /catalog/books/:id responds under ${RESPONSE_TIME_REFERENCE_MS}ms (reference only)`]: (r) => r.timings.duration < RESPONSE_TIME_REFERENCE_MS,
      });
    }
  }

  sleep(1);
}
