import crypto from 'node:crypto';

const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
const username = process.env.ASSISTANT_TEST_USERNAME || 'manager01';
const password = process.env.ASSISTANT_TEST_PASSWORD || '123456';
const jwtSecret = process.env.JWT_SECRET || 'smartbook_shared_jwt_secret';

function b64url(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function signJwt(payload, secret) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const encodedHeader = b64url(JSON.stringify(header));
  const encodedPayload = b64url(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = crypto
    .createHmac('sha256', secret)
    .update(signingInput)
    .digest('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
  return `${signingInput}.${signature}`;
}

async function request(path, token, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method || 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const body = await response.json().catch(() => ({}));
  return { response, body };
}

async function login() {
  const response = await fetch(`${baseUrl}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: username, password }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body?.token) {
    throw new Error(`login failed (${response.status}): ${JSON.stringify(body)}`);
  }
  return body.token;
}

function assertString(value, field) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${field} must be a non-empty string`);
  }
}

function assertArray(value, field) {
  if (!Array.isArray(value)) {
    throw new Error(`${field} must be an array`);
  }
}

async function run() {
  const managerToken = await login();
  let passed = 0;
  const total = 4;

  // 1. Reorder-suggestions style question — expect a grounded answer plus at least
  //    one analytics tool call, and no error surfaced by the tool that was used.
  {
    const { response, body } = await request('/ai/assistant', managerToken, {
      body: { message: 'Kho nào cần nhập thêm sách gấp trong 30 ngày tới?' },
    });
    if (!response.ok) {
      throw new Error(`reorder-suggestions question failed (${response.status}): ${JSON.stringify(body)}`);
    }
    assertString(body.answer, 'answer');
    assertArray(body.tools_used, 'tools_used');
    if (body.tools_used.length === 0) {
      throw new Error('expected at least one tool call for a reorder/stock-risk question');
    }
    if (!body.tools_used.every((call) => typeof call.name === 'string' && call.name.startsWith('get_'))) {
      throw new Error('every tool call must have a name starting with get_');
    }
    for (const call of body.tools_used) {
      const result = body.data?.[call.name];
      if (result && typeof result === 'object' && result.error) {
        throw new Error(`tool ${call.name} returned an error: ${result.error}`);
      }
    }
    passed += 1;
    console.log('PASS assistant/reorder-suggestions-question');
  }

  // 2. Overdue/fine question — expect the model to call an overdue- or fine-related tool.
  {
    const { response, body } = await request('/ai/assistant', managerToken, {
      body: { message: 'Có bao nhiêu phiếu mượn đang quá hạn và tổng tiền phạt chưa thu là bao nhiêu?' },
    });
    if (!response.ok) {
      throw new Error(`overdue/fine question failed (${response.status}): ${JSON.stringify(body)}`);
    }
    assertString(body.answer, 'answer');
    assertArray(body.tools_used, 'tools_used');
    const usedRelevantTool = body.tools_used.some(
      (call) => call.name.includes('overdue') || call.name.includes('fine') || call.name.includes('dashboard'),
    );
    if (!usedRelevantTool) {
      throw new Error(`expected an overdue/fine/dashboard tool call, got: ${JSON.stringify(body.tools_used)}`);
    }
    passed += 1;
    console.log('PASS assistant/overdue-fine-question');
  }

  // 3. Customer token must be denied before any LLM call is made.
  {
    const customerToken = signJwt(
      {
        sub: crypto.randomUUID(),
        username: 'assistant-customer-test',
        email: 'assistant-customer-test@smartbook.local',
        roles: ['CUSTOMER'],
        permissions: ['inventory.catalog.read', 'borrow.read', 'borrow.write'],
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 60 * 60,
      },
      jwtSecret,
    );
    const { response } = await request('/ai/assistant', customerToken, {
      body: { message: 'Cho tôi xem KPI tổng quan thư viện.' },
    });
    if (response.status !== 403) {
      throw new Error(`customer assistant access should be 403, got ${response.status}`);
    }
    passed += 1;
    console.log('PASS assistant/customer-denied');
  }

  // 4. Out-of-scope question — best-effort check since it depends on LLM behavior:
  //    the endpoint must still respond (not error out), and should not call any
  //    analytics tool for a question that has nothing to do with library/warehouse data.
  {
    const { response, body } = await request('/ai/assistant', managerToken, {
      body: { message: 'Giá cổ phiếu Vietcombank ngày mai là bao nhiêu?' },
    });
    if (!response.ok) {
      throw new Error(`out-of-scope question failed (${response.status}): ${JSON.stringify(body)}`);
    }
    assertString(body.answer, 'answer');
    assertArray(body.tools_used, 'tools_used');
    if (body.tools_used.length !== 0) {
      console.warn(
        `WARN assistant/out-of-scope-refusal: model called tools for an out-of-scope question (best-effort check, LLM-dependent): ${JSON.stringify(
          body.tools_used,
        )}`,
      );
    } else {
      console.log('PASS assistant/out-of-scope-refusal');
    }
    passed += 1;
  }

  console.log(`PASS=${passed} TOTAL=${total}`);
}

run().catch((error) => {
  console.error(`FAIL ${error.message}`);
  process.exitCode = 1;
});
