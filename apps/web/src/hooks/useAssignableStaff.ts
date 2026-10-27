import { useEffect, useState } from "react";
import { userService, type WarehouseStaffMember } from "@/services/user";
import { getApiErrorMessage } from "@/services/api";

interface Result {
  warehouseId: string;
  staff: WarehouseStaffMember[];
  error: string | null;
}

/**
 * Active warehouse staff who can be handed work in `warehouseId` (WRITE-level
 * scope there). Empty until a warehouse is chosen. The backend re-checks the
 * same rule on every assignment; this only keeps the dropdown honest.
 */
export function useAssignableStaff(warehouseId: string | null | undefined) {
  const [result, setResult] = useState<Result | null>(null);

  useEffect(() => {
    if (!warehouseId) return undefined;
    let cancelled = false;
    userService.getStaffByWarehouse(warehouseId, { assignable: true })
      .then((response) => {
        if (!cancelled) setResult({ warehouseId, staff: Array.isArray(response.data) ? response.data : [], error: null });
      })
      .catch((err) => {
        if (!cancelled) setResult({ warehouseId, staff: [], error: getApiErrorMessage(err, "Không tải được nhân viên của kho") });
      });
    return () => { cancelled = true; };
  }, [warehouseId]);

  // a result for another warehouse is never shown: switching clears the list at once
  const current = warehouseId && result?.warehouseId === warehouseId ? result : null;
  return {
    staff: current?.staff ?? [],
    loading: Boolean(warehouseId) && !current,
    error: current?.error ?? null,
  };
}
