// AI inventory rebalancing demo fixture (dev / test stack only - never production).
//
//   node scripts/demo/rebalancing-demo.mjs seed      reset, then create the fixture
//   node scripts/demo/rebalancing-demo.mjs reset     remove everything the fixture and the demo created
//   node scripts/demo/rebalancing-demo.mjs validate  check the plan the real backend computes from it
//
// What it creates (every row is marked DEMO-REB so reset removes exactly that):
// - account `rebalance.manager` (WAREHOUSE_MANAGER) with WH-HCM-01 FULL, WH-HN-01 READ,
//   WH-DN-01 FULL; its password hash is copied from the existing demo manager, so it
//   signs in with the same demo password as the other e2e users (DEMO_PASSWORD);
// - a shelf location DEMO-REB-<WH> in each of the three warehouses with stock of six
//   priced titles that have no other stock there: Hà Nội and Đà Nẵng hold copies,
//   TP.HCM is short;
// - returned loans at TP.HCM over the last four weeks (loan_number DEMO-REB-…), which
//   is the demand analytics forecasts from.
// Nothing here is a result: the shortages, safe transfers, options and budget split are
// computed by analytics from these rows (validate prints them).
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(import.meta.dirname, "..", "..");
const envPath = resolve(root, ".env");
const MARK = "DEMO-REB";
const USERNAME = "rebalance.manager";
const GATEWAY = process.env.GATEWAY_URL || "http://localhost:3000";

function readEnvVar(name, fallback) {
  if (!existsSync(envPath)) return fallback;
  const match = readFileSync(envPath, "utf8").match(new RegExp(`^${name}=(.*)$`, "m"));
  return match ? match[1].trim() : fallback;
}

if (["production", "prod"].includes(String(readEnvVar("NODE_ENV", process.env.NODE_ENV || "")).toLowerCase())) {
  console.error("Refusing to run: this fixture is for the dev / test stack only.");
  process.exit(2);
}

const dbUser = readEnvVar("DB_USER", "user");
const DB = {
  auth: readEnvVar("AUTH_DB_NAME", "auth_db"),
  inventory: readEnvVar("INVENTORY_DB_NAME", "inventory_db"),
  borrow: readEnvVar("BORROW_DB_NAME", "borrow_db"),
};

function psql(database, sql) {
  const result = spawnSync(
    "docker",
    ["compose", "exec", "-T", "db", "psql", "-U", dbUser, "-d", database, "-v", "ON_ERROR_STOP=1", "-tA", "-F", "|"],
    { cwd: root, encoding: "utf8", input: sql },
  );
  if (result.status !== 0) throw new Error(`psql ${database} failed: ${result.stderr || result.stdout}`);
  return result.stdout.trim().split("\n").filter(Boolean).map((line) => line.split("|"));
}

const lit = (v) => (v === null || v === undefined ? "NULL" : `'${String(v).replace(/'/g, "''")}'`);

function warehouses() {
  const rows = psql(DB.inventory, "SELECT code, id FROM warehouses WHERE code IN ('WH-HCM-01','WH-HN-01','WH-DN-01') AND is_active");
  const map = Object.fromEntries(rows.map(([code, id]) => [code, id]));
  for (const code of ["WH-HCM-01", "WH-HN-01", "WH-DN-01"]) {
    if (!map[code]) throw new Error(`warehouse ${code} missing: run pnpm demo:upgrade first`);
  }
  return { HCM: map["WH-HCM-01"], HN: map["WH-HN-01"], DN: map["WH-DN-01"] };
}

// Six priced titles with no stock at the three warehouses except the fixture's own
// locations, and no loan still open there (analytics refuses to plan a line whose
// open loans and inventory disagree) - so the same titles are picked on every run.
function titles(wh) {
  const open = psql(DB.borrow, `
    SELECT DISTINCT li.variant_id FROM loan_items li JOIN loan_transactions lt ON lt.id = li.loan_id
    WHERE li.return_date IS NULL AND li.status IN ('BORROWED', 'OVERDUE')
      AND lt.warehouse_id IN (${lit(wh.HCM)}, ${lit(wh.HN)}, ${lit(wh.DN)})`).map(([id]) => lit(id));
  const rows = psql(DB.inventory, `
    SELECT bv.id, b.title, bv.unit_cost FROM book_variants bv JOIN books b ON b.id = bv.book_id
    WHERE bv.is_active AND b.is_active AND bv.unit_cost > 0
      AND NOT EXISTS (SELECT 1 FROM stock_balances sb JOIN locations l ON l.id = sb.location_id
                      WHERE sb.variant_id = bv.id AND sb.warehouse_id IN (${lit(wh.HCM)}, ${lit(wh.HN)}, ${lit(wh.DN)})
                        AND l.location_code NOT LIKE '${MARK}-%')
      ${open.length ? `AND bv.id NOT IN (${open.join(",")})` : ""}
    ORDER BY bv.unit_cost DESC, bv.id LIMIT 6`);
  if (rows.length < 6) throw new Error("not enough priced titles without stock at the demo warehouses");
  return rows.map(([id, title, cost]) => ({ id, title, cost: Number(cost) }));
}

function reset() {
  const wh = warehouses();
  const user = psql(DB.auth, `SELECT id FROM users WHERE username = ${lit(USERNAME)}`)[0]?.[0] || null;
  psql(DB.borrow, `DELETE FROM loan_transactions WHERE loan_number LIKE '${MARK}-%';`); // items cascade
  psql(DB.inventory, `
    BEGIN;
    ${user ? `
    DELETE FROM transfer_order_items WHERE transfer_order_id IN (SELECT id FROM transfer_orders WHERE requested_by_user_id = ${lit(user)});
    DELETE FROM transfer_orders WHERE requested_by_user_id = ${lit(user)};
    DELETE FROM purchase_requests WHERE created_by_user_id = ${lit(user)};` : ""}
    DELETE FROM stock_balances WHERE location_id IN (SELECT id FROM locations WHERE location_code LIKE '${MARK}-%');
    DELETE FROM locations WHERE location_code LIKE '${MARK}-%' AND warehouse_id IN (${lit(wh.HCM)}, ${lit(wh.HN)}, ${lit(wh.DN)});
    COMMIT;`);
  console.log("reset: demo loans, stock, locations and the demo account's transfer / purchase requests removed");
}

function seed() {
  reset();
  const wh = warehouses();
  // account + scopes (idempotent)
  const role = psql(DB.auth, "SELECT id FROM roles WHERE code = 'WAREHOUSE_MANAGER'")[0]?.[0];
  if (!role) throw new Error("role WAREHOUSE_MANAGER missing: run pnpm demo:seed first");
  psql(DB.auth, `
    INSERT INTO users (username, email, password_hash, full_name, status, primary_warehouse_id, updated_at, email_verified_at)
    SELECT ${lit(USERNAME)}, 'rebalance.manager@smartbook.test', password_hash, 'Demo Rebalance Manager', 'ACTIVE',
           ${lit(wh.HCM)}, now(), now()
    FROM users WHERE username = 'manager01'
    ON CONFLICT (username) DO UPDATE SET status = 'ACTIVE', deleted_at = NULL, updated_at = now();
    INSERT INTO user_roles (user_id, role_id)
    SELECT u.id, ${lit(role)} FROM users u WHERE u.username = ${lit(USERNAME)}
      AND NOT EXISTS (SELECT 1 FROM user_roles ur WHERE ur.user_id = u.id AND ur.role_id = ${lit(role)});
    DELETE FROM user_warehouse_scopes WHERE user_id = (SELECT id FROM users WHERE username = ${lit(USERNAME)});
    INSERT INTO user_warehouse_scopes (user_id, warehouse_id, access_level)
    SELECT u.id, s.wh::uuid, s.level FROM users u,
      (VALUES (${lit(wh.HCM)}, 'FULL'), (${lit(wh.HN)}, 'READ'), (${lit(wh.DN)}, 'FULL')) AS s(wh, level)
    WHERE u.username = ${lit(USERNAME)};`);
  const user = psql(DB.auth, `SELECT id FROM users WHERE username = ${lit(USERNAME)}`)[0][0];

  // stock: [title index, warehouse, copies, safety stock]
  const t = titles(wh);
  const stock = [[0, "HCM", 2, 0], [0, "HN", 20, 2], [1, "HN", 16, 2], [0, "DN", 8, 2], [2, "DN", 12, 2], [5, "DN", 12, 2]];
  const loc = { HCM: `${MARK}-HCM`, HN: `${MARK}-HN`, DN: `${MARK}-DN` };
  psql(DB.inventory, `
    BEGIN;
    ${Object.entries(loc).map(([k, code]) => `INSERT INTO locations (warehouse_id, location_code, location_type, zone, is_active)
      VALUES (${lit(wh[k])}, ${lit(code)}, 'SHELF', 'DEMO', true);`).join("\n")}
    ${stock.map(([i, k, qty, safety]) => `INSERT INTO stock_balances (warehouse_id, variant_id, location_id, on_hand_qty, available_qty, safety_stock_qty)
      SELECT ${lit(wh[k])}, ${lit(t[i].id)}, id, ${qty}, ${qty}, ${safety} FROM locations WHERE location_code = ${lit(loc[k])};`).join("\n")}
    COMMIT;`);

  // demand at TP.HCM: returned loans over the last 28 days (copies per title)
  const loans = [[0, 70], [1, 56], [2, 48], [3, 64], [4, 54]];
  const customer = psql(DB.borrow, "SELECT id FROM customers WHERE status = 'ACTIVE' ORDER BY created_at LIMIT 1")[0]?.[0];
  if (!customer) throw new Error("no active customer: run pnpm demo:seed first");
  const values = [];
  let n = 0;
  for (const [i, count] of loans) {
    for (let k = 0; k < count; k += 1) {
      n += 1;
      const daysAgo = 3 + ((k * 25) / count); // spread over days 3..28
      values.push(`(${lit(`${MARK}-${String(n).padStart(4, "0")}`)}, ${lit(t[i].id)}, ${daysAgo.toFixed(2)})`);
    }
  }
  psql(DB.borrow, `
    WITH src(loan_number, variant_id, days_ago) AS (VALUES ${values.join(",\n")}),
    ins AS (
      INSERT INTO loan_transactions (loan_number, customer_id, warehouse_id, handled_by_user_id, borrow_date, due_date, closed_at,
                                     status, total_items, notes, updated_at)
      SELECT loan_number, ${lit(customer)}, ${lit(wh.HCM)}, ${lit(user)}, now() - days_ago * interval '1 day',
             now() - (days_ago - 14) * interval '1 day', now() - (days_ago - 2) * interval '1 day', 'RETURNED', 1,
             'AI rebalancing demo fixture', now()
      FROM src RETURNING id, loan_number, borrow_date
    )
    INSERT INTO loan_items (loan_id, variant_id, due_date, return_date, returned_to_warehouse_id, status, item_condition_on_return)
    SELECT ins.id, src.variant_id::uuid, ins.borrow_date + interval '14 days', ins.borrow_date + interval '2 days',
           ${lit(wh.HCM)}, 'RETURNED', 'GOOD'
    FROM ins JOIN src ON src.loan_number = ins.loan_number;`);
  console.log(`seed: ${USERNAME} (HCM FULL, HN READ, DN FULL), ${stock.length} stock rows, ${n} loans at TP.HCM`);
  for (const [i, title] of t.entries()) console.log(`  T${i + 1} ${title.title} (${title.cost.toLocaleString("vi-VN")} ₫)`);
}

async function api(path, token) {
  const res = await fetch(`${GATEWAY}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status} ${await res.text()}`);
  return (await res.json()).data;
}

async function validate() {
  const wh = warehouses();
  const login = await fetch(`${GATEWAY}/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: USERNAME, password: process.env.DEMO_PASSWORD || "123456" }),
  });
  if (!login.ok) throw new Error(`login failed: HTTP ${login.status}`);
  const { token } = await login.json();
  const at15 = await api(`/analytics/rebalancing-plan?destinationWarehouseId=${wh.HCM}&budgetVnd=15000000`, token);
  const at12 = await api(`/analytics/rebalancing-plan?destinationWarehouseId=${wh.HCM}&budgetVnd=12000000`, token);
  const checks = [];
  const check = (name, ok, detail) => { checks.push({ name, ok: Boolean(ok), detail }); };
  const access = Object.fromEntries(at15.scope.warehouses.map((w) => [w.warehouse_id, w.access]));
  check("scope: HCM WRITE, HN READ, DN WRITE", access[wh.HCM] === "WRITE" && access[wh.HN] === "READ" && access[wh.DN] === "WRITE",
    JSON.stringify(access));
  const hcm = at15.diagnosis.find((d) => d.warehouse_id === wh.HCM);
  check("TP.HCM is short", hcm.shortage_qty > 0, `${hcm.shortage_variants} titles / ${hcm.shortage_qty} copies`);
  const surplus = at15.diagnosis.filter((d) => d.warehouse_id !== wh.HCM).reduce((s, d) => s + d.surplus_qty, 0);
  check("Hà Nội / Đà Nẵng hold surplus", surplus > 0, `${surplus} copies`);
  const hybrid = at15.options.HYBRID;
  check("a transfer from Hà Nội is collaborative", hybrid.transfers.some((x) => x.from_warehouse_id === wh.HN && x.permission === "COLLABORATIVE"));
  const exec = at15.options.HYBRID_EXECUTABLE || at15.options[at15.recommendation.executable_option];
  check("an executable plan exists", Boolean(at15.recommendation.executable_option), at15.recommendation.executable_option);
  check("the executable plan moves stock from Đà Nẵng", exec?.transfers.some((x) => x.from_warehouse_id === wh.DN && x.permission === "EXECUTABLE"));
  check("procurement is needed", at15.options.PROCUREMENT_ONLY.purchase_qty > 0, `${at15.options.PROCUREMENT_ONLY.purchase_qty} copies`);
  check("15 M budget never overspent", Object.values(at15.options).every((o) => o.purchase_cost_vnd <= 15_000_000));
  check("budget -20% does not raise coverage", at12.options.HYBRID.shortage_covered_pct <= hybrid.shortage_covered_pct,
    `${hybrid.shortage_covered_pct}% -> ${at12.options.HYBRID.shortage_covered_pct}%`);
  for (const [label, plan] of [["15 M", at15], ["12 M", at12]]) {
    console.log(`\nBudget ${label}: best = ${plan.recommendation.best_business_option}, executable = ${plan.recommendation.executable_option}`);
    for (const o of Object.values(plan.options)) {
      console.log(`  ${o.code.padEnd(18)} covered ${String(o.shortage_covered_pct).padStart(5)}%  transfer ${o.transfer_qty}  `
        + `buy ${o.purchase_qty} (${Math.round(o.purchase_cost_vnd).toLocaleString("vi-VN")} ₫)  left ${o.remaining_shortage_qty}  `
        + `collaborative ${o.collaborative_transfer_lines}`);
    }
  }
  console.log("");
  for (const c of checks) console.log(`${c.ok ? "PASS" : "FAIL"}  ${c.name}${c.detail ? `  (${c.detail})` : ""}`);
  if (checks.some((c) => !c.ok)) process.exit(1);
}

const command = process.argv[2];
try {
  if (command === "seed") seed();
  else if (command === "reset") reset();
  else if (command === "validate") await validate();
  else {
    console.error("usage: node scripts/demo/rebalancing-demo.mjs seed|reset|validate");
    process.exit(2);
  }
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
