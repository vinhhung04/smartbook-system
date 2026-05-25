import fs from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const sidebarPath = path.join(root, 'apps/web/src/components/sidebar.tsx');
const routesPath = path.join(root, 'apps/web/src/app/routes.ts');
const loginPath = path.join(root, 'apps/web/src/components/pages/login.tsx');
const rbacPath = path.join(root, 'apps/web/src/lib/rbac.ts');

let passed = 0;
let total = 0;

function expect(label, condition, detail = '') {
  total += 1;
  if (!condition) {
    throw new Error(`FAIL ${label}${detail ? `: ${detail}` : ''}`);
  }
  passed += 1;
  console.log(`PASS ${label}`);
}

async function read(file) {
  return fs.readFile(file, 'utf8');
}

async function runStaticSmoke() {
  const [sidebar, routes, login, rbac] = await Promise.all([
    read(sidebarPath),
    read(routesPath),
    read(loginPath),
    read(rbacPath),
  ]);

  expect('RBAC helper exists', rbac.includes('function canAccess') && rbac.includes('getHomePathForUser'));
  expect('STAFF home path is inventory', rbac.includes('role === "STAFF"') && rbac.includes('return "/inventory"'));
  expect('MANAGER home path is reports', rbac.includes('role === "MANAGER"') && rbac.includes('return "/reports"'));
  expect('LIBRARIAN home path is borrow', rbac.includes('role === "LIBRARIAN"') && rbac.includes('return "/borrow"'));
  expect('CUSTOMER home path is customer portal', rbac.includes('role === "CUSTOMER"') && rbac.includes('return "/customer"'));
  expect('ADMIN home path is users', rbac.includes('role === "ADMIN"') && rbac.includes('return "/users"'));

  expect('login uses role home redirect', login.includes('getHomePathForUser(loginData.user)'));
  expect('direct purchase order create route guarded', routes.includes('path: "purchase-orders/new"') && routes.includes('ROUTE_ACCESS.purchaseWrite'));
  expect('forbidden route configured', routes.includes('path: "forbidden"') && routes.includes('ForbiddenPage'));
  expect('customer cannot use internal root loader', routes.includes('roles.includes("CUSTOMER")') && routes.includes('throw redirect("/customer")'));

  expect('sidebar filters items through canAccess', sidebar.includes('items.filter((item) => canAccess(user, item.access))'));
  expect('scan receive CTA requires stock write', sidebar.includes('canReceiveStock') && sidebar.includes('ROUTE_ACCESS.stockWrite'));
  expect('Purchase Orders sidebar item is purchase guarded', sidebar.includes('label: "Purchase Orders"') && sidebar.includes('access: ROUTE_ACCESS.purchaseRead'));
  expect('Users sidebar item is admin guarded', sidebar.includes('label: "Users"') && sidebar.includes('access: ROUTE_ACCESS.admin'));
  expect('Roles sidebar item is admin guarded', sidebar.includes('label: "Roles"') && sidebar.includes('access: ROUTE_ACCESS.admin'));
  expect('Borrow sidebar items are borrow guarded', sidebar.includes('label: "Borrow"') && sidebar.includes('access: ROUTE_ACCESS.borrowRead'));
  expect('Reports sidebar item is report guarded', sidebar.includes('label: "Reports"') && sidebar.includes('access: ROUTE_ACCESS.reports'));
}

async function run() {
  await runStaticSmoke();
  console.log(`FRONTEND_RBAC_PASS=${passed} TOTAL=${total}`);
  console.log('NOTE browser smoke: Playwright is not configured in this workspace, so this script performs static RBAC route/sidebar checks.');
}

run().catch((error) => {
  console.error(error.message || error);
  console.error(`FRONTEND_RBAC_PASS=${passed} TOTAL=${total}`);
  process.exit(1);
});
