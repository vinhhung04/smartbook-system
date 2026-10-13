const test = require('node:test');
const assert = require('node:assert/strict');
const { stockStatus, summarizeWarehouses } = require('../src/utils/warehouse-stock');

test('status uses the reorder point, or the global threshold when there is none', () => {
  assert.equal(stockStatus({ available_qty: 0, reorder_point: 10 }, 5), 'OUT_OF_STOCK');
  assert.equal(stockStatus({ available_qty: -1, reorder_point: 0 }, 5), 'OUT_OF_STOCK');
  assert.equal(stockStatus({ available_qty: 10, reorder_point: 10 }, 5), 'LOW_STOCK');
  assert.equal(stockStatus({ available_qty: 5, reorder_point: 0 }, 5), 'LOW_STOCK');
  assert.equal(stockStatus({ available_qty: 6, reorder_point: null }, 5), 'OK');
});

test('a variant is counted once per warehouse on its summed stock, not once per location', () => {
  // Rows are already summed per (warehouse, variant). v1 had 0 in a receiving
  // bay and 8 on the shelf - summed it is 8, so it is NOT out of stock.
  const rows = [
    { warehouse_id: 'w1', warehouse_name: 'Kho A', variant_id: 'v1', available_qty: 8, reserved_qty: 1, borrowed_qty: 2, reorder_point: 3 },
    { warehouse_id: 'w1', warehouse_name: 'Kho A', variant_id: 'v2', available_qty: 0, reserved_qty: 2, borrowed_qty: 0, reorder_point: 3 },
    { warehouse_id: 'w1', warehouse_name: 'Kho A', variant_id: 'v3', available_qty: 2, reserved_qty: 0, borrowed_qty: 1, reorder_point: 0 },
    { warehouse_id: 'w2', warehouse_name: 'Kho B', variant_id: null },
  ];
  const [a, b] = summarizeWarehouses(rows, 5);
  assert.deepEqual(a, {
    warehouse_id: 'w1', warehouse_name: 'Kho A', low_stock_variants: 2, out_of_stock_variants: 1,
    total_available_qty: 10, total_reserved_qty: 3, total_borrowed_qty: 3,
  });
  assert.equal(b.warehouse_name, 'Kho B');
  assert.equal(b.low_stock_variants, 0);
  assert.equal(b.total_available_qty, 0);
});
