import { describeDiscoverResult, normalizeDiscoverQuery } from './discoverAnswer';
import type { CustomerCatalogBook } from '../types/customerCatalog';

const book = (id: string, available: number) => ({ id, available_quantity: available }) as CustomerCatalogBook;

describe('normalizeDiscoverQuery', () => {
  it('collapses whitespace and requires a few characters', () => {
    expect(normalizeDiscoverQuery('  sách   trinh thám ')).toEqual({ ok: true, query: 'sách trinh thám' });
    expect(normalizeDiscoverQuery(' a ').ok).toBe(false);
  });

  it('caps the length like the server', () => {
    const result = normalizeDiscoverQuery('x'.repeat(500));
    expect(result.ok && result.query.length).toBe(200);
  });
});

describe('describeDiscoverResult', () => {
  it('says nothing was found instead of inventing an answer', () => {
    expect(describeDiscoverResult({ status: 'NO_EVIDENCE', results: [] })).toMatch(/chưa tìm thấy/);
  });

  it('is upfront when the match is uncertain', () => {
    const text = describeDiscoverResult({ status: 'UNCERTAIN', results: [{ book: book('a', 1), matched: ['semantic'] }] });
    expect(text).toMatch(/chưa cao/);
  });

  it('reports availability from the catalog numbers', () => {
    const text = describeDiscoverResult({
      status: 'CONFIDENT_MATCH',
      results: [{ book: book('a', 2), matched: ['keyword'] }, { book: book('b', 0), matched: ['keyword'] }],
    });
    expect(text).toBe('Mình tìm thấy 2 cuốn phù hợp — 1 cuốn còn sách để đặt trước.');
  });
});
