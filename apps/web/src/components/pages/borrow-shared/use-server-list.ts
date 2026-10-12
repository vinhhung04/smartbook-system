import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { getApiErrorMessage } from '@/services/api';
import type { PaginatedResponse } from '@/services/borrow';

type Meta = PaginatedResponse<unknown>['meta'];

const EMPTY_META: Meta = { page: 1, pageSize: 0, total: 0, totalPages: 1, status_counts: {} };
const SEARCH_DEBOUNCE_MS = 300;

/**
 * One page of a server-paginated borrow list. Search is debounced; changing the search or any
 * filter in `params` goes back to page 1; responses that arrive after a newer request are dropped.
 */
export function useServerList<T>(
  fetcher: (params: Record<string, unknown>) => Promise<PaginatedResponse<T>>,
  options: { pageSize: number; params: Record<string, unknown>; errorMessage: string },
) {
  const { pageSize, params, errorMessage } = options;
  const [rows, setRows] = useState<T[]>([]);
  const [meta, setMeta] = useState<Meta>(EMPTY_META);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const requestId = useRef(0);
  const paramsKey = JSON.stringify(params);

  // The page belongs to one filter combination: a new search or filter starts at page 1
  // in the same render, without first fetching the old page number.
  const filterKey = `${paramsKey}|${debouncedSearch}`;
  const [pageState, setPageState] = useState({ key: filterKey, page: 1 });
  const page = pageState.key === filterKey ? pageState.page : 1;
  const setPage = useCallback((next: number) => setPageState({ key: filterKey, page: next }), [filterKey]);

  useEffect(() => {
    const id = window.setTimeout(() => setDebouncedSearch(search.trim()), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(id);
  }, [search]);

  const load = useCallback(async () => {
    const id = ++requestId.current;
    setLoading(true);
    try {
      const response = await fetcher({
        ...JSON.parse(paramsKey),
        ...(debouncedSearch ? { q: debouncedSearch } : {}),
        page,
        pageSize,
      });
      if (id !== requestId.current) return;
      setRows(response.data ?? []);
      setMeta(response.meta ?? EMPTY_META);
    } catch (error) {
      if (id !== requestId.current) return;
      toast.error(getApiErrorMessage(error, errorMessage));
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, [fetcher, paramsKey, debouncedSearch, page, pageSize, errorMessage]);

  useEffect(() => {
    void load();
  }, [load]);

  return { rows, meta, loading, search, setSearch, page, setPage, reload: load };
}

/** Sum of several statuses' counts, e.g. the "Đã xong" tab covering three statuses. */
export function sumCounts(counts: Record<string, number> | undefined, statuses: readonly string[]): number {
  return statuses.reduce((sum, status) => sum + (counts?.[status] ?? 0), 0);
}
