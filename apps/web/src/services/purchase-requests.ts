import { inventoryAPI } from "./http-clients";

export interface PurchaseRequest {
  id: string;
  request_number: string;
  created_by_user_id: string;
  warehouse_id: string;
  book_variant_id: string | null;
  book_title_hint: string | null;
  quantity_requested: number;
  reason: string;
  note: string | null;
  status: "PENDING" | "APPROVED" | "REJECTED" | "CONVERTED" | string;
  approved_by_user_id: string | null;
  rejected_by_user_id: string | null;
  approved_at: string | null;
  rejected_at: string | null;
  rejection_reason: string | null;
  purchase_order_id: string | null;
  created_at: string;
  updated_at: string;
  warehouses?: { id: string; code: string; name: string } | null;
  book_variants?: {
    id: string; sku: string; isbn13: string | null;
    books?: { id: string; title: string } | null;
  } | null;
}

export interface PurchaseRequestCreateInput {
  warehouse_id: string;
  book_variant_id?: string;
  book_title_hint?: string;
  quantity_requested: number;
  reason?: string;
  note?: string;
}

export const purchaseRequestService = {
  async createRequest(data: PurchaseRequestCreateInput): Promise<{ data: PurchaseRequest }> {
    const response = await inventoryAPI.post<{ data: PurchaseRequest }>("/api/purchase-requests", data);
    return response.data;
  },

  async getMyRequests(): Promise<{ data: PurchaseRequest[] }> {
    const response = await inventoryAPI.get<{ data: PurchaseRequest[] }>("/api/purchase-requests/my");
    return response.data;
  },

  async getRequestById(id: string): Promise<{ data: PurchaseRequest }> {
    const response = await inventoryAPI.get<{ data: PurchaseRequest }>(`/api/purchase-requests/${id}`);
    return response.data;
  },
};
