import { inventoryAPI } from './http-clients';

export type StaffTaskType =
  | 'GENERAL'
  | 'CHECK_SHELF'
  | 'STOCK_CHECK'
  | 'LOW_STOCK_REVIEW'
  | 'EXCEPTION_FOLLOW_UP'
  | 'REORDER_REVIEW'
  | 'RESERVATION_FOLLOW_UP'
  | 'INVENTORY_AUDIT'
  | 'OTHER';

export type StaffTaskPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
export type StaffTaskStatus = 'OPEN' | 'IN_PROGRESS' | 'DONE' | 'CANCELLED';

export interface StaffTask {
  id: string;
  title: string;
  description: string | null;
  task_type: StaffTaskType | string;
  priority: StaffTaskPriority | string;
  status: StaffTaskStatus | string;
  assignee_user_id: string;
  assigned_by_user_id: string;
  warehouse_id: string | null;
  related_entity_type: string | null;
  related_entity_id: string | null;
  due_date: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  warehouses?: { id: string; code: string; name: string } | null;
}

export interface StaffTaskCreateInput {
  title: string;
  description?: string | null;
  task_type?: StaffTaskType;
  priority?: StaffTaskPriority;
  assignee_user_id: string;
  warehouse_id?: string | null;
  related_entity_type?: string | null;
  related_entity_id?: string | null;
  due_date?: string | null;
}

export interface StaffTaskUpdateInput {
  title?: string;
  description?: string | null;
  task_type?: StaffTaskType;
  priority?: StaffTaskPriority;
  status?: StaffTaskStatus;
  assignee_user_id?: string;
  warehouse_id?: string | null;
  due_date?: string | null;
}

export const staffTaskService = {
  async getAll(params?: {
    status?: string;
    assignee_user_id?: string;
    warehouse_id?: string;
    page?: number;
    limit?: number;
  }): Promise<{ data: StaffTask[]; total: number }> {
    const response = await inventoryAPI.get<{ data: StaffTask[]; total: number }>('/api/staff-tasks', { params });
    return response.data;
  },

  async getMy(params?: { status?: string }): Promise<{ data: StaffTask[] }> {
    const response = await inventoryAPI.get<{ data: StaffTask[] }>('/api/staff-tasks/my', { params });
    return response.data;
  },

  async create(payload: StaffTaskCreateInput): Promise<{ message: string; data: StaffTask }> {
    const response = await inventoryAPI.post<{ message: string; data: StaffTask }>('/api/staff-tasks', payload);
    return response.data;
  },

  async update(id: string, payload: StaffTaskUpdateInput): Promise<{ data: StaffTask }> {
    const response = await inventoryAPI.patch<{ data: StaffTask }>(`/api/staff-tasks/${id}`, payload);
    return response.data;
  },

  async updateStatus(id: string, status: StaffTaskStatus): Promise<{ data: StaffTask }> {
    const response = await inventoryAPI.patch<{ data: StaffTask }>(`/api/staff-tasks/${id}/status`, { status });
    return response.data;
  },
};
