export type MyWarehouseTask = {
  id: string;
  type: string;
  title: string;
  status: string;
  warehouse: string | null;
  created_at: string | null;
  completed_at: string | null;
  action_path: string | null;
  is_repick?: boolean;
  parent_order_number?: string | null;
};

export type MyWarehouseTaskSummary = Record<string, number>;

export type MyWarehouseTasksResponse = {
  data: MyWarehouseTask[];
  summary: MyWarehouseTaskSummary;
};
