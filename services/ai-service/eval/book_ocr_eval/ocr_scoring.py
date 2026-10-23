"""Scoring for the multi-image book OCR benchmark (pure functions, no I/O).

Ground truth describes only what is PRINTED in the images given for that book
(null / [] = not visible), so a prediction for an invisible field is a
hallucination, never a "bonus". Three layers are scored per scan, so an
improvement can be attributed to the model or to the post-processing:

- `raw`      - the model's own extraction before any validation: per field,
               its first reading, valid or not (from response.fields[*].observations)
- `reading`  - response.metadata: what survived validation (including values
               that still need review)
- `autofill` - the safe proposals the AI Import form fills on its own

Matching: "exact" = case/whitespace/punctuation-insensitive but diacritics-
SENSITIVE (a lost or wrong tone mark is a wrong Vietnamese value); "normalized"
additionally ignores diacritics (reported for titles only, as a diagnostic).
"""
from __future__ import annotations

import math
import re
import unicodedata

FIELDS = ("title", "subtitle", "authors", "translators", "publisher", "publishedYear", "isbn13", "pageCount")
LIST_FIELDS = {"authors", "translators"}


def _clean(value) -> str:
    """Case-, whitespace- and punctuation-insensitive; tone marks still count."""
    return " ".join(re.findall(r"\w+", unicodedata.normalize("NFC", str(value)).casefold()))


def _fold(value) -> str:
    text = _clean(value).replace("đ", "d")
    return "".join(c for c in unicodedata.normalize("NFD", text) if unicodedata.category(c) != "Mn")


def _empty(value) -> bool:
    return value is None or value == "" or value == []


def _key(field: str, value, normalized: bool = False):
    if _empty(value):
        return None
    norm = _fold if normalized else _clean
    if field in LIST_FIELDS:
        items = value if isinstance(value, list) else str(value).split(",")
        return frozenset(norm(i) for i in items if str(i).strip())
    if field == "publisher":
        return re.sub(r"^(nhà xuất bản|nha xuat ban|nxb)\s+", "", norm(value))
    if field in ("publishedYear", "pageCount"):
        match = re.match(r"\s*(\d+)", str(value))
        return int(match[1]) if match else None
    if field == "isbn13":
        return re.sub(r"[^0-9X]", "", str(value).upper())
    return norm(value)


def match(field: str, predicted, truth, normalized: bool = False) -> bool:
    return _key(field, predicted, normalized) == _key(field, truth, normalized)


# scored field -> the OCR field whose observations hold the model's raw readings
_OCR_NAMES = {"publishedYear": "publicationYear", "isbn13": "isbn"}


def raw_metadata(response: dict) -> dict:
    """What the model answered before validation (first reading per field, image
    readings only - a browser-decoded barcode is not the model's answer)."""
    fields = response.get("fields") or {}
    out = {}
    for field in FIELDS:
        readings = [o for o in (fields.get(_OCR_NAMES.get(field, field)) or {}).get("observations", [])
                    if o.get("source") != "barcode"]
        if not readings:
            out[field] = [] if field in LIST_FIELDS else None
            continue
        first = readings[0]
        value = first.get("normalizedValue") if first.get("normalizedValue") not in (None, "", []) else first.get("value")
        if field == "isbn13" and value is not None:
            value = re.sub(r"[^0-9X]", "", str(value).upper())
        out[field] = value
    return out


def autofill_metadata(response: dict) -> dict:
    """What the form receives without a human click: safe proposals only."""
    p = {k: v for k, v in (response.get("proposals") or {}).items() if v.get("safeToApply") and v.get("value")}
    split = lambda text: [t.strip() for t in text.split(",") if t.strip()]  # noqa: E731
    return {
        "title": p.get("title", {}).get("value"), "subtitle": p.get("subtitle", {}).get("value"),
        "authors": split(p["authorsText"]["value"]) if "authorsText" in p else [],
        "translators": split(p["translatorText"]["value"]) if "translatorText" in p else [],
        "publisher": p.get("publisher", {}).get("value"),
        "publishedYear": p.get("publishedDate", {}).get("value"), "isbn13": p.get("isbn13", {}).get("value"),
        "pageCount": p.get("pageCount", {}).get("value"),
    }


_FORM_FIELDS = {"title": "title", "subtitle": "subtitle", "authors": "authorsText", "translators": "translatorText",
                "publisher": "publisher", "publishedYear": "publishedDate", "isbn13": "isbn13", "pageCount": "pageCount"}


def offered_correct(response: dict, field: str, truth) -> bool:
    """Whether the review panel offers the right value for one click: the
    proposal's value or one of its options (a conflict shows every reading)."""
    proposal = (response.get("proposals") or {}).get(_FORM_FIELDS[field]) or {}
    candidates = [proposal.get("value")] + [o.get("value") for o in proposal.get("options") or []]
    for candidate in candidates:
        if candidate in (None, ""):
            continue
        value = [t.strip() for t in candidate.split(",") if t.strip()] if field in LIST_FIELDS else candidate
        if match(field, value, truth):
            return True
    return False


def score_fields(predicted: dict, truth: dict) -> dict[str, str]:
    """Per field: TP (right), FP_WRONG (a different value), FP_HALLUCINATED
    (value for a field not printed), FN (printed, not returned), TN."""
    outcome = {}
    for field in FIELDS:
        p, t = predicted.get(field), truth.get(field)
        if _empty(t):
            outcome[field] = "TN" if _empty(p) else "FP_HALLUCINATED"
        elif _empty(p):
            outcome[field] = "FN"
        else:
            outcome[field] = "TP" if match(field, p, t) else "FP_WRONG"
    return outcome


def _prf(tp: int, fp: int, fn: int) -> dict:
    precision = tp / (tp + fp) if tp + fp else None
    recall = tp / (tp + fn) if tp + fn else None
    f1 = 2 * precision * recall / (precision + recall) if precision and recall else (0.0 if precision == 0 or recall == 0 else None)
    return {"tp": tp, "fp": fp, "fn": fn, "precision": precision, "recall": recall, "f1": f1}


def _percentile(values: list[float], q: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    return ordered[min(len(ordered) - 1, max(0, math.ceil(q * len(ordered)) - 1))]


def aggregate(runs: list[dict]) -> dict:
    """`runs`: one item per (book, repetition):
    {"truth": {...}, "response": scan response | None, "error": code | None}."""
    ok = [r for r in runs if r.get("response")]
    report: dict = {"scans": len(runs), "succeeded": len(ok)}
    invalid_json = sum(1 for r in runs if r.get("error") in ("AI_INVALID_RESPONSE", "AI_INVALID_SCHEMA"))
    model_answers = len(ok) + invalid_json
    report["jsonValidityRate"] = len(ok) / model_answers if model_answers else None
    report["malformedObservationsPerScan"] = (sum(
        sum(1 for w in r["response"]["warnings"] if w.startswith(("MALFORMED_OBSERVATION", "MALFORMED_FIELD")))
        for r in ok) / len(ok)) if ok else None
    report["errors"] = sorted({r["error"] for r in runs if r.get("error")})

    views = {"raw": raw_metadata, "reading": lambda response: response["metadata"], "autofill": autofill_metadata}
    for view, predict in views.items():
        per_field = {f: {"TP": 0, "FP_WRONG": 0, "FP_HALLUCINATED": 0, "FN": 0, "TN": 0} for f in FIELDS}
        for r in ok:
            predicted = predict(r["response"])
            for field, result in score_fields(predicted, r["truth"]).items():
                per_field[field][result] += 1
        fields = {}
        for field, c in per_field.items():
            fields[field] = {**_prf(c["TP"], c["FP_WRONG"] + c["FP_HALLUCINATED"], c["FN"]), **c}
        totals = {k: sum(c[k] for c in per_field.values()) for k in ("TP", "FP_WRONG", "FP_HALLUCINATED", "FN", "TN")}
        predicted_values = totals["TP"] + totals["FP_WRONG"] + totals["FP_HALLUCINATED"]
        printed = totals["TP"] + totals["FP_WRONG"] + totals["FN"]
        report[view] = {
            "fields": fields,
            "micro": _prf(totals["TP"], totals["FP_WRONG"] + totals["FP_HALLUCINATED"], totals["FN"]),
            # Of the values the system returned, how many were for fields not printed at all.
            "hallucinationRate": totals["FP_HALLUCINATED"] / predicted_values if predicted_values else None,
            # Of the printed fields, how many got any value back.
            "fieldCoverage": (totals["TP"] + totals["FP_WRONG"]) / printed if printed else None,
        }
    # Fields staff still has to type or fix after the automatic fill.
    printed = sum(1 for r in ok for f in FIELDS if not _empty(r["truth"].get(f)))
    corrected = sum(1 for r in ok for f, res in score_fields(autofill_metadata(r["response"]), r["truth"]).items()
                    if res in ("FN", "FP_WRONG"))
    report["manualCorrectionRate"] = corrected / printed if printed else None
    # Of those, how many need only a click (the right value is offered) and how many need typing.
    needs_click = sum(1 for r in ok for f, res in score_fields(autofill_metadata(r["response"]), r["truth"]).items()
                      if res in ("FN", "FP_WRONG") and offered_correct(r["response"], f, r["truth"][f]))
    report["oneClickRate"] = needs_click / printed if printed else None
    report["typingRate"] = (corrected - needs_click) / printed if printed else None

    def accuracy(field: str, normalized: bool = False):
        eligible = [r for r in ok if not _empty(r["truth"].get(field))]
        if not eligible:
            return None
        return sum(1 for r in eligible if match(field, r["response"]["metadata"].get(field), r["truth"][field], normalized)) / len(eligible)

    report["accuracy"] = {
        "isbnExact": accuracy("isbn13"), "titleExact": accuracy("title"), "titleNormalized": accuracy("title", True),
        "authors": accuracy("authors"), "publisher": accuracy("publisher"), "publishedYear": accuracy("publishedYear"),
    }
    isbn_obs = [o for r in ok for o in ((r["response"].get("fields") or {}).get("isbn") or {}).get("observations", [])
                if o.get("source") != "barcode"]
    bad = sum(1 for o in isbn_obs if {"INVALID_CHECKSUM", "NOT_ISBN_PREFIX", "INVALID_FORMAT"} & set(o.get("issues", [])))
    report["invalidIsbnRate"] = bad / len(isbn_obs) if isbn_obs else None
    latencies = [r["response"]["processingTimeMs"] for r in ok]
    report["latencyMs"] = {"mean": sum(latencies) / len(latencies) if latencies else None,
                           "p50": _percentile(latencies, 0.5), "p95": _percentile(latencies, 0.95)}
    tokens = [r["response"]["usage"] for r in ok if r["response"]["usage"].get("promptTokens") is not None]
    report["tokens"] = {
        "meanInput": sum(u["promptTokens"] for u in tokens) / len(tokens) if tokens else None,
        "meanOutput": sum(u.get("completionTokens") or 0 for u in tokens) / len(tokens) if tokens else None,
    }
    costs = [r["response"]["usage"]["costUsd"] for r in ok if r["response"]["usage"].get("costUsd") is not None]
    report["costUsd"] = {"meanPerBook": sum(costs) / len(costs) if costs else None, "total": sum(costs) if costs else None,
                         "reported": len(costs)}
    return report


def by_tag(runs: list[dict]) -> dict[str, dict]:
    """The headline numbers per dataset tag (genre, image condition...), so a weak
    spot (e.g. glare, small print) is visible instead of averaged away."""
    tags = sorted({t for r in runs for t in r.get("tags") or []})
    out = {}
    for tag in tags:
        report = aggregate([r for r in runs if tag in (r.get("tags") or [])])
        out[tag] = {"scans": report["scans"], "titleExact": report["accuracy"]["titleExact"],
                    "isbnExact": report["accuracy"]["isbnExact"], "readingF1": report["reading"]["micro"]["f1"],
                    "autofillPrecision": report["autofill"]["micro"]["precision"],
                    "hallucinationRate": report["reading"]["hallucinationRate"]}
    return out
