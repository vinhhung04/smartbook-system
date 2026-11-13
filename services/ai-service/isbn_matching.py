"""Identity checks used by the two-round ISBN search (isbn_rounds.py).

Pure module (no I/O) - unit tested in test_isbn_matching.py.

Codes: an ISBN-13 always starts with 978/979. Vietnamese books also carry a
publisher EAN-13 (893...) that is NOT an ISBN, so an EAN and an ISBN can never
be compared directly - a record that only shows the book's ISBN is neither a
match nor a mismatch for a scanned EAN.
"""
from __future__ import annotations

import re
from difflib import SequenceMatcher

from intent import normalize_text

TITLE_MATCH_MODE = "round2-title-match"
# Fields that describe the work rather than one printing of it - the only ones a
# title-only match may contribute (translator/publisher/pages/cover are per edition).
WORK_FIELDS = ("title", "authors", "description", "categories", "language")
_EDITION_FIELDS_EMPTY = {
    "subtitle": None, "translator": [], "publisher": None, "publishedDate": None, "pageCount": None, "thumbnail": None,
}

_TITLE_NOISE = re.compile(r"\b(tai ban( lan thu \d+)?|bia mem|bia cung|tb|vanlangbooks|thaihabooks)\b")


# ── codes ─────────────────────────────────────────────────────────────────────

def normalize_code(value) -> str:
    return re.sub(r"[^0-9X]", "", str(value or "").upper())


def code_namespace(code: str) -> str:
    """"isbn" for ISBN-10/ISBN-13 (978/979), "ean" for any other 13-digit code."""
    code = normalize_code(code)
    if len(code) == 10 or (len(code) == 13 and code[:3] in ("978", "979")):
        return "isbn"
    return "ean" if len(code) in (8, 12, 13, 14) else "other"


def compare_codes(identifiers, targets: set[str]) -> str:
    """MATCH if any identifier is one of the target codes, MISMATCH if the
    record carries a code of the same kind (ISBN vs EAN) that differs,
    UNKNOWN when there is nothing comparable (no codes, or only the other kind)."""
    found = {normalize_code(x) for x in (identifiers or []) if normalize_code(x)}
    if not found:
        return "UNKNOWN"
    if found & targets:
        return "MATCH"
    target_kinds = {code_namespace(t) for t in targets}
    if any(code_namespace(code) in target_kinds for code in found):
        return "MISMATCH"
    return "UNKNOWN"


# ── titles and authors ────────────────────────────────────────────────────────

def normalize_title(value: str | None) -> str:
    """"Sách Nhà Giả Kim (Tái Bản)" / "Nhà giả kim (TB 79.000)" -> "nha gia kim"."""
    text = normalize_text(value or "")
    text = re.sub(r"[\(\[][^\)\]]*[\)\]]", " ", text)
    text = re.sub(r"^\s*(sach|\[[^\]]*\])\s+", "", text)
    text = re.sub(r"[^a-z0-9 ]", " ", text)
    text = _TITLE_NOISE.sub(" ", text)
    return re.sub(r"\s+", " ", text).strip()


def title_similarity(a: str | None, b: str | None) -> float:
    """1.0 same title, 0.95 one title + appended subtitle/author, else a ratio."""
    na, nb = normalize_title(a), normalize_title(b)
    if not na or not nb:
        return 0.0
    if na == nb:
        return 1.0
    shorter, longer = sorted((na, nb), key=len)
    if len(shorter.split()) >= 2 and longer.startswith(shorter + " "):
        return 0.95
    return round(SequenceMatcher(None, na, nb).ratio(), 3)


def titles_match(a: str | None, b: str | None) -> bool:
    return title_similarity(a, b) >= 0.9


def _author_tokens(name: str) -> frozenset[str]:
    name = re.sub(r"^[^:]{1,20}:\s*", "", str(name))  # "Biên soạn: X" -> "X"
    return frozenset(re.sub(r"[^a-z0-9 ]", " ", normalize_text(name)).split())


def authors_match(a: list[str] | None, b: list[str] | None) -> bool | None:
    """None when either side has no authors. Token-set containment so
    "Coelho, Paulo" matches "Paulo Coelho"."""
    ta = [t for t in (_author_tokens(x) for x in (a or []) if str(x).strip()) if t]
    tb = [t for t in (_author_tokens(x) for x in (b or []) if str(x).strip()) if t]
    if not ta or not tb:
        return None
    return any(x <= y or y <= x for x in ta for y in tb)


def same_work_confidence(identity: dict, candidate: dict) -> float:
    """0 when not the same work. Title must match and authors must not
    disagree; without authors on both sides only an exact title counts."""
    similarity = title_similarity(identity.get("title"), candidate.get("title"))
    if similarity < 0.9:
        return 0.0
    authors = authors_match(identity.get("authors"), candidate.get("authors"))
    if authors is False:
        return 0.0
    if authors is None:
        return 0.75 if similarity == 1.0 else 0.0
    return round(0.9 * similarity, 3)


def align_title(identity_title: str | None, data: dict) -> dict:
    """A title equal to the identity's once listing noise is removed takes the
    identity's spelling, so fusion counts it as agreement."""
    title = data.get("title")
    if identity_title and title and normalize_title(title) == normalize_title(identity_title):
        return {**data, "title": identity_title}
    return data


def work_fields_only(candidate: dict) -> dict:
    """Keep only edition-independent fields of a title-only match."""
    data = {field: candidate.get(field) for field in WORK_FIELDS}
    data["authors"] = data["authors"] or []
    data["categories"] = data["categories"] or []
    data.update(_EDITION_FIELDS_EMPTY)
    data["translator"] = []
    data["sourceUrl"] = candidate.get("sourceUrl")
    data["identifiers"] = candidate.get("identifiers") or []
    data["sourceFetchMode"] = TITLE_MATCH_MODE
    return data
