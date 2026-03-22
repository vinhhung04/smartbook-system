const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const OUTBOUND_READY_STATUS = ['APPROVED', 'PICKING'];
const TRANSFER_READY_STATUS = ['APPROVED', 'PICKING'];
const SHIPPING_LOCATION_TYPE = 'SHIPPING';
const RECEIVING_LOCATION_TYPES = ['RECEIVING', 'STAGING'];
const REPICK_META_MARKER = 'REPICK_META';
const REPICK_LINE_MARKER = 'REPICK_LINE';
const SHORT_PICK_MARKER = 'SHORT_PICK';

function parseId(value) {
  return String(value || '').trim() || null;
}

function isUuid(value) {
  const text = String(value || '').trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text);
}

function normalizeText(value) {
  const text = String(value || '').trim();
  return text || null;
}

function toInt(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  return Math.trunc(num);
}

function normalizeTaskType(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'outbound' || normalized === 'transfer') {
    return normalized;
  }
  return null;
}

function normalizeLocationType(value) {
  return String(value || '').trim().toUpperCase();
}

function createMovementNumber(baseTimestamp, index) {
  const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `MV-PICK-${baseTimestamp}-${index + 1}-${suffix}`;
}

function createLocationCode(prefix) {
  const ts = Date.now();
  const suffix = Math.random().toString(36).slice(2, 5).toUpperCase();
  return `${prefix}-${ts}-${suffix}`;
}

function toSerializableError(error) {
  const code = String(error?.code || '').toUpperCase();
  const msg = String(error?.message || '').toLowerCase();
  return code === 'P2034' || code === '40001' || msg.includes('could not serialize');
}

function isManagerOrAdmin(user) {
  if (user?.is_superuser) return true;
  const roles = Array.isArray(user?.roles) ? user.roles.map((r) => String(r || '').toUpperCase()) : [];
  return roles.includes('ADMIN') || roles.includes('MANAGER');
}

function getTaskPermissionScope(user) {
  return {
    canManageAssignment: isManagerOrAdmin(user),
    currentUserId: parseId(user?.id),
  };
}

function countRemainingOutbound(items) {
  return items.reduce((sum, item) => {
    const qty = Number(item.quantity || 0);
    const picked = Number(item.processed_qty || 0);
    return sum + calculateLineRemaining(qty, picked, item.note);
  }, 0);
}

function countRemainingTransfer(items) {
  return items.reduce((sum, item) => {
    const qty = Number(item.quantity || 0);
    const picked = Number(item.shipped_qty || 0);
    return sum + calculateLineRemaining(qty, picked, item.note);
  }, 0);
}

function findExpectedLocationMatch(input, expectedLocation) {
  const normalized = String(input || '').trim().toLowerCase();
  if (!normalized) return false;

  const options = [
    expectedLocation?.id,
    expectedLocation?.location_code,
    expectedLocation?.barcode,
  ].filter(Boolean).map((value) => String(value).trim().toLowerCase());

  return options.includes(normalized);
}

function canAccessTask(user, assignedPickerUserId) {
  const scope = getTaskPermissionScope(user);
  if (scope.canManageAssignment) return true;
  if (!scope.currentUserId) return false;

  const assigned = parseId(assignedPickerUserId);
  if (!assigned) return true;

  return assigned === scope.currentUserId;
}

function normalizeCode(value) {
  return String(value || '').trim().toUpperCase();
}

function appendOrderNote(existingNote, marker, text) {
  const line = text ? `[${marker}] ${text}` : `[${marker}]`;
  return [existingNote, line].filter(Boolean).join('\n');
}

function encodeMetaValue(value) {
  return encodeURIComponent(String(value ?? ''));
}

function decodeMetaValue(value) {
  try {
    return decodeURIComponent(String(value || ''));
  } catch {
    return String(value || '');
  }
}

function buildMarkerLine(marker, payload) {
  const entries = Object.entries(payload || {})
    .filter(([, value]) => value !== null && value !== undefined && String(value).trim() !== '')
    .map(([key, value]) => `${key}=${encodeMetaValue(value)}`);

  if (entries.length === 0) {
    return `[${marker}]`;
  }

  return `[${marker}] ${entries.join(';')}`;
}

function parseMarkerPayload(note, marker) {
  const lines = String(note || '').split('\n').map((line) => line.trim()).filter(Boolean);
  const prefix = `[${marker}]`;
  const line = lines.find((item) => item.startsWith(prefix));
  if (!line) return null;

  const rawPayload = line.slice(prefix.length).trim();
  if (!rawPayload) return {};

  const parsed = {};
  rawPayload.split(';').map((item) => item.trim()).filter(Boolean).forEach((entry) => {
    const idx = entry.indexOf('=');
    if (idx <= 0) return;
    const key = entry.slice(0, idx).trim();
    const value = decodeMetaValue(entry.slice(idx + 1).trim());
    if (key) parsed[key] = value;
  });

  return parsed;
}

function upsertMarkerLine(note, marker, payload) {
  const lines = String(note || '').split('\n').map((line) => line.trim()).filter(Boolean);
  const prefix = `[${marker}]`;
  const markerLine = buildMarkerLine(marker, payload);
  const next = [];
  let replaced = false;

  lines.forEach((line) => {
    if (line.startsWith(prefix)) {
      if (!replaced) {
        next.push(markerLine);
        replaced = true;
      }
      return;
    }
    next.push(line);
  });

  if (!replaced) {
    next.push(markerLine);
  }

  return next.join('\n');
}

function parsePositiveInt(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  return Math.max(0, Math.trunc(num));
}

function parseRepickMeta(note) {
  const payload = parseMarkerPayload(note, REPICK_META_MARKER);
  if (!payload) return null;

  const rootTaskType = String(payload.root_task_type || '').trim();
  const rootTaskId = String(payload.root_task_id || '').trim();
  const parentTaskType = String(payload.parent_task_type || '').trim();
  const parentTaskId = String(payload.parent_task_id || '').trim();

  if (!rootTaskType || !rootTaskId || !parentTaskType || !parentTaskId) {
    return null;
  }

  return {
    root_task_type: rootTaskType,
    root_task_id: rootTaskId,
    parent_task_type: parentTaskType,
    parent_task_id: parentTaskId,
    repick_sequence: parsePositiveInt(payload.repick_sequence),
    repick_reason: String(payload.repick_reason || 'SHORT_PICK').trim() || 'SHORT_PICK',
  };
}

function parseRepickLineMeta(note) {
  const payload = parseMarkerPayload(note, REPICK_LINE_MARKER);
  if (!payload) return null;

  return {
    original_line_id: String(payload.original_line_id || '').trim() || null,
    source_task_type: String(payload.source_task_type || '').trim() || null,
    source_task_id: String(payload.source_task_id || '').trim() || null,
    missing_qty: parsePositiveInt(payload.missing_qty),
  };
}

function getLineShortPickedQty(note) {
  const payload = parseMarkerPayload(note, SHORT_PICK_MARKER);
  if (!payload) return 0;
  return parsePositiveInt(payload.qty);
}

function withLineShortPickedQty(note, qty) {
  return upsertMarkerLine(note, SHORT_PICK_MARKER, { qty: parsePositiveInt(qty) });
}

function calculateLineRemaining(quantity, pickedQty, note) {
  const requested = Math.max(0, Number(quantity || 0));
  const picked = Math.max(0, Number(pickedQty || 0));
  const shortPicked = getLineShortPickedQty(note);
  return Math.max(requested - picked - shortPicked, 0);
}

function getTaskClassFromNote(note) {
  return parseRepickMeta(note) ? 'REPICK' : 'PICK';
}

function createRepickOutboundNumber() {
  const ts = Date.now();
  const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `OBR-${ts}-${suffix}`;
}

function createRepickTransferNumber() {
  const ts = Date.now();
  const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `TOR-${ts}-${suffix}`;
}

function buildTaskRef(taskType, taskId) {
  return `${String(taskType || '').trim()}:${String(taskId || '').trim()}`;
}

async function resolveOrCreateWarehouseLocation(tx, warehouseId, locationTypes, defaultCodePrefix, isPickable) {
  const normalizedTypes = Array.isArray(locationTypes)
    ? locationTypes.map((item) => String(item || '').trim().toUpperCase()).filter(Boolean)
    : [String(locationTypes || '').trim().toUpperCase()].filter(Boolean);

  const found = await tx.locations.findFirst({
    where: {
      warehouse_id: warehouseId,
      is_active: true,
      location_type: { in: normalizedTypes },
    },
    orderBy: { location_code: 'asc' },
    select: {
      id: true,
      warehouse_id: true,
      location_code: true,
      barcode: true,
      location_type: true,
      is_active: true,
      is_pickable: true,
    },
  });

  if (found) {
    return found;
  }

  const created = await tx.locations.create({
    data: {
      warehouse_id: warehouseId,
      location_code: createLocationCode(defaultCodePrefix),
      location_type: normalizedTypes[0],
      zone: normalizedTypes[0],
      is_pickable: Boolean(isPickable),
      is_active: true,
    },
    select: {
      id: true,
      warehouse_id: true,
      location_code: true,
      barcode: true,
      location_type: true,
      is_active: true,
      is_pickable: true,
    },
  });

  return created;
}

function buildLocationProximityRank(targetLocation, currentLocation) {
  if (!currentLocation || !targetLocation) return 2;

  const currentShelf = normalizeCode(currentLocation.shelf);
  const currentZone = normalizeCode(currentLocation.zone);
  const targetShelf = normalizeCode(targetLocation.shelf);
  const targetZone = normalizeCode(targetLocation.zone);

  if (currentShelf && targetShelf && currentShelf === targetShelf) return 0;
  if (currentZone && targetZone && currentZone === targetZone) return 1;
  return 2;
}

async function resolveWarehouseLocationByInput(warehouseId, rawInput) {
  const input = normalizeText(rawInput);
  if (!warehouseId || !input) return null;

  const filters = [
    { location_code: input },
    { barcode: input },
  ];

  if (isUuid(input)) {
    filters.unshift({ id: input });
  }

  return prisma.locations.findFirst({
    where: {
      warehouse_id: warehouseId,
      is_active: true,
      OR: filters,
    },
    select: {
      id: true,
      location_code: true,
      barcode: true,
      location_type: true,
      zone: true,
      shelf: true,
    },
  });
}

function chooseBestCandidate(candidates, currentLocation) {
  if (!Array.isArray(candidates) || candidates.length === 0) return null;

  const sorted = [...candidates].sort((a, b) => {
    const proximityA = buildLocationProximityRank(a.locations, currentLocation);
    const proximityB = buildLocationProximityRank(b.locations, currentLocation);
    if (proximityA !== proximityB) return proximityA - proximityB;

    const availableA = Number(a.available_qty || 0);
    const availableB = Number(b.available_qty || 0);
    if (availableA !== availableB) return availableB - availableA;

    const codeA = String(a.locations?.location_code || 'ZZZ');
    const codeB = String(b.locations?.location_code || 'ZZZ');
    return codeA.localeCompare(codeB);
  });

  return sorted[0] || null;
}

async function findBestSourceBalance(warehouseId, variantId, currentLocation) {
  const balances = await prisma.stock_balances.findMany({
    where: {
      warehouse_id: warehouseId,
      variant_id: variantId,
      available_qty: { gt: 0 },
      locations: {
        is_active: true,
        is_pickable: true,
      },
    },
    include: {
      locations: {
        select: {
          id: true,
          location_code: true,
          barcode: true,
          location_type: true,
          zone: true,
          shelf: true,
        },
      },
    },
  });

  return chooseBestCandidate(balances, currentLocation);
}

async function resolveVariantMatchesByBarcode(tx, barcode) {
  const normalized = normalizeText(barcode);
  if (!normalized) return [];

  const unitMatches = await tx.inventory_units.findMany({
    where: { unit_barcode: normalized },
    select: {
      variant_id: true,
      unit_barcode: true,
    },
    take: 10,
  });

  const variantMatches = await tx.book_variants.findMany({
    where: {
      OR: [
        { internal_barcode: normalized },
        { isbn13: normalized },
        { isbn10: normalized },
        { sku: normalized },
      ],
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

  const map = new Map();

  unitMatches.forEach((row) => {
    const key = String(row.variant_id);
    if (!map.has(key)) {
      map.set(key, {
        variant_id: key,
        sku: null,
        isbn13: null,
        isbn10: null,
        internal_barcode: null,
        matched_by: 'unit_barcode',
        match_priority: 0,
        book_id: null,
        book_title: 'Chua co ten sach',
      });
    }
  });

  variantMatches.forEach((row) => {
    const key = String(row.id);
    let matchedBy = 'sku';
    let priority = 4;

    if (row.internal_barcode === normalized) {
      matchedBy = 'internal_barcode';
      priority = 1;
    } else if (row.isbn13 === normalized) {
      matchedBy = 'isbn13';
      priority = 2;
    } else if (row.isbn10 === normalized) {
      matchedBy = 'isbn10';
      priority = 3;
    }

    const current = map.get(key);
    if (!current || priority < current.match_priority) {
      map.set(key, {
        variant_id: key,
        sku: row.sku,
        isbn13: row.isbn13,
        isbn10: row.isbn10,
        internal_barcode: row.internal_barcode,
        matched_by: matchedBy,
        match_priority: priority,
        book_id: row.books?.id || null,
        book_title: row.books?.title || 'Chua co ten sach',
      });
    } else if (current) {
      current.sku = current.sku || row.sku;
      current.isbn13 = current.isbn13 || row.isbn13;
      current.isbn10 = current.isbn10 || row.isbn10;
      current.internal_barcode = current.internal_barcode || row.internal_barcode;
      current.book_id = current.book_id || row.books?.id || null;
      current.book_title = current.book_title || row.books?.title || 'Chua co ten sach';
    }
  });

  return Array.from(map.values()).sort((a, b) => a.match_priority - b.match_priority || a.variant_id.localeCompare(b.variant_id));
}

async function resolveTaskOrderNumber(dbClient, taskType, taskId) {
  if (!taskType || !taskId) return null;

  if (taskType === 'outbound') {
    const order = await dbClient.outbound_orders.findUnique({
      where: { id: taskId },
      select: { outbound_number: true },
    });
    return order?.outbound_number || null;
  }

  if (taskType === 'transfer') {
    const order = await dbClient.transfer_orders.findUnique({
      where: { id: taskId },
      select: { transfer_number: true },
    });
    return order?.transfer_number || null;
  }

  return null;
}

function buildRepickOrderNote(meta) {
  const withMeta = upsertMarkerLine('', REPICK_META_MARKER, meta);
  return appendOrderNote(withMeta, 'REPICK_REASON', meta.repick_reason || 'SHORT_PICK');
}

function buildRepickLineNote(meta) {
  return upsertMarkerLine('', REPICK_LINE_MARKER, meta);
}

function mapOutboundShortages(lines, taskType, taskId) {
  return (lines || []).map((line) => {
    const missingQty = getLineShortPickedQty(line.note);
    const repickLineMeta = parseRepickLineMeta(line.note);
    return {
      variant_id: line.variant_id,
      source_location_id: line.source_location_id || null,
      quantity: missingQty,
      original_line_id: repickLineMeta?.original_line_id || line.id,
      source_task_type: repickLineMeta?.source_task_type || taskType,
      source_task_id: repickLineMeta?.source_task_id || taskId,
    };
  }).filter((line) => line.quantity > 0);
}

function mapTransferShortages(lines, taskType, taskId) {
  return (lines || []).map((line) => {
    const missingQty = getLineShortPickedQty(line.note);
    const repickLineMeta = parseRepickLineMeta(line.note);
    return {
      variant_id: line.variant_id,
      from_location_id: line.from_location_id || null,
      to_location_id: line.to_location_id || null,
      quantity: missingQty,
      original_line_id: repickLineMeta?.original_line_id || line.id,
      source_task_type: repickLineMeta?.source_task_type || taskType,
      source_task_id: repickLineMeta?.source_task_id || taskId,
    };
  }).filter((line) => line.quantity > 0);
}

async function maybeCreateRepickFromOutbound(tx, order, lines, actorUserId) {
  const shortages = mapOutboundShortages(lines, 'outbound', order.id);
  if (shortages.length === 0) return null;

  const parentMeta = parseRepickMeta(order.note);
  const rootTaskType = parentMeta?.root_task_type || 'outbound';
  const rootTaskId = parentMeta?.root_task_id || order.id;
  const repickSequence = Number(parentMeta?.repick_sequence || 0) + 1;

  const existingChild = await tx.outbound_orders.findFirst({
    where: {
      note: { contains: `[${REPICK_META_MARKER}]` },
      AND: [
        { note: { contains: `parent_task_type=${encodeMetaValue('outbound')}` } },
        { note: { contains: `parent_task_id=${encodeMetaValue(order.id)}` } },
      ],
      status: { not: 'CANCELLED' },
    },
    select: {
      id: true,
      outbound_number: true,
    },
  });

  if (existingChild) {
    return {
      task_type: 'outbound',
      task_id: existingChild.id,
      order_number: existingChild.outbound_number,
      repick_sequence: repickSequence,
      reused_existing: true,
    };
  }

  const repickMeta = {
    root_task_type: rootTaskType,
    root_task_id: rootTaskId,
    parent_task_type: 'outbound',
    parent_task_id: order.id,
    repick_sequence: repickSequence,
    repick_reason: 'SHORT_PICK',
  };

  const createdOrder = await tx.outbound_orders.create({
    data: {
      outbound_number: createRepickOutboundNumber(),
      warehouse_id: order.warehouse_id,
      outbound_type: 'MANUAL',
      status: 'APPROVED',
      requested_by_user_id: order.requested_by_user_id || actorUserId,
      approved_by_user_id: actorUserId,
      external_reference: `REPICK:${order.outbound_number}`,
      note: buildRepickOrderNote(repickMeta),
    },
    select: {
      id: true,
      outbound_number: true,
    },
  });

  await tx.outbound_order_items.createMany({
    data: shortages.map((line) => ({
      outbound_order_id: createdOrder.id,
      variant_id: line.variant_id,
      source_location_id: line.source_location_id,
      quantity: line.quantity,
      processed_qty: 0,
      note: buildRepickLineNote({
        original_line_id: line.original_line_id,
        source_task_type: line.source_task_type,
        source_task_id: line.source_task_id,
        missing_qty: line.quantity,
      }),
    })),
  });

  await tx.inventory_audit_logs.create({
    data: {
      actor_user_id: actorUserId,
      action_name: 'REPICK_ORDER_CREATED',
      entity_type: 'OUTBOUND_ORDER',
      entity_id: createdOrder.id,
      after_data: {
        parent_task_type: 'outbound',
        parent_task_id: order.id,
        root_task_type: rootTaskType,
        root_task_id: rootTaskId,
        repick_sequence: repickSequence,
        line_count: shortages.length,
      },
    },
  });

  return {
    task_type: 'outbound',
    task_id: createdOrder.id,
    order_number: createdOrder.outbound_number,
    repick_sequence: repickSequence,
    reused_existing: false,
  };
}

async function maybeCreateRepickFromTransfer(tx, order, lines, actorUserId) {
  const shortages = mapTransferShortages(lines, 'transfer', order.id);
  if (shortages.length === 0) return null;

  const parentMeta = parseRepickMeta(order.note);
  const rootTaskType = parentMeta?.root_task_type || 'transfer';
  const rootTaskId = parentMeta?.root_task_id || order.id;
  const repickSequence = Number(parentMeta?.repick_sequence || 0) + 1;

  const existingChild = await tx.transfer_orders.findFirst({
    where: {
      note: { contains: `[${REPICK_META_MARKER}]` },
      AND: [
        { note: { contains: `parent_task_type=${encodeMetaValue('transfer')}` } },
        { note: { contains: `parent_task_id=${encodeMetaValue(order.id)}` } },
      ],
      status: { not: 'CANCELLED' },
    },
    select: {
      id: true,
      transfer_number: true,
    },
  });

  if (existingChild) {
    return {
      task_type: 'transfer',
      task_id: existingChild.id,
      order_number: existingChild.transfer_number,
      repick_sequence: repickSequence,
      reused_existing: true,
    };
  }

  const repickMeta = {
    root_task_type: rootTaskType,
    root_task_id: rootTaskId,
    parent_task_type: 'transfer',
    parent_task_id: order.id,
    repick_sequence: repickSequence,
    repick_reason: 'SHORT_PICK',
  };

  const createdOrder = await tx.transfer_orders.create({
    data: {
      transfer_number: createRepickTransferNumber(),
      from_warehouse_id: order.from_warehouse_id,
      to_warehouse_id: order.to_warehouse_id,
      status: 'APPROVED',
      requested_by_user_id: order.requested_by_user_id || actorUserId,
      approved_by_user_id: actorUserId,
      note: buildRepickOrderNote(repickMeta),
    },
    select: {
      id: true,
      transfer_number: true,
    },
  });

  await tx.transfer_order_items.createMany({
    data: shortages.map((line) => ({
      transfer_order_id: createdOrder.id,
      variant_id: line.variant_id,
      from_location_id: line.from_location_id,
      to_location_id: line.to_location_id,
      quantity: line.quantity,
      shipped_qty: 0,
      received_qty: 0,
      note: buildRepickLineNote({
        original_line_id: line.original_line_id,
        source_task_type: line.source_task_type,
        source_task_id: line.source_task_id,
        missing_qty: line.quantity,
      }),
    })),
  });

  await tx.inventory_audit_logs.create({
    data: {
      actor_user_id: actorUserId,
      action_name: 'REPICK_ORDER_CREATED',
      entity_type: 'TRANSFER_ORDER',
      entity_id: createdOrder.id,
      after_data: {
        parent_task_type: 'transfer',
        parent_task_id: order.id,
        root_task_type: rootTaskType,
        root_task_id: rootTaskId,
        repick_sequence: repickSequence,
        line_count: shortages.length,
      },
    },
  });

  return {
    task_type: 'transfer',
    task_id: createdOrder.id,
    order_number: createdOrder.transfer_number,
    repick_sequence: repickSequence,
    reused_existing: false,
  };
}

async function ensureRepicksFromCompletedShortages() {
  await prisma.$transaction(async (tx) => {
    const [outboundParents, transferParents] = await Promise.all([
      tx.outbound_orders.findMany({
        where: {
          status: 'READY_FOR_OUTBOUND',
          outbound_order_items: {
            some: {
              note: {
                contains: `[${SHORT_PICK_MARKER}]`,
              },
            },
          },
        },
        select: {
          id: true,
          outbound_number: true,
          warehouse_id: true,
          requested_by_user_id: true,
          processed_by_user_id: true,
          note: true,
          outbound_order_items: {
            select: {
              id: true,
              variant_id: true,
              source_location_id: true,
              quantity: true,
              processed_qty: true,
              note: true,
            },
          },
        },
        take: 20,
      }),
      tx.transfer_orders.findMany({
        where: {
          status: 'READY_FOR_OUTBOUND',
          transfer_order_items: {
            some: {
              note: {
                contains: `[${SHORT_PICK_MARKER}]`,
              },
            },
          },
        },
        select: {
          id: true,
          transfer_number: true,
          from_warehouse_id: true,
          to_warehouse_id: true,
          requested_by_user_id: true,
          shipped_by_user_id: true,
          note: true,
          transfer_order_items: {
            select: {
              id: true,
              variant_id: true,
              from_location_id: true,
              to_location_id: true,
              quantity: true,
              shipped_qty: true,
              note: true,
            },
          },
        },
        take: 20,
      }),
    ]);

    for (const order of outboundParents) {
      const actorUserId = parseId(order.processed_by_user_id) || parseId(order.requested_by_user_id);
      await maybeCreateRepickFromOutbound(tx, order, order.outbound_order_items || [], actorUserId);
    }

    for (const order of transferParents) {
      const actorUserId = parseId(order.shipped_by_user_id) || parseId(order.requested_by_user_id);
      await maybeCreateRepickFromTransfer(tx, order, order.transfer_order_items || [], actorUserId);
    }
  }, { isolationLevel: 'Serializable' });
}

async function listPickingTasks(req, res) {
  const warehouseId = parseId(req.query.warehouse_id);

  try {
    await ensureRepicksFromCompletedShortages();

    const [outboundOrders, transferOrders] = await Promise.all([
      prisma.outbound_orders.findMany({
        where: {
          ...(warehouseId ? { warehouse_id: warehouseId } : {}),
          status: { in: OUTBOUND_READY_STATUS },
        },
        include: {
          warehouses: {
            select: { id: true, code: true, name: true },
          },
          outbound_order_items: {
            select: {
              id: true,
              quantity: true,
              processed_qty: true,
              note: true,
            },
          },
        },
        orderBy: { requested_at: 'asc' },
      }),
      prisma.transfer_orders.findMany({
        where: {
          ...(warehouseId ? { from_warehouse_id: warehouseId } : {}),
          status: { in: TRANSFER_READY_STATUS },
        },
        include: {
          warehouses_transfer_orders_from_warehouse_idTowarehouses: {
            select: { id: true, code: true, name: true },
          },
          warehouses_transfer_orders_to_warehouse_idTowarehouses: {
            select: { id: true, code: true, name: true },
          },
          transfer_order_items: {
            select: {
              id: true,
              quantity: true,
              shipped_qty: true,
              note: true,
            },
          },
        },
        orderBy: { requested_at: 'asc' },
      }),
    ]);

    const tasks = [];

    outboundOrders.forEach((order) => {
      const remaining = countRemainingOutbound(order.outbound_order_items || []);
      const totalQty = (order.outbound_order_items || []).reduce((sum, line) => sum + Number(line.quantity || 0), 0);
      const assignedPicker = parseId(order.processed_by_user_id);
      const repickMeta = parseRepickMeta(order.note);
      const taskClass = getTaskClassFromNote(order.note);

      tasks.push({
        task_type: 'outbound',
        task_id: order.id,
        order_number: order.outbound_number,
        order_type: repickMeta ? 'OUTBOUND_REPICK' : `OUTBOUND_${order.outbound_type}`,
        task_class: taskClass,
        repick_sequence: repickMeta?.repick_sequence || null,
        repick_reason: repickMeta?.repick_reason || null,
        root_task_type: repickMeta?.root_task_type || null,
        root_task_id: repickMeta?.root_task_id || null,
        parent_task_type: repickMeta?.parent_task_type || null,
        parent_task_id: repickMeta?.parent_task_id || null,
        source_warehouse_id: order.warehouse_id,
        source_warehouse_code: order.warehouses?.code || null,
        source_warehouse_name: order.warehouses?.name || null,
        target_warehouse_id: null,
        target_warehouse_code: null,
        target_warehouse_name: null,
        status: order.status,
        line_count: order.outbound_order_items.length,
        total_quantity: totalQty,
        remaining_quantity: remaining,
        assigned_picker_user_id: assignedPicker,
        requested_at: order.requested_at,
        approved_at: order.updated_at,
      });
    });

    transferOrders.forEach((order) => {
      const remaining = countRemainingTransfer(order.transfer_order_items || []);
      const totalQty = (order.transfer_order_items || []).reduce((sum, line) => sum + Number(line.quantity || 0), 0);
      const assignedPicker = parseId(order.shipped_by_user_id);
      const repickMeta = parseRepickMeta(order.note);
      const taskClass = getTaskClassFromNote(order.note);

      tasks.push({
        task_type: 'transfer',
        task_id: order.id,
        order_number: order.transfer_number,
        order_type: repickMeta ? 'WAREHOUSE_TRANSFER_REPICK' : 'WAREHOUSE_TRANSFER',
        task_class: taskClass,
        repick_sequence: repickMeta?.repick_sequence || null,
        repick_reason: repickMeta?.repick_reason || null,
        root_task_type: repickMeta?.root_task_type || null,
        root_task_id: repickMeta?.root_task_id || null,
        parent_task_type: repickMeta?.parent_task_type || null,
        parent_task_id: repickMeta?.parent_task_id || null,
        source_warehouse_id: order.from_warehouse_id,
        source_warehouse_code: order.warehouses_transfer_orders_from_warehouse_idTowarehouses?.code || null,
        source_warehouse_name: order.warehouses_transfer_orders_from_warehouse_idTowarehouses?.name || null,
        target_warehouse_id: order.to_warehouse_id,
        target_warehouse_code: order.warehouses_transfer_orders_to_warehouse_idTowarehouses?.code || null,
        target_warehouse_name: order.warehouses_transfer_orders_to_warehouse_idTowarehouses?.name || null,
        status: order.status,
        line_count: order.transfer_order_items.length,
        total_quantity: totalQty,
        remaining_quantity: remaining,
        assigned_picker_user_id: assignedPicker,
        requested_at: order.requested_at,
        approved_at: order.updated_at,
      });
    });

    const scope = getTaskPermissionScope(req.user || {});

    const filtered = tasks
      .filter((task) => task.remaining_quantity > 0)
      .filter((task) => {
        if (scope.canManageAssignment) return true;
        if (!scope.currentUserId) return false;
        return !task.assigned_picker_user_id || task.assigned_picker_user_id === scope.currentUserId;
      })
      .sort((a, b) => new Date(a.requested_at).getTime() - new Date(b.requested_at).getTime());

    return res.json({ data: filtered });
  } catch (error) {
    console.error('Error while listing picking tasks:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}

async function claimPickingTask(req, res) {
  const taskType = normalizeTaskType(req.params.taskType);
  const taskId = parseId(req.params.taskId);
  const requestedPickerUserId = parseId(req.body?.picker_user_id);

  if (!taskType || !taskId) {
    return res.status(400).json({ message: 'Invalid task type or task id' });
  }

  const scope = getTaskPermissionScope(req.user || {});
  const currentUserId = scope.currentUserId;

  if (!currentUserId) {
    return res.status(401).json({ message: 'Invalid current user context' });
  }

  const pickerUserId = requestedPickerUserId || currentUserId;

  if (!scope.canManageAssignment && pickerUserId !== currentUserId) {
    return res.status(403).json({ message: 'You can only claim task for yourself' });
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      if (taskType === 'outbound') {
        const order = await tx.outbound_orders.findUnique({
          where: { id: taskId },
          select: {
            id: true,
            status: true,
            processed_by_user_id: true,
          },
        });

        if (!order) return { invalid: true, statusCode: 404, message: 'Outbound order not found' };
        if (!OUTBOUND_READY_STATUS.includes(order.status)) {
          return { invalid: true, statusCode: 400, message: 'Outbound order is not ready for picking' };
        }

        if (order.processed_by_user_id && order.processed_by_user_id !== pickerUserId && !scope.canManageAssignment) {
          return { invalid: true, statusCode: 409, message: 'Task is already assigned to another picker' };
        }

        const updated = await tx.outbound_orders.update({
          where: { id: taskId },
          data: {
            processed_by_user_id: pickerUserId,
            status: 'PICKING',
          },
        });

        await tx.inventory_audit_logs.create({
          data: {
            actor_user_id: currentUserId,
            action_name: 'PICK_TASK_CLAIM',
            entity_type: 'OUTBOUND_ORDER',
            entity_id: taskId,
            after_data: {
              picker_user_id: pickerUserId,
            },
          },
        });

        return {
          data: {
            task_type: 'outbound',
            task_id: updated.id,
            assigned_picker_user_id: updated.processed_by_user_id,
            status: updated.status,
          },
        };
      }

      const order = await tx.transfer_orders.findUnique({
        where: { id: taskId },
        select: {
          id: true,
          status: true,
          shipped_by_user_id: true,
        },
      });

      if (!order) return { invalid: true, statusCode: 404, message: 'Transfer order not found' };
      if (!TRANSFER_READY_STATUS.includes(order.status)) {
        return { invalid: true, statusCode: 400, message: 'Transfer order is not ready for picking' };
      }

      if (order.shipped_by_user_id && order.shipped_by_user_id !== pickerUserId && !scope.canManageAssignment) {
        return { invalid: true, statusCode: 409, message: 'Task is already assigned to another picker' };
      }

      const updated = await tx.transfer_orders.update({
        where: { id: taskId },
        data: {
          shipped_by_user_id: pickerUserId,
          status: 'PICKING',
        },
      });

      await tx.inventory_audit_logs.create({
        data: {
          actor_user_id: currentUserId,
          action_name: 'PICK_TASK_CLAIM',
          entity_type: 'TRANSFER_ORDER',
          entity_id: taskId,
          after_data: {
            picker_user_id: pickerUserId,
          },
        },
      });

      return {
        data: {
          task_type: 'transfer',
          task_id: updated.id,
          assigned_picker_user_id: updated.shipped_by_user_id,
          status: updated.status,
        },
      };
    });

    if (result.invalid) {
      return res.status(result.statusCode || 400).json({ message: result.message });
    }

    return res.json(result.data);
  } catch (error) {
    console.error('Error while claiming picking task:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}

async function getPickingTaskDetail(req, res) {
  const taskType = normalizeTaskType(req.params.taskType);
  const taskId = parseId(req.params.taskId);
  const currentLocationInput = normalizeText(req.query.current_location_input);

  if (!taskType || !taskId) {
    return res.status(400).json({ message: 'Invalid task type or task id' });
  }

  try {
    if (taskType === 'outbound') {
      const order = await prisma.outbound_orders.findUnique({
        where: { id: taskId },
        include: {
          warehouses: {
            select: { id: true, code: true, name: true },
          },
          outbound_order_items: {
            include: {
              locations: {
                select: {
                  id: true,
                  location_code: true,
                  location_type: true,
                  barcode: true,
                },
              },
              book_variants: {
                select: {
                  id: true,
                  sku: true,
                  isbn13: true,
                  isbn10: true,
                  internal_barcode: true,
                  books: {
                    select: { id: true, title: true },
                  },
                },
              },
            },
            orderBy: { id: 'asc' },
          },
        },
      });

      if (!order) {
        return res.status(404).json({ message: 'Outbound order not found' });
      }

      if (!canAccessTask(req.user || {}, order.processed_by_user_id)) {
        return res.status(403).json({ message: 'Forbidden' });
      }

      const currentLocation = await resolveWarehouseLocationByInput(order.warehouse_id, currentLocationInput);

      const lines = [];
      for (const line of order.outbound_order_items) {
        const requestedQty = Number(line.quantity || 0);
        const pickedQty = Number(line.processed_qty || 0);
        const shortPickedQty = getLineShortPickedQty(line.note);
        const remainingQty = calculateLineRemaining(requestedQty, pickedQty, line.note);
        const repickLineMeta = parseRepickLineMeta(line.note);

        let sourceLocationId = line.source_location_id || null;
        let sourceLocationCode = line.locations?.location_code || null;
        let sourceLocationBarcode = line.locations?.barcode || null;
        let sourceLocationType = line.locations?.location_type || null;
        let sourceLocationZone = line.locations?.zone || null;
        let sourceLocationShelf = line.locations?.shelf || null;
        let sourceAvailableHint = 0;

        if (sourceLocationId) {
          const fixedBalance = await prisma.stock_balances.findUnique({
            where: {
              variant_id_location_id: {
                variant_id: line.variant_id,
                location_id: sourceLocationId,
              },
            },
            select: {
              available_qty: true,
            },
          });
          sourceAvailableHint = Number(fixedBalance?.available_qty || 0);
        }

        let candidateLocationId = null;
        if (remainingQty > 0 && (!sourceLocationId || sourceAvailableHint <= 0)) {
          const candidateBalance = await findBestSourceBalance(order.warehouse_id, line.variant_id, currentLocation);
          if (candidateBalance?.locations) {
            if (!sourceLocationId || candidateBalance.location_id !== sourceLocationId) {
              candidateLocationId = candidateBalance.location_id;
            }
            sourceLocationId = candidateBalance.location_id;
            sourceLocationCode = candidateBalance.locations.location_code || null;
            sourceLocationBarcode = candidateBalance.locations.barcode || null;
            sourceLocationType = candidateBalance.locations.location_type || null;
            sourceLocationZone = candidateBalance.locations.zone || null;
            sourceLocationShelf = candidateBalance.locations.shelf || null;
            sourceAvailableHint = Number(candidateBalance.available_qty || 0);
          }
        }

        lines.push({
          line_id: line.id,
          variant_id: line.variant_id,
          source_location_id: sourceLocationId,
          source_location_code: sourceLocationCode,
          source_location_barcode: sourceLocationBarcode,
          source_location_type: sourceLocationType,
          source_location_zone: sourceLocationZone,
          source_location_shelf: sourceLocationShelf,
          source_available_hint: sourceAvailableHint,
          candidate_source_location_id: candidateLocationId,
          sku: line.book_variants?.sku || null,
          isbn13: line.book_variants?.isbn13 || null,
          isbn10: line.book_variants?.isbn10 || null,
          barcode: line.book_variants?.internal_barcode || line.book_variants?.isbn13 || line.book_variants?.isbn10 || line.book_variants?.sku || null,
          book_title: line.book_variants?.books?.title || 'Chua co ten sach',
          requested_qty: requestedQty,
          picked_qty: pickedQty,
          short_picked_qty: shortPickedQty,
          remaining_qty: remainingQty,
          repick_line: repickLineMeta,
          note: line.note || null,
        });
      }

      lines.sort((a, b) => {
        const proximityA = buildLocationProximityRank({
          zone: a.source_location_zone,
          shelf: a.source_location_shelf,
        }, currentLocation);
        const proximityB = buildLocationProximityRank({
          zone: b.source_location_zone,
          shelf: b.source_location_shelf,
        }, currentLocation);

        if (a.remaining_qty > 0 && b.remaining_qty > 0 && proximityA !== proximityB) {
          return proximityA - proximityB;
        }

        const availA = Number(a.source_available_hint || 0);
        const availB = Number(b.source_available_hint || 0);
        if (a.remaining_qty > 0 && b.remaining_qty > 0 && availA !== availB) {
          return availB - availA;
        }

        const aCode = String(a.source_location_code || 'ZZZ');
        const bCode = String(b.source_location_code || 'ZZZ');
        return aCode.localeCompare(bCode) || a.book_title.localeCompare(b.book_title);
      });

      const remainingLines = lines.filter((line) => line.remaining_qty > 0);
      const repickMeta = parseRepickMeta(order.note);
      const rootOrderNumber = repickMeta
        ? await resolveTaskOrderNumber(prisma, repickMeta.root_task_type, repickMeta.root_task_id)
        : null;
      const parentOrderNumber = repickMeta
        ? await resolveTaskOrderNumber(prisma, repickMeta.parent_task_type, repickMeta.parent_task_id)
        : null;

      const preparedCurrentLine = remainingLines[0] || null;
      if (preparedCurrentLine?.candidate_source_location_id) {
        await prisma.outbound_order_items.update({
          where: { id: preparedCurrentLine.line_id },
          data: {
            source_location_id: preparedCurrentLine.candidate_source_location_id,
          },
        });
      }

      return res.json({
        task_type: 'outbound',
        task_id: order.id,
        order_number: order.outbound_number,
        order_type: repickMeta ? 'OUTBOUND_REPICK' : `OUTBOUND_${order.outbound_type}`,
        task_class: getTaskClassFromNote(order.note),
        repick_sequence: repickMeta?.repick_sequence || null,
        repick_reason: repickMeta?.repick_reason || null,
        root_task_type: repickMeta?.root_task_type || null,
        root_task_id: repickMeta?.root_task_id || null,
        root_order_number: rootOrderNumber,
        parent_task_type: repickMeta?.parent_task_type || null,
        parent_task_id: repickMeta?.parent_task_id || null,
        parent_order_number: parentOrderNumber,
        status: order.status,
        source_warehouse_id: order.warehouse_id,
        source_warehouse_code: order.warehouses?.code || null,
        source_warehouse_name: order.warehouses?.name || null,
        target_warehouse_id: null,
        target_warehouse_code: null,
        target_warehouse_name: null,
        assigned_picker_user_id: parseId(order.processed_by_user_id),
        requested_at: order.requested_at,
        completed_at: order.completed_at || null,
        lines,
        current_line: preparedCurrentLine,
        remaining_line_count: remainingLines.length,
        remaining_quantity: remainingLines.reduce((sum, line) => sum + line.remaining_qty, 0),
      });
    }

    const order = await prisma.transfer_orders.findUnique({
      where: { id: taskId },
      include: {
        warehouses_transfer_orders_from_warehouse_idTowarehouses: {
          select: { id: true, code: true, name: true },
        },
        warehouses_transfer_orders_to_warehouse_idTowarehouses: {
          select: { id: true, code: true, name: true },
        },
        transfer_order_items: {
          include: {
            locations_transfer_order_items_from_location_idTolocations: {
              select: {
                id: true,
                location_code: true,
                location_type: true,
                barcode: true,
              },
            },
            locations_transfer_order_items_to_location_idTolocations: {
              select: {
                id: true,
                location_code: true,
                location_type: true,
              },
            },
            book_variants: {
              select: {
                id: true,
                sku: true,
                isbn13: true,
                isbn10: true,
                internal_barcode: true,
                books: {
                  select: { id: true, title: true },
                },
              },
            },
          },
          orderBy: { id: 'asc' },
        },
      },
    });

    if (!order) {
      return res.status(404).json({ message: 'Transfer order not found' });
    }

    if (!canAccessTask(req.user || {}, order.shipped_by_user_id)) {
      return res.status(403).json({ message: 'Forbidden' });
    }

    const currentLocation = await resolveWarehouseLocationByInput(order.from_warehouse_id, currentLocationInput);

    const lines = [];
    for (const line of order.transfer_order_items) {
      const requestedQty = Number(line.quantity || 0);
      const pickedQty = Number(line.shipped_qty || 0);
      const shortPickedQty = getLineShortPickedQty(line.note);
      const remainingQty = calculateLineRemaining(requestedQty, pickedQty, line.note);
      const repickLineMeta = parseRepickLineMeta(line.note);

      let sourceLocationId = line.from_location_id || null;
      let sourceLocationCode = line.locations_transfer_order_items_from_location_idTolocations?.location_code || null;
      let sourceLocationBarcode = line.locations_transfer_order_items_from_location_idTolocations?.barcode || null;
      let sourceLocationType = line.locations_transfer_order_items_from_location_idTolocations?.location_type || null;
      let sourceLocationZone = line.locations_transfer_order_items_from_location_idTolocations?.zone || null;
      let sourceLocationShelf = line.locations_transfer_order_items_from_location_idTolocations?.shelf || null;
      let sourceAvailableHint = 0;

      if (sourceLocationId) {
        const fixedBalance = await prisma.stock_balances.findUnique({
          where: {
            variant_id_location_id: {
              variant_id: line.variant_id,
              location_id: sourceLocationId,
            },
          },
          select: {
            available_qty: true,
          },
        });
        sourceAvailableHint = Number(fixedBalance?.available_qty || 0);
      }

      let candidateLocationId = null;
      if (remainingQty > 0 && (!sourceLocationId || sourceAvailableHint <= 0)) {
        const candidateBalance = await findBestSourceBalance(order.from_warehouse_id, line.variant_id, currentLocation);
        if (candidateBalance?.locations) {
          if (!sourceLocationId || candidateBalance.location_id !== sourceLocationId) {
            candidateLocationId = candidateBalance.location_id;
          }
          sourceLocationId = candidateBalance.location_id;
          sourceLocationCode = candidateBalance.locations.location_code || null;
          sourceLocationBarcode = candidateBalance.locations.barcode || null;
          sourceLocationType = candidateBalance.locations.location_type || null;
          sourceLocationZone = candidateBalance.locations.zone || null;
          sourceLocationShelf = candidateBalance.locations.shelf || null;
          sourceAvailableHint = Number(candidateBalance.available_qty || 0);
        }
      }

      lines.push({
        line_id: line.id,
        variant_id: line.variant_id,
        source_location_id: sourceLocationId,
        source_location_code: sourceLocationCode,
        source_location_barcode: sourceLocationBarcode,
        source_location_type: sourceLocationType,
        source_location_zone: sourceLocationZone,
        source_location_shelf: sourceLocationShelf,
        source_available_hint: sourceAvailableHint,
        candidate_source_location_id: candidateLocationId,
        target_location_id: line.to_location_id,
        target_location_code: line.locations_transfer_order_items_to_location_idTolocations?.location_code || null,
        sku: line.book_variants?.sku || null,
        isbn13: line.book_variants?.isbn13 || null,
        isbn10: line.book_variants?.isbn10 || null,
        barcode: line.book_variants?.internal_barcode || line.book_variants?.isbn13 || line.book_variants?.isbn10 || line.book_variants?.sku || null,
        book_title: line.book_variants?.books?.title || 'Chua co ten sach',
        requested_qty: requestedQty,
        picked_qty: pickedQty,
        short_picked_qty: shortPickedQty,
        remaining_qty: remainingQty,
        repick_line: repickLineMeta,
        note: line.note || null,
      });
    }

    lines.sort((a, b) => {
      const proximityA = buildLocationProximityRank({
        zone: a.source_location_zone,
        shelf: a.source_location_shelf,
      }, currentLocation);
      const proximityB = buildLocationProximityRank({
        zone: b.source_location_zone,
        shelf: b.source_location_shelf,
      }, currentLocation);

      if (a.remaining_qty > 0 && b.remaining_qty > 0 && proximityA !== proximityB) {
        return proximityA - proximityB;
      }

      const availA = Number(a.source_available_hint || 0);
      const availB = Number(b.source_available_hint || 0);
      if (a.remaining_qty > 0 && b.remaining_qty > 0 && availA !== availB) {
        return availB - availA;
      }

      const aCode = String(a.source_location_code || 'ZZZ');
      const bCode = String(b.source_location_code || 'ZZZ');
      return aCode.localeCompare(bCode) || a.book_title.localeCompare(b.book_title);
    });

    const remainingLines = lines.filter((line) => line.remaining_qty > 0);
    const repickMeta = parseRepickMeta(order.note);
    const rootOrderNumber = repickMeta
      ? await resolveTaskOrderNumber(prisma, repickMeta.root_task_type, repickMeta.root_task_id)
      : null;
    const parentOrderNumber = repickMeta
      ? await resolveTaskOrderNumber(prisma, repickMeta.parent_task_type, repickMeta.parent_task_id)
      : null;

    const preparedCurrentLine = remainingLines[0] || null;
    if (preparedCurrentLine?.candidate_source_location_id) {
      await prisma.transfer_order_items.update({
        where: { id: preparedCurrentLine.line_id },
        data: {
          from_location_id: preparedCurrentLine.candidate_source_location_id,
        },
      });
    }

    return res.json({
      task_type: 'transfer',
      task_id: order.id,
      order_number: order.transfer_number,
      order_type: repickMeta ? 'WAREHOUSE_TRANSFER_REPICK' : 'WAREHOUSE_TRANSFER',
      task_class: getTaskClassFromNote(order.note),
      repick_sequence: repickMeta?.repick_sequence || null,
      repick_reason: repickMeta?.repick_reason || null,
      root_task_type: repickMeta?.root_task_type || null,
      root_task_id: repickMeta?.root_task_id || null,
      root_order_number: rootOrderNumber,
      parent_task_type: repickMeta?.parent_task_type || null,
      parent_task_id: repickMeta?.parent_task_id || null,
      parent_order_number: parentOrderNumber,
      status: order.status,
      source_warehouse_id: order.from_warehouse_id,
      source_warehouse_code: order.warehouses_transfer_orders_from_warehouse_idTowarehouses?.code || null,
      source_warehouse_name: order.warehouses_transfer_orders_from_warehouse_idTowarehouses?.name || null,
      target_warehouse_id: order.to_warehouse_id,
      target_warehouse_code: order.warehouses_transfer_orders_to_warehouse_idTowarehouses?.code || null,
      target_warehouse_name: order.warehouses_transfer_orders_to_warehouse_idTowarehouses?.name || null,
      assigned_picker_user_id: parseId(order.shipped_by_user_id),
      requested_at: order.requested_at,
      completed_at: order.shipped_at || null,
      lines,
      current_line: preparedCurrentLine,
      remaining_line_count: remainingLines.length,
      remaining_quantity: remainingLines.reduce((sum, line) => sum + line.remaining_qty, 0),
    });
  } catch (error) {
    console.error('Error while loading picking task detail:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}

async function confirmPickerPresence(req, res) {
  const taskType = normalizeTaskType(req.params.taskType);
  const taskId = parseId(req.params.taskId);
  const scannedLocation = normalizeText(req.body?.current_location_input);

  if (!taskType || !taskId || !scannedLocation) {
    return res.status(400).json({ message: 'taskType, taskId and current_location_input are required' });
  }

  try {
    const task = await getTaskWarehouse(taskType, taskId);
    if (!task) {
      return res.status(404).json({ message: 'Task not found' });
    }

    if (!canAccessTask(req.user || {}, task.assigned_picker_user_id)) {
      return res.status(403).json({ message: 'Forbidden' });
    }

    const locationOrFilters = [
      { location_code: scannedLocation },
      { barcode: scannedLocation },
    ];

    if (isUuid(scannedLocation)) {
      locationOrFilters.unshift({ id: scannedLocation });
    }

    const location = await prisma.locations.findFirst({
      where: {
        warehouse_id: task.warehouse_id,
        is_active: true,
        OR: locationOrFilters,
      },
      select: {
        id: true,
        location_code: true,
        location_type: true,
        barcode: true,
      },
    });

    if (!location) {
      return res.status(400).json({
        message: 'Current location does not belong to task warehouse or is inactive',
      });
    }

    await prisma.inventory_audit_logs.create({
      data: {
        actor_user_id: parseId(req.user?.id),
        action_name: 'PICK_PRESENCE_CONFIRMED',
        entity_type: task.entity_type,
        entity_id: taskId,
        after_data: {
          task_type: taskType,
          task_id: taskId,
          location_id: location.id,
          location_code: location.location_code,
          input: scannedLocation,
        },
      },
    });

    return res.json({
      message: 'Presence confirmed',
      data: {
        location_id: location.id,
        location_code: location.location_code,
        location_type: location.location_type,
      },
    });
  } catch (error) {
    console.error('Error while confirming picker presence:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}

async function lookupVariantByBarcode(req, res) {
  const barcode = normalizeText(req.query.barcode);

  if (!barcode) {
    return res.status(400).json({ message: 'barcode is required' });
  }

  try {
    const matches = await resolveVariantMatchesByBarcode(prisma, barcode);

    if (matches.length === 0) {
      return res.status(404).json({ message: 'No variant matched barcode' });
    }

    const topPriority = matches[0].match_priority;
    const top = matches.filter((item) => item.match_priority === topPriority);

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
    console.error('Error while lookup variant barcode in picking:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}

async function getTaskWarehouse(taskType, taskId) {
  if (taskType === 'outbound') {
    const order = await prisma.outbound_orders.findUnique({
      where: { id: taskId },
      select: {
        id: true,
        warehouse_id: true,
        processed_by_user_id: true,
      },
    });

    if (!order) return null;

    return {
      warehouse_id: order.warehouse_id,
      assigned_picker_user_id: order.processed_by_user_id,
      entity_type: 'OUTBOUND_ORDER',
    };
  }

  const order = await prisma.transfer_orders.findUnique({
    where: { id: taskId },
    select: {
      id: true,
      from_warehouse_id: true,
      shipped_by_user_id: true,
    },
  });

  if (!order) return null;

  return {
    warehouse_id: order.from_warehouse_id,
    assigned_picker_user_id: order.shipped_by_user_id,
    entity_type: 'TRANSFER_ORDER',
  };
}

async function resolveExpectedSourceLocation(tx, taskType, line, warehouseId) {
  const currentLocationId = taskType === 'outbound' ? line.source_location_id : line.from_location_id;

  if (currentLocationId) {
    const location = await tx.locations.findUnique({
      where: { id: currentLocationId },
      select: {
        id: true,
        warehouse_id: true,
        location_code: true,
        barcode: true,
        location_type: true,
        is_active: true,
      },
    });

    if (!location || !location.is_active || location.warehouse_id !== warehouseId) {
      return { invalid: true, message: 'Source location is invalid for this warehouse' };
    }

    const fixedBalance = await tx.stock_balances.findUnique({
      where: {
        variant_id_location_id: {
          variant_id: line.variant_id,
          location_id: currentLocationId,
        },
      },
      select: {
        available_qty: true,
      },
    });

    if (Number(fixedBalance?.available_qty || 0) > 0) {
      return { location };
    }

    // Current source location is depleted. Re-resolve to any pickable location with stock.
    const fallbackBalance = await tx.stock_balances.findFirst({
      where: {
        warehouse_id: warehouseId,
        variant_id: line.variant_id,
        available_qty: { gt: 0 },
        locations: {
          is_active: true,
          is_pickable: true,
        },
      },
      include: {
        locations: {
          select: {
            id: true,
            warehouse_id: true,
            location_code: true,
            barcode: true,
            location_type: true,
            is_active: true,
          },
        },
      },
      orderBy: [
        { available_qty: 'desc' },
        { locations: { location_code: 'asc' } },
      ],
    });

    if (!fallbackBalance || !fallbackBalance.locations) {
      return { invalid: true, message: 'No pickable source location has available stock for this line' };
    }

    if (taskType === 'outbound') {
      await tx.outbound_order_items.update({
        where: { id: line.id },
        data: {
          source_location_id: fallbackBalance.location_id,
        },
      });
    } else {
      await tx.transfer_order_items.update({
        where: { id: line.id },
        data: {
          from_location_id: fallbackBalance.location_id,
        },
      });
    }

    return {
      location: {
        id: fallbackBalance.locations.id,
        warehouse_id: fallbackBalance.locations.warehouse_id,
        location_code: fallbackBalance.locations.location_code,
        barcode: fallbackBalance.locations.barcode,
        location_type: fallbackBalance.locations.location_type,
        is_active: fallbackBalance.locations.is_active,
      },
    };
  }

  const balance = await tx.stock_balances.findFirst({
    where: {
      warehouse_id: warehouseId,
      variant_id: line.variant_id,
      available_qty: { gt: 0 },
      locations: {
        is_active: true,
        is_pickable: true,
      },
    },
    include: {
      locations: {
        select: {
          id: true,
          warehouse_id: true,
          location_code: true,
          barcode: true,
          location_type: true,
          is_active: true,
        },
      },
    },
    orderBy: [
      { available_qty: 'desc' },
      { locations: { location_code: 'asc' } },
    ],
  });

  if (!balance || !balance.locations) {
    return { invalid: true, message: 'No pickable source location has available stock for this line' };
  }

  if (taskType === 'outbound') {
    await tx.outbound_order_items.update({
      where: { id: line.id },
      data: {
        source_location_id: balance.location_id,
      },
    });
  } else {
    await tx.transfer_order_items.update({
      where: { id: line.id },
      data: {
        from_location_id: balance.location_id,
      },
    });
  }

  return {
    location: {
      id: balance.locations.id,
      warehouse_id: balance.locations.warehouse_id,
      location_code: balance.locations.location_code,
      barcode: balance.locations.barcode,
      location_type: balance.locations.location_type,
      is_active: balance.locations.is_active,
    },
  };
}

async function confirmPickingLine(req, res) {
  const taskType = normalizeTaskType(req.params.taskType);
  const taskId = parseId(req.params.taskId);
  const lineId = parseId(req.params.lineId);

  const quantity = toInt(req.body?.quantity);
  const scannedLocationInput = normalizeText(req.body?.scanned_location_input);
  const scannedProductBarcode = normalizeText(req.body?.scanned_product_barcode);
  const scannedVariantId = parseId(req.body?.scanned_variant_id);

  if (!taskType || !taskId || !lineId) {
    return res.status(400).json({ message: 'Invalid task type, task id or line id' });
  }

  if (quantity === null || quantity <= 0) {
    return res.status(400).json({ message: 'quantity must be > 0' });
  }

  if (!scannedLocationInput) {
    return res.status(400).json({ message: 'scanned_location_input is required' });
  }

  if (!scannedProductBarcode && !scannedVariantId) {
    return res.status(400).json({ message: 'scanned_product_barcode or scanned_variant_id is required' });
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const scope = getTaskPermissionScope(req.user || {});
      if (!scope.currentUserId) {
        return { invalid: true, statusCode: 401, message: 'Invalid current user context' };
      }

      if (taskType === 'outbound') {
        await tx.$queryRawUnsafe('SELECT id FROM outbound_orders WHERE id = $1::uuid FOR UPDATE', taskId);
        await tx.$queryRawUnsafe('SELECT id FROM outbound_order_items WHERE id = $1::uuid FOR UPDATE', lineId);

        const order = await tx.outbound_orders.findUnique({
          where: { id: taskId },
          select: {
            id: true,
            outbound_number: true,
            status: true,
            warehouse_id: true,
            requested_by_user_id: true,
            processed_by_user_id: true,
            note: true,
          },
        });

        if (!order) return { invalid: true, statusCode: 404, message: 'Outbound order not found' };
        if (!OUTBOUND_READY_STATUS.includes(order.status)) {
          return { invalid: true, statusCode: 400, message: 'Outbound order is not ready for picking' };
        }

        if (order.processed_by_user_id && order.processed_by_user_id !== scope.currentUserId && !scope.canManageAssignment) {
          return { invalid: true, statusCode: 403, message: 'Task is assigned to another picker' };
        }

        if (!order.processed_by_user_id) {
          await tx.outbound_orders.update({
            where: { id: order.id },
            data: {
              processed_by_user_id: scope.currentUserId,
              status: 'PICKING',
            },
          });
        }

        const line = await tx.outbound_order_items.findFirst({
          where: {
            id: lineId,
            outbound_order_id: taskId,
          },
          select: {
            id: true,
            outbound_order_id: true,
            variant_id: true,
            source_location_id: true,
            quantity: true,
            processed_qty: true,
            note: true,
          },
        });

        if (!line) {
          return { invalid: true, statusCode: 404, message: 'Line not found in outbound task' };
        }

        const requestedQty = Number(line.quantity || 0);
        const pickedQty = Number(line.processed_qty || 0);
        const currentShortPickedQty = getLineShortPickedQty(line.note);
        const remainingQty = calculateLineRemaining(requestedQty, pickedQty, line.note);

        if (remainingQty <= 0) {
          return { invalid: true, statusCode: 409, message: 'Line is already fully picked' };
        }

        if (quantity > remainingQty) {
          return { invalid: true, statusCode: 400, message: 'quantity exceeds line remaining quantity' };
        }

        const resolvedLocation = await resolveExpectedSourceLocation(tx, taskType, line, order.warehouse_id);
        if (resolvedLocation.invalid) {
          return { invalid: true, statusCode: 400, message: resolvedLocation.message };
        }

        const expectedLocation = resolvedLocation.location;

        if (!findExpectedLocationMatch(scannedLocationInput, expectedLocation)) {
          await tx.inventory_audit_logs.create({
            data: {
              actor_user_id: scope.currentUserId,
              action_name: 'PICK_SCAN_LOCATION_INVALID',
              entity_type: 'OUTBOUND_ORDER',
              entity_id: taskId,
              after_data: {
                line_id: lineId,
                expected_location_id: expectedLocation.id,
                expected_location_code: expectedLocation.location_code,
                scanned_input: scannedLocationInput,
              },
            },
          });

          return { invalid: true, statusCode: 400, message: `Sai vi tri. Can scan ${expectedLocation.location_code}` };
        }

        if (scannedVariantId && scannedVariantId !== line.variant_id) {
          await tx.inventory_audit_logs.create({
            data: {
              actor_user_id: scope.currentUserId,
              action_name: 'PICK_SCAN_PRODUCT_INVALID',
              entity_type: 'OUTBOUND_ORDER',
              entity_id: taskId,
              after_data: {
                line_id: lineId,
                expected_variant_id: line.variant_id,
                scanned_variant_id: scannedVariantId,
              },
            },
          });

          return { invalid: true, statusCode: 400, message: 'Sai san pham cho line hien tai' };
        }

        if (scannedProductBarcode) {
          const matches = await resolveVariantMatchesByBarcode(tx, scannedProductBarcode);

          if (matches.length === 0) {
            return { invalid: true, statusCode: 400, message: 'Barcode san pham khong hop le' };
          }

          if (matches.length > 1) {
            return {
              invalid: true,
              statusCode: 400,
              code: 'AMBIGUOUS_PRODUCT',
              message: 'Barcode trung nhieu SKU, vui long chon dung san pham',
            };
          }

          const matchedVariant = matches[0];
          if (matchedVariant.variant_id !== line.variant_id) {
            await tx.inventory_audit_logs.create({
              data: {
                actor_user_id: scope.currentUserId,
                action_name: 'PICK_SCAN_PRODUCT_INVALID',
                entity_type: 'OUTBOUND_ORDER',
                entity_id: taskId,
                after_data: {
                  line_id: lineId,
                  expected_variant_id: line.variant_id,
                  scanned_variant_id: matchedVariant.variant_id,
                  scanned_barcode: scannedProductBarcode,
                },
              },
            });

            return { invalid: true, statusCode: 400, message: 'Sai san pham cho line hien tai' };
          }
        }

        await tx.$queryRawUnsafe(
          'SELECT id FROM stock_balances WHERE variant_id = $1::uuid AND location_id = $2::uuid FOR UPDATE',
          line.variant_id,
          expectedLocation.id,
        );

        const stockBalance = await tx.stock_balances.findUnique({
          where: {
            variant_id_location_id: {
              variant_id: line.variant_id,
              location_id: expectedLocation.id,
            },
          },
          select: {
            id: true,
            available_qty: true,
            on_hand_qty: true,
            version: true,
          },
        });

        if (!stockBalance || Number(stockBalance.available_qty || 0) < quantity || Number(stockBalance.on_hand_qty || 0) < quantity) {
          return {
            invalid: true,
            statusCode: 409,
            code: 'CONCURRENCY_CONFLICT',
            message: 'So luong available da thay doi. Vui long reload va thao tac lai.',
          };
        }

        const shippingLocation = await resolveOrCreateWarehouseLocation(
          tx,
          order.warehouse_id,
          SHIPPING_LOCATION_TYPE,
          'SHIPPING',
          false,
        );

        await tx.$queryRawUnsafe(
          'SELECT id FROM stock_balances WHERE variant_id = $1::uuid AND location_id = $2::uuid FOR UPDATE',
          line.variant_id,
          shippingLocation.id,
        );

        await tx.stock_balances.update({
          where: {
            variant_id_location_id: {
              variant_id: line.variant_id,
              location_id: expectedLocation.id,
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
              variant_id: line.variant_id,
              location_id: shippingLocation.id,
            },
          },
          update: {
            on_hand_qty: { increment: quantity },
            version: { increment: 1 },
            last_movement_at: new Date(),
          },
          create: {
            warehouse_id: order.warehouse_id,
            variant_id: line.variant_id,
            location_id: shippingLocation.id,
            on_hand_qty: quantity,
            available_qty: 0,
            version: 1,
            last_movement_at: new Date(),
          },
        });

        const shortageDelta = Math.max(remainingQty - quantity, 0);
        const nextShortPickedQty = currentShortPickedQty + shortageDelta;
        const nextLineNote = shortageDelta > 0
          ? withLineShortPickedQty(line.note, nextShortPickedQty)
          : (line.note || null);

        await tx.outbound_order_items.update({
          where: { id: line.id },
          data: {
            processed_qty: { increment: quantity },
            note: nextLineNote,
          },
        });

        await tx.stock_movements.create({
          data: {
            movement_number: createMovementNumber(Date.now(), 0),
            movement_type: 'TRANSFER',
            movement_status: 'POSTED',
            warehouse_id: order.warehouse_id,
            variant_id: line.variant_id,
            from_location_id: expectedLocation.id,
            to_location_id: shippingLocation.id,
            quantity,
            unit_cost: 0,
            source_service: 'INVENTORY_SERVICE',
            reference_type: 'OUTBOUND_PICKING',
            reference_id: order.id,
            created_by_user_id: scope.currentUserId,
            metadata: {
              task_type: 'outbound',
              task_id: taskId,
              line_id: line.id,
              stage: 'PICK_TO_SHIPPING',
              scanned_location_input: scannedLocationInput,
              scanned_product_barcode: scannedProductBarcode,
              scanned_variant_id: scannedVariantId,
            },
          },
        });

        const allLines = await tx.outbound_order_items.findMany({
          where: { outbound_order_id: order.id },
          select: {
            id: true,
            variant_id: true,
            source_location_id: true,
            quantity: true,
            processed_qty: true,
            note: true,
          },
        });

        const allDone = allLines.every((item) => calculateLineRemaining(item.quantity, item.processed_qty, item.note) <= 0);
        let repickInfo = null;

        if (allDone) {
          await tx.outbound_orders.update({
            where: { id: order.id },
            data: {
              status: 'READY_FOR_OUTBOUND',
              processed_by_user_id: scope.currentUserId,
            },
          });

          repickInfo = await maybeCreateRepickFromOutbound(tx, order, allLines, scope.currentUserId);
        } else if (order.status !== 'PICKING') {
          await tx.outbound_orders.update({
            where: { id: order.id },
            data: {
              status: 'PICKING',
              processed_by_user_id: scope.currentUserId,
            },
          });
        }

        await tx.inventory_audit_logs.create({
          data: {
            actor_user_id: scope.currentUserId,
            action_name: 'PICK_LINE_CONFIRMED',
            entity_type: 'OUTBOUND_ORDER',
            entity_id: taskId,
            after_data: {
              line_id: lineId,
              quantity,
              short_pick_qty_added: shortageDelta,
              expected_location_id: expectedLocation.id,
              expected_location_code: expectedLocation.location_code,
              all_done: allDone,
              repick_task_id: repickInfo?.task_id || null,
            },
          },
        });

        return {
          data: {
            task_type: 'outbound',
            task_id: order.id,
            line_id: line.id,
            confirmed_quantity: quantity,
            line_remaining_quantity: Math.max(remainingQty - quantity - shortageDelta, 0),
            short_pick_recorded: shortageDelta,
            task_completed: allDone,
            repick_created: repickInfo,
          },
        };
      }

      await tx.$queryRawUnsafe('SELECT id FROM transfer_orders WHERE id = $1::uuid FOR UPDATE', taskId);
      await tx.$queryRawUnsafe('SELECT id FROM transfer_order_items WHERE id = $1::uuid FOR UPDATE', lineId);

      const order = await tx.transfer_orders.findUnique({
        where: { id: taskId },
        select: {
          id: true,
          transfer_number: true,
          status: true,
          from_warehouse_id: true,
          to_warehouse_id: true,
          requested_by_user_id: true,
          shipped_by_user_id: true,
          note: true,
        },
      });

      if (!order) return { invalid: true, statusCode: 404, message: 'Transfer order not found' };
      if (!TRANSFER_READY_STATUS.includes(order.status)) {
        return { invalid: true, statusCode: 400, message: 'Transfer order is not ready for picking' };
      }

      if (order.shipped_by_user_id && order.shipped_by_user_id !== scope.currentUserId && !scope.canManageAssignment) {
        return { invalid: true, statusCode: 403, message: 'Task is assigned to another picker' };
      }

      if (!order.shipped_by_user_id) {
        await tx.transfer_orders.update({
          where: { id: order.id },
          data: {
            shipped_by_user_id: scope.currentUserId,
          },
        });
      }

      const line = await tx.transfer_order_items.findFirst({
        where: {
          id: lineId,
          transfer_order_id: taskId,
        },
        select: {
          id: true,
          transfer_order_id: true,
          variant_id: true,
          from_location_id: true,
          quantity: true,
          shipped_qty: true,
          to_location_id: true,
          note: true,
        },
      });

      if (!line) {
        return { invalid: true, statusCode: 404, message: 'Line not found in transfer task' };
      }

      const requestedQty = Number(line.quantity || 0);
      const pickedQty = Number(line.shipped_qty || 0);
      const currentShortPickedQty = getLineShortPickedQty(line.note);
      const remainingQty = calculateLineRemaining(requestedQty, pickedQty, line.note);

      if (remainingQty <= 0) {
        return { invalid: true, statusCode: 409, message: 'Line is already fully picked' };
      }

      if (quantity > remainingQty) {
        return { invalid: true, statusCode: 400, message: 'quantity exceeds line remaining quantity' };
      }

      const resolvedLocation = await resolveExpectedSourceLocation(tx, taskType, line, order.from_warehouse_id);
      if (resolvedLocation.invalid) {
        return { invalid: true, statusCode: 400, message: resolvedLocation.message };
      }

      const expectedLocation = resolvedLocation.location;

      if (!findExpectedLocationMatch(scannedLocationInput, expectedLocation)) {
        await tx.inventory_audit_logs.create({
          data: {
            actor_user_id: scope.currentUserId,
            action_name: 'PICK_SCAN_LOCATION_INVALID',
            entity_type: 'TRANSFER_ORDER',
            entity_id: taskId,
            after_data: {
              line_id: lineId,
              expected_location_id: expectedLocation.id,
              expected_location_code: expectedLocation.location_code,
              scanned_input: scannedLocationInput,
            },
          },
        });

        return { invalid: true, statusCode: 400, message: `Sai vi tri. Can scan ${expectedLocation.location_code}` };
      }

      if (scannedVariantId && scannedVariantId !== line.variant_id) {
        await tx.inventory_audit_logs.create({
          data: {
            actor_user_id: scope.currentUserId,
            action_name: 'PICK_SCAN_PRODUCT_INVALID',
            entity_type: 'TRANSFER_ORDER',
            entity_id: taskId,
            after_data: {
              line_id: lineId,
              expected_variant_id: line.variant_id,
              scanned_variant_id: scannedVariantId,
            },
          },
        });

        return { invalid: true, statusCode: 400, message: 'Sai san pham cho line hien tai' };
      }

      if (scannedProductBarcode) {
        const matches = await resolveVariantMatchesByBarcode(tx, scannedProductBarcode);

        if (matches.length === 0) {
          return { invalid: true, statusCode: 400, message: 'Barcode san pham khong hop le' };
        }

        if (matches.length > 1) {
          return {
            invalid: true,
            statusCode: 400,
            code: 'AMBIGUOUS_PRODUCT',
            message: 'Barcode trung nhieu SKU, vui long chon dung san pham',
          };
        }

        const matchedVariant = matches[0];
        if (matchedVariant.variant_id !== line.variant_id) {
          await tx.inventory_audit_logs.create({
            data: {
              actor_user_id: scope.currentUserId,
              action_name: 'PICK_SCAN_PRODUCT_INVALID',
              entity_type: 'TRANSFER_ORDER',
              entity_id: taskId,
              after_data: {
                line_id: lineId,
                expected_variant_id: line.variant_id,
                scanned_variant_id: matchedVariant.variant_id,
                scanned_barcode: scannedProductBarcode,
              },
            },
          });

          return { invalid: true, statusCode: 400, message: 'Sai san pham cho line hien tai' };
        }
      }

      await tx.$queryRawUnsafe(
        'SELECT id FROM stock_balances WHERE variant_id = $1::uuid AND location_id = $2::uuid FOR UPDATE',
        line.variant_id,
        expectedLocation.id,
      );

      const stockBalance = await tx.stock_balances.findUnique({
        where: {
          variant_id_location_id: {
            variant_id: line.variant_id,
            location_id: expectedLocation.id,
          },
        },
        select: {
          id: true,
          available_qty: true,
          on_hand_qty: true,
          version: true,
        },
      });

      if (!stockBalance || Number(stockBalance.available_qty || 0) < quantity || Number(stockBalance.on_hand_qty || 0) < quantity) {
        return {
          invalid: true,
          statusCode: 409,
          code: 'CONCURRENCY_CONFLICT',
          message: 'So luong available da thay doi. Vui long reload va thao tac lai.',
        };
      }

      const shippingLocation = await resolveOrCreateWarehouseLocation(
        tx,
        order.from_warehouse_id,
        SHIPPING_LOCATION_TYPE,
        'SHIPPING',
        false,
      );

      await tx.$queryRawUnsafe(
        'SELECT id FROM stock_balances WHERE variant_id = $1::uuid AND location_id = $2::uuid FOR UPDATE',
        line.variant_id,
        shippingLocation.id,
      );

      await tx.stock_balances.update({
        where: {
          variant_id_location_id: {
            variant_id: line.variant_id,
            location_id: expectedLocation.id,
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
            variant_id: line.variant_id,
            location_id: shippingLocation.id,
          },
        },
        update: {
          on_hand_qty: { increment: quantity },
          version: { increment: 1 },
          last_movement_at: new Date(),
        },
        create: {
          warehouse_id: order.from_warehouse_id,
          variant_id: line.variant_id,
          location_id: shippingLocation.id,
          on_hand_qty: quantity,
          available_qty: 0,
          version: 1,
          last_movement_at: new Date(),
        },
      });

      const shortageDelta = Math.max(remainingQty - quantity, 0);
      const nextShortPickedQty = currentShortPickedQty + shortageDelta;
      const nextLineNote = shortageDelta > 0
        ? withLineShortPickedQty(line.note, nextShortPickedQty)
        : (line.note || null);

      await tx.transfer_order_items.update({
        where: { id: line.id },
        data: {
          shipped_qty: { increment: quantity },
          note: nextLineNote,
        },
      });

      await tx.stock_movements.create({
        data: {
          movement_number: createMovementNumber(Date.now(), 0),
          movement_type: 'TRANSFER',
          movement_status: 'POSTED',
          warehouse_id: order.from_warehouse_id,
          variant_id: line.variant_id,
          from_location_id: expectedLocation.id,
          to_location_id: shippingLocation.id,
          quantity,
          unit_cost: 0,
          source_service: 'INVENTORY_SERVICE',
          reference_type: 'TRANSFER_PICKING',
          reference_id: order.id,
          created_by_user_id: scope.currentUserId,
          metadata: {
            task_type: 'transfer',
            task_id: taskId,
            line_id: line.id,
            stage: 'PICK_TO_SHIPPING',
            scanned_location_input: scannedLocationInput,
            scanned_product_barcode: scannedProductBarcode,
            scanned_variant_id: scannedVariantId,
          },
        },
      });

      const allLines = await tx.transfer_order_items.findMany({
        where: { transfer_order_id: order.id },
        select: {
          id: true,
          variant_id: true,
          from_location_id: true,
          to_location_id: true,
          quantity: true,
          shipped_qty: true,
          note: true,
        },
      });

      const allDone = allLines.every((item) => calculateLineRemaining(item.quantity, item.shipped_qty, item.note) <= 0);
      let repickInfo = null;

      if (allDone) {
        await tx.transfer_orders.update({
          where: { id: order.id },
          data: {
            status: 'READY_FOR_OUTBOUND',
            shipped_by_user_id: scope.currentUserId,
          },
        });

        repickInfo = await maybeCreateRepickFromTransfer(tx, order, allLines, scope.currentUserId);
      } else if (order.status !== 'PICKING') {
        await tx.transfer_orders.update({
          where: { id: order.id },
          data: {
            status: 'PICKING',
            shipped_by_user_id: scope.currentUserId,
          },
        });
      }

      await tx.inventory_audit_logs.create({
        data: {
          actor_user_id: scope.currentUserId,
          action_name: 'PICK_LINE_CONFIRMED',
          entity_type: 'TRANSFER_ORDER',
          entity_id: taskId,
          after_data: {
            line_id: lineId,
            quantity,
            short_pick_qty_added: shortageDelta,
            expected_location_id: expectedLocation.id,
            expected_location_code: expectedLocation.location_code,
            all_done: allDone,
            repick_task_id: repickInfo?.task_id || null,
          },
        },
      });

      return {
        data: {
          task_type: 'transfer',
          task_id: order.id,
          line_id: line.id,
          confirmed_quantity: quantity,
          line_remaining_quantity: Math.max(remainingQty - quantity - shortageDelta, 0),
          short_pick_recorded: shortageDelta,
          task_completed: allDone,
          repick_created: repickInfo,
        },
      };
    }, { isolationLevel: 'Serializable' });

    if (result.invalid) {
      return res.status(result.statusCode || 400).json({
        message: result.message,
        ...(result.code ? { code: result.code } : {}),
      });
    }

    return res.status(201).json({
      message: 'Picking line confirmed',
      data: result.data,
    });
  } catch (error) {
    if (toSerializableError(error)) {
      return res.status(409).json({
        message: 'Data changed during confirmation. Please reload and try again.',
        code: 'CONCURRENCY_CONFLICT',
      });
    }

    console.error('Error while confirming picking line:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}

async function cancelTransferReturn(req, res) {
  const taskId = parseId(req.params.taskId);
  const reason = normalizeText(req.body?.reason);
  const actorUserId = parseId(req.user?.id);

  if (!taskId) {
    return res.status(400).json({ message: 'Invalid transfer task id' });
  }

  if (!actorUserId) {
    return res.status(401).json({ message: 'Invalid current user context' });
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      await tx.$queryRawUnsafe('SELECT id FROM transfer_orders WHERE id = $1::uuid FOR UPDATE', taskId);

      const order = await tx.transfer_orders.findUnique({
        where: { id: taskId },
        select: {
          id: true,
          status: true,
          from_warehouse_id: true,
          note: true,
        },
      });

      if (!order) {
        return { invalid: true, statusCode: 404, message: 'Transfer order not found' };
      }

      if (order.status !== 'READY_FOR_OUTBOUND') {
        return { invalid: true, statusCode: 400, message: 'Only READY_FOR_OUTBOUND transfer can be cancelled for return' };
      }

      const lines = await tx.transfer_order_items.findMany({
        where: { transfer_order_id: order.id },
        select: {
          id: true,
          variant_id: true,
          shipped_qty: true,
        },
      });

      const activeLines = lines.filter((line) => Number(line.shipped_qty || 0) > 0);
      if (activeLines.length === 0) {
        return { invalid: true, statusCode: 409, message: 'No picked quantity found in transfer order' };
      }

      const shippingLocation = await resolveOrCreateWarehouseLocation(
        tx,
        order.from_warehouse_id,
        SHIPPING_LOCATION_TYPE,
        'SHIPPING',
        false,
      );

      const receivingLocation = await resolveOrCreateWarehouseLocation(
        tx,
        order.from_warehouse_id,
        RECEIVING_LOCATION_TYPES,
        'RECEIVING',
        false,
      );

      const moveEntries = [];

      for (const line of activeLines) {
        const qty = Number(line.shipped_qty || 0);

        await tx.$queryRawUnsafe(
          'SELECT id FROM stock_balances WHERE variant_id = $1::uuid AND location_id = $2::uuid FOR UPDATE',
          line.variant_id,
          shippingLocation.id,
        );

        await tx.$queryRawUnsafe(
          'SELECT id FROM stock_balances WHERE variant_id = $1::uuid AND location_id = $2::uuid FOR UPDATE',
          line.variant_id,
          receivingLocation.id,
        );

        const shippingBalance = await tx.stock_balances.findUnique({
          where: {
            variant_id_location_id: {
              variant_id: line.variant_id,
              location_id: shippingLocation.id,
            },
          },
          select: {
            on_hand_qty: true,
          },
        });

        if (!shippingBalance || Number(shippingBalance.on_hand_qty || 0) < qty) {
          return {
            invalid: true,
            statusCode: 409,
            code: 'CONCURRENCY_CONFLICT',
            message: 'Shipping stock changed. Please reload and retry cancel return.',
          };
        }

        await tx.stock_balances.update({
          where: {
            variant_id_location_id: {
              variant_id: line.variant_id,
              location_id: shippingLocation.id,
            },
          },
          data: {
            on_hand_qty: { decrement: qty },
            version: { increment: 1 },
            last_movement_at: new Date(),
          },
        });

        await tx.stock_balances.upsert({
          where: {
            variant_id_location_id: {
              variant_id: line.variant_id,
              location_id: receivingLocation.id,
            },
          },
          update: {
            on_hand_qty: { increment: qty },
            available_qty: 0,
            version: { increment: 1 },
            last_movement_at: new Date(),
          },
          create: {
            warehouse_id: order.from_warehouse_id,
            variant_id: line.variant_id,
            location_id: receivingLocation.id,
            on_hand_qty: qty,
            available_qty: 0,
            version: 1,
            last_movement_at: new Date(),
          },
        });

        await tx.transfer_order_items.update({
          where: { id: line.id },
          data: {
            shipped_qty: 0,
          },
        });

        moveEntries.push({
          variant_id: line.variant_id,
          quantity: qty,
        });
      }

      const baseTimestamp = Date.now();
      await tx.stock_movements.createMany({
        data: moveEntries.map((entry, index) => ({
          movement_number: createMovementNumber(baseTimestamp, index),
          movement_type: 'TRANSFER',
          movement_status: 'POSTED',
          warehouse_id: order.from_warehouse_id,
          variant_id: entry.variant_id,
          from_location_id: shippingLocation.id,
          to_location_id: receivingLocation.id,
          quantity: entry.quantity,
          unit_cost: 0,
          source_service: 'INVENTORY_SERVICE',
          reference_type: 'TRANSFER_CANCEL_RETURN',
          reference_id: order.id,
          created_by_user_id: actorUserId,
          metadata: {
            stage: 'CANCEL_RETURN',
            reason,
          },
        })),
      });

      await tx.transfer_orders.update({
        where: { id: order.id },
        data: {
          status: 'CANCELLED',
          note: appendOrderNote(order.note, 'CANCEL_RETURN', reason || 'Cancelled before outbound'),
        },
      });

      await tx.inventory_audit_logs.create({
        data: {
          actor_user_id: actorUserId,
          action_name: 'TRANSFER_CANCEL_RETURN',
          entity_type: 'TRANSFER_ORDER',
          entity_id: order.id,
          after_data: {
            status: 'CANCELLED',
            reason,
            shipping_location_id: shippingLocation.id,
            receiving_location_id: receivingLocation.id,
            returned_line_count: moveEntries.length,
          },
        },
      });

      return {
        data: {
          task_type: 'transfer',
          task_id: order.id,
          status: 'CANCELLED',
          returned_line_count: moveEntries.length,
        },
      };
    }, { isolationLevel: 'Serializable' });

    if (result.invalid) {
      return res.status(result.statusCode || 400).json({
        message: result.message,
        ...(result.code ? { code: result.code } : {}),
      });
    }

    return res.json({
      message: 'Cancel return completed: stock moved from SHIPPING to RECEIVING',
      data: result.data,
    });
  } catch (error) {
    if (toSerializableError(error)) {
      return res.status(409).json({
        message: 'Data changed during cancel return. Please reload and try again.',
        code: 'CONCURRENCY_CONFLICT',
      });
    }

    console.error('Error while cancelling transfer for return:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}

module.exports = {
  listPickingTasks,
  claimPickingTask,
  getPickingTaskDetail,
  confirmPickerPresence,
  lookupVariantByBarcode,
  confirmPickingLine,
  cancelTransferReturn,
};
