import { useEffect, useMemo, useState } from 'react';

import { ApiError } from '../api/client';
import { createPagedLoader, EMPTY_PAGED_STATE, type PageFetcher, type PagedState } from '../lib/catalogPagination';

function defaultDescribe(fallback: string) {
  return (error: unknown) => (error instanceof ApiError ? error.message : fallback);
}

/**
 * Paged list for any /my endpoint, with the catalog's rules (lib/catalogPagination.ts):
 * page 1 replaces, later pages append without duplicates, one request at a time, and a
 * response for an older query is dropped. `params` = null shows nothing; a change in
 * params (compared by value) restarts at page 1.
 */
export function usePagedList<T extends { id: string }, P>(fetchPage: PageFetcher<T, P>, params: P | null, errorFallback: string) {
  const [state, setState] = useState<PagedState<T>>(EMPTY_PAGED_STATE);
  const [loader] = useState(() => createPagedLoader<T, P>(fetchPage, setState, defaultDescribe(errorFallback)));

  const queryKey = params === null ? null : JSON.stringify(params);
  useEffect(() => {
    void loader.setQuery(queryKey === null ? null : (JSON.parse(queryKey) as P));
  }, [loader, queryKey]);

  const actions = useMemo(
    () => ({
      loadMore: () => void loader.loadMore(),
      refresh: () => loader.refresh(),
      retry: () => void loader.retry(),
    }),
    [loader],
  );

  return { ...state, ...actions };
}
