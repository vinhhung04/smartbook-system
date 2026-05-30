import fs from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const sidebarPath = path.join(root, 'apps/web/src/components/sidebar.tsx');
const routesPath = path.join(root, 'apps/web/src/app/routes.ts');
const loginPath = path.join(root, 'apps/web/src/components/pages/login.tsx');
const rbacPath = path.join(root, 'apps/web/src/lib/rbac.ts');
const myTasksPath = path.join(root, 'apps/web/src/components/pages/my-warehouse-tasks.tsx');
const pickingPath = path.join(root, 'apps/web/src/components/pages/picking.tsx');
const purchaseRequestsServicePath = path.join(root, 'apps/web/src/services/purchase-requests.ts');
const exceptionReportsServicePath = path.join(root, 'apps/web/src/services/exception-reports.ts');
const myPurchaseRequestsPath = path.join(root, 'apps/web/src/components/pages/my-purchase-requests.tsx');
const myExceptionReportsPath = path.join(root, 'apps/web/src/components/pages/my-exception-reports.tsx');
const exceptionReportsPagePath = path.join(root, 'apps/web/src/components/pages/exception-reports.tsx');
const indexHtmlPath = path.join(root, 'apps/web/index.html');
const i18nPath = path.join(root, 'apps/web/src/lib/i18n.tsx');
const orderDetailPath = path.join(root, 'apps/web/src/components/pages/order-detail.tsx');
const goodsReceiptPath = path.join(root, 'apps/web/src/components/pages/goods-receipt.tsx');
const outboundPath = path.join(root, 'apps/web/src/components/pages/outbound.tsx');

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
  const [sidebar, routes, login, rbac, myTasks, picking, purchaseRequestsService, exceptionReportsService, myPurchaseRequests, myExceptionReports, exceptionReportsPage, indexHtml, i18nFile, orderDetail, goodsReceipt, outbound] = await Promise.all([
    read(sidebarPath),
    read(routesPath),
    read(loginPath),
    read(rbacPath),
    read(myTasksPath),
    read(pickingPath),
    read(purchaseRequestsServicePath),
    read(exceptionReportsServicePath),
    read(myPurchaseRequestsPath),
    read(myExceptionReportsPath),
    read(exceptionReportsPagePath),
    read(indexHtmlPath),
    read(i18nPath),
    read(orderDetailPath),
    read(goodsReceiptPath),
    read(outboundPath),
  ]);

  expect('RBAC helper exists', rbac.includes('function canAccess') && rbac.includes('getHomePathForUser'));
  expect('WAREHOUSE_STAFF home path is my warehouse tasks', rbac.includes('role === "WAREHOUSE_STAFF"') && rbac.includes('return "/my-warehouse-tasks"'));
  expect('WAREHOUSE_MANAGER home path is reports', rbac.includes('role === "WAREHOUSE_MANAGER"') && rbac.includes('return "/reports"'));
  expect('LIBRARIAN home path is borrow', rbac.includes('role === "LIBRARIAN"') && rbac.includes('return "/borrow"'));
  expect('CUSTOMER home path is customer portal', rbac.includes('role === "CUSTOMER"') && rbac.includes('return "/customer"'));
  expect('ADMIN home path is users', rbac.includes('role === "ADMIN"') && rbac.includes('return "/users"'));

  expect('login uses role home redirect', login.includes('getHomePathForUser(loginData.user)'));
  expect('staff task route exists', routes.includes('path: "my-warehouse-tasks"') && routes.includes('ROUTE_ACCESS.staffTasks'));
  expect('staff receiving draft route exists', routes.includes('path: "orders/new"') && routes.includes('ROUTE_ACCESS.staffTaskProgress'));
  expect('direct purchase order create route guarded', routes.includes('path: "purchase-orders/new"') && routes.includes('ROUTE_ACCESS.purchaseWrite'));
  expect('direct order request route is manager guarded', routes.includes('path: "order-requests"') && routes.includes('ROUTE_ACCESS.orderRequests'));
  expect('direct outbound route is assigned-task guarded', routes.includes('path: "outbound"') && routes.includes('ROUTE_ACCESS.staffTaskProgress'));
  expect('direct warehouses route is manager guarded', routes.includes('path: "warehouses"') && routes.includes('ROUTE_ACCESS.warehouseWrite'));
  expect('direct inventory route is manager inventory guarded', routes.includes('path: "inventory"') && routes.includes('ROUTE_ACCESS.managerInventoryRead'));
  expect('direct movements route is manager inventory guarded', routes.includes('path: "movements"') && routes.includes('ROUTE_ACCESS.managerInventoryRead'));
  expect('forbidden route configured', routes.includes('path: "forbidden"') && routes.includes('ForbiddenPage'));
  expect('customer cannot use internal root loader', routes.includes('roles.includes("CUSTOMER")') && routes.includes('throw redirect("/customer")'));

  expect('sidebar filters items through canAccess', sidebar.includes('items.filter((item) => canAccess(user, item.access))'));
  expect('scan receive CTA requires assigned task progress', sidebar.includes('canReceiveStock') && sidebar.includes('ROUTE_ACCESS.staffTaskProgress'));
  expect('staff sidebar has my warehouse tasks', sidebar.includes('labelKey: "sidebar.my_tasks"') && sidebar.includes('access: ROUTE_ACCESS.staffTasks'));
  expect('dashboard sidebar item is report guarded', sidebar.includes('labelKey: "sidebar.dashboard"') && sidebar.includes('access: ROUTE_ACCESS.reports'));
  expect('inventory sidebar item is manager guarded', sidebar.includes('labelKey: "sidebar.inventory"') && sidebar.includes('access: ROUTE_ACCESS.managerInventoryRead'));
  expect('Purchase Orders sidebar item is purchase guarded', sidebar.includes('labelKey: "sidebar.purchase_orders"') && sidebar.includes('access: ROUTE_ACCESS.purchaseRead'));
  expect('Order Requests sidebar item is manager guarded', sidebar.includes('labelKey: "sidebar.order_requests"') && sidebar.includes('access: ROUTE_ACCESS.orderRequests'));
  expect('Outbound sidebar item is manager guarded', sidebar.includes('labelKey: "sidebar.outbound"') && sidebar.includes('access: ROUTE_ACCESS.managerStockDecision'));
  expect('Warehouses sidebar item is warehouse write guarded', sidebar.includes('labelKey: "sidebar.warehouses"') && sidebar.includes('access: ROUTE_ACCESS.warehouseWrite'));
  expect('Suppliers sidebar item is manager guarded', sidebar.includes('labelKey: "sidebar.suppliers"') && sidebar.includes('access: ROUTE_ACCESS.suppliers'));
  expect('Users sidebar item is admin guarded', sidebar.includes('labelKey: "sidebar.users"') && sidebar.includes('access: ROUTE_ACCESS.admin'));
  expect('Roles sidebar item is admin guarded', sidebar.includes('labelKey: "sidebar.roles"') && sidebar.includes('access: ROUTE_ACCESS.admin'));
  expect('Borrow sidebar items are borrow guarded', sidebar.includes('labelKey: "sidebar.borrow"') && sidebar.includes('access: ROUTE_ACCESS.borrowRead'));
  expect('Reports sidebar item is report guarded', sidebar.includes('labelKey: "sidebar.reports"') && sidebar.includes('access: ROUTE_ACCESS.reports'));
  expect('My Warehouse Tasks page has assigned-task empty state', myTasks.includes('Chưa có task được giao') && myTasks.includes('myWarehouseTaskService.getMyTasks'));
  expect('My Warehouse Tasks page mutation calls only for self-claim', myTasks.includes('claimTask') && myTasks.includes('handleClaimTask'));
  expect('My Warehouse Tasks page has available tasks section', myTasks.includes('getAvailableTasks') && myTasks.includes('Nhận task'));
  expect('My Warehouse Tasks page handles 409 conflict gracefully', myTasks.includes('409') && myTasks.includes('vừa được nhân viên khác nhận'));
  expect('My Warehouse Tasks page links to execution routes', myTasks.includes('getTaskActionPath') && myTasks.includes('taskActionLabel'));
  expect('My Warehouse Tasks handles purchase request type', myTasks.includes('PURCHASE_REQUEST'));
  expect('My Warehouse Tasks handles exception report type', myTasks.includes('EXCEPTION_REPORT'));
  expect('Picking page has manager task assignment UI', picking.includes('Giao task') && picking.includes('userService.getWarehouseStaff') && picking.includes('pickerUserId'));
  expect('stockWrite no longer includes staff roles', rbac.includes('stockWrite: { roles: MANAGER_OPERATION_ROLES'));
  expect('staff cannot satisfy manager inventory read roles', rbac.includes('managerInventoryRead: { roles: MANAGER_OPERATION_ROLES'));
  expect('manager operation roles separated from staff tracking roles', rbac.includes('MANAGER_OPERATION_ROLES') && rbac.includes('STAFF_TRACKING_ROLES'));
  expect('purchaseRequest access in ROUTE_ACCESS', rbac.includes('purchaseRequest:') && rbac.includes('inventory.purchase.request'));
  expect('exceptionReport access in ROUTE_ACCESS', rbac.includes('exceptionReport:') && rbac.includes('inventory.exception.report'));
  expect('my-purchase-requests route uses purchaseRequestSelf', routes.includes('path: "my-purchase-requests"') && routes.includes('ROUTE_ACCESS.purchaseRequestSelf'));
  expect('my-exception-reports route uses exceptionReportSelf', routes.includes('path: "my-exception-reports"') && routes.includes('ROUTE_ACCESS.exceptionReportSelf'));
  expect('My Purchase Requests sidebar item is WAREHOUSE_STAFF-only guarded', sidebar.includes('labelKey: "sidebar.my_purchase_requests"') && sidebar.includes('access: ROUTE_ACCESS.purchaseRequestSelf'));
  expect('My Exception Reports sidebar item is WAREHOUSE_STAFF-only guarded', sidebar.includes('labelKey: "sidebar.my_exception_reports"') && sidebar.includes('access: ROUTE_ACCESS.exceptionReportSelf'));

  expect('MyPurchaseRequestsPage uses getReceivingWarehouses', myPurchaseRequests.includes('getReceivingWarehouses'));
  expect('MyExceptionReportsPage uses getReceivingWarehouses', myExceptionReports.includes('getReceivingWarehouses'));
  expect('purchaseRequestManage in ROUTE_ACCESS', rbac.includes('purchaseRequestManage:') && rbac.includes('MANAGER_OPERATION_ROLES'));
  expect('exceptionReportManage in ROUTE_ACCESS', rbac.includes('exceptionReportManage:') && rbac.includes('MANAGER_OPERATION_ROLES'));
  expect('purchase-requests manager route exists', routes.includes('path: "purchase-requests"') && routes.includes('ROUTE_ACCESS.purchaseRequestManage'));
  expect('exception-reports manager route exists', routes.includes('path: "exception-reports"') && routes.includes('ROUTE_ACCESS.exceptionReportManage'));
  expect('Purchase Requests manager sidebar item guarded', sidebar.includes('labelKey: "sidebar.purchase_requests"') && sidebar.includes('access: ROUTE_ACCESS.purchaseRequestManage'));
  expect('Exception Reports manager sidebar item guarded', sidebar.includes('labelKey: "sidebar.exception_reports"') && sidebar.includes('access: ROUTE_ACCESS.exceptionReportManage'));
  expect('purchaseRequestService has convertToPO', purchaseRequestsService.includes('convertToPO'));
  expect('exceptionReportService has resolve method', exceptionReportsService.includes('resolve'));
  expect('CTA changed from Scan Receive', !sidebar.includes('Scan &amp; Receive'));
  expect('CTA uses i18n key sidebar.scan_receive_cta', sidebar.includes("t('sidebar.scan_receive_cta')"));
  expect('i18n has Vietnamese scan receive translation with diacritics', i18nFile.includes("'sidebar.scan_receive_cta': 'Ghi nhận hàng nhận'"));

  // Phase 1 — i18n & encoding foundation
  expect('index.html declares lang="vi"', indexHtml.includes('lang="vi"'));
  expect('index.html declares UTF-8 charset', indexHtml.includes('charset="UTF-8"'));
  expect('index.html title is Vietnamese', indexHtml.includes('Hệ thống quản lý thư viện'));
  expect('i18n provider syncs document.documentElement.lang', i18nFile.includes('document.documentElement.lang = locale'));
  expect('i18n covers staff self-service sidebar labels (vi)', i18nFile.includes("'sidebar.my_tasks': 'Công việc kho của tôi'") && i18nFile.includes("'sidebar.my_purchase_requests': 'Yêu cầu mua hàng của tôi'") && i18nFile.includes("'sidebar.my_exception_reports': 'Báo cáo sự cố của tôi'"));
  expect('sidebar uses useI18n for label rendering', sidebar.includes('useI18n') && sidebar.includes('t(item.labelKey)') && sidebar.includes('t(group.labelKey)'));
  expect('purchaseRequestSelf in ROUTE_ACCESS WAREHOUSE_STAFF only', rbac.includes('purchaseRequestSelf:') && rbac.includes('STAFF_TRACKING_ROLES'));
  expect('exceptionReportSelf in ROUTE_ACCESS WAREHOUSE_STAFF only', rbac.includes('exceptionReportSelf:') && rbac.includes('STAFF_TRACKING_ROLES'));

  // Phase 2 — siết role + helpers field-level visibility
  expect('staffTasks restricted to STAFF_TRACKING_ROLES only', rbac.includes('staffTasks: { roles: STAFF_TRACKING_ROLES'));
  expect('rbac exports canViewUnitCost helper', rbac.includes('export function canViewUnitCost'));
  expect('rbac exports canManageReceiving helper', rbac.includes('export function canManageReceiving'));
  expect('rbac exports canViewLocationCode helper', rbac.includes('export function canViewLocationCode'));

  // Phase 3a — STAFF field-level RBAC (UI gating)
  expect('order-detail imports field-level helpers', orderDetail.includes('canManageReceiving') && orderDetail.includes('canViewUnitCost') && orderDetail.includes('canViewLocationCode'));
  expect('order-detail no longer hardcodes role string for receiving', !/roles\.includes\("ADMIN"\)\s*\|\|\s*roles\.includes\("MANAGER"\)/.test(orderDetail));
  expect('order-detail gates location column with showLocation', orderDetail.includes('showLocation ?') && orderDetail.includes('Vị trí'));
  expect('order-detail gates unit_cost column with showUnitCost', orderDetail.includes('showUnitCost ?') && orderDetail.includes('Đơn giá'));
  expect('order-detail summary hides total value behind showUnitCost', orderDetail.includes('Tổng giá trị') && orderDetail.includes('{showUnitCost ?'));
  expect('goods-receipt imports field-level helpers', goodsReceipt.includes('rbacCanManageReceiving') && goodsReceipt.includes('canViewUnitCost'));
  expect('goods-receipt no longer hardcodes role string', !/currentUserRoles\.includes\("ADMIN"\)/.test(goodsReceipt));
  expect('goods-receipt gates unit_cost input with showUnitCost', goodsReceipt.includes('{showUnitCost ?') && goodsReceipt.includes('Giá nhập'));
  expect('outbound page uses canManageReceiving helper', outbound.includes('canManageReceiving(currentUser)') && !/currentUserRoles\.includes\('ADMIN'\)/.test(outbound));
  expect('picking page uses canManageReceiving helper', picking.includes('canManageReceiving(currentUser)') && !/currentUserRoles\.includes\("ADMIN"\)/.test(picking));
  expect('exception-reports manager page uses React.Fragment key', exceptionReportsPage.includes('React.Fragment'));
  expect('my-exception-reports task dropdown not UUID text input', !myExceptionReports.includes('"UUID hoặc mã task"') && !myExceptionReports.includes('"UUID hoac ma task"'));
  expect('my-warehouse-tasks has Bao cao exception button', myTasks.includes('handleReportException') && myTasks.includes('OPERATIONAL_TYPES'));
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
