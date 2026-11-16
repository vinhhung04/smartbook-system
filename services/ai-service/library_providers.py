"""Library and legal-deposit sources for the two-round ISBN search (isbn_rounds.py).

- loc / dnb: Library of Congress and Deutsche Nationalbibliothek SRU servers
  (free, no key), MARCXML. Code search is exact (`bath.isbn` / `num`), so both
  may identify a book in Round 1; title search feeds Round 2.
- ppdvn: the legal-deposit register of Cục Xuất bản, In và Phát hành
  (ppdvn.gov.vn "tra cứu lưu chiểu"). Its search matches titles only, not ISBNs
  (checked 2026-11-16), so it is Round 2 only; every row prints the ISBN, which
  isbn_rounds compares with the scanned code.

Adapters follow isbn_rounds.BookProvider: code searches return one record with
`identifiers`, title searches return candidate records.
"""
from __future__ import annotations

import html as html_module
import re
import unicodedata
import xml.etree.ElementTree as ET

import httpx

import isbn_matching

LOC_SRU_URL = "https://lx2.loc.gov/sru/lcdb"
DNB_SRU_URL = "https://services.dnb.de/sru/dnb"
PPDVN_SEARCH_URL = "https://ppdvn.gov.vn/web/guest/tra-cuu-luu-chieu"
TITLE_CANDIDATES = 3

_MARC = "{http://www.loc.gov/MARC21/slim}"
# MARC 008/35-37 (ISO 639-2/B) -> the ISO 639-1 codes the rest of the lookup uses.
_LANGUAGES = {"vie": "vi", "eng": "en", "ger": "de", "fre": "fr", "jpn": "ja", "chi": "zh", "kor": "ko",
              "spa": "es", "rus": "ru", "ita": "it"}
_TRANSLATOR_ROLES = re.compile(r"\b(trl|translator|übersetzer)\b", re.IGNORECASE)
_AUTHOR_ROLES = re.compile(r"\b(aut|author|verfasser)\b", re.IGNORECASE)


_SHAPE_MARKS = "̛̂̆"  # circumflex, breve, horn
_COMBINING_RUN = re.compile(r"[̀-ͯ]{2,}")


def _nfc(value: str) -> str:
    """LoC's MARC-8 records put the tone mark before the vowel's shape mark
    ("a" + acute + circumflex), which NFC cannot compose into "ấ"; the shape mark
    has to come first. Combining marks share class 230, so NFC never reorders them."""
    decomposed = _COMBINING_RUN.sub(
        lambda m: "".join(sorted(m.group(0), key=lambda ch: ch not in _SHAPE_MARKS)),
        unicodedata.normalize("NFD", value))
    return unicodedata.normalize("NFC", decomposed)


def _clean(value: str | None) -> str | None:
    """NFC (LoC sends decomposed Vietnamese diacritics) and trailing ISBD punctuation off."""
    if not value:
        return None
    text = re.sub(r"\s+", " ", _nfc(value)).strip()
    text = re.sub(r"\s*[/:;,=]+$", "", text).strip()
    if text.endswith(".") and not re.search(r"\b\w\.$", text):  # keep "Robert C."
        text = text[:-1].rstrip()
    return text or None


def _subfields(field: ET.Element, code: str) -> list[str]:
    return [sf.text or "" for sf in field.findall(f"{_MARC}subfield") if sf.get("code") == code]


def _first(field: ET.Element | None, code: str) -> str | None:
    values = _subfields(field, code) if field is not None else []
    return _clean(values[0]) if values else None


def _person(field: ET.Element, vietnamese: bool) -> str | None:
    """"Martin, Robert C." -> "Robert C. Martin"; Vietnamese names keep their
    order ("Phạm, Gia Đức" -> "Phạm Gia Đức") - the family name is already first."""
    name = _first(field, "a")
    if not name:
        return None
    if "," in name:
        family, given = (part.strip() for part in name.split(",", 1))
        name = f"{family} {given}" if vietnamese else f"{given} {family}"
    return name.strip() or None


def parse_marc_record(record: ET.Element, source_url: str | None) -> dict | None:
    fields: dict[str, list[ET.Element]] = {}
    for field in record:
        fields.setdefault(field.get("tag") or "", []).append(field)
    title_field = (fields.get("245") or [None])[0]
    title = _first(title_field, "a")
    if not title:
        return None

    control_008 = (fields.get("008") or [None])[0]
    fixed = control_008.text if control_008 is not None and control_008.text else ""
    language_code = fixed[35:38] if len(fixed) >= 38 else ""
    if not language_code.strip(" |"):
        language_code = _first((fields.get("041") or [None])[0], "a") or ""
    vietnamese = language_code == "vie"

    authors, translators = [], []
    for field in fields.get("100", []) + fields.get("700", []):
        roles = " ".join(_subfields(field, "e") + _subfields(field, "4"))
        name = _person(field, vietnamese)
        if not name:
            continue
        if _TRANSLATOR_ROLES.search(roles):
            translators.append(name)
        elif not roles or _AUTHOR_ROLES.search(roles):  # editors, illustrators... are not authors
            authors.append(name)

    # 264 with 2nd indicator 1 = publication; older records use 260.
    imprint = next((f for f in fields.get("264", []) if f.get("ind2") == "1"), None) \
        or (fields.get("264") or fields.get("260") or [None])[0]
    date = _first(imprint, "c")
    year = re.search(r"\d{4}", date or "") or re.search(r"\d{4}", fixed[7:11])
    extent = _first((fields.get("300") or [None])[0], "a") or ""
    pages = re.findall(r"(\d+)\s*(?:p\b|pages|Seiten|tr\b|trang)", extent)

    identifiers = []
    for field in fields.get("020", []):
        for value in _subfields(field, "a"):
            match = re.match(r"\s*([0-9Xx-]{10,17})", value)
            if match:
                identifiers.append(isbn_matching.normalize_code(match.group(1)))
    categories = list(dict.fromkeys(c for f in fields.get("650", []) if (c := _first(f, "a"))))[:5]
    summary = _first((fields.get("520") or [None])[0], "a")

    return {
        "title": title,
        "subtitle": _first(title_field, "b"),
        "authors": list(dict.fromkeys(authors)),
        "translator": list(dict.fromkeys(translators)),
        "publisher": _first(imprint, "b"),
        "publishedDate": year.group(0) if year else None,
        "description": summary,
        "categories": categories,
        "language": _LANGUAGES.get(language_code),
        "pageCount": int(pages[-1]) if pages and int(pages[-1]) < 20000 else None,
        "thumbnail": None,
        "identifiers": [code for code in dict.fromkeys(identifiers) if code],
        "sourceUrl": source_url,
        "sourceFetchMode": "api",
    }


def parse_sru_response(payload: str, source_url) -> list[dict]:
    """Every MARCXML record of an SRU searchRetrieve response. `source_url(record)`
    builds the record's public page from its control number (001)."""
    try:
        root = ET.fromstring(payload)
    except ET.ParseError:
        return []
    records = []
    for record in root.iter(f"{_MARC}record"):
        control = next((f.text for f in record if f.get("tag") == "001" and f.text), None)
        parsed = parse_marc_record(record, source_url(control.strip()) if control else None)
        if parsed:
            records.append(parsed)
    return records


def _cql_phrase(value: str) -> str:
    return '"' + re.sub(r'["\\]', " ", value).strip() + '"'


async def _sru(client: httpx.AsyncClient, url: str, schema: str, query: str, limit: int, source_url) -> list[dict]:
    resp = await client.get(url, params={"version": "1.1", "operation": "searchRetrieve", "query": query,
                                         "recordSchema": schema, "maximumRecords": str(limit)})
    resp.raise_for_status()
    return parse_sru_response(resp.text, source_url)


def _pick_by_code(records: list[dict], code: str) -> dict | None:
    """The record carrying the code; else the first one (so the caller can report a MISMATCH)."""
    return next((r for r in records if code in r["identifiers"]), records[0] if records else None)


# ── Library of Congress ───────────────────────────────────────────────────────

def _loc_url(control: str) -> str:
    return f"https://lccn.loc.gov/{control}"


async def loc_by_code(client: httpx.AsyncClient, code: str) -> dict | None:
    return _pick_by_code(await _sru(client, LOC_SRU_URL, "marcxml", f"bath.isbn={code}", 2, _loc_url), code)


async def loc_by_title(client: httpx.AsyncClient, title: str, author: str | None) -> list[dict]:
    query = f"bath.title={_cql_phrase(title)}" + (f" and bath.author={_cql_phrase(author)}" if author else "")
    return await _sru(client, LOC_SRU_URL, "marcxml", query, TITLE_CANDIDATES, _loc_url)


# ── Deutsche Nationalbibliothek ───────────────────────────────────────────────

def _dnb_url(control: str) -> str:
    return f"https://d-nb.info/{control}"


async def dnb_by_code(client: httpx.AsyncClient, code: str) -> dict | None:
    return _pick_by_code(await _sru(client, DNB_SRU_URL, "MARC21-xml", f"num={code}", 2, _dnb_url), code)


async def dnb_by_title(client: httpx.AsyncClient, title: str, author: str | None) -> list[dict]:
    query = f"tit={_cql_phrase(title)}" + (f" and per={_cql_phrase(author)}" if author else "")
    return await _sru(client, DNB_SRU_URL, "MARC21-xml", query, TITLE_CANDIDATES, _dnb_url)


# ── PPDVN (Cục Xuất bản, In và Phát hành - lưu chiểu) ─────────────────────────

_PPDVN_TITLES = re.compile(r"^((PGS|GS|TSKH|TS|ThS|Th\.S|BS|KS|CN|NCS|NGƯT|NGND|NSƯT|NSND)\.?\s*)+", re.IGNORECASE)


def _ppdvn_people(value: str) -> list[str]:
    value = re.sub(r"\([^)]*\)", " ", value)  # "(chủ biên)", "(đồng chủ biên)"
    names = []
    for part in re.split(r",|;|\bvà\b", value):
        part = _PPDVN_TITLES.sub("", part.strip()).strip(" .-")
        if part and part.lower() not in ("nhiều tác giả", "đang cập nhật"):
            names.append(part)
    return list(dict.fromkeys(names))


def parse_ppdvn_results(page: str, source_url: str) -> list[dict]:
    """Rows of the lưu chiểu table: STT, ISBN, tên sách, tác giả, biên tập viên,
    NXB, đối tác liên kết, nơi in, ngày nộp lưu chiểu."""
    start = page.find("<table")
    table = page[start:page.find("</table>", start)] if start >= 0 else ""
    results = []
    for row in re.findall(r"<tr>(.*?)</tr>", table, flags=re.DOTALL):
        cells = [_clean(html_module.unescape(re.sub(r"<[^>]+>", " ", c)))
                 for c in re.findall(r"<td[^>]*>(.*?)</td>", row, flags=re.DOTALL)]
        if len(cells) < 9 or not cells[1] or not cells[2]:
            continue  # header row, or "Không tìm thấy dữ liệu"
        publisher = cells[5]
        if publisher and not re.match(r"(?i)(nxb|nhà xuất bản)\b", publisher):
            publisher = f"NXB {publisher}"  # the column is "Nhà xuất bản": "Hội Nhà văn" = NXB Hội Nhà văn
        code = isbn_matching.normalize_code(cells[1])
        results.append({
            "title": cells[2], "subtitle": None,
            "authors": _ppdvn_people(cells[3] or ""), "translator": [],
            "publisher": publisher,
            # The deposit date is when this printing was filed, not the edition's
            # publication date, so it is not reported as publishedDate.
            "publishedDate": None, "description": None, "categories": [], "language": None,
            "pageCount": None, "thumbnail": None,
            "identifiers": [code] if code else [],
            "sourceUrl": source_url, "sourceFetchMode": "html",
        })
    # Reprints repeat the same ISBN row once per printing: keep one per code.
    unique = {}
    for item in results:
        unique.setdefault(tuple(item["identifiers"]) or (item["title"],), item)
    return list(unique.values())


async def ppdvn_by_title(client: httpx.AsyncClient, title: str, author: str | None) -> list[dict]:
    resp = await client.get(PPDVN_SEARCH_URL, params={"query": title})
    resp.raise_for_status()
    return parse_ppdvn_results(resp.text, str(resp.url))
