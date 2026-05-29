const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
const password = process.env.DEMO_PASSWORD || '123456';
import { readFile } from 'node:fs/promises';

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

async function assertPickingDetailGetDoesNotWrite() {
  const source = await readFile(new URL('../services/inventory-service/src/controllers/picking.controller.js', import.meta.url), 'utf8');
  const start = source.indexOf('async function getPickingTaskDetail');
  const end = source.indexOf('async function confirmPickerPresence');
  if (start < 0 || end < 0 || end <= start) {
    fail('picking detail source check', 'getPickingTaskDetail block not found');
  }
  const block = source.slice(start, end);
  if (/\.(update|create|upsert|delete|deleteMany)\s*\(/.test(block)) {
    fail('GET picking detail does not mutate DB', 'write call found inside getPickingTaskDetail');
  }
  pass('GET picking detail does not mutate DB');
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
  await assertPickingDetailGetDoesNotWrite();

  const adminToken = await login(users.admin);
  const managerToken = await login(users.manager);
  const staffToken = await login(users.staff);
  const librarianToken = await login(users.librarian);
  const customerToken = await login(users.customer);

  await assertMe('ADMIN', adminToken, ['ADMIN'], ['auth.users.read']);
  await assertMe('MANAGER', managerToken, ['MANAGER'], ['inventory.operation.decide', 'inventory.stock.adjust', 'inventory.purchase.write', 'inventory.purchase.approve', 'reports.read', 'inventory.purchase.request', 'inventory.exception.report']);
  await assertMe('STAFF', staffToken, ['STAFF'], ['inventory.task.read', 'inventory.task.progress', 'inventory.purchase.request', 'inventory.exception.report'], ['inventory.stock.read', 'inventory.stock.write', 'inventory.stock.adjust', 'inventory.operation.decide', 'inventory.catalog.write', 'inventory.warehouse.read', 'inventory.warehouse.write', 'inventory.receiving.read', 'inventory.receiving.write', 'inventory.putaway.execute', 'inventory.purchase.read', 'inventory.purchase.write', 'inventory.purchase.approve', 'inventory.supplier.read', 'inventory.supplier.write', 'inventory.transfer.write', 'reports.read']);
  await assertMe('LIBRARIAN', librarianToken, ['LIBRARIAN'], ['borrow.write', 'inventory.catalog.read']);
  await assertMe('CUSTOMER', customerToken, ['CUSTOMER'], ['customer.self.read', 'inventory.catalog.read'], ['borrow.read', 'borrow.write']);

  await expectStatus('STAFF catalog read', 'GET', '/api/books', staffToken, undefined, (status) => status === 200);
  await expectStatus('STAFF my warehouse tasks read', 'GET', '/api/my-warehouse-tasks', staffToken, undefined, (status) => status === 200);
  await expectStatus('STAFF receiving warehouse context read', 'GET', '/api/receiving-context/warehouses', staffToken, undefined, (status) => status === 200);
  await expectStatus('STAFF manual receiving draft reaches validation', 'POST', '/api/goods-receipts', staffToken, {}, (status) => status !== 401 && status !== 403);
  await expectStatus('STAFF incomplete book create reaches validation', 'POST', '/api/books/incomplete', staffToken, {}, (status) => status !== 401 && status !== 403);
  await expectStatus('STAFF full inventory forbidden', 'GET', '/api/inventory', staffToken, undefined, (status) => status === 403);
  await expectStatus('STAFF stock movements forbidden', 'GET', '/api/stock-movements', staffToken, undefined, (status) => status === 403);
  await expectStatus('STAFF goods receipts forbidden', 'GET', '/api/goods-receipts', staffToken, undefined, (status) => status === 403);
  await expectStatus('STAFF supplier deliveries forbidden', 'GET', '/api/supplier-deliveries', staffToken, undefined, (status) => status === 403);
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
  await expectStatus('STAFF picking confirm reaches assignment/controller guard', 'POST', '/api/picking/tasks/outbound/00000000-0000-4000-8000-000000000000/lines/00000000-0000-4000-8000-000000000001/confirm', staffToken, {}, (status) => status !== 401 && status !== 403);
  await expectStatus('STAFF putaway confirm reaches assignment/controller guard', 'POST', '/api/putaway/receipts/00000000-0000-4000-8000-000000000000/confirm', staffToken, {}, (status) => status !== 401 && status !== 403);
  await expectStatus('STAFF receiving transfer forbidden', 'POST', '/api/receiving-putaway/transfer', staffToken, {}, (status) => status === 403);
  await expectStatus('STAFF outbound confirm reaches assignment/controller guard', 'POST', '/api/outbound/orders/outbound/00000000-0000-4000-8000-000000000000/confirm', staffToken, {}, (status) => status !== 401 && status !== 403);
  await expectStatus('STAFF IAM forbidden', 'GET', '/iam/users', staffToken, undefined, (status) => status === 403);
  await expectStatus('STAFF borrow admin forbidden', 'GET', '/borrow/loans', staffToken, undefined, (status) => status === 403);

  // Warehouse endpoints
  await expectStatus('STAFF receiving context warehouses allowed', 'GET', '/api/receiving-context/warehouses', staffToken, undefined, (status) => status === 200);
  await expectStatus('STAFF full warehouses list forbidden', 'GET', '/api/warehouses', staffToken, undefined, (status) => status === 403);

  // Purchase Request: STAFF can create + read own, cannot list all or approve/reject/convert
  await expectStatus('STAFF create purchase request reaches validation', 'POST', '/api/purchase-requests', staffToken, {}, (status) => status !== 401 && status !== 403);
  await expectStatus('STAFF my purchase requests allowed', 'GET', '/api/purchase-requests/my', staffToken, undefined, (status) => status === 200);
  await expectStatus('STAFF all purchase requests forbidden', 'GET', '/api/purchase-requests', staffToken, undefined, (status) => status === 403);
  await expectStatus('STAFF approve purchase request forbidden', 'POST', '/api/purchase-requests/00000000-0000-4000-8000-000000000000/approve', staffToken, {}, (status) => status === 403);
  await expectStatus('STAFF reject purchase request forbidden', 'POST', '/api/purchase-requests/00000000-0000-4000-8000-000000000000/reject', staffToken, {}, (status) => status === 403);
  await expectStatus('STAFF convert purchase request forbidden', 'POST', '/api/purchase-requests/00000000-0000-4000-8000-000000000000/convert-to-po', staffToken, {}, (status) => status === 403);

  // Exception Report: STAFF can create + read own, cannot list all or resolve
  // With random task_id the create must fail validation (404/400), not succeed (201) and not be an auth error (401/403)
  await expectStatus('STAFF create exception report reaches validation', 'POST', '/api/exception-reports', staffToken, {}, (status) => status !== 401 && status !== 403);
  await expectStatus('STAFF exception report random task_id rejected', 'POST', '/api/exception-reports', staffToken, { warehouse_id: '00000000-0000-4000-8000-000000000000', task_type: 'RECEIVING', task_id: '00000000-0000-4000-8000-000000000000', exception_type: 'SHORT', note: 'test' }, (status) => status !== 201 && status !== 401 && status !== 403);
  await expectStatus('STAFF my exception reports allowed', 'GET', '/api/exception-reports/my', staffToken, undefined, (status) => status === 200);
  await expectStatus('STAFF all exception reports forbidden', 'GET', '/api/exception-reports', staffToken, undefined, (status) => status === 403);
  await expectStatus('STAFF resolve exception report forbidden', 'POST', '/api/exception-reports/00000000-0000-4000-8000-000000000000/resolve', staffToken, {}, (status) => status === 403);

  // Self-claim available tasks: STAFF can read available list and claim endpoints reach controller
  await expectStatus('STAFF available tasks allowed', 'GET', '/api/my-warehouse-tasks/available', staffToken, undefined, (status) => status === 200);
  await expectStatus('STAFF picking claim-self not auth-blocked', 'POST', '/api/picking/tasks/outbound/00000000-0000-4000-8000-000000000000/claim-self', staffToken, {}, (status) => status !== 401 && status !== 403);
  await expectStatus('STAFF outbound claim-self not auth-blocked', 'PATCH', '/api/outbound/orders/outbound/00000000-0000-4000-8000-000000000000/claim-self', staffToken, {}, (status) => status !== 401 && status !== 403);
  await expectStatus('STAFF transfer-receiving claim-self not auth-blocked', 'PATCH', '/api/transfer-receiving/00000000-0000-4000-8000-000000000000/claim-self', staffToken, {}, (status) => status !== 401 && status !== 403);
  await expectStatus('CUSTOMER available tasks forbidden', 'GET', '/api/my-warehouse-tasks/available', customerToken, undefined, (status) => status === 403);
  await expectStatus('LIBRARIAN available tasks forbidden', 'GET', '/api/my-warehouse-tasks/available', librarianToken, undefined, (status) => status === 403);

  await expectStatus('MANAGER inventory read ok', 'GET', '/api/inventory', managerToken, undefined, (status) => status === 200);
  await expectStatus('MANAGER stock movements ok', 'GET', '/api/stock-movements', managerToken, undefined, (status) => status === 200);
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

  // Purchase Request + Exception Report: MANAGER can list all and approve/resolve
  await expectStatus('MANAGER all purchase requests allowed', 'GET', '/api/purchase-requests', managerToken, undefined, (status) => status !== 401 && status !== 403);
  await expectStatus('MANAGER approve purchase request reaches validation', 'POST', '/api/purchase-requests/00000000-0000-4000-8000-000000000000/approve', managerToken, {}, (status) => status !== 401 && status !== 403);
  await expectStatus('MANAGER all exception reports allowed', 'GET', '/api/exception-reports', managerToken, undefined, (status) => status !== 401 && status !== 403);
  await expectStatus('MANAGER resolve exception report reaches validation', 'POST', '/api/exception-reports/00000000-0000-4000-8000-000000000000/resolve', managerToken, {}, (status) => status !== 401 && status !== 403);

  await expectStatus('LIBRARIAN borrow read ok', 'GET', '/borrow/loans', librarianToken, undefined, (status) => status === 200);
  await expectStatus('LIBRARIAN incomplete catalog update reaches controller', 'PATCH', '/api/books/00000000-0000-4000-8000-000000000000', librarianToken, {}, (status) => status !== 401 && status !== 403);
  await expectStatus('LIBRARIAN create PO forbidden', 'POST', '/api/purchase-orders', librarianToken, {}, (status) => status === 403);
  await expectStatus('LIBRARIAN stock write forbidden', 'POST', '/api/inventory/inbound', librarianToken, {}, (status) => status === 403);
  await expectStatus('LIBRARIAN inventory read forbidden', 'GET', '/api/inventory', librarianToken, undefined, (status) => status === 403);
  await expectStatus('LIBRARIAN order request forbidden', 'POST', '/api/order-requests/outbound', librarianToken, {}, (status) => status === 403);
  await expectStatus('LIBRARIAN warehouse write forbidden', 'POST', '/api/warehouses', librarianToken, {}, (status) => status === 403);
  await expectStatus('LIBRARIAN IAM forbidden', 'GET', '/iam/users', librarianToken, undefined, (status) => status === 403);

  await expectStatus('CUSTOMER self profile ok', 'GET', '/my/profile', customerToken, undefined, (status) => status === 200);
  await expectStatus('CUSTOMER borrow customers forbidden', 'GET', '/borrow/customers', customerToken, undefined, (status) => status === 403);
  await expectStatus('CUSTOMER borrow loans forbidden', 'GET', '/borrow/loans', customerToken, undefined, (status) => status === 403);
  await expectStatus('CUSTOMER create PO forbidden', 'POST', '/api/purchase-orders', customerToken, {}, (status) => status === 403);
  await expectStatus('CUSTOMER inventory forbidden', 'GET', '/api/inventory', customerToken, undefined, (status) => status === 403);
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
