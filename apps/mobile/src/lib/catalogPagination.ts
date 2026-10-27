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

// The same rules serve any paged /my list (reservations, loans, notifications), so the
// loader is generic over the item (anything with an id) and the query params.
export type Page<T> = {
  items: T[];
  page: number;
  totalPages: number;
  total: number;
};

export type PageFetcher<T, P> = (params: P, page: number) => Promise<Page<T>>;

export type PagedState<T> = {
  items: T[];
  /** Last page loaded (0 = none yet). */
  page: number;
  total: number;
  hasNextPage: boolean;
  loadingInitial: boolean;
  loadingMore: boolean;
  refreshing: boolean;
  error: string | null;
};

export type CatalogPage = Page<CustomerCatalogBook>;
export type CatalogPageFetcher = PageFetcher<CustomerCatalogBook, CustomerCatalogSearchParams>;
export type CatalogState = PagedState<CustomerCatalogBook>;

export const EMPTY_PAGED_STATE: PagedState<never> = {
  items: [],
  page: 0,
  total: 0,
  hasNextPage: false,
  loadingInitial: false,
  loadingMore: false,
  refreshing: false,
  error: null,
};

export const EMPTY_CATALOG_STATE: CatalogState = EMPTY_PAGED_STATE;

/** Appends `incoming` to `current`, skipping items already listed (the list
 *  can shift between pages while the reader scrolls). */
export function mergeById<T extends { id: string }>(current: T[], incoming: T[]): T[] {
  const seen = new Set(current.map((book) => book.id));
  const merged = [...current];
  for (const book of incoming) {
    if (seen.has(book.id)) continue;
    seen.add(book.id);
    merged.push(book);
  }
  return merged;
}

export function isBusy(state: PagedState<unknown>): boolean {
  return state.loadingInitial || state.loadingMore || state.refreshing;
}

type LoadKind = 'initial' | 'more' | 'refresh';

/** The request that failed, so retry repeats exactly it (a failed refresh of
 *  page 1 must not turn into "load page N+1"). */
type FailedLoad = { page: number; kind: LoadKind };

const LOADING_FLAG: Record<LoadKind, Partial<PagedState<never>>> = {
  initial: { loadingInitial: true },
  more: { loadingMore: true },
  refresh: { refreshing: true },
};

const IDLE: Partial<PagedState<never>> = { loadingInitial: false, loadingMore: false, refreshing: false };

export function createPagedLoader<T extends { id: string }, P>(
  fetchPage: PageFetcher<T, P>,
  onChange: (state: PagedState<T>) => void,
  describeError: (error: unknown) => string,
) {
  let state: PagedState<T> = EMPTY_PAGED_STATE;
  let params: P | null = null;
  let generation = 0;
  let failedLoad: FailedLoad | null = null;

  function emit(patch: Partial<PagedState<T>>) {
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
    setQuery(next: P | null) {
      generation += 1;
      params = next;
      failedLoad = null;
      state = { ...EMPTY_PAGED_STATE };
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

export function createCatalogLoader(
  fetchPage: CatalogPageFetcher,
  onChange: (state: CatalogState) => void,
  describeError: (error: unknown) => string,
) {
  return createPagedLoader(fetchPage, onChange, describeError);
}
