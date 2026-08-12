const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const normalize = (v) => String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const fields = ['title', 'authors', 'publisher', 'categories', 'language', 'publishedDate', 'pageCount', 'coverFormat', 'description'];

async function createDraft(req, res) {
  const raw = req.body?.lookup || {};
  const isbn = String(raw.isbn || req.body?.isbn || '').trim();
  if (!isbn) return res.status(400).json({ message: 'isbn is required' });
  const [authors, publishers, categories] = await Promise.all([prisma.authors.findMany(), prisma.publishers.findMany(), prisma.categories.findMany()]);
  const authorValues = Array.isArray(raw.authors) ? raw.authors : [];
  const authorityMatches = {
    authors: authorValues.map((name) => authors.find((a) => normalize(a.full_name) === normalize(name)) || null),
    publisher: publishers.find((p) => normalize(p.name) === normalize(raw.publisher)) || null,
    categories: (raw.categories || []).map((name) => categories.find((c) => normalize(c.name) === normalize(name)) || null),
  };
  const normalized = { title: raw.title || null, authors: authorValues, publisher: raw.publisher || null, categories: authorityMatches.categories.filter(Boolean).map((c) => c.name), language: String(raw.language || '').toLowerCase() || null, publishedDate: raw.publishedDate || null, pageCount: Number.isInteger(raw.pageCount) && raw.pageCount > 0 ? raw.pageCount : null, coverFormat: raw.coverFormat || null, description: raw.description || null };
  const warnings = [!normalized.title && 'Thiếu tên sách', !isbn && 'Thiếu ISBN', normalized.description && normalized.description.length < 80 && 'Mô tả quá ngắn', /<[^>]+>/.test(normalized.description || '') && 'Mô tả chứa HTML', ...(raw.conflicts || []).map((c) => `Mâu thuẫn nguồn: ${c.field}`)].filter(Boolean);
  const draft = await prisma.metadata_reconciliation_drafts.create({ data: { isbn, raw_metadata: raw, normalized_metadata: normalized, quality_warnings: warnings, authority_matches: authorityMatches, explanation: { provenance: 'EXTERNAL/RULE', note: 'Normalized using canonical authorities and internal taxonomy.' }, created_by_user_id: req.user.id, decisions: { create: fields.filter((field) => normalized[field] !== undefined).map((field) => ({ field, value: normalized[field] ?? null, provenance: 'RULE' })) } }, include: { decisions: true } });
  return res.status(201).json({ data: draft });
}
async function getDraft(req, res) { const data = await prisma.metadata_reconciliation_drafts.findUnique({ where: { id: req.params.id }, include: { decisions: true } }); return data ? res.json({ data }) : res.status(404).json({ message: 'Draft not found' }); }
async function decideField(req, res) { const { status, value } = req.body || {}; if (!['ACCEPTED', 'REJECTED'].includes(status)) return res.status(400).json({ message: 'status must be ACCEPTED or REJECTED' }); const data = await prisma.metadata_reconciliation_field_decisions.update({ where: { draft_id_field: { draft_id: req.params.id, field: req.params.field } }, data: { status, ...(value !== undefined ? { value } : {}), reviewed_by_user_id: req.user.id, reviewed_at: new Date() } }); return res.json({ data }); }
module.exports = { createDraft, getDraft, decideField };
