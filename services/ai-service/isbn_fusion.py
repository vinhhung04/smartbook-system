"""Field-level metadata Evidence Fusion for ISBN lookup.

Replaces main._build_isbn_intelligence()'s old selection rule - "take the
single highest-reliability source that answered this field" - with a fusion
that:

1. Normalizes each candidate value (accents/case/whitespace, publisher
   prefixes, author lists, dates, language codes) BEFORE comparing them, so
   "NXB Trẻ" and "Nhà Xuất Bản Trẻ" are recognized as the same value instead
   of a false conflict (Chức năng 2.5).
2. Groups (clusters) evidence into competing values per field, using a
   field-specific compatibility rule (exact match for most fields; subset
   compatibility for authors; numeric tolerance for pageCount; same-year
   compatibility for dates - Chức năng 2.9).
3. Scores each group's "support" with a noisy-OR combination of its members'
   reliability (source prior x extraction-method prior), discounting a
   second source from the same INDEPENDENCE_GROUPS bucket - two marketplaces
   that often mirror the same publisher-supplied data are not treated as two
   fully independent confirmations (Chức năng 2.7/2.8). A single source's
   support is exactly its own reliability - it is never boosted OR
   penalized for being alone; only genuine multi-source agreement raises
   confidence above what any one source offers.
4. Picks the strongest group as the field's value and expresses confidence as
   how much that group dominates the next-strongest one, capped at
   MAX_SUPPORT - "5 mirrored sites => 100% confidence" is exactly what this
   is meant to avoid (Chức năng 2.8).

Pure module (no I/O, no import of main.py) - unit tested directly in
test_isbn_fusion.py, same convention as isbn_coverage.py/isbn_targeted.py.
The output feeds main._build_isbn_intelligence(), which still owns turning
`confidence`/`conflictCount` into the canonical fieldStatus via
isbn_coverage.classify_field() - unchanged, so the existing MISSING/
CONFLICTED/LOW_CONFIDENCE/SUFFICIENT contract does not move.
"""
from __future__ import annotations

import re

from intent import normalize_text
from isbn_coverage import FACTUAL_FIELDS, _is_empty
from source_reliability import reliability as source_reliability_score

# Extraction-method reliability, independent of WHICH source produced it (a
# provider can supply evidence through more than one method - e.g. Fahasa via
# JSON-LD most of the time, via DOM scraping when CloakBrowser had to render
# the page). Ordered per Chức năng 2.4: structured API/JSON-LD > exact DOM
# field > regex/snippet text > LLM free-text inference.
METHOD_RELIABILITY = {
    "api_structured": 1.0,   # a provider's own JSON API response (Google Books, Open Library, WorldCat, Tiki, Vinabook)
    "json_ld": 1.0,          # schema.org structured markup embedded in an HTML page (Fahasa's default fetch)
    "dom": 0.9,              # a specific DOM field read after the page had to be rendered (Fahasa CloakBrowser path)
    "snippet_regex": 0.75,   # a labelled "Title | ISBN: ...; Tác giả: ...; Nhà XB: ..." pattern matched out of free text (web search)
    "llm_derived": 0.4,      # a value the LLM inferred from unstructured text, no direct structural anchor
}

# Fields where a value with NO non-LLM evidence at all must not be treated as
# found - "Evidence first, LLM second" (Chức năng 2.15). Not applied to
# description (an LLM rewrite of a description IS the product, tracked
# separately as aiSuggestions - see main._build_post_isbn_ai_suggestions) or to
# categories (an LLM classification suggestion, same reasoning).
NO_LLM_FIELDS = frozenset({"title", "authors", "publisher", "pageCount"})

# Two sources that tend to license/copy the same publisher-supplied metadata
# are not fully independent confirmations of each other (Chức năng 2.8) - a
# second source from the same group only gets SECONDARY_GROUP_DISCOUNT of its
# reliability when combined with a first from that group. Not a literal
# provenance graph (the prompt explicitly says not to build one), just a
# documented, coarse grouping of what this service's own providers are.
INDEPENDENCE_GROUPS = {
    "googleBooks": "bibliographic_api",
    "openLibrary": "bibliographic_api_commons",
    "worldCat": "bibliographic_api_commons",  # OL and WorldCat both aggregate library MARC/union-catalog records
    "fahasa": "vn_marketplace",
    "tiki": "vn_marketplace",
    "vinabook": "vn_marketplace",  # Vietnamese marketplaces frequently reuse the same publisher/distributor feed
    "webSearch": "web_search",
}
SECONDARY_GROUP_DISCOUNT = 0.5

# A second (disagreeing) group must reach at least this fraction of the
# winning group's support before the field is reported as a genuine conflict
# instead of a minority outlier (Chức năng 2.6/2.9's "don't silently
# overwrite" balanced against not flagging every single stray value as a
# conflict on par with the winner).
CONFLICT_RATIO = 0.5
MAX_SUPPORT = 0.97


def infer_method(source: str, source_fetch_mode: str | None = None) -> str:
    """Best-effort method inference from the source name (and, for Fahasa,
    the fetch mode main.py already records) when a caller doesn't pass
    extractionMethod explicitly."""
    if source == "webSearch":
        return "snippet_regex"
    if source == "fahasa":
        mode = str(source_fetch_mode or "httpx")
        return "dom" if "cloakbrowser" in mode else "json_ld"
    return "api_structured"


def _has_value(value) -> bool:
    return not _is_empty(value)


_PUBLISHER_PREFIXES = (
    "nha xuat ban", "nxb", "cong ty tnhh", "cong ty co phan", "publishing house", "publisher",
)


def _publisher_key(value: str) -> str:
    """"NXB Trẻ" / "Nhà Xuất Bản Trẻ" / "nxb tre" -> "tre". Only strips a
    recognized publisher-entity prefix - never touches the rest of the name,
    so "NXB Trẻ" and "NXB Kim Đồng" still land in different groups."""
    text = re.sub(r"[.,]", " ", normalize_text(value))
    text = re.sub(r"\s+", " ", text).strip()
    for prefix in _PUBLISHER_PREFIXES:
        if text == prefix:
            return ""
        if text.startswith(prefix + " "):
            return text[len(prefix):].strip()
    return text


def _author_set(value) -> frozenset[str]:
    items = value if isinstance(value, list) else [value]
    names: set[str] = set()
    for item in items:
        for part in re.split(r"[,;&]| va | and ", normalize_text(str(item or ""))):
            part = part.strip()
            if part:
                names.add(part)
    return frozenset(names)


def _date_year(value) -> str | None:
    match = re.match(r"^(\d{4})", str(value or "").strip())
    return match.group(1) if match else None


_LANGUAGE_ALIASES = {"vie": "vi", "vietnamese": "vi", "eng": "en", "english": "en"}


def _language_key(value) -> str:
    text = normalize_text(str(value or ""))
    return _LANGUAGE_ALIASES.get(text, text)


def _compatible(field: str, a, b) -> bool:
    """Whether two raw candidate values count as "the same value" for this
    field - see the module docstring for the per-field policy."""
    if field == "authors":
        set_a, set_b = _author_set(a), _author_set(b)
        return set_a == set_b or set_a.issubset(set_b) or set_b.issubset(set_a)
    if field == "pageCount":
        try:
            val_a, val_b = float(a), float(b)
        except (TypeError, ValueError):
            return a == b
        return abs(val_a - val_b) <= max(2.0, 0.01 * max(val_a, val_b))
    if field == "publisher":
        return _publisher_key(str(a)) == _publisher_key(str(b))
    if field == "publishedDate":
        year_a, year_b = _date_year(a), _date_year(b)
        return year_a is not None and year_a == year_b
    if field == "language":
        return _language_key(a) == _language_key(b)
    return normalize_text(str(a)) == normalize_text(str(b))


def _representative(field: str, cluster: list[dict]) -> object:
    """The single display value for a cluster that may hold several raw
    strings that all normalize the same way (e.g. "2008" and "2008-08-01")."""
    if field == "authors":
        return max(cluster, key=lambda e: (len(_author_set(e["value"])), _evidence_reliability(field, e)))["value"]
    if field == "publishedDate":
        return max(cluster, key=lambda e: (str(e["value"]).count("-"), _evidence_reliability(field, e)))["value"]
    return max(cluster, key=lambda e: _evidence_reliability(field, e))["value"]


def _evidence_reliability(field: str, evidence: dict) -> float:
    method = evidence.get("extractionMethod") or infer_method(evidence["source"])
    return source_reliability_score(evidence["source"], field) * METHOD_RELIABILITY.get(method, 0.65)


def _support(field: str, cluster: list[dict]) -> float:
    """Noisy-OR: P(at least one of these sources is right), discounting a
    second source sharing an INDEPENDENCE_GROUPS bucket with an earlier one.
    A single-member cluster's support is exactly its own reliability -
    1 - (1 - r) = r - so a lone source is neither boosted nor punished for
    being alone; only genuine corroboration from a second source raises it."""
    ordered = sorted(cluster, key=lambda e: -_evidence_reliability(field, e))
    seen_groups: set[str] = set()
    product = 1.0
    for evidence in ordered:
        group = INDEPENDENCE_GROUPS.get(evidence["source"], evidence["source"])
        discount = SECONDARY_GROUP_DISCOUNT if group in seen_groups else 1.0
        seen_groups.add(group)
        product *= 1.0 - min(1.0, _evidence_reliability(field, evidence) * discount)
    return min(1.0 - product, MAX_SUPPORT)


def _cluster(field: str, responses: list[dict]) -> list[list[dict]]:
    """Union-find over pairwise _compatible(): authors' subset compatibility
    isn't transitive in the mathematical sense, but with at most 7 sources
    responding to one field this is the simplest thing that groups every
    real case in the eval set correctly (see test_isbn_fusion.py)."""
    parent = list(range(len(responses)))

    def find(i: int) -> int:
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    def union(i: int, j: int) -> None:
        root_i, root_j = find(i), find(j)
        if root_i != root_j:
            parent[root_j] = root_i

    for i in range(len(responses)):
        for j in range(i + 1, len(responses)):
            if _compatible(field, responses[i]["value"], responses[j]["value"]):
                union(i, j)

    groups: dict[int, list[dict]] = {}
    for i, evidence in enumerate(responses):
        groups.setdefault(find(i), []).append(evidence)
    return list(groups.values())


def _evidence_item(field: str, evidence: dict) -> dict:
    item = {
        "source": evidence["source"], "value": evidence["value"],
        "method": evidence.get("extractionMethod") or infer_method(evidence["source"]),
        "reliability": round(_evidence_reliability(field, evidence), 3),
    }
    if evidence.get("sourceUrl"):
        item["sourceUrl"] = evidence["sourceUrl"]
    return item


def _empty_result(reason_codes: list[str]) -> dict:
    return {
        "value": None, "selectedSource": None, "confidence": 0.0,
        "agreementCount": 0, "conflictCount": 0, "alternatives": [],
        "reasonCodes": reason_codes, "candidates": [], "evidence": [],
    }


def _fuse_union(field: str, responses: list[dict]) -> dict:
    """categories: pool distinct values from every source instead of picking
    one (Chức năng 2.9) - two sources naming different-but-true categories is
    not a conflict."""
    merged: dict[str, dict] = {}
    order: list[str] = []
    for evidence in responses:
        values = evidence["value"] if isinstance(evidence["value"], list) else [evidence["value"]]
        for raw in values:
            text = str(raw).strip()
            if not text:
                continue
            key = normalize_text(text)
            if key not in merged:
                merged[key] = {"value": text, "sources": []}
                order.append(key)
            merged[key]["sources"].append(evidence["source"])

    support = round(_support(field, responses), 3)
    winner = max(responses, key=lambda e: _evidence_reliability(field, e))
    return {
        "value": [merged[key]["value"] for key in order], "selectedSource": winner["source"],
        "confidence": support, "agreementCount": len(responses), "conflictCount": 0, "alternatives": [],
        "reasonCodes": ["CATEGORY_UNION"],
        "candidates": [{"value": merged[key]["value"], "sources": merged[key]["sources"], "support": support} for key in order],
        "evidence": [_evidence_item(field, e) for e in responses],
    }


def _fuse_richest(field: str, responses: list[dict]) -> dict:
    """description: two different descriptions are not a conflict (Chức năng
    2.9) - pick the richest (longest x most reliable) one and keep every
    candidate's provenance."""
    def score(evidence: dict) -> float:
        return len(str(evidence["value"]).strip()) * _evidence_reliability(field, evidence)

    ranked = sorted(responses, key=score, reverse=True)
    winner = ranked[0]
    support = round(_support(field, responses), 3)
    return {
        "value": winner["value"], "selectedSource": winner["source"],
        "confidence": support, "agreementCount": len(responses), "conflictCount": 0, "alternatives": [],
        "reasonCodes": ["RICHEST_DESCRIPTION"],
        "candidates": [
            {"value": e["value"], "sources": [e["source"]], "support": round(_evidence_reliability(field, e), 3)}
            for e in ranked
        ],
        "evidence": [_evidence_item(field, e) for e in responses],
    }


def fuse_field(field: str, confirmations: list[dict]) -> dict:
    """confirmations: [{"source": str, "value": Any, "sourceUrl"?: str,
    "extractionMethod"?: str}, ...] - the same shape
    main._build_isbn_intelligence() already builds from provider_metadata,
    optionally already filtered to non-empty values (this function filters
    again, so callers don't have to).

    Returns {"value", "selectedSource", "confidence", "agreementCount",
    "conflictCount", "alternatives", "reasonCodes", "candidates", "evidence"} -
    see the module docstring. `alternatives` is the old
    [{"source", "value"}, ...] shape main.py's `conflicts[]` list expects.
    """
    responses = [c for c in confirmations if _has_value(c.get("value"))]
    llm_excluded = False
    if field in NO_LLM_FIELDS:
        grounded = [c for c in responses if (c.get("extractionMethod") or infer_method(c["source"])) != "llm_derived"]
        llm_excluded = len(grounded) < len(responses)
        responses = grounded

    if not responses:
        codes = ["NO_SOURCE_RESPONDED"]
        if llm_excluded:
            codes.append("LLM_ONLY_EVIDENCE_REJECTED")
        return _empty_result(codes)

    if field == "categories":
        return _fuse_union(field, responses)
    if field == "description":
        return _fuse_richest(field, responses)

    clusters = sorted(_cluster(field, responses), key=lambda cluster: -_support(field, cluster))
    best = clusters[0]
    best_support = _support(field, best)
    second_support = _support(field, clusters[1]) if len(clusters) > 1 else 0.0
    confidence = best_support if second_support <= 0 else best_support * (best_support / (best_support + second_support))
    confidence = round(min(confidence, MAX_SUPPORT), 3)

    winner = max(best, key=lambda e: _evidence_reliability(field, e))
    conflict_count = sum(len(cluster) for cluster in clusters[1:])

    reason_codes = ["MULTI_SOURCE_AGREEMENT" if len(best) > 1 else "SINGLE_SOURCE"]
    if conflict_count:
        is_genuine_conflict = field in FACTUAL_FIELDS and second_support >= CONFLICT_RATIO * best_support
        reason_codes.append("SOURCE_CONFLICT" if is_genuine_conflict else "MINORITY_DISAGREEMENT")
    if llm_excluded:
        reason_codes.append("LLM_ONLY_EVIDENCE_REJECTED")

    return {
        "value": _representative(field, best), "selectedSource": winner["source"], "confidence": confidence,
        "agreementCount": len(best), "conflictCount": conflict_count,
        "alternatives": [{"source": e["source"], "value": e["value"]} for cluster in clusters[1:] for e in cluster],
        "reasonCodes": reason_codes,
        "candidates": [
            {
                "value": _representative(field, cluster), "sources": [e["source"] for e in cluster],
                "support": round(_support(field, cluster), 3),
            }
            for cluster in clusters
        ],
        "evidence": [_evidence_item(field, e) for cluster in clusters for e in cluster],
    }
