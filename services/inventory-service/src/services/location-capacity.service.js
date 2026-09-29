/**
 * Location Capacity & Eligibility Service
 *
 * Single source of truth for "how much room is left at this location" and
 * "which location types can this workflow actually use", shared between
 * storage-suggestion.service.js (recommendation) and
 * receiving-putaway.controller.js (the actual putaway commit). Both must
 * agree, or Storage Suggestion can recommend a location Receiving Putaway
 * then rejects.
 *
 * Every function that touches the DB takes an optional Prisma `client` as
 * its first argument (defaults to this module's own client) so callers can
 * pass a `tx` from inside a `prisma.$transaction(...)` block.
 */

const { PrismaClient } = require('@prisma/client');
const { MAX_COMPARTMENT_CAPACITY } = require('../utils/constants');

const prisma = new PrismaClient();

const VALID_SUGGESTION_MODES = ['RECEIVING', 'PUTAWAY', 'RELOCATION', 'AI_IMPORT'];

// No relocation-apply endpoint exists in the codebase to validate a wider type set
// against, so RELOCATION defaults to the one real shelf-apply flow's type.
// TODO: revisit once a relocation-apply endpoint exists.
//
// No caller anywhere uses mode=AI_IMPORT today (grepped both services and apps/web),
// so it falls back to the RECEIVING/PUTAWAY policy rather than inventing rules for an
// undefined flow.
// TODO: revisit once a confirmed AI_IMPORT destination flow exists.
const ELIGIBLE_LOCATION_TYPES_BY_MODE = {
  RECEIVING: ['SHELF_COMPARTMENT'],
  PUTAWAY: ['SHELF_COMPARTMENT'],
  RELOCATION: ['SHELF_COMPARTMENT'],
  AI_IMPORT: ['SHELF_COMPARTMENT'],
};

function getEligibleLocationTypes(mode) {
  return ELIGIBLE_LOCATION_TYPES_BY_MODE[mode] || ELIGIBLE_LOCATION_TYPES_BY_MODE.RECEIVING;
}

/**
 * Effective capacity ceiling for a compartment: the location's own configured
 * capacity_qty, clamped to MAX_COMPARTMENT_CAPACITY, falling back to
 * MAX_COMPARTMENT_CAPACITY when unconfigured. Mirrors the formula already
 * proven correct at receiving-putaway.controller.js's apply-time check.
 */
function computeEffectiveCapacity(capacityQty) {
  const configured = Number(capacityQty || 0);
  return configured > 0 ? Math.min(configured, MAX_COMPARTMENT_CAPACITY) : MAX_COMPARTMENT_CAPACITY;
}

/**
 * Total on_hand_qty across ALL variants at each location (not just one
 * variant) — a compartment's capacity is shared physical space, not a
 * per-SKU limit.
 */
async function getOccupancyByLocationIds(client, locationIds) {
  const db = client || prisma;
  const map = new Map();
  if (!locationIds || locationIds.length === 0) return map;

  const grouped = await db.stock_balances.groupBy({
    by: ['location_id'],
    where: { location_id: { in: locationIds } },
    _sum: { on_hand_qty: true },
  });

  grouped.forEach((row) => {
    map.set(row.location_id, Number(row._sum.on_hand_qty || 0));
  });

  return map;
}

function buildCapacityContext(location, occupiedQty) {
  const effectiveCapacity = computeEffectiveCapacity(location.capacity_qty);
  return {
    configuredCapacity: location.capacity_qty ?? null,
    effectiveCapacity,
    occupiedQty,
    remainingCapacity: Math.max(effectiveCapacity - occupiedQty, 0),
  };
}

/**
 * Capacity context for a single location (fresh read of occupancy).
 */
async function getLocationCapacityContext(client, location) {
  const occupancy = await getOccupancyByLocationIds(client, [location.id]);
  return buildCapacityContext(location, occupancy.get(location.id) || 0);
}

/**
 * Capacity context for many locations at once, keyed by location id — avoids
 * N+1 occupancy queries when scoring/ranking a candidate list.
 */
async function getLocationCapacityContextBatch(client, locations) {
  const occupancy = await getOccupancyByLocationIds(client, locations.map((l) => l.id));
  const result = new Map();
  locations.forEach((location) => {
    result.set(location.id, buildCapacityContext(location, occupancy.get(location.id) || 0));
  });
  return result;
}

/**
 * Whether a location can be used at all for the given mode: active, and of a
 * location_type that mode's downstream apply flow actually accepts.
 * is_pickable is deliberately NOT checked here — it's a scoring/business-rule
 * concern handled separately by callers, not a structural eligibility rule.
 */
function isLocationEligibleForMode(location, mode) {
  if (!location.is_active) return false;
  return getEligibleLocationTypes(mode).includes(String(location.location_type || '').toUpperCase());
}

module.exports = {
  MAX_COMPARTMENT_CAPACITY,
  VALID_SUGGESTION_MODES,
  getEligibleLocationTypes,
  computeEffectiveCapacity,
  getOccupancyByLocationIds,
  getLocationCapacityContext,
  getLocationCapacityContextBatch,
  isLocationEligibleForMode,
};
