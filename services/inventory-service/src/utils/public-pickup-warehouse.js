const { PUBLIC_PICKUP_WAREHOUSE_TYPES } = require('./constants');

const PUBLIC_PICKUP_TYPES = new Set(PUBLIC_PICKUP_WAREHOUSE_TYPES);

/** The one rule for "can a reader see this location and pick a book up there".
 *  Used by the public catalog and by customer reservations (borrow integration). */
function isPublicPickupWarehouse(warehouse) {
  return Boolean(
    warehouse
    && warehouse.is_active !== false
    && PUBLIC_PICKUP_TYPES.has(String(warehouse.warehouse_type || '').toUpperCase()),
  );
}

module.exports = { isPublicPickupWarehouse };
