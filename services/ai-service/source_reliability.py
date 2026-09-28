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
    "googleBooks": {"default": 1.0, "title": 0.95, "authors": 0.9, "publisher": 0.82, "categories": 0.7},
    "openLibrary": {"default": 0.9, "title": 0.88, "authors": 0.86, "publisher": 0.76, "categories": 0.65},
    "worldCat": {"default": 0.85, "title": 0.9, "authors": 0.88, "publisher": 0.8},
    "fahasa": {"default": 0.8, "title": 0.85, "authors": 0.76, "publisher": 0.84, "categories": 0.72},
    "tiki": {"default": 0.8, "title": 0.8, "authors": 0.7, "publisher": 0.72, "categories": 0.7},
    "vinabook": {"default": 0.75, "title": 0.78, "authors": 0.68, "publisher": 0.72, "categories": 0.66},
    "webSearch": {"default": 0.55, "title": 0.6, "authors": 0.55, "publisher": 0.55},
}

def reliability(source: str, field: str) -> float:
    config = SOURCE_RELIABILITY.get(source, {})
    return float(config.get(field, config.get("default", 0)))
