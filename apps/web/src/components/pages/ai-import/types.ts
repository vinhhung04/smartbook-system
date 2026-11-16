export interface EditableBookForm {
  isbn: string;
  isbn13: string;
  isbn10: string;
  title: string;
  subtitle: string;
  authorsText: string;
  translatorText?: string;
  publisher: string;
  publishedDate: string;
  description: string;
  categoriesText: string;
  language: string;
  pageCount: string;
  thumbnail: string;
  summaryVi: string;
  keywordsText: string;
}

export const EMPTY_FORM: EditableBookForm = {
  isbn: "",
  isbn13: "",
  isbn10: "",
  title: "",
  subtitle: "",
  authorsText: "",
  translatorText: "",
  publisher: "",
  publishedDate: "",
  description: "",
  categoriesText: "",
  language: "vi",
  pageCount: "",
  thumbnail: "",
  summaryVi: "",
  keywordsText: "",
};

export interface CatalogBookLite {
  id: string;
  title: string;
  author: string;
  isbn: string;
  category: string;
}

export interface DuplicateMatch {
  book: CatalogBookLite;
  reason: "isbn" | "title";
}

export type ReviewSignalData = {
  label: string;
  detail: string;
  complete: boolean;
  fieldId: string;
};

export type AiFieldKey = "description" | "summaryVi" | "keywords" | "categories";

export interface AiFieldCandidate {
  /** Plain text for description/summaryVi; comma-joined text for keywords/categories —
   *  same textual shape as the corresponding EditableBookForm field. */
  value: string;
  source: "postIsbn" | "generated";
  /** The field's value when the suggestion was made. Once the field holds something
   *  else the suggestion is stale: it was written for text that is no longer there. */
  basis: string;
}

export type AiFieldCandidates = Record<AiFieldKey, AiFieldCandidate | null>;

/** The form field each AI suggestion writes to. */
export const AI_FORM_FIELD: Record<AiFieldKey, "description" | "summaryVi" | "keywordsText" | "categoriesText"> = {
  description: "description", summaryVi: "summaryVi", keywords: "keywordsText", categories: "categoriesText",
};

/** A rule-based quality check of the form, remembered with what it checked. */
export interface QualityCheckResult {
  provider: string;
  warnings: string[];
  /** When the check ran (ms since epoch). */
  checkedAt: number;
  /** qualityCheckBasis() of the form it checked: once the form differs, the result is out of date. */
  basis: string;
  /** The check could not run; said next to the button instead of only in a toast. */
  error?: string;
}

/** The form fields the quality check reads, as one comparable string. */
export function qualityCheckBasis(form: { title: string; authorsText: string; publisher: string; description: string; categoriesText: string; language: string }): string {
  return JSON.stringify([form.title, form.authorsText, form.publisher, form.description, form.categoriesText, form.language]);
}

/** Each AI field's noun, as used inside a Vietnamese sentence. */
export const AI_FIELD_NOUN: Record<AiFieldKey, string> = {
  description: "mô tả", summaryVi: "tóm tắt", keywords: "từ khóa", categories: "thể loại",
};

/** An applied suggestion, kept so the user can undo it from the same place. */
export interface AiAppliedChange {
  previous: string;
  applied: string;
  /** Applied by a click on this field (focus moves to its Undo), not by "apply all". */
  direct: boolean;
  /** The field was the user's own value before the suggestion replaced it (Undo gives that back). */
  wasEdited: boolean;
}
