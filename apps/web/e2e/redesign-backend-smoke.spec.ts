import { expect, test, type Page } from '@playwright/test';
import { loginStaff } from './helpers';

/**
 * Pages whose structure was redesigned (presentation only) must still talk to the real
 * backend the same way: every API read succeeds, nothing crashes, and merely viewing a
 * page never writes. Add a route here when its redesign lands.
 * `open` names a row button that opens a read-only detail view, clicked when a row exists.
 */
const REDESIGNED_PAGES: Array<{ route: string; open?: RegExp }> = [
  { route: '/warehouses' },
  { route: '/purchase-orders' },
  { route: '/orders' },
  { route: '/inventory' },
  { route: '/order-requests' },
  { route: '/picking', open: /^(Xem|Bắt đầu|Tiếp tục)/ },
  { route: '/outbound', open: /^(Xem|Xuất kho)/ },
  { route: '/receiving-check' },
  { route: '/putaway', open: /^(Chi tiết|Cất hàng)/ },
  { route: '/receiving-putaway' },
  { route: '/movements' },
  { route: '/shelves' },
  { route: '/stock-audits', open: /^AUD-/ },
  { route: '/exception-reports' },
  { route: '/my-warehouse-tasks' },
  { route: '/my-purchase-requests' },
  { route: '/staff-tasks' },
  { route: '/my-exception-reports' },
  { route: '/catalog', open: /^Xem chi tiết sách/ },
  { route: '/recommendations' },
  { route: '/purchase-requests' },
  { route: '/supplier-deliveries', open: /^INV-/ },
  { route: '/suppliers' },
];

// POST endpoints that only read: storage-suggestions ranks locations (DB reads + Redis cache, no row written).
const READ_ONLY_POSTS = new Set(['/api/storage-suggestions']);

/** Records failed API calls, attempted writes and page crashes from here on. */
async function watchBackend(page: Page) {
  const problems: string[] = [];
  // Viewing must not write: block and report any other non-GET API call after login.
  await page.route('**/api/**', (route) => {
    const request = route.request();
    if (request.method() === 'GET' || READ_ONLY_POSTS.has(new URL(request.url()).pathname)) return route.continue();
    problems.push(`write attempted: ${request.method()} ${new URL(request.url()).pathname}`);
    return route.abort();
  });
  page.on('response', (response) => {
    if (response.url().includes('/api/') && response.status() >= 400) {
      problems.push(`${response.status()} ${response.request().method()} ${new URL(response.url()).pathname}`);
    }
  });
  page.on('pageerror', (error) => problems.push(`page error: ${error.message}`));
  return problems;
}

test('redesigned staff pages still load their backend data', async ({ page }) => {
  test.setTimeout(180_000);
  await loginStaff(page);
  const problems = await watchBackend(page);

  for (const { route, open } of REDESIGNED_PAGES) {
    const before = problems.length;
    await page.goto(route);
    await page.waitForLoadState('networkidle');
    await expect(page.locator('main h1').first(), `${route} renders its heading`).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('main'), `${route} did not fall into the error boundary`).not.toContainText('Đã xảy ra lỗi');

    if (open) {
      const rows = page.locator('main tbody');
      const rowButton = rows.getByRole('button', { name: open }).or(rows.getByRole('link', { name: open })).first();
      if (await rowButton.count()) {
        const listHeading = await page.locator('main h1').first().textContent();
        await rowButton.click();
        // Client-side navigation: networkidle alone can resolve before the detail fetch starts,
        // so wait until the detail's own heading replaces the list heading.
        await expect(page.locator('main h1').first(), `${route} detail renders`).not.toHaveText(listHeading ?? '', { timeout: 15_000 });
        await page.waitForLoadState('networkidle');
      }
    }
    expect.soft(problems.slice(before), `${route} backend calls`).toEqual([]);
  }
});
