"""Field-level reconciliation of the images' reading with the existing ISBN
lookup, producing one proposal per EditableBookForm field, then the safe
autofill policy (which proposals the form may fill without a click).

Comparison (both sources are evidence, neither is ground truth):
- the same words, Vietnamese marks included (case / spacing / punctuation /
  "NXB" prefix aside)                               -> CORROBORATED
- same letters, different marks ("tiễn"/"tiến")     -> REVIEW_REQUIRED, both shown
- same letters, the record carries no marks at all  -> no corroboration (an
  ASCII-folded provider record says nothing about tone marks); the printed
  reading keeps its own status
- different                                          -> CONFLICTED, no value,
  both options shown; the printed copy is never overwritten by a provider
  record and a provider record never silently replaces what was read
- only the images have it                            -> the OCR status
- only the lookup has it                             -> LOOKUP_ONLY

Identity: the lookup speaks for the photographed book only when the printed
title matches the record's (fuzzy: marks ignored - it is a "same book?" check,
not verification) or, with no title read, when two images print the same
ISBN. Otherwise nothing from the record is safe (title mismatch, other
edition, or identity unverified).

Safe autofill policy (`autofill_policy`) - never uses a model-declared confidence:
- CORROBORATED                 -> safe
- EXTRACTED (one image only)   -> safe for low-risk fields (translators, page
  count); NOT for the catalog-identity fields (ISBN, title, subtitle, authors,
  publisher, year) nor the description, which a single model transcription
  cannot verify. An ISBN read once is safe only when the lookup confirmed the
  book's identity. (Subtitle: live, the model put a translated book's foreign
  original title there, 1 of 9 smoke scans, despite the prompt rule.)
- REVIEW_REQUIRED / CONFLICTED / INVALID / INFERRED / MISSING -> never
- LOOKUP_ONLY                  -> safe only with a verified identity, the same
  edition and a field the provider did not flag
Unsafe values are still proposed: staff applies each with one click.
"""
from __future__ import annotations

import re

from metadata_intelligence.verification import canonical_isbn

from .normalization import compare_text, fold, has_marks, is_all_caps, isbn_digits, strict
from .schemas import FieldResult, Proposal, ProposalOption

SAFE_OCR_STATUSES = {"EXTRACTED", "CORROBORATED"}
ISBN_FORM_FIELDS = ("isbn", "isbn13", "isbn10")
# A wrong value here mis-files the book (identity, duplicate detection, citation)
# or puts unverifiable model text in the catalog: one model reading is not enough.
CRITICAL_FORM_FIELDS = {*ISBN_FORM_FIELDS, "title", "subtitle", "authorsText", "publisher", "publishedDate", "description"}
_LIST_FORM_FIELDS = ("authorsText", "translatorText", "categoriesText")
_TEXT_FORM_FIELDS = {"title", "subtitle", "publisher", "language", *_LIST_FORM_FIELDS}

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


def _items(value) -> list[str]:
    items = value if isinstance(value, list) else str(value).split(",")
    return [str(i) for i in items if str(i).strip()]


def _number_key(form_field: str, value):
    if form_field in ISBN_FORM_FIELDS:
        return canonical_isbn(isbn_digits(value))
    if form_field == "publishedDate":
        match = re.match(r"\s*(\d{4})", str(value))
        return match[1] if match else None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def relation(form_field: str, ocr, lookup) -> str:
    """How the printed value relates to the lookup's:
    MATCH | DIACRITICS_DIFFER | UNACCENTED_RECORD | DIFFERENT (see module doc)."""
    if ocr is None or lookup is None:
        return "DIFFERENT"
    if form_field in _TEXT_FORM_FIELDS:
        if form_field in _LIST_FORM_FIELDS:
            a, b = _items(ocr), _items(lookup)
            if len(a) != len(b):
                return "DIFFERENT"
            pairs = []
            for name in a:
                partner = next((other for other in b if fold(other) == fold(name)), None)
                if partner is None:
                    return "DIFFERENT"
                pairs.append((name, partner))
            outcomes = [compare_text(x, y) for x, y in pairs]
            if all(o == "MATCH" for o in outcomes):
                return "MATCH"
            unaccented = not any(has_marks(y) for _, y in pairs)
        else:
            outcome = compare_text(ocr, lookup, publisher=form_field == "publisher")
            if outcome != "DIACRITICS_DIFFER":
                return outcome
            unaccented = not has_marks(lookup)
        return "UNACCENTED_RECORD" if unaccented else "DIACRITICS_DIFFER"
    if form_field == "description":
        # One description is often an excerpt of the other (cover blurb vs. provider text).
        a, b = str(ocr), str(lookup)
        x, y = fold(a), fold(b)
        if not (x == y or (min(len(x), len(y)) >= 40 and (x in y or y in x))):
            return "DIFFERENT"
        sa, sb = strict(a), strict(b)
        if sa in sb or sb in sa:
            return "MATCH"
        return "DIACRITICS_DIFFER" if has_marks(b) else "UNACCENTED_RECORD"
    a, b = _number_key(form_field, ocr), _number_key(form_field, lookup)
    return "MATCH" if a is not None and a == b else "DIFFERENT"


def _agree(form_field: str, ocr, lookup) -> bool:
    return relation(form_field, ocr, lookup) == "MATCH"


def _better_written(form_field: str, ocr: str, lookup: str) -> str:
    """Which spelling to propose when both agree (marks included): the printed one
    unless it is ALL CAPS (a cover typeface) and the record is not, or - for
    descriptions / dates - the lookup's is the fuller text."""
    if form_field in ("description", "publishedDate"):
        return lookup if len(lookup) > len(ocr) else ocr  # "2020-05" refines a printed "2020"
    if is_all_caps(ocr) and not is_all_caps(lookup):
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
    if printed and lookup.get("title"):
        # Identity, not verification: marks are ignored here (same book, maybe an ASCII record).
        return None if relation("title", printed, lookup["title"]) != "DIFFERENT" else "LOOKUP_TITLE_MISMATCH"
    isbn = fields.get("isbn")
    printed_twice = bool(isbn and isbn.status == "CORROBORATED"
                         and len({o.source for o in isbn.observations if o.valid and o.source != "barcode"}) >= 2)
    return None if printed_twice else "LOOKUP_IDENTITY_UNVERIFIED"


def _reading_options(result: FieldResult) -> list[ProposalOption]:
    """One option per differently written valid reading (marks count)."""
    options, seen = [], set()
    for o in result.observations:
        text = form_text(o.normalizedValue)
        if o.valid and text and text not in seen:
            seen.add(text)
            options.append(ProposalOption(source=f"images:{o.source}", value=text))
    return options


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
            options = _reading_options(ocr_result) if "DIACRITICS_DIFFER" in reasons else \
                [ProposalOption(source="images", value=ocr_text)]
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
            rel = relation(form_field, ocr_text, lookup_text)
            if lookup_problem == "LOOKUP_IDENTITY_UNVERIFIED":
                # Nothing suspicious, just unconfirmed: the record is ignored, the reading keeps its own status.
                proposals[form_field] = Proposal(**base, value=ocr_text, status=ocr_status, source="images",
                                                 reasons=reasons + [lookup_problem])
            elif not usable_lookup:
                reasons.append(lookup_problem)
                proposals[form_field] = Proposal(**base, value=ocr_text, status="REVIEW_REQUIRED", source="images",
                                                 reasons=reasons)
            elif rel == "MATCH":
                # The lookup was queried BY this ISBN, so its echo is not independent evidence.
                independent = form_field not in ISBN_FORM_FIELDS
                status = "CORROBORATED" if independent and ocr_status in SAFE_OCR_STATUSES | {"INFERRED"} else ocr_status
                proposals[form_field] = Proposal(**base, value=_better_written(form_field, ocr_text, lookup_text),
                                                 status=status, source="images+isbn_lookup",
                                                 reasons=reasons + ["LOOKUP_AGREES" if independent else "LOOKUP_RECORD_FOUND"])
            elif rel == "UNACCENTED_RECORD":
                # Same letters, but the record has no marks: it cannot confirm the printed marks.
                proposals[form_field] = Proposal(**base, value=ocr_text, status=ocr_status, source="images",
                                                 reasons=reasons + ["LOOKUP_UNACCENTED"])
            elif rel == "DIACRITICS_DIFFER":
                proposals[form_field] = Proposal(**base, value=ocr_text, status="REVIEW_REQUIRED", source="images",
                                                 reasons=reasons + ["LOOKUP_DIACRITICS_DIFFER"])
            else:
                proposals[form_field] = Proposal(**base, status="CONFLICTED", reasons=reasons + ["LOOKUP_MISMATCH"])
            continue

        if ocr_text:
            proposals[form_field] = Proposal(**base, value=ocr_text, status=ocr_status,
                                             source="rule" if ocr_status == "INFERRED" else
                                             "barcode" if ocr_result.sources == ["barcode"] else "images",
                                             reasons=reasons)
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
                                             reasons=reasons + lookup_reasons)
            continue

        proposals[form_field] = Proposal(**base, status="INVALID" if ocr_status == "INVALID" else "MISSING",
                                         reasons=reasons)
    autofill_policy(proposals, identity_verified=usable_lookup)
    return proposals


_LOOKUP_BLOCKERS = {"LOOKUP_DIFFERENT_EDITION", "LOOKUP_TITLE_MISMATCH", "LOOKUP_IDENTITY_UNVERIFIED",
                    "LOOKUP_FLAGGED_FIELD", "OCR_READING_INVALID"}


def autofill_policy(proposals: dict[str, Proposal], *, identity_verified: bool) -> None:
    """Sets `safeToApply` on every proposal (see module doc). A value that is not
    safe gets the reason staff sees next to its one-click "apply" button."""
    for p in proposals.values():
        p.safeToApply = False
        if not p.value:
            continue
        if p.status == "CORROBORATED":
            p.safeToApply = True
        elif p.status == "EXTRACTED":
            if p.formField in ISBN_FORM_FIELDS and identity_verified:
                p.safeToApply = True  # checksum + the record of this ISBN carries the printed title
            elif p.formField in CRITICAL_FORM_FIELDS:
                p.reasons.append("SINGLE_SOURCE")
            else:
                p.safeToApply = True
        elif p.status == "LOOKUP_ONLY":
            p.safeToApply = not (_LOOKUP_BLOCKERS & set(p.reasons))
