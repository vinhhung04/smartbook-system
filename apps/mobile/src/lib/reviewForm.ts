// Same rules as borrow-service review.controller createOrUpdateMyReview (rating integer
// 1–5, comment ≤ 2000 chars) — checked here first so the reader sees why before sending.
export const MAX_REVIEW_COMMENT = 2000;

export type ReviewCheck = { ok: true; rating: number; comment: string } | { ok: false; error: string };

export function validateReview(rating: number | null, comment: string): ReviewCheck {
  if (rating === null || !Number.isInteger(rating) || rating < 1 || rating > 5) {
    return { ok: false, error: 'Vui lòng chọn số sao từ 1 đến 5' };
  }
  const trimmed = comment.trim();
  if (trimmed.length > MAX_REVIEW_COMMENT) {
    return { ok: false, error: `Nhận xét tối đa ${MAX_REVIEW_COMMENT} ký tự (hiện ${trimmed.length})` };
  }
  return { ok: true, rating, comment: trimmed };
}

/** What the review area should offer, given the server's can_review answer and an existing review. */
export function reviewMode(canReview: boolean | null, hasReview: boolean): 'edit' | 'write' | 'not-eligible' | 'unknown' {
  if (hasReview) return 'edit';
  if (canReview === true) return 'write';
  if (canReview === false) return 'not-eligible';
  return 'unknown';
}
