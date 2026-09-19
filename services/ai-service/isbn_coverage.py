"""Deterministic field-coverage analysis for ISBN Intelligence.

Pure functions over the output of main._build_isbn_intelligence(); no I/O and no
import of main.py, so it can be unit tested without the service's dependencies.
Field status is derived only from source reliability / agreement / conflicts
already computed there - never from a model-generated score.
"""
from __future__ import annotations

# Smart ISBN Intelligence is deliberately deterministic.  These weights describe
# source reliability, while agreement is calculated from the responses received
# for this ISBN; no model-generated score is used for catalog metadata.
ISBN_SOURCE_ORDER = ["googleBooks", "openLibrary", "worldCat", "fahasa", "tiki", "vinabook", "webSearch"]
ISBN_INTELLIGENCE_FIELDS = (
    "title", "subtitle", "authors", "publisher", "publishedDate", "description",
    "categories", "language", "pageCount", "thumbnail",
)
ISBN_QUALITY_WEIGHTS = {
    "title": 2.0, "authors": 2.0, "publisher": 1.0, "publishedDate": 1.0,
    "description": 1.5, "categories": 0.5, "language": 0.5, "pageCount": 1.0,
    "thumbnail": 0.5,
}

# weight >= 2.0 -> critical, 1.0-1.5 -> high, 0.5 -> supporting. Only critical and
# high-value gaps justify a provider call; supporting fields are filled "for free"
# when a provider is already being called for another reason.
FIELD_TIERS = {
    "title": "critical", "authors": "critical",
    "publisher": "high", "publishedDate": "high", "description": "high", "pageCount": "high",
    "categories": "supporting", "language": "supporting", "thumbnail": "supporting",
}
# Free text differs between providers even when both are right, so it can never
# be "conflicted"; only these atomic facts can.
FACTUAL_FIELDS = frozenset({"title", "authors", "publisher", "publishedDate", "pageCount"})

LOW_CONFIDENCE_THRESHOLD = 0.70
MIN_DESCRIPTION_CHARS = 80  # same floor as main._check_book_quality


def _is_empty(value) -> bool:
    return not value if isinstance(value, list) else value in (None, "")


def classify_field(field: str, evidence: dict, confidence: float) -> dict:
    """MISSING > CONFLICTED > LOW_CONFIDENCE > SUFFICIENT."""
    if evidence.get("selectedSource") is None or _is_empty(evidence.get("selectedValue")):
        return {"status": "MISSING", "reason": None}

    conflict_count = (evidence.get("selectionReason") or {}).get("conflictCount", 0)
    if field in FACTUAL_FIELDS and conflict_count > 0:
        return {"status": "CONFLICTED", "reason": "SOURCES_DISAGREE"}

    if confidence < LOW_CONFIDENCE_THRESHOLD:
        return {"status": "LOW_CONFIDENCE", "reason": "LOW_CONFIDENCE"}

    if field == "description" and len(str(evidence["selectedValue"]).strip()) < MIN_DESCRIPTION_CHARS:
        return {"status": "LOW_CONFIDENCE", "reason": "SHORT_DESCRIPTION"}

    return {"status": "SUFFICIENT", "reason": None}


def analyze_field_coverage(intelligence: dict) -> dict:
    """Coverage over the weighted fields (subtitle is optional and ignored)."""
    evidence = intelligence.get("fieldEvidence") or {}
    confidence = intelligence.get("fieldConfidence") or {}

    field_status: dict[str, str] = {}
    missing, low_confidence, conflicted, gaps = [], [], [], []
    tier_found = {tier: 0 for tier in ("critical", "high", "supporting")}
    tier_total = dict(tier_found)
    found_weight = 0.0

    for field in ISBN_INTELLIGENCE_FIELDS:
        if field not in ISBN_QUALITY_WEIGHTS:
            continue
        tier = FIELD_TIERS[field]
        verdict = classify_field(field, evidence.get(field) or {}, confidence.get(field, 0.0))
        status = verdict["status"]
        field_status[field] = status
        tier_total[tier] += 1
        if status != "MISSING":
            tier_found[tier] += 1
            found_weight += ISBN_QUALITY_WEIGHTS[field]

        if status == "MISSING":
            missing.append(field)
        elif status == "LOW_CONFIDENCE":
            low_confidence.append(field)
        elif status == "CONFLICTED":
            conflicted.append(field)

        if status != "SUFFICIENT" and tier != "supporting":
            gaps.append({
                "field": field, "status": status, "reason": verdict["reason"],
                "tier": tier, "weight": ISBN_QUALITY_WEIGHTS[field],
            })

    total_fields = sum(tier_total.values())
    found_fields = sum(tier_found.values())
    total_weight = sum(ISBN_QUALITY_WEIGHTS.values())
    return {
        "fieldStatus": field_status,
        "missingFields": missing,
        "lowConfidenceFields": low_confidence,
        "conflictedFields": conflicted,
        "coverage": {
            "foundFields": found_fields,
            "totalFields": total_fields,
            "ratio": round(found_fields / total_fields, 3) if total_fields else 0.0,
            "weightedRatio": round(found_weight / total_weight, 3) if total_weight else 0.0,
            "byTier": {tier: {"found": tier_found[tier], "total": tier_total[tier]} for tier in tier_total},
        },
        "worthCallingGaps": gaps,
        "needsEnrichment": bool(gaps),
    }
