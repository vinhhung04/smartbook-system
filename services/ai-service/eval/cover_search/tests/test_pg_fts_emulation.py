import asyncio
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from common import setup_environment  # noqa: E402

setup_environment(load_secrets=False)

import vector_store  # noqa: E402
from pg_fts_emulation import PgSemanticsInMemoryStore, lexemes, plainto_tsquery_terms  # noqa: E402


def _run(coro):
    return asyncio.run(coro)


class TokenTests(unittest.TestCase):
    def test_unaccent_and_lower(self):
        self.assertEqual(plainto_tsquery_terms("Đất rừng phương Nam"), ["dat", "rung", "phuong", "nam"])

    def test_hyphen_compound_and_parts(self):
        self.assertEqual(lexemes("Công-Nông"), ["cong-nong", "cong", "nong"])
        self.assertEqual(plainto_tsquery_terms("Công-Nông"), ["cong", "nong"])


class SearchTests(unittest.TestCase):
    def setUp(self):
        self.store = PgSemanticsInMemoryStore()
        for sid, text in (("a", "The Lost King of Oz Ruth Plumly Thompson"),
                          ("b", "The Royal Book of Oz Ruth Plumly Thompson"),
                          ("c", "Số đỏ Vũ Trọng Phụng")):
            doc = _run(self.store.upsert_document(vector_store.CORPUS_BOOK, sid, sid, text, "h", {}))
            _run(self.store.upsert_chunks([vector_store.Chunk(document_id=doc, corpus=vector_store.CORPUS_BOOK,
                                                              chunk_index=0, content=text, content_hash="h",
                                                              embedding=[1.0], embedding_model="m")]))

    def test_every_term_required(self):
        hits = _run(self.store.search_keyword(vector_store.CORPUS_BOOK, "The Lost King of Oz Ruth Plumly Thompson", 10))
        self.assertEqual([h.source_id for h in hits], ["a"])

    def test_shared_author_terms_match_several(self):
        hits = _run(self.store.search_keyword(vector_store.CORPUS_BOOK, "Ruth Plumly Thompson", 10))
        self.assertEqual(sorted(h.source_id for h in hits), ["a", "b"])

    def test_vietnamese_without_accents_matches(self):
        hits = _run(self.store.search_keyword(vector_store.CORPUS_BOOK, "SO DO Vu Trong Phung", 10))
        self.assertEqual([h.source_id for h in hits], ["c"])

    def test_missing_term_means_no_match(self):
        self.assertEqual(_run(self.store.search_keyword(vector_store.CORPUS_BOOK, "Lost King of Oz Baum", 10)), [])


if __name__ == "__main__":
    unittest.main()
