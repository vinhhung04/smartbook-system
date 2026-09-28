const FIELDS = ['title', 'subtitle', 'authors', 'translator', 'publisher', 'categories', 'language', 'publishedDate', 'pageCount', 'coverFormat', 'description', 'isbn'];

function bad(message) { const error = new Error(message); error.statusCode = 400; throw error; }

function partialDate(value) {
  if (value === null || value === '') return { value: null, precision: null, date: null };
  if (typeof value !== 'string' || !/^\d{4}(-\d{2})?(-\d{2})?$/.test(value)) bad('Invalid publication date');
  const [y, m, d] = value.split('-').map(Number);
  if (y < 1000 || y > 2999 || (m !== undefined && (m < 1 || m > 12))) bad('Invalid publication date');
  const date = d === undefined ? null : new Date(`${value}T00:00:00.000Z`);
  if (date && (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value)) bad('Invalid publication date');
  return { value, precision: d !== undefined ? 'day' : m !== undefined ? 'month' : 'year', date };
}

function validateField(field, value) {
  if (!FIELDS.includes(field)) bad('Unsupported metadata field');
  if (value == null) return;
  if (['authors', 'translator', 'categories'].includes(field)) {
    if (!Array.isArray(value) || value.length > 100 || value.some(v => typeof v !== 'string' || v.length > 500)) bad(`Invalid ${field}`);
  } else if (field === 'pageCount') {
    if (!Number.isInteger(value) || value < 1 || value > 10000) bad('Invalid page count');
  } else if (typeof value !== 'string' || value.length > (field === 'description' ? 30000 : 1000)) bad(`Invalid ${field}`);
  if (field === 'publishedDate') partialDate(value);
  if (field === 'isbn' && value && !validIsbn(value)) bad('Invalid ISBN checksum');
}

function validIsbn(value) {
  const text = String(value).replace(/[\s-]/g, '').toUpperCase();
  if (/^(978|979)\d{10}$/.test(text)) return [...text].reduce((s, c, i) => s + Number(c) * (i % 2 ? 3 : 1), 0) % 10 === 0;
  return /^\d{9}[\dX]$/.test(text) && [...text].reduce((s, c, i) => s + (c === 'X' ? 10 : Number(c)) * (10 - i), 0) % 11 === 0;
}

function validateBundle(bundle) {
  if (!bundle) return;
  if (bundle.schemaVersion !== 'metadata-intelligence-v2.1' || Buffer.byteLength(JSON.stringify(bundle)) > 1500000) bad('Invalid or oversized intelligence bundle');
  if (!Array.isArray(bundle.documents) || bundle.documents.length > 5 || !Array.isArray(bundle.candidates) || bundle.candidates.length > 1000 || !Array.isArray(bundle.evidence) || bundle.evidence.length > 2000) bad('Invalid intelligence arrays');
  const docs = new Map(bundle.documents.map(d => [d.id, d]));
  const evidence = new Map(bundle.evidence.map(e => [e.id, e]));
  const candidates = new Map(bundle.candidates.map(c => [c.id, c]));
  if (docs.size !== bundle.documents.length || evidence.size !== bundle.evidence.length || candidates.size !== bundle.candidates.length) bad('Duplicate intelligence ID');
  for (const c of candidates.values()) {
    if (!docs.has(c.sourceDocumentId) || !Array.isArray(c.evidenceIds) || c.evidenceIds.some(id => !evidence.has(id))) bad('Broken candidate reference');
    if (c.field !== 'thumbnail') validateField(c.field, c.normalizedValue);
  }
  for (const e of evidence.values()) {
    const doc = docs.get(e.sourceDocumentId);
    if (!doc || e.snapshotHash !== doc.snapshotHash) bad('Broken evidence reference');
    if (e.kind === 'TEXT_SPAN' && e.locatorValid) {
      if (!Number.isInteger(e.start) || !Number.isInteger(e.end) || e.start < 0 || e.end <= e.start || [...String(doc.cleanText)].slice(e.start, e.end).join('') !== e.quote) bad('Invalid evidence span');
    }
  }
  if (!bundle.decisions || !bundle.provenance) bad('Missing field decisions');
  for (const [field, d] of Object.entries(bundle.decisions)) {
    if (field !== 'thumbnail') validateField(field, d.proposedValue);
    if (!Array.isArray(d.selectedCandidateIds) || d.selectedCandidateIds.some(id => !candidates.has(id) || candidates.get(id).field !== field)) bad('Broken decision reference');
  }
}

function reviewEvent(field, before, after, actorId, status) {
  return { stage: 'HUMAN_REVIEW', actorType: 'HUMAN', actorId, field,
    action: status === 'REJECTED' ? 'REJECTED' : JSON.stringify(before) === JSON.stringify(after) ? 'ACCEPTED' : 'EDITED',
    before, after, createdAt: new Date().toISOString() };
}

function assertReady(draft) {
  const pending = draft.decisions.filter(d => d.status === 'PENDING').map(d => d.field);
  if (pending.length) { const error = new Error(`Review required: ${pending.join(', ')}`); error.statusCode = 409; throw error; }
}

module.exports = { FIELDS, validateBundle, validateField, validIsbn, partialDate, reviewEvent, assertReady };
