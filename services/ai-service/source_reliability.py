"""Initial documented priors for ISBN source selection; not measured accuracy.

Rationale for the ordering (highest default first): googleBooks and openLibrary/
worldCat are library-grade bibliographic databases with editorial curation and
stable identifiers - the closest thing to a canonical record this service can
reach. The Vietnamese marketplaces (fahasa, tiki, vinabook) sell physical
books and so tend to have accurate title/author/price data (needed to fulfil
orders), but their publisher/category taxonomy is looser and sometimes
reflects the distributor rather than the publisher (see main.py's Vinabook
"phát hành" parsing note). fahasa ranks above tiki/vinabook for publisher
specifically because its listing pages are the most consistently structured
of the three for that field. webSearch is a free-text search-snippet fallback
with no structural guarantee at all, used only when nothing else answered -
hence the lowest default and the lowest per-field values throughout.
isbn_fusion.py additionally weighs each value's extraction method (structured
API/JSON-LD vs. DOM scrape vs. regex snippet vs. LLM inference) on top of
these source priors - see isbn_fusion.METHOD_RELIABILITY."""
SOURCE_RELIABILITY = {
    # The library's own catalog: records a librarian reviewed and saved.
    "catalog": {"default": 0.93, "title": 0.95, "authors": 0.93, "categories": 0.85},
    "googleBooks": {"default": 1.0, "title": 0.95, "authors": 0.9, "publisher": 0.82, "categories": 0.7},
    "openLibrary": {"default": 0.9, "title": 0.88, "authors": 0.86, "publisher": 0.76, "categories": 0.65},
    "worldCat": {"default": 0.85, "title": 0.9, "authors": 0.88, "publisher": 0.8},
    "fahasa": {"default": 0.8, "title": 0.85, "authors": 0.76, "publisher": 0.84, "categories": 0.72},
    "tiki": {"default": 0.8, "title": 0.8, "authors": 0.7, "publisher": 0.72, "categories": 0.7},
    "vinabook": {"default": 0.75, "title": 0.78, "authors": 0.68, "publisher": 0.72, "categories": 0.66},
    # Publishers' own storefronts (Nhã Nam, Đinh Tị, Thái Hà, Văn Lang) - the official
    # issuer of their own editions, so the strongest source for that edition's facts
    # once the record is tied to the scanned code (isbn_fusion discounts title-only
    # matches via METHOD_RELIABILITY["title_match"]).
    "nhanam": {"default": 0.9, "title": 0.95, "authors": 0.93, "translator": 0.93, "publisher": 0.88, "pageCount": 0.92, "categories": 0.6},
    "dinhTi": {"default": 0.9, "title": 0.95, "authors": 0.93, "translator": 0.93, "publisher": 0.9, "pageCount": 0.92, "categories": 0.6},
    "thaiHa": {"default": 0.88, "title": 0.93, "authors": 0.9, "categories": 0.6},
    "vanLang": {"default": 0.88, "title": 0.93, "categories": 0.6},
    "ipm": {"default": 0.88, "title": 0.93, "authors": 0.9, "translator": 0.9, "publisher": 0.88, "pageCount": 0.9, "categories": 0.6},
    "kimDong": {"default": 0.88, "title": 0.93, "authors": 0.9, "translator": 0.9, "publisher": 0.88, "pageCount": 0.9, "categories": 0.6},
    "azVietnam": {"default": 0.88, "title": 0.93, "authors": 0.9, "translator": 0.9, "publisher": 0.88, "pageCount": 0.9, "categories": 0.6},
    "omegaPlus": {"default": 0.88, "title": 0.93, "authors": 0.9, "translator": 0.9, "publisher": 0.88, "pageCount": 0.9, "categories": 0.6},
    "tanViet": {"default": 0.88, "title": 0.93, "authors": 0.9, "translator": 0.9, "publisher": 0.88, "pageCount": 0.9, "categories": 0.6},
    "alphaBooks": {"default": 0.88, "title": 0.93, "authors": 0.9, "translator": 0.9, "publisher": 0.88, "pageCount": 0.9, "categories": 0.6},
    # Bookstore chains: Nhân Văn has a full spec table; Phương Nam, Minh Long and Bizbooks
    # give little more than title/description, read from their own product JSON.
    "nhanVan": {"default": 0.88, "title": 0.93, "authors": 0.9, "translator": 0.9, "publisher": 0.88, "pageCount": 0.9, "categories": 0.6},
    "phuongNam": {"default": 0.88, "title": 0.93, "categories": 0.6},
    "minhLong": {"default": 0.85, "title": 0.9, "categories": 0.6},
    "bizbooks": {"default": 0.88, "title": 0.93, "categories": 0.6},
    # AI web search: a model READING cited pages; every value is checked against the page
    # text (ai_web_search.verify), still below sources read directly.
    "aiWebSearch": {"default": 0.75, "title": 0.8, "authors": 0.75, "publisher": 0.75, "pageCount": 0.75},
    "webSearch": {"default": 0.55, "title": 0.6, "authors": 0.55, "publisher": 0.55},
}

def reliability(source: str, field: str) -> float:
    config = SOURCE_RELIABILITY.get(source, {})
    return float(config.get(field, config.get("default", 0)))
