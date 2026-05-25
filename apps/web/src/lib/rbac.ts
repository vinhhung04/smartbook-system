import type { AuthUser } from "@/services/auth";

export interface RouteAccessMeta {
  roles?: string[];
  permissions?: string[];
}

const INTERNAL_ROLES = ["ADMIN", "MANAGER", "STAFF", "WAREHOUSE_STAFF", "WAREHOUSE_OPERATOR", "LIBRARIAN", "CUSTOMER_SERVICE"];
const MANAGER_OPERATION_ROLES = ["ADMIN", "MANAGER"];
const STAFF_TRACKING_ROLES = ["STAFF", "WAREHOUSE_STAFF", "WAREHOUSE_OPERATOR"];
const INVENTORY_READ_ROLES = [...MANAGER_OPERATION_ROLES, ...STAFF_TRACKING_ROLES];
const LIBRARY_ROLES = ["ADMIN", "MANAGER", "LIBRARIAN", "CUSTOMER_SERVICE"];
const ADMIN_ROLES = ["ADMIN"];

export const ROUTE_ACCESS = {
  internal: { roles: INTERNAL_ROLES },
  catalog: { roles: [...INVENTORY_READ_ROLES, ...LIBRARY_ROLES], permissions: ["inventory.catalog.read"] },
  inventoryRead: { roles: INVENTORY_READ_ROLES, permissions: ["inventory.stock.read"] },
  inventory: { roles: INVENTORY_READ_ROLES, permissions: ["inventory.stock.read"] },
  staffTasks: { roles: [...STAFF_TRACKING_ROLES, ...MANAGER_OPERATION_ROLES], permissions: ["inventory.task.read"] },
  staffTaskUpdate: { roles: [...STAFF_TRACKING_ROLES, ...MANAGER_OPERATION_ROLES], permissions: ["inventory.task.update"] },
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
  borrowWrite: { roles: ["ADMIN", "LIBRARIAN", "CUSTOMER_SERVICE"], permissions: ["borrow.write", "borrow.loans.write", "borrow.customers.write"] },
  reports: { roles: MANAGER_OPERATION_ROLES, permissions: ["reports.read", "analytics.reports.view", "analytics.read"] },
  admin: { roles: ADMIN_ROLES, permissions: ["auth.users.read", "auth.roles.read", "auth.permissions.read", "audit.read"] },
  customer: { roles: ["CUSTOMER"], permissions: ["customer.self.read", "inventory.catalog.read"] },
  supplier: { roles: ["SUPPLIER"], permissions: ["supplier.portal.read", "supplier.portal.write"] },
} satisfies Record<string, RouteAccessMeta>;

export function hasAnyRole(user: AuthUser | null | undefined, roles: string[] = []) {
  if (!roles.length) return true;
  if (user?.is_superuser) return true;
  const userRoles = new Set((user?.roles || []).map((role) => role.toUpperCase()));
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

export function getPrimaryRole(user: AuthUser | null | undefined) {
  const roles = user?.roles || [];
  const order = ["ADMIN", "MANAGER", "LIBRARIAN", "CUSTOMER_SERVICE", "WAREHOUSE_STAFF", "WAREHOUSE_OPERATOR", "STAFF", "SUPPLIER", "CUSTOMER"];
  return order.find((role) => roles.includes(role)) || roles[0] || "UNKNOWN";
}

export function getHomePathForUser(user: AuthUser | null | undefined) {
  const role = getPrimaryRole(user);
  if (role === "CUSTOMER") return "/customer";
  if (role === "SUPPLIER") return "/supplier";
  if (role === "ADMIN") return "/users";
  if (role === "MANAGER") return "/reports";
  if (role === "LIBRARIAN" || role === "CUSTOMER_SERVICE") return "/borrow";
  if (role === "STAFF" || role === "WAREHOUSE_STAFF" || role === "WAREHOUSE_OPERATOR") return "/my-warehouse-tasks";
  return "/";
}
