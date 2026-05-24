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
    delivery_number?: string | null;
    status: string;
    invoice_date?: string | null;
    expected_delivery_date?: string | null;
    supplier_note?: string | null;
    raw_payload?: Record<string, unknown>;
    goods_receipts?: Array<{
      id: string;
      receipt_number: string;
      status: string;
    }>;
    items: Array<{
      id: string;
      purchase_order_item_id?: string | null;
      variant_id: string;
      title?: string | null;
      sku?: string | null;
      isbn13?: string | null;
      ordered_qty: number;
      received_qty: number;
      invoiced_qty: number;
      delivered_qty?: number | null;
      accepted_qty: number;
      unit_cost: number;
      note?: string | null;
    }>;
  }>;
  shortage_reports: SupplierPortalShortageReport[];
}

export interface SupplierPortalShortageReportItem {
  id: string;
  purchase_order_item_id: string;
  variant_id: string;
  title?: string | null;
  sku?: string | null;
  isbn13?: string | null;
  ordered_qty: number;
  received_qty: number;
  shortage_qty: number;
  note?: string | null;
}

export interface SupplierPortalShortageReport {
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
  items: SupplierPortalShortageReportItem[];
}

export interface SupplierPortalInvoicePayload {
  invoice_number: string;
  delivery_number?: string;
  invoice_date?: string;
  expected_delivery_date?: string;
  supplier_note?: string;
  source_shortage_report_id?: string;
  redelivery?: boolean;
  items: Array<{
    purchase_order_item_id: string;
    invoiced_qty: number;
    unit_cost: number;
    note?: string;
  }>;
}

export type SupplierPortalRedeliveryPayload = SupplierPortalInvoicePayload;

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

  acknowledgeShortage: async (token: string, reportId: string) => {
    const response = await inventoryAPI.post(`/api/supplier-portal/orders/${token}/shortage-reports/${reportId}/acknowledge`);
    return response.data;
  },

  cannotFulfillShortage: async (token: string, reportId: string, reason: string) => {
    const response = await inventoryAPI.post(`/api/supplier-portal/orders/${token}/shortage-reports/${reportId}/cannot-fulfill`, { reason });
    return response.data;
  },

  createRedeliveryInvoice: async (token: string, reportId: string, payload: SupplierPortalRedeliveryPayload) => {
    const response = await inventoryAPI.post(`/api/supplier-portal/orders/${token}/shortage-reports/${reportId}/redelivery-invoice`, payload);
    return response.data;
  },
};
