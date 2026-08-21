export interface ApiResponse<T> {
  data: T;
  message?: string;
}

export interface UserIdentity {
  id: string;
  username: string;
  email: string;
  full_name?: string;
}
export type Role =
  | "ADMIN"
  | "WAREHOUSE_MANAGER"
  | "WAREHOUSE_STAFF"
  | "LIBRARIAN"
  | "CUSTOMER"
  | "SUPPLIER";

export type Permission = string;

export interface JwtClaims {
  id?: string;
  sub?: string;
  email?: string;
  roles: Role[];
  permissions: Permission[];
  is_superuser?: boolean;
  jti?: string;
  exp?: number;
}

export interface Pagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface ApiError {
  message: string;
  code?: string;
  request_id?: string | null;
}

export type IdempotencyKey = string;
