"""Glue between the /recommendations endpoint and recommendation_v2 (no HTTP here,
so the flag, the cache and the V2 response are testable without main.py).

RECOMMENDATION_MODEL=v1|v2 selects the ranker. V2 needs its tuned configuration
(recommendation_v2_weights.json); without it the endpoint stays on V1, so a bad
deploy is rolled back by unsetting the flag or removing the file.
"""
from __future__ import annotations

import hashlib
import json
import time

import recommendation_v2 as v2

MODELS = ("v1", "v2")


def select_model(value: str | None, config: dict | None) -> tuple[str, str | None]:
    """(model actually used, reason for falling back or None)."""
    wanted = str(value or "v1").strip().lower()
    if wanted not in MODELS:
        return "v1", f"unknown RECOMMENDATION_MODEL={value!r}"
    if wanted == "v2" and config is None:
        return "v1", "recommendation_v2_weights.json missing or invalid"
    return wanted, None


def catalog_signature(catalog: list[dict]) -> str:
    rows = sorted(
        (str(b.get("id") or ""), str(b.get("title") or ""), str(b.get("category") or ""),
         str(b.get("author") or ""), str(b.get("description") or ""), b.get("is_active") is not False)
        for b in catalog if isinstance(b, dict)
    )
    return hashlib.sha1(json.dumps(rows, ensure_ascii=False).encode("utf-8")).hexdigest()


class GlobalModelCache:
    """Caches ONLY the reader-independent model (popularity, trend, category prior,
    item similarity, rating aggregates, TF-IDF). Nothing personal is stored, so
    one reader's profile can never be served to another."""

    def __init__(self, ttl_seconds: float = 600.0, clock=time.time):
        self.ttl = ttl_seconds
        self.clock = clock
        self._key = None
        self._expires = 0.0
        self._model = None

    def get(self, key):
        if self._model is not None and key == self._key and self.clock() < self._expires:
            return self._model
        return None

    def put(self, key, model):
        self._key, self._model, self._expires = key, model, self.clock() + self.ttl

    def clear(self):
        self._key, self._model, self._expires = None, None, 0.0


def build_global(catalog: list[dict], global_payload, config: dict, cache: GlobalModelCache | None, now: float | None = None):
    """Returns (model, interaction_count). A failed fetch (payload None) builds a
    history-free model that still ranks by content/quality/availability, and is
    not cached so the next request retries."""
    now = time.time() if now is None else now
    key = (catalog_signature(catalog), json.dumps(config["params"], sort_keys=True))
    if global_payload is not None and cache is not None:
        hit = cache.get(key)
        if hit is not None:
            return hit
    interactions = v2.interactions_from_global_payload(global_payload or [], catalog)
    model = v2.build_global_model(catalog, interactions, now, config["params"])
    result = (model, len(interactions))
    if global_payload is not None and cache is not None:
        cache.put(key, result)
    return result


def build_response(
    catalog: list[dict],
    reader_payloads: dict,
    model: dict,
    config: dict,
    limit: int,
    global_interactions: int,
) -> dict:
    """V2 ranking for one reader. `reader_payloads` holds the raw /borrow/my/*
    lists and `loans_status`. Reasons are attached afterwards by the caller."""
    catalog = [b for b in catalog if isinstance(b, dict)]
    user_rows = v2.interactions_from_reader_payloads(
        "me",
        reader_payloads.get("loans") or [],
        reader_payloads.get("wishlists") or [],
        reader_payloads.get("reviews") or [],
        reader_payloads.get("reservations") or [],
        catalog,
    )
    result = v2.recommend(catalog, user_rows, model, config, limit=limit)
    profile = result["profile"]
    kinds = {k: len({r["book_id"] for r in user_rows if r["kind"] == k}) for k in ("LOAN", "WISHLIST", "REVIEW")}
    return {
        "recommendations": result["entries"],
        "profile": profile,
        "personalized": reader_payloads.get("loans_status") == 200 and profile["signal_count"] > 0,
        "basis": {
            "loans_used": kinds["LOAN"],
            "wishlist_used": kinds["WISHLIST"],
            "ratings_used": kinds["REVIEW"],
            "loans_status": reader_payloads.get("loans_status"),
            "global_interactions": global_interactions,
            "candidate_pool": result["pool_size"],
        },
        "semantic_used": bool(profile["centroid"]),
        "semantic_method": "tfidf",
        "model": "v2",
    }


def llm_profile_summary(profile: dict) -> dict:
    """Categories/authors for the reason prompt, in the shape the V1 prompt reads."""
    return {"categories": dict(profile.get("categories") or {}), "authors": dict(profile.get("authors") or {})}
