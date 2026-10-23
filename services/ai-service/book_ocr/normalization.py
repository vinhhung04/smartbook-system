"""Value normalization for OCR readings. Builds on Metadata Intelligence's
own helpers (NFC + whitespace `clean`, list splitting, `canonical_isbn`
checksum + ISBN-10 -> ISBN-13) instead of a second copy of those rules.
Nothing here corrects spelling or adds diacritics: a reading is kept as read,
or rejected with a reason code."""
from __future__ import annotations

import datetime
import re
import unicodedata

from metadata_intelligence.normalization import clean, normalize as mi_normalize
from metadata_intelligence.verification import canonical_isbn

LIST_FIELDS = {"authors", "translators"}
YEAR_FIELDS = {"publicationYear", "printYear", "copyrightYear"}
TEXT_LIMITS = {"title": 300, "subtitle": 300, "publisher": 200, "distributor": 200,
               "editionStatement": 200, "coverPrice": 60, "description": 3000}
# Phrases a model writes instead of leaving a field out.
_HEDGES = {"null", "none", "n/a", "unknown", "không rõ", "không có", "không đọc được",
           "không xác định", "không tìm thấy", "chưa rõ", "?"}
_VI_LETTERS = re.compile("[ăâđêôơưàáạảãằắặẳẵầấậẩẫèéẹẻẽềếệểễìíịỉĩòóọỏõồốộổỗờớợởỡùúụủũừứựửữỳýỵỷỹ]", re.I)


def key(value: str) -> str:
    """Case/whitespace-insensitive, diacritics-SENSITIVE comparison key."""
    return clean(value).casefold()


def words(value: str) -> str:
    """Case- and punctuation-insensitive, diacritics-SENSITIVE: "Frieren - Pháp sư"
    and "FRIEREN PHÁP SƯ" are the same words; "tiến" and "tiễn" are not."""
    return " ".join(re.findall(r"\w+", key(value)))


def fold(value: str) -> str:
    """Case- and diacritics-insensitive key ("Nhà Giả Kim" == "NHA GIA KIM")."""
    text = clean(value).casefold().replace("đ", "d")
    text = "".join(c for c in unicodedata.normalize("NFD", text) if unicodedata.category(c) != "Mn")
    return re.sub(r"[^\w]+", " ", text).strip()


def vietnamese_letter_count(value: str) -> int:
    return len(_VI_LETTERS.findall(value or ""))


def is_all_caps(value: str) -> bool:
    letters = [c for c in value if c.isalpha()]
    return bool(letters) and all(c.isupper() for c in letters)


def isbn_digits(value) -> str:
    return re.sub(r"[^0-9X]", "", str(value or "").upper())


def isbn_issue(raw) -> str | None:
    """Why a reading is not a usable ISBN (None when it is)."""
    digits = isbn_digits(raw)
    if canonical_isbn(digits):
        return None
    if len(digits) == 13 and digits.isdigit() and not digits.startswith(("978", "979")):
        return "NOT_ISBN_PREFIX"  # e.g. an 893... retail EAN printed under the barcode
    if len(digits) not in (10, 13):
        return "INVALID_FORMAT"
    return "INVALID_CHECKSUM"


def normalize_observation(field: str, value) -> tuple[object, list[str]]:
    """(normalized value, blocking issue codes). An empty list of issues means
    the reading is well-formed; whether it is grounded is checked separately."""
    if value is None or value == "" or value == []:
        return None, ["EMPTY"]
    if field in LIST_FIELDS:
        items = value if isinstance(value, list) else re.split(r",|;|\s+&\s+", str(value))
        if any(not isinstance(item, str) for item in items):
            return None, ["INVALID_FORMAT"]
        items = [item for item in (clean(i) for i in items) if item and item.casefold() not in _HEDGES]
        normalized = mi_normalize("authors", items)
        if not normalized:
            return None, ["EMPTY"]
        if any(len(item) > 120 for item in normalized):
            return None, ["INVALID_FORMAT"]
        return normalized, []
    if isinstance(value, list):
        # ["NXB Kim Đồng"] for a single-valued field is unambiguous; two values are not.
        if len(value) != 1 or not isinstance(value[0], str):
            return None, ["INVALID_FORMAT"]
        value = value[0]
    if field == "isbn":
        issue = isbn_issue(value)
        return (canonical_isbn(isbn_digits(value)), []) if issue is None else (None, [issue])
    if field in YEAR_FIELDS:
        text = clean(value)
        if not re.fullmatch(r"\d{4}", text):
            return None, ["INVALID_FORMAT"]
        year = int(text)
        if not 1800 <= year <= datetime.date.today().year + 1:
            return None, ["OUT_OF_RANGE"]
        return year, []
    if field == "pageCount":
        normalized = mi_normalize("pageCount", value)
        return (normalized, []) if normalized is not None else (None, ["OUT_OF_RANGE"])
    text = clean(value)
    if not text or text.casefold() in _HEDGES:
        return None, ["EMPTY"]
    if len(text) > TEXT_LIMITS.get(field, 300):
        return None, ["TOO_LONG"]
    return text, []
