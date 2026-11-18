import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { transformWithEsbuild } from 'vite';

const requests = [];
globalThis.__finePaymentGateway = {
  async post(url, payload, config) {
    requests.push({ url, payload, config });
    return { data: { data: { payment_id: 'recorded-payment' } } };
  },
};
const source = (await readFile(new URL('../src/services/borrow.ts', import.meta.url), 'utf8'))
  .replace("import { gatewayAPI } from './http-clients';", 'const gatewayAPI = globalThis.__finePaymentGateway;');
const { code } = await transformWithEsbuild(source, 'borrow.ts', { loader: 'ts', format: 'esm' });
const { borrowService } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
const payment = { amount: 20000, payment_method: 'TRANSFER', transaction_reference: 'non-secret-test-transfer' };

test('PRA05: fine payment sends the operation key as a header without changing the payload', async () => {
  const result = await borrowService.recordFinePayment('fine-A', payment, 'stable-payment-request');
  const request = requests.at(-1);
  assert.equal(request.url, '/borrow/fines/fine-A/payments');
  assert.deepEqual(request.payload, payment);
  assert.equal(request.config?.headers?.['Idempotency-Key'], 'stable-payment-request');
  assert.equal(result.data.payment_id, 'recorded-payment');
});

test('PRA05: retry after a lost response keeps the same caller-owned payment key', async () => {
  await borrowService.recordFinePayment('fine-A', payment, 'retry-after-timeout');
  await borrowService.recordFinePayment('fine-A', payment, 'retry-after-timeout');
  assert.equal(requests.at(-2).config?.headers?.['Idempotency-Key'], 'retry-after-timeout');
  assert.equal(requests.at(-1).config?.headers?.['Idempotency-Key'], 'retry-after-timeout');
});
