module.exports = {
  SHIPPING_LOCATION_TYPE: 'SHIPPING',
  RECEIVING_LOCATION_TYPES: ['RECEIVING', 'STAGING'],
  TARGET_COMPARTMENT_TYPE: 'SHELF_COMPARTMENT',
  MAX_COMPARTMENT_CAPACITY: 100,
  // Warehouse types that serve readers: the only locations the public website
  // lists and offers for pickup. WAREHOUSE (kho tổng) and STORE (cửa hàng) are
  // operational; their stock is never public availability.
  PUBLIC_PICKUP_WAREHOUSE_TYPES: ['BRANCH', 'LIBRARY'],
};
