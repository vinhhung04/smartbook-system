const { PrismaClient, Prisma } = require('@prisma/client');
const { canonicalKey, reconcileMetadata } = require('../services/authority-normalization.service');
const { normalizeIsbn13, normalizeIsbn10, normalizeCoverImageUrl, normalizeLanguageCode, normalizePublishYear, normalizePageCount, normalizeKeywords } = require('../services/catalog-metadata.validation');

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

function matchedIdForValue(match, value) {
  return match && canonicalKey(match.rawValue) === canonicalKey(value) ? safeMatchId(match) : null;
}

async function resolveRelationIds(tx, draft, accepted, createEntities) {
  const authority = draft.authority_matches || {};
  const authorMatches = Array.isArray(authority.authors) ? authority.authors : [];
  const categoryMatches = Array.isArray(authority.categories) ? authority.categories : [];
  const authors = [];
  if (accepted.authors) {
    for (let index = 0; index < accepted.authors.length; index += 1) {
      const value = accepted.authors[index];
      const matchedId = matchedIdForValue(authorMatches[index], value);
      if (matchedId) authors.push({ id: matchedId, raw: authorMatches[index].rawValue, canonicalName: authorMatches[index].matchedEntity?.name || null });
      else {
        const existing = await tx.authors.findUnique({ where: { full_name: value } });
        const entity = existing || (createEntities.authors ? await tx.authors.create({ data: { full_name: value, sort_name: value } }) : null);
        if (entity) {
        authors.push({ id: entity.id, raw: value, canonicalName: entity.full_name });
        }
      }
    }
  }
  let publisher = null;
  if (accepted.publisher) {
    const matchedId = matchedIdForValue(authority.publisher, accepted.publisher);
    if (matchedId) publisher = { id: matchedId, raw: authority.publisher?.rawValue, canonicalName: authority.publisher?.matchedEntity?.name || null };
    if (!publisher) {
      const existing = await tx.publishers.findUnique({ where: { name: accepted.publisher } });
      const entity = existing || (createEntities.publisher ? await tx.publishers.create({ data: { name: accepted.publisher, code: `PUB-${Date.now()}` } }) : null);
      if (entity) publisher = { id: entity.id, raw: accepted.publisher, canonicalName: entity.name };
    }
  }
  const categories = [];
  if (accepted.categories) {
    for (let index = 0; index < accepted.categories.length; index += 1) {
      const value = accepted.categories[index];
      const matchedId = matchedIdForValue(categoryMatches[index], value);
      if (matchedId) categories.push(matchedId);
      else {
        const slug = canonicalKey(value).replace(/\s+/g, '-');
        const existing = await tx.categories.findUnique({ where: { slug } });
        const entity = existing || (createEntities.categories ? await tx.categories.create({ data: { name: value, slug } }) : null);
        if (entity) categories.push(entity.id);
      }
    }
  }
  return { authors, publisher, categories };
}

async function applyDraft(req, res) {
  const requestedBookId = req.body?.bookId;
  const requestedVariantId = req.body?.variantId;
  const createEntities = req.body?.createEntities || {};
  const finalMetadata = req.body?.finalMetadata || {};
  const duplicateReviewId = req.body?.duplicateReviewId;
  try {
    const result = await prisma.$transaction(async (tx) => {
      const draft = await tx.metadata_reconciliation_drafts.findUnique({ where: { id: req.params.id }, include: { decisions: true } });
      if (!draft) {
        const error = new Error('Draft not found'); error.statusCode = 404; throw error;
      }
      let bookId = requestedBookId || draft.book_id;
      const accepted = Object.fromEntries(draft.decisions.filter((decision) => decision.status === 'ACCEPTED').map((decision) => [decision.field, decision.value]));
      const isbn13 = finalMetadata.isbn13 === undefined ? undefined : normalizeIsbn13(finalMetadata.isbn13);
      const isbn10 = finalMetadata.isbn10 === undefined ? undefined : normalizeIsbn10(finalMetadata.isbn10);
      const publishYear = finalMetadata.publishYear === undefined ? undefined : normalizePublishYear(finalMetadata.publishYear);
      const pageCount = finalMetadata.pageCount === undefined ? undefined : normalizePageCount(finalMetadata.pageCount);
      if ((finalMetadata.isbn13 !== undefined && !isbn13) || (finalMetadata.isbn10 !== undefined && !isbn10) || (publishYear === undefined && finalMetadata.publishYear !== undefined) || (pageCount === undefined && finalMetadata.pageCount !== undefined)) { const error = new Error('Invalid final metadata'); error.statusCode = 400; throw error; }
      let book = bookId ? await tx.books.findUnique({ where: { id: bookId }, include: { book_authors: true, book_categories: true, book_variants: true } }) : null;
      if (!book && !bookId) {
        const title = String(accepted.title || finalMetadata.title || '').trim();
        if (!title || !isbn13) { const error = new Error('title and valid isbn13 are required to create a catalog book'); error.statusCode = 400; throw error; }
        const createdBook = await tx.books.create({ data: { title, default_language: normalizeLanguageCode(accepted.language || finalMetadata.language) || 'vi', metadata: { is_incomplete: false, metadataProvenance: { title: accepted.title ? 'STAFF_APPROVED' : 'STAFF_APPROVED' } } } });
        const createdVariant = await tx.book_variants.create({ data: { book_id: createdBook.id, sku: `IMPORT-${isbn13}`, isbn13, language_code: normalizeLanguageCode(accepted.language || finalMetadata.language) || 'vi' } });
        bookId = createdBook.id;
        book = { ...createdBook, book_authors: [], book_categories: [], book_variants: [createdVariant] };
      }
      if (!book) { const error = new Error('Book not found'); error.statusCode = 404; throw error; }
      const duplicateReview = duplicateReviewId ? await tx.duplicate_review_drafts.findUnique({ where: { id: duplicateReviewId } }) : null;
      if (duplicateReviewId && !duplicateReview) { const error = new Error('Duplicate review not found'); error.statusCode = 404; throw error; }
      if (duplicateReview && duplicateReview.selected_book_id && duplicateReview.selected_book_id !== bookId) { const error = new Error('Duplicate review target does not match bookId'); error.statusCode = 400; throw error; }
      const variantId = requestedVariantId || duplicateReview?.selected_variant_id || book.book_variants[0]?.id || null;
      const variant = variantId ? await tx.book_variants.findUnique({ where: { id: variantId } }) : null;
      if (variantId && (!variant || variant.book_id !== bookId)) { const error = new Error('Variant does not belong to selected book'); error.statusCode = 400; throw error; }
      const relations = await resolveRelationIds(tx, draft, accepted, createEntities);
      const isLinkedVariant = duplicateReview?.decision === 'LINK_EXISTING_VARIANT';
      const metadataProvenance = Object.fromEntries(Object.keys(accepted).map((field) => [field, 'STAFF_APPROVED']));
      const data = {
        ...(accepted.title ? { title: String(accepted.title) } : {}),
        ...(finalMetadata.subtitle !== undefined ? { subtitle: String(finalMetadata.subtitle || '').trim() || null } : {}),
        ...(Object.prototype.hasOwnProperty.call(accepted, 'description') ? { description: accepted.description } : {}),
        ...(Object.prototype.hasOwnProperty.call(accepted, 'language') ? { default_language: accepted.language } : {}),
        ...(Object.prototype.hasOwnProperty.call(accepted, 'pageCount') ? { page_count: accepted.pageCount } : pageCount !== undefined ? { page_count: pageCount } : {}),
        ...(Object.prototype.hasOwnProperty.call(accepted, 'publishedDate') ? { published_date: accepted.publishedDate ? new Date(`${accepted.publishedDate}T00:00:00.000Z`) : null } : {}),
        ...(accepted.publisher && relations.publisher ? { publisher_id: relations.publisher.id } : {}),
        metadata: { ...(book.metadata || {}), ...(finalMetadata.summaryVi !== undefined ? { summary_vi: String(finalMetadata.summaryVi || '').trim() || null } : {}), ...(finalMetadata.keywords !== undefined ? { keywords: normalizeKeywords(finalMetadata.keywords) } : {}), metadataProvenance: { ...(book.metadata?.metadataProvenance || {}), ...metadataProvenance, ...(finalMetadata.summaryVi !== undefined ? { summaryVi: 'STAFF_APPROVED' } : {}), ...(finalMetadata.keywords !== undefined ? { keywords: 'STAFF_APPROVED' } : {}) } },
      };
      const updatedBook = await tx.books.update({ where: { id: bookId }, data });
      if (accepted.authors && relations.authors.length) {
        await tx.book_authors.deleteMany({ where: { book_id: bookId } });
        await tx.book_authors.createMany({ data: relations.authors.map((author, index) => ({ book_id: bookId, author_id: author.id, author_order: index + 1 })) });
        await tx.author_aliases.createMany({ data: relations.authors.filter((author) => author.raw && author.canonicalName && author.raw.trim() !== author.canonicalName.trim()).map((author) => ({ author_id: author.id, alias: author.raw, normalized_alias: canonicalKey(author.raw), confidence: 1, status: 'PENDING' })), skipDuplicates: true });
      }
      if (accepted.publisher && relations.publisher?.raw && relations.publisher.canonicalName && relations.publisher.raw.trim() !== relations.publisher.canonicalName.trim()) {
        await tx.publisher_aliases.createMany({ data: [{ publisher_id: relations.publisher.id, alias: relations.publisher.raw, normalized_alias: canonicalKey(relations.publisher.raw), confidence: 1, status: 'PENDING' }], skipDuplicates: true });
      }
      if (accepted.categories && relations.categories.length) {
        await tx.book_categories.deleteMany({ where: { book_id: bookId } });
        await tx.book_categories.createMany({ data: relations.categories.map((categoryId) => ({ book_id: bookId, category_id: categoryId })), skipDuplicates: true });
      }
      if (variant && !isLinkedVariant) {
        const variantData = {
          ...(isbn13 !== undefined ? { isbn13 } : {}),
          ...(isbn10 !== undefined ? { isbn10 } : {}),
          ...(finalMetadata.internalBarcode !== undefined ? { internal_barcode: String(finalMetadata.internalBarcode || '').trim() || null } : {}),
          ...(finalMetadata.coverImageUrl !== undefined ? { cover_image_url: normalizeCoverImageUrl(finalMetadata.coverImageUrl) } : {}),
          ...(accepted.language ? { language_code: normalizeLanguageCode(accepted.language) || 'vi' } : {}),
          ...(publishYear !== undefined ? { publish_year: publishYear } : {}),
          ...(accepted.coverFormat ? { cover_type: String(accepted.coverFormat).toUpperCase() } : {}),
        };
        if (Object.keys(variantData).length) await tx.book_variants.update({ where: { id: variant.id }, data: variantData });
      }
      await tx.metadata_reconciliation_drafts.update({ where: { id: draft.id }, data: { book_id: bookId, status: 'APPLIED' } });
      await tx.inventory_audit_logs.create({ data: { actor_user_id: req.user.id, action_name: 'METADATA_RECONCILIATION_APPLIED', entity_type: 'BOOK', entity_id: bookId, before_data: { title: book.title, subtitle: book.subtitle, description: book.description, publisher_id: book.publisher_id, page_count: book.page_count, default_language: book.default_language, metadata: book.metadata, authors: book.book_authors.map((item) => item.author_id), categories: book.book_categories.map((item) => item.category_id), variant: variant ? { isbn13: variant.isbn13, isbn10: variant.isbn10, internal_barcode: variant.internal_barcode } : null }, after_data: { acceptedFields: accepted, finalMetadata, sourceEvidence: draft.raw_metadata?.fieldEvidence || {}, aiSuggestions: draft.ai_suggestions || {}, duplicateReviewId: duplicateReview?.id || null, duplicateDecision: duplicateReview?.decision || null, provenance: metadataProvenance } } });
      return { book: updatedBook, variantId: variant?.id || null };
    });
    return res.json({ data: result });
  } catch (error) {
    if (error.statusCode) return res.status(error.statusCode).json({ message: error.message });
    if (error.code === 'P2002') return res.status(409).json({ message: 'ISBN, barcode, or SKU already belongs to an existing variant' });
    console.error('Unable to apply metadata reconciliation draft', error);
    return res.status(500).json({ message: 'Unable to apply metadata reconciliation draft' });
  }
}

module.exports = { createDraft, getDraft, decideField, applyDraft, readAuthorities };
