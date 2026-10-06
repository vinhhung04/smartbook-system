import { createCatalogLoader, mergeById, type CatalogPage, type CatalogState } from './catalogPagination';
import type { CustomerCatalogBook, CustomerCatalogSearchParams } from '../types/customerCatalog';

function book(id: string): CustomerCatalogBook {
  return {
    id, title: `Sách ${id}`, subtitle: null, description: null, author: null, category: null, publisher: null,
    isbn: null, language: null, publish_year: null, summary_vi: null, cover_image_url: null, quantity: 1,
    available_quantity: 1, variant_id: `v-${id}`, default_warehouse_id: null, default_location_id: null,
    reservable: true, is_incomplete: false, locations: [],
  };
}

const ids = (state: CatalogState) => state.items.map((item) => item.id);

type Call = { params: CustomerCatalogSearchParams; page: number; resolve: (page: CatalogPage) => void; reject: (error: Error) => void };

/** A fetcher whose requests stay pending until the test answers them. */
function controlledFetcher() {
  const calls: Call[] = [];
  const fetchPage = (params: CustomerCatalogSearchParams, page: number) =>
    new Promise<CatalogPage>((resolve, reject) => { calls.push({ params, page, resolve, reject }); });
  return { calls, fetchPage };
}

function setup() {
  const { calls, fetchPage } = controlledFetcher();
  let state: CatalogState | null = null;
  const loader = createCatalogLoader(fetchPage, (next) => { state = next; }, (error) => (error as Error).message);
  return { calls, loader, current: () => state ?? loader.getState() };
}

const pageOf = (page: number, totalPages: number, bookIds: string[], total = totalPages * 2): CatalogPage =>
  ({ items: bookIds.map(book), page, totalPages, total });

describe('mergeById', () => {
  it('appends new books and skips ids already listed', () => {
    expect(mergeById([book('a'), book('b')], [book('b'), book('c'), book('c')]).map((b) => b.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('createCatalogLoader', () => {
  it('loads page 1 on a new query and reports whether more pages exist', async () => {
    const { calls, loader, current } = setup();
    const done = loader.setQuery({ search: 'dế mèn' });
    expect(current().loadingInitial).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ page: 1, params: { search: 'dế mèn' } });

    calls[0].resolve(pageOf(1, 3, ['a', 'b'], 6));
    await done;
    expect(ids(current())).toEqual(['a', 'b']);
    expect(current()).toMatchObject({ page: 1, total: 6, hasNextPage: true, loadingInitial: false });
  });

  it('appends page 2 without duplicating a book that moved between pages', async () => {
    const { calls, loader, current } = setup();
    const first = loader.setQuery({});
    calls[0].resolve(pageOf(1, 2, ['a', 'b']));
    await first;

    const more = loader.loadMore();
    expect(current().loadingMore).toBe(true);
    expect(calls[1].page).toBe(2);
    calls[1].resolve(pageOf(2, 2, ['b', 'c']));
    await more;
    expect(ids(current())).toEqual(['a', 'b', 'c']);
    expect(current().hasNextPage).toBe(false);
  });

  it('does not fetch past the last page', async () => {
    const { calls, loader } = setup();
    const first = loader.setQuery({});
    calls[0].resolve(pageOf(1, 1, ['a']));
    await first;
    await loader.loadMore();
    expect(calls).toHaveLength(1);
  });

  it('repeated onEndReached while a page is loading starts only one request (no page loaded twice)', async () => {
    const { calls, loader } = setup();
    const first = loader.setQuery({});
    void loader.loadMore(); // still loading page 1: ignored
    calls[0].resolve(pageOf(1, 5, ['a']));
    await first;

    void loader.loadMore();
    void loader.loadMore();
    void loader.loadMore();
    expect(calls.map((call) => call.page)).toEqual([1, 2]);
  });

  it('refresh reloads page 1 and replaces the list instead of appending', async () => {
    const { calls, loader, current } = setup();
    const first = loader.setQuery({});
    calls[0].resolve(pageOf(1, 3, ['a', 'b']));
    await first;
    const more = loader.loadMore();
    calls[1].resolve(pageOf(2, 3, ['c', 'd']));
    await more;

    const refreshed = loader.refresh();
    expect(current().refreshing).toBe(true);
    expect(ids(current())).toEqual(['a', 'b', 'c', 'd']); // kept on screen while refreshing
    expect(calls[2].page).toBe(1);
    calls[2].resolve(pageOf(1, 2, ['z', 'a']));
    await refreshed;
    expect(ids(current())).toEqual(['z', 'a']);
    expect(current()).toMatchObject({ page: 1, hasNextPage: true, refreshing: false });
  });

  it('a new search resets pagination and a late answer for the old search is dropped', async () => {
    const { calls, loader, current } = setup();
    const first = loader.setQuery({ search: 'cũ' });
    calls[0].resolve(pageOf(1, 3, ['old-1']));
    await first;
    const staleMore = loader.loadMore(); // page 2 of the old search, still pending

    const next = loader.setQuery({ search: 'mới' });
    expect(current()).toMatchObject({ items: [], page: 0, loadingInitial: true });
    calls[2].resolve(pageOf(1, 1, ['new-1']));
    await next;
    calls[1].resolve(pageOf(2, 3, ['old-2'])); // arrives last
    await staleMore;

    expect(ids(current())).toEqual(['new-1']);
    expect(current()).toMatchObject({ page: 1, hasNextPage: false, loadingMore: false });
    expect(calls[2].params).toEqual({ search: 'mới' });
  });

  it('an empty query clears the list without any request', async () => {
    const { calls, loader, current } = setup();
    await loader.setQuery(null);
    expect(calls).toHaveLength(0);
    expect(current()).toMatchObject({ items: [], hasNextPage: false });
    await loader.loadMore();
    await loader.refresh();
    expect(calls).toHaveLength(0);
  });

  it('a failed page keeps what was loaded, stops auto-loading and can be retried', async () => {
    const { calls, loader, current } = setup();
    const first = loader.setQuery({});
    calls[0].resolve(pageOf(1, 3, ['a']));
    await first;
    const failing = loader.loadMore();
    calls[1].reject(new Error('Mất kết nối mạng'));
    await failing;
    expect(ids(current())).toEqual(['a']);
    expect(current().error).toBe('Mất kết nối mạng');

    await loader.loadMore(); // onEndReached after an error: no request storm
    expect(calls).toHaveLength(2);

    const retried = loader.retry();
    expect(calls[2].page).toBe(2);
    calls[2].resolve(pageOf(2, 3, ['b']));
    await retried;
    expect(ids(current())).toEqual(['a', 'b']);
    expect(current().error).toBeNull();
  });
});
