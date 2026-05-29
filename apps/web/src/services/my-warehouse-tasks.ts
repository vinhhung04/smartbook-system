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

export interface AvailableWarehouseTask {
  id: string;
  type: "PICKING" | "OUTBOUND" | "TRANSFER_RECEIVING" | string;
  task_type: "outbound" | "transfer" | string;
  title: string;
  status: string;
  warehouse: string | null;
  warehouse_id: string | null;
  created_at: string | null;
  completed_at: null;
  action_path: null;
  claimable: true;
  claim_endpoint: string;
}

export interface AvailableWarehouseTaskResponse {
  data: AvailableWarehouseTask[];
}

export const myWarehouseTaskService = {
  async getMyTasks(): Promise<MyWarehouseTaskResponse> {
    const response = await inventoryAPI.get<MyWarehouseTaskResponse>("/api/my-warehouse-tasks");
    return response.data;
  },

  async getAvailableTasks(): Promise<AvailableWarehouseTaskResponse> {
    const response = await inventoryAPI.get<AvailableWarehouseTaskResponse>(
      "/api/my-warehouse-tasks/available",
    );
    return response.data;
  },

  async claimTask(claimEndpoint: string): Promise<unknown> {
    // Picking uses POST, outbound/transfer-receiving use PATCH
    const isPost = claimEndpoint.includes("/picking/");
    const response = isPost
      ? await inventoryAPI.post(claimEndpoint)
      : await inventoryAPI.patch(claimEndpoint);
    return response.data;
  },
};
