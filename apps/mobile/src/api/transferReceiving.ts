import { apiFetch } from './client';

// inventory-service /api/transfer-receiving — the same endpoints the web
// "Nhận hàng điều chuyển" page uses. Receiving confirms the whole transfer
// (shipped quantities become a POSTED goods receipt in the destination's
// RECEIVING area); it is idempotent on the server, so a retried confirm of an
// already-received transfer returns the same receipt instead of moving stock again.

export type TransferReceivingItem = {
  id: string;
  transfer_number: string;
  status: string;
  from_warehouse_id: string;
  from_warehouse_code: string | null;
  from_warehouse_name: string | null;
  to_warehouse_id: string;
  to_warehouse_code: string | null;
  to_warehouse_name: string | null;
  received_by_user_id: string | null;
  shipped_at: string | null;
  total_quantity: number;
};

/** Managers see every IN_TRANSIT transfer into their warehouses; staff only the ones assigned to them. */
export function getTransferReceivingQueue() {
  return apiFetch<{ data: TransferReceivingItem[] }>('/api/transfer-receiving');
}

export function claimTransferReceiving(transferId: string) {
  return apiFetch<{ transfer_id: string; status: string }>(`/api/transfer-receiving/${encodeURIComponent(transferId)}/claim-self`, { method: 'PATCH' });
}

export function confirmTransferReceiving(transferId: string) {
  return apiFetch<{
    message: string;
    data: { transfer_id: string; status: string; goods_receipt_id: string | null; goods_receipt_number: string | null };
  }>(`/api/transfer-receiving/${encodeURIComponent(transferId)}/confirm`, { method: 'POST' });
}
