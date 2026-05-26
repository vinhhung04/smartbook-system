import { inventoryAPI } from "./http-clients";

export interface ExceptionReport {
  id: string;
  report_number: string;
  created_by_user_id: string;
  warehouse_id: string;
  task_type: "RECEIVING" | "PUTAWAY" | "PICKING" | "OUTBOUND" | string;
  task_id: string;
  goods_receipt_id: string | null;
  exception_type: "SHORT" | "OVERAGE" | "DAMAGED" | "WRONG_ITEM" | "WRONG_QTY" | "OTHER" | string;
  book_variant_id: string | null;
  expected_qty: number | null;
  actual_qty: number | null;
  note: string;
  evidence_notes: string | null;
  status: "OPEN" | "ACKNOWLEDGED" | "RESOLVED" | "DISMISSED" | string;
  resolved_by_user_id: string | null;
  resolved_at: string | null;
  resolution_notes: string | null;
  created_at: string;
  updated_at: string;
  warehouses?: { id: string; code: string; name: string } | null;
  book_variants?: {
    id: string; sku: string; isbn13: string | null;
    books?: { id: string; title: string } | null;
  } | null;
}

export interface ExceptionReportCreateInput {
  warehouse_id: string;
  task_type: string;
  task_id: string;
  goods_receipt_id?: string;
  exception_type: string;
  book_variant_id?: string;
  expected_qty?: number;
  actual_qty?: number;
  note: string;
  evidence_notes?: string;
}

export const exceptionReportService = {
  async createReport(data: ExceptionReportCreateInput): Promise<{ data: ExceptionReport }> {
    const response = await inventoryAPI.post<{ data: ExceptionReport }>("/api/exception-reports", data);
    return response.data;
  },

  async getMyReports(): Promise<{ data: ExceptionReport[] }> {
    const response = await inventoryAPI.get<{ data: ExceptionReport[] }>("/api/exception-reports/my");
    return response.data;
  },

  async getAll(params?: { status?: string; warehouse_id?: string; task_type?: string; exception_type?: string; limit?: number }): Promise<{ data: ExceptionReport[]; total?: number }> {
    const response = await inventoryAPI.get<{ data: ExceptionReport[]; total?: number }>("/api/exception-reports", { params });
    return response.data;
  },

  async getReportById(id: string): Promise<{ data: ExceptionReport }> {
    const response = await inventoryAPI.get<{ data: ExceptionReport }>(`/api/exception-reports/${id}`);
    return response.data;
  },

  async resolve(id: string, resolution_notes?: string): Promise<{ data: ExceptionReport }> {
    const response = await inventoryAPI.post<{ data: ExceptionReport }>(`/api/exception-reports/${id}/resolve`, { resolution_notes });
    return response.data;
  },
};
