import { inventoryAPI } from './http-clients';

export type PackingTaskStatus = 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED' | 'NOT_STARTED';
export type PackingItemStatus = 'PENDING' | 'VERIFIED' | 'MISMATCH';
export type PackingEvidenceType = 'PHOTO' | 'VIDEO' | 'LIVE_SNAPSHOT';

export interface PackingTaskItem {
  id: string;
  packing_task_id: string;
  outbound_order_item_id: string;
  variant_id: string;
  expected_qty: number;
  scanned_qty: number;
  status: PackingItemStatus;
  book_variants?: {
    id: string;
    sku: string | null;
    isbn13?: string | null;
    books: { title: string };
  };
}

export interface PackingTask {
  id: string | null;
  task_number: string | null;
  root_order_id: string;
  warehouse_id: string;
  assigned_packer_id: string | null;
  status: PackingTaskStatus;
  scan_invoice_code: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  outbound_orders?: { id: string; outbound_number: string; status: string };
  warehouses?: { id: string; code: string; name: string };
  packing_task_items?: PackingTaskItem[];
}

export type PackingEvidenceAiStatus = 'MATCH' | 'MISMATCH' | 'UNAVAILABLE';

export interface PackingEvidenceAiResult {
  item_count: number;
  expected_count: number;
  detected_titles: string[];
  checked_at: string;
}

export interface PackingEvidence {
  id: string;
  evidence_type: PackingEvidenceType;
  captured_at: string;
  captured_by_user_id: string;
  ai_verification_status?: PackingEvidenceAiStatus | null;
  ai_verification_result?: PackingEvidenceAiResult | null;
}

export const packingService = {
  scanInvoice: async (code: string) => {
    const response = await inventoryAPI.post('/api/packing/scan-invoice', { code });
    return response.data as {
      task: PackingTask;
      outbound_order: { id: string; outbound_number: string; status: string; warehouse: unknown };
    };
  },

  getTasks: async (params?: { warehouse_id?: string; status?: PackingTaskStatus }) => {
    const response = await inventoryAPI.get('/api/packing/tasks', { params });
    return response.data as { tasks: PackingTask[] };
  },

  getTaskDetail: async (taskId: string) => {
    const response = await inventoryAPI.get(`/api/packing/tasks/${taskId}`);
    return response.data as { task: PackingTask & { packing_camera_evidence: PackingEvidence[] } };
  },

  claimTask: async (taskId: string, selfClaim = true) => {
    const response = await inventoryAPI.post(`/api/packing/tasks/${taskId}/${selfClaim ? 'claim-self' : 'claim'}`, {});
    return response.data as { task: PackingTask };
  },

  scanItem: async (taskId: string, code: string) => {
    const response = await inventoryAPI.post(`/api/packing/tasks/${taskId}/items/scan`, { code });
    return response.data as {
      item: PackingTaskItem;
      scan_result: 'MATCH';
      all_items_verified: boolean;
    };
  },

  uploadEvidence: async (taskId: string, evidenceType: PackingEvidenceType, storageRef: string, metadata?: Record<string, unknown>) => {
    const response = await inventoryAPI.post(`/api/packing/tasks/${taskId}/evidence`, {
      evidence_type: evidenceType,
      storage_ref: storageRef,
      metadata,
    });
    return response.data as { evidence: PackingEvidence };
  },

  /** Multipart upload for the continuous packing-session recording — real file on disk,
   *  not base64-in-JSON (a full recording can easily exceed the JSON body size limit). */
  uploadVideoEvidence: async (taskId: string, blob: Blob) => {
    const formData = new FormData();
    formData.append('video', blob, 'packing-recording.webm');
    const response = await inventoryAPI.post(`/api/packing/tasks/${taskId}/evidence/video`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return response.data as { evidence: PackingEvidence };
  },

  completeTask: async (taskId: string) => {
    const response = await inventoryAPI.post(`/api/packing/tasks/${taskId}/complete`, {});
    return response.data as { task: PackingTask };
  },

  cancelTask: async (taskId: string) => {
    const response = await inventoryAPI.post(`/api/packing/tasks/${taskId}/cancel`, {});
    return response.data as { task: PackingTask };
  },

  getTaskHistory: async (taskId: string) => {
    const response = await inventoryAPI.get(`/api/packing/tasks/${taskId}/history`);
    return response.data as {
      audit_logs: Array<{ id: string; action_name: string; created_at: string }>;
      scan_events: Array<{ id: string; scanned_code: string; scan_result: string; scanned_at: string }>;
    };
  },
};
