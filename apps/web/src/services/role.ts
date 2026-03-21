import { authAPI } from './http-clients';

export interface Role {
  id: string;
  code: string;
  name: string;
  description: string | null;
  permissions: Array<{ id: string; code: string; module_name: string; action_name: string }>;
  created_at: string;
}

export interface RoleCreateRequest {
  code: string;
  name: string;
  description?: string;
  permission_ids?: string[];
}

export const roleService = {
  getAll: async (params?: any) => {
    const response = await authAPI.get('/iam/roles', { params });
    return response.data;
  },

  getById: async (id: string) => {
    const response = await authAPI.get('/iam/roles', { params: { id } });
    return response.data;
  },

  create: async (data: RoleCreateRequest) => {
    const response = await authAPI.post('/iam/roles', data);
    return response.data;
  },

  update: async (id: string, data: Partial<RoleCreateRequest>) => {
    const response = await authAPI.put(`/iam/roles/${id}/permissions`, {
      permission_ids: data.permission_ids || [],
    });
    return response.data;
  },

  delete: async (id: string) => {
    await authAPI.put(`/iam/roles/${id}/permissions`, { permission_ids: [] });
  },

  getPermissions: async () => {
    const response = await authAPI.get('/iam/permissions');
    return response.data;
  },
};
