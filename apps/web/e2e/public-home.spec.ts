import { test, expect, type Page } from '@playwright/test';
import { loginCustomer } from './helpers';

/**
 * Public home page: the two-mode hero search, cover search entry, ranking tabs,
 * branches, and the signed-in reader's "Sách của tôi" panel.
 */

/**
 * The ranking band only exists when loan / rating signals point at real catalog books.
 * A fresh CI stack has none (the demo borrow seed's loans and reviews use placeholder
 * book ids, and the band rightly hides empty rankings), so ranking UI tests serve the
 * real /public/catalog/home answer with deterministic rankings built from its real books.
 */
async function withRankings(page: Page, { borrowed, rated }: { borrowed: boolean; rated: boolean }) {
  await page.route('**/public/catalog/home', async (route) => {
    const response = await route.fetch();
    const home = await response.json();
    const seen = new Set<string>();
    const books = [...home.new_arrivals, ...home.available_now]
      .filter((book: { id: string }) => !seen.has(book.id) && seen.add(book.id)).slice(0, 4);
    expect(books.length, 'the seeded catalog has books').toBeGreaterThan(1);
    const ranked = (signals: (index: number) => Record<string, number>) =>
      books.map((book: { signals?: object }, index: number) => ({ ...book, signals: { ...book.signals, ...signals(index) } }));
    home.most_borrowed = borrowed ? ranked((i) => ({ borrow_count: 20 - i })) : [];
    home.top_rated = rated ? ranked((i) => ({ rating_avg: 5 - i * 0.25, rating_count: 3 })) : [];
    await route.fulfill({ response, json: home });
  });
}

test.describe('Home (anonymous)', () => {
  test('hero search switches to AI mode and asks /discover', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Mô tả bằng lời (AI)' }).click();
    const box = page.getByRole('textbox', { name: 'Mô tả cuốn sách bạn muốn đọc' }).first();
    await expect(box).toBeFocused();
    await box.fill('tiểu thuyết nhẹ nhàng về tuổi thơ');
    await box.press('Enter');
    await expect(page).toHaveURL(/\/discover\?q=/);
  });

  test('cover search asks a visitor to log in and returns to the scan page', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Tìm sách bằng ảnh bìa' }).click();
    await expect(page).toHaveURL(/\/customer\/login\?returnUrl=%2Fcustomer%2Fscan-cover/);
  });

  test('ranking band tabs follow the arrow keys', async ({ page }) => {
    await withRankings(page, { borrowed: true, rated: true });
    await page.goto('/');
    const borrowed = page.getByRole('tab', { name: 'Mượn nhiều' });
    await borrowed.focus();
    await page.keyboard.press('ArrowRight');
    const rated = page.getByRole('tab', { name: 'Đánh giá cao' });
    await expect(rated).toBeFocused();
    await expect(rated).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('heading', { name: 'Bạn đọc đánh giá cao' })).toBeVisible();
  });

  test('with only one ranking there are no tabs, just that ranking', async ({ page }) => {
    await withRankings(page, { borrowed: true, rated: false });
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Được mượn nhiều nhất' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Mượn nhiều' })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Bạn đọc đánh giá cao' })).toHaveCount(0);
  });

  test('"Sách mới về" loops: left of the first book is the last one, and it settles back on the middle copy', async ({ page }) => {
    await page.goto('/');
    const section = page.locator('section[aria-labelledby="sach-moi"]');
    const track = section.locator('ul[tabindex="0"]');
    await track.scrollIntoViewIfNeeded();
    const counter = section.locator('p.font-mono').last();
    await expect(counter).toHaveText(/^1 \/ (\d+)$/);
    const total = Number((await counter.textContent())!.split('/')[1].trim());

    await track.focus();
    await page.keyboard.press('ArrowLeft');
    await expect(counter).toHaveText(`${total} / ${total}`);

    // After settling, the centred cover is a real (not aria-hidden) item of the middle copy.
    await expect.poll(async () => track.evaluate((ul) => {
      const centre = ul.scrollLeft + ul.clientWidth / 2;
      const items = Array.from(ul.children) as HTMLElement[];
      const nearest = items.reduce((best, item) => (
        Math.abs(item.offsetLeft + item.offsetWidth / 2 - centre) < Math.abs(best.offsetLeft + best.offsetWidth / 2 - centre) ? item : best));
      return nearest.getAttribute('aria-hidden');
    }), { timeout: 5_000 }).toBeNull();
    await expect(track.locator('li:not([aria-hidden]) a[aria-current="true"]')).toHaveCount(1);
  });

  test('branches section lists real branches and no reader panel is shown', async ({ page }) => {
    await page.goto('/');
    const section = page.locator('section[aria-labelledby="chi-nhanh"]');
    await expect(section.getByRole('heading', { name: 'Đến thư viện gần bạn' })).toBeVisible();
    await expect(section.getByRole('link', { name: /^Chỉ đường đến / }).first()).toHaveAttribute('href', /google\.com\/maps\/search/);
    await expect(page.locator('#sach-cua-toi')).toHaveCount(0);
  });
});

test('signed-in reader sees "Sách của tôi" on the home page', async ({ page }) => {
  await loginCustomer(page);
  await page.goto('/');
  const panel = page.locator('section[aria-labelledby="sach-cua-toi"]');
  await expect(panel.getByRole('heading', { name: /^Chào / })).toBeVisible();
  await expect(panel.getByRole('link', { name: /Mở Sách của tôi/ })).toHaveAttribute('href', '/customer');
});
