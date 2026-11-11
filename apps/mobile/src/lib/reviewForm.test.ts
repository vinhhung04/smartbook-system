import { MAX_REVIEW_COMMENT, reviewMode, validateReview } from './reviewForm';

describe('validateReview', () => {
  it('requires an integer rating between 1 and 5', () => {
    expect(validateReview(null, '').ok).toBe(false);
    expect(validateReview(0, '').ok).toBe(false);
    expect(validateReview(6, '').ok).toBe(false);
    expect(validateReview(3.5, '').ok).toBe(false);
    expect(validateReview(4, '  hay  ')).toEqual({ ok: true, rating: 4, comment: 'hay' });
  });

  it('bounds the comment length like the server', () => {
    expect(validateReview(5, 'x'.repeat(MAX_REVIEW_COMMENT)).ok).toBe(true);
    expect(validateReview(5, 'x'.repeat(MAX_REVIEW_COMMENT + 1)).ok).toBe(false);
  });
});

describe('reviewMode', () => {
  it('edits an existing review regardless of eligibility', () => {
    expect(reviewMode(false, true)).toBe('edit');
  });

  it('only offers writing when the server says the reader returned the book', () => {
    expect(reviewMode(true, false)).toBe('write');
    expect(reviewMode(false, false)).toBe('not-eligible');
    expect(reviewMode(null, false)).toBe('unknown');
  });
});
