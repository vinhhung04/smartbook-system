"""Initial documented priors for ISBN source selection; not measured accuracy."""
SOURCE_RELIABILITY = {
    "googleBooks": {"default": 1.0, "title": 0.95, "authors": 0.9, "publisher": 0.82, "categories": 0.7},
    "openLibrary": {"default": 0.9, "title": 0.88, "authors": 0.86, "publisher": 0.76, "categories": 0.65},
    "worldCat": {"default": 0.85, "title": 0.9, "authors": 0.88, "publisher": 0.8},
    "fahasa": {"default": 0.8, "title": 0.85, "authors": 0.76, "publisher": 0.84, "categories": 0.72},
    "tiki": {"default": 0.8, "title": 0.8, "authors": 0.7, "publisher": 0.72, "categories": 0.7},
    "vinabook": {"default": 0.75, "title": 0.78, "authors": 0.68, "publisher": 0.72, "categories": 0.66},
}

def reliability(source: str, field: str) -> float:
    config = SOURCE_RELIABILITY.get(source, {})
    return float(config.get(field, config.get("default", 0)))
