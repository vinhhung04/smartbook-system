"""Paired statistics for the cover-search experiments (pure functions,
unit-tested in tests/test_statistics.py).

Queries are clustered: several queries can share one book (several independent
photos in Track A; several perturbations of one gallery image in Track B), so
they are NOT independent samples. Confidence intervals therefore come from a
cluster (book-level) bootstrap: resample books with replacement, keep all of a
book's queries together. McNemar's exact test is reported as a descriptive
query-level paired test with that caveat stated next to it.
"""
from __future__ import annotations

import math
import random
from collections import defaultdict

DEFAULT_RESAMPLES = 10_000
DEFAULT_SEED = 20261112


def _group(values: list[float], clusters: list[str]) -> list[list[float]]:
    groups: dict[str, list[float]] = defaultdict(list)
    for value, cluster in zip(values, clusters):
        groups[cluster].append(value)
    return list(groups.values())


def cluster_bootstrap_ci(values: list[float], clusters: list[str], resamples: int = DEFAULT_RESAMPLES,
                         seed: int = DEFAULT_SEED, alpha: float = 0.05) -> dict:
    """Mean of `values` with a percentile CI from resampling clusters."""
    if not values:
        return {"mean": float("nan"), "ci_low": float("nan"), "ci_high": float("nan"), "n": 0, "clusters": 0}
    groups = _group(values, clusters)
    rng = random.Random(seed)
    stats = []
    for _ in range(resamples):
        total = count = 0.0
        for _ in range(len(groups)):
            group = groups[rng.randrange(len(groups))]
            total += sum(group)
            count += len(group)
        stats.append(total / count)
    stats.sort()
    low = stats[int(math.floor(alpha / 2 * resamples))]
    high = stats[min(resamples - 1, int(math.ceil((1 - alpha / 2) * resamples)) - 1)]
    return {"mean": sum(values) / len(values), "ci_low": low, "ci_high": high,
            "n": len(values), "clusters": len(groups)}


def paired_difference_ci(a: list[float], b: list[float], clusters: list[str], **kwargs) -> dict:
    """CI of mean(b - a) under the cluster bootstrap (paired by query)."""
    diffs = [y - x for x, y in zip(a, b)]
    result = cluster_bootstrap_ci(diffs, clusters, **kwargs)
    return {"diff_mean": result["mean"], "ci_low": result["ci_low"], "ci_high": result["ci_high"],
            "n": result["n"], "clusters": result["clusters"]}


def mcnemar_exact(a_correct: list[bool], b_correct: list[bool]) -> dict:
    """Two-sided exact McNemar test on discordant pairs.
    b10 = A right & B wrong, b01 = A wrong & B right."""
    b10 = sum(1 for x, y in zip(a_correct, b_correct) if x and not y)
    b01 = sum(1 for x, y in zip(a_correct, b_correct) if y and not x)
    n = b10 + b01
    if n == 0:
        return {"b10": 0, "b01": 0, "p_value": 1.0, "discordant_odds_ratio": float("nan")}
    k = min(b10, b01)
    tail = sum(math.comb(n, i) for i in range(0, k + 1)) / (2 ** n)
    p_value = min(1.0, 2 * tail)
    odds = (b01 / b10) if b10 else float("inf")
    return {"b10": b10, "b01": b01, "p_value": p_value, "discordant_odds_ratio": odds}


def cohens_h(p1: float, p2: float) -> float:
    """Effect size for a difference between two proportions."""
    if any(math.isnan(p) for p in (p1, p2)):
        return float("nan")
    return 2 * math.asin(math.sqrt(p2)) - 2 * math.asin(math.sqrt(p1))
