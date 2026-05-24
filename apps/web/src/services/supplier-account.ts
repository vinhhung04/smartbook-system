import { inventoryAPI } from './http-clients';
import type { SupplierPortalInvoicePayload, SupplierPortalOrder, SupplierPortalRedeliveryPayload } from './supplier-portal';

export interface SupplierAccountResponse {
  data: {
    supplier: {
      id: string;
      code?: string | null;
      name: string;
      email?: string | null;
    };
    orders: SupplierPortalOrder[];
  };
}

export const supplierAccountService = {
  getOrders: async (): Promise<SupplierAccountResponse> => {
    const response = await inventoryAPI.get('/api/supplier-account/orders');
    return response.data as SupplierAccountResponse;
  },

  confirmOrder: async (poId: string) => {
    const response = await inventoryAPI.post(`/api/supplier-account/orders/${poId}/confirm`);
    return response.data;
  },

  createInvoice: async (poId: string, payload: SupplierPortalInvoicePayload) => {
    const response = await inventoryAPI.post(`/api/supplier-account/orders/${poId}/invoices`, payload);
    return response.data;
  },

  acknowledgeShortage: async (poId: string, reportId: string) => {
    const response = await inventoryAPI.post(`/api/supplier-account/orders/${poId}/shortage-reports/${reportId}/acknowledge`);
    return response.data;
  },

  cannotFulfillShortage: async (poId: string, reportId: string, reason: string) => {
    const response = await inventoryAPI.post(`/api/supplier-account/orders/${poId}/shortage-reports/${reportId}/cannot-fulfill`, { reason });
    return response.data;
  },

  createRedeliveryInvoice: async (poId: string, reportId: string, payload: SupplierPortalRedeliveryPayload) => {
    const response = await inventoryAPI.post(`/api/supplier-account/orders/${poId}/shortage-reports/${reportId}/redelivery-invoice`, payload);
    return response.data;
  },
};
