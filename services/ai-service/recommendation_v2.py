"""Recommendation V2: candidate generation -> features -> log-linear hybrid ranking
-> constraints -> evidence. Pure functions, no I/O, deterministic.

Why log-linear. Reading choice behaves like a product of experts:
P(book | reader) ~ P(category | reader) * popularity(book) * author affinity * ...
Taking logs turns that product into a weighted sum, so

    score(u, b) = sum_k  w_k * f_k(u, b) / scale_k

where several f_k are log-quantities and each weight w_k is the exponent of its
factor. The weights are NOT set by hand: eval/eval_recommendation_v2.py selects
them by coordinate search on a temporal validation window and writes
recommendation_v2_weights.json, which production loads.

Point-in-time rule. Every feature is computed from interactions strictly before
`cutoff` (production: now; evaluation: the split time). build_global_model and
build_user_profile drop anything at or after the cutoff themselves, so a caller
cannot leak the future by passing too much.

As in V1, the LLM never picks or scores books; it only phrases a reason from the
reason codes produced here.
"""
from __future__ import annotations

import heapq
import json
import math
import os
import re
from datetime import datetime, timezone

from intent import normalize_text

FEATURES = (
    "preference", "author", "semantic", "collaborative",
    "popularity", "recency", "quality", "availability",
)
# Features that come from the reader's own history (used for tiering/explanations).
PERSONAL_FEATURES = ("preference", "author", "semantic", "collaborative")
# Ablation groups: "V2 - <group>" zeroes every feature in the group.
ABLATION_GROUPS = {
    "collaborative": ("collaborative",),
    "semantic": ("semantic",),
    "preference": ("preference", "author"),
    "popularity": ("popularity",),
    "quality": ("quality",),
    "availability": ("availability",),
    "recency": ("recency",),  # also disables the user-history time decay
}

# Structural defaults only - the tuned values live in recommendation_v2_weights.json.
DEFAULT_PARAMS = {
    "prior_strength": 3.0,        # Dirichlet pseudo-count towards the global category mix
    "half_life_days": None,       # user-history decay; None = no decay
    "cf_shrinkage": 10.0,         # item-item cosine shrinkage (co / (sqrt(ni nj) + s))
    "wishlist_weight": 1.0,       # a saved book relative to one loan
    "liked_rating_weight": 1.0,   # a >=4-star review; a <=2-star review counts negatively
    "trend_window_days": 30,      # "recent period" for the recency feature
    "quality_prior_count": 5.0,   # Bayesian shrinkage of the average rating
    "per_source_k": 40,           # candidates taken from each generator
    "new_book_days": 60,          # policy: a title added this recently with no loans is "new"
    "new_arrival_slots": 1,       # policy: top-N places guaranteed to the best new titles
}
# Evidence that a brand-new title cannot have yet. For new books these are set to
# the average over the reader's other candidates (neutral) instead of 0, the same
# principle as the rating prior: absence of history is not evidence of dislike.
HISTORY_FEATURES = ("collaborative", "popularity", "recency")
DEFAULT_WEIGHTS = {name: 1.0 for name in FEATURES}

RATING_LIKED_MIN = 4
RATING_DISLIKED_MAX = 2
RATING_MAX = 5
DAY_SECONDS = 86400.0

HIGH_RATING_MIN_AVERAGE = 4.0
HIGH_RATING_MIN_REVIEWS = 3
STRONG_TIER_TOP_FRACTION = 0.10
STRONG_TIER_PERSONAL_SHARE = 0.5

WEIGHTS_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "recommendation_v2_weights.json")

_TOKEN = re.compile(r"[a-z0-9]+")


# ── Input normalisation ──────────────────────────────────────────────────────

def parse_time(value) -> float | None:
    """ISO string / datetime / epoch seconds -> epoch seconds; malformed -> None."""
    if value is None or value == "":
        return None
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value) if math.isfinite(value) else None
    if isinstance(value, datetime):
        dt = value if value.tzinfo else value.replace(tzinfo=timezone.utc)
        return dt.timestamp()
    if isinstance(value, str):
        text = value.strip().replace("Z", "+00:00")
        try:
            dt = datetime.fromisoformat(text)
        except ValueError:
            return None
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.timestamp()
    return None


KINDS = ("LOAN", "WISHLIST", "REVIEW", "RESERVATION")


def normalize_interaction(raw) -> dict | None:
    """{user, book_id, kind, at, until, rating}; returns None for malformed rows
    (unknown kind, no user/book, unparseable time, review without a 1..5 rating)."""
    if not isinstance(raw, dict):
        return None
    kind = str(raw.get("kind") or "").upper()
    user = raw.get("user", raw.get("customer_id", raw.get("u")))
    book_id = raw.get("book_id")
    at = parse_time(raw.get("at"))
    if kind not in KINDS or user is None or user == "" or not book_id or at is None:
        return None
    rating = None
    if kind == "REVIEW":
        try:
            rating = int(raw.get("rating"))
        except (TypeError, ValueError):
            return None
        if not 1 <= rating <= RATING_MAX:
            return None
    return {
        "user": str(user),
        "book_id": str(book_id),
        "kind": kind,
        "at": at,
        "until": parse_time(raw.get("until")),
        "rating": rating,
        "variant_id": str(raw["variant_id"]) if raw.get("variant_id") else None,
    }


def normalize_interactions(rows) -> list[dict]:
    out = [row for row in (normalize_interaction(r) for r in rows or []) if row is not None]
    out.sort(key=lambda r: (r["at"], r["kind"], r["user"], r["book_id"]))
    return out


def before(interactions: list[dict], cutoff: float) -> list[dict]:
    """The only view of history any feature may use."""
    return [r for r in interactions if r["at"] < cutoff]


def active_at(row: dict, t: float) -> bool:
    return row["at"] < t and (row["until"] is None or row["until"] > t)


def book_key(book: dict) -> str:
    return str(book.get("id") or "")


def book_category(book: dict) -> str:
    return normalize_text(str(book.get("category") or ""))


def book_author(book: dict) -> str:
    return normalize_text(str(book.get("author") or ""))


def is_active_book(book: dict) -> bool:
    # Missing flag = active (older inventory builds do not send is_active).
    return book.get("is_active") is not False


def availability_from_catalog(book: dict) -> float | None:
    quantity = book.get("available_quantity")
    if quantity is None:
        quantity = book.get("quantity")
    if quantity is None:
        return None
    try:
        return 1.0 if float(quantity) > 0 else 0.0
    except (TypeError, ValueError):
        return None


# ── Content representation (TF-IDF, used identically offline and online) ────

def book_text(book: dict) -> str:
    return " ".join(str(book.get(f) or "") for f in ("title", "author", "category", "description", "summary_vi"))


def tokenize(text: str) -> list[str]:
    return [t for t in _TOKEN.findall(normalize_text(text)) if len(t) > 1]


def tfidf_vectors(catalog: list[dict]) -> dict[str, dict[str, float]]:
    docs = {book_key(b): tokenize(book_text(b)) for b in catalog if book_key(b)}
    df: dict[str, int] = {}
    for tokens in docs.values():
        for tok in set(tokens):
            df[tok] = df.get(tok, 0) + 1
    n = len(docs)
    vectors = {}
    for key, tokens in docs.items():
        tf: dict[str, float] = {}
        for tok in tokens:
            tf[tok] = tf.get(tok, 0.0) + 1.0
        vec = {tok: count * (math.log((n + 1) / (df[tok] + 1)) + 1.0) for tok, count in tf.items()}
        norm = math.sqrt(sum(v * v for v in vec.values()))
        vectors[key] = {tok: v / norm for tok, v in vec.items()} if norm else {}
    return vectors


def _dot(a: dict[str, float], b: dict[str, float]) -> float:
    if len(a) > len(b):
        a, b = b, a
    return sum(v * b.get(k, 0.0) for k, v in a.items())


# ── Global (non-personal) model: safe to cache and share between readers ─────

def _positive_sets(history: list[dict], cutoff: float) -> dict[str, set[str]]:
    """Binary implicit feedback per user: borrowed, saved or liked - minus disliked.
    Binary on purpose: it needs no hand-set strength per interaction type.
    A wishlist row counts only while it exists at the cutoff (the DB hard-deletes
    removed rows, so the live system cannot see them either)."""
    positive: dict[str, set[str]] = {}
    disliked: dict[str, set[str]] = {}
    for r in history:
        if r["kind"] == "RESERVATION":
            continue
        if r["kind"] == "WISHLIST" and not active_at(r, cutoff):
            continue
        if r["kind"] == "REVIEW":
            if r["rating"] <= RATING_DISLIKED_MAX:
                disliked.setdefault(r["user"], set()).add(r["book_id"])
                continue
            if r["rating"] < RATING_LIKED_MIN:
                continue
        positive.setdefault(r["user"], set()).add(r["book_id"])
    for user, books in disliked.items():
        if user in positive:
            positive[user] -= books
    return positive


def item_similarity(positive_sets: dict[str, set[str]], shrinkage: float) -> dict[str, dict[str, float]]:
    """Item-item cosine with shrinkage: co(i,j) / (sqrt(n_i * n_j) + shrinkage)."""
    counts: dict[str, int] = {}
    co: dict[str, dict[str, int]] = {}
    for books in positive_sets.values():
        items = sorted(books)
        for i in items:
            counts[i] = counts.get(i, 0) + 1
        for a_index, a in enumerate(items):
            row = co.setdefault(a, {})
            for b in items[a_index + 1:]:
                row[b] = row.get(b, 0) + 1
    sim: dict[str, dict[str, float]] = {}
    for a, row in co.items():
        for b, c in row.items():
            value = c / (math.sqrt(counts[a] * counts[b]) + shrinkage)
            sim.setdefault(a, {})[b] = value
            sim.setdefault(b, {})[a] = value
    return sim


def build_global_model(catalog: list[dict], interactions: list[dict], cutoff: float, params: dict | None = None) -> dict:
    """Everything that does not depend on who is asking, from history < cutoff."""
    p = {**DEFAULT_PARAMS, **(params or {})}
    history = before(interactions, cutoff)
    books = [b for b in catalog if isinstance(b, dict) and book_key(b)]
    by_id = {book_key(b): b for b in books}

    popularity: dict[str, int] = {}
    trend: dict[str, int] = {}
    trend_start = cutoff - float(p["trend_window_days"]) * DAY_SECONDS
    category_loans: dict[str, float] = {}
    rating_sum: dict[str, float] = {}
    rating_count: dict[str, int] = {}
    for r in history:
        book = by_id.get(r["book_id"])
        if r["kind"] == "LOAN":
            popularity[r["book_id"]] = popularity.get(r["book_id"], 0) + 1
            if r["at"] >= trend_start:
                trend[r["book_id"]] = trend.get(r["book_id"], 0) + 1
            if book is not None:
                cat = book_category(book)
                category_loans[cat] = category_loans.get(cat, 0.0) + 1.0
        elif r["kind"] == "REVIEW":
            rating_sum[r["book_id"]] = rating_sum.get(r["book_id"], 0.0) + r["rating"]
            rating_count[r["book_id"]] = rating_count.get(r["book_id"], 0) + 1

    # Global category mix (add-one so a category with no loans yet is not log(0)).
    categories = sorted({book_category(b) for b in books})
    total = sum(category_loans.get(c, 0.0) + 1.0 for c in categories) or 1.0
    category_prior = {c: (category_loans.get(c, 0.0) + 1.0) / total for c in categories}

    n_ratings = sum(rating_count.values())
    global_mean = (sum(rating_sum.values()) / n_ratings) if n_ratings else 3.0

    return {
        "cutoff": cutoff,
        "params": p,
        "by_id": by_id,
        "popularity": popularity,
        "trend": trend,
        "category_prior": category_prior,
        "rating_sum": rating_sum,
        "rating_count": rating_count,
        "rating_global_mean": global_mean,
        "similarity": item_similarity(_positive_sets(history, cutoff), float(p["cf_shrinkage"])),
        "tfidf": tfidf_vectors(books),
        "popularity_rank": _percentile_ranks(books, popularity),
    }


def _percentile_ranks(books: list[dict], counts: dict[str, int]) -> dict[str, float]:
    """1.0 = most borrowed. Used for evidence (POPULAR_OVERALL) and bias metrics."""
    ordered = sorted(books, key=lambda b: (counts.get(book_key(b), 0), book_key(b)))
    n = len(ordered)
    return {book_key(b): (i + 1) / n for i, b in enumerate(ordered)} if n else {}


# ── Reader profile ───────────────────────────────────────────────────────────

def build_user_profile(user_interactions: list[dict], model: dict, cutoff: float | None = None) -> dict:
    """Taste profile of ONE reader from their own history < cutoff."""
    cutoff = model["cutoff"] if cutoff is None else cutoff
    p = model["params"]
    by_id = model["by_id"]
    history = before(user_interactions, cutoff)
    half_life = p.get("half_life_days")

    def decay(at: float) -> float:
        if not half_life:
            return 1.0
        return 0.5 ** (max(0.0, cutoff - at) / (float(half_life) * DAY_SECONDS))

    book_weight: dict[str, float] = {}
    seen: set[str] = set()
    loan_count = 0
    for r in history:
        bid = r["book_id"]
        kind = r["kind"]
        if kind == "RESERVATION":
            # A reservation still held at the cutoff: do not recommend it again.
            if active_at(r, cutoff):
                seen.add(bid)
            continue
        if kind == "WISHLIST":
            # Only rows that still exist at the cutoff are visible to the live system.
            if not active_at(r, cutoff):
                continue
            seen.add(bid)
            weight = float(p["wishlist_weight"])
        elif kind == "REVIEW":
            seen.add(bid)
            if r["rating"] >= RATING_LIKED_MIN:
                weight = float(p["liked_rating_weight"])
            elif r["rating"] <= RATING_DISLIKED_MAX:
                weight = -float(p["liked_rating_weight"])
            else:
                continue
        else:  # LOAN
            seen.add(bid)
            loan_count += 1
            weight = 1.0
        book_weight[bid] = book_weight.get(bid, 0.0) + weight * decay(r["at"])

    categories: dict[str, float] = {}
    authors: dict[str, float] = {}
    for bid, weight in book_weight.items():
        book = by_id.get(bid)
        if book is None:
            continue
        cat = book_category(book)
        author = book_author(book)
        if cat:
            categories[cat] = categories.get(cat, 0.0) + weight
        if author:
            authors[author] = authors.get(author, 0.0) + weight
    categories = {k: v for k, v in categories.items() if v > 0}
    authors = {k: v for k, v in authors.items() if v > 0}
    positive = {bid: w for bid, w in book_weight.items() if w > 0 and bid in by_id}

    centroid: dict[str, float] = {}
    for bid, w in positive.items():
        for tok, v in model["tfidf"].get(bid, {}).items():
            centroid[tok] = centroid.get(tok, 0.0) + w * v
    norm = math.sqrt(sum(v * v for v in centroid.values()))
    centroid = {tok: v / norm for tok, v in centroid.items()} if norm else {}

    return {
        "categories": categories,
        "authors": authors,
        "positive": positive,
        "centroid": centroid,
        "seen": seen,
        "loan_count": loan_count,
        "signal_count": len(book_weight),
    }


# ── Features ─────────────────────────────────────────────────────────────────

def feature_vector(book: dict, profile: dict, model: dict, availability: float | None) -> dict:
    """Raw feature values. `None` only where the input truly does not exist
    (availability unknown); it is scored as neutral and flagged, never faked."""
    p = model["params"]
    bid = book_key(book)
    cat = book_category(book)
    author = book_author(book)
    cats = profile["categories"]
    total = sum(cats.values())
    alpha = float(p["prior_strength"])
    prior = model["category_prior"].get(cat, min(model["category_prior"].values(), default=1.0))
    preference_share = (cats.get(cat, 0.0) + alpha * prior) / (total + alpha)

    positive = profile["positive"]
    weight_sum = sum(positive.values())
    collaborative = 0.0
    if weight_sum > 0:
        row = model["similarity"].get(bid, {})
        collaborative = sum(w * row.get(j, 0.0) for j, w in positive.items()) / weight_sum

    count = model["rating_count"].get(bid, 0)
    m = float(p["quality_prior_count"])
    mean = (model["rating_sum"].get(bid, 0.0) + m * model["rating_global_mean"]) / (count + m)

    return {
        "preference": math.log(preference_share),
        "preference_share": preference_share,
        "author": math.log1p(profile["authors"].get(author, 0.0)),
        "semantic": _dot(model["tfidf"].get(bid, {}), profile["centroid"]) if profile["centroid"] else 0.0,
        "collaborative": collaborative,
        "popularity": math.log1p(model["popularity"].get(bid, 0)),
        "recency": math.log1p(model["trend"].get(bid, 0)),
        "quality": mean / RATING_MAX,
        "quality_reviews": count,
        "availability": 1.0 if availability is None else availability,
        "availability_known": availability is not None,
        "new_book": False,
    }


def eligible_books(catalog: list[dict], profile: dict) -> list[dict]:
    """Business rules: active, not already borrowed/saved/rated/reserved.
    Out-of-stock books stay (demoted by the availability feature)."""
    seen = profile["seen"]
    return [
        b for b in catalog
        if isinstance(b, dict) and book_key(b) and is_active_book(b) and book_key(b) not in seen
    ]


def candidate_pool(books: list[dict], features: dict[str, dict], per_source_k: int | None) -> dict[str, list[str]]:
    """Merge + dedupe the candidate generators. Returns book_id -> sources."""
    generators = {
        "PREFERENCE": lambda f: f["preference"] + f["author"],
        "COLLABORATIVE": lambda f: f["collaborative"],
        "SEMANTIC": lambda f: f["semantic"],
        "POPULAR": lambda f: f["popularity"],
        "TRENDING": lambda f: f["recency"],
    }
    keys = sorted(book_key(b) for b in books)
    pool: dict[str, list[str]] = {}
    for source, value in generators.items():
        scored = [(value(features[k]), k) for k in keys]
        if source in ("COLLABORATIVE", "SEMANTIC", "TRENDING"):
            scored = [s for s in scored if s[0] > 0]
        if per_source_k:
            scored = heapq.nsmallest(int(per_source_k), scored, key=lambda s: (-s[0], s[1]))
        for _, k in scored:
            pool.setdefault(k, []).append(source)
    return pool


# ── Scoring ──────────────────────────────────────────────────────────────────

def load_config(path: str = WEIGHTS_PATH) -> dict | None:
    """Tuned configuration, or None when the file is missing/invalid (callers fall back to V1)."""
    try:
        with open(path, encoding="utf-8") as handle:
            data = json.load(handle)
    except (OSError, ValueError):
        return None
    weights = data.get("weights") if isinstance(data, dict) else None
    if not isinstance(weights, dict) or not all(isinstance(weights.get(k), (int, float)) for k in FEATURES):
        return None
    scale = data.get("feature_scale") or {}
    return {
        "weights": {k: float(weights[k]) for k in FEATURES},
        "feature_scale": {k: float(scale.get(k) or 1.0) for k in FEATURES},
        "params": {**DEFAULT_PARAMS, **(data.get("params") or {})},
        "max_per_category": data.get("max_per_category"),
        "provenance": data.get("provenance") or {},
    }


def linear_score(f: dict, weights: dict, scale: dict) -> float:
    return sum(weights[k] * f[k] / (scale.get(k) or 1.0) for k in FEATURES if weights.get(k))


def new_book_ids(catalog: list[dict], model: dict) -> set[str]:
    """Titles created within `new_book_days` of the cutoff that nobody has borrowed yet."""
    days = model["params"].get("new_book_days")
    if not days:
        return set()
    horizon = model["cutoff"] - float(days) * DAY_SECONDS
    out = set()
    for b in catalog:
        created = parse_time(b.get("created_at")) if isinstance(b, dict) else None
        key = book_key(b) if isinstance(b, dict) else ""
        if key and created is not None and horizon <= created < model["cutoff"] and not model["popularity"].get(key):
            out.add(key)
    return out


def impute_new_books(feats: dict[str, dict], new_keys: set[str]) -> None:
    """In place: history features of new books := mean over the other candidates."""
    new_here = [k for k in feats if k in new_keys]
    others = [f for k, f in feats.items() if k not in new_keys]
    if not new_here or not others:
        return
    means = {name: sum(f[name] for f in others) / len(others) for name in HISTORY_FEATURES}
    for k in new_here:
        feats[k].update(means)
        feats[k]["new_book"] = True


def rank(
    catalog: list[dict],
    profile: dict,
    model: dict,
    weights: dict,
    scale: dict | None = None,
    availability: dict[str, float | None] | None = None,
    use_pool: bool = True,
    new_books: set[str] | None = None,
) -> list[dict]:
    """All eligible candidates, best first: [{book_id, book, features, score, sources}].
    Ties break on book_id so the order is reproducible. `new_books` defaults to
    new_book_ids(catalog, model)."""
    scale = scale or {}
    availability = availability or {}
    books = eligible_books(catalog, profile)
    feats = {}
    for b in books:
        key = book_key(b)
        avail = availability[key] if key in availability else availability_from_catalog(b)
        feats[key] = feature_vector(b, profile, model, avail)
    impute_new_books(feats, new_book_ids(catalog, model) if new_books is None else new_books)
    per_source_k = model["params"].get("per_source_k") if use_pool else None
    pool = candidate_pool(books, feats, per_source_k)
    entries = []
    for b in books:
        key = book_key(b)
        if key not in pool:
            continue
        entries.append({
            "book_id": key,
            "book": b,
            "features": feats[key],
            "score": linear_score(feats[key], weights, scale),
            "sources": pool[key],
        })
    entries.sort(key=lambda e: (-e["score"], e["book_id"]))
    return entries


def apply_category_cap(entries: list[dict], max_per_category: int | None) -> list[dict]:
    """Diversity constraint: at most N per category in order; overflow is moved
    after the capped list, never dropped (the list never shrinks)."""
    if not max_per_category:
        return list(entries)
    kept, overflow, per_cat = [], [], {}
    for e in entries:
        cat = book_category(e["book"])
        if per_cat.get(cat, 0) < int(max_per_category):
            per_cat[cat] = per_cat.get(cat, 0) + 1
            kept.append(e)
        else:
            overflow.append(e)
    return kept + overflow


def apply_new_arrival_slot(entries: list[dict], limit: int, slots: int = 1) -> list[dict]:
    """Business constraint for item cold start: history-based signals cannot rank
    a title nobody could borrow yet, so the best-scoring new titles (ordered by
    the same model score) are guaranteed the last `slots` places of the top
    `limit` when none would reach it. Nothing is dropped."""
    if not slots or limit <= 0:
        return list(entries)
    top = entries[:limit]
    have = sum(1 for e in top if e["features"].get("new_book"))
    missing = [e for e in entries[limit:] if e["features"].get("new_book")][: max(0, int(slots) - have)]
    if not missing:
        return list(entries)
    head = top[: limit - len(missing)]
    placed = {id(e) for e in head} | {id(e) for e in missing}
    return head + missing + [e for e in entries if id(e) not in placed]


# ── Evidence: contributions, reason codes, tier ─────────────────────────────

def contributions(entries: list[dict], weights: dict, scale: dict | None = None) -> list[dict]:
    """w_k * (f_k - pool mean of f_k) / scale_k per feature. They sum to
    score - mean pool score, i.e. how much each signal lifted this book above an
    average candidate for this reader."""
    scale = scale or {}
    if not entries:
        return []
    means = {k: sum(e["features"][k] for e in entries) / len(entries) for k in FEATURES}
    return [
        {k: (weights.get(k, 0.0) * (e["features"][k] - means[k]) / (scale.get(k) or 1.0)) for k in FEATURES}
        for e in entries
    ]


def reason_codes(entry: dict, contribution: dict, profile: dict, model: dict) -> list[str]:
    f = entry["features"]
    book = entry["book"]
    codes = []
    personal = profile["signal_count"] > 0
    if personal and contribution["preference"] > 0 and profile["categories"].get(book_category(book), 0) > 0:
        codes.append("MATCHED_CATEGORY")
    if personal and contribution["author"] > 0 and profile["authors"].get(book_author(book), 0) > 0:
        codes.append("MATCHED_AUTHOR")
    if f["new_book"]:
        codes.append("NEW_ARRIVAL")
    elif contribution["collaborative"] > 0 and f["collaborative"] > 0:
        codes.append("SIMILAR_USERS_LIKED")
    if contribution["semantic"] > 0 and f["semantic"] > 0:
        codes.append("SIMILAR_CONTENT")
    if not f["new_book"] and contribution["recency"] > 0 and model["trend"].get(entry["book_id"], 0) > 0:
        codes.append("POPULAR_IN_RECENT_PERIOD")
    if contribution["popularity"] > 0 and model["popularity_rank"].get(entry["book_id"], 0) >= 0.8:
        codes.append("POPULAR_OVERALL")
    count = f["quality_reviews"]
    average = model["rating_sum"].get(entry["book_id"], 0.0) / count if count else 0.0
    if contribution["quality"] > 0 and count >= HIGH_RATING_MIN_REVIEWS and average >= HIGH_RATING_MIN_AVERAGE:
        codes.append("HIGH_RATING")
    if f["availability_known"]:
        codes.append("AVAILABLE_NOW" if f["availability"] > 0 else "CURRENTLY_UNAVAILABLE")
    if not personal:
        codes.append("COLD_START_FALLBACK")
    return codes


def tier(contribution: dict, position: int, pool_size: int, personal: bool, imputed=()) -> str:
    """STRONG / GOOD / EXPLORE from traceable evidence - not a probability.
    STRONG: the reader's own signals lift the book and are at least half of what
    lifts it, and it sits in the top decile of their pool. GOOD: own signals lift
    it. EXPLORE: it is here for popularity / quality / availability only."""
    lift = sum(v for v in contribution.values() if v > 0)
    own = sum(contribution[k] for k in PERSONAL_FEATURES if contribution[k] > 0 and not (k in imputed))
    if not personal or own <= 0:
        return "EXPLORE"
    top = position < max(1, math.ceil(pool_size * STRONG_TIER_TOP_FRACTION))
    if top and lift > 0 and own / lift >= STRONG_TIER_PERSONAL_SHARE:
        return "STRONG"
    return "GOOD"


def _round(value, digits=3):
    return None if value is None else round(float(value), digits)


def recommend(
    catalog: list[dict],
    user_interactions: list[dict],
    model: dict,
    config: dict,
    limit: int = 6,
) -> dict:
    """Production entry point. Returns {"entries": [...], "profile": profile}."""
    profile = build_user_profile(user_interactions, model)
    weights, scale = config["weights"], config["feature_scale"]
    ranked = rank(catalog, profile, model, weights, scale)
    ranked = apply_category_cap(ranked, config.get("max_per_category"))
    ranked = apply_new_arrival_slot(ranked, limit, config["params"].get("new_arrival_slots", 0))
    contribs = contributions(ranked, weights, scale)
    scores = [e["score"] for e in ranked]
    low, high = (min(scores), max(scores)) if scores else (0.0, 0.0)
    personal = profile["signal_count"] > 0
    out = []
    for position, (e, c) in enumerate(zip(ranked, contribs)):
        if position >= limit:
            break
        f = e["features"]
        relative = (e["score"] - low) / (high - low) if high > low else 1.0
        out.append({
            "book_id": e["book_id"],
            "title": str(e["book"].get("title") or ""),
            "author": str(e["book"].get("author") or ""),
            "category": str(e["book"].get("category") or ""),
            # Relative position inside this reader's candidate pool (1 = best
            # candidate). A ranking score, not a probability of liking the book.
            "score": _round(relative),
            "tier": tier(c, position, len(ranked), personal, HISTORY_FEATURES if f["new_book"] else ()),
            "reason_codes": reason_codes(e, c, profile, model),
            "sources": e["sources"],
            "breakdown": {
                # V1-compatible keys (0..1) so existing UI factor rules still read them.
                "affinity": _round(f["preference_share"]),
                "semantic": _round(f["semantic"]),
                "quality": _round(f["quality"]),
                "availability": _round(f["availability"]) if f["availability_known"] else None,
                "collaborative": _round(f["collaborative"]),
                "popularity": _round(f["popularity"]),
                "recency": _round(f["recency"]),
                "author": _round(f["author"]),
                "final_score": _round(e["score"], 4),
                "contributions": {k: _round(v, 4) for k, v in c.items()},
            },
        })
    return {"entries": out, "profile": profile, "pool_size": len(ranked)}


# ── Explanation fallback (no LLM) ────────────────────────────────────────────

REASON_PHRASES = {
    "MATCHED_CATEGORY": "thuộc thể loại {category} bạn thường đọc",
    "MATCHED_AUTHOR": "cùng tác giả {author} bạn từng đọc",
    "SIMILAR_USERS_LIKED": "bạn đọc có lịch sử mượn giống bạn cũng mượn cuốn này",
    "NEW_ARRIVAL": "là sách mới về thư viện",
    "SIMILAR_CONTENT": "nội dung gần với những cuốn bạn đã đọc",
    "POPULAR_IN_RECENT_PERIOD": "đang được mượn nhiều gần đây",
    "POPULAR_OVERALL": "thuộc nhóm sách được mượn nhiều trong thư viện",
    "HIGH_RATING": "được bạn đọc khác đánh giá cao",
    "CURRENTLY_UNAVAILABLE": "hiện đang hết bản, bạn có thể đặt trước",
}


def rule_based_reason_v2(entry: dict) -> str:
    codes = entry.get("reason_codes") or []
    parts = [
        REASON_PHRASES[c].format(category=entry.get("category") or "", author=entry.get("author") or "")
        for c in codes if c in REASON_PHRASES
    ]
    if "COLD_START_FALLBACK" in codes and not parts:
        return "Gợi ý phổ biến cho bạn đọc mới, sẽ cá nhân hóa khi bạn mượn hoặc đánh giá sách."
    if not parts:
        return "Gợi ý để bạn khám phá thêm ngoài thói quen đọc hiện tại."
    return "Gợi ý vì " + ", ".join(parts[:3]) + "."


def reason_hints_v2(entry: dict) -> list[str]:
    """Hints handed to the LLM - the same facts the rule-based reason uses."""
    return [
        REASON_PHRASES[c].format(category=entry.get("category") or "", author=entry.get("author") or "")
        for c in entry.get("reason_codes") or [] if c in REASON_PHRASES
    ]


# ── Production adapters: raw service payloads -> interactions ────────────────

def interactions_from_reader_payloads(
    user: str,
    loans: list,
    wishlists: list,
    reviews: list,
    reservations: list,
    catalog: list[dict],
) -> list[dict]:
    """The asking reader's own rows (from /borrow/my/*) as interactions.
    Malformed rows are skipped, never fatal."""
    variant_to_book = {}
    for b in catalog:
        if not isinstance(b, dict):
            continue
        ids = {str(v) for v in (b.get("variant_ids") or []) if v}
        if not ids and b.get("variant_id"):
            ids = {str(b["variant_id"])}
        for vid in ids:
            variant_to_book[vid] = book_key(b)
    rows = []
    for loan in loans or []:
        if not isinstance(loan, dict):
            continue
        at = loan.get("borrow_date") or loan.get("created_at")
        for item in loan.get("loan_items") or []:
            if not isinstance(item, dict):
                continue
            bid = variant_to_book.get(str(item.get("variant_id") or ""))
            if bid:
                rows.append({"kind": "LOAN", "user": user, "book_id": bid, "at": at, "until": item.get("return_date")})
    for w in wishlists or []:
        if isinstance(w, dict):
            rows.append({"kind": "WISHLIST", "user": user, "book_id": w.get("book_id"), "at": w.get("created_at")})
    for r in reviews or []:
        if isinstance(r, dict) and str(r.get("status") or "VISIBLE").upper() == "VISIBLE":
            rows.append({"kind": "REVIEW", "user": user, "book_id": r.get("book_id"), "rating": r.get("rating"), "at": r.get("created_at")})
    active_reservation = {"PENDING", "READY_FOR_PICKUP"}
    for r in reservations or []:
        if not isinstance(r, dict):
            continue
        bid = r.get("book_id") or variant_to_book.get(str(r.get("variant_id") or ""))
        status = str(r.get("status") or "").upper()
        rows.append({
            "kind": "RESERVATION", "user": user, "book_id": bid, "at": r.get("reserved_at"),
            # Still held -> open interval; otherwise it ended at its last update.
            "until": None if status in active_reservation else (r.get("updated_at") or r.get("expires_at") or r.get("reserved_at")),
        })
    return normalize_interactions(rows)


def interactions_from_global_payload(payload, catalog: list[dict]) -> list[dict]:
    """Anonymous events from borrow-service /internal/recommendation/interactions.
    Loans/reservations carry a variant id (borrow-service does not know books);
    they are mapped to books through the catalog, unknown variants dropped."""
    events = payload.get("events") if isinstance(payload, dict) else payload
    variant_to_book = {}
    for b in catalog or []:
        if isinstance(b, dict):
            for vid in b.get("variant_ids") or ([b["variant_id"]] if b.get("variant_id") else []):
                variant_to_book[str(vid)] = book_key(b)
    rows = []
    for e in events if isinstance(events, list) else []:
        if not isinstance(e, dict):
            continue
        if not e.get("book_id") and e.get("variant_id"):
            e = {**e, "book_id": variant_to_book.get(str(e["variant_id"]))}
        rows.append(e)
    return normalize_interactions(rows)
