import { useCallback, useState } from 'react';

import * as authApi from '../api/auth';
import { ApiError } from '../api/client';
import type { SelectOption } from '../lib/optionSearch';

export type StaffOption = SelectOption & { userId: string };

/**
 * Warehouse staff for the manager's "Giao" sheet, loaded when the sheet opens (not with
 * the task list) so a failure here shows in the sheet with a retry instead of blanking
 * the whole picking/putaway list.
 */
export function useWarehouseStaff() {
  const [options, setOptions] = useState<StaffOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await authApi.getWarehouseStaff();
      setOptions(
        result.data.map((staff) => ({
          id: staff.id,
          userId: staff.id,
          title: staff.full_name || staff.username,
          subtitle: staff.full_name ? `@${staff.username}` : null,
          keywords: staff.email,
        })),
      );
      setLoaded(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Không tải được danh sách nhân viên kho');
    } finally {
      setLoading(false);
    }
  }, []);

  const ensureLoaded = useCallback(() => {
    if (!loaded && !loading) void load();
  }, [loaded, loading, load]);

  return { options, loading, error, reload: load, ensureLoaded };
}
