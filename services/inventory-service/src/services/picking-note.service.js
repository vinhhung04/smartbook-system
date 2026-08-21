const REPICK_META_MARKER = 'REPICK_META';
const REPICK_LINE_MARKER = 'REPICK_LINE';
const SHORT_PICK_MARKER = 'SHORT_PICK';

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

  return entries.length === 0 ? `[${marker}]` : `[${marker}] ${entries.join(';')}`;
}

function parseMarkerPayload(note, marker) {
  const prefix = `[${marker}]`;
  const line = String(note || '').split('\n').map((item) => item.trim()).find((item) => item.startsWith(prefix));
  if (!line) return null;

  const rawPayload = line.slice(prefix.length).trim();
  if (!rawPayload) return {};

  const parsed = {};
  rawPayload.split(';').map((item) => item.trim()).filter(Boolean).forEach((entry) => {
    const separatorIndex = entry.indexOf('=');
    if (separatorIndex <= 0) return;
    const key = entry.slice(0, separatorIndex).trim();
    if (key) parsed[key] = decodeMetaValue(entry.slice(separatorIndex + 1).trim());
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
      if (!replaced) next.push(markerLine);
      replaced = true;
    } else {
      next.push(line);
    }
  });
  if (!replaced) next.push(markerLine);
  return next.join('\n');
}

function parsePositiveInt(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.trunc(number));
}

function parseRepickMeta(note) {
  const payload = parseMarkerPayload(note, REPICK_META_MARKER);
  if (!payload) return null;

  const rootTaskType = String(payload.root_task_type || '').trim();
  const rootTaskId = String(payload.root_task_id || '').trim();
  const parentTaskType = String(payload.parent_task_type || '').trim();
  const parentTaskId = String(payload.parent_task_id || '').trim();
  if (!rootTaskType || !rootTaskId || !parentTaskType || !parentTaskId) return null;

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
  return payload ? parsePositiveInt(payload.qty) : 0;
}

function withLineShortPickedQty(note, quantity) {
  return upsertMarkerLine(note, SHORT_PICK_MARKER, { qty: parsePositiveInt(quantity) });
}

function calculateLineRemaining(quantity, pickedQuantity) {
  const requested = Math.max(0, Number(quantity || 0));
  const picked = Math.max(0, Number(pickedQuantity || 0));
  return Math.max(requested - picked, 0);
}

function getTaskClassFromNote(note) {
  return parseRepickMeta(note) ? 'REPICK' : 'PICK';
}

module.exports = {
  REPICK_META_MARKER,
  REPICK_LINE_MARKER,
  SHORT_PICK_MARKER,
  normalizeCode,
  appendOrderNote,
  buildMarkerLine,
  parseMarkerPayload,
  upsertMarkerLine,
  parseRepickMeta,
  parseRepickLineMeta,
  getLineShortPickedQty,
  withLineShortPickedQty,
  calculateLineRemaining,
  getTaskClassFromNote,
};
