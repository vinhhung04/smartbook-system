import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { loginStaff } from './helpers';

// AI inventory rebalancing - the thesis demo through the REAL chatbox: real
// gateway, analytics, ai-service and LLM, no stubbed route. The fixture
// (scripts/demo/rebalancing-demo.mjs) is reset and seeded first, so the run can
// be repeated; step 7 creates real REQUESTED transfer / purchase requests, which
// the next seed removes again. Needs the dev stack with the ai profile up.
//
//   pnpm test:e2e:ai-rebalancing-demo   (BASE_URL=http://localhost:5174 PLAYWRIGHT_CHANNEL=chrome)
//
// Off unless E2E_LIVE_AI=1: CI has no LLM key and the fixture needs the dev databases.

const QUESTIONS = [
  'Hãy phân tích tồn kho và nhu cầu của tất cả các kho tôi được phép truy cập. Kho nào đang thiếu, kho nào đang dư sách?',
  'Tìm các cơ hội điều chuyển sách về kho TP.HCM. Tính số lượng điều chuyển an toàn và kiểm tra quyền của tôi.',
  'So sánh ba phương án: chỉ điều chuyển, chỉ mua mới và kết hợp cả hai. Phương án nào hiệu quả nhất?',
  'Tối ưu phương án tốt nhất với ngân sách mua sách 15 triệu đồng.',
  'Nếu ngân sách giảm 20%, phương án và mức đáp ứng nhu cầu thay đổi thế nào?',
  'Tôi đồng ý với phương án 15 triệu ban đầu. Hãy tạo bản nháp yêu cầu điều chuyển và mua mới cho những hành động tôi đủ quyền thực hiện.',
  'Tôi xác nhận. Hãy kiểm tra lại quyền và tồn kho rồi thực hiện các yêu cầu hợp lệ theo workflow hiện tại.',
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

test('seven-step rebalancing demo through the chatbox', async ({ page }) => {
  await loginStaff(page, 'rebalance.manager');
  await page.goto('/ai-assistant');

  // 1. diagnosis: permission verified, three readable warehouses, shortage and surplus
  let a = await ask(page, QUESTIONS[0]);
  await expect(a.getByTestId('rebalance-diagnosis')).toBeVisible();
  await expect(a.getByTestId('rebalance-diagnosis').getByText('Chỉ xem')).toBeVisible(); // Hà Nội is READ
  await expect(a.getByTestId('rebalance-timeline').locator('[data-status="done"]').first()).toBeVisible();

  // 2. transfers: safe quantities and the permission of each line
  a = await ask(page, QUESTIONS[1]);
  const transfers = a.getByTestId('rebalance-transfers');
  await expect(transfers).toBeVisible();
  await expect(transfers.getByText('Cần Manager kho nguồn').first()).toBeVisible();

  // 3. three options compared, a best one and an executable one
  a = await ask(page, QUESTIONS[2]);
  const options = a.getByTestId('rebalance-options');
  for (const code of ['TRANSFER_ONLY', 'PROCUREMENT_ONLY', 'HYBRID']) await expect(options.locator(`[data-option="${code}"]`)).toBeVisible();
  await expect(options.getByText('tốt nhất về nghiệp vụ')).toBeVisible();

  // 4. budget 15 M
  a = await ask(page, QUESTIONS[3]);
  await expect(a.getByTestId('rebalance-budget')).toContainText('15.000.000 ₫');

  // 5. what-if -20 %: old vs new, computed from two real results
  a = await ask(page, QUESTIONS[4]);
  const whatIf = a.getByTestId('rebalance-whatif');
  await expect(whatIf).toContainText('12.000.000 ₫');
  await expect(whatIf).toContainText('15.000.000 ₫');

  // 6. draft of what the user may do; Hà Nội stays a proposal
  a = await ask(page, QUESTIONS[5]);
  const card = a.getByRole('region', { name: /Bản nháp điều chuyển và mua mới/ }).or(a.locator('[aria-label^="Bản nháp điều chuyển và mua mới"]')).first();
  await expect(card).toBeVisible();
  await card.getByText('Xem chi tiết bản nháp').click();
  await expect(a.getByTestId('rebalance-draft-preview')).toContainText('Chỉ đề xuất — cần Manager khác');

  // 7. confirmation through the chat: fresh permission and stock re-check, real request codes
  a = await ask(page, QUESTIONS[6]);
  const execution = a.getByTestId('rebalance-execution');
  await expect(execution.getByTestId('execution-status')).toHaveText('EXECUTED');
  await expect(execution.getByTestId('execution-code').first()).toHaveText(/^(TO|PR)-/);
  await expect(execution).toContainText('Cần Manager khác xử lý');
});
