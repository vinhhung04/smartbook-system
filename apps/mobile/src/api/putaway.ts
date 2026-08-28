import { apiFetch } from './client';
import { getAvailableTasks } from './picking';
import type {
  CompartmentCandidate,
  LocationLookupResult,
  ReceivingItem,
  ReceivingLocation,
  TransferResult,
  VariantLookupResult,
} from '../types/putaway';

// WAREHOUSE_STAFF cannot call GET /api/warehouses (manager-only), so the working
// warehouse is derived from whatever task data the account can already see.
export async function getWorkingWarehouseId(): Promise<string | null> {
  const available = await getAvailableTasks();
  const withWarehouse = available.data.find((task) => task.warehouse_id);
  return withWarehouse?.warehouse_id ?? null;
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
