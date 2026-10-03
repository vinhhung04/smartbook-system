const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

const {
  RECEIVING_LOCATION_TYPES,
  TARGET_COMPARTMENT_TYPE,
} = require("../utils/constants");
const { parseId, normalizeText } = require("../utils/validation");
const { toInt } = require("../utils/validation");
const { normalizeLocationType } = require("../utils/validation");
const { createMovementNumber } = require("../utils/inventory");
const { toSerializableError } = require("../utils/inventory");
const {
  getEligibleLocationTypes,
  computeEffectiveCapacity,
  getLocationCapacityContextBatch,
} = require("../services/location-capacity.service");
const { invalidateCache } = require("../services/storage-suggestion.service");

function buildVariantBarcode(variant) {
  return (
    variant?.internal_barcode ||
    variant?.isbn13 ||
    variant?.isbn10 ||
    variant?.sku ||
    null
  );
}

const PUTAWAY_MOVEMENT_REFERENCE = "RECEIVING_SHELF_PUTAWAY";
const LOCATION_SCAN_PATTERN = /^[A-Z0-9][A-Z0-9._-]{1,63}$/;

function normalizeScanCode(value) {
  return String(value || "").trim().toUpperCase();
}

// A scanned location code is accepted if it is the location's barcode or its code, with or
// without the "LOC-" prefix labels carry.
function locationScanMatches(scanned, location) {
  const input = normalizeScanCode(scanned);
  if (!input) return false;
  const candidates = [location?.barcode, location?.location_code]
    .filter(Boolean)
    .map(normalizeScanCode);
  if (location?.location_code) candidates.push(`LOC-${normalizeScanCode(location.location_code)}`);
  return candidates.includes(input) || candidates.includes(`LOC-${input}`);
}

function variantScanMatches(scanned, variant) {
  const input = normalizeScanCode(scanned);
  if (!input) return false;
  return [variant?.internal_barcode, variant?.sku, variant?.isbn13, variant?.isbn10]
    .filter(Boolean)
    .map(normalizeScanCode)
    .includes(input);
}

// Mirrors putaway.controller.js's per-item putaway_quantity/remaining_quantity so the server-side
// cap agrees with what the receipt screens show: PUTAWAY-bucket movements stamped with this
// receipt, falling back to "already allocated" for items carrying a location_id.
async function getReceiptVariantRemaining(tx, receiptId, variantId) {
  const items = await tx.goods_receipt_items.findMany({
    where: { goods_receipt_id: receiptId, variant_id: variantId },
    select: { quantity: true, location_id: true },
  });
  if (items.length === 0) return null;

  const received = items.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
  const movements = await tx.stock_movements.findMany({
    where: {
      reference_type: PUTAWAY_MOVEMENT_REFERENCE,
      reference_id: receiptId,
      variant_id: variantId,
      movement_status: "POSTED",
    },
    select: { quantity: true, metadata: true },
  });
  const putaway = movements
    .filter((movement) => movement.metadata?.movement_bucket === "PUTAWAY")
    .reduce((sum, movement) => sum + Number(movement.quantity || 0), 0);
  const preAllocated = items
    .filter((item) => item.location_id)
    .reduce((sum, item) => sum + Number(item.quantity || 0), 0);

  const done = putaway > 0 ? Math.min(received, putaway) : preAllocated;
  return Math.max(received - done, 0);
}

async function getWarehouseReceivings(req, res) {
  const warehouseId = parseId(req.params.warehouseId);

  if (!warehouseId) {
    return res.status(400).json({ message: "Invalid warehouse id" });
  }

  try {
    const rows = await prisma.locations.findMany({
      where: {
        warehouse_id: warehouseId,
        is_active: true,
        location_type: { in: RECEIVING_LOCATION_TYPES },
      },
      select: {
        id: true,
        location_code: true,
        location_type: true,
        barcode: true,
      },
      orderBy: { location_code: "asc" },
    });

    return res.json({
      warehouse_id: warehouseId,
      receivings: rows.map((row) => ({
        id: row.id,
        location_code: row.location_code,
        location_type: row.location_type,
        barcode: row.barcode,
      })),
    });
  } catch (error) {
    console.error("Error while loading receiving locations:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
}

async function getReceivingItems(req, res) {
  const receivingId = parseId(req.params.receivingId);

  if (!receivingId) {
    return res.status(400).json({ message: "Invalid receiving location id" });
  }

  try {
    const receiving = await prisma.locations.findUnique({
      where: { id: receivingId },
      select: {
        id: true,
        warehouse_id: true,
        location_code: true,
        location_type: true,
        is_active: true,
      },
    });

    if (!receiving) {
      return res.status(404).json({ message: "Receiving location not found" });
    }

    const locationType = normalizeLocationType(receiving.location_type);
    if (!RECEIVING_LOCATION_TYPES.includes(locationType)) {
      return res
        .status(400)
        .json({ message: "source location must be RECEIVING or STAGING" });
    }

    const rows = await prisma.stock_balances.findMany({
      where: {
        location_id: receiving.id,
        on_hand_qty: { gt: 0 },
      },
      select: {
        variant_id: true,
        on_hand_qty: true,
        available_qty: true,
        book_variants: {
          select: {
            id: true,
            sku: true,
            isbn13: true,
            isbn10: true,
            internal_barcode: true,
            books: {
              select: {
                id: true,
                title: true,
              },
            },
          },
        },
      },
      orderBy: [{ on_hand_qty: "desc" }, { variant_id: "asc" }],
    });

    return res.json({
      warehouse_id: receiving.warehouse_id,
      receiving: {
        id: receiving.id,
        location_code: receiving.location_code,
        location_type: receiving.location_type,
      },
      items: rows.map((row) => ({
        variant_id: row.variant_id,
        sku: row.book_variants?.sku || null,
        isbn13: row.book_variants?.isbn13 || null,
        isbn10: row.book_variants?.isbn10 || null,
        barcode: buildVariantBarcode(row.book_variants),
        book_title: row.book_variants?.books?.title || "Chua co ten sach",
        on_hand_qty: Number(row.on_hand_qty || 0),
        available_qty: Number(row.available_qty || 0),
      })),
    });
  } catch (error) {
    console.error("Error while loading receiving items:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
}

async function getCompartmentCandidates(req, res) {
  const receivingId = parseId(req.params.receivingId);
  const variantId = parseId(req.query.variant_id);

  if (!receivingId || !variantId) {
    return res
      .status(400)
      .json({ message: "receivingId and variant_id are required" });
  }

  try {
    const sourceReceiving = await prisma.locations.findUnique({
      where: { id: receivingId },
      select: {
        id: true,
        warehouse_id: true,
        location_type: true,
      },
    });

    if (!sourceReceiving) {
      return res.status(404).json({ message: "Receiving location not found" });
    }

    if (
      !RECEIVING_LOCATION_TYPES.includes(
        normalizeLocationType(sourceReceiving.location_type),
      )
    ) {
      return res
        .status(400)
        .json({ message: "source location must be RECEIVING or STAGING" });
    }

    const allLocations = await prisma.locations.findMany({
      where: {
        warehouse_id: sourceReceiving.warehouse_id,
        is_active: true,
      },
      select: {
        id: true,
        parent_location_id: true,
        location_type: true,
        location_code: true,
        capacity_qty: true,
      },
    });

    const locationMap = new Map(allLocations.map((item) => [item.id, item]));
    const eligibleTypes = getEligibleLocationTypes("RECEIVING");
    const compartments = allLocations.filter((item) =>
      eligibleTypes.includes(normalizeLocationType(item.location_type)),
    );

    if (compartments.length === 0) {
      return res.json({
        warehouse_id: sourceReceiving.warehouse_id,
        source_receiving_location_id: sourceReceiving.id,
        variant_id: variantId,
        preferred_shelf_id: null,
        preferred_zone_id: null,
        candidates: [],
      });
    }

    const compartmentIds = compartments.map((item) => item.id);

    const capacityContexts = await getLocationCapacityContextBatch(
      prisma,
      compartments,
    );

    const skuMixGrouped = await prisma.stock_balances.groupBy({
      by: ["location_id", "variant_id"],
      where: {
        location_id: { in: compartmentIds },
        on_hand_qty: { gt: 0 },
      },
      _sum: {
        on_hand_qty: true,
      },
    });

    const skuMixMap = new Map();
    skuMixGrouped.forEach((row) => {
      const key = row.location_id;
      const current = skuMixMap.get(key) || 0;
      skuMixMap.set(key, current + 1);
    });

    const variantExisting = await prisma.stock_balances.findMany({
      where: {
        variant_id: variantId,
        location_id: { in: compartmentIds },
        on_hand_qty: { gt: 0 },
      },
      select: {
        location_id: true,
        on_hand_qty: true,
      },
      orderBy: { on_hand_qty: "desc" },
    });

    let preferredCompartmentId = null;
    if (variantExisting.length > 0) {
      preferredCompartmentId = variantExisting[0].location_id;
    }

    const getAncestorByType = (location, targetType) => {
      let current = location;
      const guard = new Set();
      const expected = normalizeLocationType(targetType);

      while (current) {
        if (normalizeLocationType(current.location_type) === expected)
          return current;
        if (!current.parent_location_id) return null;
        if (guard.has(current.id)) return null;
        guard.add(current.id);
        current = locationMap.get(current.parent_location_id) || null;
      }

      return null;
    };

    const preferredCompartment = preferredCompartmentId
      ? locationMap.get(preferredCompartmentId)
      : null;
    const preferredShelf = preferredCompartment
      ? getAncestorByType(preferredCompartment, "SHELF")
      : null;
    const preferredZone = preferredCompartment
      ? getAncestorByType(preferredCompartment, "ZONE")
      : null;

    const candidates = compartments
      .map((compartment) => {
        const shelf = getAncestorByType(compartment, "SHELF");
        const zone = getAncestorByType(compartment, "ZONE");
        if (!shelf || !zone) return null;

        const capacityContext = capacityContexts.get(compartment.id);
        const currentOnHand = capacityContext.occupiedQty;
        const maxCapacity = capacityContext.effectiveCapacity;
        const remainingCapacity = capacityContext.remainingCapacity;
        if (remainingCapacity <= 0) return null;

        const skuMixCount = Number(skuMixMap.get(compartment.id) || 0);

        let rankGroup = 2;
        if (preferredShelf && shelf.id === preferredShelf.id) {
          rankGroup = 0;
        } else if (preferredZone && zone.id === preferredZone.id) {
          rankGroup = 1;
        }

        return {
          id: compartment.id,
          location_code: compartment.location_code,
          zone_id: zone.id,
          zone_code: zone.location_code,
          shelf_id: shelf.id,
          shelf_code: shelf.location_code,
          current_on_hand: currentOnHand,
          max_capacity: maxCapacity,
          remaining_capacity: remainingCapacity,
          mixed_sku_count: skuMixCount,
          priority_group: rankGroup,
        };
      })
      .filter(Boolean)
      .sort((a, b) => {
        if (a.priority_group !== b.priority_group)
          return a.priority_group - b.priority_group;
        if (a.remaining_capacity !== b.remaining_capacity)
          return b.remaining_capacity - a.remaining_capacity;
        if (a.mixed_sku_count !== b.mixed_sku_count)
          return a.mixed_sku_count - b.mixed_sku_count;
        return a.location_code.localeCompare(b.location_code);
      });

    return res.json({
      warehouse_id: sourceReceiving.warehouse_id,
      source_receiving_location_id: sourceReceiving.id,
      variant_id: variantId,
      preferred_shelf_id: preferredShelf?.id || null,
      preferred_zone_id: preferredZone?.id || null,
      candidates,
    });
  } catch (error) {
    console.error("Error while loading compartment candidates:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
}

async function lookupCompartmentByBarcode(req, res) {
  const warehouseId = parseId(req.query.warehouse_id);
  const rawInput = normalizeText(req.query.barcode);
  const normalizedInput = rawInput?.toUpperCase() || null;

  if (!warehouseId || !rawInput) {
    return res
      .status(400)
      .json({ message: "warehouse_id and barcode are required" });
  }

  // Location codes are not all "<letter>-NN-NNN" (e.g. HN-A-01-001, BR-SHELF-01), so only the
  // character set is checked here; whether the code really exists is decided by the lookup.
  if (!LOCATION_SCAN_PATTERN.test(normalizedInput)) {
    console.info("[receiving-putaway] lookup location scan result", {
      raw_input: rawInput,
      normalized_input: normalizedInput,
      result: "invalid_format",
    });
    return res.status(400).json({ message: "Mã vị trí không hợp lệ" });
  }

  const prefixedBarcode = normalizedInput.startsWith("LOC-")
    ? normalizedInput
    : `LOC-${normalizedInput}`;

  try {
    console.info("[receiving-putaway] lookup location scan", {
      raw_input: rawInput,
      normalized_barcode: prefixedBarcode,
      query_field: "locations.barcode|location_code",
    });

    const location = await prisma.locations.findFirst({
      where: {
        warehouse_id: warehouseId,
        is_active: true,
        OR: [
          { barcode: { in: [normalizedInput, prefixedBarcode] } },
          { location_code: normalizedInput },
        ],
      },
      select: {
        id: true,
        location_code: true,
        location_type: true,
        barcode: true,
      },
    });

    if (!location) {
      console.info("[receiving-putaway] lookup location scan result", {
        raw_input: rawInput,
        normalized_barcode: prefixedBarcode,
        result: "not_found",
      });
      return res.status(404).json({ message: "Không tìm thấy vị trí với mã này" });
    }

    if (
      normalizeLocationType(location.location_type) !== TARGET_COMPARTMENT_TYPE
    ) {
      return res
        .status(400)
        .json({
          message: "Mã quét không phải ngăn kệ (SHELF_COMPARTMENT)",
        });
    }

    console.info("[receiving-putaway] lookup location scan result", {
      raw_input: rawInput,
      normalized_barcode: prefixedBarcode,
      matched_location_id: location.id,
      matched_location_code: location.location_code,
      matched_compartment: location.location_code,
      result: "SUCCESS",
    });

    return res.json({
      id: location.id,
      location_code: location.location_code,
      location_type: location.location_type,
      barcode: location.barcode,
      // The location's real barcode: clients echo this back as scanned_location_barcode,
      // which transferReceivingToShelf now verifies against the target.
      normalized_barcode: location.barcode || prefixedBarcode,
    });
  } catch (error) {
    console.error("Error while looking up compartment barcode:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
}

async function lookupVariantByBarcode(req, res) {
  const isbn13 = String(req.query.isbn13 || req.query.barcode || "")
    .trim()
    .replace(/[^0-9]/g, "");

  if (!isbn13) {
    return res.status(400).json({ message: "isbn13 is required" });
  }

  if (!/^\d{13}$/.test(isbn13)) {
    return res
      .status(400)
      .json({ message: "isbn13 must contain exactly 13 digits" });
  }

  try {
    const rows = await prisma.book_variants.findMany({
      where: {
        isbn13,
      },
      select: {
        id: true,
        sku: true,
        isbn13: true,
        isbn10: true,
        internal_barcode: true,
        books: {
          select: {
            id: true,
            title: true,
          },
        },
      },
    });

    if (rows.length === 0) {
      return res.status(404).json({ message: "No variant matched isbn13" });
    }

    const matches = rows
      .map((row) => {
        return {
          variant_id: row.id,
          sku: row.sku,
          isbn13: row.isbn13,
          isbn10: row.isbn10,
          internal_barcode: row.internal_barcode,
          book_id: row.books?.id || null,
          book_title: row.books?.title || "Chua co ten sach",
          matched_by: "isbn13",
          match_priority: 1,
        };
      })
      .sort((a, b) => a.variant_id.localeCompare(b.variant_id));

    const top = matches;

    if (top.length > 1) {
      return res.json({
        ambiguous: true,
        selected: null,
        matches,
      });
    }

    return res.json({
      ambiguous: false,
      selected: top[0],
      matches,
    });
  } catch (error) {
    console.error("Error while looking up variant barcode:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
}

async function getOccupiedCompartments(req, res) {
  const warehouseId = parseId(req.params.warehouseId);
  if (!warehouseId) {
    return res.status(400).json({ message: "Invalid warehouse id" });
  }

  try {
    const compartments = await prisma.locations.findMany({
      where: {
        warehouse_id: warehouseId,
        is_active: true,
        location_type: TARGET_COMPARTMENT_TYPE,
      },
      select: {
        id: true,
        location_code: true,
        parent_location_id: true,
      },
      orderBy: { location_code: "asc" },
    });

    if (compartments.length === 0) {
      return res.json({ compartments: [] });
    }

    const ids = compartments.map((item) => item.id);

    const grouped = await prisma.stock_balances.groupBy({
      by: ["location_id"],
      where: {
        location_id: { in: ids },
        on_hand_qty: { gt: 0 },
      },
      _sum: {
        on_hand_qty: true,
      },
    });

    const occupiedMap = new Map();
    grouped.forEach((row) => {
      occupiedMap.set(row.location_id, Number(row._sum.on_hand_qty || 0));
    });

    return res.json({
      compartments: compartments
        .map((item) => ({
          id: item.id,
          location_code: item.location_code,
          on_hand_qty: Number(occupiedMap.get(item.id) || 0),
        }))
        .filter((item) => item.on_hand_qty > 0),
    });
  } catch (error) {
    console.error("Error while loading occupied compartments:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
}

async function getCompartmentItems(req, res) {
  const compartmentId = parseId(req.params.compartmentId);
  if (!compartmentId) {
    return res.status(400).json({ message: "Invalid compartment id" });
  }

  try {
    const location = await prisma.locations.findUnique({
      where: { id: compartmentId },
      select: {
        id: true,
        warehouse_id: true,
        location_type: true,
        location_code: true,
      },
    });

    if (!location) {
      return res.status(404).json({ message: "Compartment not found" });
    }

    if (
      normalizeLocationType(location.location_type) !== TARGET_COMPARTMENT_TYPE
    ) {
      return res
        .status(400)
        .json({ message: "source location must be SHELF_COMPARTMENT" });
    }

    const rows = await prisma.stock_balances.findMany({
      where: {
        location_id: location.id,
        on_hand_qty: { gt: 0 },
      },
      select: {
        variant_id: true,
        on_hand_qty: true,
        available_qty: true,
        book_variants: {
          select: {
            sku: true,
            isbn13: true,
            isbn10: true,
            internal_barcode: true,
            books: {
              select: {
                title: true,
              },
            },
          },
        },
      },
      orderBy: { on_hand_qty: "desc" },
    });

    return res.json({
      warehouse_id: location.warehouse_id,
      compartment: {
        id: location.id,
        location_code: location.location_code,
      },
      items: rows.map((row) => ({
        variant_id: row.variant_id,
        sku: row.book_variants?.sku || null,
        isbn13: row.book_variants?.isbn13 || null,
        isbn10: row.book_variants?.isbn10 || null,
        barcode: buildVariantBarcode(row.book_variants),
        book_title: row.book_variants?.books?.title || "Chua co ten sach",
        on_hand_qty: Number(row.on_hand_qty || 0),
        available_qty: Number(row.available_qty || 0),
      })),
    });
  } catch (error) {
    console.error("Error while loading compartment items:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
}

async function transferReceivingToShelf(req, res) {
  const warehouseId = parseId(req.body?.warehouse_id);
  const sourceReceivingLocationId = parseId(
    req.body?.source_receiving_location_id,
  );
  const variantId = parseId(req.body?.variant_id);
  const goodsReceiptId = parseId(req.body?.goods_receipt_id) || null;
  const allocations = Array.isArray(req.body?.allocations)
    ? req.body.allocations
    : [];
  const clientIdempotencyKey = req.body?.idempotency_key
    ? String(req.body.idempotency_key).slice(0, 100)
    : null;

  if (!warehouseId || !sourceReceivingLocationId || !variantId) {
    return res
      .status(400)
      .json({
        message:
          "warehouse_id, source_receiving_location_id and variant_id are required",
      });
  }

  if (allocations.length === 0) {
    return res.status(400).json({ message: "allocations is required" });
  }

  const normalizedAllocations = [];
  for (const allocation of allocations) {
    const targetLocationId = parseId(allocation?.target_location_id);
    const quantity = toInt(allocation?.quantity);
    const reason = normalizeText(allocation?.reason);
    const scannedLocationBarcode = normalizeText(
      allocation?.scanned_location_barcode,
    );
    const scannedProductBarcode = normalizeText(
      allocation?.scanned_product_barcode,
    );

    if (!targetLocationId || quantity === null || quantity <= 0) {
      return res
        .status(400)
        .json({
          message:
            "Each allocation must include target_location_id and quantity > 0",
        });
    }

    if (!reason) {
      return res
        .status(400)
        .json({ message: "Each allocation must include a reason" });
    }

    normalizedAllocations.push({
      target_location_id: targetLocationId,
      quantity,
      reason,
      scanned_location_barcode: scannedLocationBarcode,
      scanned_product_barcode: scannedProductBarcode,
    });
  }

  const mergedMap = new Map();
  normalizedAllocations.forEach((line) => {
    const current = mergedMap.get(line.target_location_id);
    if (!current) {
      mergedMap.set(line.target_location_id, { ...line });
      return;
    }
    current.quantity += line.quantity;
    current.reason = `${current.reason}; ${line.reason}`;
  });

  const mergedAllocations = Array.from(mergedMap.values());
  const totalQuantity = mergedAllocations.reduce(
    (sum, item) => sum + item.quantity,
    0,
  );

  try {
    const result = await prisma.$transaction(
      async (tx) => {
        const sourceLocation = await tx.locations.findUnique({
          where: { id: sourceReceivingLocationId },
          select: {
            id: true,
            warehouse_id: true,
            location_type: true,
            location_code: true,
            is_active: true,
          },
        });

        if (!sourceLocation) {
          return {
            invalid: true,
            message: "Source receiving location not found",
          };
        }

        if (sourceLocation.warehouse_id !== warehouseId) {
          return {
            invalid: true,
            message: "Source receiving location does not belong to warehouse",
          };
        }

        if (
          !sourceLocation.is_active ||
          !RECEIVING_LOCATION_TYPES.includes(
            normalizeLocationType(sourceLocation.location_type),
          )
        ) {
          return {
            invalid: true,
            message: "source location must be active RECEIVING/STAGING",
          };
        }

        const targetIds = mergedAllocations.map(
          (item) => item.target_location_id,
        );
        const targetLocations = await tx.locations.findMany({
          where: {
            id: { in: targetIds },
            warehouse_id: warehouseId,
            is_active: true,
          },
          select: {
            id: true,
            location_type: true,
            location_code: true,
            barcode: true,
            capacity_qty: true,
          },
        });

        if (targetLocations.length !== targetIds.length) {
          return {
            invalid: true,
            message: "One or more target locations are invalid or inactive",
          };
        }

        // A scanned barcode is evidence the picker stood at the shelf; if one was sent it must
        // be the target's own, otherwise it is only an unchecked string in movement metadata.
        const targetById = new Map(targetLocations.map((item) => [item.id, item]));
        for (const allocation of mergedAllocations) {
          if (
            allocation.scanned_location_barcode &&
            !locationScanMatches(
              allocation.scanned_location_barcode,
              targetById.get(allocation.target_location_id),
            )
          ) {
            return {
              invalid: true,
              message: `Mã vị trí quét không khớp vị trí đích ${targetById.get(allocation.target_location_id).location_code}`,
            };
          }
        }

        if (mergedAllocations.some((item) => item.scanned_product_barcode)) {
          const variant = await tx.book_variants.findUnique({
            where: { id: variantId },
            select: { sku: true, isbn13: true, isbn10: true, internal_barcode: true },
          });
          if (!variant) {
            return { invalid: true, message: "Không tìm thấy sách (variant)" };
          }
          const badProduct = mergedAllocations.find(
            (item) =>
              item.scanned_product_barcode &&
              !variantScanMatches(item.scanned_product_barcode, variant),
          );
          if (badProduct) {
            return {
              invalid: true,
              message: "Mã sách quét không khớp sách đang cất",
            };
          }
        }

        // When the putaway is scoped to a goods receipt, that receipt's own remaining quantity
        // is the ceiling — otherwise a receipt already fully put away keeps accepting stock
        // stamped against it and its putaway_quantity overshoots total_quantity.
        if (goodsReceiptId) {
          const receipt = await tx.goods_receipts.findUnique({
            where: { id: goodsReceiptId },
            select: { id: true, warehouse_id: true, status: true },
          });
          if (!receipt) {
            return { invalid: true, message: "Không tìm thấy phiếu nhập" };
          }
          if (receipt.warehouse_id !== warehouseId) {
            return { invalid: true, message: "Phiếu nhập không thuộc kho này" };
          }
          if (receipt.status !== "POSTED") {
            return { invalid: true, message: "Chỉ cất hàng cho phiếu nhập đã ghi sổ (POSTED)" };
          }
          const receiptRemaining = await getReceiptVariantRemaining(tx, goodsReceiptId, variantId);
          if (receiptRemaining === null) {
            return { invalid: true, message: "Sách này không thuộc phiếu nhập đã chọn" };
          }
          if (totalQuantity > receiptRemaining) {
            return {
              invalid: true,
              message: `Số lượng cất (${totalQuantity}) vượt quá số còn lại của phiếu này (${receiptRemaining})`,
            };
          }
        }

        // Verify target locations (Prisma ORM handles types correctly)
        const eligibleTargetTypes = getEligibleLocationTypes("RECEIVING");
        for (const location of targetLocations) {
          if (
            !eligibleTargetTypes.includes(
              normalizeLocationType(location.location_type),
            )
          ) {
            return {
              invalid: true,
              message: "target location must be SHELF_COMPARTMENT",
            };
          }
        }

        // Get source stock balance
        const sourceBalance = await tx.stock_balances.findUnique({
          where: {
            variant_id_location_id: {
              variant_id: variantId,
              location_id: sourceReceivingLocationId,
            },
          },
        });

        if (!sourceBalance) {
          return {
            invalid: true,
            message: "No stock balance found in selected RECEIVING source",
          };
        }

        if (Number(sourceBalance.on_hand_qty || 0) < totalQuantity) {
          return {
            invalid: true,
            message: "Not enough on_hand quantity in selected RECEIVING source",
          };
        }

        // Get target stock balances for capacity check
        const targetBalanceRows = await tx.stock_balances.findMany({
          where: {
            location_id: { in: targetIds },
          },
        });

        const occupancyMap = new Map();
        targetBalanceRows.forEach((row) => {
          const current = occupancyMap.get(row.location_id) || 0;
          occupancyMap.set(row.location_id, current + Number(row.on_hand_qty || 0));
        });

        const targetMap = new Map(
          targetLocations.map((item) => [item.id, item]),
        );
        for (const allocation of mergedAllocations) {
          const target = targetMap.get(allocation.target_location_id);
          const currentOnHand = Number(
            occupancyMap.get(allocation.target_location_id) || 0,
          );
          const maxCapacity = computeEffectiveCapacity(target?.capacity_qty);
          const remaining = Math.max(maxCapacity - currentOnHand, 0);

          if (allocation.quantity > remaining) {
            return {
              invalid: true,
              message: `Target ${target.location_code} only has ${remaining} remaining capacity`,
            };
          }
        }

        // RECEIVING_HOLD stock uses on_hand only (available_qty stays 0 per goods receipt posting).
        await tx.stock_balances.update({
          where: {
            variant_id_location_id: {
              variant_id: variantId,
              location_id: sourceReceivingLocationId,
            },
          },
          data: {
            on_hand_qty: { decrement: totalQuantity },
            version: { increment: 1 },
            last_movement_at: new Date(),
          },
        });

        for (const allocation of mergedAllocations) {
          await tx.stock_balances.upsert({
            where: {
              variant_id_location_id: {
                variant_id: variantId,
                location_id: allocation.target_location_id,
              },
            },
            update: {
              on_hand_qty: { increment: allocation.quantity },
              available_qty: { increment: allocation.quantity },
              version: { increment: 1 },
              last_movement_at: new Date(),
            },
            create: {
              warehouse_id: warehouseId,
              variant_id: variantId,
              location_id: allocation.target_location_id,
              on_hand_qty: allocation.quantity,
              available_qty: allocation.quantity,
              version: 1,
              last_movement_at: new Date(),
            },
          });
        }

        const baseTimestamp = Date.now();
        const shortKey = clientIdempotencyKey
          ? clientIdempotencyKey.slice(-8)
          : Math.random().toString(36).slice(2, 6).toUpperCase();

        await tx.stock_movements.createMany({
          data: mergedAllocations.map((allocation, index) => ({
            movement_number: `MV-${(baseTimestamp % 1000000)}-${index + 1}-${shortKey}`,
            movement_type: "TRANSFER",
            movement_status: "POSTED",
            warehouse_id: warehouseId,
            variant_id: variantId,
            from_location_id: sourceReceivingLocationId,
            to_location_id: allocation.target_location_id,
            quantity: allocation.quantity,
            unit_cost: 0,
            source_service: "INVENTORY_SERVICE",
            reference_type: "RECEIVING_SHELF_PUTAWAY",
            reference_id: goodsReceiptId,
            idempotency_key: clientIdempotencyKey
              ? `${clientIdempotencyKey}:${allocation.target_location_id}`.slice(-99)
              : null,
            created_by_user_id: req.user?.id || null,
            metadata: {
              direction: "RECEIVING_TO_SHELF",
              movement_bucket: "PUTAWAY",
              source_receiving_location_id: sourceReceivingLocationId,
              reason: allocation.reason,
              scanned_location_barcode: allocation.scanned_location_barcode,
              scanned_product_barcode: allocation.scanned_product_barcode,
            },
          })),
        });

        await tx.integration_outbox.createMany({
          data: [
            {
              aggregate_type: 'STOCK_BALANCE',
              aggregate_id: variantId,
              event_type: 'inventory.stock.changed',
              payload: {
                variant_id: variantId,
                location_id: sourceReceivingLocationId,
                warehouse_id: warehouseId,
                delta_qty: -totalQuantity,
                reason_code: 'RECEIVING_TO_SHELF',
                source_reference_type: 'GOODS_RECEIPT',
                source_reference_id: goodsReceiptId,
              },
            },
            ...mergedAllocations.map((allocation) => ({
              aggregate_type: 'STOCK_BALANCE',
              aggregate_id: variantId,
              event_type: 'inventory.stock.changed',
              payload: {
                variant_id: variantId,
                location_id: allocation.target_location_id,
                warehouse_id: warehouseId,
                delta_qty: allocation.quantity,
                reason_code: 'RECEIVING_TO_SHELF',
                source_reference_type: 'GOODS_RECEIPT',
                source_reference_id: goodsReceiptId,
              },
            })),
          ],
        });

        return {
          success: true,
          moved_quantity: totalQuantity,
          allocation_count: mergedAllocations.length,
        };
      },
      { isolationLevel: "Serializable" },
    );

    if (result.invalid) {
      return res.status(400).json({ message: result.message });
    }

    await invalidateCache(warehouseId);

    return res.status(201).json({
      message: "Transferred from RECEIVING to shelf successfully",
      data: result,
    });
  } catch (error) {
    if (toSerializableError(error)) {
      return res.status(409).json({
        message:
          "Data changed during confirmation. Please reload and allocate again.",
        code: "CONCURRENCY_CONFLICT",
      });
    }

    console.error("Error while transferring receiving to shelf:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
}

async function reverseShelfToReceiving(req, res) {
  const warehouseId = parseId(req.body?.warehouse_id);
  const sourceCompartmentId = parseId(req.body?.source_compartment_location_id);
  const targetReceivingId = parseId(req.body?.target_receiving_location_id);
  const variantId = parseId(req.body?.variant_id);
  const quantity = toInt(req.body?.quantity);
  const reason = normalizeText(req.body?.reason);
  const clientIdempotencyKey = req.body?.idempotency_key
    ? String(req.body.idempotency_key).slice(0, 100)
    : null;

  if (
    !warehouseId ||
    !sourceCompartmentId ||
    !targetReceivingId ||
    !variantId ||
    quantity === null ||
    quantity <= 0
  ) {
    return res.status(400).json({
      message:
        "warehouse_id, source_compartment_location_id, target_receiving_location_id, variant_id and quantity > 0 are required",
    });
  }

  if (!reason) {
    return res.status(400).json({ message: "reason is required" });
  }

  try {
    const result = await prisma.$transaction(
      async (tx) => {
        const [sourceLocation, targetLocation] = await Promise.all([
          tx.locations.findUnique({
            where: { id: sourceCompartmentId },
            select: {
              id: true,
              warehouse_id: true,
              location_type: true,
              location_code: true,
              is_active: true,
            },
          }),
          tx.locations.findUnique({
            where: { id: targetReceivingId },
            select: {
              id: true,
              warehouse_id: true,
              location_type: true,
              location_code: true,
              is_active: true,
            },
          }),
        ]);

        if (!sourceLocation || !targetLocation) {
          return {
            invalid: true,
            message: "Source or target location not found",
          };
        }

        if (
          sourceLocation.warehouse_id !== warehouseId ||
          targetLocation.warehouse_id !== warehouseId
        ) {
          return {
            invalid: true,
            message: "Source and target must belong to selected warehouse",
          };
        }

        if (
          !sourceLocation.is_active ||
          normalizeLocationType(sourceLocation.location_type) !==
            TARGET_COMPARTMENT_TYPE
        ) {
          return {
            invalid: true,
            message: "source location must be active SHELF_COMPARTMENT",
          };
        }

        if (
          !targetLocation.is_active ||
          !RECEIVING_LOCATION_TYPES.includes(
            normalizeLocationType(targetLocation.location_type),
          )
        ) {
          return {
            invalid: true,
            message: "target location must be active RECEIVING/STAGING",
          };
        }

        // Get source stock balance
        const sourceBalance = await tx.stock_balances.findUnique({
          where: {
            variant_id_location_id: {
              variant_id: variantId,
              location_id: sourceCompartmentId,
            },
          },
        });

        if (!sourceBalance) {
          return {
            invalid: true,
            message: "No stock balance found in selected shelf compartment",
          };
        }

        if (Number(sourceBalance.on_hand_qty || 0) < quantity) {
          return {
            invalid: true,
            message: "Not enough stock in selected shelf compartment",
          };
        }

        if (Number(sourceBalance.available_qty || 0) < quantity) {
          return {
            invalid: true,
            message: "Not enough available stock in selected shelf compartment",
          };
        }

        await tx.stock_balances.update({
          where: {
            variant_id_location_id: {
              variant_id: variantId,
              location_id: sourceCompartmentId,
            },
          },
          data: {
            on_hand_qty: { decrement: quantity },
            available_qty: { decrement: quantity },
            version: { increment: 1 },
            last_movement_at: new Date(),
          },
        });

        await tx.stock_balances.upsert({
          where: {
            variant_id_location_id: {
              variant_id: variantId,
              location_id: targetReceivingId,
            },
          },
          update: {
            on_hand_qty: { increment: quantity },
            // RECEIVING area: available_qty stays 0 (goods awaiting processing)
            available_qty: { increment: 0 },
            version: { increment: 1 },
            last_movement_at: new Date(),
          },
          create: {
            warehouse_id: warehouseId,
            variant_id: variantId,
            location_id: targetReceivingId,
            on_hand_qty: quantity,
            available_qty: 0,
            version: 1,
            last_movement_at: new Date(),
          },
        });

        const baseTimestamp = Date.now();
        const shortKey = clientIdempotencyKey
          ? clientIdempotencyKey.slice(-8)
          : Math.random().toString(36).slice(2, 6).toUpperCase();

        await tx.stock_movements.create({
          data: {
            movement_number: `MV-REV-${(baseTimestamp % 1000000)}-${shortKey}`,
            movement_type: "TRANSFER",
            movement_status: "POSTED",
            warehouse_id: warehouseId,
            variant_id: variantId,
            from_location_id: sourceCompartmentId,
            to_location_id: targetReceivingId,
            quantity,
            unit_cost: 0,
            source_service: "INVENTORY_SERVICE",
            reference_type: "RECEIVING_SHELF_PUTAWAY",
            reference_id: null,
            idempotency_key: clientIdempotencyKey?.slice(-99) || null,
            created_by_user_id: req.user?.id || null,
            metadata: {
              direction: "SHELF_TO_RECEIVING",
              reason,
              target_receiving_location_id: targetReceivingId,
            },
          },
        });

        await tx.integration_outbox.createMany({
          data: [
            {
              aggregate_type: "STOCK_BALANCE",
              aggregate_id: variantId,
              event_type: "inventory.stock.changed",
              payload: {
                variant_id: variantId,
                location_id: sourceCompartmentId,
                warehouse_id: warehouseId,
                delta_qty: -quantity,
                reason_code: "SHELF_TO_RECEIVING_REVERSAL",
                source_reference_type: "SHELF_REVERSAL",
                source_reference_id: null,
              },
            },
            {
              aggregate_type: "STOCK_BALANCE",
              aggregate_id: variantId,
              event_type: "inventory.stock.changed",
              payload: {
                variant_id: variantId,
                location_id: targetReceivingId,
                warehouse_id: warehouseId,
                delta_qty: quantity,
                reason_code: "SHELF_TO_RECEIVING_REVERSAL",
                source_reference_type: "SHELF_REVERSAL",
                source_reference_id: null,
              },
            },
          ],
        });

        return {
          success: true,
          moved_quantity: quantity,
        };
      },
      { isolationLevel: "Serializable" },
    );

    if (result.invalid) {
      return res.status(400).json({ message: result.message });
    }

    await invalidateCache(warehouseId);

    return res.status(201).json({
      message: "Moved from shelf back to RECEIVING successfully",
      data: result,
    });
  } catch (error) {
    if (toSerializableError(error)) {
      return res.status(409).json({
        message:
          "Data changed during confirmation. Please reload and try again.",
        code: "CONCURRENCY_CONFLICT",
      });
    }

    console.error("Error while reversing shelf to receiving:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
}

module.exports = {
  getWarehouseReceivings,
  getReceivingItems,
  getCompartmentCandidates,
  lookupCompartmentByBarcode,
  lookupVariantByBarcode,
  getOccupiedCompartments,
  getCompartmentItems,
  transferReceivingToShelf,
  reverseShelfToReceiving,
};
