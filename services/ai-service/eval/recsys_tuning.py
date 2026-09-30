"""Weight / hyperparameter selection for Recommendation V2 on a VALIDATION window.

Deterministic coordinate ascent over fixed grids: for each hyperparameter, then
each feature weight (fixed order), try every grid value and keep a change only
if it strictly improves validation NDCG@10; repeat until a full pass changes
nothing (or `passes` is reached). Ties keep the current value, so the result
does not depend on floating-point noise.

tune() refuses interactions at or after the validation window end - the test
window is not even present in what the tuner receives.

Features are divided by their standard deviation on the tuning matrix
(`feature_scale`), so one grid serves features with very different ranges and a
weight reads as "score per one SD of this signal". The scale is stored with the
weights and reused unchanged at test time and in production.
"""
from __future__ import annotations

import heapq
import math

import recommendation_v2 as v2
from recsys_protocol import per_user_metrics

WEIGHT_GRID = (0.0, 0.1, 0.25, 0.5, 1.0, 1.5, 2.0, 3.0)
PARAM_GRID = {
    "prior_strength": (1.0, 3.0, 10.0),
    "half_life_days": (None, 90, 180),
    "cf_shrinkage": (0.0, 10.0, 50.0),
    "wishlist_weight": (0.5, 1.0, 2.0),
    "liked_rating_weight": (0.0, 1.0, 2.0),
    "trend_window_days": (30, 90),
}
OBJECTIVE = "ndcg@10"
FEATURE_INDEX = {name: i for i, name in enumerate(v2.FEATURES)}


class Harness:
    """Feature matrices for the users of one split, cached per hyperparameter set.
    Only history before split['cutoff'] reaches the features (v2 enforces it)."""

    def __init__(self, catalog, interactions, split, availability, use_pool=True, max_cache=24, new_books=None,
                 production_exclusions=True):
        self.catalog = catalog
        self.new_books = new_books
        # False = exclude only what the split's protocol calls "seen" (legacy comparison),
        # instead of V2's own business rules (active wishlist / reservation at the cutoff).
        self.production_exclusions = production_exclusions
        self.interactions = interactions
        self.split = split
        self.availability = availability
        self.use_pool = use_pool
        self.by_user: dict[str, list[dict]] = {}
        for r in interactions:
            if r["at"] < split["cutoff"]:
                self.by_user.setdefault(r["user"], []).append(r)
        self._cache: dict[tuple, dict] = {}
        self._max_cache = max_cache
        self.last_model = None

    def matrix(self, params: dict) -> dict:
        key = tuple(sorted((k, params.get(k)) for k in v2.DEFAULT_PARAMS))
        if key in self._cache:
            return self._cache[key]
        model = v2.build_global_model(self.catalog, self.interactions, self.split["cutoff"], params)
        self.last_model = model
        users = {}
        for uid, x in self.split["users"].items():
            profile = v2.build_user_profile(self.by_user.get(uid, []), model)
            rule = profile if self.production_exclusions else {**profile, "seen": set()}
            books = [b for b in v2.eligible_books(self.catalog, rule) if v2.book_key(b) not in x["seen"]]
            feats = {v2.book_key(b): v2.feature_vector(b, profile, model, self.availability.get(v2.book_key(b))) for b in books}
            v2.impute_new_books(feats, v2.new_book_ids(self.catalog, model) if self.new_books is None else self.new_books)
            pool = v2.candidate_pool(books, feats, model["params"]["per_source_k"] if self.use_pool else None)
            keys = sorted(pool)
            users[uid] = {
                "keys": keys,
                "rows": [tuple(feats[k][f] for f in v2.FEATURES) for k in keys],
                "profile_signals": profile["signal_count"],
                "pool": pool,
            }
        entry = {"users": users, "scale": _scale(users), "model": model}
        if len(self._cache) >= self._max_cache:
            self._cache.pop(next(iter(self._cache)))
        self._cache[key] = entry
        return entry

    def rankings(self, params, weights, scale=None, max_per_category=None, new_arrival=None) -> dict[str, list[str]]:
        """`new_arrival` = (new_book_ids, limit, slots) applies v2.apply_new_arrival_slot."""
        m = self.matrix(params)
        scale = scale or m["scale"]
        w = [weights.get(f, 0.0) / (scale.get(f) or 1.0) for f in v2.FEATURES]
        by_id = m["model"]["by_id"]
        out = {}
        for uid, u in m["users"].items():
            scored = sorted(
                ((sum(wi * fi for wi, fi in zip(w, row)), k) for k, row in zip(u["keys"], u["rows"])),
                key=lambda s: (-s[0], s[1]),
            )
            ranked = [k for _, k in scored]
            if max_per_category:
                entries = [{"book": by_id[k], "book_id": k} for k in ranked]
                ranked = [e["book_id"] for e in v2.apply_category_cap(entries, max_per_category)]
            if new_arrival:
                new_ids, limit, slots = new_arrival
                entries = [{"book_id": k, "features": {"new_book": k in new_ids}} for k in ranked]
                ranked = [e["book_id"] for e in v2.apply_new_arrival_slot(entries, limit, slots)]
            out[uid] = ranked
        return out

    def objective(self, params, weights, scale=None, k=10, max_per_category=None) -> float:
        m = self.matrix(params)
        scale = scale or m["scale"]
        users = self.split["users"]
        if max_per_category:
            ranks = self.rankings(params, weights, scale, max_per_category)
            vals = [per_user_metrics(ranks[u], users[u]["targets"], k)[OBJECTIVE] for u in users]
            return sum(vals) / len(vals) if vals else 0.0
        w = [weights.get(f, 0.0) / (scale.get(f) or 1.0) for f in v2.FEATURES]
        total = 0.0
        for uid, u in m["users"].items():
            top = heapq.nsmallest(
                k, ((-(sum(wi * fi for wi, fi in zip(w, row))), key) for key, row in zip(u["keys"], u["rows"])),
            )
            total += per_user_metrics([key for _, key in top], users[uid]["targets"], k)[OBJECTIVE]
        return total / len(m["users"]) if m["users"] else 0.0


def _scale(users: dict) -> dict[str, float]:
    n = 0
    s = [0.0] * len(v2.FEATURES)
    ss = [0.0] * len(v2.FEATURES)
    for u in users.values():
        for row in u["rows"]:
            n += 1
            for i, v in enumerate(row):
                s[i] += v
                ss[i] += v * v
    scale = {}
    for name, i in FEATURE_INDEX.items():
        if n < 2:
            scale[name] = 1.0
            continue
        var = max(0.0, ss[i] / n - (s[i] / n) ** 2)
        scale[name] = math.sqrt(var) if var > 1e-12 else 1.0
    return scale


def tune(harness: Harness, fixed_zero=(), fixed_params=None, start=None, passes=4, log=None) -> dict:
    """Coordinate ascent on validation NDCG@10. `fixed_zero` features keep weight 0
    (ablations); `fixed_params` are not searched."""
    split_end = harness.split["end"]
    if any(r["at"] >= split_end for r in harness.interactions):
        raise ValueError("tuning data contains interactions at/after the validation window end")
    fixed_params = dict(fixed_params or {})
    weights = dict((start or {}).get("weights") or v2.DEFAULT_WEIGHTS)
    for f in fixed_zero:
        weights[f] = 0.0
    params = {**v2.DEFAULT_PARAMS, **((start or {}).get("params") or {}), **fixed_params}
    best = harness.objective(params, weights)
    trace = [{"step": "start", "objective": round(best, 5)}]
    evaluations = 1
    for p in range(passes):
        improved = False
        for name, grid in PARAM_GRID.items():
            if name in fixed_params:
                continue
            for value in grid:
                if value == params.get(name):
                    continue
                trial = {**params, name: value}
                score = harness.objective(trial, weights)
                evaluations += 1
                if score > best + 1e-9:
                    best, params, improved = score, trial, True
                    trace.append({"pass": p + 1, "param": name, "value": value, "objective": round(best, 5)})
        for name in v2.FEATURES:
            if name in fixed_zero:
                continue
            for value in WEIGHT_GRID:
                if value == weights.get(name):
                    continue
                trial = {**weights, name: value}
                score = harness.objective(params, trial)
                evaluations += 1
                if score > best + 1e-9:
                    best, weights, improved = score, trial, True
                    trace.append({"pass": p + 1, "weight": name, "value": value, "objective": round(best, 5)})
        if log:
            log(f"  pass {p + 1}: validation {OBJECTIVE}={best:.4f}")
        if not improved:
            break
    return {
        "weights": weights,
        "params": params,
        "feature_scale": harness.matrix(params)["scale"],
        "validation_objective": round(best, 5),
        "objective": OBJECTIVE,
        "evaluations": evaluations,
        "trace": trace,
    }
