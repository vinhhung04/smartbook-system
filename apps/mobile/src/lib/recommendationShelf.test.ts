import { buildRecommendationShelf } from './recommendationShelf';
import type { CustomerCatalogBook } from '../types/customerCatalog';

const book = (id: string): CustomerCatalogBook => ({
  id,
  title: `Book ${id}`,
  subtitle: null,
  description: null,
  author: null,
  category: null,
  publisher: null,
  isbn: null,
  language: null,
  publish_year: null,
  summary_vi: null,
  cover_image_url: null,
  quantity: 1,
  available_quantity: 1,
  variant_id: null,
  default_warehouse_id: null,
  default_location_id: null,
  reservable: true,
  is_incomplete: false,
  locations: [],
});

const rec = (book_id: string, reason: string | null = 'vì bạn thích X') => ({ book_id, title: book_id, author: null, category: null, reason });

describe('buildRecommendationShelf', () => {
  it('keeps the AI order, not the catalog order', () => {
    const shelf = buildRecommendationShelf([rec('b'), rec('a')], [book('a'), book('b')]);
    expect(shelf.map((item) => item.book.id)).toEqual(['b', 'a']);
  });

  it('drops recommendations the public catalog no longer lists and duplicates', () => {
    const shelf = buildRecommendationShelf([rec('a'), rec('gone'), rec('a')], [book('a')]);
    expect(shelf.map((item) => item.book.id)).toEqual(['a']);
  });

  it('keeps the server reason and blanks empty ones', () => {
    const shelf = buildRecommendationShelf([rec('a', '  '), rec('b', 'Cùng tác giả')], [book('a'), book('b')]);
    expect(shelf.map((item) => item.reason)).toEqual([null, 'Cùng tác giả']);
  });
});
