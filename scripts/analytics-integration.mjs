import crypto from 'node:crypto';

const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
const username = process.env.ANALYTICS_TEST_USERNAME || 'manager01';
const password = process.env.ANALYTICS_TEST_PASSWORD || '123456';
const jwtSecret = process.env.JWT_SECRET || 'smartbook_shared_jwt_secret';

function b64url(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function signJwt(payload, secret) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const encodedHeader = b64url(JSON.stringify(header));
  const encodedPayload = b64url(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = crypto
    .createHmac('sha256', secret)
    .update(signingInput)
    .digest('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
  return `${signingInput}.${signature}`;
}

async function request(path, token, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method || 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const body = await response.json().catch(() => ({}));
  return { response, body };
}

async function login() {
  const response = await fetch(`${baseUrl}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: username, password }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body?.token) {
    throw new Error(`login failed (${response.status}): ${JSON.stringify(body)}`);
  }
  return body.token;
}

function assertNumber(value, field) {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    throw new Error(`${field} must be a number`);
  }
}

function assertArray(value, field) {
  if (!Array.isArray(value)) {
    throw new Error(`${field} must be an array`);
  }
}

function assertObject(value, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${field} must be an object`);
  }
}

const endpointChecks = [
  {
    name: 'analytics/dashboard/kpis',
    path: '/analytics/dashboard/kpis',
    validate(data) {
      [
        'total_titles',
        'total_copies',
        'active_loans',
        'overdue_loans',
        'pending_reservations',
        'confirmed_reservations',
        'ready_for_pickup_reservations',
        'pickup_codes_expiring_soon',
        'unpaid_fine_amount',
        'low_stock_variants',
        'reservation_conversion_rate',
      ].forEach((field) => assertNumber(data[field], field));
    },
  },
  {
    name: 'analytics/borrow-trends',
    path: '/analytics/borrow-trends',
    validate(data) {
      assertArray(data, 'data');
      data.forEach((item, index) => {
        assertNumber(item.loans, `data[${index}].loans`);
        assertNumber(item.returns, `data[${index}].returns`);
        assertNumber(item.reservations, `data[${index}].reservations`);
      });
    },
  },
  {
    name: 'analytics/top-books',
    path: '/analytics/top-books',
    validate(data) {
      assertArray(data, 'data');
      data.forEach((item, index) => assertNumber(item.borrow_count, `data[${index}].borrow_count`));
    },
  },
  {
    name: 'analytics/overdue-summary',
    path: '/analytics/overdue-summary',
    validate(data) {
      assertObject(data, 'data');
      assertNumber(data.total_overdue_items, 'total_overdue_items');
      assertNumber(data.total_overdue_loans, 'total_overdue_loans');
      assertNumber(data.average_overdue_days, 'average_overdue_days');
      assertNumber(data.oldest_overdue_days, 'oldest_overdue_days');
      assertArray(data.items, 'items');
    },
  },
  {
    name: 'analytics/fine-summary',
    path: '/analytics/fine-summary',
    validate(data) {
      assertObject(data, 'data');
      assertNumber(data.total_unpaid, 'total_unpaid');
      assertNumber(data.total_paid, 'total_paid');
      assertNumber(data.total_waived, 'total_waived');
      assertNumber(data.unpaid_count, 'unpaid_count');
      assertNumber(data.paid_count, 'paid_count');
      assertArray(data.by_type, 'by_type');
    },
  },
  {
    name: 'analytics/warehouse-stock-risk',
    path: '/analytics/warehouse-stock-risk',
    validate(data) {
      assertArray(data, 'data');
      data.forEach((item, index) => {
        assertNumber(item.low_stock_variants, `data[${index}].low_stock_variants`);
        assertNumber(item.out_of_stock_variants, `data[${index}].out_of_stock_variants`);
        assertNumber(item.total_available_qty, `data[${index}].total_available_qty`);
        assertNumber(item.total_reserved_qty, `data[${index}].total_reserved_qty`);
        assertNumber(item.total_borrowed_qty, `data[${index}].total_borrowed_qty`);
      });
    },
  },
  {
    name: 'analytics/reservation-funnel',
    path: '/analytics/reservation-funnel',
    validate(data) {
      assertObject(data, 'data');
      ['total', 'pending', 'confirmed', 'ready_for_pickup', 'converted_to_loan', 'cancelled', 'expired', 'conversion_rate']
        .forEach((field) => assertNumber(data[field], field));
    },
  },
];

async function run() {
  const staffToken = await login();
  let passed = 0;

  for (const check of endpointChecks) {
    const { response, body } = await request(check.path, staffToken);
    if (!response.ok) {
      throw new Error(`${check.name} failed (${response.status}): ${JSON.stringify(body)}`);
    }
    if (!Object.prototype.hasOwnProperty.call(body, 'data')) {
      throw new Error(`${check.name} response must include data`);
    }
    check.validate(body.data);
    passed += 1;
    console.log(`PASS ${check.name}`);
  }

  const customerToken = signJwt({
    sub: crypto.randomUUID(),
    username: 'analytics-customer-test',
    email: 'analytics-customer-test@smartbook.local',
    roles: ['CUSTOMER'],
    permissions: ['inventory.catalog.read', 'borrow.read', 'borrow.write'],
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 60 * 60,
  }, jwtSecret);

  const denied = await request('/analytics/dashboard/kpis', customerToken);
  if (denied.response.status !== 403) {
    throw new Error(`customer analytics access should be 403, got ${denied.response.status}`);
  }
  console.log('PASS analytics/customer-denied');
  console.log(`PASS=${passed} TOTAL=${endpointChecks.length}`);
  console.log('ACCESS=1 TOTAL=1');
}

run().catch((error) => {
  console.error(`FAIL ${error.message}`);
  process.exitCode = 1;
});
