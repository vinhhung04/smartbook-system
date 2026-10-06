import { useEffect, useMemo, useState } from 'react';

import { getCatalogPage } from '../api/customerCatalog';
import { ApiError } from '../api/client';
import { createCatalogLoader, EMPTY_CATALOG_STATE, type CatalogState } from '../lib/catalogPagination';
import type { CustomerCatalogSearchParams } from '../types/customerCatalog';

function describeError(error: unknown) {
  return error instanceof ApiError ? error.message : 'Không tải được danh mục sách';
}

/**
 * Paged public catalog for a reader screen. `params` = null shows nothing
 * (e.g. empty search box). Changing params (compared by value) restarts at page 1.
 */
export function useCatalogPages(params: CustomerCatalogSearchParams | null) {
  const [state, setState] = useState<CatalogState>(EMPTY_CATALOG_STATE);
  // One loader per mounted screen; it owns paging and drops stale responses.
  const [loader] = useState(() => createCatalogLoader(getCatalogPage, setState, describeError));

  const queryKey = params ? JSON.stringify(params) : null;
  useEffect(() => {
    void loader.setQuery(queryKey ? (JSON.parse(queryKey) as CustomerCatalogSearchParams) : null);
  }, [loader, queryKey]);

  const actions = useMemo(() => ({
    loadMore: () => void loader.loadMore(),
    refresh: () => void loader.refresh(),
    retry: () => void loader.retry(),
  }), [loader]);

  return { ...state, ...actions };
}
