import { apiFetch } from './client';
import type {
  CompartmentCandidate,
  LocationLookupResult,
  PutawayReceiptDetail,
  PutawayReceiptSummary,
  TransferResult,
} from '../types/putaway';

// GET /api/warehouses (manager-only) can't tell a WAREHOUSE_STAFF which warehouse
// they work in, but this endpoint lists POSTED goods receipts ready for putaway —
// already scoped per-user server-side (unassigned, or assigned to me) — so each
// receipt's own warehouse_id is the real signal, not a guess from unrelated tasks.
export function getReadyReceipts() {
  return apiFetch<PutawayReceiptSummary[]>('/api/putaway/receipts');
}

export function claimReceipt(receiptId: string) {
  return apiFetch<{ success: boolean; message: string }>(`/api/putaway/receipts/${receiptId}/claim-self`, {
    method: 'PATCH',
  });
}

export function assignReceipt(receiptId: string, userId: string) {
  return apiFetch<{ success: boolean; message: string }>(`/api/putaway/receipts/${receiptId}/assign`, {
    method: 'PATCH',
    body: { user_id: userId },
  });
}

// Scoped to one specific receipt — used to lock the putaway flow to that receipt's own
// lines (and their known source RECEIVING location), matching the web app's locked
// receiving-putaway mode instead of the unscoped "any SKU in this receiving bin" flow.
export function getReceiptDetail(receiptId: string) {
  return apiFetch<PutawayReceiptDetail>(`/api/putaway/receipts/${receiptId}`);
}

// goods_receipt_items.location_id is only populated for a few creation paths (most
// receipts are created with it left null — see supplier-delivery/outbound/transfer-receiving
// controllers), so it cannot be trusted as "the source receiving location". The web app never
// reads it either: it resolves the warehouse's own RECEIVING/STAGING location(s) instead.
export function getWarehouseReceivings(warehouseId: string) {
  return apiFetch<{ warehouse_id: string; receivings: { id: string; location_code: string; location_type: string; barcode: string | null }[] }>(
    `/api/receiving-putaway/warehouses/${warehouseId}/receivings`,
  );
}

export function getCandidates(receivingId: string, variantId: string) {
  return apiFetch<{
    warehouse_id: string;
    source_receiving_location_id: string;
    variant_id: string;
    candidates: CompartmentCandidate[];
  }>(`/api/receiving-putaway/receivings/${receivingId}/candidates?variant_id=${variantId}`);
}

export function lookupLocationByBarcode(warehouseId: string, barcode: string) {
  return apiFetch<LocationLookupResult>(
    `/api/receiving-putaway/lookup/location-by-barcode?warehouse_id=${warehouseId}&barcode=${encodeURIComponent(barcode)}`,
  );
}

export function transferToShelf(body: {
  warehouse_id: string;
  source_receiving_location_id: string;
  variant_id: string;
  // When the putaway is scoped to one goods receipt, pass its id through so the backend
  // stamps the resulting stock_movements against it — otherwise that receipt's own
  // remaining_quantity never decreases, even though the stock did move (see
  // putaway.controller.js's getReadyReceipts/getReadyReceiptDetail, which total up
  // "PUTAWAY"-bucket movements by reference_id).
  goods_receipt_id?: string;
  allocations: {
    target_location_id: string;
    quantity: number;
    reason: string;
    scanned_location_barcode?: string;
    scanned_product_barcode?: string;
  }[];
}) {
  return apiFetch<TransferResult>('/api/receiving-putaway/transfer', {
    method: 'POST',
    body,
  });
}
