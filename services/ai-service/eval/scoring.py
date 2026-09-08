"""Scoring helpers for the labeled ISBN-extraction and assistant tool-selection
evals. Pure functions - no I/O, no imports from main.py - so they are unit
tested directly (see ../test_eval_scoring.py) and reused by both
eval_isbn_extraction.py and eval_assistant_tools.py.
"""
from __future__ import annotations

import re
import unicodedata
from difflib import SequenceMatcher

# Below this ratio, two strings are considered different values rather than
# formatting/spelling variants of the same one.
DEFAULT_FUZZY_THRESHOLD = 0.85


def normalize_for_match(text: str | None) -> str:
    """Lowercase, strip accents/punctuation, collapse whitespace, so
    'Nguyễn Nhật Ánh' and 'nguyen nhat anh' compare equal despite differing
    only in how the provider encoded the name."""
    if not text:
        return ""
    decomposed = unicodedata.normalize("NFD", text)
    without_accents = "".join(ch for ch in decomposed if unicodedata.category(ch) != "Mn")
    cleaned = re.sub(r"[^a-z0-9\s]", " ", without_accents.lower())
    return re.sub(r"\s+", " ", cleaned).strip()


def fuzzy_ratio(a: str | None, b: str | None) -> float:
    na, nb = normalize_for_match(a), normalize_for_match(b)
    if not na or not nb:
        return 0.0
    return SequenceMatcher(None, na, nb).ratio()


def field_matches(expected: str | None, actual: str | None, threshold: float = DEFAULT_FUZZY_THRESHOLD) -> bool:
    """True if actual is a close-enough fuzzy match of expected. An empty
    expected value has nothing to check, so it always counts as matched; an
    empty actual against a non-empty expected is always a miss."""
    if not expected:
        return True
    if not actual:
        return False
    return fuzzy_ratio(expected, actual) >= threshold


def authors_match(expected: list[str], actual: list[str], threshold: float = DEFAULT_FUZZY_THRESHOLD) -> bool:
    """True if every expected author has a fuzzy match somewhere in actual.
    Order and extra actual authors (e.g. an illustrator the ground truth
    didn't list) don't count against the result."""
    if not expected:
        return True
    if not actual:
        return False
    return all(
        any(fuzzy_ratio(exp, act) >= threshold for act in actual)
        for exp in expected
    )


def year_matches(expected: int | None, actual_published_date: str | None) -> bool:
    """Providers return a free-form publishedDate ('2020', '2020-03-15', ...);
    only the 4-digit year is checked against the ground truth."""
    if not expected:
        return True
    if not actual_published_date:
        return False
    match = re.search(r"(\d{4})", str(actual_published_date))
    if not match:
        return False
    return int(match.group(1)) == int(expected)


def score_extraction_result(expected: dict, actual: dict) -> dict:
    """Field-by-field verdict for one ISBN lookup against its ground truth."""
    return {
        "isbn": expected.get("isbn13"),
        "title_match": field_matches(expected.get("title"), actual.get("title")),
        "authors_match": authors_match(expected.get("authors") or [], actual.get("authors") or []),
        "publisher_match": field_matches(expected.get("publisher"), actual.get("publisher")),
        "year_match": year_matches(expected.get("year"), actual.get("publishedDate")),
        "found": bool(actual.get("found")),
    }


def aggregate_extraction_scores(results: list[dict]) -> dict:
    total = len(results)
    if not total:
        return {"total": 0}
    found = sum(1 for r in results if r["found"])
    fields = ["title_match", "authors_match", "publisher_match", "year_match"]
    field_accuracy = {field: round(sum(1 for r in results if r[field]) / total, 3) for field in fields}
    all_fields_correct = sum(1 for r in results if all(r[field] for field in fields))
    return {
        "total": total,
        "found_rate": round(found / total, 3),
        "field_accuracy": field_accuracy,
        "all_fields_correct_rate": round(all_fields_correct / total, 3),
    }


def tool_selection_verdict(expected_tools: list[str], actual_tools: list[str]) -> dict:
    """Precision/recall for one labeled question. Tool *names* only - call
    arguments are not scored, since the same question can reasonably be
    phrased with slightly different parameters (e.g. different `days`)."""
    expected_set = set(expected_tools)
    actual_set = set(actual_tools)
    true_positive = len(expected_set & actual_set)
    precision = true_positive / len(actual_set) if actual_set else (1.0 if not expected_set else 0.0)
    recall = true_positive / len(expected_set) if expected_set else (1.0 if not actual_set else 0.0)
    return {
        "expected": sorted(expected_set),
        "actual": sorted(actual_set),
        "precision": round(precision, 3),
        "recall": round(recall, 3),
        "exact_match": expected_set == actual_set,
    }


def aggregate_tool_selection_scores(verdicts: list[dict]) -> dict:
    total = len(verdicts)
    if not total:
        return {"total": 0}
    exact = sum(1 for v in verdicts if v["exact_match"])
    return {
        "total": total,
        "exact_match_rate": round(exact / total, 3),
        "avg_precision": round(sum(v["precision"] for v in verdicts) / total, 3),
        "avg_recall": round(sum(v["recall"] for v in verdicts) / total, 3),
    }
