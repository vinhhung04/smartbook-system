const { SHIPPING_LOCATION_TYPE, RECEIVING_LOCATION_TYPES } = require('./constants');

async function resolveOrCreateShippingLocation(tx, warehouseId) {
  const found = await tx.locations.findFirst({
    where: {
      warehouse_id: warehouseId,
      is_active: true,
      location_type: SHIPPING_LOCATION_TYPE,
    },
    orderBy: { location_code: 'asc' },
    select: { id: true, location_code: true },
  });
  if (found) return found;

  const ts = Date.now();
  const suffix = Math.random().toString(36).slice(2, 5).toUpperCase();
  return tx.locations.create({
    data: {
      warehouse_id: warehouseId,
      location_code: `SHIPPING-${ts}-${suffix}`,
      location_type: SHIPPING_LOCATION_TYPE,
      zone: SHIPPING_LOCATION_TYPE,
      is_pickable: false,
      is_active: true,
    },
    select: { id: true, location_code: true },
  });
}

async function resolveOrCreateReceivingLocation(tx, warehouseId) {
  const found = await tx.locations.findFirst({
    where: {
      warehouse_id: warehouseId,
      is_active: true,
      location_type: { in: RECEIVING_LOCATION_TYPES },
    },
    orderBy: { location_code: 'asc' },
    select: { id: true, location_code: true },
  });
  if (found) return found;

  const ts = Date.now();
  const suffix = Math.random().toString(36).slice(2, 5).toUpperCase();
  return tx.locations.create({
    data: {
      warehouse_id: warehouseId,
      location_code: `RECEIVING-${ts}-${suffix}`,
      location_type: 'RECEIVING',
      zone: 'RECEIVING',
      is_pickable: false,
      is_active: true,
    },
    select: { id: true, location_code: true },
  });
}

module.exports = {
  resolveOrCreateShippingLocation,
  resolveOrCreateReceivingLocation,
};
