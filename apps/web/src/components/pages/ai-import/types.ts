export interface EditableBookForm {
  isbn: string;
  isbn13: string;
  isbn10: string;
  title: string;
  subtitle: string;
  authorsText: string;
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
}

export type AiFieldCandidates = Record<AiFieldKey, AiFieldCandidate | null>;
