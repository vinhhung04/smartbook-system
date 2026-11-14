import { inventoryAPI } from './http-clients';

// Shared procurement document registry. The supplier portal and the SmartBook screens read the
// SAME records; only the URL prefix (and therefore the permission checks) differ.

export type ProcurementDocumentType =
  | 'VAT_INVOICE'
  | 'SALES_INVOICE'
  | 'PROFORMA_INVOICE'
  | 'DELIVERY_NOTE'
  | 'GOODS_RECEIPT_CONFIRMATION'
  | 'DELIVERY_ACCEPTANCE_MINUTES'
  | 'DISCREPANCY_REPORT'
  | 'PAYMENT_EVIDENCE'
  | 'OTHER';

export type ProcurementDocumentStatus =
  | 'DRAFT'
  | 'ISSUED'
  | 'PENDING_SIGNED_DOCUMENT'
  | 'SCAN_UPLOADED'
  | 'SUPERSEDED'
  | 'CANCELLED';

export type ShareStatus = 'NOT_SHARED' | 'SENT' | 'DELIVERED' | 'ACKNOWLEDGED' | 'FAILED';

export interface ProcurementDocumentFile {
  id: string;
  version_no: number;
  original_name: string;
  mime_type: string;
  size_bytes: number;
  sha256: string;
  uploaded_by_party: 'SUPPLIER' | 'SMARTBOOK';
  created_at: string;
}

export interface ProcurementDocumentShare {
  id: string;
  channel: 'PORTAL' | 'EMAIL';
  recipient_party: 'SUPPLIER' | 'SMARTBOOK';
  recipient_email?: string | null;
  status: Exclude<ShareStatus, 'NOT_SHARED'>;
  message_id?: string | null;
  error_message?: string | null;
  shared_at: string;
  delivered_at?: string | null;
  acknowledged_at?: string | null;
}

export interface ProcurementDocument {
  id: string;
  document_number: string;
  document_type: ProcurementDocumentType;
  document_type_label: string;
  issuer_party: 'SUPPLIER' | 'SMARTBOOK';
  external_number?: string | null;
  invoice_series?: string | null;
  status: ProcurementDocumentStatus;
  purchase_order_id: string;
  po_number?: string | null;
  supplier_name?: string | null;
  supplier_delivery_invoice_id?: string | null;
  goods_receipt_id?: string | null;
  goods_receipt_number?: string | null;
  shortage_report_id?: string | null;
  supersedes_document_id?: string | null;
  superseded_by: { id: string; document_number: string; status: string }[];
  issue_date?: string | null;
  subtotal_amount?: number | null;
  tax_rate?: number | null;
  tax_amount?: number | null;
  total_amount?: number | null;
  metadata: Record<string, unknown>;
  internal_note?: string | null;
  cancel_reason?: string | null;
  issued_at?: string | null;
  cancelled_at?: string | null;
  created_at: string;
  updated_at: string;
  lines: { id: string; purchase_order_item_id?: string | null; title?: string | null; isbn13?: string | null; quantity: number; unit_price: number; line_amount: number }[];
  files: ProcurementDocumentFile[];
  shares: ProcurementDocumentShare[];
  sharing: { recipient_party: 'SUPPLIER' | 'SMARTBOOK'; status: ShareStatus; shared_at?: string | null; delivered_at?: string | null; acknowledged_at?: string | null; channels?: string[] };
}

export interface ReconciliationLine {
  purchase_order_item_id: string;
  title?: string | null;
  isbn13?: string | null;
  ordered_qty: number;
  po_unit_cost: number;
  invoiced_qty: number;
  invoice_unit_prices: number[];
  delivery_note_qty: number;
  delivered_qty: number;
  accepted_qty: number;
  damaged_qty: number;
  rejected_qty: number;
  remaining_to_receive_qty: number;
  flags: string[];
  status: ReconciliationStatus;
}

export type ReconciliationStatus = 'MATCHED' | 'PARTIALLY_MATCHED' | 'DISCREPANCY' | 'PENDING_DOCUMENT' | 'NEEDS_REVIEW';

export interface DocumentReconciliation {
  purchase_order_id: string;
  po_number: string;
  status: ReconciliationStatus;
  can_complete_without_exception: boolean;
  totals: Record<string, number>;
  lines: ReconciliationLine[];
  invoices: { document_id: string; document_number: string; external_number?: string | null; issues: string[] }[];
  deliveries: {
    delivery_id: string;
    document_number: string;
    delivery_note_qty: number;
    delivered_qty: number;
    accepted_qty: number;
    damaged_qty: number;
    rejected_qty: number;
    status: 'RECEIVED' | 'NOT_RECEIVED';
    goods_receipts: { id: string; receipt_number: string; status: string }[];
  }[];
  history: { id: string; result_status: ReconciliationStatus; exception_approved: boolean; note?: string | null; created_at: string }[];
}

export interface ActivityEntry {
  id: string;
  action_name: string;
  entity_type: string;
  entity_id: string;
  entity_label?: string | null;
  actor_party?: 'SUPPLIER' | 'SMARTBOOK' | null;
  created_at: string;
  details?: Record<string, unknown> | null;
}

export interface GoodsReceiptDocumentsResponse {
  goods_receipt_id: string;
  receipt_number: string;
  status: string;
  purchase_order_id: string;
  po_number: string;
  can_upload_minutes: boolean;
  lines: { id: string; title?: string | null; isbn13?: string | null; delivery_note_qty: number | null; quantity: number; actual_quantity: number | null; delivered_qty: number | null; damaged_qty: number; rejected_qty: number }[];
  documents: ProcurementDocument[];
}

export interface CreateDocumentInput {
  document_type: ProcurementDocumentType;
  external_number?: string;
  invoice_series?: string;
  issue_date?: string;
  tax_rate?: string | number;
  subtotal_amount?: string | number;
  tax_amount?: string | number;
  total_amount?: string | number;
  supplier_delivery_invoice_id?: string;
  goods_receipt_id?: string;
  shortage_report_id?: string;
  supersedes_document_id?: string;
  internal_note?: string;
  issue?: boolean;
  lines?: { purchase_order_item_id: string; quantity: number; unit_price: number }[];
  metadata?: Record<string, unknown>;
  file?: File | null;
}

function toFormData(input: CreateDocumentInput) {
  const form = new FormData();
  Object.entries(input).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '' || key === 'file') return;
    if (key === 'lines' || key === 'metadata') form.append(key, JSON.stringify(value));
    else form.append(key, String(value));
  });
  if (input.file) form.append('file', input.file);
  return form;
}

const multipart = { headers: { 'Content-Type': 'multipart/form-data' } };

async function saveBlob(url: string, fallbackName: string) {
  const response = await inventoryAPI.get(url, { responseType: 'blob' });
  const disposition = String(response.headers['content-disposition'] || '');
  const match = /filename\*=UTF-8''([^;]+)/i.exec(disposition);
  const name = match ? decodeURIComponent(match[1]) : fallbackName;
  const href = URL.createObjectURL(response.data as Blob);
  const link = document.createElement('a');
  link.href = href;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}

function makeClient(prefix: string, poPath: (poId: string) => string) {
  return {
    list: async (poId: string) => {
      const response = await inventoryAPI.get(poPath(poId));
      return (response.data?.data?.documents ?? []) as ProcurementDocument[];
    },
    get: async (docId: string) => {
      const response = await inventoryAPI.get(`${prefix}/${docId}`);
      return response.data.data as ProcurementDocument;
    },
    create: async (poId: string, input: CreateDocumentInput) => {
      const response = await inventoryAPI.post(poPath(poId), toFormData(input), multipart);
      return response.data.data as ProcurementDocument;
    },
    uploadVersion: async (docId: string, file: File) => {
      const form = new FormData();
      form.append('file', file);
      const response = await inventoryAPI.post(`${prefix}/${docId}/files`, form, multipart);
      return response.data.data as ProcurementDocument;
    },
    issue: async (docId: string) => (await inventoryAPI.post(`${prefix}/${docId}/issue`)).data.data as ProcurementDocument,
    cancel: async (docId: string, reason: string) => (await inventoryAPI.post(`${prefix}/${docId}/cancel`, { reason })).data.data as ProcurementDocument,
    acknowledge: async (docId: string) => (await inventoryAPI.post(`${prefix}/${docId}/acknowledge`)).data.data as ProcurementDocument,
    download: (doc: ProcurementDocument, file: ProcurementDocumentFile) => saveBlob(`${prefix}/${doc.id}/files/${file.id}/download`, file.original_name),
  };
}

/** SmartBook side (warehouse manager / staff). */
export const procurementDocumentService = {
  ...makeClient('/api/procurement-documents', (poId) => `/api/procurement-documents/purchase-orders/${poId}`),
  share: async (docId: string, channel: 'PORTAL' | 'EMAIL') =>
    (await inventoryAPI.post(`/api/procurement-documents/${docId}/share`, { channel })).data.data as ProcurementDocument,
  issueReceiptConfirmation: async (grId: string, note?: string) =>
    (await inventoryAPI.post(`/api/procurement-documents/goods-receipts/${grId}/confirmation`, { note })).data.data as ProcurementDocument,
  forGoodsReceipt: async (grId: string) =>
    (await inventoryAPI.get(`/api/procurement-documents/goods-receipts/${grId}`)).data.data as GoodsReceiptDocumentsResponse,
  activity: async (poId: string) =>
    ((await inventoryAPI.get(`/api/procurement-documents/purchase-orders/${poId}/activity`)).data.data ?? []) as ActivityEntry[],
  reconciliation: async (poId: string) =>
    (await inventoryAPI.get(`/api/purchase-orders/${poId}/document-reconciliation`)).data.data as DocumentReconciliation,
  completeReconciliation: async (poId: string, payload: { exception_approved?: boolean; note?: string }) =>
    (await inventoryAPI.post(`/api/purchase-orders/${poId}/document-reconciliation/complete`, payload)).data,
  reviewSupplierResponse: async (poId: string, responseId: string, payload: { decision: 'APPROVE' | 'REJECT'; note?: string }) =>
    (await inventoryAPI.post(`/api/purchase-orders/${poId}/supplier-responses/${responseId}/review`, payload)).data,
  verifyReceiptCounts: async (grId: string, items: { id: string; actual_quantity?: number; damaged_qty: number; rejected_qty: number }[]) =>
    (await inventoryAPI.patch(`/api/goods-receipts/${grId}`, { items })).data,
};

/** Supplier portal side (authenticated supplier account). */
export const supplierDocumentService = {
  ...makeClient('/api/supplier-account/documents', (poId) => `/api/supplier-account/orders/${poId}/documents`),
};
