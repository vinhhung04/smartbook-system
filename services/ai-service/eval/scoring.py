"""Scoring helpers for the labeled ISBN-extraction and assistant tool-selection
evals. Pure functions - no I/O, no imports from main.py - so they are unit
tested directly (see ../test_eval_scoring.py) and reused by both
eval_isbn_extraction.py and eval_assistant_tools.py.
"""
from __future__ import annotations

import json
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


# ─────────────────────────────────────────────────────────────────────────────
# Answer-quality scoring (eval_assistant_answers.py). Everything below is
# deterministic - no LLM judge - which is what makes it defensible as a
# thesis metric: the same answer text always scores the same way.
# ─────────────────────────────────────────────────────────────────────────────

_NUMBER_TOKEN_RE = re.compile(r"\d[\d.,]*\d|\d")


def parse_numbers(text: str | None) -> list[float]:
    """Extracts every plausible numeric value from Vietnamese/English text.

    Vietnamese and English disagree on which of '.'/',' is the decimal point
    ("50.000đ" = fifty thousand in VN convention, "163.4" = one hundred
    sixty-three point four in EN convention) and an LLM's generated prose
    mixes both unpredictably. Rather than guess, each digit token is parsed
    under BOTH conventions and every distinct result is kept - so a
    comparison against this list only needs any one interpretation to match,
    trading a little precision (a token can yield a spurious second value)
    for not silently missing genuine matches under the "wrong" convention.
    """
    numbers: list[float] = []
    seen: set[float] = set()
    for token in _NUMBER_TOKEN_RE.findall(text or ""):
        candidates = set()
        try:
            candidates.add(float(token.replace(",", "")))  # ',' = thousands sep, '.' = decimal point
        except ValueError:
            pass
        try:
            candidates.add(float(token.replace(".", "").replace(",", ".")))  # '.' = thousands sep, ',' = decimal point
        except ValueError:
            pass
        for value in candidates:
            if value not in seen:
                seen.add(value)
                numbers.append(value)
    return numbers


def _numbers_match(value: float, candidates: list[float], tolerance: float) -> bool:
    allowed = tolerance * abs(value) if 0 < tolerance < 1 else tolerance
    allowed = max(allowed, 1e-9)
    return any(abs(value - c) <= allowed for c in candidates)


def number_recall(answer: str, required: list[dict]) -> dict:
    """`required`: [{"field": "<label>", "expected": <number|None>, "tolerance": <float>}].
    `expected` must already be resolved to a concrete number by the caller
    (eval_assistant_answers.py resolves it from the real tool result at run
    time) - this function only compares numbers, it knows nothing about tool
    result shapes. An entry with `expected: None` (the field could not be
    resolved this run, e.g. an empty list) is skipped, not counted as a miss."""
    parsed = parse_numbers(answer)
    matched, missing = [], []
    for item in required:
        expected = item.get("expected")
        if expected is None:
            continue
        if _numbers_match(float(expected), parsed, item.get("tolerance", 0)):
            matched.append(item["field"])
        else:
            missing.append(item["field"])
    total = len(matched) + len(missing)
    return {"matched": matched, "missing": missing, "recall": (len(matched) / total) if total else None}


def fact_recall(answer: str, required_facts: list[list[str]]) -> dict:
    """Each entry in `required_facts` is a list of accepted surface forms for
    one fact - present if ANY form appears in the (accent/case-normalized)
    answer. Reuses normalize_for_match, same as the ISBN-extraction scoring
    above."""
    normalized_answer = normalize_for_match(answer)
    matched, missing = [], []
    for forms in required_facts:
        label = forms[0] if forms else ""
        if any(normalize_for_match(form) in normalized_answer for form in forms):
            matched.append(label)
        else:
            missing.append(label)
    total = len(matched) + len(missing)
    return {"matched": matched, "missing": missing, "recall": (len(matched) / total) if total else None}


def forbidden_hits(answer: str, forbidden: list[str]) -> list[str]:
    """Surface forms that should NEVER appear in a correct answer (hallucination
    probes: an entity that doesn't exist in the data)."""
    normalized_answer = normalize_for_match(answer)
    return [phrase for phrase in (forbidden or []) if normalize_for_match(phrase) in normalized_answer]


_REFUSAL_PHRASES = [
    "khong the tra loi", "ngoai pham vi", "khong ho tro", "khong the ho tro",
    "khong co du lieu", "chua co du lieu", "tu choi", "khong the giup",
    "khong lien quan", "khong phai la",
]


def refusal_verdict(answer: str, tools_used: list[str], must_refuse: bool) -> dict:
    """A refusal is only "clean" if the model both wrote refusal-shaped text
    AND backed that up behaviourally - no tool called, no number invented.
    Saying "I can't help with that" while still quoting a number would be a
    contradiction, not a real refusal."""
    if not must_refuse:
        return {"correct": True, "reason": "no refusal required"}

    normalized = normalize_for_match(answer)
    looks_like_refusal = any(phrase in normalized for phrase in _REFUSAL_PHRASES)
    if not looks_like_refusal:
        return {"correct": False, "reason": "answered instead of refusing"}
    if tools_used:
        return {"correct": False, "reason": "called a tool despite refusing"}
    if parse_numbers(answer):
        return {"correct": False, "reason": "refusal text still contains a number"}
    return {"correct": True, "reason": "refused cleanly"}


def citation_verdict(answer: str, evidence: list, must_cite: bool) -> dict:
    """For /assistant the citation surface is the `evidence` array; a
    "Nguồn dữ liệu:" line in the text is accepted too (the /chat surface, or
    an /assistant answer that happens to include one)."""
    if not must_cite:
        return {"correct": True, "reason": "no citation required"}
    has_citation = bool(evidence) or "nguon du lieu" in normalize_for_match(answer)
    return {"correct": has_citation, "reason": "cited" if has_citation else "missing citation/evidence"}


def hallucinated_numbers(
    answer: str, tool_results: dict, question: str | None = None, tolerance: float = 0.01
) -> list[float]:
    """Numbers in `answer` matching no value anywhere in the FULL tool_results
    payload. Stricter than rag.verify_numeric_grounding: value-and-tolerance
    based rather than digit-substring matching, and it sees the whole
    payload rather than a 9000-char truncated slice - this is the real
    anti-fabrication measurement for the thesis, not the production
    endpoints' best-effort advisory warning.

    `question` is optional but should always be passed by callers that have
    it: a number the user supplied in their own question (e.g. "30 ngày qua",
    "7 ngày gần đây") and the model simply echoes back is not a fabrication -
    without this, two questions in the 2026-09-08 answer-quality run
    (`assistant_answers_20260908_180847.md`) were flagged for exactly this
    reason despite passing every other check. A plain digit-echo is the only
    case handled here; a value the model correctly *derives* from payload
    numbers (a percentage, a sum, a rounded figure) still cannot be verified
    by this function and is intentionally left flagged - that is a real
    measurement limitation, not something to special-case away without
    evidence it's actually happening for a given answer."""
    answer_numbers = parse_numbers(answer)
    if not answer_numbers:
        return []
    payload_numbers = parse_numbers(json.dumps(tool_results, ensure_ascii=False, default=str))
    grounded_numbers = payload_numbers + parse_numbers(question)
    return [n for n in answer_numbers if not _numbers_match(n, grounded_numbers, tolerance)]


def score_answer(entry: dict, answer: str, tool_results: dict, tools_used: list[str], evidence: list) -> dict:
    """`entry["resolved_numbers"]` must already carry resolved `expected`
    values (see number_recall) - the runner is responsible for that, this
    function is pure and knows nothing about tool result shapes."""
    numbers = number_recall(answer, entry.get("resolved_numbers") or [])
    facts = fact_recall(answer, entry.get("required_facts") or [])
    forbidden = forbidden_hits(answer, entry.get("forbidden_facts") or [])
    refusal = refusal_verdict(answer, tools_used, entry.get("must_refuse", False))
    citation = citation_verdict(answer, evidence, entry.get("must_cite", False))
    hallucinated = hallucinated_numbers(answer, tool_results, entry.get("question"))

    overall_pass = (
        (numbers["recall"] is None or numbers["recall"] == 1.0)
        and (facts["recall"] is None or facts["recall"] == 1.0)
        and not forbidden
        and refusal["correct"]
        and citation["correct"]
    )
    return {
        "id": entry.get("id"),
        "question": entry.get("question"),
        "numbers": numbers,
        "facts": facts,
        "forbidden_hits": forbidden,
        "refusal": refusal,
        "citation": citation,
        "hallucinated_numbers": hallucinated,
        "overall_pass": overall_pass,
    }


def aggregate_answer_scores(verdicts: list[dict]) -> dict:
    total = len(verdicts)
    if not total:
        return {"total": 0}

    def _avg_recall(key: str) -> float | None:
        values = [v[key]["recall"] for v in verdicts if v[key]["recall"] is not None]
        return round(sum(values) / len(values), 3) if values else None

    citation_required = [v for v in verdicts if v["citation"]["reason"] != "no citation required"]
    refusal_required = [v for v in verdicts if v["refusal"]["reason"] != "no refusal required"]
    with_hallucination = sum(1 for v in verdicts if v["hallucinated_numbers"])

    return {
        "total": total,
        "number_recall": _avg_recall("numbers"),
        "fact_recall": _avg_recall("facts"),
        "citation_rate": (
            round(sum(1 for v in citation_required if v["citation"]["correct"]) / len(citation_required), 3)
            if citation_required else None
        ),
        "refusal_accuracy": (
            round(sum(1 for v in refusal_required if v["refusal"]["correct"]) / len(refusal_required), 3)
            if refusal_required else None
        ),
        "hallucinated_number_rate": round(with_hallucination / total, 3),
        "overall_pass_rate": round(sum(1 for v in verdicts if v["overall_pass"]) / total, 3),
    }
