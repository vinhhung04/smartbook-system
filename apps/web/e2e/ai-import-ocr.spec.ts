import { expect, test, type Page, type Route } from '@playwright/test';
import { DEMO_PASSWORD, loginStaff } from './helpers';

/**
 * AI Import - multi-image OCR.
 *
 * UI tests mock BOTH OCR endpoints (`capabilities` and `scan-images`): they are
 * deterministic, cost nothing on OpenRouter and do not depend on the optional
 * ai-service (compose profile `ai`, not started by CI's E2E job). Auth, the
 * duplicate check and the rest of the page are the running stack. Catalog
 * writes are watched: a scan or an "apply" must never create or update a book.
 *
 * The last describe block is the integration check of the real path (browser ->
 * API Gateway -> ai-service) with no mocks; it asserts the contract for both
 * deployments: ai-service up (real answers, auth enforced before any inference)
 * or not started (the gateway's documented 503 AI_UNAVAILABLE, and the page
 * says so instead of hiding the feature).
 */
const GATEWAY = process.env.GATEWAY_URL || 'http://localhost:3000';
const CAPABILITIES = {
  enabled: true, imageKinds: ['front_cover', 'back_cover', 'copyright_page'], maxImages: 3,
  maxFileBytes: 8 * 1024 * 1024, maxTotalBytes: 8 * 1024 * 1024, acceptedTypes: ['image/jpeg', 'image/png', 'image/webp'],
  model: 'qwen/qwen3.7-flash',
};
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

async function mockCapabilities(page: Page, answer: (route: Route) => Promise<void> = (route) => route.fulfill({ json: CAPABILITIES })) {
  await page.route('**/book-metadata/capabilities', answer);
}

async function openAiImport(page: Page) {
  await mockCapabilities(page);
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

  // New photo: the old result belongs to the old photo set - shown, but nothing of it can be applied.
  await front.setInputFiles(FRONT);
  await expect(page.getByText('Ảnh đã thay đổi sau lần quét này')).toBeVisible();
  await expect(page.getByRole('button', { name: /Áp dụng các trường an toàn/ })).toBeDisabled();

  // Second scan; while it runs the user keeps typing.
  await page.getByRole('button', { name: 'Quét và trích xuất bằng AI' }).click();
  await expect(page.getByRole('button', { name: 'Đang quét…' })).toBeDisabled();
  await page.locator('#publisher').fill('NXB do thủ thư nhập');
  release();
  await expect(page.getByRole('button', { name: 'Quét và trích xuất bằng AI' })).toBeEnabled();
  await expect(page.getByText('Ảnh đã thay đổi sau lần quét này')).toHaveCount(0);
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

test('readings that differ only in tone marks are not filled; both spellings are one click away', async ({ page }) => {
  const options = [{ source: 'images:front_cover', value: 'Pháp sư tiễn táng' }, { source: 'images:copyright_page', value: 'Pháp sư tiến táng' }];
  await page.route('**/book-metadata/scan-images', (route) => route.fulfill({ json: scanResult({
    proposals: {
      ...scanResult().proposals,
      title: proposal('title', 'Pháp sư tiễn táng', 'REVIEW_REQUIRED', false, { reasons: ['DIACRITICS_DIFFER'], options }),
      authorsText: proposal('authorsText', 'Kanehito Yamada', 'EXTRACTED', false, { reasons: ['SINGLE_SOURCE'] }),
    },
  }) }));
  await openAiImport(page);
  await page.getByLabel('Chọn ảnh bìa trước').setInputFiles(FRONT);
  await page.getByRole('button', { name: 'Quét và trích xuất bằng AI' }).click();
  await expect(page.getByRole('region', { name: 'Kết quả AI OCR' })).toBeVisible();
  await expect(page.locator('#title')).toHaveValue('');
  await expect(page.locator('#authors')).toHaveValue('');
  const row = page.getByTestId('ocr-row-title');
  await expect(row.getByText(/khác nhau về dấu tiếng Việt/)).toBeVisible();
  await row.getByRole('button', { name: /Dùng “Pháp sư tiến táng”/ }).click();
  await expect(page.locator('#title')).toHaveValue('Pháp sư tiến táng');
  // Single-photo readings: one explicit bulk confirmation.
  await page.getByRole('button', { name: /Đã so với sách — áp dụng 1 giá trị đọc từ một ảnh/ }).click();
  await expect(page.locator('#authors')).toHaveValue('Kanehito Yamada');
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

test('a cancelled scan never fills the form, even when its answer arrives later', async ({ page }) => {
  const writes = watchCatalogWrites(page);
  let release: () => void = () => {};
  let answered = false;
  await page.route('**/book-metadata/scan-images', async (route) => {
    await new Promise<void>((resolve) => { release = resolve; });
    answered = true;
    await route.fulfill({ json: scanResult() }).catch(() => {}); // the browser may have dropped the request
  });
  await openAiImport(page);
  await page.getByLabel('Chọn ảnh bìa trước').setInputFiles(FRONT);
  await page.getByRole('button', { name: 'Quét và trích xuất bằng AI' }).click();
  await expect(page.getByRole('button', { name: 'Đang quét…' })).toBeDisabled();
  await page.getByRole('button', { name: 'Hủy quét' }).click();
  await expect(page.getByRole('button', { name: 'Quét và trích xuất bằng AI' })).toBeEnabled();
  release();
  await expect.poll(() => answered).toBe(true);
  await page.waitForTimeout(300); // give a (wrongly) accepted late answer time to render
  await expect(page.getByRole('region', { name: 'Kết quả AI OCR' })).toHaveCount(0);
  await expect(page.locator('#title')).toHaveCount(0); // the book form only opens for an accepted scan / lookup
  expect(writes).toEqual([]);
});

test('removing a scanned photo makes the result stale; the same photo again makes it current', async ({ page }) => {
  let scans = 0;
  await page.route('**/book-metadata/scan-images', (route) => { scans += 1; return route.fulfill({ json: scanResult() }); });
  await openAiImport(page);
  await page.getByLabel('Chọn ảnh bìa trước').setInputFiles(FRONT);
  await page.getByLabel('Chọn ảnh bìa sau').setInputFiles(BACK);
  await page.getByRole('button', { name: 'Quét và trích xuất bằng AI' }).click();
  await expect(page.getByRole('region', { name: 'Kết quả AI OCR' })).toBeVisible();
  await page.getByRole('button', { name: 'Xóa ảnh bìa sau' }).click();
  await expect(page.getByText('Ảnh đã thay đổi sau lần quét này')).toBeVisible();
  await expect(page.getByTestId('ocr-row-pageCount').getByRole('button', { name: /Dùng “238”/ })).toBeDisabled();
  // Identity is the photo's content: picking the very same file again restores the scanned set.
  await page.getByLabel('Chọn ảnh bìa sau').setInputFiles(BACK);
  await expect(page.getByText('Ảnh đã thay đổi sau lần quét này')).toHaveCount(0);
  await page.getByRole('button', { name: 'Quét và trích xuất bằng AI' }).click();
  await expect(page.getByText('Ảnh chưa thay đổi')).toBeVisible();
  expect(scans).toBe(1);
});

test('OCR unavailable: the page says so, offers a retry, and the rest of AI Import keeps working', async ({ page }) => {
  let healthy = false;
  let scans = 0;
  await page.route('**/book-metadata/scan-images', (route) => { scans += 1; return route.abort(); });
  await mockCapabilities(page, (route) => healthy
    ? route.fulfill({ json: CAPABILITIES })
    : route.fulfill({ status: 503, json: { message: 'AI tạm thời không khả dụng', code: 'AI_UNAVAILABLE' } }));
  await loginStaff(page);
  await page.goto('/ai-import');
  await expect(page.getByText('Dịch vụ AI OCR hiện không phản hồi')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByLabel('Chọn ảnh bìa trước')).toHaveCount(0); // nothing to upload into
  await page.locator('#isbnLookup').fill('9786041234567');
  await expect(page.locator('#isbnLookup')).toHaveValue('9786041234567');
  healthy = true;
  await page.getByRole('button', { name: 'Thử lại' }).click();
  await expect(page.getByLabel('Chọn ảnh bìa trước')).toBeAttached();
  await expect(page.getByRole('button', { name: 'Quét và trích xuất bằng AI' })).toBeDisabled(); // no photo yet
  expect(scans).toBe(0);
});

test('OCR turned off by configuration is reported as such, without a retry button', async ({ page }) => {
  await mockCapabilities(page, (route) => route.fulfill({ json: { ...CAPABILITIES, enabled: false } }));
  await loginStaff(page);
  await page.goto('/ai-import');
  await expect(page.getByText('đang tắt trong cấu hình')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('button', { name: 'Thử lại' })).toHaveCount(0);
  await expect(page.getByLabel('Chọn ảnh bìa trước')).toHaveCount(0);
});

test.describe('real path: browser -> API Gateway -> ai-service (no mocks)', () => {
  test('capabilities and the scan endpoint keep their contract whether or not ai-service runs', async ({ request }) => {
    const caps = await request.get(`${GATEWAY}/ai/book-metadata/capabilities`);
    expect([200, 503], `unexpected ${caps.status()}`).toContain(caps.status());
    const tiny = { name: 'front.jpg', mimeType: 'image/jpeg', buffer: Buffer.from([0xff, 0xd8, 0xff, 0xd9]) };
    const anonymous = await request.post(`${GATEWAY}/ai/book-metadata/scan-images`, { multipart: { front_cover: tiny } });
    if (caps.status() === 503) {
      // ai-service not started (compose profile `ai` off): the gateway's degraded mode, never a hang or a 500.
      expect((await caps.json()).code).toBe('AI_UNAVAILABLE');
      expect(anonymous.status()).toBe(503);
      return;
    }
    const body = await caps.json();
    expect(typeof body.enabled).toBe('boolean');
    expect(body.imageKinds).toEqual(['front_cover', 'back_cover', 'copyright_page']);
    // Authorization is checked before any upload is read or any model is called.
    expect(anonymous.status()).toBe(body.enabled ? 401 : 404);
    if (!body.enabled) return;
    const login = await (await request.post(`${GATEWAY}/auth/login`, { data: { identifier: 'customer01', password: DEMO_PASSWORD } })).json();
    const customer = await request.post(`${GATEWAY}/ai/book-metadata/scan-images`, {
      multipart: { front_cover: tiny }, headers: { Authorization: `Bearer ${String(login.token || login.data?.token)}` },
    });
    expect(customer.status(), 'a reader may not import books').toBe(403);
    expect((await customer.json()).code).toBe('FORBIDDEN');
  });

  test('the page shows either the OCR card or a clear availability notice, never nothing', async ({ page }) => {
    await loginStaff(page);
    await page.goto('/ai-import');
    await expect(page.getByText('Nhập sách bằng hình ảnh (AI OCR)')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByLabel('Chọn ảnh bìa trước')
      .or(page.getByText(/Dịch vụ AI OCR hiện không phản hồi|đang tắt trong cấu hình/))).toBeAttached();
  });
});
