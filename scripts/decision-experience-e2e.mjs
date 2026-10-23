// Phase 6 live end-to-end: a warehouse manager's multi-turn decision session
// against the running stack and the real LLM. Checks what the BACKEND decided
// (tools and their arguments, scenarios, the decision object, least-risk pick,
// verification, pending actions) - not the wording of the answer.
//
//   node scripts/decision-experience-e2e.mjs [--out report.json]   (DEMO_PASSWORD, GATEWAY_URL optional)
//
// Paced for the ai-service rate limit (15 requests / minute per IP).
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';

const GATEWAY = (process.env.GATEWAY_URL || 'http://localhost:3000').replace(/\/$/, '');
const PASSWORD = process.env.DEMO_PASSWORD || '123456';
const OUT = process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1] : null;
const PACE_MS = 5000;
const results = [];
const turns = [];
const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });

const token = (await (await fetch(`${GATEWAY}/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: 'manager01', password: PASSWORD }),
})).json()).token;

async function api(path, body) {
  const res = await fetch(`${GATEWAY}${path}`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

async function conversation(name, questions, checks) {
  let cid = null;
  const answers = [];
  for (const q of questions) {
    const t0 = Date.now();
    const r = await api('/ai/assistant', { message: q, conversation_id: cid });
    const seconds = (Date.now() - t0) / 1000;
    cid = r.body?.conversation_id || cid;
    const tools = (r.body?.tools_used || []).map((t) => ({ name: t.name, args: t.arguments || t.args || {} }));
    const sim = r.body?.data?.simulate_reorder_budget;
    turns.push({
      conversation: name, q, status: r.status, seconds, tools,
      verification: r.body?.verification?.status ?? null, safe_to_act: r.body?.verification?.safe_to_act ?? null,
      decision: Boolean(r.body?.decision), pending_action: r.body?.pending_action?.type ?? null,
      scenarios: sim?.scenarios?.map((s) => ({ label: s.label, cost: s.funded_cost, service: s.expected_service_pct,
        unfunded_high: s.unfunded_high_priority })) ?? null,
      least_risk: sim?.least_risk_scenario?.label ?? null, answer: (r.body?.answer || '').slice(0, 400),
      // for a turn that was not PASSED: what the model wrote and what the checks objected to
      ...(r.body?.verification?.status && r.body.verification.status !== 'PASSED' ? {
        draft: (r.body?.debug?.draft_answer || '').slice(0, 1500),
        problems: (r.body?.verification?.claims || []).filter((c) => ['CONTRADICTED', 'UNSUPPORTED'].includes(c.verdict))
          .map((c) => ({ category: c.category, text: (c.text || '').slice(0, 200), detail: c.detail })),
      } : {}),
    });
    answers.push(r);
    await sleep(PACE_MS);
  }
  for (const [label, fn] of checks) {
    try {
      fn(answers);
      results.push({ name: `${name}: ${label}`, ok: true });
      console.log(`  ok   ${name}: ${label}`);
    } catch (error) {
      results.push({ name: `${name}: ${label}`, ok: false, error: error.message });
      console.log(`  FAIL ${name}: ${label}\n       ${error.message}`);
    }
  }
  return answers;
}

const sim = (r) => r.body?.data?.simulate_reorder_budget;
const simArgs = (r) => (r.body?.tools_used || []).find((t) => t.name === 'simulate_reorder_budget')?.arguments || {};

await conversation('budget session', [
  'Với 15 triệu nên nhập những sách nào?',
  'Nếu giảm 20% thì bỏ bớt cuốn nào?',
  'Nếu ngân sách còn 5 triệu?',
  'Phương án nào ít rủi ro hơn?',
  'Nếu nhà cung cấp giao chậm thêm 7 ngày thì sao?',
  'Nếu ưu tiên kho Hà Nội thì sao?',
], [
  ['15 triệu: a decision object built from the 15M scenario', ([a]) => {
    assert.equal(a.status, 200);
    assert.equal(sim(a).scenarios[0].budget_vnd, 15000000);
    assert.ok(a.body.decision?.options?.length >= 1);
  }],
  ['“giảm 20%” applies to the previous 15M budget (12M), not the full need', ([, b]) => {
    assert.deepEqual(simArgs(b).budgets_vnd, [15000000]);
    assert.equal(sim(b).scenarios[1].budget_vnd, 12000000);
  }],
  ['“còn 5 triệu” compares 5M with the previous 15M', ([, , c]) => {
    assert.deepEqual(sim(c).scenarios.map((s) => s.budget_vnd), [5000000, 15000000]);
  }],
  ['“ít rủi ro hơn” is ranked by the backend (higher expected service) and the recommendation names it', ([, , , d]) => {
    const s = sim(d);
    const best = [...s.scenarios].sort((x, y) => y.expected_service_pct - x.expected_service_pct)[0];
    assert.equal(s.least_risk_scenario.label, best.label);
    assert.equal(d.body.decision.recommendation.option, best.label);
  }],
  ['supplier +7 days: same budget, delayed scenario serves less of the lead-time demand', ([, , , , e]) => {
    const s = sim(e);
    assert.equal(simArgs(e).lead_time_delay_days, 7);
    const delayed = s.scenarios.find((x) => x.lead_time_delay_days === 7);
    assert.ok(delayed, 'delayed scenario');
    assert.ok(delayed.expected_service_pct < s.scenarios[0].expected_service_pct);
    assert.equal(delayed.kind, 'condition'); // a delay is shown for its impact, never ranked as an option
    assert.equal(s.least_risk_scenario, null);
  }],
  ['priority warehouse: funding what-if for Kho Ha Noi inside the manager\'s scope', ([, , , , , f]) => {
    assert.equal(simArgs(f).priority_warehouse, 'Kho Ha Noi');
    assert.ok(sim(f).scenarios.some((x) => x.priority_warehouse === 'Kho Ha Noi'));
  }],
  ['no purchase order or draft was proposed on its own', (answers) => {
    assert.ok(answers.every((r) => !r.body?.pending_action));
  }],
]);

await conversation('cost vs service', ['Làm sao giảm chi phí nhập sách mà vẫn giữ mức phục vụ?'], [
  ['the least budgets for 99 / 95 / 90 % service come from the analytics curve', ([a]) => {
    const labels = sim(a).scenarios.map((s) => s.label);
    assert.ok(labels.some((l) => l.startsWith('Giữ 95%')), labels.join(' | '));
    assert.ok(a.body.decision);
  }],
]);

await conversation('high priority only', ['Với 10 triệu, chỉ nhập sách ưu tiên cao thì được gì?'], [
  ['priority filter passed to the simulation', ([a]) => {
    assert.equal(simArgs(a).priority, 'HIGH');
    assert.deepEqual(simArgs(a).budgets_vnd, [10000000]);
  }],
]);

await conversation('trend follow-ups', ['Lượt mượn tháng này thế nào?', 'So với tháng trước?', 'Tại sao?'], [
  ['“so với tháng trước” compares the two months; “tại sao” keeps them', ([, b, c]) => {
    assert.ok((b.body.tools_used || []).some((t) => t.name === 'compare_borrow_periods'));
    assert.ok((c.body.tools_used || []).some((t) => t.name === 'compare_borrow_periods'));
  }],
  ['a lookup / trend answer carries no decision card', ([a]) => {
    assert.equal(a.body.decision ?? null, null);
  }],
]);

await conversation('warehouse follow-up', ['Kho HCM Chinh có bao nhiêu sách dưới ngưỡng?', 'Còn kho Hà Nội?'], [
  ['“còn kho Hà Nội?” re-asks the same question for Ha Noi', ([, b]) => {
    assert.ok((b.body.tools_used || []).some((t) => t.name === 'get_warehouse_low_stock_items' && (t.arguments || {}).warehouse === 'Kho Ha Noi'));
  }],
]);

const draft = await conversation('draft from a decision', ['Với 15 triệu nên nhập những sách nào?', 'Lập phiếu đề xuất nhập nháp với ngân sách 15.000.000 ₫'], [
  ['the draft is only a PENDING action that waits for an explicit confirm', ([, b]) => {
    assert.equal(b.body?.pending_action?.type, 'CREATE_REORDER_DRAFT');
    assert.equal(b.body.pending_action.status, 'PENDING_CONFIRMATION');
    assert.equal(b.body.pending_action.requires_confirmation, true);
  }],
]);
const pending = draft[1]?.body?.pending_action;
if (pending?.id) {
  // cleanup: never confirmed by this script
  await api('/ai/actions/cancel', { action_id: pending.id });
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed; ${turns.length} turns`);
const secs = turns.map((t) => t.seconds).sort((a, b) => a - b);
console.log(`latency p50 ${secs[Math.floor(secs.length / 2)]} s, max ${secs.at(-1)} s; verification ${JSON.stringify(
  turns.reduce((acc, t) => ({ ...acc, [t.verification]: (acc[t.verification] || 0) + 1 }), {}))}`);
if (OUT) writeFileSync(OUT, JSON.stringify({ ran_at: new Date().toISOString(), results, turns }, null, 1));
process.exit(failed.length ? 1 : 0);
