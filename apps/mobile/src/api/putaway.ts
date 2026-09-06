import { apiFetch } from './client';
import type {
  CompartmentCandidate,
  LocationLookupResult,
  PutawayReceiptSummary,
  ReceivingItem,
  ReceivingLocation,
  TransferResult,
  VariantLookupResult,
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

export function getReceivings(warehouseId: string) {
  return apiFetch<{ warehouse_id: string; receivings: ReceivingLocation[] }>(
    `/api/receiving-putaway/warehouses/${warehouseId}/receivings`,
  );
}

export function getReceivingItems(receivingId: string) {
  return apiFetch<{
    warehouse_id: string;
    receiving: { id: string; location_code: string; location_type: string };
    items: ReceivingItem[];
  }>(`/api/receiving-putaway/receivings/${receivingId}/items`);
}

export function lookupVariantByBarcode(barcode: string) {
  return apiFetch<VariantLookupResult>(
    `/api/receiving-putaway/lookup/variant-by-barcode?barcode=${encodeURIComponent(barcode)}`,
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
