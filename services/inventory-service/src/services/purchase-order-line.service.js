// PO line identity for the invoice-first flow: a line is a typed book snapshot (title, market
// code, author, publish year) and may have no catalog variant until receiving links one.

/** Snapshot fields of a catalog variant, for PO lines created from a catalog id only. */
async function snapshotFromVariant(tx, variantId) {
  const variant = await tx.book_variants.findUnique({
    where: { id: variantId },
    select: {
      sku: true,
      isbn13: true,
      isbn10: true,
      publish_year: true,
      books: { select: { title: true, book_authors: { select: { authors: { select: { full_name: true } } } } } },
    },
  });
  const authors = (variant?.books?.book_authors || []).map((row) => row.authors?.full_name).filter(Boolean);
  return {
    item_title: variant?.books?.title || null,
    item_code: variant?.isbn13 || variant?.isbn10 || variant?.sku || null,
    item_author: authors.join(", ") || "Chưa rõ tác giả",
    item_publish_year: variant?.publish_year || new Date().getFullYear(),
  };
}

/** Display title of a PO line: the ordered snapshot first, the linked catalog title otherwise. */
function poItemTitle(item) {
  return item?.item_title || item?.book_variants?.books?.title || null;
}

/** Display code of a PO line: the market code typed on the PO, else the catalog's. */
function poItemCode(item) {
  return item?.item_code || item?.book_variants?.isbn13 || item?.book_variants?.sku || null;
}

const INVOICE_FIRST = "INVOICE_FIRST";

function isInvoiceFirst(po) {
  return po?.procurement_flow === INVOICE_FIRST;
}

module.exports = { INVOICE_FIRST, isInvoiceFirst, snapshotFromVariant, poItemTitle, poItemCode };
