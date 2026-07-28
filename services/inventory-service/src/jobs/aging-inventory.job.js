const { upsertStockAlert } = require('../controllers/stock-alert.controller');

const ANALYTICS_SERVICE_URL = String(process.env.ANALYTICS_SERVICE_URL || 'http://analytics-service:3006').replace(/\/$/, '');
const INTERNAL_SERVICE_KEY = String(process.env.INTERNAL_SERVICE_KEY || 'smartbook_internal_key').trim();
const THRESHOLD_DAYS = Number(process.env.AGING_INVENTORY_DAYS_THRESHOLD || 90);

let timer = null;
let running = false;

function resolveAlertLevel(daysSinceLastActivity, thresholdDays) {
  if (daysSinceLastActivity >= thresholdDays * 2) return 'HIGH';
  if (daysSinceLastActivity >= thresholdDays * 1.5) return 'MEDIUM';
  return 'LOW';
}

async function fetchAgingInventory() {
  const response = await fetch(`${ANALYTICS_SERVICE_URL}/analytics/aging-inventory?days=${THRESHOLD_DAYS}&limit=200`, {
    signal: AbortSignal.timeout(15000),
    headers: { 'x-internal-service-key': INTERNAL_SERVICE_KEY },
  });

  if (!response.ok) {
    throw new Error(`analytics-service responded ${response.status}`);
  }

  const body = await response.json();
  return body?.data?.items || [];
}

async function executeAgingInventorySweep() {
  if (running) {
    return;
  }

  running = true;
  const result = { scanned: 0, created: 0, duplicate: 0, failed: 0 };
  try {
    const items = await fetchAgingInventory();
    result.scanned = items.length;

    for (const item of items) {
      if (item.days_since_last_activity === null) continue;
      try {
        const { duplicate } = await upsertStockAlert({
          variant_id: item.variant_id,
          warehouse_id: item.warehouse_id,
          alert_type: 'AGING_STOCK',
          alert_level: resolveAlertLevel(item.days_since_last_activity, THRESHOLD_DAYS),
          threshold_value: THRESHOLD_DAYS,
          current_value: item.days_since_last_activity,
          payload: { title: item.title, on_hand_qty: item.on_hand_qty, last_activity_at: item.last_activity_at },
          source: 'AGING_INVENTORY_JOB',
        });
        if (duplicate) result.duplicate += 1;
        else result.created += 1;
      } catch (itemError) {
        result.failed += 1;
        console.error('[inventory-service][job] aging inventory item failed', item.variant_id, itemError.message);
      }
    }

    console.log('[inventory-service][job] aging inventory sweep result', result);
  } catch (error) {
    console.error('[inventory-service][job] aging inventory sweep failed', error.message);
  } finally {
    running = false;
  }
}

function startAgingInventoryJob() {
  const enabled = String(process.env.ENABLE_AGING_INVENTORY_JOB || 'true').toLowerCase() === 'true';
  if (!enabled) {
    console.log('[inventory-service][job] aging inventory sweep disabled by env');
    return;
  }

  const intervalMs = Math.max(60_000, Number(process.env.AGING_INVENTORY_INTERVAL_MS || 60 * 60_000));
  timer = setInterval(() => {
    void executeAgingInventorySweep();
  }, intervalMs);

  if (typeof timer.unref === 'function') {
    timer.unref();
  }

  console.log('[inventory-service][job] aging inventory sweep started', { intervalMs, thresholdDays: THRESHOLD_DAYS });
  void executeAgingInventorySweep();
}

function stopAgingInventoryJob() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

module.exports = {
  startAgingInventoryJob,
  stopAgingInventoryJob,
  executeAgingInventorySweep,
};
