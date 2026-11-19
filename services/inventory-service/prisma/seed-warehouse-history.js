/**
 * SmartBook — synthetic warehouse history for the last N months (default 4).
 *
 * THIS IS SIMULATED DATA, NOT REAL OPERATIONS. It fills inventory_db with the
 * paper trail a warehouse would have produced: purchase orders and their goods
 * receipts + putaway, inter-warehouse transfers, manual outbound orders, damage
 * adjustments, and the BORROW/RETURN movements of the borrow simulation's SIM-
 * loans (services/borrow-service/prisma/simulation) - run that one first.
 *
 * Every row it writes carries a SIM- document number (SIM-PO-, SIM-GR-, SIM-TR-,
 * SIM-OUT-, SIM-MV-), and every stock change it applies to stock_balances is
 * stored on the movement that caused it (metadata.sim_effect). A re-run first
 * reverses those effects and deletes the SIM- rows, then regenerates, so it is
 * idempotent and never touches hand-made data. Effects on balances:
 *   receipts/putaway  +on_hand +available at the shelf
 *   transfers         -on_hand -available at the source shelf, + at the target shelf
 *   outbound/damage   -on_hand -available
 *   open SIM loans    +borrowed (-available, or +on_hand when no copy was free)
 * so open loans in borrow_db stay <= borrowed_qty in inventory_db (analytics check).
 *
 * USAGE (inside the inventory-service container, cwd /app):
 *   node prisma/seed-warehouse-history.js [--dry-run]
 *   node - [--dry-run] < seed-warehouse-history.js        (image without this file)
 * ENV: DATABASE_URL (inventory_db, write), BORROW_DATABASE_URL and AUTH_DATABASE_URL
 *      (read-only, optional), HISTORY_END (ISO date, default now), HISTORY_MONTHS (4),
 *      HISTORY_SEED (20261119).
 */

const crypto = require('crypto');
const { PrismaClient } = require('@prisma/client');

const DRY_RUN = process.argv.includes('--dry-run');
const END = process.env.HISTORY_END ? new Date(process.env.HISTORY_END) : new Date();
const MONTHS = Number(process.env.HISTORY_MONTHS || 4);
const SEED = Number(process.env.HISTORY_SEED || 20261119);
const START = new Date(END);
START.setUTCMonth(START.getUTCMonth() - MONTHS);
const TZ_HOURS = 7;
const DAY = 86400000;
const HOUR = 3600000;
const FALLBACK_USER = '00000000-0000-0000-0000-000000000001';

// ── deterministic randomness ────────────────────────────────────────────────
function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(SEED);
const int = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const chance = (p) => rand() < p;
function weightedPick(items, weightOf) {
  const total = items.reduce((s, x) => s + weightOf(x), 0);
  let r = rand() * total;
  for (const x of items) { r -= weightOf(x); if (r <= 0) return x; }
  return items[items.length - 1];
}
function sampleDistinct(items, n, weightOf) {
  const pool = [...items];
  const out = [];
  while (out.length < n && pool.length) {
    const x = weightedPick(pool, weightOf);
    out.push(x);
    pool.splice(pool.indexOf(x), 1);
  }
  return out;
}

// ── time helpers (library works Mon-Sat, 8h-17h local) ─────────────────────
function atLocal(day, hour, minute = 0) {
  const d = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), hour - TZ_HOURS, minute));
  return d;
}
function localDay(t) { return new Date(t.getTime() + TZ_HOURS * HOUR); }
function isWorkday(t) { return localDay(t).getUTCDay() !== 0; }
function nextWorkTime(t, minHour = 8, maxHour = 17) {
  let d = new Date(t);
  const lh = localDay(d).getUTCHours();
  if (lh >= maxHour) d = atLocal(new Date(localDay(d).getTime() + DAY), minHour, int(0, 40));
  else if (lh < minHour) d = atLocal(localDay(d), minHour, int(0, 40));
  while (!isWorkday(d)) d = atLocal(new Date(localDay(d).getTime() + DAY), minHour, int(0, 40));
  return d;
}
const workTimeOn = (day) => nextWorkTime(atLocal(day, int(8, 16), int(0, 59)));
const addHours = (t, h) => nextWorkTime(new Date(t.getTime() + h * HOUR));
const addDays = (t, d) => nextWorkTime(new Date(t.getTime() + d * DAY));
const ymd = (t) => localDay(t).toISOString().slice(2, 10).replace(/-/g, '');
const dateOnly = (t) => new Date(`${localDay(t).toISOString().slice(0, 10)}T00:00:00Z`);

// ── load the live catalogue ────────────────────────────────────────────────
async function loadContext(db) {
  const warehouses = await db.$queryRawUnsafe(
    `SELECT id::text, code, name FROM warehouses WHERE is_active ORDER BY code`);
  const locations = await db.$queryRawUnsafe(
    `SELECT id::text, warehouse_id::text, location_type, is_pickable FROM locations WHERE is_active ORDER BY location_code, id`);
  const variants = await db.$queryRawUnsafe(
    `SELECT id::text, unit_cost::float AS unit_cost, list_price::float AS list_price
       FROM book_variants WHERE is_active ORDER BY sku, id`);
  const suppliers = await db.$queryRawUnsafe(`SELECT id::text FROM suppliers WHERE status = 'ACTIVE' ORDER BY code`);
  const supplierVariants = await db.$queryRawUnsafe(
    `SELECT supplier_id::text, variant_id::text, lead_time_days, default_cost::float AS default_cost FROM supplier_variants ORDER BY supplier_id, variant_id`);
  const balances = await db.$queryRawUnsafe(
    `SELECT variant_id::text, location_id::text, warehouse_id::text, on_hand_qty, available_qty, borrowed_qty
       FROM stock_balances ORDER BY variant_id, location_id`);
  const knownUsers = await db.$queryRawUnsafe(
    `SELECT DISTINCT ordered_by_user_id::text AS id FROM purchase_orders ORDER BY 1 LIMIT 20`);

  // shelves under an open stock-audit count are frozen (trigger stock_balance_audit_freeze): never pick them
  const frozen = new Set((await db.$queryRawUnsafe(
    `SELECT location_id::text FROM stock_audit_location_sessions WHERE released_at IS NULL AND counting_completed_at IS NULL`))
    .map((r) => r.location_id));

  const wh = warehouses.map((w) => ({
    ...w,
    isHub: w.code.startsWith('WH-'),
    receiving: locations.find((l) => l.warehouse_id === w.id && l.location_type === 'RECEIVING' && !frozen.has(l.id))?.id || null,
    shelves: locations.filter((l) => l.warehouse_id === w.id && l.location_type === 'SHELF_COMPARTMENT' && l.is_pickable && !frozen.has(l.id)).map((l) => l.id),
  })).filter((w) => w.shelves.length);
  return { warehouses: wh, locations, variants, suppliers, supplierVariants, balances, knownUsers };
}

async function loadStaff(url, warehouses, fallbackIds) {
  const byWarehouse = new Map(warehouses.map((w) => [w.id, { staff: [], managers: [] }]));
  const global = { staff: [], managers: [] };
  if (url) {
    const auth = new PrismaClient({ datasources: { db: { url } } });
    try {
      const rows = await auth.$queryRawUnsafe(`
        SELECT u.id::text, u.primary_warehouse_id::text AS warehouse_id, r.code AS role
          FROM users u JOIN user_roles ur ON ur.user_id = u.id JOIN roles r ON r.id = ur.role_id
         WHERE u.deleted_at IS NULL AND u.status = 'ACTIVE'
           AND r.code IN ('WAREHOUSE_STAFF', 'WAREHOUSE_MANAGER', 'LIBRARIAN', 'ADMIN')
           AND u.username !~* '(e2e|debug|test|admin_user_|tmp)'
         ORDER BY u.username, r.code`);
      for (const r of rows) {
        const bucket = r.role === 'WAREHOUSE_MANAGER' || r.role === 'ADMIN' ? 'managers' : 'staff';
        if (!global[bucket].includes(r.id)) global[bucket].push(r.id);
        if (r.warehouse_id && byWarehouse.has(r.warehouse_id)) byWarehouse.get(r.warehouse_id)[bucket].push(r.id);
      }
    } finally { await auth.$disconnect(); }
  }
  const fallback = fallbackIds.length ? fallbackIds : [FALLBACK_USER];
  if (!global.staff.length) global.staff = global.managers.length ? global.managers : fallback;
  if (!global.managers.length) global.managers = global.staff;
  return {
    staff: (wid) => pick(byWarehouse.get(wid)?.staff.length ? byWarehouse.get(wid).staff : global.staff),
    manager: (wid) => pick(byWarehouse.get(wid)?.managers.length ? byWarehouse.get(wid).managers : global.managers),
    counts: { staff: global.staff.length, managers: global.managers.length },
  };
}

async function loadSimLoans(url) {
  if (!url) return [];
  const borrow = new PrismaClient({ datasources: { db: { url } } });
  try {
    return await borrow.$queryRawUnsafe(`
      SELECT li.id::text, li.variant_id::text, lt.warehouse_id::text, lt.id::text AS loan_id, lt.loan_number,
             lt.borrow_date, li.return_date, li.status, lt.handled_by_user_id::text AS handled_by
        FROM loan_items li JOIN loan_transactions lt ON lt.id = li.loan_id
       WHERE lt.loan_number LIKE 'SIM-%'
         AND (lt.borrow_date >= $1 OR (li.return_date IS NULL AND li.status IN ('BORROWED', 'OVERDUE')))
         AND lt.borrow_date <= $2
       ORDER BY lt.borrow_date, lt.loan_number, li.id`, START, END);
  } finally { await borrow.$disconnect(); }
}

// ── generation ─────────────────────────────────────────────────────────────
function generate(ctx, staff, loans) {
  const out = { purchase_orders: [], purchase_order_items: [], goods_receipts: [], goods_receipt_items: [],
    transfer_orders: [], transfer_order_items: [], outbound_orders: [], outbound_order_items: [], stock_movements: [] };
  const variantById = new Map(ctx.variants.map((v) => [v.id, v]));
  const whById = new Map(ctx.warehouses.map((w) => [w.id, w]));
  const locWh = new Map(ctx.locations.map((l) => [l.id, l.warehouse_id]));
  // balance model: key variant|location -> quantities as of the moment being simulated
  const bal = new Map();
  for (const b of ctx.balances) bal.set(`${b.variant_id}|${b.location_id}`, { ...b, available: b.available_qty, on_hand: b.on_hand_qty });
  const balAt = (variantId, locationId) => {
    const key = `${variantId}|${locationId}`;
    if (!bal.has(key)) bal.set(key, { variant_id: variantId, location_id: locationId, warehouse_id: locWh.get(locationId), on_hand: 0, available: 0, borrowed_qty: 0, isNew: true });
    return bal.get(key);
  };
  const shelfFor = (variantId, w) => {
    const held = w.shelves.filter((s) => bal.get(`${variantId}|${s}`)?.on_hand > 0);
    return held.length ? held.reduce((a, b) => (bal.get(`${variantId}|${a}`).on_hand >= bal.get(`${variantId}|${b}`).on_hand ? a : b)) : pick(w.shelves);
  };
  const demand = new Map();
  for (const l of loans) demand.set(l.variant_id, (demand.get(l.variant_id) || 0) + 1);
  const demandWeight = (v) => 1 + Math.sqrt(demand.get(v.id) || 0);
  const costOf = (variantId, supplierId) => {
    const sv = ctx.supplierVariants.find((x) => x.variant_id === variantId && x.supplier_id === supplierId);
    const v = variantById.get(variantId);
    const base = sv?.default_cost || v.unit_cost || Math.round((v.list_price || 120000) * 0.7);
    return Math.round((base || int(45, 180) * 1000) / 1000) * 1000;
  };

  let mv = 0;
  const movement = (row, effect) => {
    mv += 1;
    const metadata = { ...(row.metadata || {}), simulated: true };
    if (effect) {
      const b = balAt(row.variant_id, effect.location_id);
      b.on_hand += effect.on_hand || 0;
      b.available += effect.available || 0;
      b.borrowed_qty += effect.borrowed || 0;
      metadata.sim_effect = { variant_id: row.variant_id, location_id: effect.location_id, warehouse_id: b.warehouse_id,
        on_hand: effect.on_hand || 0, available: effect.available || 0, borrowed: effect.borrowed || 0 };
    }
    out.stock_movements.push({ id: crypto.randomUUID(), movement_number: `SIM-MV-${String(mv).padStart(6, '0')}`,
      movement_status: 'POSTED', source_service: 'INVENTORY_SERVICE', idempotency_key: `sim-wh-mv-${mv}`,
      unit_cost: 0, ...row, metadata });
  };

  const events = []; // { at, run }
  const seq = { po: 0, gr: 0, tr: 0, out: 0 };
  const receivers = ctx.warehouses.filter((w) => w.receiving);
  const hubs = ctx.warehouses.filter((w) => w.isHub);
  const activeVariants = ctx.variants;

  // purchase orders → goods receipt → putaway
  for (const w of receivers) {
    const every = w.isHub ? [4, 8] : [10, 18];
    for (let t = addDays(START, int(0, every[1])); t < END; t = addDays(t, int(every[0], every[1]))) {
      const orderAt = workTimeOn(localDay(t));
      if (orderAt >= END) break;
      const supplierId = pick(ctx.suppliers).id;
      const lines = sampleDistinct(activeVariants, w.isHub ? int(2, 6) : int(2, 4), demandWeight)
        .map((v) => ({ variant: v, qty: w.isHub ? int(4, 15) : int(2, 6), cost: costOf(v.id, supplierId) }));
      const svLead = ctx.supplierVariants.find((x) => x.supplier_id === supplierId)?.lead_time_days;
      const leadDays = (svLead || int(5, 12)) + int(-2, 3);
      const receivedAt = addHours(addDays(orderAt, Math.max(2, leadDays)), int(0, 3));
      seq.po += 1;
      const po = { id: crypto.randomUUID(), po_number: `SIM-PO-${ymd(orderAt)}-${String(seq.po).padStart(3, '0')}`,
        supplier_id: supplierId, warehouse_id: w.id, ordered_by_user_id: staff.manager(w.id), order_date: dateOnly(orderAt),
        expected_date: dateOnly(addDays(orderAt, leadDays)), created_at: orderAt, updated_at: orderAt };
      const cancelled = chance(0.04);
      const arrived = !cancelled && receivedAt < END;
      const partial = arrived && END - receivedAt < 21 * DAY && chance(0.25);
      if (cancelled) Object.assign(po, { status: 'CANCELLED', note: 'Hủy do nhà cung cấp hết hàng.', updated_at: addDays(orderAt, 1) });
      else if (arrived) Object.assign(po, { status: partial ? 'PARTIALLY_RECEIVED' : 'RECEIVED', supplier_response_status: 'ACCEPTED',
        approved_by_user_id: staff.manager(w.id), updated_at: receivedAt });
      else {
        const age = END - orderAt;
        Object.assign(po, age < 2 * DAY ? { status: 'APPROVED', approved_by_user_id: staff.manager(w.id) }
          : { status: chance(0.5) ? 'SENT_TO_SUPPLIER' : 'SUPPLIER_CONFIRMED', approved_by_user_id: staff.manager(w.id),
            supplier_response_status: 'ACCEPTED' });
      }
      po.note = po.note || `Bổ sung định kỳ cho ${w.name}.`;
      out.purchase_orders.push(po);
      const shortLine = partial ? int(0, lines.length - 1) : -1;
      lines.forEach((l, i) => {
        l.received = arrived ? (i === shortLine ? Math.max(1, Math.floor(l.qty * 0.6)) : l.qty) : 0;
        out.purchase_order_items.push({ id: crypto.randomUUID(), purchase_order_id: po.id, variant_id: l.variant.id,
          ordered_qty: l.qty, received_qty: l.received, unit_cost: l.cost });
      });
      if (!arrived) continue;
      events.push({ at: receivedAt, run: () => {
        seq.gr += 1;
        const receiver = staff.staff(w.id);
        const gr = { id: crypto.randomUUID(), receipt_number: `SIM-GR-${ymd(receivedAt)}-${String(seq.gr).padStart(3, '0')}`,
          purchase_order_id: po.id, warehouse_id: w.id, source_type: 'PURCHASE_ORDER', idempotency_key: `sim-wh-gr-${seq.gr}`,
          status: 'POSTED', received_by_user_id: receiver, putaway_assignee_user_id: receiver, received_at: receivedAt,
          note: `Nhận hàng theo ${po.po_number}.`, created_at: receivedAt, updated_at: receivedAt };
        out.goods_receipts.push(gr);
        const putawayAt = addHours(receivedAt, int(1, 5));
        for (const l of lines) {
          const shelf = shelfFor(l.variant.id, w);
          const itemId = crypto.randomUUID();
          const damaged = chance(0.05) ? 1 : 0;
          out.goods_receipt_items.push({ id: itemId, goods_receipt_id: gr.id, variant_id: l.variant.id, location_id: shelf,
            quantity: l.received, actual_quantity: l.received, delivered_qty: l.received + damaged, damaged_qty: damaged,
            unit_cost: l.cost, condition_grade: 'NEW', note: damaged ? 'Một cuốn móp bìa, không nhập kho.' : null });
          movement({ movement_type: 'INBOUND', warehouse_id: w.id, variant_id: l.variant.id, to_location_id: w.receiving,
            quantity: l.received, unit_cost: l.cost, reference_type: 'GOODS_RECEIPT', reference_id: gr.id,
            created_by_user_id: receiver, created_at: receivedAt,
            metadata: { movement_bucket: 'RECEIVING', goods_receipt_item_id: itemId } });
          movement({ movement_type: 'INBOUND', warehouse_id: w.id, variant_id: l.variant.id, from_location_id: w.receiving,
            to_location_id: shelf, quantity: l.received, unit_cost: l.cost, reference_type: 'GOODS_RECEIPT', reference_id: gr.id,
            created_by_user_id: receiver, created_at: putawayAt,
            metadata: { putaway: true, movement_bucket: 'PUTAWAY', goods_receipt_item_id: itemId } },
          { location_id: shelf, on_hand: l.received, available: l.received });
        }
      } });
    }
  }

  // transfers hub → other warehouse with a receiving dock
  for (let t = addDays(START, int(1, 4)); t < END; t = addDays(t, int(2, 5))) {
    const requestedAt = workTimeOn(localDay(t));
    if (requestedAt >= END || !hubs.length) break;
    const from = pick(hubs);
    const targets = receivers.filter((w) => w.id !== from.id);
    if (!targets.length) break;
    const to = pick(targets);
    events.push({ at: requestedAt, run: () => {
      const candidates = [...bal.values()].filter((b) => b.warehouse_id === from.id && from.shelves.includes(b.location_id) && b.available >= 4);
      if (!candidates.length) return;
      const picked = sampleDistinct(candidates, int(1, 4), (b) => b.available);
      const shipAt = addHours(requestedAt, int(4, 26));
      const receiveAt = addDays(shipAt, from.code.slice(3, 5) === to.code.slice(3, 5) ? int(0, 1) : int(1, 3));
      const done = receiveAt < END;
      seq.tr += 1;
      const tr = { id: crypto.randomUUID(), transfer_number: `SIM-TR-${ymd(requestedAt)}-${String(seq.tr).padStart(3, '0')}`,
        from_warehouse_id: from.id, to_warehouse_id: to.id, requested_by_user_id: staff.manager(to.id),
        approved_by_user_id: staff.manager(from.id), requested_at: requestedAt, created_at: requestedAt,
        note: `Điều chuyển bổ sung sách cho ${to.name}.` };
      const items = picked.map((b) => ({ b, qty: Math.min(int(1, 4), b.available - 2) }));
      if (shipAt >= END) {
        Object.assign(tr, { status: 'APPROVED', updated_at: requestedAt });
        out.transfer_orders.push(tr);
        items.forEach(({ b, qty }) => out.transfer_order_items.push({ id: crypto.randomUUID(), transfer_order_id: tr.id,
          variant_id: b.variant_id, from_location_id: b.location_id, to_location_id: to.receiving, quantity: qty,
          unit_cost: variantById.get(b.variant_id)?.unit_cost || 0 }));
        return;
      }
      const shipper = staff.staff(from.id);
      Object.assign(tr, { status: done ? 'RECEIVED' : 'IN_TRANSIT', shipped_by_user_id: shipper, shipped_at: shipAt,
        received_by_user_id: done ? staff.staff(to.id) : null, received_at: done ? receiveAt : null, updated_at: done ? receiveAt : shipAt });
      out.transfer_orders.push(tr);
      for (const { b, qty } of items) {
        const cost = variantById.get(b.variant_id)?.unit_cost || 0;
        out.transfer_order_items.push({ id: crypto.randomUUID(), transfer_order_id: tr.id, variant_id: b.variant_id,
          from_location_id: b.location_id, to_location_id: to.receiving, quantity: qty, shipped_qty: qty,
          received_qty: done ? qty : 0, unit_cost: cost });
        movement({ movement_type: 'OUTBOUND', warehouse_id: from.id, variant_id: b.variant_id, from_location_id: b.location_id,
          quantity: qty, reference_type: 'TRANSFER_OUTBOUND', reference_id: tr.id, created_by_user_id: shipper, created_at: shipAt,
          metadata: { stage: 'OUTBOUND_CONFIRMED', transfer_number: tr.transfer_number } },
        { location_id: b.location_id, on_hand: -qty, available: -qty });
      }
      if (!done) return;
      events.push({ at: receiveAt, run: () => {
        seq.gr += 1;
        const receiver = tr.received_by_user_id;
        const gr = { id: crypto.randomUUID(), receipt_number: `SIM-GR-${ymd(receiveAt)}-${String(seq.gr).padStart(3, '0')}`,
          warehouse_id: to.id, source_type: 'TRANSFER', source_reference_id: tr.id, idempotency_key: `sim-wh-gr-${seq.gr}`,
          status: 'POSTED', received_by_user_id: receiver, putaway_assignee_user_id: receiver, received_at: receiveAt,
          note: `Nhận hàng điều chuyển ${tr.transfer_number}.`, created_at: receiveAt, updated_at: receiveAt };
        out.goods_receipts.push(gr);
        const putawayAt = addHours(receiveAt, int(1, 4));
        for (const { b, qty } of items) {
          const shelf = shelfFor(b.variant_id, to);
          const itemId = crypto.randomUUID();
          const cost = variantById.get(b.variant_id)?.unit_cost || 0;
          out.goods_receipt_items.push({ id: itemId, goods_receipt_id: gr.id, variant_id: b.variant_id, location_id: shelf,
            quantity: qty, actual_quantity: qty, delivered_qty: qty, unit_cost: cost, condition_grade: 'NEW' });
          movement({ movement_type: 'INBOUND', warehouse_id: to.id, variant_id: b.variant_id, to_location_id: to.receiving,
            quantity: qty, unit_cost: cost, reference_type: 'GOODS_RECEIPT', reference_id: gr.id, created_by_user_id: receiver,
            created_at: receiveAt, metadata: { source_type: 'TRANSFER', bucket: 'RECEIVING_HOLD', goods_receipt_item_id: itemId } });
          movement({ movement_type: 'INBOUND', warehouse_id: to.id, variant_id: b.variant_id, from_location_id: to.receiving,
            to_location_id: shelf, quantity: qty, unit_cost: cost, reference_type: 'GOODS_RECEIPT', reference_id: gr.id,
            created_by_user_id: receiver, created_at: putawayAt,
            metadata: { putaway: true, movement_bucket: 'PUTAWAY', goods_receipt_item_id: itemId } },
          { location_id: shelf, on_hand: qty, available: qty });
        }
      } });
    } });
  }

  // manual outbound orders (events, repairs, internal use) and damage write-offs
  const OUTBOUND_KINDS = [
    { ref: 'INTERNAL_REQUEST', note: 'Xuất sách phục vụ hoạt động đọc sách tại chi nhánh.' },
    { ref: 'MAINTENANCE', note: 'Xuất sách hư bìa đi bảo dưỡng, đóng lại gáy.' },
    { ref: 'ISSUE_REQUEST', note: 'Xuất tặng sách cho chương trình khuyến đọc.' },
  ];
  for (const w of hubs) {
    for (let t = addDays(START, int(2, 9)); t < END; t = addDays(t, int(6, 12))) {
      const requestedAt = workTimeOn(localDay(t));
      const completedAt = addHours(requestedAt, int(2, 8));
      if (completedAt >= END) break;
      events.push({ at: completedAt, run: () => {
        const candidates = [...bal.values()].filter((b) => b.warehouse_id === w.id && w.shelves.includes(b.location_id) && b.available >= 3);
        if (!candidates.length) return;
        const kind = pick(OUTBOUND_KINDS);
        seq.out += 1;
        const processor = staff.staff(w.id);
        const order = { id: crypto.randomUUID(), outbound_number: `SIM-OUT-${ymd(requestedAt)}-${String(seq.out).padStart(3, '0')}`,
          warehouse_id: w.id, outbound_type: 'MANUAL', status: 'COMPLETED', reference_type: kind.ref,
          requested_by_user_id: staff.manager(w.id), approved_by_user_id: staff.manager(w.id), processed_by_user_id: processor,
          requested_at: requestedAt, completed_at: completedAt, note: kind.note, created_at: requestedAt, updated_at: completedAt };
        out.outbound_orders.push(order);
        for (const b of sampleDistinct(candidates, int(1, 3), (x) => x.available)) {
          const qty = Math.min(int(1, 2), b.available - 1);
          out.outbound_order_items.push({ id: crypto.randomUUID(), outbound_order_id: order.id, variant_id: b.variant_id,
            source_location_id: b.location_id, quantity: qty, processed_qty: qty });
          movement({ movement_type: 'OUTBOUND', warehouse_id: w.id, variant_id: b.variant_id, from_location_id: b.location_id,
            quantity: qty, reference_type: 'OUTBOUND_ORDER', reference_id: order.id, created_by_user_id: processor,
            created_at: completedAt, metadata: { stage: 'OUTBOUND_CONFIRMED', outbound_number: order.outbound_number } },
          { location_id: b.location_id, on_hand: -qty, available: -qty });
        }
      } });
    }
    for (let t = addDays(START, int(5, 14)); t < END; t = addDays(t, int(10, 18))) {
      const at = workTimeOn(localDay(t));
      if (at >= END) break;
      events.push({ at, run: () => {
        const candidates = [...bal.values()].filter((b) => b.warehouse_id === w.id && w.shelves.includes(b.location_id) && b.available >= 2);
        if (!candidates.length) return;
        const b = pick(candidates);
        movement({ movement_type: 'ADJUSTMENT', warehouse_id: w.id, variant_id: b.variant_id, from_location_id: b.location_id,
          quantity: -1, unit_cost: variantById.get(b.variant_id)?.unit_cost || 0, reason_code: 'DAMAGE',
          created_by_user_id: staff.manager(w.id), created_at: at,
          metadata: { note: pick(['Bìa sách rách khi kiểm kho.', 'Sách bị ẩm, loại khỏi kho.', 'Mất trang, không còn cho mượn.']) } },
        { location_id: b.location_id, on_hand: -1, available: -1 });
      } });
    }
  }

  // BORROW / RETURN movements of the simulated loans; open loans stay on borrowed_qty
  let skippedLoans = 0;
  for (const loan of loans) {
    const w = whById.get(loan.warehouse_id);
    if (!w || !variantById.has(loan.variant_id)) { skippedLoans += 1; continue; }
    const borrowAt = new Date(loan.borrow_date);
    const returnAt = loan.return_date ? new Date(loan.return_date) : null;
    const open = !returnAt && ['BORROWED', 'OVERDUE'].includes(loan.status);
    const staffId = loan.handled_by && loan.handled_by !== FALLBACK_USER ? loan.handled_by : staff.staff(w.id);
    events.push({ at: borrowAt, run: () => {
      const shelf = shelfFor(loan.variant_id, w);
      const b = balAt(loan.variant_id, shelf);
      if (borrowAt >= START) {
        movement({ movement_type: 'BORROW', warehouse_id: w.id, variant_id: loan.variant_id, from_location_id: shelf,
          quantity: 1, source_service: 'BORROW_SERVICE', reference_type: 'LOAN_TRANSACTION', reference_id: loan.loan_id,
          reason_code: 'LOAN_CREATED', created_by_user_id: staffId, created_at: borrowAt,
          metadata: { loan_number: loan.loan_number, loan_item_id: loan.id } },
        open ? (b.available >= 1 ? { location_id: shelf, available: -1, borrowed: 1 } : { location_id: shelf, on_hand: 1, borrowed: 1 }) : null);
      } else if (open) {
        // opened before the window: no history row, only the balance it holds
        movement({ movement_type: 'BORROW', warehouse_id: w.id, variant_id: loan.variant_id, from_location_id: shelf,
          quantity: 1, source_service: 'BORROW_SERVICE', reference_type: 'LOAN_TRANSACTION', reference_id: loan.loan_id,
          reason_code: 'LOAN_CREATED', created_by_user_id: staffId, created_at: borrowAt,
          metadata: { loan_number: loan.loan_number, loan_item_id: loan.id } },
        b.available >= 1 ? { location_id: shelf, available: -1, borrowed: 1 } : { location_id: shelf, on_hand: 1, borrowed: 1 });
      }
      if (returnAt && returnAt >= START && returnAt <= END) {
        events.push({ at: returnAt, run: () => movement({ movement_type: 'RETURN', warehouse_id: w.id, variant_id: loan.variant_id,
          to_location_id: shelf, quantity: 1, source_service: 'BORROW_SERVICE', reference_type: 'LOAN_TRANSACTION',
          reference_id: loan.loan_id, reason_code: 'LOAN_RETURNED', created_by_user_id: staffId, created_at: returnAt,
          metadata: { loan_number: loan.loan_number, loan_item_id: loan.id, condition_grade: 'GOOD' } }) });
      }
    } });
  }

  // run every event in time order (events may schedule later events): a binary min-heap,
  // ties broken by insertion order so a run is reproducible
  let order = 0;
  const heap = [];
  const less = (a, b) => (a.at - b.at) || (a.n - b.n);
  const push = (e) => {
    e.n = order++; heap.push(e);
    for (let i = heap.length - 1; i > 0;) {
      const p = (i - 1) >> 1;
      if (!less(heap[i], heap[p])) break;
      [heap[i], heap[p]] = [heap[p], heap[i]]; i = p;
    }
  };
  const pop = () => {
    const top = heap[0]; const last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      for (let i = 0; ;) {
        const l = 2 * i + 1; const r = l + 1; let m = i;
        if (l < heap.length && less(heap[l], heap[m])) m = l;
        if (r < heap.length && less(heap[r], heap[m])) m = r;
        if (m === i) break;
        [heap[i], heap[m]] = [heap[m], heap[i]]; i = m;
      }
    }
    return top;
  };
  events.splice(0).forEach(push);
  events.push = (e) => push(e); // events scheduled while running go straight into the heap
  while (heap.length) pop().run();
  out.stock_movements.sort((a, b) => a.created_at - b.created_at);
  return { out, bal, skippedLoans };
}

// ── database writes ────────────────────────────────────────────────────────
async function reversePreviousRun(tx) {
  const effects = await tx.$queryRawUnsafe(`
    SELECT metadata->'sim_effect'->>'variant_id' AS variant_id, metadata->'sim_effect'->>'location_id' AS location_id,
           SUM((metadata->'sim_effect'->>'on_hand')::int)::int AS on_hand,
           SUM((metadata->'sim_effect'->>'available')::int)::int AS available,
           SUM((metadata->'sim_effect'->>'borrowed')::int)::int AS borrowed
      FROM stock_movements WHERE movement_number LIKE 'SIM-%' AND metadata ? 'sim_effect' GROUP BY 1, 2`);
  for (const e of effects) {
    await tx.$executeRawUnsafe(`
      UPDATE stock_balances SET on_hand_qty = GREATEST(on_hand_qty - $3, 0), available_qty = GREATEST(available_qty - $4, 0),
             borrowed_qty = GREATEST(borrowed_qty - $5, 0), updated_at = NOW()
       WHERE variant_id = $1::uuid AND location_id = $2::uuid`, e.variant_id, e.location_id, e.on_hand, e.available, e.borrowed);
    // a row the previous run created is empty again now: drop it unless real (non-SIM) activity used it
    await tx.$executeRawUnsafe(`
      DELETE FROM stock_balances b
       WHERE b.variant_id = $1::uuid AND b.location_id = $2::uuid
         AND b.on_hand_qty = 0 AND b.available_qty = 0 AND b.reserved_qty = 0 AND b.borrowed_qty = 0
         AND b.damaged_qty = 0 AND b.in_transit_qty = 0
         AND NOT EXISTS (SELECT 1 FROM stock_movements m WHERE m.movement_number NOT LIKE 'SIM-%'
                          AND m.variant_id = b.variant_id AND (m.from_location_id = b.location_id OR m.to_location_id = b.location_id))
         AND NOT EXISTS (SELECT 1 FROM stock_reservations r WHERE r.variant_id = b.variant_id AND r.location_id = b.location_id)`,
    e.variant_id, e.location_id);
  }
  const del = async (sql) => tx.$executeRawUnsafe(sql);
  const counts = {
    stock_movements: await del(`DELETE FROM stock_movements WHERE movement_number LIKE 'SIM-%'`),
    goods_receipt_items: await del(`DELETE FROM goods_receipt_items WHERE goods_receipt_id IN (SELECT id FROM goods_receipts WHERE receipt_number LIKE 'SIM-%')`),
    goods_receipts: await del(`DELETE FROM goods_receipts WHERE receipt_number LIKE 'SIM-%'`),
    purchase_order_items: await del(`DELETE FROM purchase_order_items WHERE purchase_order_id IN (SELECT id FROM purchase_orders WHERE po_number LIKE 'SIM-%')`),
    purchase_orders: await del(`DELETE FROM purchase_orders WHERE po_number LIKE 'SIM-%'`),
    transfer_order_items: await del(`DELETE FROM transfer_order_items WHERE transfer_order_id IN (SELECT id FROM transfer_orders WHERE transfer_number LIKE 'SIM-%')`),
    transfer_orders: await del(`DELETE FROM transfer_orders WHERE transfer_number LIKE 'SIM-%'`),
    outbound_order_items: await del(`DELETE FROM outbound_order_items WHERE outbound_order_id IN (SELECT id FROM outbound_orders WHERE outbound_number LIKE 'SIM-%')`),
    outbound_orders: await del(`DELETE FROM outbound_orders WHERE outbound_number LIKE 'SIM-%'`),
  };
  return { reversedBalances: effects.length, deleted: counts };
}

async function insertAll(tx, out) {
  const order = ['purchase_orders', 'purchase_order_items', 'transfer_orders', 'transfer_order_items', 'goods_receipts',
    'goods_receipt_items', 'outbound_orders', 'outbound_order_items', 'stock_movements'];
  for (const table of order) {
    for (let i = 0; i < out[table].length; i += 500) await tx[table].createMany({ data: out[table].slice(i, i + 500) });
  }
}

async function applyBalances(tx, out) {
  const delta = new Map();
  for (const m of out.stock_movements) {
    const e = m.metadata.sim_effect;
    if (!e) continue;
    const key = `${e.variant_id}|${e.location_id}`;
    const d = delta.get(key) || { ...e, on_hand: 0, available: 0, borrowed: 0, last: m.created_at };
    d.on_hand += e.on_hand; d.available += e.available; d.borrowed += e.borrowed;
    if (m.created_at > d.last) d.last = m.created_at;
    delta.set(key, d);
  }
  let created = 0;
  for (const d of delta.values()) {
    const updated = await tx.$executeRawUnsafe(`
      UPDATE stock_balances SET on_hand_qty = on_hand_qty + $3, available_qty = available_qty + $4, borrowed_qty = borrowed_qty + $5,
             status = CASE WHEN available_qty + $4 > 0 THEN 'AVAILABLE' WHEN on_hand_qty + $3 = 0 THEN 'OUT_OF_STOCK' ELSE status END,
             last_movement_at = GREATEST(COALESCE(last_movement_at, $6::timestamptz), $6::timestamptz), updated_at = NOW()
       WHERE variant_id = $1::uuid AND location_id = $2::uuid`,
    d.variant_id, d.location_id, d.on_hand, d.available, d.borrowed, d.last);
    if (!updated) {
      await tx.stock_balances.create({ data: { warehouse_id: d.warehouse_id, variant_id: d.variant_id, location_id: d.location_id,
        on_hand_qty: d.on_hand, available_qty: d.available, borrowed_qty: d.borrowed, safety_stock_qty: 2, reorder_point: 3,
        status: d.available > 0 ? 'AVAILABLE' : 'OUT_OF_STOCK', last_movement_at: d.last } });
      created += 1;
    }
  }
  return { touched: delta.size, created };
}

// rows whose quantities do not add up; compared before/after so pre-existing drift is not blamed on this run
async function countInvariantViolations(tx) {
  const rows = await tx.$queryRawUnsafe(`
    SELECT count(*)::int AS n FROM stock_balances
     WHERE on_hand_qty < 0 OR available_qty < 0 OR borrowed_qty < 0
        OR available_qty + reserved_qty + borrowed_qty + damaged_qty > on_hand_qty`);
  return rows[0].n;
}

async function main() {
  const db = new PrismaClient();
  try {
    console.log(`[warehouse-history] window ${START.toISOString()} → ${END.toISOString()} seed=${SEED}${DRY_RUN ? ' (dry run)' : ''}`);
    const ctx = await loadContext(db);
    const staff = await loadStaff(process.env.AUTH_DATABASE_URL, ctx.warehouses, ctx.knownUsers.map((u) => u.id));
    const loans = await loadSimLoans(process.env.BORROW_DATABASE_URL);
    console.log(`[warehouse-history] warehouses=${ctx.warehouses.length} variants=${ctx.variants.length} suppliers=${ctx.suppliers.length} staff=${JSON.stringify(staff.counts)} sim_loan_items=${loans.length}`);
    if (!ctx.suppliers.length) throw new Error('no ACTIVE suppliers - run the inventory seed first');
    if (DRY_RUN) {
      // the balance model starts from the live rows, which still include a previous run's effects - fine for counts
      const { out, skippedLoans } = generate(ctx, staff, loans);
      console.log('[warehouse-history] would insert:', JSON.stringify(Object.fromEntries(Object.entries(out).map(([k, v]) => [k, v.length]))), `skipped_loans=${skippedLoans}`);
      return;
    }
    await db.$transaction(async (tx) => {
      const reversed = await reversePreviousRun(tx);
      console.log('[warehouse-history] removed previous SIM rows:', JSON.stringify(reversed));
      const violationsBefore = await countInvariantViolations(tx);
      const fresh = await loadContext(tx);
      const { out, skippedLoans } = generate(fresh, staff, loans);
      await insertAll(tx, out);
      const result = await applyBalances(tx, out);
      const violationsAfter = await countInvariantViolations(tx);
      console.log('[warehouse-history] inserted:', JSON.stringify(Object.fromEntries(Object.entries(out).map(([k, v]) => [k, v.length]))), `skipped_loans=${skippedLoans}`);
      console.log('[warehouse-history] balances:', JSON.stringify({ ...result, violationsBefore, violationsAfter }));
      if (violationsAfter > violationsBefore) throw new Error(`stock_balances rows breaking the quantity invariants went ${violationsBefore} → ${violationsAfter} - rolled back`);
    }, { timeout: 15 * 60 * 1000, maxWait: 60 * 1000 });
    console.log('[warehouse-history] done');
  } finally {
    await db.$disconnect();
  }
}

main().catch((error) => {
  console.error('[warehouse-history] failed:', error);
  process.exitCode = 1;
});
