import calendar
import html
import re
import unicodedata


def clean(value):
    return re.sub(r'\s+', ' ', unicodedata.normalize('NFC', html.unescape(str(value)))).strip()


def key(value):
    if isinstance(value, list):
        return tuple(sorted({key(v) for v in value}))
    return clean(value).casefold()


def normalize(field, value):
    if value is None:
        return None
    if field in {'authors', 'translator', 'categories'}:
        values = value if isinstance(value, list) else re.split(r';|\s+&\s+', str(value))
        return list(dict.fromkeys(clean(v) for v in values if isinstance(v, str) and clean(v))) or None
    if field == 'pageCount':
        match = re.fullmatch(r'(\d{1,5})(?:\s*(?:trang|pages?))?', clean(value), re.I)
        return int(match[1]) if match and 0 < int(match[1]) <= 10000 else None
    if field == 'isbn':
        from .verification import canonical_isbn
        return canonical_isbn(value)
    if field == 'publishedDate':
        text = clean(value)
        # Ambiguous numeric locale dates abstain; no invented month/day.
        if not re.fullmatch(r'\d{4}(?:-\d{2})?(?:-\d{2})?', text):
            return None
        parts = [int(p) for p in text.split('-')]
        if not 1000 <= parts[0] <= 2999:
            return None
        if len(parts) > 1 and not 1 <= parts[1] <= 12:
            return None
        if len(parts) > 2 and not 1 <= parts[2] <= calendar.monthrange(*parts[:2])[1]:
            return None
        return text
    if isinstance(value, (dict, list, bool)):
        return None
    return clean(value) or None
