import fs from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const sidebarPath = path.join(root, 'apps/web/src/components/sidebar.tsx');
const routesPath = path.join(root, 'apps/web/src/app/routes.ts');
const loginPath = path.join(root, 'apps/web/src/components/pages/login.tsx');
const rbacPath = path.join(root, 'apps/web/src/lib/rbac.ts');
const myTasksPath = path.join(root, 'apps/web/src/components/pages/my-warehouse-tasks.tsx');

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
  const [sidebar, routes, login, rbac, myTasks] = await Promise.all([
    read(sidebarPath),
    read(routesPath),
    read(loginPath),
    read(rbacPath),
    read(myTasksPath),
  ]);

  expect('RBAC helper exists', rbac.includes('function canAccess') && rbac.includes('getHomePathForUser'));
  expect('STAFF home path is my warehouse tasks', rbac.includes('role === "STAFF"') && rbac.includes('return "/my-warehouse-tasks"'));
  expect('MANAGER home path is reports', rbac.includes('role === "MANAGER"') && rbac.includes('return "/reports"'));
  expect('LIBRARIAN home path is borrow', rbac.includes('role === "LIBRARIAN"') && rbac.includes('return "/borrow"'));
  expect('CUSTOMER home path is customer portal', rbac.includes('role === "CUSTOMER"') && rbac.includes('return "/customer"'));
  expect('ADMIN home path is users', rbac.includes('role === "ADMIN"') && rbac.includes('return "/users"'));

  expect('login uses role home redirect', login.includes('getHomePathForUser(loginData.user)'));
  expect('staff task route exists', routes.includes('path: "my-warehouse-tasks"') && routes.includes('ROUTE_ACCESS.staffTasks'));
  expect('direct purchase order create route guarded', routes.includes('path: "purchase-orders/new"') && routes.includes('ROUTE_ACCESS.purchaseWrite'));
  expect('direct order request route is manager guarded', routes.includes('path: "order-requests"') && routes.includes('ROUTE_ACCESS.orderRequests'));
  expect('direct outbound route is manager guarded', routes.includes('path: "outbound"') && routes.includes('ROUTE_ACCESS.managerStockDecision'));
  expect('direct warehouses route is manager guarded', routes.includes('path: "warehouses"') && routes.includes('ROUTE_ACCESS.warehouseWrite'));
  expect('forbidden route configured', routes.includes('path: "forbidden"') && routes.includes('ForbiddenPage'));
  expect('customer cannot use internal root loader', routes.includes('roles.includes("CUSTOMER")') && routes.includes('throw redirect("/customer")'));

  expect('sidebar filters items through canAccess', sidebar.includes('items.filter((item) => canAccess(user, item.access))'));
  expect('scan receive CTA requires manager stock decision', sidebar.includes('canReceiveStock') && sidebar.includes('ROUTE_ACCESS.stockWrite'));
  expect('staff sidebar has my warehouse tasks', sidebar.includes('label: "My Warehouse Tasks"') && sidebar.includes('access: ROUTE_ACCESS.staffTasks'));
  expect('staff sidebar inventory is read guarded', sidebar.includes('label: "Inventory"') && sidebar.includes('access: ROUTE_ACCESS.inventoryRead'));
  expect('Purchase Orders sidebar item is purchase guarded', sidebar.includes('label: "Purchase Orders"') && sidebar.includes('access: ROUTE_ACCESS.purchaseRead'));
  expect('Order Requests sidebar item is manager guarded', sidebar.includes('label: "Order Requests"') && sidebar.includes('access: ROUTE_ACCESS.orderRequests'));
  expect('Outbound sidebar item is manager guarded', sidebar.includes('label: "Outbound"') && sidebar.includes('access: ROUTE_ACCESS.managerStockDecision'));
  expect('Warehouses sidebar item is warehouse write guarded', sidebar.includes('label: "Warehouses"') && sidebar.includes('access: ROUTE_ACCESS.warehouseWrite'));
  expect('Suppliers sidebar item is manager guarded', sidebar.includes('label: "Suppliers"') && sidebar.includes('access: ROUTE_ACCESS.suppliers'));
  expect('Users sidebar item is admin guarded', sidebar.includes('label: "Users"') && sidebar.includes('access: ROUTE_ACCESS.admin'));
  expect('Roles sidebar item is admin guarded', sidebar.includes('label: "Roles"') && sidebar.includes('access: ROUTE_ACCESS.admin'));
  expect('Borrow sidebar items are borrow guarded', sidebar.includes('label: "Borrow"') && sidebar.includes('access: ROUTE_ACCESS.borrowRead'));
  expect('Reports sidebar item is report guarded', sidebar.includes('label: "Reports"') && sidebar.includes('access: ROUTE_ACCESS.reports'));
  expect('My Warehouse Tasks page has assigned-task empty state', myTasks.includes('Chua co task duoc giao') && myTasks.includes('myWarehouseTaskService.getMyTasks'));
  expect('stockWrite no longer includes staff roles', rbac.includes('stockWrite: { roles: MANAGER_OPERATION_ROLES'));
  expect('manager operation roles separated from staff tracking roles', rbac.includes('MANAGER_OPERATION_ROLES') && rbac.includes('STAFF_TRACKING_ROLES'));
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
