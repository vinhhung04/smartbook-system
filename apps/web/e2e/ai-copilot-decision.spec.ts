import { test, expect, type Page, type Route } from '@playwright/test';
import { loginStaff } from './helpers';

/**
 * Phase 6 - decision experience in /ai-assistant. The assistant stream is
 * stubbed with decision objects of the shape services/ai-service/copilot_decision.py
 * builds from tool data, so these tests check the UI contract: options side by
 * side, least-risk marker, conditional recommendation, verification state,
 * draft creation only through an explicit, confirmable action. Login goes
 * through the real stack (pnpm demo:seed).
 */

const AS_OF = '2026-10-18T10:00:00+00:00';

function decision(status: 'PASSED' | 'BLOCKED', safe: boolean) {
  return {
    kind: 'BUDGET_DECISION',
    conclusion: 'Ngân sách 5.000.000 ₫: duyệt 4.984.000 ₫ cho 1 đầu sách / 56 bản, đáp ứng khoảng 38,8% nhu cầu dự kiến trong thời gian chờ hàng; 69 đầu sách ưu tiên cao chưa được nhập.',
    data_points: [{ label: 'Nhu cầu theo tồn dự kiến (gồm bản đang về / dự kiến trả)', value: 31835740, unit: 'đ', source: 'analytics/reorder-suggestions?budgetVnd' }],
    options: [
      { label: 'Ngân sách 5.000.000 ₫', budget_vnd: 5000000, funded_cost: 4984000, remaining_vnd: 16000, funded_lines: 1, funded_qty: 56,
        expected_service_pct: 38.8, unfunded_high_priority: 69, funded_items: [], pros: ['Chi phí thấp nhất trong các phương án'],
        cons: ['Còn 69 đầu sách ưu tiên cao chưa được nhập'], is_least_risk: false },
      { label: 'Ngân sách 15.000.000 ₫', budget_vnd: 15000000, funded_cost: 14976030, remaining_vnd: 23970, funded_lines: 34, funded_qty: 166,
        expected_service_pct: 91.9, unfunded_high_priority: 36, funded_items: [], pros: ['Đáp ứng nhiều nhu cầu dự kiến nhất trong thời gian chờ hàng'],
        cons: ['Chi phí cao nhất trong các phương án'], is_least_risk: true },
    ],
    risks: ['Ngân sách 5.000.000 ₫: 69 đầu sách ưu tiên cao chưa được nhập (ví dụ One Hundred Years of Solitude).'],
    assumptions: ['Mức đáp ứng là ước lượng theo mô hình Poisson của nhu cầu trong thời gian chờ hàng, không phải cam kết.'],
    recommendation: {
      option: 'Ngân sách 15.000.000 ₫',
      condition: 'Nếu ưu tiên giảm rủi ro hết sách: chọn “Ngân sách 15.000.000 ₫” (đáp ứng 91,9%). Nếu ưu tiên chi phí: chọn “Ngân sách 5.000.000 ₫” (4.984.000 ₫), đổi lại còn 69 đầu sách ưu tiên cao chưa được nhập.',
      basis: 'rule',
    },
    evidence: [{ source: 'analytics/reorder-suggestions?budgetVnd', as_of: AS_OF, rule: 'rule' }],
    verification: { status, safe_to_act: safe },
    next_step: safe ? { type: 'CREATE_REORDER_DRAFT', option: 'Ngân sách 15.000.000 ₫', label: 'Lập phiếu đề xuất nháp',
      message: 'Lập phiếu đề xuất nhập nháp với ngân sách 15.000.000 ₫',
      note: 'Hệ thống chỉ tạo bản nháp sau khi bạn xác nhận; không tự tạo hay duyệt phiếu nhập.' } : null,
  };
}

const PENDING = {
  id: 'act-e2e-1', type: 'CREATE_REORDER_DRAFT', status: 'PENDING_CONFIRMATION', summary: 'Phiếu đề xuất nhập nháp (2 đầu sách)',
  payload: { items: [{ book_variant_id: 'v1', title: 'Dac trung tam ly hoc cua nguoi Viet', suggested_quantity: 130, priority: 'HIGH' }],
             warehouse_resolution_status: 'RESOLVED', warehouse_id: 'w1', warehouse_name: 'Kho HCM Chinh' },
  risk: 'MEDIUM', requires_confirmation: true, allowed_roles: ['WAREHOUSE_MANAGER', 'ADMIN'], sources: [], warnings: [],
};

function payload(answerText: string, extra: object) {
  return {
    answer: answerText, tools_used: [{ name: 'simulate_reorder_budget', arguments: {} }], data: {},
    conversation_id: 'e2e-decision', grounding_warning: null, pending_action: null, evidence: [], retrieval_warnings: [],
    plan: null, suggested_followups: [], caveats: [], recommendations: [], data_as_of: AS_OF, explanation: null,
    visualizations: [], visualization_notes: [], ...extra,
  };
}

function sse(body: object) {
  return `event: token\ndata: ${JSON.stringify({ text: (body as { answer: string }).answer })}\n\nevent: done\ndata: ${JSON.stringify(body)}\n\n`;
}

async function stub(page: Page, respond: (message: string) => object, asked: string[], confirms: string[]) {
  await page.route('**/assistant/stream', async (route: Route) => {
    const message = (route.request().postDataJSON() as { message: string }).message;
    asked.push(message);
    await route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream' }, body: sse(respond(message)) });
  });
  await page.route('**/assistant/conversations', (route) => route.fulfill({ json: { items: [] } }));
  await page.route('**/assistant/actions?**', (route) => route.fulfill({ json: { items: [] } }));
  await page.route('**/actions/confirm', async (route) => {
    confirms.push(route.request().postData() || '');
    await route.fulfill({ status: 500, json: { detail: 'not in this test' } });
  });
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

test.describe('AI copilot decision experience', () => {
  test('manager compares budgets: options side by side, least risk, conditional recommendation, verified', async ({ page }) => {
    const asked: string[] = [];
    const confirms: string[] = [];
    await stub(page, (m) => (m.startsWith('Lập phiếu')
      ? payload('Tôi đã chuẩn bị phiếu đề xuất nhập nháp. Vui lòng kiểm tra và xác nhận.', { pending_action: PENDING })
      : payload('Ngân sách 15 triệu đáp ứng nhiều hơn; 5 triệu rẻ hơn nhưng để lại 69 đầu sách ưu tiên cao.',
        { decision: decision('PASSED', true) })), asked, confirms);
    await openAssistant(page);
    await ask(page, 'Nếu ngân sách còn 5 triệu?');

    const card = page.getByTestId('copilot-decision');
    await expect(card).toBeVisible();
    const rows = card.getByTestId('decision-options').locator('tbody tr');
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(1)).toContainText('ít rủi ro nhất');
    await expect(rows.nth(1)).toContainText('91,9%');
    await expect(card.getByTestId('decision-recommendation')).toContainText('Nếu ưu tiên giảm rủi ro hết sách');
    await expect(card.getByTestId('decision-recommendation')).toContainText('Nếu ưu tiên chi phí');
    await expect(card.getByTestId('decision-verification')).toHaveText('Đã đối chiếu với dữ liệu');
    await expect(card).not.toContainText('tối ưu');

    // the draft button only ASKS for a draft; the draft then needs an explicit confirm
    await card.getByTestId('decision-draft').click();
    await expect.poll(() => asked.at(-1)).toBe('Lập phiếu đề xuất nhập nháp với ngân sách 15.000.000 ₫');
    await expect(page.getByRole('button', { name: 'Tạo phiếu đề xuất nhập' })).toBeVisible();
    expect(confirms).toEqual([]); // nothing was confirmed automatically
  });

  test('a decision whose answer could not be verified offers no draft', async ({ page }) => {
    await stub(page, () => payload('Không kiểm chứng được một nhận định an toàn.', { decision: decision('BLOCKED', false) }), [], []);
    await openAssistant(page);
    await ask(page, 'Với 15 triệu nên nhập những sách nào?');
    const card = page.getByTestId('copilot-decision');
    await expect(card.getByTestId('decision-verification')).toContainText('không kiểm chứng được');
    await expect(card.getByTestId('decision-draft')).toHaveCount(0);
  });

  test('a simple question gets the plain answer, no decision card', async ({ page }) => {
    await stub(page, () => payload('Kho Ha Noi có 1 đầu sách dưới ngưỡng.', {}), [], []);
    await openAssistant(page);
    await ask(page, 'Kho Hà Nội có bao nhiêu sách dưới ngưỡng?');
    await expect(page.getByText('Kho Ha Noi có 1 đầu sách dưới ngưỡng.')).toBeVisible();
    await expect(page.getByTestId('copilot-decision')).toHaveCount(0);
  });

  test('the decision card fits a phone screen (table scrolls, page does not)', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await stub(page, () => payload('So sánh hai mức ngân sách.', { decision: decision('PASSED', true) }), [], []);
    await openAssistant(page);
    await ask(page, 'So sánh 5 triệu và 15 triệu');
    await expect(page.getByTestId('copilot-decision')).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });
});
