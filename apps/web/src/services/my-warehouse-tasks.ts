import { inventoryAPI } from "./http-clients";

export interface MyWarehouseTask {
  id: string;
  type: "RECEIVING" | "PUTAWAY" | "PICKING" | "OUTBOUND" | string;
  title: string;
  status: string;
  warehouse: string | null;
  warehouse_id?: string | null;
  created_at: string | null;
  completed_at: string | null;
  action_path?: string | null;
}

export interface MyWarehouseTaskResponse {
  data: MyWarehouseTask[];
  summary: Record<string, number>;
}

export const myWarehouseTaskService = {
  async getMyTasks(): Promise<MyWarehouseTaskResponse> {
    const response = await inventoryAPI.get<MyWarehouseTaskResponse>("/api/my-warehouse-tasks");
    return response.data;
  },
};
