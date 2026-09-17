from __future__ import annotations

import asyncio
import unittest
from unittest import mock

import assistant_tools
import book_index
import embeddings


def run(coro):
    return asyncio.run(coro)


BOOKS = [
    {
        "id": "b1",
        "title": "Lap trinh Python co ban",
        "author": "Nguyen Van A",
        "category": "Cong nghe",
        "isbn": "9786041234567",
        "quantity": 4,
        "description": "Huong dan lap trinh Python tu dau cho nguoi moi.",
        "summary_vi": "",
    },
    {
        "id": "b2",
        "title": "Be tu lam moi viec",
        "author": "Tran Thi B",
        "category": "Thieu nhi",
        "isbn": "9786049876543",
        "quantity": 7,
        "description": "Cuon sach giup tre nho hoc cach tu phuc vu ban than moi ngay.",
        "summary_vi": "Ren luyen ky nang song cho tre mam non.",
    },
    {
        "id": "b3",
        "title": "Lich su the gioi",
        "author": "Le Van C",
        "category": "Lich su",
        "isbn": "9786041111111",
        "quantity": 2,
        "description": "Tong quan cac giai doan lich su the gioi.",
        "summary_vi": "",
    },
]


class HybridSearchTest(unittest.TestCase):
    """search_books gio hop nhat semantic va keyword qua vector_store + RRF.

    Vector cua sach khong con den tu viec embed lai text qua client Ollama gia —
    ruot moi cua semantic_scores/_score_and_rank_books chi doc tu vector store
    (da duoc ingestion.py dong bo tu truoc), nen moi test o day tu seed
    InMemoryVectorStore truc tiep bang upsert_document/upsert_chunks.
    """

    def setUp(self):
        import vector_store
        from vector_store import Chunk
        self.vector_store = vector_store
        self.store = vector_store.InMemoryVectorStore()
        vector_store.set_store(self.store)
        for book, vec in zip(BOOKS, ([1.0, 0.0], [0.0, 1.0], [0.7, 0.7])):
            doc = run(self.store.upsert_document(
                corpus=vector_store.CORPUS_BOOK, source_id=book["id"],
                title=book["title"], content=book_index.book_text(book),
                content_hash="h-" + book["id"], metadata={}))
            run(self.store.upsert_chunks([Chunk(
                doc, vector_store.CORPUS_BOOK, 0, book_index.book_text(book),
                "c-" + book["id"], vec, "test-model")]))

    def tearDown(self):
        self.vector_store.set_store(None)

    def test_semantic_scores_aligned_with_input_order(self):
        with mock.patch.object(embeddings, "embed_text", return_value=embeddings.EmbedResult(vector=[1.0, 0.0], model="test-model", provider="ollama")):
            scores = run(book_index.semantic_scores(BOOKS, "lap trinh"))
        self.assertEqual(len(scores), len(BOOKS))
        self.assertAlmostEqual(scores[0], 1.0)
        self.assertAlmostEqual(scores[1], 0.0)

    def test_semantic_scores_empty_when_embedding_unavailable(self):
        with mock.patch.object(embeddings, "embed_text", return_value=None):
            self.assertEqual(run(book_index.semantic_scores(BOOKS, "bat ky")), [])

    def test_book_not_in_index_scores_zero_not_crash(self):
        extra = BOOKS + [{"id": "b-unknown", "title": "Chua ingest", "author": "",
                          "category": "", "isbn": "", "quantity": 0,
                          "description": "", "summary_vi": ""}]
        with mock.patch.object(embeddings, "embed_text", return_value=embeddings.EmbedResult(vector=[1.0, 0.0], model="test-model", provider="ollama")):
            scores = run(book_index.semantic_scores(extra, "lap trinh"))
        self.assertEqual(len(scores), len(extra))
        self.assertEqual(scores[-1], 0.0)

    def test_semantic_hit_found_via_topical_embedding_match(self):
        # Book 2's stored vector is [0.0, 1.0]; mocking embed_text to return the
        # same vector simulates a query that is topically aligned with book 2
        # regardless of shared keywords, proving the semantic half of the fusion
        # can surface a result on its own.
        with mock.patch.object(embeddings, "embed_text", return_value=embeddings.EmbedResult(vector=[0.0, 1.0], model="test-model", provider="ollama")):
            results = run(assistant_tools._score_and_rank_books(BOOKS, "sach day tre ky nang song", 5))
        self.assertTrue(results)
        self.assertEqual(results[0]["id"], "b2")

    def test_exact_title_keyword_wins_when_embeddings_are_unrelated(self):
        # A zero query vector is equally (un)related to every book, so this
        # isolates the keyword half: book 3's title is a direct hit, nothing
        # else in the catalog shares any token with the query.
        query = "Lich su the gioi"
        with mock.patch.object(embeddings, "embed_text", return_value=embeddings.EmbedResult(vector=[0.0, 0.0], model="test-model", provider="ollama")):
            results = run(assistant_tools._score_and_rank_books(BOOKS, query, 5))
        self.assertTrue(results)
        self.assertEqual(results[0]["id"], "b3")

    def test_exact_isbn_wins_even_when_vector_signals_are_absent(self):
        # isbn is deliberately not part of the embedded/tsv content
        # (book_index.book_text never includes it), so neither semantic nor keyword
        # search can surface a book by isbn on their own: the mocked embedding here
        # is aimed at book 2 (unrelated to book 1), and book 1's isbn string never
        # appears in any book's indexed text either. The isbn short-circuit in
        # _score_and_rank_books must still put book 1 at rank 1.
        query = BOOKS[0]["isbn"]
        with mock.patch.object(embeddings, "embed_text", return_value=embeddings.EmbedResult(vector=[0.0, 1.0], model="test-model", provider="ollama")):
            results = run(assistant_tools._score_and_rank_books(BOOKS, query, 5))
        self.assertTrue(results)
        self.assertEqual(results[0]["id"], "b1")
        self.assertEqual(results[0]["score"], 1.0)

    def test_exact_isbn_match_ignores_hyphens_and_case(self):
        hyphenated = "978-604-1234-567"  # same digits as BOOKS[0]["isbn"], reformatted
        with mock.patch.object(embeddings, "embed_text", return_value=None):
            results = run(assistant_tools._score_and_rank_books(BOOKS, hyphenated, 5))
        self.assertTrue(results)
        self.assertEqual(results[0]["id"], "b1")

    def test_isbn_match_inside_natural_language_sentence(self):
        # Real queries wrap the isbn in a sentence ("Tim sach ISBN <isbn>"),
        # not the bare isbn alone — the short-circuit must still fire via
        # substring containment, not exact string equality.
        query = "Tim sach ISBN 9786041234567 con hang khong?"
        with mock.patch.object(embeddings, "embed_text", return_value=embeddings.EmbedResult(vector=[0.0, 1.0], model="test-model", provider="ollama")):
            results = run(assistant_tools._score_and_rank_books(BOOKS, query, 5))
        self.assertTrue(results)
        self.assertEqual(results[0]["id"], "b1")
        self.assertEqual(results[0]["score"], 1.0)

    def test_isbn_short_circuit_ignores_empty_isbn_field(self):
        # An empty/missing isbn must never match as a substring of every query
        # (walrus-guard regression: "" is a substring of any string in Python).
        books_no_isbn = [{**BOOKS[1], "isbn": ""}, BOOKS[2]]
        with mock.patch.object(embeddings, "embed_text", return_value=None):
            results = run(assistant_tools._score_and_rank_books(
                books_no_isbn, "Lich su the gioi", 5))
        self.assertEqual([book["id"] for book in results], ["b3"])

    def test_degrades_to_keyword_only_when_embedding_is_unavailable(self):
        with mock.patch.object(embeddings, "embed_text", return_value=None):
            results = run(assistant_tools._score_and_rank_books(BOOKS, "Python", 5))
        self.assertEqual([book["id"] for book in results], ["b1"])

    def test_unrelated_query_returns_nothing(self):
        # No embedding signal (Ollama down) and a query that shares no token
        # with any book's indexed content: both rankings come back empty, so
        # the RRF fusion of two empty lists must also be empty.
        with mock.patch.object(embeddings, "embed_text", return_value=None):
            results = run(assistant_tools._score_and_rank_books(BOOKS, "xe dap dien", 5))
        self.assertEqual(results, [])


if __name__ == "__main__":
    unittest.main()
