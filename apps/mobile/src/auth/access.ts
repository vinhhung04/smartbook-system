import type { User } from '../types/auth';

/**
 * Client-side mirror of the inventory-service guards (middlewares/auth.middleware.js):
 * authorizeTaskRead/Progress = a warehouse role AND the permission, superusers bypass
 * both; authorizeManagerDecision = WAREHOUSE_MANAGER/ADMIN AND the permission. The
 * server still enforces every call — this only decides what the app offers, so a
 * staff member is never sent into a screen whose first request would be a 403.
 */
export type StaffFeature = 'picking' | 'putaway' | 'outbound' | 'audit' | 'exceptions' | 'lookup' | 'tasks' | 'transferReceiving';

const WAREHOUSE_ROLES = ['WAREHOUSE_STAFF', 'WAREHOUSE_MANAGER', 'ADMIN'];
const MANAGER_ROLES = ['WAREHOUSE_MANAGER', 'ADMIN'];

const FEATURE_PERMISSIONS: Record<StaffFeature, string[]> = {
  tasks: ['inventory.task.read'],
  picking: ['inventory.task.progress'],
  putaway: ['inventory.task.progress'],
  outbound: ['inventory.task.progress'],
  transferReceiving: ['inventory.task.progress'],
  audit: ['inventory.stock.audit', 'inventory.audit.read'],
  exceptions: ['inventory.exception.report'],
  lookup: ['inventory.catalog.read', 'inventory.catalog.write'],
};

export type AppArea = 'customer' | 'staff' | 'unsupported';

function hasAnyRole(user: User, roles: string[]): boolean {
  return user.roles.some((role) => roles.includes(String(role).toUpperCase()));
}

function hasAnyPermission(user: User, permissions: string[]): boolean {
  return permissions.some((permission) => user.permissions.includes(permission));
}

export function isWarehouseManager(user: User | null): boolean {
  if (!user) return false;
  return Boolean(user.is_superuser) || hasAnyRole(user, MANAGER_ROLES);
}

export function canUseStaffFeature(user: User | null, feature: StaffFeature): boolean {
  if (!user) return false;
  if (user.is_superuser) return true;
  return hasAnyRole(user, WAREHOUSE_ROLES) && hasAnyPermission(user, FEATURE_PERMISSIONS[feature]);
}

/**
 * Which half of the app a signed-in account belongs to. A reader (CUSTOMER) gets the
 * customer area; an account with a warehouse role (or superuser) gets the staff area;
 * anything else (e.g. SUPPLIER, ACCOUNTANT) has no mobile workflow and is told so
 * instead of landing on a dashboard where every request is refused.
 */
export function resolveAppArea(user: User): AppArea {
  if (hasAnyRole(user, ['CUSTOMER'])) return 'customer';
  if (user.is_superuser || hasAnyRole(user, WAREHOUSE_ROLES)) return 'staff';
  return 'unsupported';
}
