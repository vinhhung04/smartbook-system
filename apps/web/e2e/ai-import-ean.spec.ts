import { expect, test, type Page } from '@playwright/test';
import { randomInt } from 'node:crypto';
import { DEMO_PASSWORD, loginStaff } from './helpers';

/**
 * AI Import - ISBN / retail EAN-13 classification, end to end.
 *
 * The OCR endpoints are mocked (deterministic, no OpenRouter cost); everything the
 * save touches is the running stack (gateway -> inventory-service). Each run uses new,
 * checksum-valid codes, and the saved book is read back through the API.
 */
const GATEWAY = process.env.GATEWAY_URL || 'http://localhost:3000';
const FRONT = 'e2e/fixtures/book-front.jpg';
const CAPABILITIES = {
  enabled: true, imageKinds: ['front_cover', 'back_cover', 'copyright_page'], maxImages: 3,
  maxFileBytes: 8 * 1024 * 1024, maxTotalBytes: 8 * 1024 * 1024, acceptedTypes: ['image/jpeg', 'image/png', 'image/webp'],
  model: 'qwen/qwen3.7-flash',
};

function code(prefix: string, length = 13): string {
  const body = prefix + Array.from({ length: length - 1 - prefix.length }, () => randomInt(10)).join('');
  const sum = [...body].reduce((acc, d, i) => acc + Number(d) * (i % 2 ? 3 : 1), 0);
  return body + ((10 - (sum % 10)) % 10);
}

const proposal = (formField: string, value: string | null, status: string, safeToApply: boolean, extra: Record<string, unknown> = {}) => ({
  formField, value, status, safeToApply, source: value ? 'images' : null, reasons: [], ocrValue: value, lookupValue: null, options: [], ...extra,
});

function scan(title: string, ean: string, isbnLookup: Record<string, unknown>) {
  return {
    schemaVersion: 'book-ocr-scan-v1', promptVersion: 'book-ocr-v2', status: 'SUCCESS',
    images: [{ kind: 'back_cover', originalBytes: 4000, processedBytes: 3000, size: [300, 450], resized: false }],
    metadata: { title, subtitle: null, authors: [], translators: [], publisher: null, distributor: null, publishedYear: null,
      printYear: null, copyrightYear: null, editionStatement: null, isbn13: null, isbn10: null, pageCount: null, coverPrice: null,
      description: null, language: 'vi' },
    fields: {}, fieldEvidence: {}, visualEvidence: {}, anomalies: [], missingFields: ['isbn13'], conflictedFields: [],
    otherCodes: [{ source: 'barcode', label: 'Mã vạch không phải ISBN', value: ean, kind: 'EAN13' }],
    warnings: ['BARCODE_NOT_ISBN', 'NON_ISBN_CODES_FOUND'],
    isbnLookup,
    proposals: {
      isbn: proposal('isbn', null, 'MISSING', false), isbn13: proposal('isbn13', null, 'MISSING', false), isbn10: proposal('isbn10', null, 'MISSING', false),
      internalBarcode: proposal('internalBarcode', ean, 'EXTRACTED', false, { source: 'barcode', reasons: ['SINGLE_SOURCE'],
        options: [{ source: 'barcode', value: ean }] }),
      title: proposal('title', title, 'CORROBORATED', true),
    },
    usage: { model: 'qwen/qwen3.7-flash', fallbackUsed: false, cacheHit: false, imageCount: 1, promptTokens: 1, completionTokens: 1,
      costUsd: 0, latencyMs: 1, calls: [] },
    processingTimeMs: 10,
  };
}

async function scanWith(page: Page, result: unknown) {
  await page.route('**/book-metadata/capabilities', (route) => route.fulfill({ json: CAPABILITIES }));
  await page.route('**/book-metadata/scan-images', (route) => route.fulfill({ json: result }));
  await loginStaff(page);
  await page.goto('/ai-import');
  await expect(page.getByText('Nhập sách bằng hình ảnh (AI OCR)')).toBeVisible({ timeout: 20_000 });
  await page.getByLabel('Chọn ảnh bìa sau').setInputFiles(FRONT);
  await page.getByRole('button', { name: 'Quét và trích xuất bằng AI' }).click();
  await expect(page.getByRole('region', { name: 'Kết quả AI OCR' })).toBeVisible();
}

async function save(page: Page) {
  await page.getByRole('region', { name: 'Lưu sách', exact: true }).getByRole('button', { name: 'Lưu sách', exact: true }).click();
}

async function api(request: import('@playwright/test').APIRequestContext) {
  const login = await request.post(`${GATEWAY}/auth/login`, { data: { identifier: 'hung', password: DEMO_PASSWORD } });
  expect(login.ok()).toBeTruthy();
  const headers = { Authorization: `Bearer ${(await login.json()).token}` };
  return {
    get: (path: string) => request.get(`${GATEWAY}${path}`, { headers }),
    del: (path: string) => request.delete(`${GATEWAY}${path}`, { headers }),
  };
}

test('a book with only a retail EAN-13 is saved under that barcode, never as an ISBN', async ({ page, request }) => {
  const ean = code('893');
  const title = `QA EAN only ${ean}`;
  await scanWith(page, scan(title, ean, { status: 'NOT_FOUND', isbn: null, ean13: ean, editionMatches: null, lookup: null }));

  // The decoded EAN is offered for the barcode field, never put into an ISBN field.
  await expect(page.locator('#isbn13')).toHaveValue('');
  await expect(page.locator('#internalBarcode')).toHaveValue(''); // one reading: offered, not filled
  await page.getByTestId('ocr-row-internalBarcode').getByRole('button', { name: 'Áp dụng mã vạch ean-13' }).click();
  await expect(page.locator('#internalBarcode')).toHaveValue(ean);

  const created = page.waitForResponse((r) => r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/books/incomplete');
  const updated = page.waitForResponse((r) => r.request().method() === 'PATCH' && /\/api\/books\/[0-9a-f-]+$/.test(new URL(r.url()).pathname));
  await save(page);
  const createdResponse = await created;
  expect(createdResponse.ok(), await createdResponse.text()).toBeTruthy();
  const body = (await createdResponse.json()).data;
  expect(createdResponse.request().postDataJSON()).toMatchObject({ barcode: ean });
  expect(createdResponse.request().postDataJSON().isbn13).toBeUndefined();
  expect(body.isbn13).toBeNull();
  expect(body.barcode).toBe(ean);
  const patch = await updated;
  expect(patch.ok(), await patch.text()).toBeTruthy();
  expect(patch.request().postDataJSON()).toMatchObject({ internal_barcode: ean });
  expect(patch.request().postDataJSON().isbn13).toBeUndefined();

  const client = await api(request);
  const scanned = await client.get(`/api/books/isbn13/${ean}`); // the goods-receipt scan path
  expect(scanned.ok()).toBeTruthy();
  expect((await scanned.json()).variant_id).toBe(body.variant_id);
  await client.del(`/api/books/${body.book_id}`);
});

test('the ISBN a source links to the EAN is offered with its evidence and saved beside the EAN only after a click', async ({ page, request }) => {
  const ean = code('893');
  const isbn = code('9798');
  const title = `QA EAN to ISBN ${ean}`;
  const lookup = {
    success: true, found: true, isbn: ean, isbn13: null, isbn10: null, codeKind: 'EAN13', title, subtitle: null, authors: [],
    publisher: null, publishedDate: null, description: null, categories: [], language: 'vi', pageCount: null, thumbnail: null,
    translator: [], source: { googleBooks: false, openLibrary: false, aiSummary: 'none' }, confidence: { overall: 0.5, googleBooks: 0, openLibrary: 0 },
    summaryVi: null, keywords: [], manualEntryRequired: false,
    crossLookup: { direction: 'EAN_TO_ISBN', scannedCode: ean, status: 'VERIFIED', value: isbn, isbn10: null, reasons: ['MULTI_SOURCE_AGREEMENT'],
      evidence: [{ source: 'fahasa', codes: [isbn], sourceUrl: 'https://www.fahasa.com/qa-e2e.html' }, { source: 'tiki', codes: [isbn], sourceUrl: null }] },
  };
  await scanWith(page, scan(title, ean, { status: 'FOUND', isbn: null, ean13: ean, editionMatches: null, lookup }));

  // One line under the ISBN-13 field, like a field's value comparison.
  const cross = page.getByTestId('cross-lookup');
  await expect(cross).toContainText(isbn);
  await expect(cross).toContainText('Đã đối chiếu');
  // Offered, not applied: nothing is written into the ISBN field by itself.
  await expect(page.locator('#isbn13')).toHaveValue('');
  await page.getByTestId('ocr-row-internalBarcode').getByRole('button', { name: 'Áp dụng mã vạch ean-13' }).click();
  await expect(page.locator('#internalBarcode')).toHaveValue(ean);
  // Also in the review checklist; its button opens the evidence at the field.
  const reviewTabFirst = page.getByRole('tab', { name: /^Kiểm duyệt/ });
  if (await reviewTabFirst.count()) {
    await reviewTabFirst.first().click();
    await expect(page.getByText(`Có ISBN đề xuất cho mã EAN-13: ${isbn}`).first()).toBeVisible();
    const metadataTab = page.getByRole('tab', { name: /^Metadata/ }); // only on narrow screens
    if (await metadataTab.count()) await metadataTab.first().click();
  }
  await cross.getByRole('button', { name: /Xem bằng chứng/ }).click();
  const row = cross.getByTestId('cross-lookup-candidate');
  await expect(row).toContainText('Fahasa');
  await expect(row.getByRole('link', { name: /Nguồn/ })).toHaveAttribute('href', 'https://www.fahasa.com/qa-e2e.html');
  await row.getByRole('button', { name: /Dùng giá trị này/ }).click();
  await expect(page.locator('#isbn13')).toHaveValue(isbn);
  await expect(page.locator('#internalBarcode')).toHaveValue(ean); // the original EAN is kept
  await expect(row).toContainText('Đang dùng');

  // A found record opens the usual reconciliation review: keep the names as written.
  const reviewTab = page.getByRole('tab', { name: /^Kiểm duyệt/ });
  if (await reviewTab.count()) await reviewTab.first().click();
  const accept = page.getByRole('button', { name: 'Chấp nhận', exact: true });
  for (let guard = 0; guard < 10 && await accept.count(); guard += 1) {
    await accept.first().click();
    await page.waitForTimeout(300);
  }

  const saved = page.waitForResponse((r) => ['POST', 'PATCH'].includes(r.request().method())
    && /\/api\/(books\/incomplete|metadata-reconciliations\/[^/]+\/apply)$/.test(new URL(r.url()).pathname));
  await save(page);
  const response = await saved;
  expect(response.ok(), await response.text()).toBeTruthy();

  const client = await api(request);
  const byIsbn = await client.get(`/api/books/isbn13/${isbn}`);
  const byEan = await client.get(`/api/books/barcode/${ean}`);
  expect(byIsbn.ok() && byEan.ok()).toBeTruthy();
  const variant = (await byIsbn.json()).variant_id;
  expect((await byEan.json()).variant_id).toBe(variant);
  await client.del(`/api/books/${(await byIsbn.json()).book_id}`);
});

function lookupRecord(code: string, title: string, codeKind: string, crossLookup: Record<string, unknown>) {
  return {
    success: true, found: true, isbn: code, isbn13: codeKind === 'ISBN13' ? code : null, isbn10: null, codeKind, title, subtitle: null,
    authors: [], publisher: null, publishedDate: '2023', description: null, categories: [], language: 'vi', pageCount: null, thumbnail: null,
    translator: [], source: { googleBooks: false, openLibrary: false, aiSummary: 'none' }, confidence: { overall: 0.5, googleBooks: 0, openLibrary: 0 },
    summaryVi: null, keywords: [], manualEntryRequired: false, crossLookup,
  };
}

const candidate = (value: string, isbn10: string | null, dates: string[], preferred = false) => ({
  value, isbn10, sources: ['ppdvn'], titles: ['Không bao giờ là thất bại! Tất cả là thử thách'], publisher: 'NXB Dân trí',
  partner: 'First News', years: [...new Set(dates.map((d) => Number(d.slice(-4))))], depositDates: dates,
  sourceUrl: 'https://ppdvn.gov.vn/x', basis: 'TITLE_PUBLISHER_AUTHOR', preferred,
});

test('a book reprinted under several ISBNs lists every one, the edition year first, and staff picks the printed one', async ({ page }) => {
  const ean = code('893');
  const title = `QA reprints ${ean}`;
  const [isbn2023, isbn2024, isbn2021] = [code('97860488'), code('97860440'), code('97860434')];
  const crossLookup = {
    direction: 'EAN_TO_ISBN', scannedCode: ean, status: 'CONFLICTED', value: null, isbn10: null, preferred: isbn2023,
    reasons: ['LEGAL_DEPOSIT_SEVERAL_ISBNS', 'PUBLISHER_MATCH', 'AUTHOR_MATCH', 'PREFERRED_BY_YEAR'],
    evidence: [isbn2023, isbn2024, isbn2021].map((v) => ({ source: 'ppdvn', codes: [v], sourceUrl: 'https://ppdvn.gov.vn/x', basis: 'TITLE_PUBLISHER_AUTHOR' })),
    candidates: [candidate(isbn2023, null, ['17/03/2023'], true), candidate(isbn2024, null, ['20/08/2024', '02/04/2025']),
      candidate(isbn2021, null, ['08/12/2021'])],
  };
  await scanWith(page, scan(title, ean, { status: 'FOUND', isbn: null, ean13: ean, editionMatches: null,
    lookup: lookupRecord(ean, title, 'EAN13', crossLookup) }));

  const cross = page.getByTestId('cross-lookup');
  await expect(cross).toContainText('3 ISBN ứng viên');
  await expect(cross.getByRole('button', { name: `Dùng ${isbn2023} (khớp năm ấn bản)` })).toBeVisible();
  const rows = cross.getByTestId('cross-lookup-candidate');
  await expect(rows).toHaveCount(0); // collapsed until asked, like a field's value comparison
  await cross.getByRole('button', { name: /So sánh 3 giá trị/ }).click();
  await expect(rows).toHaveCount(3);
  await expect(rows.first()).toContainText(isbn2023);
  await expect(rows.first()).toContainText('Khớp năm ấn bản');
  await expect(rows.nth(1)).toContainText('nộp lưu chiểu 20/08/2024, 02/04/2025');
  await expect(rows.first()).toContainText('liên kết First News');
  await expect(page.locator('#isbn13')).toHaveValue(''); // nothing chosen for the librarian
  // The printed copy is the 2024 reprint: staff picks it, not the year hint.
  await rows.nth(1).getByRole('button', { name: /Dùng giá trị này/ }).click();
  await expect(page.locator('#isbn13')).toHaveValue(isbn2024);
  await expect(rows.nth(1)).toContainText('Đang dùng');
});

test('a scanned ISBN gets the retail EAN-13 a store lists the same edition under, offered at the barcode field', async ({ page }) => {
  const isbn = code('97860437');
  const ean = code('893');
  const title = `QA ISBN to EAN ${isbn}`;
  const crossLookup = {
    direction: 'ISBN_TO_EAN', scannedCode: isbn, status: 'REVIEW_REQUIRED', value: ean, isbn10: null, preferred: null,
    reasons: ['STORE_TITLE_MATCH', 'PUBLISHER_MATCH', 'AUTHOR_MATCH'],
    evidence: [{ source: 'tiki', codes: [ean], sourceUrl: 'https://tiki.vn/x', basis: 'TITLE_PUBLISHER_AUTHOR', title, publisher: 'NXB Phụ Nữ' }],
    candidates: [{ ...candidate(ean, null, []), sources: ['tiki'], years: [2022] }],
  };
  const result = scan(title, ean, { status: 'FOUND', isbn, ean13: null, editionMatches: true, lookup: lookupRecord(isbn, title, 'ISBN13', crossLookup) });
  // The photos show the ISBN only (no barcode read): the EAN can only come from the lookup.
  Object.assign(result, { otherCodes: [], warnings: [] });
  Object.assign(result.proposals, {
    isbn: proposal('isbn', isbn, 'CORROBORATED', true), isbn13: proposal('isbn13', isbn, 'CORROBORATED', true),
    internalBarcode: proposal('internalBarcode', null, 'MISSING', false),
  });
  await scanWith(page, result);

  // Under the barcode field: the barcode is what an ISBN scan's lookup offers.
  const cross = page.locator('[data-field-row="internalBarcode"]').getByTestId('cross-lookup');
  await expect(cross).toContainText(`Đối chiếu từ ISBN ${isbn}`);
  await expect(cross).toContainText(ean);
  await expect(page.locator('#internalBarcode')).toHaveValue(''); // offered, not filled
  await cross.getByRole('button', { name: /Xem bằng chứng/ }).click();
  await expect(cross.getByTestId('cross-lookup-candidate')).toContainText('khớp tên sách, NXB, tác giả');
  await cross.getByRole('button', { name: `Dùng ${ean}` }).click();
  await expect(page.locator('#internalBarcode')).toHaveValue(ean);
  await expect(page.locator('#isbn13')).toHaveValue(isbn); // the ISBN stays the ISBN
  await expect(cross.getByRole('button', { name: `Dùng ${ean}` })).toHaveCount(0);
});
