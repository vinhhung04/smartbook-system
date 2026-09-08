from __future__ import annotations

import os
import unittest

import assistant_tools
import book_index


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


class FakeEmbedResponse:
    def __init__(self, embeddings):
        self.embeddings = embeddings


class CountingOllamaClient:
    """Returns a fixed vector per text and counts how many embed() calls happen,
    so cache reuse can be asserted rather than assumed."""

    def __init__(self, vectors: dict, default):
        self._vectors = vectors
        self._default = default
        self.calls = 0

    def embed(self, model, input):
        self.calls += 1
        texts = [input] if isinstance(input, str) else list(input)
        return FakeEmbedResponse(embeddings=[self._vectors.get(t, self._default) for t in texts])


class FailingOllamaClient:
    def embed(self, model, input):
        raise ConnectionError("ollama unreachable")


def _reset_index():
    book_index._index = None
    if os.path.exists(book_index._CACHE_PATH):
        os.remove(book_index._CACHE_PATH)


def _one_hot(position: int, size: int = 3) -> list[float]:
    return [1.0 if i == position else 0.0 for i in range(size)]


class BookIndexTests(unittest.TestCase):
    def setUp(self):
        _reset_index()
        # Each book gets its own axis; the query is aimed at book 2 (index 1).
        self.vectors = {book_index.book_text(book): _one_hot(i) for i, book in enumerate(BOOKS)}
        self.query = "sach day tre ky nang song"
        self.vectors[self.query] = _one_hot(1)

    def tearDown(self):
        _reset_index()

    def test_semantic_scores_rank_the_topically_closest_book_highest(self):
        client = CountingOllamaClient(self.vectors, default=[0.0, 0.0, 0.0])
        scores = book_index.semantic_scores(BOOKS, self.query, client=client)
        self.assertEqual(len(scores), len(BOOKS))
        self.assertEqual(scores.index(max(scores)), 1)
        self.assertAlmostEqual(scores[1], 1.0, places=6)

    def test_index_reused_from_cache_when_catalog_unchanged(self):
        client = CountingOllamaClient(self.vectors, default=[0.0, 0.0, 0.0])
        book_index.build_index(BOOKS, client=client)
        self.assertEqual(client.calls, 1)

        book_index._index = None
        # A failing client proves the vectors came from the on-disk cache.
        vectors = book_index.build_index(BOOKS, client=FailingOllamaClient())
        self.assertEqual(len(vectors), len(BOOKS))

    def test_index_rebuilt_when_catalog_changes(self):
        client = CountingOllamaClient(self.vectors, default=[0.0, 0.0, 0.0])
        book_index.build_index(BOOKS, client=client)
        self.assertEqual(client.calls, 1)

        changed = BOOKS + [{"id": "b4", "title": "Sach moi", "author": "", "category": "", "isbn": ""}]
        book_index.build_index(changed, client=client)
        self.assertEqual(client.calls, 2, "changed catalog must invalidate the cached index")

    def test_embedding_failure_yields_no_semantic_signal(self):
        self.assertEqual(book_index.semantic_scores(BOOKS, self.query, client=FailingOllamaClient()), [])
        self.assertIsNone(book_index.build_index(BOOKS, client=FailingOllamaClient()))


class HybridSearchTests(unittest.TestCase):
    def setUp(self):
        _reset_index()
        self.vectors = {book_index.book_text(book): _one_hot(i) for i, book in enumerate(BOOKS)}

    def tearDown(self):
        _reset_index()

    def test_semantic_hit_found_without_any_shared_keyword(self):
        query = "sach day tre ky nang song"
        self.vectors[query] = _one_hot(1)
        client = CountingOllamaClient(self.vectors, default=[0.0, 0.0, 0.0])

        # Keyword-only would return nothing useful here: no book title contains
        # these words, and only book 2's summary_vi does.
        results = assistant_tools._score_and_rank_books(BOOKS, query, 5, client=client)
        self.assertTrue(results)
        self.assertEqual(results[0]["id"], "b2")

    def test_exact_isbn_still_wins_when_embeddings_are_unrelated(self):
        query = "9786041111111"
        self.vectors[query] = [0.0, 0.0, 0.0]
        client = CountingOllamaClient(self.vectors, default=[0.0, 0.0, 0.0])

        results = assistant_tools._score_and_rank_books(BOOKS, query, 5, client=client)
        self.assertTrue(results)
        self.assertEqual(results[0]["isbn"], "9786041111111")

    def test_degrades_to_keyword_only_when_ollama_is_down(self):
        results = assistant_tools._score_and_rank_books(
            BOOKS, "Python", 5, client=FailingOllamaClient()
        )
        self.assertEqual([book["id"] for book in results], ["b1"])

    def test_unrelated_query_returns_nothing(self):
        # "xe dap dien" shares no substring with any book text - the pre-existing
        # keyword scorer matches substrings, not whole words, so a query has to be
        # chosen deliberately to have zero keyword signal.
        query = "xe dap dien"
        self.vectors[query] = [0.0, 0.0, 0.0]
        client = CountingOllamaClient(self.vectors, default=[0.0, 0.0, 0.0])

        self.assertEqual(assistant_tools._score_and_rank_books(BOOKS, query, 5, client=client), [])


if __name__ == "__main__":
    unittest.main()
