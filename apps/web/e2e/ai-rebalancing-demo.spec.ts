import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { loginStaff } from './helpers';

// AI inventory rebalancing - the thesis demo through the REAL chatbox: real
// gateway, analytics, ai-service and LLM, no stubbed route. The fixture
// (scripts/demo/rebalancing-demo.mjs) is reset and seeded first, so the run can
// be repeated; step 6 creates real REQUESTED transfer / purchase requests, which
// the next seed removes again. Needs the dev stack with the ai profile up.
//
//   pnpm test:e2e:ai-rebalancing-demo   (BASE_URL=http://localhost:5174 PLAYWRIGHT_CHANNEL=chrome)
//
// Off unless E2E_LIVE_AI=1: CI has no LLM key and the fixture needs the dev databases.

// The presenter names any budget on stage, so the run does too: DEMO_BUDGET_TRIEU (e.g. 8 or 8.5),
// else a random multiple of 0.5 between 5 and 20 million (printed, so a failing run can be repeated).
const BUDGET_TRIEU = Number(process.env.DEMO_BUDGET_TRIEU) || (10 + Math.floor(Math.random() * 31)) / 2;
const BUDGET = Math.round(BUDGET_TRIEU * 1e6);
const vnd = (v: number) => `${Math.round(v).toLocaleString('vi-VN')} ₫`;
const budgetWords = `${String(BUDGET_TRIEU).replace('.', ',')} triệu đồng`;

const QUESTIONS = [
  'Hãy phân tích tồn kho và nhu cầu của tất cả các kho tôi được phép truy cập. Kho nào đang thiếu, kho nào đang dư, và có thể điều chuyển an toàn những sách nào về kho TP.HCM?',
  'So sánh ba phương án: chỉ điều chuyển, chỉ mua mới và kết hợp cả hai. Phương án nào hiệu quả nhất?',
  `Tối ưu phương án tốt nhất với ngân sách mua sách ${budgetWords}.`,
  'Nếu ngân sách giảm 20%, phương án và mức đáp ứng nhu cầu thay đổi thế nào?',
  'Tôi đồng ý với phương án ngân sách ban đầu. Hãy tạo bản nháp yêu cầu điều chuyển và mua mới cho những hành động tôi đủ quyền thực hiện.',
  'Tôi xác nhận. Hãy kiểm tra lại quyền và tồn kho rồi thực hiện các yêu cầu hợp lệ theo workflow hiện tại.',
  'Phê duyệt luôn yêu cầu điều chuyển vừa tạo giúp tôi.',
];

test.skip(process.env.E2E_LIVE_AI !== '1', 'Live LLM demo: set E2E_LIVE_AI=1 (needs the dev stack with the ai profile)');

test.describe.configure({ mode: 'serial', timeout: 900_000 });

test.beforeAll(() => {
  execFileSync('node', [resolve(import.meta.dirname, '..', '..', '..', 'scripts', 'demo', 'rebalancing-demo.mjs'), 'seed'], { stdio: 'inherit' });
});

/** Sends one question and returns the answer once the stream is done (no longer aria-busy). */
async function ask(page: Page, question: string) {
  const answers = page.locator('article[aria-label="Câu trả lời của trợ lý"]');
  const before = await answers.count();
  await page.getByLabel('Câu hỏi cho trợ lý AI').fill(question);
  await page.getByRole('button', { name: 'Gửi câu hỏi' }).click();
  await expect(answers).toHaveCount(before + 1, { timeout: 180_000 });
  const answer = answers.nth(before);
  await expect(answer).not.toHaveAttribute('aria-busy', 'true', { timeout: 180_000 });
  return answer;
}

test('rebalancing demo through the chatbox, at a budget named on stage', async ({ page }) => {
  console.log(`demo budget: ${BUDGET_TRIEU} triệu (repeat with DEMO_BUDGET_TRIEU=${BUDGET_TRIEU})`);
  await loginStaff(page, 'rebalance.manager');
  await page.goto('/ai-assistant');

  // 1. diagnosis + safe transfers in one turn: three readable warehouses (Hà Nội READ), shortage, surplus
  let a = await ask(page, QUESTIONS[0]);
  await expect(a.getByTestId('rebalance-diagnosis')).toBeVisible();
  await expect(a.getByTestId('rebalance-diagnosis').getByText('Chỉ xem')).toBeVisible();
  await expect(a.getByTestId('rebalance-timeline').locator('[data-status="done"]').first()).toBeVisible();
  const transfers = a.getByTestId('rebalance-transfers');
  await expect(transfers).toBeVisible();
  await expect(transfers.getByText('Cần Manager kho nguồn').first()).toBeVisible();

  // 2. three options compared, a best one and an executable one
  a = await ask(page, QUESTIONS[1]);
  const options = a.getByTestId('rebalance-options');
  for (const code of ['TRANSFER_ONLY', 'PROCUREMENT_ONLY', 'HYBRID']) await expect(options.locator(`[data-option="${code}"]`)).toBeVisible();
  await expect(options.getByText('tốt nhất về nghiệp vụ')).toBeVisible();

  // 3. the budget the presenter named
  a = await ask(page, QUESTIONS[2]);
  await expect(a.getByTestId('rebalance-budget')).toContainText(vnd(BUDGET));

  // 4. what-if -20 %: old vs new, computed from two real results
  a = await ask(page, QUESTIONS[3]);
  const whatIf = a.getByTestId('rebalance-whatif');
  await expect(whatIf).toContainText(vnd(BUDGET));
  await expect(whatIf).toContainText(vnd(BUDGET * 0.8));

  // 5. draft of what the user may do; Hà Nội stays a proposal
  a = await ask(page, QUESTIONS[4]);
  const card = a.getByRole('region', { name: /Bản nháp điều chuyển và mua mới/ }).or(a.locator('[aria-label^="Bản nháp điều chuyển và mua mới"]')).first();
  await expect(card).toBeVisible();
  await card.getByText('Xem chi tiết bản nháp').click();
  await expect(a.getByTestId('rebalance-draft-preview')).toContainText('Chỉ đề xuất — cần Manager khác');

  // 6. confirmation through the chat: fresh permission and stock re-check, real request codes
  a = await ask(page, QUESTIONS[5]);
  const execution = a.getByTestId('rebalance-execution');
  await expect(execution.getByTestId('execution-status')).toHaveText('EXECUTED');
  await expect(execution.getByTestId('execution-code').first()).toHaveText(/^(TO|PR)-/);
  await expect(execution).toContainText('Cần Manager khác xử lý');

  // 7. the copilot never approves on the user's behalf
  a = await ask(page, QUESTIONS[6]);
  await expect(a).toContainText('không phê duyệt');
});
