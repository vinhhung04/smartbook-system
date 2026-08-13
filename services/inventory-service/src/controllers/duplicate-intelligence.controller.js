const { PrismaClient } = require('@prisma/client');
const { canonicalKey } = require('../services/authority-normalization.service');
const { checkDuplicates, normalizeIsbn } = require('../services/duplicate-intelligence.service');

const prisma = new PrismaClient();
const ACTIONS = ['LINK_EXISTING_VARIANT', 'CREATE_VARIANT_FOR_EDITION', 'CREATE_NEW_EDITION', 'CREATE_NEW_TITLE', 'DISMISS_WARNING'];

function inputMetadata(req) {
  return req.body?.normalizedMetadata || req.body?.metadata || req.body?.lookup || {};
}

const bookInclude = {
  publishers: { select: { id: true, name: true } },
  book_authors: { include: { authors: { select: { id: true, full_name: true } } } },
  book_variants: { select: { id: true, isbn13: true, isbn10: true, sku: true, internal_barcode: true, publish_year: true, language_code: true, cover_type: true } },
};

async function findCandidates(metadata) {
  const isbn = normalizeIsbn(metadata.isbn || metadata.isbn13 || metadata.isbn10);
  const barcode = String(metadata.barcode || metadata.sku || '').trim();
  const exact = (isbn || barcode) ? await prisma.books.findMany({
    where: { book_variants: { some: { OR: [
      ...(isbn ? [{ isbn13: isbn }, { isbn10: isbn }] : []),
      ...(barcode ? [{ sku: barcode }, { internal_barcode: barcode }] : []),
    ] } } },
    include: bookInclude,
  }) : [];
  const nearby = metadata.title ? await prisma.books.findMany({ where: { is_active: true }, include: bookInclude, take: 300 }) : [];
  return [...new Map([...exact, ...nearby].map((book) => [book.id, book])).values()];
}

async function check(req, res) {
  const metadata = inputMetadata(req);
  try {
    const result = checkDuplicates(metadata, await findCandidates(metadata));
    const draft = await prisma.duplicate_review_drafts.create({ data: { input_metadata: metadata, candidates: result.candidates, classification: result.classification, similarity_score: result.similarityScore, explanation: { signals: result.candidates[0]?.signals || {}, reasons: result.explanation }, created_by_user_id: req.user.id } });
    return res.status(201).json({ data: { ...draft, candidates: result.candidates, classification: result.classification, similarityScore: result.similarityScore, explanation: result.explanation } });
  } catch (error) {
    console.error('Unable to check duplicate intelligence', error);
    return res.status(500).json({ message: 'Unable to check duplicate intelligence' });
  }
}

async function getReview(req, res) {
  try {
    const data = await prisma.duplicate_review_drafts.findUnique({ where: { id: req.params.id } });
    return data ? res.json({ data }) : res.status(404).json({ message: 'Duplicate review not found' });
  } catch (error) {
    console.error('Unable to load duplicate review', error);
    return res.status(500).json({ message: 'Unable to load duplicate review' });
  }
}

function variantData(input, values = {}) {
  const isbn13 = normalizeIsbn(values.isbn13 || input.isbn13 || input.isbn);
  const isbn10 = normalizeIsbn(values.isbn10 || input.isbn10);
  const sku = String(values.sku || input.sku || `ISBN-${isbn13 || Date.now()}`).slice(0, 50);
  return {
    sku,
    ...(isbn13.length === 13 ? { isbn13 } : {}),
    ...(isbn10.length === 10 ? { isbn10 } : {}),
    ...(values.internalBarcode || input.barcode ? { internal_barcode: String(values.internalBarcode || input.barcode).slice(0, 50) } : {}),
    cover_type: String(values.coverType || input.coverFormat || 'PAPERBACK').toUpperCase(),
    language_code: String(values.languageCode || input.language || 'vi').toLowerCase(),
    ...(Number.isInteger(values.publishYear) ? { publish_year: values.publishYear } : {}),
  };
}

async function assertUniqueVariant(tx, data) {
  const existing = await tx.book_variants.findFirst({ where: { OR: [
    { sku: data.sku },
    ...(data.isbn13 ? [{ isbn13: data.isbn13 }] : []),
    ...(data.isbn10 ? [{ isbn10: data.isbn10 }] : []),
    ...(data.internal_barcode ? [{ internal_barcode: data.internal_barcode }] : []),
  ] } });
  if (existing) { const error = new Error('ISBN, barcode, or SKU already belongs to an existing variant'); error.statusCode = 409; throw error; }
}

async function decide(req, res) {
  const { action, selectedBookId, selectedVariantId, variant = {} } = req.body || {};
  if (!ACTIONS.includes(action)) return res.status(400).json({ message: 'Unsupported duplicate review action' });
  try {
    const response = await prisma.$transaction(async (tx) => {
      const draft = await tx.duplicate_review_drafts.findUnique({ where: { id: req.params.id } });
      if (!draft) { const error = new Error('Duplicate review not found'); error.statusCode = 404; throw error; }
      const input = draft.input_metadata || {};
      let selectedBook = null;
      let selectedVariant = null;
      if (action === 'LINK_EXISTING_VARIANT') {
        if (draft.classification !== 'EXACT_DUPLICATE' || !selectedVariantId) { const error = new Error('Exact duplicate and selectedVariantId are required to link an existing variant'); error.statusCode = 400; throw error; }
        selectedVariant = await tx.book_variants.findUnique({ where: { id: selectedVariantId } });
        if (!selectedVariant) { const error = new Error('Selected variant not found'); error.statusCode = 404; throw error; }
        selectedBook = await tx.books.findUnique({ where: { id: selectedVariant.book_id } });
      } else if (action === 'CREATE_VARIANT_FOR_EDITION') {
        if (!selectedBookId) { const error = new Error('selectedBookId is required'); error.statusCode = 400; throw error; }
        selectedBook = await tx.books.findUnique({ where: { id: selectedBookId } });
        if (!selectedBook) { const error = new Error('Selected edition not found'); error.statusCode = 404; throw error; }
        const data = variantData(input, variant); await assertUniqueVariant(tx, data);
        selectedVariant = await tx.book_variants.create({ data: { ...data, book_id: selectedBook.id } });
      } else if (action === 'CREATE_NEW_EDITION' || action === 'CREATE_NEW_TITLE') {
        const existing = selectedBookId ? await tx.books.findUnique({ where: { id: selectedBookId } }) : null;
        if (action === 'CREATE_NEW_EDITION' && !existing) { const error = new Error('selectedBookId is required for a new edition'); error.statusCode = 400; throw error; }
        let workGroupId = existing?.work_group_id || null;
        if (!workGroupId) {
          const work = await tx.book_work_groups.create({ data: { canonical_title: input.title || existing?.title || 'Untitled', normalized_title: canonicalKey(input.title || existing?.title || 'Untitled') } });
          workGroupId = work.id;
          if (existing) await tx.books.update({ where: { id: existing.id }, data: { work_group_id: workGroupId } });
        }
        selectedBook = await tx.books.create({ data: { title: input.title || 'Untitled', default_language: input.language || 'vi', work_group_id: workGroupId, metadata: { created_from_duplicate_review: draft.id, requires_metadata_reconciliation: true } } });
        const data = variantData(input, variant); await assertUniqueVariant(tx, data);
        selectedVariant = await tx.book_variants.create({ data: { ...data, book_id: selectedBook.id } });
      }
      const updated = await tx.duplicate_review_drafts.update({ where: { id: draft.id }, data: { decision: action, selected_book_id: selectedBook?.id || selectedBookId || null, selected_variant_id: selectedVariant?.id || selectedVariantId || null, reviewed_by_user_id: req.user.id, reviewed_at: new Date() } });
      await tx.inventory_audit_logs.create({ data: { actor_user_id: req.user.id, action_name: 'DUPLICATE_REVIEW_DECIDED', entity_type: selectedVariant ? 'BOOK_VARIANT' : 'DUPLICATE_REVIEW', entity_id: selectedVariant?.id || null, after_data: { reviewId: draft.id, action, selectedBookId: selectedBook?.id || null, selectedVariantId: selectedVariant?.id || null, preservedExistingReferences: true } } });
      return { review: updated, book: selectedBook, variant: selectedVariant };
    });
    return res.json({ data: response });
  } catch (error) {
    if (error.statusCode) return res.status(error.statusCode).json({ message: error.message });
    console.error('Unable to decide duplicate review', error);
    return res.status(500).json({ message: 'Unable to decide duplicate review' });
  }
}

module.exports = { check, getReview, decide, findCandidates };
