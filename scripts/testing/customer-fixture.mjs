import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

// Fresh reader through real registration and Mailpit verification. Never clear
// loans or relax membership limits on a shared seeded account to make tests pass.
export async function createCustomerFixture({ baseUrl, password, adminToken }) {
  assert.equal(process.env.SMARTBOOK_TEST_ISOLATED, '1', 'customer fixtures require the disposable QA stack');
  const username = `audit_${randomUUID().replaceAll('-', '').slice(0, 20)}`;
  const email = `${username}@example.com`;
  async function api(path, body, token) {
    const response = await fetch(`${baseUrl}${path}`, {
      method: body ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const result = await response.json();
    assert.ok(response.ok, `${path}: HTTP ${response.status}`);
    return result;
  }
  const registration = await api('/auth/register', { username, email, password, full_name: 'Isolated audit reader' });
  const mailpit = process.env.MAILPIT_URL || 'http://localhost:18025';
  let code;
  for (let attempt = 0; attempt < 40 && !code; attempt++) {
    const inbox = await fetch(`${mailpit}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`).then(r => r.json());
    if (inbox.messages?.[0]) {
      const message = await fetch(`${mailpit}/api/v1/message/${inbox.messages[0].ID}`).then(r => r.json());
      code = /Mã xác thực: (\d{6})/.exec(message.Text || '')?.[1];
    }
    if (!code) await new Promise(resolve => setTimeout(resolve, 250));
  }
  assert.ok(code, 'fixture registration email delivered');
  await api('/auth/email-otp/verify', { challenge_id: registration.challenge.id, code });
  const reader = await api('/auth/login', { identifier: username, password });
  const profile = await api('/borrow/my/profile', null, reader.token);
  const admin = adminToken || (await api('/auth/login', { identifier: 'hung', password })).token;
  const topup = await fetch(`${baseUrl}/borrow/customers/${profile.data.id}/account/topups`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${admin}`, 'Idempotency-Key': randomUUID() },
    body: JSON.stringify({ amount: 100000, method: 'CASH', note: 'Isolated audit fixture deposit funds' }),
  });
  assert.ok(topup.ok, `fixture topup: HTTP ${topup.status}`);
  return { username, token: reader.token, customerId: profile.data.id };
}
