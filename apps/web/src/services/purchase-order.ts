import { inventoryAPI } from './http-clients';

export type PurchaseOrderStatus =
  | 'DRAFT'
  | 'PENDING_APPROVAL'
  | 'APPROVED'
  | 'SENT_TO_SUPPLIER'
  | 'SUPPLIER_CONFIRMED'
  | 'REJECTED'
  | 'PARTIALLY_RECEIVED'
  | 'SHORTAGE_REPORTED'
  | 'RECEIVED'
  | 'CANCELLED';

export interface PurchaseOrderLinePayload {
  variant_id?: string;
  isbn13?: string;
  ordered_qty: number;
  unit_cost: number;
  note?: string | null;
}

export interface PurchaseOrderPayload {
  supplier_id: string;
  warehouse_id: string;
  expected_date?: string | null;
  note?: string | null;
  items: PurchaseOrderLinePayload[];
}

export interface PurchaseOrderSummary {
  id: string;
  po_number: string;
  supplier_id: string;
  supplier_name?: string | null;
  warehouse_id: string;
  warehouse_code?: string | null;
  warehouse_name?: string | null;
  status: PurchaseOrderStatus;
  ordered_by_user_id: string;
  approved_by_user_id?: string | null;
  order_date: string;
  expected_date?: string | null;
  item_count: number;
  total_ordered_qty: number;
  total_received_qty: number;
  total_amount: number;
  reconciliation_status: string;
  note?: string | null;
  created_at: string;
  updated_at: string;
}

export interface PurchaseOrderItem {
  id: string;
  variant_id: string;
  book_id?: string | null;
  title: string;
  sku?: string | null;
  isbn13?: string | null;
  ordered_qty: number;
  received_qty: number;
  remaining_qty: number;
  unit_cost: number;
  line_total: number;
  reconciliation_status: string;
  note?: string | null;
}

export interface PurchaseOrderDetail extends PurchaseOrderSummary {
  supplier?: { id: string; code?: string | null; name: string; email?: string | null } | null;
  warehouse?: { id: string; code: string; name: string } | null;
  items: PurchaseOrderItem[];
  goods_receipts: Array<{
    id: string;
    receipt_number: string;
    status: string;
    received_at?: string | null;
    item_count: number;
    total_quantity: number;
  }>;
  timeline: Array<{ label: string; completed: boolean; time?: string | null }>;
}

export interface SupplierDispatch {
  id: string;
  dispatch_number: string;
  channel: string;
  status: string;
  sent_to_email?: string | null;
  sent_at?: string | null;
  acknowledged_at?: string | null;
  portal_token?: string | null;
  portal_url?: string | null;
  created_at: string;
}

export interface SupplierInvoiceItem {
  id: string;
  purchase_order_item_id?: string | null;
  variant_id: string;
  title?: string | null;
  sku?: string | null;
  isbn13?: string | null;
  invoiced_qty: number;
  delivered_qty?: number | null;
  accepted_qty: number;
  unit_cost: number;
  note?: string | null;
}

export interface SupplierInvoice {
  id: string;
  purchase_order_id: string;
  supplier_id: string;
  invoice_number: string;
  delivery_number?: string | null;
  invoice_date?: string | null;
  expected_delivery_date?: string | null;
  status: string;
  supplier_note?: string | null;
  created_at: string;
  updated_at: string;
  items: SupplierInvoiceItem[];
}

export interface ShortageReport {
  id: string;
  purchase_order_id: string;
  supplier_id: string;
  goods_receipt_id?: string | null;
  invoice_id?: string | null;
  status: string;
  reason?: string | null;
  sent_at?: string | null;
  resolved_at?: string | null;
  created_at: string;
  updated_at: string;
  items: Array<{
    id: string;
    purchase_order_item_id: string;
    variant_id: string;
    title?: string | null;
    ordered_qty: number;
    received_qty: number;
    shortage_qty: number;
    note?: string | null;
  }>;
}

export interface SupplierDocumentsResponse {
  data: {
    dispatches: SupplierDispatch[];
    invoices: SupplierInvoice[];
    shortage_reports: ShortageReport[];
  };
}

export interface PurchaseOrderListResponse {
  data: PurchaseOrderSummary[];
  pagination: { page: number; pageSize: number; total: number };
}

export interface VariantSearchItem {
  variant_id: string;
  sku?: string | null;
  barcode?: string | null;
  isbn13?: string | null;
  title: string;
}

export interface ReconciliationResponse {
  po_id: string;
  po_number: string;
  status: PurchaseOrderStatus;
  summary: {
    total_ordered_qty: number;
    total_received_qty: number;
    total_remaining_qty: number;
    over_received_lines: number;
    under_received_lines: number;
    matched_lines: number;
    reconciliation_status: string;
  };
  items: Array<{
    variant_id: string;
    title: string;
    isbn13?: string | null;
    ordered_qty: number;
    received_qty: number;
    remaining_qty: number;
    variance_qty: number;
    status: string;
  }>;
  goods_receipts: PurchaseOrderDetail['goods_receipts'];
}

export interface CreateGoodsReceiptFromPoPayload {
  note?: string | null;
  warehouse_id?: string;
  items: Array<{
    purchase_order_item_id?: string;
    variant_id: string;
    quantity: number;
    unit_cost: number;
    location_id?: string | null;
  }>;
}

export const purchaseOrderService = {
  getAll: async (params?: Record<string, unknown>): Promise<PurchaseOrderListResponse> => {
    const response = await inventoryAPI.get('/api/purchase-orders', { params });
    return response.data as PurchaseOrderListResponse;
  },

  getById: async (id: string): Promise<PurchaseOrderDetail> => {
    const response = await inventoryAPI.get(`/api/purchase-orders/${id}`);
    return response.data as PurchaseOrderDetail;
  },

  create: async (payload: PurchaseOrderPayload) => {
    const response = await inventoryAPI.post('/api/purchase-orders', payload);
    return response.data as { message: string; data: { id: string; po_number: string; status: PurchaseOrderStatus } };
  },

  update: async (id: string, payload: PurchaseOrderPayload) => {
    const response = await inventoryAPI.patch(`/api/purchase-orders/${id}`, payload);
    return response.data as { message: string; data: { id: string; po_number: string; status: PurchaseOrderStatus } };
  },

  submit: async (id: string) => {
    const response = await inventoryAPI.post(`/api/purchase-orders/${id}/submit`);
    return response.data;
  },

  approve: async (id: string, note?: string) => {
    const response = await inventoryAPI.post(`/api/purchase-orders/${id}/approve`, { note });
    return response.data;
  },

  reject: async (id: string, reason: string) => {
    const response = await inventoryAPI.post(`/api/purchase-orders/${id}/reject`, { reason });
    return response.data;
  },

  cancel: async (id: string) => {
    const response = await inventoryAPI.post(`/api/purchase-orders/${id}/cancel`);
    return response.data;
  },

  sendToSupplier: async (id: string) => {
    const response = await inventoryAPI.post(`/api/purchase-orders/${id}/send-to-supplier`);
    return response.data as {
      message: string;
      data: {
        purchase_order_id: string;
        po_number: string;
        status: PurchaseOrderStatus;
        dispatch_id: string;
        dispatch_number: string;
        portal_token?: string | null;
        portal_url?: string | null;
        channel: string;
        sent_to_email?: string | null;
      };
    };
  },

  supplierConfirm: async (id: string, payload: {
    invoice_number?: string;
    invoice_date?: string;
    expected_delivery_date?: string;
    items?: Array<{
      purchase_order_item_id?: string;
      variant_id?: string;
      invoiced_qty: number;
      unit_cost: number;
      note?: string;
    }>;
  }) => {
    const response = await inventoryAPI.post(`/api/purchase-orders/${id}/supplier-confirm`, payload);
    return response.data as { message: string; data: { purchase_order_id: string; status: PurchaseOrderStatus; invoice_id?: string | null } };
  },

  getSupplierDocuments: async (id: string): Promise<SupplierDocumentsResponse> => {
    const response = await inventoryAPI.get(`/api/purchase-orders/${id}/supplier-documents`);
    return response.data as SupplierDocumentsResponse;
  },

  getShortageReports: async (id: string): Promise<{ data: ShortageReport[] }> => {
    const response = await inventoryAPI.get(`/api/purchase-orders/${id}/shortage-reports`);
    return response.data as { data: ShortageReport[] };
  },

  sendShortageReport: async (poId: string, reportId: string) => {
    const response = await inventoryAPI.post(`/api/purchase-orders/${poId}/shortage-reports/${reportId}/send`);
    return response.data;
  },

  resolveShortageReport: async (poId: string, reportId: string) => {
    const response = await inventoryAPI.post(`/api/purchase-orders/${poId}/shortage-reports/${reportId}/resolve`);
    return response.data;
  },

  getReconciliation: async (id: string): Promise<ReconciliationResponse> => {
    const response = await inventoryAPI.get(`/api/purchase-orders/${id}/reconciliation`);
    return response.data as ReconciliationResponse;
  },

  createGoodsReceiptFromPo: async (id: string, payload: CreateGoodsReceiptFromPoPayload) => {
    const response = await inventoryAPI.post(`/api/purchase-orders/${id}/goods-receipts`, payload);
    return response.data as { message: string; data: { id: string; receipt_number: string; status: string } };
  },

  searchVariants: async (q: string): Promise<VariantSearchItem[]> => {
    if (q.trim().length < 2) return [];
    const response = await inventoryAPI.get('/api/order-requests/variants/search', {
      params: { q, limit: 10 },
    });
    return (response.data?.data || []) as VariantSearchItem[];
  },
};
