"""Turns the model's raw observations into per-field results.

Every observation must (1) name an image that was actually uploaded, (2) be
well-formed (normalization.py), (3) be grounded - its value must literally
occur in the text the model says it read - and (4) sit in the right role
(a translator line is not an author, a print year is not a publication
year). This does NOT prove the text is in the pixels: `observedText` is the
model's own transcription (model-generated transcription != independently
verified image evidence). It catches values the model inferred or invented
beyond what it transcribed; only agreement between independent sources
(two images, an image + the decoded barcode, the ISBN lookup) is reported as
CORROBORATED.

Readings are grouped with the FUZZY key (`fold`: marks ignored) to find the
ones that talk about the same value, then compared with the STRICT key
(`strict`: marks count). Same letters with different / missing marks
("tiễn" vs "tiến", "Trẻ" vs "Tre") is DIACRITICS_DIFFER -> REVIEW_REQUIRED,
never CORROBORATED. A barcode the browser declares is client input: alone it
is BARCODE_UNCONFIRMED (review); it corroborates only a matching image reading.

Source preference only picks how an agreeing value is written (e.g. the
copyright page's "Nhà giả kim" over the cover's "NHÀ GIẢ KIM"); it never
settles a disagreement.
"""
from __future__ import annotations

import re

from metadata_intelligence.evidence_validation import ROLE_LABELS
from metadata_intelligence.verification import canonical_isbn

from .normalization import (LIST_FIELDS, YEAR_FIELDS, clean, fold, fold_publisher, is_all_caps, isbn_digits,
                            isbn_issue, key, normalize_observation, strict, strict_publisher,
                            vietnamese_letter_count, words)
from .schemas import OCR_FIELDS, FieldResult, ModelImageNote, ModelObservation, ModelOtherCode, Observation

_EDITION = ("copyright_page", "back_cover", "front_cover")
PRIORITY = {
    "title": ("copyright_page", "front_cover", "back_cover"),
    "subtitle": ("copyright_page", "front_cover", "back_cover"),
    "authors": ("copyright_page", "front_cover", "back_cover"),
    "translators": ("copyright_page", "front_cover", "back_cover"),
    "publisher": _EDITION, "distributor": _EDITION, "publicationYear": _EDITION, "printYear": _EDITION,
    "copyrightYear": _EDITION, "editionStatement": _EDITION, "pageCount": _EDITION,
    "isbn": ("barcode", "copyright_page", "back_cover", "front_cover"),
    "coverPrice": ("back_cover", "copyright_page", "front_cover"),
    "description": ("back_cover", "front_cover", "copyright_page"),
}

_TRANSLATOR = re.compile(ROLE_LABELS["translator"] + r"|(?<!\w)dịch(?!\w)", re.I)
_ILLUSTRATOR = re.compile(r"minh họa|họa sĩ|illustrat", re.I)
_AUTHOR = re.compile(r"tác giả|nguyên tác|(?<!\w)lời(?!\w)|(?<!\w)truyện(?!\w)|author|written|story", re.I)
_PUBLISHER = re.compile(r"nhà xuất bản|(?<!\w)nxb(?!\w)|publish", re.I)
_DISTRIBUTOR = re.compile(r"phát hành|liên kết|distribut", re.I)
_PUBLICATION = re.compile(r"xuất bản năm|năm xuất bản|xuất bản lần|(?<!\w)xb năm|published|publication", re.I)
_PRINT = re.compile(r"in xong|lưu chiểu|(?<!\w)in tại|in lần|printed|printing", re.I)
_COPYRIGHT = re.compile(r"©|\(c\)|copyright|bản quyền", re.I)
_REGISTRATION = re.compile(r"đkxb|cxbiph|qđxb|quyết định xuất bản|xác nhận đăng ký", re.I)
_ISBN_LIKE = re.compile(r"[0-9][0-9Xx\s-]{8,20}[0-9Xx]")
_SEGMENTS = re.compile(r"[\n;|•]+")

# Values with these issues are not used at all; the rest only force review.
WARNING_ISSUES = {"ROLE_UNCONFIRMED", "ISBN_UNLABELLED"}


def _segment(observed: str, item: str) -> str:
    """The line of observedText that contains `item`, so a role cue on another
    line ("Dịch giả: B" under "Tác giả: A") does not taint it."""
    target = key(item)
    for part in _SEGMENTS.split(observed):
        if target and target in key(part):
            return part
    return observed


def _label_before(observed: str, item: str) -> str | None:
    """The role label closest BEFORE `item` on its line ("Nguyên tác: A  Minh họa: B"
    -> author for A, illustrator for B)."""
    line = clean(_segment(observed, item))
    at = line.casefold().find(key(item))
    if at < 0:
        return None
    labels = [(m.start(), role) for role, pattern in (("author", _AUTHOR), ("illustrator", _ILLUSTRATOR),
                                                      ("translator", _TRANSLATOR))
              for m in pattern.finditer(line[:at])]
    return max(labels)[1] if labels else None


def _grounding_issues(field: str, raw, normalized, observed: str | None) -> list[str]:
    if field == "description" and not observed:
        return []  # the value itself is the verbatim transcription the prompt asked for
    if not observed or not clean(observed):
        return ["NO_EVIDENCE"]
    text = f" {words(observed)} "
    if field in LIST_FIELDS:
        return [] if all(f" {words(item)} " in text for item in normalized) else ["UNGROUNDED"]
    if field == "isbn":
        target = canonical_isbn(isbn_digits(raw))
        candidates = _ISBN_LIKE.findall(observed) + [isbn_digits(observed)]
        return [] if any(canonical_isbn(isbn_digits(c)) == target for c in candidates) else ["UNGROUNDED"]
    if field in YEAR_FIELDS or field == "pageCount":
        return [] if re.search(rf"(?<!\d){normalized}(?!\d)", observed) else ["UNGROUNDED"]
    if field == "coverPrice":
        digits = re.sub(r"\D", "", str(normalized))
        return [] if digits and digits in re.sub(r"\D", "", observed) else ["UNGROUNDED"]
    return [] if f" {words(str(normalized))} " in text else ["UNGROUNDED"]


def _role_issues(field: str, normalized, observed: str | None) -> list[str]:
    if not observed:
        return []
    if field == "authors":
        # A translator line, or a name labelled "Minh họa:" / "Họa sĩ:" (illustrators are not authors).
        return ["ROLE_MISMATCH"] if any(_TRANSLATOR.search(_segment(observed, a)) or _label_before(observed, a) == "illustrator"
                                        for a in normalized) else []
    if field == "translators":
        return [] if all(_TRANSLATOR.search(_segment(observed, t)) for t in normalized) else ["ROLE_UNCONFIRMED"]
    if field == "publisher":
        line = _segment(observed, str(normalized))
        if _DISTRIBUTOR.search(line) and not _PUBLISHER.search(line):
            return ["ROLE_MISMATCH"]
        return [] if _PUBLISHER.search(line) else ["ROLE_UNCONFIRMED"]
    if field == "isbn":
        return [] if re.search(r"isbn", observed, re.I) else ["ISBN_UNLABELLED"]
    year_line = _segment(observed, str(normalized))
    if field == "publicationYear":
        if _PUBLICATION.search(year_line):
            return []
        if _PRINT.search(year_line) or _COPYRIGHT.search(year_line) or _REGISTRATION.search(year_line):
            return ["ROLE_MISMATCH"]
        return ["ROLE_UNCONFIRMED"]
    if field == "printYear":
        return [] if _PRINT.search(year_line) else ["ROLE_UNCONFIRMED"]
    if field == "copyrightYear":
        return [] if _COPYRIGHT.search(year_line) else ["ROLE_UNCONFIRMED"]
    return []


def _group_key(field: str, normalized):
    if field in LIST_FIELDS:
        return frozenset(fold(item) for item in normalized)
    if field in ("publisher", "distributor"):
        return re.sub(r"^(nha xuat ban|nxb)\s+", "", fold(normalized))
    if isinstance(normalized, str):
        return fold(normalized)
    return normalized


def _marks_disagree(field: str, observations: list[Observation]) -> bool:
    """Readings that fold to the same letters but differ in Vietnamese marks
    (wrong / missing / misplaced tone or vowel marks, đ vs d). Lists are compared
    name by name, so a cover listing one of two authors is not a mark conflict."""
    loose, exact = (fold_publisher, strict_publisher) if field in ("publisher", "distributor") else (fold, strict)
    variants: dict[str, set[str]] = {}
    for o in observations:
        items = o.normalizedValue if field in LIST_FIELDS else [o.normalizedValue]
        for item in items:
            if isinstance(item, str):
                variants.setdefault(loose(item), set()).add(exact(item))
    return any(len(v) > 1 for v in variants.values())


def _text(value) -> str:
    return ", ".join(value) if isinstance(value, list) else str(value)


def _representative(field: str, observations: list[Observation]) -> Observation:
    order = PRIORITY.get(field, _EDITION)

    def rank(o: Observation):
        text = _text(o.normalizedValue)
        return (-vietnamese_letter_count(text), is_all_caps(text),
                order.index(o.source) if o.source in order else len(order))
    return sorted(observations, key=rank)[0]


def parse_observations(raw: dict, allowed_sources: set[str]) -> tuple[dict[str, list[Observation]], list[str]]:
    """Per-field observation lists from the model's JSON. Malformed items are
    dropped one by one (with a warning) instead of failing the whole scan;
    the caller has already checked that `observations` is an object."""
    warnings: list[str] = []
    by_field: dict[str, list[Observation]] = {}
    observations = raw.get("observations") or {}
    for field in OCR_FIELDS:
        items = observations.get(field)
        if items is None:
            continue
        if isinstance(items, dict):
            items = [items]
        if not isinstance(items, list):
            warnings.append(f"MALFORMED_FIELD:{field}")
            continue
        for item in items:
            try:
                parsed = ModelObservation.model_validate(item)
            except Exception:  # noqa: BLE001 - pydantic ValidationError or a non-dict item
                warnings.append(f"MALFORMED_OBSERVATION:{field}")
                continue
            if parsed.value is None or parsed.value == "" or parsed.value == []:
                continue  # an explicit "not read" is not an observation
            normalized, issues = normalize_observation(field, parsed.value)
            if issues == ["EMPTY"]:
                continue
            if parsed.source not in allowed_sources:
                issues = ["UNKNOWN_SOURCE", *issues]
            if not issues:
                issues = _grounding_issues(field, parsed.value, normalized, parsed.observedText)
            if not issues:
                issues = _role_issues(field, normalized, parsed.observedText)
            blocking = [i for i in issues if i not in WARNING_ISSUES]
            by_field.setdefault(field, []).append(Observation(
                source=parsed.source, value=parsed.value, normalizedValue=normalized,
                observedText=parsed.observedText, valid=not blocking, issues=issues,
            ))
            for issue in issues:
                warnings.append(f"{issue}:{field}:{parsed.source}")
    return by_field, warnings


def barcode_observation(barcode: str | None) -> tuple[Observation | None, dict | None]:
    """A barcode the client decoded deterministically from the back cover.
    An ISBN (978/979 + checksum) becomes an independent ISBN observation;
    any other EAN (e.g. 893...) is reported as a non-ISBN code."""
    digits = isbn_digits(barcode)
    if not digits:
        return None, None
    if isbn_issue(digits) is None:
        return Observation(source="barcode", value=digits, normalizedValue=canonical_isbn(digits),
                           observedText=digits, valid=True), None
    return None, {"source": "barcode", "label": "Mã vạch không phải ISBN", "value": digits[:64],
                  "reason": isbn_issue(digits)}


def aggregate(field: str, observations: list[Observation]) -> FieldResult:
    if not observations:
        return FieldResult(field=field, status="MISSING")
    valid = [o for o in observations if o.valid]
    if not valid:
        return FieldResult(field=field, status="INVALID", observations=observations,
                           reasons=sorted({i for o in observations for i in o.issues}))
    groups: dict = {}
    for o in valid:
        groups.setdefault(_group_key(field, o.normalizedValue), []).append(o)
    reasons: list[str] = []
    if len(groups) > 1:
        keys = sorted(groups, key=len) if field in LIST_FIELDS else []
        nested = bool(keys) and all(keys[i] <= keys[i + 1] for i in range(len(keys) - 1))
        if not nested:
            return FieldResult(field=field, status="CONFLICTED", observations=observations,
                               sources=sorted({o.source for o in valid}), reasons=["SOURCES_DISAGREE"])
        chosen = groups[keys[-1]]  # a cover often lists only the first author
        reasons.append("PARTIAL_AGREEMENT")
    else:
        chosen = next(iter(groups.values()))
    best = _representative(field, chosen)
    if field != "isbn" and _marks_disagree(field, chosen):
        reasons.append("DIACRITICS_DIFFER")  # same letters, different / missing marks: a person decides
    if field == "isbn" and {o.source for o in chosen} == {"barcode"}:
        reasons.append("BARCODE_UNCONFIRMED")  # only the browser's say-so: no image reading backs it
    sources = sorted({o.source for o in valid})
    if len(valid) < len(observations):
        reasons.append("SOME_READINGS_INVALID")
    corroborated = len({o.source for o in chosen}) >= 2
    if not corroborated:  # an unlabelled/unconfirmed reading that another source repeats is fine
        reasons.extend(sorted({i for o in chosen for i in o.issues if i in WARNING_ISSUES}))
    status = "REVIEW_REQUIRED" if reasons else "CORROBORATED" if corroborated else "EXTRACTED"
    return FieldResult(field=field, status=status, value=best.normalizedValue, observations=observations,
                       sources=sources, reasons=reasons)


def parse_image_notes(raw: dict, allowed_sources: set[str]) -> list[str]:
    warnings = []
    for item in raw.get("images") or []:
        try:
            note = ModelImageNote.model_validate(item)
        except Exception:  # noqa: BLE001
            continue
        if note.source in allowed_sources and not note.legible:
            warnings.append(f"IMAGE_ILLEGIBLE:{note.source}")
    return warnings


def parse_other_codes(raw: dict, allowed_sources: set[str]) -> list[dict]:
    codes = []
    for item in raw.get("otherCodes") or []:
        try:
            code = ModelOtherCode.model_validate(item)
        except Exception:  # noqa: BLE001
            continue
        # A "code" without digits is a name or a word the model misfiled (e.g. an illustrator).
        if code.source in allowed_sources and len(re.sub(r"\D", "", code.value)) >= 4:
            codes.append({"source": code.source, "label": code.label, "value": code.value,
                          "observedText": code.observedText})
    return codes[:10]


def infer_language(fields: dict[str, FieldResult]) -> FieldResult:
    """Rule, not reading: Vietnamese-only letters in a grounded title or
    description mean "vi". Absence proves nothing, so no other language is
    ever guessed."""
    texts = [str(fields[f].value) for f in ("title", "subtitle", "description")
             if f in fields and isinstance(fields[f].value, str)]
    if any(vietnamese_letter_count(t) for t in texts):
        return FieldResult(field="language", status="INFERRED", value="vi", sources=["rule"],
                           reasons=["VIETNAMESE_LETTERS_IN_TEXT"])
    return FieldResult(field="language", status="MISSING")


def validate_extraction(raw: dict, uploaded: list[str], barcode: str | None = None) -> dict:
    """Model JSON (top level already checked) -> per-field results + warnings."""
    allowed = set(uploaded)
    by_field, warnings = parse_observations(raw, allowed)
    other_codes = parse_other_codes(raw, allowed)
    barcode_obs, barcode_code = barcode_observation(barcode)
    if barcode_obs:
        by_field.setdefault("isbn", []).append(barcode_obs)
    if barcode_code:
        other_codes.append(barcode_code)
        warnings.append("BARCODE_NOT_ISBN")
    fields = {field: aggregate(field, by_field.get(field, [])) for field in OCR_FIELDS}
    fields["language"] = infer_language(fields)
    if fields["publicationYear"].status == "MISSING" and fields["printYear"].value:
        warnings.append("ONLY_PRINT_YEAR_FOUND")
    if any(c.get("value") for c in other_codes):
        warnings.append("NON_ISBN_CODES_FOUND")
    warnings.extend(parse_image_notes(raw, allowed))
    return {"fields": fields, "otherCodes": other_codes, "warnings": sorted(set(warnings))}
