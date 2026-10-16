import { test, expect, type Page, type Route } from '@playwright/test';
import { loginStaff } from './helpers';

/**
 * AI Copilot 3.0 - Generative UI in /ai-assistant. The assistant endpoints are
 * stubbed with fixed specs (the shape services/ai-service/copilot_visualization.py
 * emits) so these tests check the renderer, not the LLM: chart types, tooltip,
 * chart/table switch, series toggle, expand, missing values, invalid specs,
 * follow-up buttons, budget slider, history hydration, dark mode and mobile.
 * Login itself goes through the real stack (pnpm demo:seed).
 */

const AS_OF = '2026-10-15T09:31:50+07:00';
const LINE = {
  id: 'viz-aaaaaaaaaaaa',
  type: 'line',
  title: 'Lượt mượn theo tháng',
  description: 'Từ 05/2026 đến 09/2026 (các tháng trọn kỳ), lượt mượn giảm 16.5%.',
  x_key: 'period',
  x_label: 'Tháng',
  x_kind: 'time',
  y_label: 'Số lượt',
  series: [
    { key: 'loans', label: 'Lượt mượn', unit: 'lượt', kind: 'count', scope_note: '', hidden: false },
    { key: 'returns', label: 'Lượt trả', unit: 'lượt', kind: 'count', scope_note: '', hidden: true },
  ],
  data: [
    { period: '04/2026', loans: 457, returns: 550 },
    { period: '05/2026', loans: 1095, returns: 1191 },
    { period: '06/2026', loans: 902, returns: null },
    { period: '07/2026', loans: 908, returns: 956 },
    { period: '08/2026', loans: 1097, returns: 1031 },
    { period: '09/2026', loans: 914, returns: 998 },
    { period: '10/2026', loans: 72, returns: 73 },
  ],
  kpis: [],
  source: { tools: ['get_borrow_trends'], endpoints: ['/analytics/borrow-trends'] },
  scope: { level: 'system', label: 'Toàn hệ thống' },
  time_range: { label: '6 tháng qua (18/04/2026–15/10/2026)', start: '2026-04-18', end: '2026-10-15' },
  data_as_of: AS_OF,
  is_partial: true,
  limitations: ['2 tháng chưa trọn kỳ (04/2026, 10/2026) - không dùng để xác định xu hướng.'],
  annotations: [{ x: '04/2026', note: 'Chỉ tính từ 18/04/2026' }, { x: '10/2026', note: 'Chỉ tính đến 15/10/2026' }],
  summary: { metric: 'loans', direction: 'giảm', change_pct: -16.5 },
  interactions: {
    allowed_types: ['line', 'area', 'bar', 'table'],
    can_toggle_series: true,
    sortable: false,
    filterable: false,
    followups: ['Biểu đồ này cho thấy điều gì?'],
    budget: null,
  },
  snapshot: true,
};
const KPI = {
  ...LINE,
  id: 'viz-bbbbbbbbbbbb',
  type: 'kpi',
  title: 'Tổng hợp lượt mượn',
  series: [],
  data: [],
  annotations: [],
  kpis: [
    { key: 'total_loans', label: 'Tổng lượt mượn trong kỳ', value: 5445, unit: 'lượt', kind: 'count', note: '7 tháng', delta: null, delta_unit: '', delta_label: '' },
    { key: 'change', label: 'Thay đổi 05/2026 → 09/2026', value: -16.5, unit: '%', kind: 'percent', note: '', delta: null, delta_unit: '', delta_label: '' },
  ],
  interactions: { ...LINE.interactions, allowed_types: ['kpi'], followups: [] },
};
const BUDGET = {
  ...LINE,
  id: 'viz-cccccccccccc',
  type: 'bar',
  title: 'Ngân sách và chi phí được duyệt theo phương án',
  x_key: 'scenario',
  x_kind: 'category',
  series: [
    { key: 'budget', label: 'Ngân sách', unit: '₫', kind: 'currency', scope_note: '', hidden: false },
    { key: 'funded_cost', label: 'Chi phí được duyệt', unit: '₫', kind: 'currency', scope_note: '', hidden: false },
  ],
  data: [
    { scenario: 'Ngân sách 5.000.000 ₫', budget: 5000000, funded_cost: 4947000 },
    { scenario: 'Ngân sách 10.000.000 ₫', budget: 10000000, funded_cost: null },
  ],
  annotations: [],
  interactions: {
    allowed_types: ['bar', 'table'], can_toggle_series: true, sortable: true, filterable: false, followups: [],
    budget: { min: 1000000, max: 30000000, step: 1000000, current: [5000000, 10000000] },
  },
};
const INVALID = { ...LINE, id: 'viz-dddddddddddd', type: 'html', title: 'Không được hiển thị' };

function sse(payload: object) {
  return `event: token\ndata: ${JSON.stringify({ text: (payload as { answer: string }).answer })}\n\nevent: done\ndata: ${JSON.stringify(payload)}\n\n`;
}

function answer(visualizations: object[]) {
  return {
    answer: 'Lượt mượn có xu hướng giảm 16,5% giữa các tháng trọn kỳ.\nTháng 08/2026 cao nhất với 1.097 lượt.',
    tools_used: [{ name: 'get_borrow_trends', arguments: {} }],
    data: {},
    conversation_id: 'e2e-viz-conversation',
    grounding_warning: null,
    pending_action: null,
    evidence: [],
    retrieval_warnings: [],
    plan: null,
    suggested_followups: [],
    caveats: [],
    recommendations: [],
    data_as_of: AS_OF,
    explanation: null,
    visualizations,
    visualization_notes: [],
  };
}

async function stubAssistant(page: Page, visualizations: object[], asked: string[] = []) {
  await page.route('**/assistant/stream', async (route: Route) => {
    asked.push((route.request().postDataJSON() as { message: string }).message);
    await route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream' }, body: sse(answer(visualizations)) });
  });
  await page.route('**/assistant/conversations', (route) => route.fulfill({ json: { items: [] } }));
  await page.route('**/assistant/actions?**', (route) => route.fulfill({ json: { items: [] } }));
}

async function openAssistant(page: Page) {
  await loginStaff(page);
  await page.evaluate(() => localStorage.removeItem('smartbook:ai-assistant:active-conversation-id'));
  await page.goto('/ai-assistant');
}

async function ask(page: Page, question: string) {
  await page.getByLabel('Câu hỏi cho trợ lý AI').fill(question);
  await page.getByRole('button', { name: 'Gửi câu hỏi' }).click();
}

test.describe('AI copilot visualizations', () => {
  test('trend answer: KPI, line chart with tooltip, series toggle, chart/table switch, expand', async ({ page }) => {
    await stubAssistant(page, [KPI, LINE, INVALID]);
    await openAssistant(page);
    await ask(page, 'Vẽ biểu đồ lượt mượn 6 tháng gần đây');

    await expect(page.getByRole('region', { name: 'Đường: Lượt mượn theo tháng' })).toBeVisible();
    // The card's aria-label follows the current view; data-viz-id stays put.
    const chart = page.locator(`[data-viz-id="${LINE.id}"]`);
    await expect(page.getByText('5.445 lượt')).toBeVisible();
    await expect(chart.getByText('Dữ liệu chưa đầy đủ')).toBeVisible();
    await expect(chart.getByText('Nguồn: /analytics/borrow-trends')).toBeVisible();
    await expect(chart.getByText(/Ảnh chụp dữ liệu lúc/)).toBeVisible();
    await expect(page.getByText('Không được hiển thị')).toHaveCount(0); // non-whitelisted type dropped

    // Hover shows the exact value of the hovered month.
    const plot = chart.locator('.recharts-wrapper');
    const box = await plot.boundingBox();
    if (!box) throw new Error('chart has no box');
    await page.mouse.move(box.x + box.width * 0.42, box.y + box.height / 2);
    await expect(chart.locator('.recharts-tooltip-wrapper')).toContainText('lượt');

    // Hidden-by-default series can be shown; the last visible one cannot be hidden.
    const returns = chart.getByRole('button', { name: 'Lượt trả' });
    await expect(returns).toHaveAttribute('aria-pressed', 'false');
    await returns.click();
    await expect(returns).toHaveAttribute('aria-pressed', 'true');

    // Table view keeps a missing value visible as missing, never 0.
    await chart.getByRole('radio', { name: 'Dạng bảng' }).click();
    const table = chart.getByRole('table');
    await expect(table).toBeVisible();
    await expect(table.getByRole('row')).toHaveCount(8);
    await expect(table.getByTitle('Không có dữ liệu')).toHaveCount(1);
    await table.getByRole('button', { name: /Lượt mượn/ }).click();
    await expect(table.getByRole('row').nth(1)).toContainText('1.097');

    await chart.getByRole('radio', { name: 'Dạng cột' }).click();
    await expect(page.getByRole('region', { name: 'Cột: Lượt mượn theo tháng' })).toBeVisible();

    await page.getByRole('button', { name: 'Mở rộng Lượt mượn theo tháng' }).click();
    await expect(page.getByRole('dialog', { name: 'Lượt mượn theo tháng' })).toBeVisible();
  });

  test('follow-up and budget slider send a new question instead of computing in the browser', async ({ page }) => {
    const asked: string[] = [];
    await stubAssistant(page, [LINE, BUDGET], asked);
    await openAssistant(page);
    await ask(page, 'So sánh ngân sách 5 triệu và 10 triệu bằng biểu đồ');
    await expect(page.getByRole('region', { name: /Ngân sách và chi phí/ })).toBeVisible();

    await page.getByRole('button', { name: 'Biểu đồ này cho thấy điều gì?' }).click();
    await expect.poll(() => asked.at(-1)).toBe('Biểu đồ này cho thấy điều gì?');

    // The follow-up answer carries the same budget chart again: use the newest one.
    const slider = page.getByRole('slider', { name: 'Ngân sách nhập sách' }).last();
    await slider.focus();
    await page.keyboard.press('ArrowRight');
    await page.getByRole('button', { name: 'Mô phỏng lại' }).last().click();
    await expect.poll(() => asked.at(-1)).toBe('Nếu ngân sách nhập sách là 11 triệu thì sao? Hiển thị biểu đồ.');
  });

  // CI runs the browser in UTC; the label must read the same Vietnam time in
  // any zone, and the stored timestamp (+07:00 or Z) must not be rewritten.
  for (const { timezoneId, asOf } of [
    { timezoneId: 'UTC', asOf: AS_OF },
    { timezoneId: 'America/New_York', asOf: '2026-10-15T02:31:50Z' },
    { timezoneId: 'Asia/Ho_Chi_Minh', asOf: AS_OF },
  ]) {
    test.describe(`browser in ${timezoneId}`, () => {
      test.use({ timezoneId });

      test('a reopened conversation shows the stored snapshot, labelled as such', async ({ page }) => {
        await stubAssistant(page, []);
        await page.route('**/assistant/conversations/e2e-history', (route) => route.fulfill({
          json: {
            conversation: { conversation_id: 'e2e-history', title: 'Lịch sử', status: 'ACTIVE' },
            messages: [
              { role: 'user', content: 'Vẽ biểu đồ lượt mượn', created_at: asOf },
              {
                role: 'assistant', content: 'Lượt mượn giảm.', created_at: asOf,
                extras: { visualizations: [{ ...LINE, data_as_of: asOf }], data_as_of: asOf },
              },
            ],
          },
        }));
        await loginStaff(page);
        await page.evaluate(() => localStorage.setItem('smartbook:ai-assistant:active-conversation-id', 'e2e-history'));
        await page.goto('/ai-assistant');
        const chart = page.getByRole('region', { name: 'Đường: Lượt mượn theo tháng' });
        await expect(chart).toBeVisible();
        await expect(chart.getByText('Ảnh chụp dữ liệu lúc 09:31 15/10/2026')).toBeVisible();
        await expect(page.getByText(/không tự cập nhật/)).toBeVisible();
      });
    });
  }

  test('an answer the faithfulness check replaced says so; a passing one shows nothing', async ({ page }) => {
    const replaced = {
      status: 'fallback', retried: true, latency_ms: 1.2,
      issues: [{ type: 'CONTRADICTION', phrase: 'Lượt mượn tăng mạnh.', detail: 'Dữ liệu: giảm', blocking: true, label: 'mâu thuẫn với xu hướng trong dữ liệu' }],
    };
    let call = 0;
    await page.route('**/assistant/stream', async (route) => {
      call += 1;
      const payload = { ...answer([LINE]), faithfulness: call === 1 ? replaced : { status: 'passed', retried: false, issues: [] } };
      await route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream' }, body: sse(payload) });
    });
    await page.route('**/assistant/conversations', (route) => route.fulfill({ json: { items: [] } }));
    await page.route('**/assistant/actions?**', (route) => route.fulfill({ json: { items: [] } }));
    await openAssistant(page);
    await ask(page, 'Vẽ biểu đồ lượt mượn 6 tháng gần đây');
    const note = page.getByRole('note').filter({ hasText: 'thay bằng kết luận tính trực tiếp từ dữ liệu' });
    await expect(note).toBeVisible();
    await expect(note).toContainText('mâu thuẫn với xu hướng trong dữ liệu');
    await ask(page, 'Vẽ lại biểu đồ');
    await expect(page.getByRole('note')).toHaveCount(1); // the passing answer adds none
  });

  test('Copilot 3.2: a blocked answer says it could not be verified and offers no action; a verified one says it was checked', async ({ page }) => {
    const blocked = {
      status: 'BLOCKED', retried: true, safe_to_act: false, counts: { SUPPORTED: 0, CONTRADICTED: 1, UNSUPPORTED: 0, UNVERIFIABLE: 0 },
      repairs: [], claims: [{ text: 'đề xuất nhập 5 đầu sách', type: 'numeric', category: 'COUNT', label: 'số lượng không khớp dữ liệu',
                               verdict: 'CONTRADICTED', severity: 'critical', detail: '9 đầu sách được duyệt' }],
    };
    const passed = {
      status: 'PASSED', retried: false, safe_to_act: true, counts: { SUPPORTED: 2, CONTRADICTED: 0, UNSUPPORTED: 0, UNVERIFIABLE: 0 },
      repairs: [], claims: [{ text: 'x', type: 'numeric', category: 'COUNT', label: 'số lượng không khớp dữ liệu', verdict: 'SUPPORTED' }],
    };
    let call = 0;
    await page.route('**/assistant/stream', async (route) => {
      call += 1;
      const payload = { ...answer([LINE]), verification: call === 1 ? blocked : passed };
      const body = `event: token\ndata: ${JSON.stringify({ text: 'bản nháp' })}\n\nevent: status\ndata: {"stage":"verifying"}\n\n`
        + `event: done\ndata: ${JSON.stringify(payload)}\n\n`;
      await route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream' }, body });
    });
    await page.route('**/assistant/conversations', (route) => route.fulfill({ json: { items: [] } }));
    await page.route('**/assistant/actions?**', (route) => route.fulfill({ json: { items: [] } }));
    await openAssistant(page);
    await ask(page, 'Với ngân sách 10 triệu nên nhập sách gì?');
    const note = page.getByRole('note').filter({ hasText: 'Không kiểm chứng được một khuyến nghị an toàn' });
    await expect(note).toBeVisible();
    await expect(note).toContainText('số lượng không khớp dữ liệu');
    await expect(note).not.toContainText('COUNT');
    await expect(page.getByText('bản nháp', { exact: true })).toHaveCount(0); // the draft was replaced
    await expect(page.getByTestId('copilot-draft-status')).toHaveCount(0);
    await ask(page, 'Vẽ lại biểu đồ');
    await expect(page.getByText('Đã đối chiếu với dữ liệu hệ thống')).toBeVisible();
    await expect(page.getByRole('note')).toHaveCount(1); // the verified answer adds no warning note
    await expect(page.getByText(/100\s*%/)).toHaveCount(0);
  });

  test('dark mode recolours the series and the chart fits a phone screen', async ({ page }) => {
    await stubAssistant(page, [KPI, LINE]);
    await openAssistant(page);
    await ask(page, 'Vẽ biểu đồ lượt mượn 6 tháng gần đây');
    const chart = page.getByRole('region', { name: 'Đường: Lượt mượn theo tháng' });
    await expect(chart).toBeVisible();
    const seriesColor = () => chart.evaluate((el) => getComputedStyle(el).getPropertyValue('--viz-1').trim());
    expect(await seriesColor()).toBe('#4f46e5');
    await page.evaluate(() => document.documentElement.classList.add('dark'));
    expect(await seriesColor()).toBe('#6366f1');

    await page.setViewportSize({ width: 375, height: 812 });
    // The staff shell keeps its sidebar open on phones (a known layout gap outside
    // this feature); collapse it the way a user would before measuring the card.
    await page.getByRole('button', { name: 'Toggle sidebar' }).click();
    await expect(chart).toBeVisible();
    const overflow = await chart.evaluate((el) => el.scrollWidth - el.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });
});
