import { randomInt } from 'node:crypto';
import { test, expect } from '@playwright/test';
import { loginStaff } from './helpers';

// A book created quickly at receiving is "Chưa hoàn chỉnh"; it is completed through the AI import
// (prefilled with its code, so the duplicate check targets that book) instead of being re-added.

function randomIsbn13() {
  const core = `978${Array.from({ length: 9 }, () => randomInt(10)).join('')}`;
  const sum = [...core].reduce((total, digit, index) => total + Number(digit) * (index % 2 ? 3 : 1), 0);
  return `${core}${(10 - (sum % 10)) % 10}`;
}

test('incomplete book: "Hoàn thiện bằng AI" opens the AI import prefilled with its code', async ({ page }) => {
  const isbn = randomIsbn13();
  const title = `Sách chưa hoàn chỉnh ${isbn.slice(-5)}`;
  await loginStaff(page, 'hung');
  const token = await page.evaluate(() => localStorage.getItem('token'));
  const created = await page.request.post(`${process.env.GATEWAY_URL || 'http://localhost:3000'}/api/books/incomplete`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { isbn13: isbn, title, price: 0 },
  });
  expect(created.status()).toBe(201);
  const bookId = (await created.json()).data.book_id as string;

  // from the catalog list
  await page.goto('/catalog');
  await page.getByRole('button', { name: /Chưa hoàn chỉnh/ }).first().click();
  const row = page.getByRole('row').filter({ hasText: title });
  await row.getByRole('link', { name: 'Hoàn thiện bằng AI' }).click();
  await expect(page).toHaveURL(new RegExp(`/ai-import\\?isbn=${isbn}$`));
  await expect(page.locator(`input[value="${isbn}"]`).first()).toBeVisible({ timeout: 15_000 });

  // from the book detail banner
  await page.goto(`/book/${bookId}`);
  await expect(page.getByText(/Sách này chưa hoàn chỉnh/)).toBeVisible({ timeout: 20_000 });
  await page.getByRole('link', { name: 'Hoàn thiện bằng AI' }).click();
  await expect(page).toHaveURL(new RegExp(`/ai-import\\?isbn=${isbn}$`));
});
