// Pure helpers for AI Import's multi-image OCR (no React, no runtime imports) —
// unit-tested in tests/book-ocr.test.mjs. The form rules live here so they are
// testable: a scan only ever fills fields the user has not typed into, and only
// with proposals the server marked safe (no conflict, grounded, not inferred).
import type { EditableBookForm } from '@/components/pages/ai-import/types';
import type { LookupBookByIsbnResponse } from '@/services/ai';
import type { BookOcrScanResult, OcrFieldStatus, OcrImageKind, OcrProposal } from '@/services/book-ocr';

export type FormField = keyof EditableBookForm;

export const OCR_SLOTS: ReadonlyArray<{ kind: OcrImageKind; label: string; hint: string }> = [
  { kind: 'front_cover', label: 'Bìa trước', hint: 'Tên sách, tác giả, dịch giả' },
  { kind: 'back_cover', label: 'Bìa sau', hint: 'ISBN, mã vạch, giới thiệu, giá bìa' },
  { kind: 'copyright_page', label: 'Trang thông tin xuất bản', hint: 'NXB, năm, lần in, số trang, ISBN' },
];

export const OCR_ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
/** Client-side resize target: well under the gateway's 8 MB body cap for three photos,
 *  and above the server's own 1600 px OCR size so small print stays legible. */
export const OCR_UPLOAD_MAX_DIMENSION = 2048;

export function validateOcrFile(file: { type: string; size: number }, maxBytes: number): string | null {
  if (!OCR_ACCEPTED_TYPES.includes(file.type)) return 'Chỉ nhận ảnh JPG, PNG hoặc WebP.';
  if (file.size <= 0) return 'Ảnh rỗng.';
  if (file.size > maxBytes) return `Ảnh vượt quá ${Math.floor(maxBytes / (1024 * 1024))} MB.`;
  return null;
}

/** Stable identity of the selected files, so pressing "scan" again with nothing
 *  changed re-uses the last result instead of uploading and paying again. */
export function fingerprintFiles(files: Partial<Record<OcrImageKind, { name: string; size: number; lastModified: number }>>): string {
  return OCR_SLOTS.map(({ kind }) => {
    const file = files[kind];
    return file ? `${kind}:${file.name}:${file.size}:${file.lastModified}` : `${kind}:-`;
  }).join('|');
}

/** A scan starts a new import: fields the user typed into are kept as they are; every
 *  other field is reset (so values from a previous book never linger) and then filled
 *  with the scan's safe proposals. Conflicted / review-required values are NOT written. */
export function formFromScan(
  current: EditableBookForm,
  proposals: Record<string, OcrProposal>,
  userEdited: ReadonlySet<string>,
  defaults: EditableBookForm,
): { form: EditableBookForm; applied: FormField[]; keptUserValues: FormField[] } {
  const next = { ...current };
  const applied: FormField[] = [];
  const keptUserValues: FormField[] = [];
  for (const field of Object.keys(defaults) as FormField[]) {
    const proposal = proposals[field];
    if (userEdited.has(field)) {
      if (proposal?.value && proposal.value !== current[field]) keptUserValues.push(field);
      continue;
    }
    if (proposal?.safeToApply && proposal.value) {
      next[field] = proposal.value;
      applied.push(field);
    } else {
      next[field] = defaults[field] ?? "";
    }
  }
  return { form: next, applied, keptUserValues };
}

/** "Áp dụng các trường an toàn": safe proposals into fields the user has not edited. */
export function applySafeProposals(
  form: EditableBookForm,
  proposals: Record<string, OcrProposal>,
  userEdited: ReadonlySet<string>,
): { form: EditableBookForm; applied: FormField[] } {
  const next = { ...form };
  const applied: FormField[] = [];
  for (const proposal of Object.values(proposals)) {
    const field = proposal.formField as FormField;
    if (!(field in form) || userEdited.has(field) || !proposal.safeToApply || !proposal.value) continue;
    if (next[field] !== proposal.value) {
      next[field] = proposal.value;
      applied.push(field);
    }
  }
  return { form: next, applied };
}

export function safeProposalCount(proposals: Record<string, OcrProposal>): number {
  return Object.values(proposals).filter((proposal) => proposal.safeToApply && proposal.value).length;
}

/** The lookup-shaped state AI Import's workspace needs when no provider record exists
 *  (no ISBN on the images, or the ISBN was not found): the same "nothing found, enter
 *  manually" state a typed ISBN produces — it carries no metadata of its own. */
export function lookupStateFromScan(result: BookOcrScanResult): LookupBookByIsbnResponse {
  // A record whose title or edition does not match the printed book must not seed the
  // reconciliation draft: it would carry another book's authors, publisher and dates.
  const mismatch = result.warnings.some((code) => code === 'ISBN_LOOKUP_TITLE_MISMATCH' || code === 'ISBN_LOOKUP_DIFFERENT_EDITION');
  if (result.isbnLookup.status === 'FOUND' && result.isbnLookup.lookup && !mismatch) return result.isbnLookup.lookup;
  const isbn13 = result.metadata.isbn13 || '';
  return {
    success: false, found: false, isbn: isbn13, isbn13: isbn13 || null, isbn10: result.metadata.isbn10,
    title: null, subtitle: null, authors: [], publisher: null, publishedDate: null, description: null,
    categories: [], language: null, pageCount: null, thumbnail: null,
    source: { googleBooks: false, openLibrary: false, aiSummary: 'none' },
    confidence: { overall: 0, googleBooks: 0, openLibrary: 0 },
    summaryVi: null, keywords: [], manualEntryRequired: true, reason: mismatch ? 'OCR_LOOKUP_MISMATCH' : 'OCR_WITHOUT_PROVIDER_RECORD',
  };
}

export const OCR_FIELD_LABELS: Record<string, string> = {
  isbn: 'ISBN', isbn13: 'ISBN-13', isbn10: 'ISBN-10', title: 'Tên sách', subtitle: 'Tựa phụ',
  authorsText: 'Tác giả', translatorText: 'Dịch giả', publisher: 'Nhà xuất bản', publishedDate: 'Năm xuất bản',
  pageCount: 'Số trang', description: 'Mô tả', language: 'Ngôn ngữ', categoriesText: 'Thể loại',
};

/** Names of what the model read (server-side OCR fields, incl. ones with no form field). */
export const OCR_READING_LABELS: Record<string, string> = {
  title: 'Tên sách', subtitle: 'Tựa phụ', authors: 'Tác giả', translators: 'Dịch giả', publisher: 'Nhà xuất bản',
  distributor: 'Đơn vị phát hành', isbn: 'ISBN', publicationYear: 'Năm xuất bản', printYear: 'Năm in',
  copyrightYear: 'Năm bản quyền', editionStatement: 'Lần xuất bản / in', pageCount: 'Số trang',
  coverPrice: 'Giá bìa', description: 'Giới thiệu', language: 'Ngôn ngữ',
};

/** Form field -> the OCR field whose readings are its evidence. */
export const OCR_FIELD_FOR_FORM: Record<string, string | null> = {
  isbn: 'isbn', isbn13: 'isbn', isbn10: 'isbn', title: 'title', subtitle: 'subtitle', authorsText: 'authors',
  translatorText: 'translators', publisher: 'publisher', publishedDate: 'publicationYear', pageCount: 'pageCount',
  description: 'description', language: 'language', categoriesText: null,
};

export const OCR_STATUS_META: Record<OcrFieldStatus, { label: string; tone: string }> = {
  CORROBORATED: { label: 'Đã đối chiếu', tone: 'success' },
  EXTRACTED: { label: 'Đọc từ ảnh', tone: 'info' },
  LOOKUP_ONLY: { label: 'Từ tra cứu ISBN', tone: 'cyan' },
  REVIEW_REQUIRED: { label: 'Cần kiểm tra', tone: 'warning' },
  CONFLICTED: { label: 'Xung đột', tone: 'danger' },
  INVALID: { label: 'Không hợp lệ', tone: 'danger' },
  INFERRED: { label: 'Suy luận', tone: 'neutral' },
  MISSING: { label: 'Không thấy', tone: 'neutral' },
};

export const OCR_SOURCE_LABELS: Record<string, string> = {
  front_cover: 'Bìa trước', back_cover: 'Bìa sau', copyright_page: 'Trang xuất bản', barcode: 'Mã vạch',
  isbn_lookup: 'Tra cứu ISBN', images: 'Ảnh', 'images+isbn_lookup': 'Ảnh + tra cứu ISBN', rule: 'Quy tắc',
};

export function ocrSourceLabel(source: string): string {
  if (source.startsWith('images:')) return OCR_SOURCE_LABELS[source.slice(7)] || source.slice(7);
  return OCR_SOURCE_LABELS[source] || source;
}

const CODE_LABELS: Record<string, string> = {
  UNGROUNDED: 'giá trị không khớp chữ AI đọc được',
  NO_EVIDENCE: 'không kèm đoạn chữ làm bằng chứng',
  UNKNOWN_SOURCE: 'AI dẫn nguồn ảnh không được tải lên',
  ROLE_MISMATCH: 'sai vai trò (vd. dịch giả, nhà phát hành, năm in)',
  ROLE_UNCONFIRMED: 'chưa thấy nhãn vai trò trên ảnh',
  INVALID_CHECKSUM: 'ISBN sai chữ số kiểm tra',
  NOT_ISBN_PREFIX: 'mã vạch không phải ISBN (không bắt đầu 978/979)',
  INVALID_FORMAT: 'định dạng không hợp lệ',
  OUT_OF_RANGE: 'giá trị ngoài khoảng hợp lệ',
  TOO_LONG: 'quá dài',
  ISBN_UNLABELLED: 'ISBN không có nhãn "ISBN"',
  SOURCES_DISAGREE: 'các ảnh ghi khác nhau',
  PARTIAL_AGREEMENT: 'các ảnh chỉ khớp một phần',
  DIACRITICS_DIFFER: 'các ảnh khác nhau về dấu tiếng Việt',
  SOME_READINGS_INVALID: 'một số lần đọc không hợp lệ',
  LOOKUP_MISMATCH: 'khác dữ liệu tra cứu ISBN',
  LOOKUP_AGREES: 'khớp dữ liệu tra cứu ISBN',
  LOOKUP_RECORD_FOUND: 'tra cứu ISBN tìm thấy sách',
  LOOKUP_SUPPORTS_ONE_READING: 'tra cứu ISBN khớp một trong các giá trị',
  LOOKUP_DIFFERENT_EDITION: 'bản ghi tra cứu thuộc ấn bản khác',
  LOOKUP_TITLE_MISMATCH: 'bản ghi tra cứu ISBN mang tên sách khác — ISBN/mã vạch có thể không thuộc cuốn này',
  LOOKUP_FLAGGED_FIELD: 'nguồn tra cứu tự đánh dấu chưa chắc chắn',
  OCR_READING_INVALID: 'giá trị đọc từ ảnh không hợp lệ',
  VIETNAMESE_LETTERS_IN_TEXT: 'suy ra từ chữ tiếng Việt trong ảnh',
  MALFORMED_OBSERVATION: 'AI trả một mục sai cấu trúc',
  MALFORMED_FIELD: 'AI trả một trường sai cấu trúc',
  IMAGE_ILLEGIBLE: 'ảnh khó đọc',
  ONLY_PRINT_YEAR_FOUND: 'chỉ thấy năm in / nộp lưu chiểu, không phải năm xuất bản',
  NON_ISBN_CODES_FOUND: 'có mã số khác ISBN trên ảnh (không dùng làm ISBN)',
  BARCODE_NOT_ISBN: 'mã vạch đọc được không phải ISBN',
  ISBN_LOOKUP_TIMEOUT: 'tra cứu ISBN quá thời gian',
  ISBN_LOOKUP_ERROR: 'tra cứu ISBN lỗi',
  ISBN_LOOKUP_NOT_FOUND: 'tra cứu ISBN không tìm thấy sách',
  ISBN_LOOKUP_DIFFERENT_EDITION: 'tra cứu ISBN trả về ấn bản khác',
  ISBN_LOOKUP_TITLE_MISMATCH: 'tra cứu ISBN trả về sách có tên khác — không tự điền dữ liệu từ tra cứu, hãy kiểm tra lại ISBN',
  FALLBACK_BUDGET_EXHAUSTED: 'đã hết ngân sách model dự phòng hôm nay',
  FALLBACK_USED: 'đã dùng model dự phòng',
  IMAGES_MAY_SHOW_DIFFERENT_BOOKS: 'các ảnh có thể là của hai cuốn sách khác nhau (tên sách/ISBN không khớp) — không tự điền trường nào',
};

/** "UNGROUNDED:title:front_cover" -> "Tên sách (Bìa trước): giá trị không khớp chữ AI đọc được". */
export function describeOcrCode(code: string): string {
  const [name, field, source] = code.split(':');
  const label = CODE_LABELS[name] || name.replace(/_/g, ' ').toLowerCase();
  if (name === 'FALLBACK_USED') return label;
  const where = [field && (OCR_READING_LABELS[field] || field), source && ocrSourceLabel(source)]
    .filter(Boolean);
  if (!where.length) return label.charAt(0).toUpperCase() + label.slice(1);
  return `${where[0]}${where[1] ? ` (${where[1]})` : ''}: ${label}`;
}

export function formatUsd(cost: number | null | undefined): string {
  if (cost === null || cost === undefined) return 'không rõ';
  if (cost === 0) return '$0';
  return cost < 0.01 ? `$${cost.toFixed(5)}` : `$${cost.toFixed(4)}`;
}
