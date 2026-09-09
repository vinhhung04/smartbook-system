"""Shared numeric-value matching: extracting numbers from Vietnamese/English
text, and testing whether one number is grounded in a set of others within a
tolerance.

Used by both the production anti-hallucination check
(rag.verify_numeric_grounding, called from /chat and /assistant) and the
answer-quality eval's stricter measurement (eval/scoring.py's
hallucinated_numbers). Before this module, production did digit-substring
matching over a JSON dump truncated to 9000 characters while the eval used a
proper value-and-tolerance comparison over the full payload -
eval/README.md documented this gap as a deliberate, deferred decision:
"If a future run shows its false-positive/negative rate diverging badly
from the production warning, that's the evidence to justify changing the
production function." The 62.5% number-recall / 26.7% hallucinated-number
result in the 2026-09-08 run (assistant_answers_20260908_180847.md) is that
evidence - both now share this one implementation.
"""
from __future__ import annotations

import re

_NUMBER_TOKEN_RE = re.compile(r"\d[\d.,]*\d|\d")


def parse_number_candidates(text: str | None) -> list[list[float]]:
    """Like parse_numbers, but keeps each digit token's interpretations
    grouped together instead of flattening them into one list.

    Vietnamese and English disagree on which of '.'/',' is the decimal point
    ("50.000đ" = fifty thousand in VN convention, "163.4" = one hundred
    sixty-three point four in EN convention) and generated prose mixes both
    unpredictably, so each token is parsed under BOTH conventions. Grouping
    matters when checking whether an answer's number is grounded: "500.000"
    also parses as 500.0 under the EN convention, and that unintended second
    reading must not be checked for grounding independently of its sibling -
    a token should only count as unverified when NONE of its own
    interpretations match, not when one of two happens not to.
    """
    groups: list[list[float]] = []
    for token in _NUMBER_TOKEN_RE.findall(text or ""):
        candidates: list[float] = []
        seen: set[float] = set()
        for candidate_text in (
            token.replace(",", ""),  # ',' = thousands sep, '.' = decimal point
            token.replace(".", "").replace(",", "."),  # '.' = thousands sep, ',' = decimal point
        ):
            try:
                value = float(candidate_text)
            except ValueError:
                continue
            if value not in seen:
                seen.add(value)
                candidates.append(value)
        if candidates:
            groups.append(candidates)
    return groups


def parse_numbers(text: str | None) -> list[float]:
    """Extracts every plausible numeric value from Vietnamese/English text as
    one flat, deduplicated list - the right shape when the caller just needs
    a pool of numbers to check *other* values against (e.g. "is 27 grounded
    somewhere in this JSON dump"). For checking whether an ANSWER's own
    numbers are grounded, use parse_number_candidates instead - see its
    docstring for why flattening there causes false positives.
    """
    numbers: list[float] = []
    seen: set[float] = set()
    for group in parse_number_candidates(text):
        for value in group:
            if value not in seen:
                seen.add(value)
                numbers.append(value)
    return numbers


def numbers_match(value: float, candidates: list[float], tolerance: float = 0.01) -> bool:
    """True if `value` is within `tolerance` of any of `candidates`.
    `tolerance` in (0, 1) is a relative tolerance (fraction of `value`);
    otherwise (e.g. 0, or >= 1) it's an absolute tolerance."""
    allowed = tolerance * abs(value) if 0 < tolerance < 1 else tolerance
    allowed = max(allowed, 1e-9)
    return any(abs(value - c) <= allowed for c in candidates)


def display_number(value: float) -> str:
    """Plain display for a flagged number in a warning message - "27" not
    "27.0" for a whole value, matching how a person would write it."""
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value)
