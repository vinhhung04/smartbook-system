import { test, expect, type Page } from '@playwright/test';
import { loginCustomer, loginStaff } from './helpers';

/**
 * AI refactor Phases 1 + 5: the customer portal has the floating chatbot, a
 * chat reply streams token by token, and both AI screens can cancel a request.
 *
 * `page.route` delivers a body all at once, so the SSE stream is stubbed by
 * replacing window.fetch for one path with a ReadableStream that emits a token
 * every 300 ms and honours the request's AbortSignal (window.__aborted records
 * that the abort reached the stream). Login goes through the real stack.
 */

declare global {
  interface Window { __aborted?: boolean }
}

async function stubSlowStream(page: Page, path: string, tokens: string[], done: object) {
  await page.addInitScript(({ path, tokens, done }) => {
    const original = window.fetch;
    window.__aborted = false;
    window.fetch = (input, init) => {
      if (!String(input).includes(path)) return original(input, init);
      const encoder = new TextEncoder();
      const event = (name: string, data: object) => encoder.encode(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`);
      const body = new ReadableStream({
        start(controller) {
          let i = 0;
          const tick = () => {
            if (init?.signal?.aborted) {
              window.__aborted = true;
              controller.error(new DOMException('aborted', 'AbortError'));
            } else if (i < tokens.length) {
              controller.enqueue(event('token', { text: tokens[i++] }));
              setTimeout(tick, 300);
            } else {
              controller.enqueue(event('done', done));
              controller.close();
            }
          };
          tick();
        },
      });
      return Promise.resolve(new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } }));
    };
  }, { path, tokens, done });
}

test.describe('AI chat streaming and cancellation', () => {
  test('customer chatbot streams the reply token by token', async ({ page }) => {
    const reply = 'Bạn không có sách nào sắp đến hạn.';
    await stubSlowStream(page, '/chat/stream', ['Bạn không ', 'có sách nào ', 'sắp đến hạn.'],
      { reply, ai_provider: 'openrouter', intent: 'X', context_sources: [], retrieval_warnings: [] });
    await loginCustomer(page);

    await page.getByRole('button', { name: 'Mở chatbot AI' }).click();
    await page.getByText('Tôi có sách nào sắp đến hạn trả?').click();

    // a partial reply is on screen before the full one
    await expect(page.getByText('Bạn không có sách nào', { exact: true })).toBeVisible();
    await expect(page.getByText(reply, { exact: true })).toBeVisible();
  });

  test('resetting the chatbot aborts the reply in flight', async ({ page }) => {
    await stubSlowStream(page, '/chat/stream', ['Một ', 'câu ', 'trả ', 'lời ', 'rất ', 'dài.'],
      { reply: 'Một câu trả lời rất dài.', ai_provider: 'openrouter', intent: 'X', context_sources: [], retrieval_warnings: [] });
    await loginCustomer(page);

    await page.getByRole('button', { name: 'Mở chatbot AI' }).click();
    await page.getByText('Tôi có sách nào sắp đến hạn trả?').click();
    await expect(page.getByText(/^Một/)).toBeVisible();
    await page.getByTitle('Làm mới phiên chat').click();

    await expect.poll(() => page.evaluate(() => window.__aborted)).toBe(true);
    await page.waitForTimeout(1_000);
    await expect(page.getByText(/^Một/)).toHaveCount(0);
  });

  test('manager stops a streaming assistant answer; the unverified draft is not kept', async ({ page }) => {
    await page.route('**/assistant/conversations', (route) => route.fulfill({ json: { items: [] } }));
    await page.route('**/assistant/actions?**', (route) => route.fulfill({ json: { items: [] } }));
    await stubSlowStream(page, '/assistant/stream', ['Kho HN ', 'thiếu ', '12 đầu sách ', 'cần ', 'nhập ', 'gấp.'],
      { answer: 'x', tools_used: [], data: {} });
    await loginStaff(page, 'manager01');
    await page.evaluate(() => localStorage.removeItem('smartbook:ai-assistant:active-conversation-id'));
    await page.goto('/ai-assistant');

    await page.getByLabel('Câu hỏi cho trợ lý AI').fill('Kho nào cần nhập sách gấp?');
    await page.getByRole('button', { name: 'Gửi câu hỏi' }).click();
    await expect(page.getByText(/Kho HN/)).toBeVisible();
    await page.getByRole('button', { name: 'Dừng trả lời' }).click();

    await expect(page.getByText(/Đã dừng câu trả lời\. Bản nháp/)).toBeVisible();
    await expect(page.getByText(/Kho HN/)).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Gửi lại câu hỏi' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Gửi câu hỏi' })).toBeVisible();
    expect(await page.evaluate(() => window.__aborted)).toBe(true);
  });
});
