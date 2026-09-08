import type { IsbnSourceName, LookupBookByIsbnResponse } from "@/services/ai";
import type { FinalMetadata } from "@/services/metadata-intelligence";
import type { CatalogBookLite, DuplicateMatch, EditableBookForm } from "./types";

/** Human-readable labels for each ISBN lookup provider, shared by the hero summary,
 *  the ISBN intelligence panel, and the loading-progress checklist. */
export const SOURCE_LABELS: Record<IsbnSourceName, string> = {
  googleBooks: "Google Books",
  openLibrary: "OpenLibrary",
  worldCat: "WorldCat",
  fahasa: "Fahasa",
  tiki: "Tiki",
  vinabook: "Vinabook",
  webSearch: "Web search",
};

export function winningSourceName(lookup: LookupBookByIsbnResponse): string | null {
  const winner = (lookup.sources || []).find((source) => source.status === "SUCCESS");
  return winner ? SOURCE_LABELS[winner.name] || winner.name : null;
}

export function normalizeIsbnInput(value: string): string {
  const cleaned = String(value || "").trim().replace(/[^0-9Xx]/g, "");
  if (cleaned.length === 10) {
    return `${cleaned.slice(0, 9)}${cleaned.slice(9).toUpperCase()}`;
  }
  return cleaned;
}

export function parsePublishYear(publishedDate: string): number | undefined {
  const matched = String(publishedDate || "").match(/\b(\d{4})\b/);
  if (!matched) return undefined;
  const year = Number(matched[1]);
  if (!Number.isInteger(year) || year < 1000 || year > 2100) return undefined;
  return year;
}

/** Lowercase, strip diacritics/punctuation — for loose duplicate/category comparisons. */
export function normalizeForCompare(value: string): string {
  return String(value || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/gi, "d")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Flags catalog books that look like the same title being entered again. */
export function findDuplicateMatches(form: EditableBookForm, catalogBooks: CatalogBookLite[]): DuplicateMatch[] {
  const candidateIsbns = new Set(
    [form.isbn, form.isbn13, form.isbn10].map((v) => normalizeIsbnInput(v)).filter(Boolean),
  );
  const normalizedTitle = normalizeForCompare(form.title);
  const firstAuthor = normalizeForCompare(form.authorsText.split(",")[0] || "");

  if (!candidateIsbns.size && normalizedTitle.length < 3) return [];

  const matches: DuplicateMatch[] = [];
  for (const book of catalogBooks) {
    const bookIsbn = normalizeIsbnInput(book.isbn || "");
    if (bookIsbn && candidateIsbns.has(bookIsbn)) {
      matches.push({ book, reason: "isbn" });
      continue;
    }
    if (normalizedTitle.length < 3) continue;
    const bookTitle = normalizeForCompare(book.title);
    if (!bookTitle) continue;
    const titleMatches = bookTitle === normalizedTitle;
    const authorMatches = !firstAuthor || normalizeForCompare(book.author).includes(firstAuthor);
    if (titleMatches && authorMatches) {
      matches.push({ book, reason: "title" });
    }
  }
  return matches;
}

export function mapLookupToForm(data: LookupBookByIsbnResponse): EditableBookForm {
  return {
    isbn: data.isbn || "",
    isbn13: data.isbn13 || "",
    isbn10: data.isbn10 || "",
    title: data.title || "",
    subtitle: data.subtitle || "",
    authorsText: (data.authors || []).join(", "),
    publisher: data.publisher || "",
    publishedDate: data.publishedDate || "",
    description: data.description || "",
    categoriesText: (data.categories || []).join(", "),
    language: data.language || "vi",
    pageCount: data.pageCount != null ? String(data.pageCount) : "",
    thumbnail: data.thumbnail || "",
    summaryVi: data.summaryVi || "",
    keywordsText: (data.keywords || []).join(", "),
  };
}

export function splitCommaValues(value: string): string[] {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

export function buildDuplicateCheckMetadata({ lookup, normalizedMetadata, form }: { lookup: LookupBookByIsbnResponse; normalizedMetadata: Record<string, unknown>; form: EditableBookForm }): Record<string, unknown> {
  const pick = (formValue: string, normalizedKey: string, lookupValue: unknown) => formValue.trim() || normalizedMetadata[normalizedKey] || lookupValue || undefined;
  const isbn13 = normalizeIsbnInput(form.isbn13 || "");
  const isbn10 = normalizeIsbnInput(form.isbn10 || "");
  const isbn = normalizeIsbnInput(form.isbn || "") || (isbn13.length === 13 ? isbn13 : isbn10);
  return {
    isbn,
    isbn13: isbn13.length === 13 ? isbn13 : normalizeIsbnInput(String(normalizedMetadata.isbn13 || lookup.isbn13 || "")),
    isbn10: isbn10.length === 10 ? isbn10 : normalizeIsbnInput(String(normalizedMetadata.isbn10 || lookup.isbn10 || "")),
    barcode: normalizeIsbnInput(form.isbn) || String(normalizedMetadata.barcode || normalizedMetadata.internal_barcode || lookup.isbn || ""),
    internal_barcode: normalizeIsbnInput(form.isbn) || String(normalizedMetadata.internalBarcode || normalizedMetadata.internal_barcode || lookup.isbn || ""),
    title: pick(form.title, "title", lookup.title),
    authors: splitCommaValues(form.authorsText).length ? splitCommaValues(form.authorsText) : normalizedMetadata.authors || lookup.authors || [],
    publisher: pick(form.publisher, "publisher", lookup.publisher),
    categories: splitCommaValues(form.categoriesText).length ? splitCommaValues(form.categoriesText) : normalizedMetadata.categories || lookup.categories || [],
    language: pick(form.language, "language", lookup.language),
    publishedDate: pick(form.publishedDate, "publishedDate", lookup.publishedDate),
    pageCount: form.pageCount.trim() ? Number(form.pageCount) : normalizedMetadata.pageCount || lookup.pageCount,
    coverFormat: normalizedMetadata.coverFormat,
  };
}

export function reconciliationValueFromForm(field: string, form: EditableBookForm): unknown {
  switch (field) {
    case "title": return form.title.trim();
    case "authors": return splitCommaValues(form.authorsText);
    case "publisher": return form.publisher.trim();
    case "categories": return splitCommaValues(form.categoriesText);
    case "language": return form.language.trim();
    case "publishedDate": return form.publishedDate.trim() || null;
    case "pageCount": return form.pageCount.trim() ? Number(form.pageCount) : null;
    case "description": return form.description.trim() || null;
    default: return undefined;
  }
}

export function finalMetadataFromForm(form: EditableBookForm): FinalMetadata {
  const isbn13 = normalizeIsbnInput(form.isbn13 || form.isbn);
  const isbn10 = normalizeIsbnInput(form.isbn10 || "");
  const keywords = [...new Set(splitCommaValues(form.keywordsText).filter((item) => item.length <= 50))].slice(0, 15);
  return {
    title: form.title.trim(), subtitle: form.subtitle.trim() || null, description: form.description.trim() || null,
    summaryVi: form.summaryVi.trim() || null, language: form.language.trim() || "vi",
    ...(isbn13.length === 13 ? { isbn13 } : {}), ...(isbn10.length === 10 ? { isbn10 } : {}),
    internalBarcode: normalizeIsbnInput(form.isbn || "") || null, publishYear: parsePublishYear(form.publishedDate),
    pageCount: form.pageCount.trim() ? Number(form.pageCount) : null, coverImageUrl: form.thumbnail.trim() || null, keywords,
  };
}

export function mergeCommaText(current: string, additions: string[]): string {
  const merged = [
    ...current.split(",").map((value) => value.trim()).filter(Boolean),
    ...additions.map((value) => value.trim()).filter(Boolean),
  ];
  return [...new Set(merged)].join(", ");
}

export function displayEvidenceValue(value: unknown): string {
  if (Array.isArray(value)) return value.join(", ");
  if (value === null || value === undefined || value === "") return "–";
  return String(value);
}

const REVIEW_FIELD_LABELS: Record<string, string> = {
  title: "Tên sách",
  authors: "Tác giả",
  publisher: "Nhà xuất bản",
  publishedDate: "Ngày xuất bản",
  categories: "Thể loại",
  isbn: "ISBN",
};

export function formatQualityWarning(warning: string): string {
  const [code, field] = warning.split(":");
  if (code === "SOURCE_CONFLICT" && field) {
    return `Xung đột nguồn: ${REVIEW_FIELD_LABELS[field] || field}`;
  }
  return warning.replace(/_/g, " ").toLowerCase().replace(/^./, (value: string) => value.toUpperCase());
}

const DUPLICATE_CLASSIFICATION_LABELS: Record<string, string> = {
  EXACT_DUPLICATE: "Trùng khớp hoàn toàn",
  SAME_EDITION: "Cùng ấn bản",
  SAME_WORK_DIFFERENT_EDITION: "Cùng tác phẩm, khác ấn bản",
  POSSIBLE_DUPLICATE: "Có thể trùng lặp",
  NEW_TITLE: "Đầu sách mới",
};

/** Backend classification enums (EXACT_DUPLICATE, SAME_EDITION, ...) translated for
 *  display — falls back to a humanized version of the raw value for anything unknown. */
export function formatDuplicateClassification(classification: string): string {
  return DUPLICATE_CLASSIFICATION_LABELS[classification]
    || classification.replace(/_/g, " ").toLowerCase().replace(/^./, (value: string) => value.toUpperCase());
}

/** Whether an ISBN lookup has any source evidence/status to show — shared by the
 *  ISBN intelligence panel and the review tab's evidence card gating. */
export function hasIsbnEvidence(lookup: LookupBookByIsbnResponse): boolean {
  const evidenceCount = Object.entries(lookup.fieldEvidence || {}).filter(([, item]) => item.selectedSource).length;
  return evidenceCount > 0 || (lookup.sources || []).length > 0;
}
