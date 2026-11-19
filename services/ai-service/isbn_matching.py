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
from metadata_intelligence.verification import canonical_isbn

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


def _author_letters(name: str) -> str:
    """The name's letters, spacing and order aside: "Renee Mc Gregor" == "Renee McGregor"
    (seen live: a store vs. the legal-deposit register, 2026-11-18)."""
    name = re.sub(r"^[^:]{1,20}:\s*", "", str(name))  # "Biên soạn: X" -> "X"
    return "".join(sorted(re.sub(r"[^a-z0-9]", "", normalize_text(name))))


def authors_match(a: list[str] | None, b: list[str] | None) -> bool | None:
    """None when either side has no authors. Token-set containment so
    "Coelho, Paulo" matches "Paulo Coelho"; or the same letters once spaces are
    ignored, so "Renee Mc Gregor" matches "Renee McGregor" (long names only)."""
    names_a = [x for x in (a or []) if str(x).strip() and _author_tokens(x)]
    names_b = [y for y in (b or []) if str(y).strip() and _author_tokens(y)]
    if not names_a or not names_b:
        return None
    return any(_author_tokens(x) <= _author_tokens(y) or _author_tokens(y) <= _author_tokens(x)
               or (len(_author_letters(x)) >= 8 and _author_letters(x) == _author_letters(y))
               for x in names_a for y in names_b)


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
    # Never fused (a title match may be another edition); kept only so the ISBN -> EAN
    # check (store_ean_link) can require the same publisher and compare the year.
    data["_edition"] = {"publisher": candidate.get("publisher"), "publishedDate": candidate.get("publishedDate"),
                        "authors": candidate.get("authors") or []}
    return data


# ── EAN-13 <-> ISBN cross identification ──────────────────────────────────────

def ean13_valid(code) -> bool:
    """A 13-digit code with a correct EAN-13 check digit (ISBN-13 shares it)."""
    code = normalize_code(code)
    return (len(code) == 13 and code.isdigit()
            and sum(int(c) * (3 if i % 2 else 1) for i, c in enumerate(code)) % 10 == 0)


def _publisher_key(value) -> str:
    return re.sub(r"^(nha xuat ban|nha xb|nxb)\s+", "", re.sub(r"[^a-z0-9 ]", " ", normalize_text(value or "")).strip())


def _year(value) -> str | None:
    match = re.search(r"\d{4}", str(value or ""))
    return match[0] if match else None


def cross_identify(scanned: str, records: dict[str, dict], identity: dict | None) -> dict:
    """Links a scanned retail EAN-13 to the book's ISBN (or a scanned ISBN to its
    retail EAN-13) - never by converting digits, only from a record that was
    found by the scanned code (CODE_MATCH) and states BOTH codes itself.

    VERIFIED         one linked code, stated by >= 2 sources or by the library's own
                     catalog, and those records agree with the identified book
    REVIEW_REQUIRED  one linked code from a single source, or publisher / year differ
    CONFLICTED       sources state different codes, or a record's title / authors are
                     another book's
    NOT_FOUND        no record states a second code
    """
    code = normalize_code(scanned)
    scanned_isbn = canonical_isbn(code)
    direction = "ISBN_TO_EAN" if scanned_isbn else "EAN_TO_ISBN"
    own = {code, scanned_isbn} - {None}
    evidence = []
    for source, data in (records or {}).items():
        if not data or (data.get("_provenance") or {}).get("verification") != "CODE_MATCH":
            continue  # a title-only match says nothing about which codes belong together
        codes = {normalize_code(c) for c in data.get("identifiers") or [] if normalize_code(c)}
        if not ({canonical_isbn(c) for c in codes} | codes) & own:
            continue  # matched through another code (e.g. the ISBN alone): not proof of this link
        if direction == "EAN_TO_ISBN":
            linked = {canonical_isbn(c) for c in codes if code_namespace(c) == "isbn" and canonical_isbn(c)}
        else:
            linked = {c for c in codes if code_namespace(c) == "ean" and ean13_valid(c) and c not in own}
        if linked:
            evidence.append({"source": source, "codes": sorted(linked), "sourceUrl": data.get("sourceUrl"),
                             "title": data.get("title"), "publisher": data.get("publisher"),
                             "publishedDate": data.get("publishedDate")})
    values = sorted({value for item in evidence for value in item["codes"]})
    result = {"direction": direction, "scannedCode": code, "status": "NOT_FOUND", "value": None,
              "isbn10": None, "evidence": evidence, "reasons": []}
    if not values:
        return result
    if len(values) > 1:
        return {**result, "status": "CONFLICTED", "reasons": ["SOURCES_DISAGREE"]}
    value = values[0]
    identity = identity or {}
    reasons = []
    for item in evidence:
        record = records[item["source"]]
        if identity.get("title") and record.get("title") and not titles_match(identity["title"], record["title"]):
            reasons.append("TITLE_MISMATCH")
        if authors_match(identity.get("authors"), record.get("authors")) is False:
            reasons.append("AUTHOR_MISMATCH")
        if (_publisher_key(identity.get("publisher")) and _publisher_key(record.get("publisher"))
                and _publisher_key(identity.get("publisher")) != _publisher_key(record.get("publisher"))):
            reasons.append("PUBLISHER_DIFFERS")
        if _year(identity.get("publishedDate")) and _year(record.get("publishedDate")) \
                and _year(identity.get("publishedDate")) != _year(record.get("publishedDate")):
            reasons.append("YEAR_DIFFERS")
    reasons = sorted(set(reasons))
    sources = {item["source"] for item in evidence}
    if {"TITLE_MISMATCH", "AUTHOR_MISMATCH"} & set(reasons):
        status = "CONFLICTED"
    elif reasons or (len(sources) < 2 and "catalog" not in sources):
        status = "REVIEW_REQUIRED"
        reasons = reasons or ["SINGLE_SOURCE"]
    else:
        status = "VERIFIED"
        reasons = ["CATALOG_RECORD" if "catalog" in sources else "MULTI_SOURCE_AGREEMENT"]
    isbn10 = _isbn10(value) if direction == "EAN_TO_ISBN" else None
    return {**result, "status": status, "value": value, "isbn10": isbn10, "reasons": reasons}


def _isbn10(isbn13: str) -> str | None:
    """The ISBN-10 of a 978 ISBN-13 (a 979 ISBN has none)."""
    if not isbn13.startswith("978"):
        return None
    core = isbn13[3:12]
    check = (11 - sum((10 - i) * int(c) for i, c in enumerate(core)) % 11) % 11
    return core + ("X" if check == 10 else str(check))


def registry_link(cross: dict, identity: dict | None, rows: list[dict], source: str = "ppdvn") -> dict:
    """When no record states both codes, the national legal-deposit register (PPDVN)
    may still list the edition's ISBN - by title, never by barcode. A register row
    counts only when its title matches the identified book's, its publisher is the
    same and its authors do not disagree: never on the title alone. No record ties the
    barcode to that ISBN, so the link is at best REVIEW_REQUIRED; several ISBNs
    (reprints under new ISBNs, other editions) -> CONFLICTED. Only used to fill a
    cross_identify NOT_FOUND for a scanned EAN."""
    if cross.get("direction") != "EAN_TO_ISBN" or cross.get("status") != "NOT_FOUND" or not identity:
        return cross
    evidence = []
    for row in rows or []:
        isbns = {canonical_isbn(code) for code in row.get("identifiers") or []} - {None}
        basis = _edition_basis(identity, row.get("title"), row.get("publisher"), row.get("authors"))
        if not isbns or not basis:
            continue
        years = sorted({int(year) for year in (_year(d) for d in row.get("depositDates") or []) if year})
        evidence.append({"source": source, "codes": sorted(isbns), "sourceUrl": row.get("sourceUrl"),
                         "title": row.get("title"), "publisher": row.get("publisher"), "publishedDate": None,
                         "partner": row.get("partner"), "depositDates": row.get("depositDates") or [],
                         "years": years, "basis": basis})
    return _offer_candidates(cross, identity, evidence, "LEGAL_DEPOSIT_TITLE_MATCH", "LEGAL_DEPOSIT_SEVERAL_ISBNS")


def store_ean_link(cross: dict, identity: dict | None, records: dict[str, dict]) -> dict:
    """The ISBN -> EAN counterpart of registry_link. A scanned ISBN's retail EAN-13 is
    rarely stated on the same record, but the stores Round 2 found BY TITLE list their
    products under that EAN. A title-matched record counts only with the same title,
    the same publisher and authors that do not disagree; never better than
    REVIEW_REQUIRED, several EANs (other covers / distributors) -> candidates."""
    if cross.get("direction") != "ISBN_TO_EAN" or cross.get("status") != "NOT_FOUND" or not identity:
        return cross
    evidence = []
    for source, data in (records or {}).items():
        if not data or (data.get("_provenance") or {}).get("verification") != "TITLE_MATCH":
            continue  # code matches were already judged by cross_identify
        edition = data.get("_edition") or data
        eans = {normalize_code(c) for c in data.get("identifiers") or []}
        eans = {c for c in eans if code_namespace(c) == "ean" and ean13_valid(c)}
        basis = _edition_basis(identity, data.get("title"), edition.get("publisher"), edition.get("authors"))
        if not eans or not basis:
            continue
        year = _year(edition.get("publishedDate"))
        evidence.append({"source": source, "codes": sorted(eans), "sourceUrl": data.get("sourceUrl"),
                         "title": data.get("title"), "publisher": edition.get("publisher"),
                         "publishedDate": edition.get("publishedDate"), "partner": None, "depositDates": [],
                         "years": [int(year)] if year else [], "basis": basis})
    return _offer_candidates(cross, identity, evidence, "STORE_TITLE_MATCH", "STORE_SEVERAL_EANS")


def _edition_basis(identity: dict, title, publisher, authors) -> str | None:
    """TITLE_PUBLISHER_AUTHOR / TITLE_PUBLISHER when a record found by title is the
    identified book's edition, None otherwise. Never on the title alone: the publisher
    must be known on both sides and the same; authors may be unknown, never different."""
    identity_publisher = _publisher_key(identity.get("publisher"))
    if not identity.get("title") or not identity_publisher or title_similarity(identity["title"], title) < 0.9:
        return None
    if _publisher_key(publisher) != identity_publisher:
        return None
    match = authors_match(identity.get("authors"), authors)
    if match is False:
        return None
    return "TITLE_PUBLISHER_AUTHOR" if match else "TITLE_PUBLISHER"


def _offer_candidates(cross: dict, identity: dict, evidence: list[dict], one_reason: str, many_reason: str) -> dict:
    """One code -> REVIEW_REQUIRED with it. Several (a book reprinted under new ISBNs,
    or sold under several EANs) -> CONFLICTED with every candidate for staff to choose;
    when exactly one candidate's year (deposit / listing) is the edition's year it is
    the `preferred` one and listed first - a hint for the reviewer, never applied."""
    if not evidence:
        return cross
    is_isbn = cross.get("direction") == "EAN_TO_ISBN"
    grouped: dict[str, dict] = {}
    for item in evidence:
        for code in item["codes"]:
            entry = grouped.setdefault(code, {"value": code, "isbn10": _isbn10(code) if is_isbn else None,
                                              "sources": [], "titles": [], "publisher": item.get("publisher"),
                                              "partner": item.get("partner"), "years": set(), "depositDates": [],
                                              "sourceUrl": item.get("sourceUrl"), "basis": item["basis"]})
            entry["sources"] = sorted({*entry["sources"], item["source"]})
            if item.get("title") and item["title"] not in entry["titles"]:
                entry["titles"].append(item["title"])
            entry["years"].update(item.get("years") or [])
            entry["depositDates"] += [d for d in item.get("depositDates") or [] if d not in entry["depositDates"]]
            if item["basis"] == "TITLE_PUBLISHER_AUTHOR":
                entry["basis"] = item["basis"]
    edition_year = _year(identity.get("publishedDate"))
    same_year = [code for code, entry in grouped.items() if edition_year and int(edition_year) in entry["years"]]
    preferred = same_year[0] if len(same_year) == 1 else None
    candidates = sorted(grouped.values(), key=lambda c: (c["value"] != preferred, -max(c["years"], default=0), c["value"]))
    for candidate in candidates:
        candidate["years"] = sorted(candidate["years"])
        candidate["preferred"] = candidate["value"] == preferred
    authors_checked = any(c["basis"] == "TITLE_PUBLISHER_AUTHOR" for c in candidates)
    checks = ["PUBLISHER_MATCH", "AUTHOR_MATCH" if authors_checked else "AUTHORS_UNCHECKED"]
    if len(candidates) == 1:
        only = candidates[0]
        return {**cross, "status": "REVIEW_REQUIRED", "value": only["value"], "isbn10": only["isbn10"],
                "evidence": evidence, "candidates": candidates, "preferred": None, "reasons": [one_reason, *checks]}
    return {**cross, "status": "CONFLICTED", "value": None, "isbn10": None, "evidence": evidence,
            "candidates": candidates, "preferred": preferred,
            "reasons": [many_reason, *checks, *(["PREFERRED_BY_YEAR"] if preferred else [])]}
