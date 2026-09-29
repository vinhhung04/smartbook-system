// Reviews: only ever for a book the customer borrowed AND returned, at most one
// per (customer, book), dated after the return. Rating comes from a latent
// enjoyment score (taste match + book quality + personal leniency + noise),
// never a uniform draw. Comments are deterministic templates - no LLM calls.

const { REVIEWS } = require('./config');
const { DAY_MS } = require('./temporal-model');
const { tasteMatch } = require('./preferences');
const { reviewProbability, ratingScore, ratingFromScore } = require('./behavior-model');

const COMMENT_TEMPLATES = {
  5: ['Rất phù hợp với sở thích của tôi.', 'Nội dung cuốn hút, sẽ đọc lại.', 'Một trong những cuốn hay nhất tôi mượn ở thư viện.', 'Rất đáng đọc, đã giới thiệu cho bạn bè.'],
  4: ['Sách hay, nhiều ý đáng suy ngẫm.', 'Nội dung tốt, đọc khá cuốn.', 'Hài lòng, sẽ tìm đọc thêm của tác giả.'],
  3: ['Nội dung ổn nhưng có một số phần hơi dài.', 'Đọc được, không quá ấn tượng.', 'Tạm ổn, hợp để đọc giải trí.'],
  2: ['Không hợp gu của tôi lắm.', 'Khá khó theo dõi, đọc chưa hết.'],
  1: ['Không phù hợp với tôi.', 'Nội dung không như kỳ vọng.'],
};
const GENRE_SUFFIX = {
  'ky-nang-song': ' Có vài ý áp dụng được ngay.',
  'kinh-te': ' Nhiều ví dụ thực tế.',
  'van-hoc-viet-nam': ' Văn phong đậm chất Việt.',
  'van-hoc-nuoc-ngoai': ' Bản dịch dễ đọc.',
  'truyen-ngan': ' Các truyện ngắn gọn, dễ đọc.',
};

function comment(rng, rating, book) {
  if (!rng.chance(REVIEWS.commentShare)) return null;
  const base = rng.pick(COMMENT_TEMPLATES[rating]);
  const suffix = rating >= 4 && rng.chance(0.4) ? GENRE_SUFFIX[book.categories[0]] || '' : '';
  return base + suffix;
}

function maybeReview(ctx, customer, book, returnDate) {
  const { rng, end } = ctx;
  if (customer.reviewed.has(book.id)) return;
  const taste = tasteMatch(customer, book);
  if (!rng.chance(reviewProbability({ reviewTendency: customer.traits.review_tendency, taste }))) return;
  const createdAt = new Date(returnDate.getTime() + (0.05 + rng.exponential(REVIEWS.maxDelayMeanDays)) * DAY_MS);
  if (createdAt.getTime() > end.getTime()) return;
  const score = ratingScore(rng, { taste, quality: book.quality, leniency: customer.traits.rating_leniency });
  const rating = ratingFromScore(score);
  customer.reviewed.add(book.id);
  if (rating >= 4) {
    for (const author of book.authors) {
      if (!customer.likedAuthors.has(author)) customer.likedAuthors.set(author, []);
      customer.likedAuthors.get(author).push(createdAt.getTime());
    }
  }
  ctx.tables.book_reviews.push({
    id: ctx.idRng.uuid(),
    customer_id: customer.id,
    book_id: book.id,
    rating,
    comment: comment(rng, rating, book),
    status: 'VISIBLE',
    created_at: createdAt,
    updated_at: createdAt,
  });
}

module.exports = { maybeReview, COMMENT_TEMPLATES };
