"""Temporal evaluation protocol for book recommendation (synthetic dataset).

    history < cutoff  ->  model  ->  ranked list  ->  scored against loans in [cutoff, end)

Two protocols:
  legacy  - exactly what prisma/simulation/evaluation.js did (kept for parity with
            simulation-report.json): wishlists are the END-of-window survivors.
  audited - point-in-time: the wishlist as it stood at the cutoff (rows removed
            later still count, rows removed earlier do not), and books under an
            active reservation at the cutoff are "seen" (not recommendable, not
            valid targets), like books already borrowed/wishlisted/rated.

Metrics are a port of evaluation.js rankingMetrics (HR/Recall/NDCG@K, MRR,
coverage, personalization) plus novelty, popularity bias, intra-list diversity,
per-user values and a paired bootstrap.
"""
from __future__ import annotations

import math
import random

import recommendation_v2 as v2

PROTOCOLS = ("legacy", "audited")


# ── Splits ───────────────────────────────────────────────────────────────────

def loan_time_quantile(interactions: list[dict], q: float) -> float:
    """Same rule as evaluation.js: the time by which a fraction q of loan items happened."""
    times = sorted(r["at"] for r in interactions if r["kind"] == "LOAN")
    if not times:
        raise ValueError("no loan interactions")
    return times[min(len(times) - 1, int(math.floor(len(times) * q)))]


def seen_at(user_rows: list[dict], cutoff: float, protocol: str) -> set[str]:
    seen = set()
    for r in user_rows:
        if r["at"] >= cutoff:
            continue
        if r["kind"] in ("LOAN", "REVIEW"):
            seen.add(r["book_id"])
        elif r["kind"] == "WISHLIST":
            visible = r["until"] is None if protocol == "legacy" else v2.active_at(r, cutoff)
            if visible:
                seen.add(r["book_id"])
        elif r["kind"] == "RESERVATION" and protocol == "audited" and v2.active_at(r, cutoff):
            seen.add(r["book_id"])
    return seen


def make_split(interactions: list[dict], cutoff: float, end: float, protocol: str = "audited") -> dict:
    """Users with >=1 target in [cutoff, end). `train_loans` = loan items before the
    cutoff (evaluation.js eligibility counts items, duplicates included)."""
    if protocol not in PROTOCOLS:
        raise ValueError(protocol)
    by_user: dict[str, list[dict]] = {}
    for r in interactions:
        if r["at"] < end:
            by_user.setdefault(r["user"], []).append(r)
    users = {}
    for uid in sorted(by_user):
        rows = by_user[uid]
        seen = seen_at(rows, cutoff, protocol)
        targets = {r["book_id"] for r in rows if r["kind"] == "LOAN" and cutoff <= r["at"] < end and r["book_id"] not in seen}
        if not targets:
            continue
        users[uid] = {
            "seen": seen,
            "targets": targets,
            "train_loans": sum(1 for r in rows if r["kind"] == "LOAN" and r["at"] < cutoff),
        }
    return {"cutoff": cutoff, "end": end, "protocol": protocol, "users": users}


def segment(split: dict, lo: int, hi: int | None = None) -> dict:
    """Users with lo <= train_loans (<= hi)."""
    users = {
        u: x for u, x in split["users"].items()
        if x["train_loans"] >= lo and (hi is None or x["train_loans"] <= hi)
    }
    return {**split, "users": users}


# ── Point-in-time availability ───────────────────────────────────────────────

def availability_at(catalog: list[dict], copies: dict[str, int], interactions: list[dict], t: float) -> dict[str, float]:
    """1.0 if some variant of the book has a free copy at time t, else 0.0.
    Copies held = loans and reservations whose [at, until) interval contains t -
    a state the live system can observe at t."""
    held: dict[str, int] = {}
    for r in interactions:
        if r["kind"] in ("LOAN", "RESERVATION") and r.get("variant_id") and v2.active_at(r, t):
            held[r["variant_id"]] = held.get(r["variant_id"], 0) + 1
    out = {}
    for b in catalog:
        free = any(int(copies.get(vid, 0)) - held.get(vid, 0) > 0 for vid in b.get("variant_ids") or [])
        out[v2.book_key(b)] = 1.0 if free else 0.0
    return out


# ── Metrics ──────────────────────────────────────────────────────────────────

def per_user_metrics(ranked: list[str], targets: set[str], k: int) -> dict:
    top = ranked[:k]
    rel = [1 if b in targets else 0 for b in top]
    hits = sum(rel)
    dcg = sum(r / math.log2(i + 2) for i, r in enumerate(rel))
    idcg = sum(1 / math.log2(i + 2) for i in range(min(k, len(targets))))
    first = next((i for i, b in enumerate(ranked) if b in targets), None)
    return {
        f"hit_rate@{k}": 1.0 if hits else 0.0,
        f"recall@{k}": hits / len(targets),
        f"ndcg@{k}": dcg / idcg if idcg else 0.0,
        "mrr": 1 / (first + 1) if first is not None else 0.0,
    }


def ranking_metrics(rankings: dict[str, list[str]], split: dict, catalog_size: int, k: int) -> dict:
    users = [u for u in split["users"] if u in rankings]
    n = len(users)
    if not n:
        return {"users": 0}
    sums: dict[str, float] = {}
    recommended = set()
    lists = []
    for u in users:
        m = per_user_metrics(rankings[u], split["users"][u]["targets"], k)
        for key, value in m.items():
            sums[key] = sums.get(key, 0.0) + value
        top = rankings[u][:k]
        lists.append(set(top))
        recommended.update(top)
    return {
        "users": n,
        **{key: r4(value / n) for key, value in sums.items()},
        f"catalog_coverage@{k}": r4(len(recommended) / catalog_size),
        f"personalization@{k}": r4(personalization(lists)),
    }


def personalization(lists: list[set[str]]) -> float | None:
    """1 - mean pairwise Jaccard overlap of the top-K lists."""
    overlap = 0.0
    pairs = 0
    for i in range(len(lists)):
        a = lists[i]
        for j in range(i + 1, len(lists)):
            b = lists[j]
            inter = len(a & b)
            union = len(a) + len(b) - inter
            overlap += inter / (union or 1)
            pairs += 1
    return 1 - overlap / pairs if pairs else None


def beyond_accuracy(rankings: dict[str, list[str]], split: dict, popularity: dict[str, int],
                    category_of: dict[str, str], catalog_keys: list[str], k: int = 10) -> dict:
    """Novelty = mean self-information -log2 p(b) of recommended books (p from train
    popularity, add-one); popularity bias = mean train-popularity percentile of
    recommended books (1 = most borrowed); diversity = mean Gini-Simpson index over
    categories inside each top-K list."""
    total = sum(popularity.get(b, 0) for b in catalog_keys) + len(catalog_keys)
    ordered = sorted(catalog_keys, key=lambda b: (popularity.get(b, 0), b))
    percentile = {b: (i + 1) / len(ordered) for i, b in enumerate(ordered)}
    novelty = bias = diversity = 0.0
    n = 0
    for u in split["users"]:
        top = rankings.get(u, [])[:k]
        if not top:
            continue
        novelty += sum(-math.log2((popularity.get(b, 0) + 1) / total) for b in top) / len(top)
        bias += sum(percentile.get(b, 0.0) for b in top) / len(top)
        counts: dict[str, int] = {}
        for b in top:
            counts[category_of.get(b, "")] = counts.get(category_of.get(b, ""), 0) + 1
        diversity += 1 - sum((c / len(top)) ** 2 for c in counts.values())
        n += 1
    if not n:
        return {}
    return {
        f"novelty@{k}": r4(novelty / n),
        f"popularity_bias_arp@{k}": r4(bias / n),
        f"category_diversity@{k}": r4(diversity / n),
    }


def per_user_vector(rankings: dict[str, list[str]], split: dict, metric: str, k: int) -> dict[str, float]:
    return {
        u: per_user_metrics(rankings.get(u, []), x["targets"], k)[metric]
        for u, x in split["users"].items()
    }


def bootstrap_ci(values: list[float], resamples: int = 1000, seed: int = 20260930, level: float = 0.95) -> dict:
    if not values:
        return {"mean": None, "low": None, "high": None, "n": 0}
    rng = random.Random(seed)
    n = len(values)
    means = sorted(sum(values[rng.randrange(n)] for _ in range(n)) / n for _ in range(resamples))
    lo = means[int((1 - level) / 2 * resamples)]
    hi = means[min(resamples - 1, int((1 + level) / 2 * resamples))]
    return {"mean": r4(sum(values) / n), "low": r4(lo), "high": r4(hi), "n": n}


def paired_bootstrap(a: dict[str, float], b: dict[str, float], **kwargs) -> dict:
    """CI of mean(a - b) over the same users (resampling users, keeping pairs)."""
    users = sorted(set(a) & set(b))
    diffs = [a[u] - b[u] for u in users]
    out = bootstrap_ci(diffs, **kwargs)
    out["wins"] = sum(1 for d in diffs if d > 0)
    out["losses"] = sum(1 for d in diffs if d < 0)
    out["ties"] = sum(1 for d in diffs if d == 0)
    return out


def quartiles(values: list[float]) -> dict:
    if not values:
        return {}
    s = sorted(values)
    q = lambda p: s[min(len(s) - 1, int(p * (len(s) - 1)))]  # noqa: E731
    return {"min": r4(s[0]), "q1": r4(q(0.25)), "median": r4(q(0.5)), "q3": r4(q(0.75)), "max": r4(s[-1]),
            "share_zero": r4(sum(1 for v in s if v == 0) / len(s))}


def r4(x):
    return None if x is None or (isinstance(x, float) and math.isnan(x)) else round(float(x), 4)
