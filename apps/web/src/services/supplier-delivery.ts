import { inventoryAPI } from './http-clients';
import type { SupplierInvoice } from './purchase-order';

export interface SupplierDeliveryDetail extends SupplierInvoice {
  supplier_name?: string | null;
  po_number?: string | null;
  warehouse_id?: string | null;
  warehouse_code?: string | null;
  warehouse_name?: string | null;
  items: Array<SupplierInvoice['items'][number] & {
    ordered_qty: number;
    previously_received_qty: number;
    remaining_qty: number;
  }>;
}

export interface CreateGoodsReceiptFromInvoicePayload {
  warehouse_id: string;
  note?: string | null;
  items: Array<{
    invoice_item_id: string;
    purchase_order_item_id?: string | null;
    variant_id: string;
    delivered_qty: number;
    unit_cost: number;
    location_id?: string | null;
    note?: string | null;
  }>;
}

export const supplierDeliveryService = {
  getAll: async (params?: Record<string, unknown>): Promise<{ data: SupplierDeliveryDetail[] }> => {
    const response = await inventoryAPI.get('/api/supplier-deliveries', { params });
    return response.data as { data: SupplierDeliveryDetail[] };
  },

  getById: async (id: string): Promise<{ data: SupplierDeliveryDetail }> => {
    const response = await inventoryAPI.get(`/api/supplier-deliveries/${id}`);
    return response.data as { data: SupplierDeliveryDetail };
  },

  createGoodsReceiptFromInvoice: async (invoiceId: string, payload: CreateGoodsReceiptFromInvoicePayload) => {
    const response = await inventoryAPI.post(`/api/supplier-deliveries/${invoiceId}/create-goods-receipt`, payload);
    return response.data as {
      message: string;
      data: {
        id: string;
        receipt_number: string;
        status: string;
        purchase_order_id: string;
        supplier_delivery_invoice_id: string;
        shortage_report_id?: string | null;
      };
    };
  },
};
