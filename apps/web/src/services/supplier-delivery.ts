import { inventoryAPI } from './http-clients';
import type { SupplierInvoice } from './purchase-order';

export interface SupplierDeliveryDetail extends SupplierInvoice {
  supplier_name?: string | null;
  po_number?: string | null;
  warehouse_id?: string | null;
  warehouse_code?: string | null;
  warehouse_name?: string | null;
  procurement_flow?: 'LEGACY' | 'INVOICE_FIRST';
  invoice_document_id?: string | null;
  tracking_number?: string | null;
  items: Array<SupplierInvoice['items'][number] & {
    ordered_qty: number;
    previously_received_qty: number;
    remaining_qty: number;
    /** ordered snapshot, for linking a typed book to the catalog at receiving */
    item_code?: string | null;
    item_author?: string | null;
    item_publish_year?: number | null;
    linked_to_catalog?: boolean;
  }>;
}

export const SUPPLIER_DELIVERY_STATUS_LABELS: Record<string, string> = {
  SUBMITTED: 'Chờ nhận hàng',
  PARTIALLY_RECEIVED: 'Nhận một phần',
  SHORTAGE_REPORTED: 'Đã báo thiếu',
  RECEIVED: 'Đã nhận đủ',
  CANCELLED: 'Đã hủy',
};

export const RECEIVABLE_DELIVERY_STATUSES = ['SUBMITTED', 'PARTIALLY_RECEIVED', 'SHORTAGE_REPORTED'];

export function supplierDeliveryStatusLabel(status: string): string {
  return SUPPLIER_DELIVERY_STATUS_LABELS[status] || status;
}

export interface CreateGoodsReceiptFromInvoicePayload {
  warehouse_id: string;
  note?: string | null;
  /** leave the receipt without a counter: staff claim it, or a manager assigns it later */
  unassigned?: boolean;
  items: Array<{
    invoice_item_id: string;
    purchase_order_item_id?: string | null;
    variant_id: string | null;
    delivered_qty: number;
    damaged_qty?: number;
    rejected_qty?: number;
    unit_cost: number;
    location_id?: string | null;
    note?: string | null;
  }>;
}

export const supplierDeliveryService = {
  /** Create the catalog book from a typed PO line (code read from the physical book) and link it. */
  createCatalogBook: async (deliveryId: string, payload: { purchase_order_item_id: string; code: string; price: number }) => {
    const response = await inventoryAPI.post(`/api/supplier-deliveries/${deliveryId}/create-catalog-book`, payload);
    return response.data as { message: string; data: { variant_id: string; internal_barcode: string; isbn13: string | null } };
  },

  /** Link a PO line ordered as a typed book (not in the catalog then) to a catalog variant. */
  linkItem: async (deliveryId: string, purchaseOrderItemId: string, variantId: string) => {
    const response = await inventoryAPI.post(`/api/supplier-deliveries/${deliveryId}/link-item`, { purchase_order_item_id: purchaseOrderItemId, variant_id: variantId });
    return response.data as { message: string };
  },

  getAll: async (params?: Record<string, unknown>): Promise<{ data: SupplierDeliveryDetail[] }> => {
    const response = await inventoryAPI.get('/api/supplier-deliveries', { params });
    return response.data as { data: SupplierDeliveryDetail[] };
  },

  getById: async (id: string): Promise<{ data: SupplierDeliveryDetail }> => {
    const response = await inventoryAPI.get(`/api/supplier-deliveries/${id}`);
    return response.data as { data: SupplierDeliveryDetail };
  },

  createGoodsReceiptFromInvoice: async (invoiceId: string, payload: CreateGoodsReceiptFromInvoicePayload, idempotencyKey?: string) => {
    // Same key on a retry => the server returns the receipt it already created (no duplicate GRN).
    const response = await inventoryAPI.post(`/api/supplier-deliveries/${invoiceId}/create-goods-receipt`, payload, {
      headers: idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : undefined,
    });
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
