export type ExceptionTaskType = 'RECEIVING' | 'PUTAWAY' | 'PICKING' | 'OUTBOUND';

export type ExceptionType = 'SHORT' | 'OVERAGE' | 'DAMAGED' | 'WRONG_ITEM' | 'WRONG_QTY' | 'OTHER';

export type ExceptionReportStatus = 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED' | 'DISMISSED';

export type ExceptionReport = {
  id: string;
  report_number: string;
  warehouse_id: string;
  task_type: ExceptionTaskType | string;
  task_id: string;
  exception_type: ExceptionType | string;
  expected_qty: number | null;
  actual_qty: number | null;
  note: string;
  evidence_notes: string | null;
  evidence_photo_url: string | null;
  status: ExceptionReportStatus | string;
  resolution_notes: string | null;
  created_at: string;
  warehouses?: { id: string; code: string; name: string } | null;
};

export type ExceptionReportCreateInput = {
  warehouse_id: string;
  task_type: string;
  task_id: string;
  exception_type: string;
  expected_qty?: number;
  actual_qty?: number;
  note: string;
  evidence_notes?: string;
  evidence_photo_url?: string;
};

export type MyWarehouseTaskOption = {
  id: string;
  type: string;
  title: string;
  status: string;
  warehouse: string | null;
};

export type WarehouseOption = {
  id: string;
  code: string;
  name: string;
};
