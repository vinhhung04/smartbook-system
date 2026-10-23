import { expect, test, type Page, type Route } from '@playwright/test';
import { loginStaff } from './helpers';

/**
 * AI Import - multi-image OCR. The scan endpoint is mocked (deterministic, no
 * OpenRouter cost); everything else (auth, capabilities, duplicate check) is the
 * running stack. Catalog writes are watched: a scan or an "apply" must never
 * create or update a book.
 */
const FRONT = 'e2e/fixtures/book-front.jpg';
const BACK = 'e2e/fixtures/book-back.jpg';
const TITLE = 'Sách Kiểm Thử OCR E2E';

const proposal = (formField: string, value: string | null, status: string, safeToApply: boolean, extra: Record<string, unknown> = {}) => ({
  formField, value, status, safeToApply, source: value ? 'images' : null, reasons: [], ocrValue: value, lookupValue: null, options: [], ...extra,
});

function scanResult(overrides: Record<string, unknown> = {}) {
  const observation = (source: string, value: unknown, observedText: string) => ({ source, value, normalizedValue: value, observedText, valid: true, issues: [] });
  return {
    schemaVersion: 'book-ocr-scan-v1', promptVersion: 'book-ocr-v2', status: 'SUCCESS',
    images: [{ kind: 'front_cover', originalBytes: 4000, processedBytes: 3000, size: [300, 450], resized: false }],
    metadata: { title: TITLE, subtitle: null, authors: ['Tác Giả Thử'], translators: [], publisher: 'NXB Thử Nghiệm', distributor: null,
      publishedYear: null, printYear: 2021, copyrightYear: null, editionStatement: 'Tái bản lần thứ 2', isbn13: null, isbn10: null,
      pageCount: null, coverPrice: '89.000đ', description: null, language: 'vi' },
    fields: {
      title: { field: 'title', status: 'CORROBORATED', value: TITLE, sources: ['front_cover', 'copyright_page'], reasons: [],
        observations: [observation('front_cover', TITLE, TITLE.toUpperCase())] },
      pageCount: { field: 'pageCount', status: 'CONFLICTED', value: null, sources: ['front_cover', 'copyright_page'], reasons: ['SOURCES_DISAGREE'],
        observations: [observation('front_cover', 228, '228 trang'), observation('copyright_page', 238, 'Số trang: 238')] },
    },
    fieldEvidence: {}, missingFields: ['isbn13'], conflictedFields: ['pageCount'], otherCodes: [],
    warnings: ['ONLY_PRINT_YEAR_FOUND'],
    isbnLookup: { status: 'SKIPPED_NO_VALID_ISBN', isbn: null, editionMatches: null, lookup: null },
    proposals: {
      isbn: proposal('isbn', null, 'MISSING', false), isbn13: proposal('isbn13', null, 'MISSING', false),
      title: proposal('title', TITLE, 'CORROBORATED', true),
      authorsText: proposal('authorsText', 'Tác Giả Thử', 'EXTRACTED', true),
      publisher: proposal('publisher', 'NXB Thử Nghiệm', 'EXTRACTED', true),
      pageCount: proposal('pageCount', null, 'CONFLICTED', false, { reasons: ['SOURCES_DISAGREE'],
        options: [{ source: 'images:front_cover', value: '228' }, { source: 'images:copyright_page', value: '238' }] }),
      language: proposal('language', 'vi', 'INFERRED', false),
    },
    usage: { model: 'qwen/qwen3.7-flash', fallbackUsed: false, cacheHit: false, imageCount: 1, promptTokens: 2100,
      completionTokens: 250, costUsd: 0.0001, latencyMs: 8000, calls: [] },
    processingTimeMs: 8200,
    ...overrides,
  };
}

function watchCatalogWrites(page: Page): string[] {
  const writes: string[] = [];
  page.on('request', (request) => {
    const url = request.url();
    if (request.method() === 'GET' || url.includes('/book-metadata/') || url.includes('/duplicate-intelligence/check')) return;
    if (/\/api\/(books|book-variants|metadata-reconciliations)|\/apply\b|duplicate-intelligence\/reviews/.test(url)) {
      writes.push(`${request.method()} ${url}`);
    }
  });
  return writes;
}

async function openAiImport(page: Page) {
  await loginStaff(page);
  await page.goto('/ai-import');
  await expect(page.getByText('Nhập sách bằng hình ảnh (AI OCR)')).toBeVisible({ timeout: 20_000 });
}

test('upload, preview, replace and remove photos; scan fills only safe fields and keeps the user\'s edits', async ({ page }) => {
  const writes = watchCatalogWrites(page);
  let release: () => void = () => {};
  let scans = 0;
  await page.route('**/book-metadata/scan-images', async (route: Route) => {
    scans += 1;
    const body = route.request().postDataBuffer()?.toString('latin1') || '';
    expect(body).toContain('name="front_cover"');
    if (scans === 2) await new Promise<void>((resolve) => { release = resolve; });
    await route.fulfill({ json: scanResult() });
  });
  await openAiImport(page);

  const front = page.getByLabel('Chọn ảnh bìa trước');
  const back = page.getByLabel('Chọn ảnh bìa sau');
  await front.setInputFiles(FRONT);
  await expect(page.getByAltText('Xem trước bìa trước')).toBeVisible();
  await back.setInputFiles(BACK);
  await expect(page.getByAltText('Xem trước bìa sau')).toBeVisible();
  const firstUrl = await page.getByAltText('Xem trước bìa trước').getAttribute('src');
  await front.setInputFiles(BACK); // replace
  await expect(page.getByAltText('Xem trước bìa trước')).not.toHaveAttribute('src', firstUrl!);
  await page.getByRole('button', { name: 'Xóa ảnh bìa sau' }).click();
  await expect(page.getByAltText('Xem trước bìa sau')).toHaveCount(0);

  await page.getByRole('button', { name: 'Quét và trích xuất bằng AI' }).click();
  await expect(page.getByRole('region', { name: 'Kết quả AI OCR' })).toBeVisible();
  // Safe proposals are in the form; the conflicted page count is not.
  await expect(page.locator('#title')).toHaveValue(TITLE);
  await expect(page.locator('#authors')).toHaveValue('Tác Giả Thử');
  await expect(page.locator('#pageCount')).toHaveValue('');
  const pageCountRow = page.getByTestId('ocr-row-pageCount');
  await expect(pageCountRow.getByText('Xung đột')).toBeVisible();
  await pageCountRow.getByText('Bằng chứng từ ảnh (2)').click();
  await expect(pageCountRow.getByText('Số trang: 238')).toBeVisible();
  await expect(page.getByText('Thông tin khác đọc được')).toBeVisible();

  // Staff resolves the conflict explicitly, then edits the title by hand.
  await pageCountRow.getByRole('button', { name: /Dùng “238”/ }).click();
  await expect(page.locator('#pageCount')).toHaveValue('238');
  await page.locator('#title').fill('Tên do thủ thư sửa');

  // Same photos again: no second upload.
  await page.getByRole('button', { name: 'Quét và trích xuất bằng AI' }).click();
  await expect(page.getByText('Ảnh chưa thay đổi')).toBeVisible();
  expect(scans).toBe(1);

  // New photo -> second scan; while it runs the user keeps typing.
  await front.setInputFiles(FRONT);
  await page.getByRole('button', { name: 'Quét và trích xuất bằng AI' }).click();
  await expect(page.getByRole('button', { name: 'Đang quét…' })).toBeDisabled();
  await page.locator('#publisher').fill('NXB do thủ thư nhập');
  release();
  await expect(page.getByRole('button', { name: 'Quét và trích xuất bằng AI' })).toBeEnabled();
  await expect(page.locator('#title')).toHaveValue('Tên do thủ thư sửa');
  await expect(page.locator('#publisher')).toHaveValue('NXB do thủ thư nhập');
  await expect(page.locator('#pageCount')).toHaveValue('238');
  await expect(page.locator('#authors')).toHaveValue('Tác Giả Thử');
  expect(scans).toBe(2);

  // "Apply safe fields" still respects the user's edits.
  await page.getByRole('button', { name: /Áp dụng các trường an toàn/ }).click();
  await expect(page.locator('#title')).toHaveValue('Tên do thủ thư sửa');

  expect(writes, 'no book is created or updated before the user saves').toEqual([]);
});

test('a failed scan shows a readable error and leaves the page usable', async ({ page }) => {
  await page.route('**/book-metadata/scan-images', (route) => route.fulfill({
    status: 429, json: { message: 'Dịch vụ AI đang quá tải. Vui lòng thử lại sau ít phút.', code: 'AI_RATE_LIMITED' },
  }));
  await openAiImport(page);
  await page.getByLabel('Chọn ảnh bìa trước').setInputFiles(FRONT);
  await page.getByRole('button', { name: 'Quét và trích xuất bằng AI' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Dịch vụ AI đang quá tải' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Kết quả AI OCR' })).toHaveCount(0);
  // Nothing is locked: photos stay, the ISBN lookup box still works.
  await expect(page.getByAltText('Xem trước bìa trước')).toBeVisible();
  await page.locator('#isbnLookup').fill('9786041234567');
  await expect(page.locator('#isbnLookup')).toHaveValue('9786041234567');
  await expect(page.getByRole('button', { name: 'Quét và trích xuất bằng AI' })).toBeEnabled();
});

test('a non-image file is refused before upload', async ({ page }) => {
  let called = false;
  await page.route('**/book-metadata/scan-images', (route) => { called = true; return route.abort(); });
  await openAiImport(page);
  await page.getByLabel('Chọn ảnh bìa trước').setInputFiles({ name: 'notes.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.7') });
  await expect(page.getByRole('alert').filter({ hasText: 'Chỉ nhận ảnh JPG, PNG hoặc WebP' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Quét và trích xuất bằng AI' })).toBeDisabled();
  expect(called).toBe(false);
});
