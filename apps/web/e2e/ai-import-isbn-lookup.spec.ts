import { expect, test, type Browser, type Page } from '@playwright/test';
import { loginStaff } from './helpers';

/**
 * AI Import - two-round ISBN search, end to end with ONE real book:
 * "Bé ngoan học lễ phép" (Đinh Tị Books, EAN 8935212359658).
 *
 * Live: browser -> API Gateway -> ai-service -> the real book sites, and the
 * save writes that book into the local catalog. So it is opt-in and never runs
 * in CI:  E2E_LIVE_BOOK_SOURCES=1 pnpm test:e2e ai-import-isbn-lookup
 * Needs the ai-service (compose profile `ai`) and internet access.
 *
 * Flows: lookup with a hyphenated code -> save into the catalog -> scan again
 * (duplicate warning) -> the catalog itself identifies the code (source 0) ->
 * a code no source carries -> an invalid code.
 */
const LIVE = process.env.E2E_LIVE_BOOK_SOURCES === '1';
const GATEWAY = process.env.GATEWAY_URL || 'http://localhost:3000';
const CODE = '8935212359658';
const TITLE = 'Bé ngoan học lễ phép';
const UNKNOWN_CODE = '8935270704704';

test.describe.configure({ mode: 'serial' });
test.skip(!LIVE, 'Live sources: set E2E_LIVE_BOOK_SOURCES=1 (needs ai-service + internet; writes one book)');

type Lookup = {
  found: boolean; title: string | null; message?: string;
  verification?: { round1: { matchedSource: string | null; attempts: { source: string; status: string }[] };
    round2Ran: boolean; totalSourcesChecked: number; foundSources: string[]; crossSourceVerified: boolean };
  sources?: { name: string; status: string; round?: number; verification?: string }[];
};

let page: Page;
let identifiedBy: string | null = null;

// One login for the whole file: the auth limiter allows 10 logins / 15 min / IP.
test.beforeAll(async ({ browser }: { browser: Browser }) => {
  page = await (await browser.newContext()).newPage();
  // A streamed (SSE) body cannot be read back through the DevTools protocol, so the page
  // keeps a copy: response.clone() is read in parallel and never slows the stream the app reads.
  await page.addInitScript(() => {
    const w = window as unknown as { __lookupStreams: string[] };
    w.__lookupStreams = [];
    const original = window.fetch.bind(window);
    window.fetch = async (...args: Parameters<typeof fetch>) => {
      const response = await original(...args);
      const url = String(args[0] instanceof Request ? args[0].url : args[0]);
      if (url.includes('/enrich-book-after-isbn/stream') && response.ok) {
        response.clone().text().then((text) => w.__lookupStreams.push(text)).catch(() => {});
      }
      return response;
    };
  });
  await loginStaff(page, 'manager01');
});

test.afterAll(async () => {
  await page?.context().close();
});

async function openAiImport() {
  await page.goto('/ai-import');
  await expect(page.getByPlaceholder('ISBN-10 hoặc ISBN-13')).toBeVisible();
}

/** Narrow screens put every pane in tabs; wide ones keep the metadata open beside a tabbed panel. */
async function showPane(name: 'Metadata' | 'Nguồn' | 'Kiểm duyệt') {
  const tab = page.getByRole('tab', { name: new RegExp('^' + name) });
  if (await tab.count()) await tab.first().click();
}

/** The page asks the SSE endpoint (live progress, then one `result` event) and falls back
 *  to the plain JSON endpoint; either way this returns the lookup and the progress seen. */
type Progress = { type: string; stage?: string; source?: string; state?: string };
async function lookUp(code: string): Promise<Lookup & { progress: Progress[] }> {
  await page.getByPlaceholder('ISBN-10 hoặc ISBN-13').fill(code);
  const seen = await page.evaluate(() => (window as unknown as { __lookupStreams: string[] }).__lookupStreams.length);
  const streamed = page.waitForFunction((count) => {
    const streams = (window as unknown as { __lookupStreams: string[] }).__lookupStreams;
    return streams.length > count ? streams[streams.length - 1] : null;
  }, seen, { timeout: 90_000 }).then((handle) => handle.jsonValue() as Promise<string>);
  const plain = page.waitForResponse((r) => r.url().endsWith('/enrich-book-after-isbn') && r.request().method() === 'POST', { timeout: 90_000 })
    .then((r) => r.text());
  await page.getByRole('button', { name: 'Tra cứu', exact: true }).click();
  const body = await Promise.any([streamed, plain]);
  if (!body.trimStart().startsWith('{')) {
    const events = body.split(/\r?\n\r?\n/).map((block) => ({
      event: /^event: (.*)$/m.exec(block)?.[1], data: /^data: (.*)$/m.exec(block)?.[1],
    }));
    const result = events.find((e) => e.event === 'result');
    expect(result, 'the progress stream ends with one result event').toBeTruthy();
    return { ...(JSON.parse(result!.data!).lookup as Lookup), progress: events.filter((e) => e.event === 'progress').map((e) => JSON.parse(e.data!) as Progress) };
  }
  return { ...(JSON.parse(body).lookup as Lookup), progress: [] };
}

test('1. tra mã có gạch ngang: Vòng 1 khớp đúng mã, Vòng 2 đối chiếu, form điền đủ', async () => {
  test.setTimeout(150_000);
  await openAiImport();
  const lookup = await lookUp('893-5212-35965-8');

  expect(lookup.found).toBe(true);
  expect(lookup.title).toContain(TITLE);
  const round1 = lookup.verification!.round1;
  identifiedBy = round1.matchedSource;
  // First run: Đinh Tị; once a run has saved the book, the catalog answers first.
  expect(['dinhTi', 'catalog']).toContain(identifiedBy);
  expect(lookup.sources!.find((s) => s.name === identifiedBy)).toMatchObject(
    { status: 'SUCCESS', round: 1, verification: 'CODE_MATCH' });
  expect(lookup.verification!.round2Ran).toBe(true);
  expect(lookup.verification!.totalSourcesChecked).toBeGreaterThanOrEqual(5);
  // Live progress reached the browser: per source, unless the answer came from the cache (no source asked).
  expect(lookup.progress.length, 'progress events reached the browser').toBeGreaterThan(0);
  if (!lookup.progress.some((e) => e.stage === 'cache')) {
    expect(lookup.progress.filter((e) => e.type === 'source' && e.state === 'done').length).toBeGreaterThanOrEqual(5);
  }
  test.info().annotations.push({ type: 'sources',
    description: `round1=${identifiedBy}; found=${lookup.verification!.foundSources.join(',')}` });

  await showPane('Metadata');
  await expect(page.locator('#translator')).toHaveValue(/Hà Giang/);
  await expect(page.locator('#publisher')).toHaveValue('NXB Hà Nội');
  await expect(page.locator('#pageCount')).toHaveValue('10');
  await expect(page.locator('#authors')).toHaveValue(/Khánh Vân/);
  // Cover from the product gallery, allowed by the CSP, actually decoded.
  const cover = page.getByRole('img', { name: /Bìa sách/ }).first();
  await expect(cover).toBeVisible();
  await expect.poll(() => cover.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);

  // The source that identified the book, with its round and verification, in the Sources pane.
  await showPane('Nguồn');
  const identifying = page.getByTestId(`source-row-${identifiedBy}`);
  await expect(identifying).toContainText('Tìm thấy');
  await expect(identifying).toContainText('Vòng 1');
  await expect(identifying).toContainText('Khớp mã chính xác');
  await expect(page.getByText(/Sách được xác định bởi/)).toBeVisible();
});

test('2. lưu sách vào kho sau khi duyệt chuẩn hóa', async () => {
  test.setTimeout(150_000);
  test.skip(identifiedBy === 'catalog', 'Sách đã có trong kho từ lần chạy trước');
  await openAiImport();
  await lookUp(CODE);
  await showPane('Kiểm duyệt');
  // Keep the names as written (no new authority entries) for every pending group.
  const accept = page.getByRole('button', { name: 'Chấp nhận', exact: true });
  await expect(accept.first()).toBeVisible({ timeout: 30_000 });
  for (let guard = 0; guard < 10 && await accept.count(); guard += 1) {
    await accept.first().click();
    await page.waitForTimeout(300);
  }
  await page.getByRole('button', { name: 'Lưu sách' }).click();
  await expect(page.getByText('Đã lưu sách với metadata ISBN')).toBeVisible({ timeout: 30_000 });
});

test('3. quét lại cùng mã: cảnh báo sách đã có trong kho', async () => {
  test.setTimeout(150_000);
  await openAiImport();
  const lookup = await lookUp(CODE);
  expect(lookup.found).toBe(true);
  await showPane('Kiểm duyệt');
  await expect(page.getByText('Chọn cách xử lý với sách tương tự trong catalog trước khi lưu.'))
    .toBeVisible({ timeout: 30_000 });
});

test('4. Kho SmartBook (nguồn số 0) tự xác định mã đã lưu', async () => {
  test.setTimeout(150_000);
  const token = await page.evaluate(() => localStorage.getItem('token'));
  // generateVietnameseSummary=true is another cache key: a fresh two-round lookup.
  const response = await page.request.post(`${GATEWAY}/ai/lookup-book-by-isbn`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { isbn: CODE, generateVietnameseSummary: true },
    timeout: 120_000,
  });
  expect(response.ok()).toBe(true);
  const lookup = (await response.json()) as Lookup;
  expect(lookup.verification!.round1.matchedSource).toBe('catalog');
  expect(lookup.verification!.round1.attempts[0]).toMatchObject({ source: 'catalog', status: 'SUCCESS' });
  expect(lookup.title).toContain(TITLE);
});

test('5. mã không nguồn nào có: không có metadata, gợi ý chụp trang xuất bản', async () => {
  test.setTimeout(150_000);
  await openAiImport();
  const lookup = await lookUp(UNKNOWN_CODE);
  expect(lookup.found).toBe(false);
  expect(lookup.title).toBeNull();
  expect(lookup.message).toBe('Không tìm thấy thông tin sách theo mã đã nhập.');
  expect(lookup.verification!.round2Ran).toBe(false);

  const toast = page.locator('[data-sonner-toast]').filter({ hasText: 'Không tìm thấy thông tin sách theo mã đã nhập.' });
  await expect(toast).toBeVisible();
  await toast.getByRole('button', { name: 'Chụp trang xuất bản' }).click();
  await expect(page.getByTestId('ocr-slot-copyright_page')).toBeInViewport();
});

test('7. mã Văn Lang: chỉ mục mã vạch tìm được ở Vòng 1, đọc khối thông số', async () => {
  test.setTimeout(150_000);
  await openAiImport();
  // "Phật Giáo Có Là Tôn Giáo Không?" - only Văn Lang carries this code (its /search
  // is robots-disallowed; the store's product feed index finds it).
  const lookup = await lookUp('8935074112750');
  expect(lookup.found).toBe(true);
  expect(lookup.verification!.round1.matchedSource).toBe('vanLang');
  expect(lookup.sources!.find((s) => s.name === 'vanLang')).toMatchObject({ status: 'SUCCESS', verification: 'CODE_MATCH' });

  await showPane('Metadata');
  await expect(page.locator('#title')).toHaveValue('Phật Giáo Có Là Tôn Giáo Không?');
  await expect(page.locator('#authors')).toHaveValue('Alan Watts');
  await expect(page.locator('#translator')).toHaveValue('Hạnh Duyên');
  await expect(page.locator('#publisher')).toHaveValue('NXB Hồng Đức');
  await expect(page.locator('#pageCount')).toHaveValue('172');
  const cover = page.getByRole('img', { name: /Bìa sách/ }).first();
  await expect.poll(() => cover.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
  await cover.scrollIntoViewIfNeeded();
  const shot = test.info().outputPath('van-lang-lookup.png');
  await page.screenshot({ path: shot });
  await test.info().attach('van-lang-lookup', { path: shot, contentType: 'image/png' });
});

test('8. mã Fahasa: tìm trang qua web search, đọc bảng thông số', async () => {
  test.setTimeout(150_000);
  await openAiImport();
  // "Đắc Nhân Tâm" (AZ Việt Nam, 2023) - only Fahasa carries this code. Fahasa depends on
  // web search to find the page and on Cloudflare letting plain HTTP through: if this
  // fails, check the `fahasa` source status (NOT_FOUND / PAUSED) before blaming the code.
  const lookup = await lookUp('8935325011894');
  expect(lookup.found).toBe(true);
  expect(lookup.verification!.round1.matchedSource).toBe('fahasa');

  await showPane('Metadata');
  await expect(page.locator('#title')).toHaveValue(/Đắc Nhân Tâm/);
  await expect(page.locator('#authors')).toHaveValue(/Dale Carnegie/);
  await expect(page.locator('#translator')).toHaveValue('Tín Nghĩa');
  await expect(page.locator('#publisher')).toHaveValue('Thế Giới');
  await expect(page.locator('#pageCount')).toHaveValue('360');
  const cover = page.getByRole('img', { name: /Bìa sách/ }).first();
  await expect.poll(() => cover.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
  await page.locator('#authors').evaluate((el) => el.scrollIntoView({ block: 'center' }));
  const shot = test.info().outputPath('fahasa-lookup.png');
  await page.screenshot({ path: shot });
  await test.info().attach('fahasa-lookup', { path: shot, contentType: 'image/png' });
});

test('9. mã IPM: chỉ mục nhà phát hành tìm được sách mới mà web search chưa có', async () => {
  test.setTimeout(150_000);
  await openAiImport();
  // "Your Name" (IPM, 2026 printing) - not indexed by any search engine yet; IPM's own
  // product feed (barcode index) identifies it.
  const lookup = await lookUp('8935250722483');
  expect(lookup.found).toBe(true);
  expect(lookup.verification!.round1.matchedSource).toBe('ipm');

  await showPane('Metadata');
  await expect(page.locator('#title')).toHaveValue('Your Name');
  await expect(page.locator('#authors')).toHaveValue('Shinkai Makoto');
  await expect(page.locator('#publisher')).toHaveValue('Hồng Đức');
  const cover = page.getByRole('img', { name: /Bìa sách/ }).first();
  await expect.poll(() => cover.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
  await page.locator('#authors').evaluate((el) => el.scrollIntoView({ block: 'center' }));
  const shot = test.info().outputPath('ipm-lookup.png');
  await page.screenshot({ path: shot });
  await test.info().attach('ipm-lookup', { path: shot, contentType: 'image/png' });
});

test('6. mã sai định dạng: không gọi nguồn nào', async () => {
  test.setTimeout(90_000);
  await openAiImport();
  await page.getByPlaceholder('ISBN-10 hoặc ISBN-13').fill('12345');
  await expect(page.getByText(/không phải độ dài ISBN/)).toBeVisible();
  const lookup = await lookUp('12345');
  expect(lookup.found).toBe(false);
  expect(lookup.verification).toBeUndefined(); // rejected before Round 1
});
