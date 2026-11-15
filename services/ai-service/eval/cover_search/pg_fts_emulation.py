"""Research-only vector store whose KEYWORD branch follows the production SQL
semantics of PgVectorStore.search_keyword (KEYWORD_MODE="all"):

    WHERE tsv @@ plainto_tsquery('simple', unaccent(:query))  ORDER BY ts_rank(...)

i.e. a document matches only if it contains EVERY lexeme of the query, after
unaccent and lower-casing with the 'simple' configuration (no stemming, no
stop words). The repository's own InMemoryVectorStore instead scores any
token-substring overlap, which lets near-misses ("of", "oz", "the") into the
keyword ranking and inflates RRF scores — found in the pilot (see
PILOT_EXPERIMENT_REPORT.md). Semantic search is inherited unchanged.

Remaining, documented differences from Postgres:
- tokenisation approximates the default text-search parser (alphanumeric runs;
  a hyphenated compound also yields its parts, as the parser does);
- ts_rank is approximated by the summed frequency of the query lexemes, which
  only matters for ordering several documents that ALL contain every lexeme;
- unaccent is approximated by Unicode NFKD mark stripping plus đ/Đ → d.
"""
from __future__ import annotations

import re
import unicodedata
from collections import Counter

import vector_store

_WORD = re.compile(r"[0-9a-z]+(?:-[0-9a-z]+)*")


def unaccent_lower(text: str) -> str:
    value = unicodedata.normalize("NFKD", text or "")
    value = "".join(ch for ch in value if unicodedata.category(ch) != "Mn")
    return value.replace("đ", "d").replace("Đ", "D").lower()


def lexemes(text: str) -> list[str]:
    out: list[str] = []
    for match in _WORD.finditer(unaccent_lower(text)):
        word = match.group(0)
        out.append(word)
        if "-" in word:  # the default parser emits the compound and its parts
            out.extend(part for part in word.split("-") if part)
    return out


def plainto_tsquery_terms(query: str) -> list[str]:
    """plainto_tsquery ignores punctuation and ANDs every remaining word.
    Hyphenated compounds are reduced to their parts (the compound itself is
    not required)."""
    terms: list[str] = []
    for match in _WORD.finditer(unaccent_lower(query)):
        for part in match.group(0).split("-"):
            if part and part not in terms:
                terms.append(part)
    return terms


class PgSemanticsInMemoryStore(vector_store.InMemoryVectorStore):
    async def search_keyword(self, corpus: str, query: str, k: int, source_ids: list[str] | None = None):
        terms = plainto_tsquery_terms(query)
        if not terms:
            return []
        hits = []
        for doc, row in self._candidates(corpus, source_ids):
            counts = Counter(lexemes(row["content"]))
            if all(counts[t] > 0 for t in terms):
                hits.append(self._hit(doc, row, float(sum(counts[t] for t in terms))))
        hits.sort(key=lambda hit: (-hit.score, hit.source_id))
        return hits[:k]
