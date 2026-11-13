import { expect, test, type Browser, type Page } from '@playwright/test';
import { loginCustomer, loginStaff } from './helpers';

/**
 * Layout on a Full HD (1920×1080) screen, as the browser actually sees it under the
 * three common Windows display-scaling levels, with the browser's own chrome removed.
 * The developer's monitor size never matters: Playwright sets these CSS viewports itself.
 */
const FULL_HD_VIEWPORTS = [
  { name: 'Full HD 100%', width: 1920, height: 945 },
  { name: 'Full HD 125%', width: 1536, height: 730 },
  { name: 'Full HD 150%', width: 1280, height: 595 },
] as const;

const STAFF_ROUTES = ['/dashboard', '/receiving-smart', '/purchase-requests', '/exception-reports', '/borrow/fines', '/shelves', '/warehouses'];
const CUSTOMER_ROUTES = ['/customer', '/customer/fines', '/customer/membership', '/customer/notifications'];
const PUBLIC_ROUTES = ['/', '/books', '/branches'];

/** Sideways page scroll, or a heading/control/table head that runs off screen or is cut off. */
async function layoutProblems(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const problems: string[] = [];
    if (document.documentElement.scrollWidth > vw) {
      problems.push(`page scrolls sideways (${document.documentElement.scrollWidth}px > ${vw}px)`);
    }
    // The staff shell scrolls inside <main>, so <main> itself must not scroll sideways either.
    const root = document.querySelector('main') ?? document.body;
    if (root.scrollWidth > root.clientWidth + 1) {
      problems.push(`main area scrolls sideways (${root.scrollWidth}px > ${root.clientWidth}px)`);
    }
    // Carousels and wide tables scroll inside their own box on purpose; <main> and its
    // ancestors are the page's scroller, not such a box, so the walk stops there.
    const insideScroller = (el: Element) => {
      for (let node = el.parentElement; node && node !== root; node = node.parentElement) {
        if (getComputedStyle(node).overflowX !== 'visible') return true;
      }
      return false;
    };
    for (const el of root.querySelectorAll<HTMLElement>('h1, h2, h3, button, th, a')) {
      const box = el.getBoundingClientRect();
      if (box.width === 0 || insideScroller(el)) continue;
      const label = `${el.tagName.toLowerCase()} "${(el.textContent ?? '').trim().slice(0, 40)}"`;
      if (box.right > vw + 1) problems.push(`${label} ends at ${Math.round(box.right)}px, past ${vw}px`);
      const style = getComputedStyle(el);
      // An ellipsis is a deliberate cut; anything else that overflows hides text.
      if (style.overflow !== 'visible' && style.textOverflow !== 'ellipsis' && el.scrollWidth > el.clientWidth + 1) {
        problems.push(`${label} text is clipped`);
      }
    }
    return problems;
  });
}

/** Load each route once, then check it at every Full HD viewport by resizing in place. */
async function checkRoutes(page: Page, routes: string[]) {
  for (const route of routes) {
    await page.setViewportSize({ width: 1920, height: 945 });
    await page.goto(route);
    await page.waitForLoadState('networkidle');
    await expect(page.locator('h1').first(), `${route} renders its heading`).toBeVisible({ timeout: 15_000 });
    for (const viewport of FULL_HD_VIEWPORTS) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.waitForTimeout(300); // let resize-driven layout settle
      expect.soft(await layoutProblems(page), `${route} at ${viewport.name} (${viewport.width}×${viewport.height})`).toEqual([]);
    }
  }
}

async function freshPage(browser: Browser) {
  const context = await browser.newContext();
  return { context, page: await context.newPage() };
}

test.describe('Full HD layout', () => {
  test('staff screens fit Full HD at 100%, 125% and 150% scaling', async ({ browser }) => {
    const { context, page } = await freshPage(browser);
    await loginStaff(page);
    await checkRoutes(page, STAFF_ROUTES);
    await context.close();
  });

  test('reader portal fits Full HD at 100%, 125% and 150% scaling', async ({ browser }) => {
    const { context, page } = await freshPage(browser);
    await loginCustomer(page);
    await checkRoutes(page, CUSTOMER_ROUTES);
    await context.close();
  });

  test('public site fits Full HD at 100%, 125% and 150% scaling', async ({ browser }) => {
    const { context, page } = await freshPage(browser);
    await checkRoutes(page, PUBLIC_ROUTES);
    await context.close();
  });
});
