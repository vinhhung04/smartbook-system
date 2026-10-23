// Unit tests for AI Import's multi-image OCR form rules (src/lib/book-ocr.ts).
// Run: pnpm --filter web test:unit (transpiled with Vite's esbuild, as in copilot-visualization.test.mjs).
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { transformWithEsbuild } from 'vite';

const source = await readFile(new URL('../src/lib/book-ocr.ts', import.meta.url), 'utf8');
const { code } = await transformWithEsbuild(source, 'book-ocr.ts', { loader: 'ts', format: 'esm' });
const ocr = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);

const EMPTY = {
  isbn: '', isbn13: '', isbn10: '', title: '', subtitle: '', authorsText: '', translatorText: '', publisher: '',
  publishedDate: '', description: '', categoriesText: '', language: 'vi', pageCount: '', thumbnail: '', summaryVi: '', keywordsText: '',
};

const proposal = (formField, value, status = 'EXTRACTED', safeToApply = true, extra = {}) => ({
  formField, value, status, safeToApply, source: 'images', reasons: [], ocrValue: value, lookupValue: null, options: [], ...extra,
});

const PROPOSALS = {
  isbn: proposal('isbn', '9786041234567', 'CORROBORATED'),
  isbn13: proposal('isbn13', '9786041234567', 'CORROBORATED'),
  title: proposal('title', 'Nhà giả kim', 'CORROBORATED'),
  authorsText: proposal('authorsText', 'Paulo Coelho'),
  pageCount: proposal('pageCount', null, 'CONFLICTED', false, { options: [{ source: 'images', value: '228' }, { source: 'isbn_lookup', value: '227' }] }),
  publisher: proposal('publisher', 'NXB Hội Nhà Văn', 'REVIEW_REQUIRED', false),
  language: proposal('language', 'vi', 'INFERRED', false),
};

test('a scan fills only safe proposals; conflicted and review-required values are not written', () => {
  const { form, applied } = ocr.formFromScan(EMPTY, PROPOSALS, new Set(), EMPTY);
  assert.equal(form.title, 'Nhà giả kim');
  assert.equal(form.isbn, '9786041234567');
  assert.equal(form.authorsText, 'Paulo Coelho');
  assert.equal(form.pageCount, '');        // conflict: nothing chosen for the user
  assert.equal(form.publisher, '');        // review required: not auto-filled
  assert.equal(form.language, 'vi');       // default kept, inferred value not applied
  assert.deepEqual(applied.sort(), ['authorsText', 'isbn', 'isbn13', 'title']);
});

test('fields the user typed into (even while the scan was running) are never overwritten', () => {
  const typedDuringScan = { ...EMPTY, title: 'Tên do thủ thư nhập', authorsText: '' };
  const edited = new Set(['title', 'authorsText']);  // authors deliberately cleared by the user
  const { form, keptUserValues, applied } = ocr.formFromScan(typedDuringScan, PROPOSALS, edited, EMPTY);
  assert.equal(form.title, 'Tên do thủ thư nhập');
  assert.equal(form.authorsText, '');
  assert.deepEqual(keptUserValues.sort(), ['authorsText', 'title']);
  assert.ok(!applied.includes('title'));
});

test('values left by a previous book are cleared unless the user typed them', () => {
  const previous = { ...EMPTY, title: 'Sách cũ', publisher: 'NXB cũ', thumbnail: 'https://old/cover.jpg', summaryVi: 'tóm tắt cũ' };
  const { form } = ocr.formFromScan(previous, PROPOSALS, new Set(['summaryVi']), EMPTY);
  assert.equal(form.title, 'Nhà giả kim');
  assert.equal(form.publisher, '');
  assert.equal(form.thumbnail, '');
  assert.equal(form.summaryVi, 'tóm tắt cũ');
});

test('"apply safe fields" skips edited fields and unsafe proposals', () => {
  const form = { ...EMPTY, title: 'Đã sửa tay', authorsText: '' };
  const result = ocr.applySafeProposals(form, PROPOSALS, new Set(['title']));
  assert.equal(result.form.title, 'Đã sửa tay');
  assert.equal(result.form.authorsText, 'Paulo Coelho');
  assert.equal(result.form.pageCount, '');
  assert.deepEqual(result.applied.sort(), ['authorsText', 'isbn', 'isbn13']);
  assert.equal(ocr.safeProposalCount(PROPOSALS), 4);
});

test('file checks happen before upload', () => {
  assert.equal(ocr.validateOcrFile({ type: 'image/jpeg', size: 1000 }, 8 * 1024 * 1024), null);
  assert.match(ocr.validateOcrFile({ type: 'image/gif', size: 1000 }, 8e6), /JPG, PNG hoặc WebP/);
  assert.match(ocr.validateOcrFile({ type: 'application/pdf', size: 1000 }, 8e6), /JPG, PNG hoặc WebP/);
  assert.match(ocr.validateOcrFile({ type: 'image/png', size: 9 * 1024 * 1024 }, 8 * 1024 * 1024), /vượt quá 8 MB/);
  assert.match(ocr.validateOcrFile({ type: 'image/webp', size: 0 }, 8e6), /rỗng/);
});

test('unchanged photos produce the same fingerprint (no re-upload), a replaced photo does not', async () => {
  const photo = (bytes, lastModified = 1) => new File([new Uint8Array(bytes)], 'front_cover.jpg', { type: 'image/jpeg', lastModified });
  const front = await ocr.fileDigest(photo([1, 2, 3]));
  assert.match(front, /^sha256:[0-9a-f]{64}$/);
  // Identity is the content: the same photo picked again (new File, new time) is the same slot...
  assert.equal(front, await ocr.fileDigest(photo([1, 2, 3], 999)));
  // ...and a different photo with the same name and size is not.
  const other = await ocr.fileDigest(photo([1, 2, 4]));
  assert.notEqual(front, other);
  const a = ocr.fingerprintFiles({ front_cover: front });
  assert.equal(a, ocr.fingerprintFiles({ front_cover: front }));
  assert.notEqual(a, ocr.fingerprintFiles({ front_cover: other }));
  assert.notEqual(a, ocr.fingerprintFiles({ front_cover: front, back_cover: front }));
  // The same photo in another slot is another set (front vs back is part of the evidence).
  assert.notEqual(a, ocr.fingerprintFiles({ back_cover: front }));
});

test('without a provider record the workspace gets an empty "not found" state, never invented metadata', () => {
  const scan = {
    metadata: { isbn13: '9786041234567', isbn10: null, title: 'Nhà giả kim' },
    warnings: [],
    isbnLookup: { status: 'NOT_FOUND', lookup: { found: false } },
  };
  const state = ocr.lookupStateFromScan(scan);
  assert.equal(state.found, false);
  assert.equal(state.isbn, '9786041234567');
  assert.equal(state.title, null);
  assert.equal(state.reason, 'OCR_WITHOUT_PROVIDER_RECORD');

  const record = { found: true, isbn: '9786041234567', title: 'Nhà Giả Kim' };
  assert.equal(ocr.lookupStateFromScan({ ...scan, warnings: [], isbnLookup: { status: 'FOUND', lookup: record } }), record);
  // A record for another book (title mismatch) never seeds the reconciliation draft.
  const other = ocr.lookupStateFromScan({ ...scan, warnings: ['ISBN_LOOKUP_TITLE_MISMATCH'], isbnLookup: { status: 'FOUND', lookup: record } });
  assert.equal(other.found, false);
  assert.equal(other.reason, 'OCR_LOOKUP_MISMATCH');
});

test('warning codes become readable Vietnamese', () => {
  assert.equal(ocr.describeOcrCode('UNGROUNDED:title:front_cover'), 'Tên sách (Bìa trước): giá trị không khớp chữ AI đọc được');
  assert.equal(ocr.describeOcrCode('NOT_ISBN_PREFIX:isbn:back_cover'), 'ISBN (Bìa sau): mã vạch không phải ISBN (không bắt đầu 978/979)');
  assert.equal(ocr.describeOcrCode('ONLY_PRINT_YEAR_FOUND'), 'Chỉ thấy năm in / nộp lưu chiểu, không phải năm xuất bản');
  assert.equal(ocr.describeOcrCode('FALLBACK_USED:UPSTREAM_ERROR'), 'đã dùng model dự phòng');
  assert.equal(ocr.ocrSourceLabel('images:copyright_page'), 'Trang xuất bản');
  assert.equal(ocr.formatUsd(0.000412), '$0.00041');
  assert.equal(ocr.formatUsd(null), 'không rõ');
});

test('single-photo readings of identity fields are offered for one bulk click, never auto-filled', () => {
  const single = (formField, value) => proposal(formField, value, 'EXTRACTED', false, { reasons: ['SINGLE_SOURCE'] });
  const proposals = {
    title: single('title', 'Số đỏ'), isbn: single('isbn', '9786041234567'), isbn13: single('isbn13', '9786041234567'),
    publisher: single('publisher', 'NXB Văn Học'), pageCount: proposal('pageCount', '228'),
    authorsText: proposal('authorsText', 'Vũ Trọng Phụng', 'REVIEW_REQUIRED', false, { reasons: ['DIACRITICS_DIFFER'] }),
    language: proposal('language', 'vi', 'INFERRED', false),
  };
  // A scan alone fills only the safe page count.
  assert.deepEqual(ocr.formFromScan(EMPTY, proposals, new Set(), EMPTY).applied, ['pageCount']);
  const offered = ocr.singleSourceProposals(proposals, new Set(['publisher'])).map((p) => p.formField).sort();
  assert.deepEqual(offered, ['isbn', 'title']); // not the edited publisher, not the isbn13 mirror, not review/inferred
});

test('a provider record whose identity could not be verified never seeds the workspace', () => {
  const scan = {
    metadata: { isbn13: '9786041234567', isbn10: null, title: null },
    warnings: ['ISBN_LOOKUP_IDENTITY_UNVERIFIED'],
    isbnLookup: { status: 'FOUND', lookup: { found: true, title: 'Một cuốn khác', authors: ['Ai Đó'] } },
  };
  const state = ocr.lookupStateFromScan(scan);
  assert.equal(state.found, false);
  assert.equal(state.reason, 'OCR_LOOKUP_MISMATCH');
  assert.deepEqual(state.authors, []);
});
