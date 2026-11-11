import { useCallback, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';

import { getAvailableTasks } from '../api/picking';
import { getTransferReceivingQueue, type TransferReceivingItem } from '../api/transferReceiving';
import { ApiError } from '../api/client';

export type TransferRow = { item: TransferReceivingItem; claimable: boolean };

/**
 * Transfers waiting to be received: the queue endpoint (assigned to me, or all for a
 * manager) plus unclaimed ones from /api/my-warehouse-tasks/available, which a staff
 * member can claim before confirming.
 */
export function useTransferReceiving() {
  const [rows, setRows] = useState<TransferRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestRef = useRef(0);

  const load = useCallback(async () => {
    const requestId = ++requestRef.current;
    setError(null);
    try {
      const [queue, available] = await Promise.all([getTransferReceivingQueue(), getAvailableTasks().catch(() => ({ data: [] }))]);
      if (requestId !== requestRef.current) return;
      const known = new Set(queue.data.map((item) => item.id));
      const unclaimed: TransferRow[] = available.data
        .filter((task) => task.type === 'TRANSFER_RECEIVING' && !known.has(task.id))
        .map((task) => ({
          claimable: true,
          item: {
            id: task.id,
            transfer_number: task.title,
            status: task.status,
            from_warehouse_id: '',
            from_warehouse_code: null,
            from_warehouse_name: task.from_warehouse_name ?? null,
            to_warehouse_id: task.warehouse_id ?? '',
            to_warehouse_code: task.warehouse,
            to_warehouse_name: task.to_warehouse_name ?? null,
            received_by_user_id: null,
            shipped_at: task.created_at,
            total_quantity: 0,
          },
        }));
      setRows([...queue.data.map((item) => ({ item, claimable: !item.received_by_user_id })), ...unclaimed]);
    } catch (err) {
      if (requestId === requestRef.current) setError(err instanceof ApiError ? err.message : 'Không tải được danh sách nhận điều chuyển');
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      setIsLoading(true);
      load().finally(() => setIsLoading(false));
    }, [load]),
  );

  return { rows, isLoading, error, reload: load };
}
