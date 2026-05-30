import type { AuthUser } from "@/services/auth";

export interface RouteAccessMeta {
  roles?: string[];
  permissions?: string[];
}

// Maps legacy role codes to canonical codes for JWT backward compatibility.
// Applied in hasAnyRole and getPrimaryRole so old tokens still work.
export const LEGACY_ROLE_MAP: Record<string, string> = {
  MANAGER: "WAREHOUSE_MANAGER",
  STAFF: "WAREHOUSE_STAFF",
  WAREHOUSE_OPERATOR: "WAREHOUSE_STAFF",
  CUSTOMER_SERVICE: "LIBRARIAN",
};

function normalizeRole(role: string): string {
  return LEGACY_ROLE_MAP[role.toUpperCase()] ?? role.toUpperCase();
}

// CUSTOMER and SUPPLIER are portal users, not internal staff.
const INTERNAL_ROLES = ["ADMIN", "WAREHOUSE_MANAGER", "WAREHOUSE_STAFF", "LIBRARIAN"];
const MANAGER_OPERATION_ROLES = ["ADMIN", "WAREHOUSE_MANAGER"];
const STAFF_TRACKING_ROLES = ["WAREHOUSE_STAFF"];
const LIBRARY_ROLES = ["ADMIN", "LIBRARIAN"];
const ADMIN_ROLES = ["ADMIN"];

export const ROUTE_ACCESS = {
  internal: { roles: INTERNAL_ROLES },
  catalog: { roles: [...MANAGER_OPERATION_ROLES, ...STAFF_TRACKING_ROLES, ...LIBRARY_ROLES, "CUSTOMER"], permissions: ["inventory.catalog.read"] },
  managerInventoryRead: { roles: MANAGER_OPERATION_ROLES, permissions: ["inventory.stock.read"] },
  inventoryRead: { roles: MANAGER_OPERATION_ROLES, permissions: ["inventory.stock.read"] },
  inventory: { roles: MANAGER_OPERATION_ROLES, permissions: ["inventory.stock.read"] },
  staffTasks: { roles: STAFF_TRACKING_ROLES, permissions: ["inventory.task.read"] },
  staffTaskProgress: { roles: [...STAFF_TRACKING_ROLES, ...MANAGER_OPERATION_ROLES], permissions: ["inventory.task.progress"] },
  managerStockDecision: { roles: MANAGER_OPERATION_ROLES, permissions: ["inventory.operation.decide"] },
  stockWrite: { roles: MANAGER_OPERATION_ROLES, permissions: ["inventory.operation.decide"] },
  stockAdjust: { roles: MANAGER_OPERATION_ROLES, permissions: ["inventory.stock.adjust"] },
  warehouseWrite: { roles: MANAGER_OPERATION_ROLES, permissions: ["inventory.warehouse.write"] },
  purchaseRead: { roles: MANAGER_OPERATION_ROLES, permissions: ["inventory.purchase.read", "inventory.purchase.write", "inventory.purchase.approve"] },
  purchaseWrite: { roles: MANAGER_OPERATION_ROLES, permissions: ["inventory.purchase.write"] },
  purchaseApprove: { roles: MANAGER_OPERATION_ROLES, permissions: ["inventory.purchase.approve"] },
  suppliers: { roles: MANAGER_OPERATION_ROLES, permissions: ["inventory.supplier.read", "inventory.purchase.read"] },
  supplierWrite: { roles: MANAGER_OPERATION_ROLES, permissions: ["inventory.supplier.write"] },
  supplierDeliveries: { roles: MANAGER_OPERATION_ROLES, permissions: ["inventory.supplier.read", "inventory.purchase.read"] },
  orderRequests: { roles: MANAGER_OPERATION_ROLES, permissions: ["inventory.operation.decide", "inventory.purchase.approve"] },
  borrowRead: { roles: LIBRARY_ROLES, permissions: ["borrow.read", "borrow.customers.read", "borrow.loans.read"] },
  borrowWrite: { roles: ["ADMIN", "LIBRARIAN"], permissions: ["borrow.write", "borrow.loans.write", "borrow.customers.write"] },
  reports: { roles: MANAGER_OPERATION_ROLES, permissions: ["reports.read", "analytics.reports.view", "analytics.read"] },
  admin: { roles: ADMIN_ROLES, permissions: ["auth.users.read", "auth.roles.read", "auth.permissions.read", "audit.read"] },
  customer: { roles: ["CUSTOMER"], permissions: ["customer.self.read", "inventory.catalog.read"] },
  supplier: { roles: ["SUPPLIER"], permissions: ["supplier.portal.read", "supplier.portal.write"] },
  purchaseRequest: { roles: [...STAFF_TRACKING_ROLES, ...MANAGER_OPERATION_ROLES], permissions: ["inventory.purchase.request"] },
  exceptionReport: { roles: [...STAFF_TRACKING_ROLES, ...MANAGER_OPERATION_ROLES], permissions: ["inventory.exception.report"] },
  purchaseRequestManage: { roles: MANAGER_OPERATION_ROLES, permissions: ["inventory.purchase.request"] },
  exceptionReportManage: { roles: MANAGER_OPERATION_ROLES, permissions: ["inventory.exception.report"] },
  purchaseRequestSelf: { roles: STAFF_TRACKING_ROLES, permissions: ["inventory.purchase.request"] },
  exceptionReportSelf: { roles: STAFF_TRACKING_ROLES, permissions: ["inventory.exception.report"] },
  warehousePutawayExecute: {
    roles: [...STAFF_TRACKING_ROLES, ...MANAGER_OPERATION_ROLES],
    permissions: ["inventory.task.progress", "inventory.operation.decide"],
  },
} satisfies Record<string, RouteAccessMeta>;

export function hasAnyRole(user: AuthUser | null | undefined, roles: string[] = []) {
  if (!roles.length) return true;
  if (user?.is_superuser) return true;
  const userRoles = new Set((user?.roles || []).map(normalizeRole));
  return roles.some((role) => userRoles.has(role.toUpperCase()));
}

export function hasAnyPermission(user: AuthUser | null | undefined, permissions: string[] = []) {
  if (!permissions.length) return true;
  if (user?.is_superuser) return true;
  const userPermissions = new Set(user?.permissions || []);
  return permissions.some((permission) => userPermissions.has(permission));
}

export function canAccess(user: AuthUser | null | undefined, meta?: RouteAccessMeta) {
  if (!meta) return true;
  if (user?.is_superuser) return true;
  return hasAnyRole(user, meta.roles) && hasAnyPermission(user, meta.permissions);
}

// Field-level visibility helpers. Backend remains the source of truth for security;
// these helpers only hide UI for the appropriate role.
export function canViewUnitCost(user: AuthUser | null | undefined) {
  if (user?.is_superuser) return true;
  return hasAnyRole(user, MANAGER_OPERATION_ROLES);
}

export function canManageReceiving(user: AuthUser | null | undefined) {
  if (user?.is_superuser) return true;
  return hasAnyRole(user, MANAGER_OPERATION_ROLES);
}

export function canViewLocationCode(user: AuthUser | null | undefined) {
  if (user?.is_superuser) return true;
  return hasAnyRole(user, MANAGER_OPERATION_ROLES);
}

export function getPrimaryRole(user: AuthUser | null | undefined) {
  const roles = (user?.roles || []).map(normalizeRole);
  const order = ["ADMIN", "WAREHOUSE_MANAGER", "LIBRARIAN", "WAREHOUSE_STAFF", "SUPPLIER", "CUSTOMER"];
  return order.find((role) => roles.includes(role)) || roles[0] || "UNKNOWN";
}

export function getHomePathForUser(user: AuthUser | null | undefined) {
  const role = getPrimaryRole(user);
  if (role === "CUSTOMER") return "/customer";
  if (role === "SUPPLIER") return "/supplier";
  if (role === "ADMIN") return "/users";
  if (role === "WAREHOUSE_MANAGER") return "/reports";
  if (role === "LIBRARIAN") return "/borrow";
  if (role === "WAREHOUSE_STAFF") return "/my-warehouse-tasks";
  return "/";
}
