"""Pure metric functions for the cover-search experiments (unit-tested in
tests/test_metrics.py). No I/O, no production imports.

Correctness is judged at BOOK level (catalog book id), which is what the
production endpoint returns and dedupes on; edition-level correctness is a
secondary metric available only when the visual branch fired.
"""
from __future__ import annotations

import math
import re
import unicodedata
from difflib import SequenceMatcher

FUZZY_THRESHOLD = 0.85


def rank_of(candidate_ids: list[str], target_id: str) -> int | None:
    """1-based rank of target in the returned list, None if absent."""
    for index, candidate in enumerate(candidate_ids, start=1):
        if candidate == target_id:
            return index
    return None


def recall_at_k(ranks: list[int | None], k: int) -> float:
    if not ranks:
        return float("nan")
    return sum(1 for r in ranks if r is not None and r <= k) / len(ranks)


def mean_reciprocal_rank(ranks: list[int | None]) -> float:
    if not ranks:
        return float("nan")
    return sum((1.0 / r) if r else 0.0 for r in ranks) / len(ranks)


def abstention_metrics(in_catalog_answered: list[bool], ooc_answered: list[bool]) -> dict:
    """'Positive' = the system abstains (match_found false).
    TP = out-of-catalog query abstained; FP = in-catalog query abstained;
    FN = out-of-catalog query answered (false accept)."""
    tp = sum(1 for answered in ooc_answered if not answered)
    fn = sum(1 for answered in ooc_answered if answered)
    fp = sum(1 for answered in in_catalog_answered if not answered)
    precision = tp / (tp + fp) if (tp + fp) else float("nan")
    recall = tp / (tp + fn) if (tp + fn) else float("nan")
    f1 = (2 * precision * recall / (precision + recall)
          if (tp + fn) and (tp + fp) and (precision + recall) else float("nan"))
    return {
        "no_match_precision": precision,
        "no_match_recall": recall,
        "no_match_f1": f1,
        "false_positive_rate": fn / len(ooc_answered) if ooc_answered else float("nan"),
        "false_abstention_rate": fp / len(in_catalog_answered) if in_catalog_answered else float("nan"),
        "tp": tp, "fp": fp, "fn": fn,
    }


def percentile(values: list[float], q: float) -> float:
    """Linear-interpolation percentile (numpy 'linear' method), q in [0, 100]."""
    clean = sorted(v for v in values if v is not None and not math.isnan(v))
    if not clean:
        return float("nan")
    if len(clean) == 1:
        return clean[0]
    position = (len(clean) - 1) * q / 100.0
    lower = math.floor(position)
    upper = math.ceil(position)
    if lower == upper:
        return clean[lower]
    return clean[lower] + (clean[upper] - clean[lower]) * (position - lower)


# ------------------------------------------------------------ text matching

def nfc(text: str | None) -> str:
    return unicodedata.normalize("NFC", (text or "").strip())


def normalize_title(text: str | None) -> str:
    """Matching key ONLY (raw values are always kept alongside): NFKD, drop
    combining marks, fold đ->d, casefold, '&'->'and', drop punctuation,
    collapse whitespace, drop a leading English article."""
    value = unicodedata.normalize("NFKD", text or "")
    value = "".join(ch for ch in value if unicodedata.category(ch) != "Mn")
    value = value.replace("đ", "d").replace("Đ", "D").casefold().replace("&", " and ")
    value = re.sub(r"[^\w\s]", " ", value)
    value = re.sub(r"\s+", " ", value).strip()
    value = re.sub(r"^(the|a|an) ", "", value)
    return value


def similarity(a: str | None, b: str | None) -> float:
    na, nb = normalize_title(a), normalize_title(b)
    if not na or not nb:
        return 0.0
    return SequenceMatcher(None, na, nb).ratio()


def title_scores(expected: str, predicted: str | None) -> dict:
    return {
        "exact_raw": bool(predicted) and nfc(expected) == nfc(predicted),
        "exact_normalized": bool(predicted) and normalize_title(expected) == normalize_title(predicted),
        "fuzzy": bool(predicted) and similarity(expected, predicted) >= FUZZY_THRESHOLD,
        "similarity": round(similarity(expected, predicted), 4),
    }


def author_scores(expected: str, predicted: str | None) -> dict:
    """Expected may list several people separated by ';'. Correct if the
    prediction matches any of them (normalized exact or fuzzy), or the
    prediction contains the normalized surname-bearing full name."""
    names = [name.strip() for name in (expected or "").split(";") if name.strip()]
    if not names:
        return {"exact_normalized": None, "fuzzy": None, "similarity": None}
    pred_norm = normalize_title(predicted)
    exact = bool(predicted) and any(normalize_title(name) == pred_norm for name in names)
    best = max(similarity(name, predicted) for name in names) if predicted else 0.0
    contains = bool(predicted) and any(normalize_title(name) and normalize_title(name) in pred_norm for name in names)
    return {"exact_normalized": exact, "fuzzy": exact or contains or best >= FUZZY_THRESHOLD,
            "similarity": round(best, 4)}
