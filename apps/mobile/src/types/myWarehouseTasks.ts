export type MyWarehouseTaskSource =
  | 'GOODS_RECEIPT'
  | 'OUTBOUND_ORDER'
  | 'TRANSFER_ORDER'
  | 'PURCHASE_REQUEST'
  | 'EXCEPTION_REPORT'
  | 'STAFF_TASK';

export type MyWarehouseTask = {
  id: string;
  type: string;
  title: string;
  status: string;
  warehouse: string | null;
  created_at: string | null;
  completed_at: string | null;
  /** A web route — never navigated to directly on mobile (see lib/taskRoutes.ts). */
  action_path: string | null;
  /** Which table the task id belongs to; absent on older inventory-service builds. */
  source_type?: MyWarehouseTaskSource;
  priority?: string | null;
  due_date?: string | null;
  description?: string | null;
  is_repick?: boolean;
  parent_order_number?: string | null;
};

export type MyWarehouseTaskSummary = Record<string, number>;

export type MyWarehouseTasksResponse = {
  data: MyWarehouseTask[];
  summary: MyWarehouseTaskSummary;
};
