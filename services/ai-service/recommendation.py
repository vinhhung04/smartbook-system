"""Deterministic scoring for personalised book recommendations.

Pure functions, no I/O, so they can be exercised directly with sample catalogs
(same convention as analytics-service's forecast.js / lead-time.js).

Design note: the LLM never picks the books and never assigns the score. Candidates
are generated from the real catalog and ranked here, so a recommended book_id
always exists by construction. The model is asked only to phrase the reason -
the same split already used by _build_isbn_intelligence, where confidence is
computed and the model is not trusted to score itself.
"""
from __future__ import annotations

from intent import normalize_text

# How strongly each kind of interaction says "this reader likes books like this".
WEIGHT_LOAN = 1.0
WEIGHT_WISHLIST = 1.5          # explicit intent, stronger than a past borrow
WEIGHT_RATING_LIKED = 2.0
WEIGHT_RATING_DISLIKED = -1.5  # actively steer away from what they disliked
RATING_LIKED_MIN = 4
RATING_DISLIKED_MAX = 2

# Bayesian shrink towards the prior mean, so 5 stars from one review cannot
# outrank 4.5 stars from forty.
RATING_PRIOR_COUNT = 5
RATING_PRIOR_MEAN = 3.0
RATING_MAX = 5

SCORE_WEIGHTS = {"semantic": 0.40, "affinity": 0.35, "quality": 0.15, "availability": 0.10}
# Out of stock is demoted, not removed: a reader may still want to reserve it.
OUT_OF_STOCK_AVAILABILITY = 0.30


def book_key(book: dict) -> str:
    return str(book.get("id") or "")


def variant_ids(book: dict) -> set[str]:
    """All variant ids of a book. Falls back to the single variant_id for callers
    still on an inventory build that predates the variant_ids field."""
    ids = {str(vid) for vid in (book.get("variant_ids") or []) if vid}
    if not ids and book.get("variant_id"):
        ids = {str(book["variant_id"])}
    return ids


def index_catalog_by_variant(catalog: list[dict]) -> dict[str, dict]:
    """variant id -> book. This is what makes a loan mappable back to its book;
    matching loan_items.variant_id against books.id never works, those are
    different primary keys."""
    index: dict[str, dict] = {}
    for book in catalog:
        if not isinstance(book, dict):
            continue
        for vid in variant_ids(book):
            index[vid] = book
    return index


def books_from_loans(loans: list, catalog: list[dict]) -> list[dict]:
    """Resolve loan transactions to the books they contain, newest first."""
    by_variant = index_catalog_by_variant(catalog)
    resolved: list[dict] = []
    seen: set[str] = set()
    for loan in loans or []:
        if not isinstance(loan, dict):
            continue
        for item in loan.get("loan_items") or []:
            if not isinstance(item, dict):
                continue
            book = by_variant.get(str(item.get("variant_id") or ""))
            if book is None:
                continue
            key = book_key(book)
            if key and key not in seen:
                seen.add(key)
                resolved.append(book)
    return resolved


def books_from_ids(book_ids: list, catalog: list[dict]) -> list[dict]:
    by_id = {book_key(book): book for book in catalog if isinstance(book, dict)}
    resolved = []
    for raw_id in book_ids or []:
        book = by_id.get(str(raw_id or ""))
        if book is not None:
            resolved.append(book)
    return resolved


def collect_signals(
    loan_books: list[dict],
    wishlist_books: list[dict],
    rated_books: list[tuple[dict, int]],
) -> list[tuple[dict, float]]:
    signals: list[tuple[dict, float]] = [(book, WEIGHT_LOAN) for book in loan_books]
    signals += [(book, WEIGHT_WISHLIST) for book in wishlist_books]
    for book, rating in rated_books:
        if rating is None:
            continue
        if rating >= RATING_LIKED_MIN:
            signals.append((book, WEIGHT_RATING_LIKED))
        elif rating <= RATING_DISLIKED_MAX:
            signals.append((book, WEIGHT_RATING_DISLIKED))
    return signals


def build_taste_profile(signals: list[tuple[dict, float]]) -> dict:
    """Weighted category/author preferences plus the text used for semantic
    matching. `seen_book_ids` are books to exclude from recommendations - the
    reader has already borrowed, wishlisted or rated them."""
    categories: dict[str, float] = {}
    authors: dict[str, float] = {}
    seen: set[str] = set()
    text_parts: list[str] = []

    for book, weight in signals:
        if not isinstance(book, dict):
            continue
        key = book_key(book)
        if key:
            seen.add(key)
        category = normalize_text(str(book.get("category") or ""))
        if category:
            categories[category] = categories.get(category, 0.0) + weight
        author = normalize_text(str(book.get("author") or ""))
        if author:
            authors[author] = authors.get(author, 0.0) + weight
        if weight > 0:
            # Only liked material describes what to look for; a disliked book
            # must not pull the semantic query towards itself.
            text_parts.append(" ".join(
                str(book.get(field) or "")
                for field in ("title", "author", "category", "description", "summary_vi")
            ))

    return {
        "categories": categories,
        "authors": authors,
        "seen_book_ids": seen,
        "text": " ".join(part.strip() for part in text_parts if part.strip()),
        "signal_count": len(signals),
    }


def select_candidates(catalog: list[dict], profile: dict) -> list[dict]:
    seen = profile.get("seen_book_ids") or set()
    return [
        book for book in catalog
        if isinstance(book, dict) and book_key(book) and book_key(book) not in seen
    ]


def affinity_score(book: dict, profile: dict) -> float:
    """0..1 match against the reader's weighted category/author preferences."""
    categories = profile.get("categories") or {}
    authors = profile.get("authors") or {}
    max_weight = max([*categories.values(), *authors.values(), 0.0])
    if max_weight <= 0:
        return 0.0

    category = normalize_text(str(book.get("category") or ""))
    author = normalize_text(str(book.get("author") or ""))
    category_score = max(0.0, categories.get(category, 0.0)) / max_weight
    author_score = max(0.0, authors.get(author, 0.0)) / max_weight
    if author_score > 0:
        # An author the reader already likes is a stronger signal than a broad genre.
        return min(1.0, 0.6 * author_score + 0.4 * category_score)
    return min(1.0, category_score)


def quality_score(stats: dict | None) -> float:
    """Average rating shrunk towards the prior mean by review count, scaled 0..1."""
    if not isinstance(stats, dict):
        return 0.0
    try:
        count = float(stats.get("totalReviews") or 0)
        average = float(stats.get("averageRating") or 0)
    except (TypeError, ValueError):
        return 0.0
    if count <= 0 or average <= 0:
        return 0.0
    shrunk = (average * count + RATING_PRIOR_MEAN * RATING_PRIOR_COUNT) / (count + RATING_PRIOR_COUNT)
    return max(0.0, min(1.0, shrunk / RATING_MAX))


def availability_score(book: dict) -> float:
    quantity = book.get("available_quantity")
    if quantity is None:
        quantity = book.get("quantity")
    try:
        quantity = float(quantity or 0)
    except (TypeError, ValueError):
        quantity = 0.0
    return 1.0 if quantity > 0 else OUT_OF_STOCK_AVAILABILITY


def rank_candidates(
    candidates: list[dict],
    profile: dict,
    rating_stats: dict[str, dict] | None = None,
    semantic: list[float] | None = None,
    limit: int = 6,
) -> list[dict]:
    """Rank candidates and return the top `limit` with their score breakdown.

    `semantic` is the cosine score per candidate (from book_index.semantic_scores),
    aligned with `candidates`. Pass [] when embeddings are unavailable - the other
    three components still rank, just less finely.
    """
    rating_stats = rating_stats or {}
    if not semantic or len(semantic) != len(candidates):
        semantic = [0.0] * len(candidates)

    scored = []
    for book, semantic_score in zip(candidates, semantic):
        breakdown = {
            "semantic": max(0.0, min(1.0, float(semantic_score or 0.0))),
            "affinity": affinity_score(book, profile),
            "quality": quality_score(rating_stats.get(book_key(book))),
            "availability": availability_score(book),
        }
        total = sum(SCORE_WEIGHTS[name] * value for name, value in breakdown.items())
        scored.append((round(min(1.0, max(0.0, total)), 3), breakdown, book))

    # Title as the final tiebreak keeps the order stable across identical scores.
    scored.sort(key=lambda entry: (-entry[0], str(entry[2].get("title") or "")))

    return [
        {
            "book_id": book_key(book),
            "title": str(book.get("title") or ""),
            "author": str(book.get("author") or ""),
            "category": str(book.get("category") or ""),
            "score": score,
            "breakdown": {name: round(value, 3) for name, value in breakdown.items()},
        }
        for score, breakdown, book in scored[:limit]
    ]


def rule_based_reason(entry: dict, profile: dict) -> str:
    """Fallback explanation when the LLM is unavailable. States only what the
    score actually used - it never invents a justification."""
    breakdown = entry.get("breakdown") or {}
    parts: list[str] = []

    category = normalize_text(entry.get("category") or "")
    author = normalize_text(entry.get("author") or "")
    if author and (profile.get("authors") or {}).get(author, 0) > 0:
        parts.append("cùng tác giả " + str(entry.get("author")) + " bạn từng đọc")
    if category and (profile.get("categories") or {}).get(category, 0) > 0:
        parts.append("thuộc thể loại " + str(entry.get("category")) + " bạn hay mượn")
    if breakdown.get("semantic", 0) >= 0.6:
        parts.append("nội dung gần với những cuốn bạn đã đọc")
    if breakdown.get("quality", 0) >= 0.7:
        parts.append("được bạn đọc khác đánh giá cao")
    if breakdown.get("availability", 1.0) < 1.0:
        parts.append("hiện đang hết hàng, bạn có thể đặt trước")

    if not parts:
        return "Gợi ý dựa trên mức độ phổ biến trong thư viện."
    return "Gợi ý vì " + ", ".join(parts) + "."
