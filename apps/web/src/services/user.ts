import { authAPI } from './api.ts';

export interface User {
  id: string;
  email: string;
  username: string;
  full_name: string;
  phone?: string;
  status: 'ACTIVE' | 'INACTIVE' | 'LOCKED' | 'PENDING';
  roles: Array<{ id: string; code: string; name: string }>;
  created_at: string;
}

export interface UserCreateRequest {
  username: string;
  full_name: string;
  email: string;
  password: string;
  phone?: string;
  status?: 'ACTIVE' | 'INACTIVE' | 'LOCKED' | 'PENDING';
  role_ids?: string[];
}

export interface UserUpdateRequest {
  full_name?: string;
  email?: string;
  phone?: string;
  status?: 'ACTIVE' | 'INACTIVE' | 'LOCKED' | 'PENDING';
  role_ids?: string[];
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
};
