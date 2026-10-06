import type { CustomerCatalogBook, CustomerCatalogSearchParams } from '../types/customerCatalog';

// Page-by-page loading of the public catalog for the reader screens. Pure (no
// React) so the rules below are unit-tested; useCatalogPages wraps it.
//
//  - page 1 replaces the list (first load, new query, pull-to-refresh);
//    later pages append, de-duplicated by book id
//  - one request at a time: loadMore while anything is loading is a no-op,
//    so FlatList's repeated onEndReached cannot start a request storm
//  - a response for an older query/refresh (generation) is dropped, so a slow
//    page can never overwrite or mix into the results of a newer search
//  - nothing is fetched past the last page the API reports

export type CatalogPage = {
  items: CustomerCatalogBook[];
  page: number;
  totalPages: number;
  total: number;
};

export type CatalogPageFetcher = (params: CustomerCatalogSearchParams, page: number) => Promise<CatalogPage>;

export type CatalogState = {
  items: CustomerCatalogBook[];
  /** Last page loaded (0 = none yet). */
  page: number;
  total: number;
  hasNextPage: boolean;
  loadingInitial: boolean;
  loadingMore: boolean;
  refreshing: boolean;
  error: string | null;
};

export const EMPTY_CATALOG_STATE: CatalogState = {
  items: [],
  page: 0,
  total: 0,
  hasNextPage: false,
  loadingInitial: false,
  loadingMore: false,
  refreshing: false,
  error: null,
};

/** Appends `incoming` to `current`, skipping books already listed (the catalog
 *  can shift between pages while the reader scrolls). */
export function mergeById(current: CustomerCatalogBook[], incoming: CustomerCatalogBook[]): CustomerCatalogBook[] {
  const seen = new Set(current.map((book) => book.id));
  const merged = [...current];
  for (const book of incoming) {
    if (seen.has(book.id)) continue;
    seen.add(book.id);
    merged.push(book);
  }
  return merged;
}

export function isBusy(state: CatalogState): boolean {
  return state.loadingInitial || state.loadingMore || state.refreshing;
}

type LoadKind = 'initial' | 'more' | 'refresh';

/** The request that failed, so retry repeats exactly it (a failed refresh of
 *  page 1 must not turn into "load page N+1"). */
type FailedLoad = { page: number; kind: LoadKind };

const LOADING_FLAG: Record<LoadKind, Partial<CatalogState>> = {
  initial: { loadingInitial: true },
  more: { loadingMore: true },
  refresh: { refreshing: true },
};

const IDLE: Partial<CatalogState> = { loadingInitial: false, loadingMore: false, refreshing: false };

export function createCatalogLoader(
  fetchPage: CatalogPageFetcher,
  onChange: (state: CatalogState) => void,
  describeError: (error: unknown) => string,
) {
  let state: CatalogState = EMPTY_CATALOG_STATE;
  let params: CustomerCatalogSearchParams | null = null;
  let generation = 0;
  let failedLoad: FailedLoad | null = null;

  function emit(patch: Partial<CatalogState>) {
    state = { ...state, ...patch };
    onChange(state);
  }

  async function load(page: number, kind: LoadKind) {
    if (!params) return;
    const current = generation;
    emit({ ...LOADING_FLAG[kind], error: null });
    try {
      const result = await fetchPage(params, page);
      if (current !== generation) return; // superseded by a newer query/refresh
      failedLoad = null;
      emit({
        ...IDLE,
        items: page === 1 ? mergeById([], result.items) : mergeById(state.items, result.items),
        page,
        total: result.total,
        hasNextPage: page < result.totalPages,
      });
    } catch (error) {
      if (current !== generation) return;
      // The list on screen is kept (a failed refresh does not clear it).
      failedLoad = { page, kind };
      emit({ ...IDLE, error: describeError(error) });
    }
  }

  return {
    getState: () => state,

    /** New search/filter (null = nothing to show): reset and load page 1. */
    setQuery(next: CustomerCatalogSearchParams | null) {
      generation += 1;
      params = next;
      failedLoad = null;
      state = { ...EMPTY_CATALOG_STATE };
      if (!next) {
        onChange(state);
        return Promise.resolve();
      }
      return load(1, 'initial');
    },

    /** Next page, only when idle, error-free and the API said there is one. */
    loadMore() {
      if (!params || isBusy(state) || state.error || !state.hasNextPage) return Promise.resolve();
      return load(state.page + 1, 'more');
    },

    /** Pull-to-refresh: page 1 again, replacing the list (items stay visible meanwhile). */
    refresh() {
      if (!params) return Promise.resolve();
      generation += 1;
      return load(1, 'refresh');
    },

    /** After an error: repeats the request that failed — same page, same kind. */
    retry() {
      if (!params || !failedLoad || isBusy(state)) return Promise.resolve();
      const { page, kind } = failedLoad;
      if (kind === 'refresh') generation += 1;
      return load(page, kind);
    },
  };
}
