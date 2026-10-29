import { authAPI } from './http-clients';

/** Existing levels only (auth-service): READ / READ_ONLY read, WRITE / OPERATOR / FULL also write. */
export type WarehouseAccessLevel = 'READ' | 'READ_ONLY' | 'WRITE' | 'OPERATOR' | 'FULL';

export interface WarehouseScope {
  warehouse_id: string;
  access_level: WarehouseAccessLevel;
}

export interface User {
  id: string;
  email: string;
  username: string;
  full_name: string;
  phone?: string;
  status: 'ACTIVE' | 'INACTIVE' | 'LOCKED' | 'PENDING' | 'PENDING_VERIFICATION';
  roles: Array<{ id: string; code: string; name: string }>;
  email_verified_at?: string | null;
  email_otp_2fa_enabled?: boolean;
  primary_warehouse_id?: string | null;
  warehouse_scopes?: WarehouseScope[];
  created_at: string;
}

export interface UserWarehouseScopes {
  user: { id: string; username: string; full_name: string; status: User['status']; roles: string[]; primary_warehouse_id: string | null };
  scopes: Array<WarehouseScope & { warehouse: { code: string; name: string; is_active: boolean } | null }>;
  hidden_scope_count: number;
  can_edit: boolean;
  manageable_warehouse_ids: string[] | null;
}

export interface WarehouseStaffMember {
  id: string;
  username: string;
  full_name: string;
  email: string;
  status: User['status'];
  roles: string[];
  access_level: WarehouseAccessLevel;
  is_primary: boolean;
  assigned_at: string;
}

export interface WarehouseStaffOption {
  id: string;
  username: string;
  full_name: string;
  email: string;
  status: 'ACTIVE';
}

export interface UserCreateRequest {
  username: string;
  full_name: string;
  email: string;
  password: string;
  phone?: string;
  status?: User['status'];
  role_ids?: string[];
  warehouse_scopes?: WarehouseScope[];
  primary_warehouse_id?: string | null;
}

export interface UserUpdateRequest {
  full_name?: string;
  email?: string;
  phone?: string;
  status?: User['status'];
  role_ids?: string[];
  email_otp_2fa_enabled?: boolean;
}

export const userService = {
  getAll: async (params?: any) => {
    const response = await authAPI.get('/iam/users', { params });
    return response.data;
  },

  getById: async (id: string) => {
    const response = await authAPI.get('/iam/users', { params: { id } });
    return response.data;
  },

  create: async (data: UserCreateRequest) => {
    const response = await authAPI.post('/iam/users', data);
    return response.data;
  },

  update: async (id: string, data: UserUpdateRequest) => {
    const response = await authAPI.patch(`/iam/users/${id}`, data);
    return response.data;
  },

  delete: async (id: string) => {
    await authAPI.patch(`/iam/users/${id}`, { status: 'INACTIVE' });
  },

  changeRole: async (id: string, roleIds: string[]) => {
    const response = await authAPI.patch(`/iam/users/${id}`, { role_ids: roleIds });
    return response.data;
  },

  getWarehouseStaff: async () => {
    const response = await authAPI.get('/auth/warehouse-staff');
    return response.data as { data: WarehouseStaffOption[] };
  },

  getWarehouseScopes: async (id: string) => {
    const response = await authAPI.get(`/iam/users/${id}/warehouse-scopes`);
    return response.data as { data: UserWarehouseScopes };
  },

  /** Replaces the scope set; primary_warehouse_id is always sent (null clears it). */
  updateWarehouseScopes: async (id: string, scopes: WarehouseScope[], primaryWarehouseId: string | null) => {
    const response = await authAPI.put(`/iam/users/${id}/warehouse-scopes`, { scopes, primary_warehouse_id: primaryWarehouseId });
    return response.data as { message: string; data: { scopes: WarehouseScope[]; primary_warehouse_id: string | null } };
  },

  /** People with a scope row on the warehouse; `assignable`: active warehouse staff who can WRITE there. */
  getStaffByWarehouse: async (warehouseId: string, options?: { assignable?: boolean }) => {
    const response = await authAPI.get(`/iam/warehouses/${warehouseId}/staff`, {
      params: options?.assignable ? { assignable: 1 } : undefined,
    });
    return response.data as { data: WarehouseStaffMember[] };
  },
};
