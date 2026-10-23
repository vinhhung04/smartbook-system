"""Field-level reconciliation of the images' reading with the existing ISBN
lookup, producing one proposal per EditableBookForm field.

Rules (both sources are evidence, neither is ground truth):
- agree (case/diacritics/"NXB" prefix-insensitive)  -> CORROBORATED, safe
- disagree                                           -> CONFLICTED, no value,
  both options shown; the printed copy is never overwritten by a provider
  record and a provider record never silently replaces what was read
- only the images have it                            -> the OCR status
- only the lookup has it                             -> LOOKUP_ONLY, safe unless
  the lookup itself flagged the field, or the lookup's ISBN is a different
  edition than the one printed on the book (then nothing from it is safe)
"""
from __future__ import annotations

import re

from metadata_intelligence.verification import canonical_isbn

from .normalization import fold, is_all_caps, isbn_digits, vietnamese_letter_count
from .schemas import FieldResult, Proposal, ProposalOption

SAFE_OCR_STATUSES = {"EXTRACTED", "CORROBORATED"}

# form field -> (OCR field, lookup key)
FORM_FIELDS = {
    "isbn": ("isbn", "isbn13"),
    "isbn13": ("isbn", "isbn13"),
    "isbn10": ("isbn10", "isbn10"),
    "title": ("title", "title"),
    "subtitle": ("subtitle", "subtitle"),
    "authorsText": ("authors", "authors"),
    "translatorText": ("translators", "translator"),
    "publisher": ("publisher", "publisher"),
    "publishedDate": ("publicationYear", "publishedDate"),
    "pageCount": ("pageCount", "pageCount"),
    "description": ("description", "description"),
    "language": ("language", "language"),
    "categoriesText": (None, "categories"),
}
# The lookup's field names in its own conflictedFields / lowConfidenceFields.
_LOOKUP_FLAG_NAMES = {"isbn13": "isbn", "isbn10": "isbn", "translator": "translator"}


def form_text(value) -> str | None:
    if value is None or value == "" or value == []:
        return None
    if isinstance(value, list):
        return ", ".join(str(v) for v in value if str(v).strip()) or None
    return str(value)


def _compare_key(form_field: str, value) -> object:
    if value is None:
        return None
    if form_field in ("authorsText", "translatorText", "categoriesText"):
        items = value if isinstance(value, list) else str(value).split(",")
        return frozenset(fold(i) for i in items if str(i).strip())
    if form_field in ("isbn", "isbn13", "isbn10"):
        return canonical_isbn(isbn_digits(value))
    if form_field == "publishedDate":
        match = re.match(r"\s*(\d{4})", str(value))
        return match[1] if match else None
    if form_field == "pageCount":
        try:
            return int(value)
        except (TypeError, ValueError):
            return None
    if form_field == "publisher":
        return re.sub(r"^(nha xuat ban|nxb)\s+", "", fold(str(value)))
    return fold(str(value))


def _agree(form_field: str, ocr, lookup) -> bool:
    a, b = _compare_key(form_field, ocr), _compare_key(form_field, lookup)
    if a is None or b is None:
        return False
    if a == b:
        return True
    # One description is often an excerpt of the other (cover blurb vs. provider text).
    return form_field == "description" and isinstance(a, str) and isinstance(b, str) and \
        min(len(a), len(b)) >= 40 and (a in b or b in a)


def _better_written(form_field: str, ocr: str, lookup: str) -> str:
    """Which spelling to propose when both agree: the printed one unless the
    lookup's carries more Vietnamese tone marks or the printed one is ALL CAPS
    (a cover typeface), or - for descriptions - the lookup's is the fuller text."""
    if form_field == "description":
        return lookup if len(lookup) > len(ocr) else ocr
    if form_field == "publishedDate":
        return lookup if len(lookup) > len(ocr) else ocr  # "2020-05" refines a printed "2020"
    if vietnamese_letter_count(lookup) > vietnamese_letter_count(ocr):
        return lookup
    if is_all_caps(ocr) and not is_all_caps(lookup) and fold(ocr) == fold(lookup):
        return lookup
    return ocr


def _ocr_value(form_field: str, ocr_field: str | None, fields: dict[str, FieldResult]) -> tuple[FieldResult | None, str | None]:
    if ocr_field == "isbn10":
        isbn = fields.get("isbn")
        raw10 = None
        if isbn and isbn.value:
            for o in isbn.observations:
                digits = isbn_digits(o.value)
                if o.valid and len(digits) == 10 and canonical_isbn(digits) == isbn.value:
                    raw10 = digits
        return (isbn if raw10 else None), raw10
    result = fields.get(ocr_field) if ocr_field else None
    if not result:
        return None, None
    return result, form_text(result.value)


def lookup_mismatch(fields: dict[str, FieldResult], lookup: dict | None, edition_matches: bool | None) -> str | None:
    """Why the lookup record cannot speak for the book in the photos (None = it can).
    An ISBN that matches is not enough: a barcode or ISBN can belong to another
    book (a sticker, a misprint, a set ISBN), and then its record's year, pages and
    description are another book's - the printed title is the check."""
    if not lookup or not lookup.get("found"):
        return None
    if edition_matches is False:
        return "LOOKUP_DIFFERENT_EDITION"
    title = fields.get("title")
    printed = title.value if title and title.status in SAFE_OCR_STATUSES | {"REVIEW_REQUIRED"} else None
    if printed and lookup.get("title") and not _agree("title", printed, lookup["title"]):
        return "LOOKUP_TITLE_MISMATCH"
    return None


def build_proposals(fields: dict[str, FieldResult], lookup: dict | None, edition_matches: bool | None) -> dict[str, Proposal]:
    flagged = set((lookup or {}).get("conflictedFields") or []) | set((lookup or {}).get("lowConfidenceFields") or [])
    lookup_problem = lookup_mismatch(fields, lookup, edition_matches)
    usable_lookup = bool(lookup and lookup.get("found")) and lookup_problem is None
    proposals: dict[str, Proposal] = {}
    for form_field, (ocr_field, lookup_key) in FORM_FIELDS.items():
        ocr_result, ocr_text = _ocr_value(form_field, ocr_field, fields)
        lookup_text = form_text((lookup or {}).get(lookup_key)) if lookup and lookup.get("found") else None
        if form_field == "isbn" and not lookup_text and lookup and lookup.get("found"):
            lookup_text = form_text(lookup.get("isbn"))
        ocr_status = ocr_result.status if ocr_result else "MISSING"
        reasons = list(ocr_result.reasons) if ocr_result else []
        options = []
        if ocr_text:
            options.append(ProposalOption(source="images", value=ocr_text))
        if lookup_text:
            options.append(ProposalOption(source="isbn_lookup", value=lookup_text))
        base = dict(formField=form_field, ocrValue=ocr_text, lookupValue=lookup_text, options=options)

        if ocr_status == "CONFLICTED":
            values = {form_text(o.normalizedValue) for o in ocr_result.observations if o.valid}
            options = [ProposalOption(source=f"images:{o.source}", value=form_text(o.normalizedValue))
                       for o in ocr_result.observations if o.valid and form_text(o.normalizedValue) in values]
            if lookup_text:
                options.append(ProposalOption(source="isbn_lookup", value=lookup_text))
                if any(_agree(form_field, v, lookup_text) for v in values):
                    reasons.append("LOOKUP_SUPPORTS_ONE_READING")
            proposals[form_field] = Proposal(**{**base, "options": options}, status="CONFLICTED",
                                             reasons=reasons or ["SOURCES_DISAGREE"])
            continue

        if ocr_text and lookup_text:
            if not usable_lookup:
                reasons.append(lookup_problem)
                proposals[form_field] = Proposal(**base, value=ocr_text, status="REVIEW_REQUIRED", source="images",
                                                 reasons=reasons)
            elif _agree(form_field, ocr_text, lookup_text):
                safe = ocr_status in SAFE_OCR_STATUSES or ocr_status == "INFERRED"
                # The lookup was queried BY this ISBN, so its echo is not independent evidence.
                independent = form_field not in ("isbn", "isbn13", "isbn10")
                proposals[form_field] = Proposal(**base, value=_better_written(form_field, ocr_text, lookup_text),
                                                 status="CORROBORATED" if safe and independent else ocr_status,
                                                 source="images+isbn_lookup", safeToApply=safe,
                                                 reasons=reasons + ["LOOKUP_AGREES" if independent else "LOOKUP_RECORD_FOUND"])
            else:
                proposals[form_field] = Proposal(**base, status="CONFLICTED", reasons=reasons + ["LOOKUP_MISMATCH"])
            continue

        if ocr_text:
            proposals[form_field] = Proposal(**base, value=ocr_text, status=ocr_status,
                                             source="rule" if ocr_status == "INFERRED" else
                                             "barcode" if ocr_result.sources == ["barcode"] else "images",
                                             safeToApply=ocr_status in SAFE_OCR_STATUSES, reasons=reasons)
            continue

        if lookup_text:
            lookup_reasons = []
            if not usable_lookup:
                lookup_reasons.append(lookup_problem)
            if _LOOKUP_FLAG_NAMES.get(lookup_key, lookup_key) in flagged:
                lookup_reasons.append("LOOKUP_FLAGGED_FIELD")
            if ocr_status == "INVALID":
                lookup_reasons.append("OCR_READING_INVALID")
            proposals[form_field] = Proposal(**base, value=lookup_text, status="LOOKUP_ONLY", source="isbn_lookup",
                                             safeToApply=not lookup_reasons, reasons=reasons + lookup_reasons)
            continue

        proposals[form_field] = Proposal(**base, status="INVALID" if ocr_status == "INVALID" else "MISSING",
                                         reasons=reasons)
    return proposals
