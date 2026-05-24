import { inventoryAPI } from './http-clients';

export interface SupplierPortalOrder {
  dispatch: {
    id: string;
    dispatch_number: string;
    status: string;
    sent_at?: string | null;
    acknowledged_at?: string | null;
  };
  purchase_order: {
    id: string;
    po_number: string;
    status: string;
    expected_date?: string | null;
    warehouse?: { id: string; code?: string | null; name: string } | null;
    supplier?: { id: string; code?: string | null; name: string } | null;
    items: Array<{
      id: string;
      variant_id: string;
      title?: string | null;
      sku?: string | null;
      isbn13?: string | null;
      ordered_qty: number;
      received_qty: number;
      remaining_qty: number;
      unit_cost: number;
    }>;
  };
  invoices: Array<{
    id: string;
    invoice_number: string;
    status: string;
    invoice_date?: string | null;
    expected_delivery_date?: string | null;
  }>;
}

export interface SupplierPortalInvoicePayload {
  invoice_number: string;
  invoice_date?: string;
  expected_delivery_date?: string;
  supplier_note?: string;
  items: Array<{
    purchase_order_item_id: string;
    invoiced_qty: number;
    unit_cost: number;
    note?: string;
  }>;
}

export const supplierPortalService = {
  getPortalOrder: async (token: string): Promise<{ data: SupplierPortalOrder }> => {
    const response = await inventoryAPI.get(`/api/supplier-portal/orders/${token}`);
    return response.data as { data: SupplierPortalOrder };
  },

  confirmPortalOrder: async (token: string) => {
    const response = await inventoryAPI.post(`/api/supplier-portal/orders/${token}/confirm`);
    return response.data;
  },

  createPortalInvoice: async (token: string, payload: SupplierPortalInvoicePayload) => {
    const response = await inventoryAPI.post(`/api/supplier-portal/orders/${token}/invoices`, payload);
    return response.data;
  },
};
