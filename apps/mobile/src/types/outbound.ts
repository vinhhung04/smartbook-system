export type OutboundTaskListItem = {
  task_type: 'outbound' | 'transfer';
  task_id: string;
  order_number: string;
  status: string;
  source_warehouse_code: string | null;
  source_warehouse_name: string | null;
  target_warehouse_code: string | null;
  target_warehouse_name: string | null;
  outbound_assigned_user_id: string | null;
  total_quantity: number;
  ready_quantity: number;
};

export type AvailableOutboundTask = {
  id: string;
  type: 'OUTBOUND';
  task_type: 'outbound' | 'transfer';
  title: string;
  status: string;
  warehouse: string | null;
  warehouse_id: string | null;
  created_at: string;
  claimable: boolean;
  claim_endpoint: string;
};

export type ConfirmOutboundResult = {
  message: string;
  data: {
    task_type: string;
    task_id: string;
    status: string;
    destination_receipt_number?: string;
  };
};
