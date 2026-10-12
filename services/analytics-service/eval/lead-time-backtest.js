// Rolling backtest of supplier lead-time estimates on purchase-order ->
// goods-receipt history (the same deliveries getLeadTimeHistory() reads).
//
// PROTOCOL: deliveries are replayed in order-date order. For each delivery
// ("target") a method may only use deliveries whose goods receipt had been
// received at or before the target's order date - i.e. what was known when the
// order was placed. The target itself and everything later is never used.
//
// Methods:
//   FIXED_14_DAYS        the service-wide default
//   SUPPLIER_DECLARED    supplier_variants.lead_time_days (preferred supplier first, as production)
//   LEARNED_MEDIAN       production resolveLeadTime() on prior deliveries only, counted
//                        only when it actually learned (>= 3 observations of the
//                        variant, else of the supplier)
//   PRODUCTION_RESOLVER  the full production chain: learned -> declared -> 14 days
// FIXED / DECLARED / LEARNED are compared on the paired subset where all three
// produce a prediction. Below MIN_EVALUATION_SAMPLES paired targets the result
// is INSUFFICIENT_DATA and no error metric is reported.

const fs = require('fs');
const path = require('path');
const { resolveLeadTime, median, DEFAULT_LEAD_TIME_DAYS } = require('../src/utils/lead-time');
const { splitValues } = require('../../borrow-service/prisma/simulation/build-catalog-manifest');

const DAY_MS = 24 * 60 * 60 * 1000;
const MIN_EVALUATION_SAMPLES = 5;
const METHODS = ['FIXED_14_DAYS', 'SUPPLIER_DECLARED', 'LEARNED_MEDIAN', 'PRODUCTION_RESOLVER'];
const PAIRED_METHODS = ['FIXED_14_DAYS', 'SUPPLIER_DECLARED', 'LEARNED_MEDIAN'];

function toMs(value) {
  if (value instanceof Date) return value.getTime();
  const text = String(value).trim();
  // DATE '2026-03-01' -> midnight UTC (order_date::timestamptz in a UTC session).
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return Date.parse(`${text}T00:00:00Z`);
  // '2026-03-08 14:00:00+07' -> ISO 8601.
  const iso = text.replace(' ', 'T').replace(/([+-]\d{2})$/, '$1:00');
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) throw new Error(`unparseable timestamp: ${value}`);
  return ms;
}

function errorMetrics(pairs) {
  if (!pairs.length) return { samples: 0, mae: null, median_absolute_error: null, rmse: null, bias: null };
  const abs = pairs.map(([actual, predicted]) => Math.abs(predicted - actual));
  return {
    samples: pairs.length,
    mae: abs.reduce((a, b) => a + b, 0) / pairs.length,
    median_absolute_error: median(abs),
    rmse: Math.sqrt(pairs.reduce((s, [a, p]) => s + (p - a) ** 2, 0) / pairs.length),
    bias: pairs.reduce((s, [a, p]) => s + (p - a), 0) / pairs.length,
  };
}

function predictionsFor(target, known, fixedDays) {
  const variantObservations = known.filter((d) => d.variantId === target.variantId).map((d) => d.leadTimeDays);
  const supplierObservations = target.supplierId ? known.filter((d) => d.supplierId === target.supplierId).map((d) => d.leadTimeDays) : [];
  const declared = Number.isFinite(target.declaredLeadTimeDays) && target.declaredLeadTimeDays > 0 ? target.declaredLeadTimeDays : null;
  const learned = resolveLeadTime({ variantObservations, supplierObservations, declaredLeadTimeDays: null, defaultLeadTimeDays: fixedDays });
  const production = resolveLeadTime({ variantObservations, supplierObservations, declaredLeadTimeDays: declared, defaultLeadTimeDays: fixedDays });
  return {
    FIXED_14_DAYS: fixedDays,
    SUPPLIER_DECLARED: declared === null ? null : Math.max(1, Math.round(declared)),
    LEARNED_MEDIAN: learned.source === 'LEARNED' ? learned.days : null,
    PRODUCTION_RESOLVER: production.days,
  };
}

/**
 * @param {Array<{ variant_id, supplier_id, order_date, received_at, declared_lead_time_days }>} rawDeliveries
 */
function evaluateLeadTimeHistory(rawDeliveries, { fixedDays = DEFAULT_LEAD_TIME_DAYS, minEvaluationSamples = MIN_EVALUATION_SAMPLES, source = 'unspecified' } = {}) {
  const deliveries = rawDeliveries
    .map((d) => {
      const orderAt = toMs(d.order_date);
      const receivedAt = toMs(d.received_at);
      return {
        variantId: d.variant_id,
        supplierId: d.supplier_id || null,
        orderAt,
        receivedAt,
        leadTimeDays: (receivedAt - orderAt) / DAY_MS,
        declaredLeadTimeDays: d.declared_lead_time_days === null || d.declared_lead_time_days === undefined ? null : Number(d.declared_lead_time_days),
      };
    })
    .filter((d) => d.receivedAt >= d.orderAt) // same filter as getLeadTimeHistory()
    .sort((a, b) => a.orderAt - b.orderAt || a.receivedAt - b.receivedAt || a.variantId.localeCompare(b.variantId));

  const ownPairs = Object.fromEntries(METHODS.map((m) => [m, []]));
  const pairedPairs = Object.fromEntries(PAIRED_METHODS.map((m) => [m, []]));
  for (const target of deliveries) {
    const known = deliveries.filter((d) => d !== target && d.receivedAt <= target.orderAt);
    const predicted = predictionsFor(target, known, fixedDays);
    for (const m of METHODS) if (predicted[m] !== null) ownPairs[m].push([target.leadTimeDays, predicted[m]]);
    if (PAIRED_METHODS.every((m) => predicted[m] !== null)) {
      for (const m of PAIRED_METHODS) pairedPairs[m].push([target.leadTimeDays, predicted[m]]);
    }
  }

  const pairedSamples = pairedPairs.FIXED_14_DAYS.length;
  const sufficient = pairedSamples >= minEvaluationSamples;
  const withheld = (metrics) => (sufficient ? metrics : { ...metrics, mae: null, median_absolute_error: null, rmse: null, bias: null });
  return {
    status: sufficient ? 'OK' : 'INSUFFICIENT_DATA',
    source,
    protocol: 'each delivery predicted only from deliveries received on or before its order date',
    deliveries: deliveries.length,
    variants: new Set(deliveries.map((d) => d.variantId)).size,
    suppliers: new Set(deliveries.map((d) => d.supplierId).filter(Boolean)).size,
    paired_samples: pairedSamples,
    min_evaluation_samples: minEvaluationSamples,
    min_observations_to_learn: 3,
    methods: METHODS.map((m) => ({
      method: m,
      applicable: withheld(errorMetrics(ownPairs[m])),
      paired: PAIRED_METHODS.includes(m) ? withheld(errorMetrics(pairedPairs[m])) : null,
    })),
    note: sufficient
      ? null
      : `Only ${pairedSamples} deliveries had >= 3 earlier observations plus a declared lead time (need ${minEvaluationSamples}); error metrics are withheld rather than computed on too few points.`,
  };
}

// ── Data sources ─────────────────────────────────────────────────────────────

// Multi-row `INSERT INTO table (cols) VALUES (...), (...) ON CONFLICT ...;`
// blocks as written in data/smartbook_sample_seed.sql.
function parseSeedInserts(sql, table) {
  const rows = [];
  const re = new RegExp(`INSERT INTO ${table} \\(([^)]*)\\) VALUES([\\s\\S]*?)ON CONFLICT`, 'g');
  let match;
  while ((match = re.exec(sql)) !== null) {
    const columns = match[1].split(',').map((c) => c.trim());
    for (const line of match[2].split('\n')) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('(')) continue;
      const inner = trimmed.slice(1, trimmed.lastIndexOf(')'));
      const values = splitValues(inner);
      if (values.length !== columns.length) throw new Error(`${table}: column/value count mismatch`);
      rows.push(Object.fromEntries(columns.map((c, i) => [c, values[i]])));
    }
  }
  return rows;
}

// Same join and filters as getLeadTimeHistory() in analytics.controller.js.
function deliveriesFromTables({ purchaseOrders, goodsReceipts, goodsReceiptItems, supplierVariants }) {
  const poById = new Map(purchaseOrders.map((po) => [po.id, po]));
  const declaredByVariant = new Map();
  const preferredFirst = [...supplierVariants].sort((a, b) => Number(String(b.is_preferred).toUpperCase() === 'TRUE') - Number(String(a.is_preferred).toUpperCase() === 'TRUE'));
  for (const sv of preferredFirst) {
    if (!declaredByVariant.has(sv.variant_id)) declaredByVariant.set(sv.variant_id, sv.lead_time_days === null ? null : Number(sv.lead_time_days));
  }
  const seen = new Set();
  const deliveries = [];
  for (const gr of goodsReceipts) {
    const po = poById.get(gr.purchase_order_id);
    if (!po || !gr.received_at || gr.cancelled_at) continue;
    for (const item of goodsReceiptItems.filter((i) => i.goods_receipt_id === gr.id)) {
      const key = `${gr.id}|${item.variant_id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      deliveries.push({
        variant_id: item.variant_id,
        supplier_id: po.supplier_id,
        order_date: po.order_date,
        received_at: gr.received_at,
        declared_lead_time_days: declaredByVariant.get(item.variant_id) ?? null,
      });
    }
  }
  return deliveries;
}

const SAMPLE_SEED_PATH = path.resolve(__dirname, '../../../data/smartbook_sample_seed.sql');

function deliveriesFromSeedSql(sqlPath = SAMPLE_SEED_PATH) {
  const sql = fs.readFileSync(sqlPath, 'utf8');
  return deliveriesFromTables({
    purchaseOrders: parseSeedInserts(sql, 'purchase_orders'),
    goodsReceipts: parseSeedInserts(sql, 'goods_receipts'),
    goodsReceiptItems: parseSeedInserts(sql, 'goods_receipt_items'),
    supplierVariants: parseSeedInserts(sql, 'supplier_variants'),
  });
}

// Live inventory_db (read-only queries; pg is already an analytics dependency).
async function deliveriesFromDatabase(connectionString) {
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString });
  try {
    const { rows } = await pool.query(`
      SELECT
        gri.variant_id::text AS variant_id,
        po.supplier_id::text AS supplier_id,
        po.order_date::timestamptz AS order_date,
        gr.received_at,
        (SELECT sv.lead_time_days FROM supplier_variants sv
          WHERE sv.variant_id = gri.variant_id
          ORDER BY sv.is_preferred DESC LIMIT 1) AS declared_lead_time_days
      FROM goods_receipts gr
      JOIN purchase_orders po ON po.id = gr.purchase_order_id
      JOIN goods_receipt_items gri ON gri.goods_receipt_id = gr.id
      WHERE gr.received_at IS NOT NULL
        AND gr.cancelled_at IS NULL
        AND gr.received_at >= po.order_date::timestamptz
      GROUP BY gr.id, gri.variant_id, po.supplier_id, gr.received_at, po.order_date
    `);
    return rows;
  } finally {
    await pool.end();
  }
}

module.exports = {
  MIN_EVALUATION_SAMPLES,
  METHODS,
  SAMPLE_SEED_PATH,
  evaluateLeadTimeHistory,
  parseSeedInserts,
  deliveriesFromTables,
  deliveriesFromSeedSql,
  deliveriesFromDatabase,
};
