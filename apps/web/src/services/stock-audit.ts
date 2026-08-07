import { inventoryAPI } from './http-clients';

export type StockAuditStatus = 'DRAFT' | 'IN_PROGRESS' | 'SUBMITTED' | 'COMPLETED' | 'CANCELLED';

export interface StockAuditLine {
  id: string;
  variant_id: string;
  location_id: string;
  location_code: string | null;
  sku: string | null;
  isbn13: string | null;
  title: string | null;
  expected_qty: number;
  counted_qty: number | null;
  variance_qty: number | null;
  adjustment_posted: boolean;
  note: string | null;
}

export interface StockAudit {
  id: string;
  audit_number: string;
  status: StockAuditStatus;
  warehouse_id: string;
  warehouse_code: string | null;
  warehouse_name: string | null;
  created_by_user_id: string;
  assigned_to_user_id: string | null;
  assigned_at: string | null;
  reviewed_by_user_id: string | null;
  started_at: string | null;
  completed_at: string | null;
  note: string | null;
  created_at: string;
  updated_at: string;
  line_count?: number;
  variance_count?: number;
}

export interface StockAuditDetail extends StockAudit {
  items: StockAuditLine[];
}

export interface CreateStockAuditPayload {
  warehouse_id: string;
  location_ids?: string[];
  note?: string | null;
}

export const stockAuditService = {
  getAll: async (params?: { status?: string; warehouse_id?: string }): Promise<{ data: StockAudit[] }> => {
    const response = await inventoryAPI.get('/api/stock-audits', { params });
    return response.data as { data: StockAudit[] };
  },

  getById: async (id: string): Promise<{ data: StockAuditDetail }> => {
    const response = await inventoryAPI.get(`/api/stock-audits/${id}`);
    return response.data as { data: StockAuditDetail };
  },

  create: async (payload: CreateStockAuditPayload) => {
    const response = await inventoryAPI.post('/api/stock-audits', payload);
    return response.data as { data: { id: string; audit_number: string } };
  },

  assign: async (id: string, assignedToUserId: string) => {
    const response = await inventoryAPI.patch(`/api/stock-audits/${id}/assign`, {
      assigned_to_user_id: assignedToUserId,
    });
    return response.data as { data: { id: string; status: StockAuditStatus; assigned_to_user_id: string } };
  },

  submitLineCount: async (id: string, lineId: string, countedQty: number) => {
    const response = await inventoryAPI.patch(`/api/stock-audits/${id}/lines/${lineId}`, {
      counted_qty: countedQty,
    });
    return response.data as { data: StockAuditLine };
  },

  submit: async (id: string) => {
    const response = await inventoryAPI.patch(`/api/stock-audits/${id}/submit`, {});
    return response.data as { data: { id: string; status: StockAuditStatus } };
  },

  approve: async (id: string) => {
    const response = await inventoryAPI.patch(`/api/stock-audits/${id}/approve`, {});
    return response.data as { data: { id: string; status: StockAuditStatus; adjustments_posted: number } };
  },

  cancel: async (id: string) => {
    const response = await inventoryAPI.patch(`/api/stock-audits/${id}/cancel`, {});
    return response.data as { data: { id: string; status: StockAuditStatus } };
  },
};
