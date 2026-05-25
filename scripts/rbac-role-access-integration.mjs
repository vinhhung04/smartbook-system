const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
const password = process.env.DEMO_PASSWORD || '123456';

const users = {
  admin: process.env.RBAC_ADMIN_USERNAME || 'hung',
  manager: process.env.RBAC_MANAGER_USERNAME || 'manager01',
  staff: process.env.RBAC_STAFF_USERNAME || 'staff01',
  librarian: process.env.RBAC_LIBRARIAN_USERNAME || 'librarian01',
  customer: process.env.RBAC_CUSTOMER_USERNAME || 'customer01',
};

let passed = 0;
let total = 0;

function pass(label) {
  passed += 1;
  total += 1;
  console.log(`PASS ${label}`);
}

function fail(label, detail) {
  total += 1;
  throw new Error(`FAIL ${label}: ${detail}`);
}

async function request(method, path, token, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: response.status, ok: response.ok, data };
}

async function login(identifier) {
  const result = await request('POST', '/auth/login', null, { identifier, password });
  if (!result.ok || !result.data?.token) {
    throw new Error(`login ${identifier} failed (${result.status}): ${JSON.stringify(result.data)}`);
  }
  return result.data.token;
}

async function expectStatus(label, method, path, token, body, predicate) {
  const result = await request(method, path, token, body);
  if (predicate(result.status, result)) {
    pass(`${label} (${result.status})`);
    return result;
  }
  fail(label, `unexpected ${result.status} ${JSON.stringify(result.data)}`);
}

function hasAll(values, expected) {
  return expected.every((item) => values.includes(item));
}

function hasNone(values, forbidden) {
  return forbidden.every((item) => !values.includes(item));
}

async function assertMe(label, token, expectedRoles, expectedPermissions, forbiddenPermissions = []) {
  const result = await expectStatus(`${label} /auth/me`, 'GET', '/auth/me', token, undefined, (status) => status === 200);
  const me = result.data?.user;
  const roles = Array.isArray(me?.roles) ? me.roles : [];
  const permissions = Array.isArray(me?.permissions) ? me.permissions : [];
  if (!hasAll(roles, expectedRoles)) {
    fail(`${label} roles`, `expected ${expectedRoles.join(',')} got ${roles.join(',')}`);
  }
  pass(`${label} roles`);
  if (!hasAll(permissions, expectedPermissions)) {
    fail(`${label} permissions`, `expected ${expectedPermissions.join(',')} got ${permissions.join(',')}`);
  }
  pass(`${label} permissions`);
  if (!hasNone(permissions, forbiddenPermissions)) {
    fail(`${label} forbidden permissions`, `unexpected ${forbiddenPermissions.filter((item) => permissions.includes(item)).join(',')}`);
  }
  if (forbiddenPermissions.length > 0) {
    pass(`${label} forbidden permissions absent`);
  }
}

async function run() {
  const adminToken = await login(users.admin);
  const managerToken = await login(users.manager);
  const staffToken = await login(users.staff);
  const librarianToken = await login(users.librarian);
  const customerToken = await login(users.customer);

  await assertMe('ADMIN', adminToken, ['ADMIN'], ['auth.users.read']);
  await assertMe('MANAGER', managerToken, ['MANAGER'], ['inventory.operation.decide', 'inventory.stock.adjust', 'inventory.purchase.write', 'inventory.purchase.approve', 'reports.read']);
  await assertMe('STAFF', staffToken, ['STAFF'], ['inventory.stock.read', 'inventory.task.read', 'inventory.task.update'], ['inventory.stock.write', 'inventory.catalog.write', 'inventory.warehouse.write', 'inventory.purchase.write', 'inventory.supplier.write', 'inventory.transfer.write']);
  await assertMe('LIBRARIAN', librarianToken, ['LIBRARIAN'], ['borrow.write', 'inventory.catalog.read']);
  await assertMe('CUSTOMER', customerToken, ['CUSTOMER'], ['customer.self.read', 'inventory.catalog.read']);

  await expectStatus('STAFF catalog read', 'GET', '/api/books', staffToken, undefined, (status) => status === 200);
  await expectStatus('STAFF stock read', 'GET', '/api/inventory', staffToken, undefined, (status) => status === 200);
  await expectStatus('STAFF my warehouse tasks read', 'GET', '/api/my-warehouse-tasks', staffToken, undefined, (status) => status === 200);
  await expectStatus('STAFF inbound forbidden', 'POST', '/api/inventory/inbound', staffToken, {}, (status) => status === 403);
  await expectStatus('STAFF outbound forbidden', 'POST', '/api/inventory/outbound', staffToken, {}, (status) => status === 403);
  await expectStatus('STAFF outbound request forbidden', 'POST', '/api/order-requests/outbound', staffToken, {}, (status) => status === 403);
  await expectStatus('STAFF transfer request forbidden', 'POST', '/api/order-requests/transfer', staffToken, {}, (status) => status === 403);
  await expectStatus('STAFF create warehouse forbidden', 'POST', '/api/warehouses', staffToken, {}, (status) => status === 403);
  await expectStatus('STAFF update warehouse forbidden', 'PUT', '/api/warehouses/00000000-0000-4000-8000-000000000000', staffToken, {}, (status) => status === 403);
  await expectStatus('STAFF create location forbidden', 'POST', '/api/locations', staffToken, {}, (status) => status === 403);
  await expectStatus('STAFF update location forbidden', 'PUT', '/api/locations/00000000-0000-4000-8000-000000000000', staffToken, {}, (status) => status === 403);
  await expectStatus('STAFF create PO forbidden', 'POST', '/api/purchase-orders', staffToken, {}, (status) => status === 403);
  await expectStatus('STAFF approve PO forbidden', 'POST', '/api/purchase-orders/00000000-0000-4000-8000-000000000000/approve', staffToken, {}, (status) => status === 403);
  await expectStatus('STAFF create supplier forbidden', 'POST', '/api/suppliers', staffToken, {}, (status) => status === 403);
  await expectStatus('STAFF IAM forbidden', 'GET', '/iam/users', staffToken, undefined, (status) => status === 403);
  await expectStatus('STAFF borrow admin forbidden', 'GET', '/borrow/loans', staffToken, undefined, (status) => status === 403);

  await expectStatus('MANAGER analytics ok', 'GET', '/analytics/dashboard/kpis', managerToken, undefined, (status) => status === 200);
  await expectStatus('MANAGER inbound authorized', 'POST', '/api/inventory/inbound', managerToken, {}, (status) => status !== 401 && status !== 403);
  await expectStatus('MANAGER outbound authorized', 'POST', '/api/inventory/outbound', managerToken, {}, (status) => status !== 401 && status !== 403);
  await expectStatus('MANAGER outbound request authorized', 'POST', '/api/order-requests/outbound', managerToken, {}, (status) => status !== 401 && status !== 403);
  await expectStatus('MANAGER transfer request authorized', 'POST', '/api/order-requests/transfer', managerToken, {}, (status) => status !== 401 && status !== 403);
  await expectStatus('MANAGER create warehouse authorized', 'POST', '/api/warehouses', managerToken, {}, (status) => status !== 401 && status !== 403);
  await expectStatus('MANAGER create location authorized', 'POST', '/api/locations', managerToken, {}, (status) => status !== 401 && status !== 403);
  await expectStatus('MANAGER create supplier authorized', 'POST', '/api/suppliers', managerToken, {}, (status) => status !== 401 && status !== 403);
  await expectStatus('MANAGER create PO authorized', 'POST', '/api/purchase-orders', managerToken, {}, (status) => status !== 401 && status !== 403);
  await expectStatus('MANAGER approve PO authorized', 'POST', '/api/purchase-orders/00000000-0000-4000-8000-000000000000/approve', managerToken, {}, (status) => status !== 401 && status !== 403);
  await expectStatus('MANAGER IAM forbidden', 'GET', '/iam/users', managerToken, undefined, (status) => status === 403);

  await expectStatus('LIBRARIAN borrow read ok', 'GET', '/borrow/loans', librarianToken, undefined, (status) => status === 200);
  await expectStatus('LIBRARIAN create PO forbidden', 'POST', '/api/purchase-orders', librarianToken, {}, (status) => status === 403);
  await expectStatus('LIBRARIAN stock write forbidden', 'POST', '/api/inventory/inbound', librarianToken, {}, (status) => status === 403);
  await expectStatus('LIBRARIAN order request forbidden', 'POST', '/api/order-requests/outbound', librarianToken, {}, (status) => status === 403);
  await expectStatus('LIBRARIAN warehouse write forbidden', 'POST', '/api/warehouses', librarianToken, {}, (status) => status === 403);
  await expectStatus('LIBRARIAN IAM forbidden', 'GET', '/iam/users', librarianToken, undefined, (status) => status === 403);

  await expectStatus('CUSTOMER self profile ok', 'GET', '/my/profile', customerToken, undefined, (status) => status === 200);
  await expectStatus('CUSTOMER borrow customers forbidden', 'GET', '/borrow/customers', customerToken, undefined, (status) => status === 403);
  await expectStatus('CUSTOMER borrow loans forbidden', 'GET', '/borrow/loans', customerToken, undefined, (status) => status === 403);
  await expectStatus('CUSTOMER create PO forbidden', 'POST', '/api/purchase-orders', customerToken, {}, (status) => status === 403);
  await expectStatus('CUSTOMER inbound forbidden', 'POST', '/api/inventory/inbound', customerToken, {}, (status) => status === 403);
  await expectStatus('CUSTOMER IAM forbidden', 'GET', '/iam/users', customerToken, undefined, (status) => status === 403);

  await expectStatus('ADMIN users ok', 'GET', '/iam/users', adminToken, undefined, (status) => status === 200);
  await expectStatus('ADMIN roles ok', 'GET', '/iam/roles', adminToken, undefined, (status) => status === 200);

  console.log(`BACKEND_RBAC_PASS=${passed} TOTAL=${total}`);
}

run().catch((error) => {
  console.error(error.message || error);
  console.error(`BACKEND_RBAC_PASS=${passed} TOTAL=${total}`);
  process.exit(1);
});
