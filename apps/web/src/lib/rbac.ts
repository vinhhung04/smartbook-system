import { authService, type AuthUser } from "@/services/auth";

export type ActorRole =
  | "ADMIN"
  | "MANAGER"
  | "LIBRARIAN"
  | "STAFF"
  | "CUSTOMER"
  | "SUPPLIER"
  | "WAREHOUSE_OPERATOR"
  | "CUSTOMER_SERVICE";

export interface RouteAccessRule {
  allowedRoles?: ActorRole[];
  requiredPermissions?: string[];
  requiredAllPermissions?: string[];
}

const ROLE_DEFAULT_ROUTES: Array<{ roles: ActorRole[]; route: string }> = [
  { roles: ["ADMIN"], route: "/admin" },
  { roles: ["MANAGER"], route: "/manager" },
  { roles: ["LIBRARIAN", "CUSTOMER_SERVICE"], route: "/librarian" },
  { roles: ["STAFF", "WAREHOUSE_OPERATOR"], route: "/staff" },
  { roles: ["CUSTOMER"], route: "/customer" },
  { roles: ["SUPPLIER"], route: "/supplier" },
];

export function getCurrentUser(): AuthUser | null {
  return authService.getCurrentUser();
}

export function hasRole(role: ActorRole, user = getCurrentUser()): boolean {
  return Array.isArray(user?.roles) && user.roles.includes(role);
}

export function hasAnyRole(roles: ActorRole[] = [], user = getCurrentUser()): boolean {
  if (!roles.length) return true;
  if (user?.is_superuser) return true;
  return roles.some((role) => hasRole(role, user));
}

export function hasPermission(permission: string, user = getCurrentUser()): boolean {
  if (user?.is_superuser) return true;
  return Array.isArray(user?.permissions) && user.permissions.includes(permission);
}

export function hasAnyPermission(permissions: string[] = [], user = getCurrentUser()): boolean {
  if (!permissions.length) return true;
  return permissions.some((permission) => hasPermission(permission, user));
}

export function hasAllPermissions(permissions: string[] = [], user = getCurrentUser()): boolean {
  if (!permissions.length) return true;
  return permissions.every((permission) => hasPermission(permission, user));
}

export function canAccessRoute(rule: RouteAccessRule = {}, user = getCurrentUser()): boolean {
  if (!user) return false;
  if (user.is_superuser) return true;

  if (rule.allowedRoles?.length && !hasAnyRole(rule.allowedRoles, user)) {
    return false;
  }

  if (rule.requiredPermissions?.length && !hasAnyPermission(rule.requiredPermissions, user)) {
    return false;
  }

  if (rule.requiredAllPermissions?.length && !hasAllPermissions(rule.requiredAllPermissions, user)) {
    return false;
  }

  return true;
}

export function getDefaultRouteForUser(user: AuthUser | null = getCurrentUser()): string {
  if (!user) return "/login";
  if (user.is_superuser) return "/admin";

  for (const entry of ROLE_DEFAULT_ROUTES) {
    if (entry.roles.some((role) => hasRole(role, user))) {
      return entry.route;
    }
  }

  return "/403";
}

export function getPrimaryRoleLabel(user: AuthUser | null = getCurrentUser()): string {
  if (!user) return "Guest";
  if (user.is_superuser) return "Superuser";

  const match = ROLE_DEFAULT_ROUTES.find((entry) => entry.roles.some((role) => hasRole(role, user)));
  return match?.roles.find((role) => hasRole(role, user))?.replace("_", " ") || user.roles?.[0] || "User";
}
