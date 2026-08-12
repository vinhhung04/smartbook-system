const { PrismaClient, Prisma } = require('@prisma/client');
const { canonicalKey, reconcileMetadata } = require('../services/authority-normalization.service');

const prisma = new PrismaClient();
const FIELDS = ['title', 'authors', 'publisher', 'categories', 'language', 'publishedDate', 'pageCount', 'coverFormat', 'description'];

function jsonValue(value) {
  return value === null || value === undefined ? Prisma.JsonNull : value;
}

async function readAuthorities(client = prisma) {
  const [authors, publishers, categories, authorAliases, publisherAliases] = await Promise.all([
    client.authors.findMany({ select: { id: true, full_name: true } }),
    client.publishers.findMany({ select: { id: true, name: true } }),
    client.categories.findMany({ select: { id: true, name: true } }),
    client.author_aliases.findMany({ where: { status: 'APPROVED' }, include: { authors: { select: { id: true, full_name: true } } } }),
    client.publisher_aliases.findMany({ where: { status: 'APPROVED' }, include: { publishers: { select: { id: true, name: true } } } }),
  ]);
  return { authors, publishers, categories, authorAliases, publisherAliases };
}

function rawLookup(req) {
  return req.body?.lookup || req.body?.metadata || {};
}

function explain(result, raw) {
  return {
    version: 'authority-reconciliation-v1',
    provenance: 'EXTERNAL/RULE',
    sourceEvidence: raw.fieldEvidence || {},
    rule: 'Only exact canonical or approved aliases are auto-matched; similar values require staff review.',
    authority: {
      authors: result.authorNormalization.map(({ rawValue, status, reason }) => ({ rawValue, status, reason })),
      publisher: { rawValue: result.publisherNormalization.rawValue, status: result.publisherNormalization.status, reason: result.publisherNormalization.reason },
      categories: result.categoryNormalization.map(({ rawValue, status, reason }) => ({ rawValue, status, reason })),
    },
  };
}

async function createDraft(req, res) {
  const raw = rawLookup(req);
  const isbn = String(raw.isbn || req.body?.isbn || '').trim();
  if (!isbn) return res.status(400).json({ message: 'isbn is required' });
  try {
    const result = reconcileMetadata(raw, await readAuthorities());
    const draft = await prisma.metadata_reconciliation_drafts.create({
      data: {
        isbn,
        book_id: req.body?.bookId || null,
        raw_metadata: raw,
        normalized_metadata: result.normalized,
        ai_suggestions: req.body?.aiSuggestions || {},
        quality_warnings: result.qualityWarnings,
        authority_matches: result.authorityMatches,
        explanation: explain(result, raw),
        created_by_user_id: req.user.id,
        decisions: { create: FIELDS.map((field) => ({ field, value: jsonValue(result.normalized[field]), provenance: 'RULE' })) },
      },
      include: { decisions: true },
    });
    return res.status(201).json({ data: { ...draft, normalizationSuggestions: { authorNormalization: result.authorNormalization, publisherNormalization: result.publisherNormalization, categoryNormalization: result.categoryNormalization }, qualityWarnings: result.qualityWarnings, authorityMatches: result.authorityMatches, explanation: draft.explanation } });
  } catch (error) {
    console.error('Unable to create metadata reconciliation draft', error);
    return res.status(500).json({ message: 'Unable to create metadata reconciliation draft' });
  }
}

async function getDraft(req, res) {
  try {
    const data = await prisma.metadata_reconciliation_drafts.findUnique({ where: { id: req.params.id }, include: { decisions: { orderBy: { field: 'asc' } } } });
    return data ? res.json({ data }) : res.status(404).json({ message: 'Draft not found' });
  } catch (error) {
    console.error('Unable to load metadata reconciliation draft', error);
    return res.status(500).json({ message: 'Unable to load metadata reconciliation draft' });
  }
}

async function decideField(req, res) {
  const { status, value } = req.body || {};
  const field = req.params.field;
  if (!FIELDS.includes(field)) return res.status(400).json({ message: 'Unsupported metadata field' });
  if (!['ACCEPTED', 'REJECTED'].includes(status)) return res.status(400).json({ message: 'status must be ACCEPTED or REJECTED' });
  try {
    const data = await prisma.metadata_reconciliation_field_decisions.update({
      where: { draft_id_field: { draft_id: req.params.id, field } },
      data: { status, ...(value !== undefined ? { value: jsonValue(value) } : {}), provenance: 'STAFF_APPROVED', reviewed_by_user_id: req.user.id, reviewed_at: new Date() },
    });
    return res.json({ data });
  } catch (error) {
    if (error.code === 'P2025') return res.status(404).json({ message: 'Draft or field not found' });
    console.error('Unable to decide reconciliation field', error);
    return res.status(500).json({ message: 'Unable to decide reconciliation field' });
  }
}

function safeMatchId(match) {
  return match?.matchedEntity?.id || null;
}

async function resolveRelationIds(tx, draft, accepted, createEntities) {
  const authority = draft.authority_matches || {};
  const authorMatches = Array.isArray(authority.authors) ? authority.authors : [];
  const categoryMatches = Array.isArray(authority.categories) ? authority.categories : [];
  const authors = [];
  if (accepted.authors) {
    for (let index = 0; index < accepted.authors.length; index += 1) {
      const value = accepted.authors[index];
      const matchedId = safeMatchId(authorMatches[index]);
      if (matchedId) authors.push({ id: matchedId, raw: authorMatches[index].rawValue });
      else if (createEntities.authors) {
        const existing = await tx.authors.findUnique({ where: { full_name: value } });
        const entity = existing || await tx.authors.create({ data: { full_name: value, sort_name: value } });
        authors.push({ id: entity.id, raw: value });
      }
    }
  }
  let publisherId = null;
  if (accepted.publisher) {
    publisherId = safeMatchId(authority.publisher);
    if (!publisherId && createEntities.publisher) {
      const existing = await tx.publishers.findUnique({ where: { name: accepted.publisher } });
      publisherId = (existing || await tx.publishers.create({ data: { name: accepted.publisher, code: `PUB-${Date.now()}` } })).id;
    }
  }
  const categories = [];
  if (accepted.categories) {
    for (let index = 0; index < accepted.categories.length; index += 1) {
      const value = accepted.categories[index];
      const matchedId = safeMatchId(categoryMatches[index]);
      if (matchedId) categories.push(matchedId);
      else if (createEntities.categories) {
        const slug = canonicalKey(value).replace(/\s+/g, '-');
        const existing = await tx.categories.findUnique({ where: { slug } });
        categories.push((existing || await tx.categories.create({ data: { name: value, slug } })).id);
      }
    }
  }
  return { authors, publisherId, categories };
}

async function applyDraft(req, res) {
  const requestedBookId = req.body?.bookId;
  const createEntities = req.body?.createEntities || {};
  try {
    const result = await prisma.$transaction(async (tx) => {
      const draft = await tx.metadata_reconciliation_drafts.findUnique({ where: { id: req.params.id }, include: { decisions: true } });
      if (!draft) {
        const error = new Error('Draft not found'); error.statusCode = 404; throw error;
      }
      const bookId = requestedBookId || draft.book_id;
      if (!bookId) {
        const error = new Error('bookId is required to apply a draft'); error.statusCode = 400; throw error;
      }
      const book = await tx.books.findUnique({ where: { id: bookId }, include: { book_authors: true, book_categories: true } });
      if (!book) { const error = new Error('Book not found'); error.statusCode = 404; throw error; }
      const accepted = Object.fromEntries(draft.decisions.filter((decision) => decision.status === 'ACCEPTED').map((decision) => [decision.field, decision.value]));
      const relations = await resolveRelationIds(tx, draft, accepted, createEntities);
      const data = {
        ...(accepted.title ? { title: String(accepted.title) } : {}),
        ...(Object.prototype.hasOwnProperty.call(accepted, 'description') ? { description: accepted.description } : {}),
        ...(Object.prototype.hasOwnProperty.call(accepted, 'language') ? { default_language: accepted.language } : {}),
        ...(Object.prototype.hasOwnProperty.call(accepted, 'pageCount') ? { page_count: accepted.pageCount } : {}),
        ...(Object.prototype.hasOwnProperty.call(accepted, 'publishedDate') ? { published_date: accepted.publishedDate ? new Date(`${accepted.publishedDate}T00:00:00.000Z`) : null } : {}),
        ...(accepted.publisher && relations.publisherId ? { publisher_id: relations.publisherId } : {}),
        metadata: { ...(book.metadata || {}), metadataProvenance: { ...(book.metadata?.metadataProvenance || {}), ...Object.fromEntries(Object.keys(accepted).map((field) => [field, 'STAFF_APPROVED'])) } },
      };
      const updatedBook = await tx.books.update({ where: { id: bookId }, data });
      if (accepted.authors && relations.authors.length) {
        await tx.book_authors.deleteMany({ where: { book_id: bookId } });
        await tx.book_authors.createMany({ data: relations.authors.map((author, index) => ({ book_id: bookId, author_id: author.id, author_order: index + 1 })) });
        await tx.author_aliases.createMany({ data: relations.authors.filter((author) => author.raw && canonicalKey(author.raw) !== canonicalKey(accepted.authors[relations.authors.indexOf(author)])).map((author) => ({ author_id: author.id, alias: author.raw, normalized_alias: canonicalKey(author.raw), confidence: 1, status: 'PENDING' })), skipDuplicates: true });
      }
      if (accepted.categories && relations.categories.length) {
        await tx.book_categories.deleteMany({ where: { book_id: bookId } });
        await tx.book_categories.createMany({ data: relations.categories.map((categoryId) => ({ book_id: bookId, category_id: categoryId })), skipDuplicates: true });
      }
      await tx.metadata_reconciliation_drafts.update({ where: { id: draft.id }, data: { book_id: bookId, status: 'APPLIED' } });
      await tx.inventory_audit_logs.create({ data: { actor_user_id: req.user.id, action_name: 'METADATA_RECONCILIATION_APPLIED', entity_type: 'BOOK', entity_id: bookId, before_data: { title: book.title, publisher_id: book.publisher_id, page_count: book.page_count, default_language: book.default_language, authors: book.book_authors.map((item) => item.author_id), categories: book.book_categories.map((item) => item.category_id) }, after_data: { acceptedFields: accepted, provenance: 'STAFF_APPROVED', sourceEvidence: draft.raw_metadata?.fieldEvidence || {}, ai: draft.ai_suggestions || {} } } });
      return updatedBook;
    });
    return res.json({ data: result });
  } catch (error) {
    if (error.statusCode) return res.status(error.statusCode).json({ message: error.message });
    console.error('Unable to apply metadata reconciliation draft', error);
    return res.status(500).json({ message: 'Unable to apply metadata reconciliation draft' });
  }
}

module.exports = { createDraft, getDraft, decideField, applyDraft, readAuthorities };
