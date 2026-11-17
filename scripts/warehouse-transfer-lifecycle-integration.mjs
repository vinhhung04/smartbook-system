import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

if (process.env.SMARTBOOK_TEST_ISOLATED !== '1') throw new Error('Disposable QA stack required');
const base = process.env.GATEWAY_URL;
const password = process.env.DEMO_PASSWORD;
assert.ok(base && password && process.env.DB_USER);
const sql = query => execFileSync('docker', ['compose', 'exec', '-T', 'db', 'psql', '-U', process.env.DB_USER, '-d', 'inventory_db', '-v', 'ON_ERROR_STOP=1', '-At', '-c', query], { encoding: 'utf8' }).trim();
async function api(method, path, token, body) {
  const response = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await response.json();
  assert.ok(response.ok, `${method} ${path}: ${response.status} ${JSON.stringify(data)}`);
  return data;
}
const login = async identifier => (await api('POST', '/auth/login', null, { identifier, password })).token;
const admin = await login('hung');
const sourceStaff = await login('staff01');
const destinationStaff = await login('warehouse01');
const warehouses = await api('GET', '/api/warehouses', admin);
const source = warehouses.find(w => w.code === 'WH-HCM-01');
const destination = warehouses.find(w => w.code === 'WH-HN-01');
assert.ok(source && destination);
const fixture = JSON.parse(sql(`SELECT row_to_json(s) FROM (SELECT sb.variant_id, sb.location_id FROM stock_balances sb JOIN locations l ON l.id=sb.location_id WHERE sb.warehouse_id='${source.id}' AND sb.available_qty>=4 AND l.location_type='SHELF_COMPARTMENT' ORDER BY sb.available_qty DESC LIMIT 1) s`));
assert.ok(fixture, 'seed must provide shelf stock');
const stock = warehouse => Number(sql(`SELECT COALESCE(SUM(on_hand_qty),0) FROM stock_balances WHERE variant_id='${fixture.variant_id}' AND warehouse_id='${warehouse}'`));
const beforeSource = stock(source.id);
const beforeDestination = stock(destination.id);
const created = (await api('POST', '/api/order-requests/transfer', admin, {
  from_warehouse_id: source.id, to_warehouse_id: destination.id, note: `QA transfer ${randomUUID()}`,
  lines: [{ variant_id: fixture.variant_id, from_location_id: fixture.location_id, quantity: 2 }],
})).data;
const id = created.task_id;
assert.ok(id);
await api('POST', `/api/order-requests/transfer/${id}/approve`, admin, {});
assert.equal(stock(destination.id), beforeDestination, 'approval must not add destination stock');
await api('POST', `/api/picking/tasks/transfer/${id}/claim-self`, sourceStaff, {});
const detail = await api('GET', `/api/picking/tasks/transfer/${id}`, sourceStaff);
const line = detail.current_line || detail.lines.find(l => l.remaining_qty > 0);
assert.ok(line);
await api('POST', `/api/picking/tasks/transfer/${id}/presence`, sourceStaff, { current_location_input: line.source_location_id });
await api('POST', `/api/picking/tasks/transfer/${id}/lines/${line.line_id}/confirm`, sourceStaff, {
  quantity: 2, scanned_location_input: line.source_location_id, scanned_variant_id: fixture.variant_id,
});
assert.equal(sql(`SELECT status FROM transfer_orders WHERE id='${id}'`), 'READY_FOR_OUTBOUND');
assert.equal(stock(destination.id), beforeDestination, 'picking must not add destination stock');
await api('PATCH', `/api/outbound/orders/transfer/${id}/claim-self`, sourceStaff, {});
await api('POST', `/api/outbound/orders/transfer/${id}/confirm`, sourceStaff, { scan_code: created.order_number });
assert.equal(sql(`SELECT status FROM transfer_orders WHERE id='${id}'`), 'IN_TRANSIT');
assert.equal(stock(source.id), beforeSource - 2);
assert.equal(stock(destination.id), beforeDestination, 'in-transit stock is not destination on-hand');
await api('PATCH', `/api/transfer-receiving/${id}/claim-self`, destinationStaff, {});
if (process.env.QA_TRANSFER_UI_HANDOFF === '1') {
  console.log(JSON.stringify({ id, number: created.order_number, variant: fixture.variant_id, source: source.id, destination: destination.id, beforeSource, beforeDestination }));
  process.exit(0);
}
const receivingLines = (await api('GET', `/api/transfer-receiving/${id}/lines`, destinationStaff)).data.items;
const payload = { items: receivingLines.map(l => ({ transfer_order_item_id: l.transfer_order_item_id, delivered_qty: l.shipped_qty, damaged_qty: 0, rejected_qty: 0 })) };
const confirm = async () => {
  const response = await fetch(`${base}/api/transfer-receiving/${id}/confirm`, {
    method: 'POST', headers: { Authorization: `Bearer ${destinationStaff}`, 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  });
  return { status: response.status, body: await response.json() };
};
const raced = await Promise.all([confirm(), confirm()]);
const successes = raced.filter(r => r.status === 200 || r.status === 201);
assert.ok(successes.length >= 1, JSON.stringify(raced));
for (const result of raced) {
  if (result.status !== 200 && result.status !== 201) {
    // Serializable transactions may reject the loser; that is the controller's
    // documented retryable response, not a second successful receipt.
    assert.equal(result.status, 409);
    assert.equal(result.body.code, 'CONCURRENCY_CONFLICT');
  }
}
const replay = await api('POST', `/api/transfer-receiving/${id}/confirm`, destinationStaff, payload);
for (const result of successes) assert.equal(result.body.data.goods_receipt_id, replay.data.goods_receipt_id);
assert.equal(sql(`SELECT status FROM transfer_orders WHERE id='${id}'`), 'RECEIVED');
assert.equal(stock(source.id), beforeSource - 2);
assert.equal(stock(destination.id), beforeDestination + 2, 'two confirms must add exactly two copies, not four');
assert.equal(stock(source.id) + stock(destination.id), beforeSource + beforeDestination, 'end-to-end transfer conserves on-hand stock');
assert.equal(Number(sql(`SELECT SUM(received_qty) FROM transfer_order_items WHERE transfer_order_id='${id}'`)), 2);
console.log('PASS request -> approve -> pick -> ship -> concurrent receive; source/destination database balances conserved');
