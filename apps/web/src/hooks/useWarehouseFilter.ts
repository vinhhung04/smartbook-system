import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { warehouseService, type Warehouse } from '@/services/warehouse';

export const WAREHOUSE_PARAM = 'warehouse';

/**
 * The warehouse an analytics page is narrowed to, kept in `?warehouse=` so a link (dashboard -> reports)
 * or a reload keeps it. The list is the caller's own scope (GET /api/warehouses is scoped server-side).
 */
export function useWarehouseFilter() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const warehouseId = searchParams.get(WAREHOUSE_PARAM) || '';

  useEffect(() => {
    let cancelled = false;
    warehouseService.getAll()
      .then((rows) => { if (!cancelled) setWarehouses(Array.isArray(rows) ? rows : []); })
      .catch(() => { if (!cancelled) setWarehouses([]); });
    return () => { cancelled = true; };
  }, []);

  const setWarehouseId = (next: string) => {
    setSearchParams((params) => {
      if (next) params.set(WAREHOUSE_PARAM, next);
      else params.delete(WAREHOUSE_PARAM);
      return params;
    }, { replace: true });
  };

  const selected = warehouses.find((w) => w.id === warehouseId) ?? null;
  return { warehouses, warehouseId, setWarehouseId, selected };
}
