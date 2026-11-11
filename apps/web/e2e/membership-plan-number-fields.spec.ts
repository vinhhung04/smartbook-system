import { expect, test, type Locator, type Page } from '@playwright/test';
import { loginStaff } from './helpers';

// Number fields in the membership plan form start at "0". Typing into one must show
// only what was typed ("5000", not "05000"), wherever the click left the caret, and
// focus must stay in the field between keys. Nothing is saved: each test closes the
// form with Escape.

async function openNewPlanForm(page: Page) {
  await page.goto('/membership-plans');
  await page.getByRole('button', { name: 'Gói mới' }).first().click();
  const deposit = page.locator('#plan-deposit');
  await expect(deposit).toBeVisible();
  await expect(deposit).toHaveValue('0');
  return deposit;
}

async function typeKeys(page: Page, field: Locator, keys: string) {
  for (const key of keys) {
    await page.keyboard.press(key);
    await expect(field).toBeFocused();
  }
}

test.describe('membership plan form number fields', () => {
  test.beforeEach(async ({ page }) => {
    await loginStaff(page, 'librarian01');
  });

  test('clicking a 0 field and typing shows only the typed number', async ({ page }) => {
    const deposit = await openNewPlanForm(page);
    await deposit.click();
    await typeKeys(page, deposit, '5000');
    await expect(deposit).toHaveValue('5000');

    const price = page.locator('#plan-price');
    await price.click();
    await typeKeys(page, price, '11');
    await expect(price).toHaveValue('11');

    await page.keyboard.press('Escape');
    await expect(deposit).toBeHidden();
  });

  test('works with the caret placed before the 0', async ({ page }) => {
    const deposit = await openNewPlanForm(page);
    await deposit.click({ position: { x: 4, y: 10 } });
    await typeKeys(page, deposit, '7');
    await expect(deposit).toHaveValue('7');
    await page.keyboard.press('Escape');
  });

  test('a 0 left in front of the caret is dropped while typing', async ({ page }) => {
    const deposit = await openNewPlanForm(page);
    await deposit.click();
    // Undo the select-on-focus: caret after the "0", as when clicking an already focused field.
    await page.keyboard.press('End');
    await typeKeys(page, deposit, '30000');
    await expect(deposit).toHaveValue('30000');
    await page.keyboard.press('Escape');
  });
});
