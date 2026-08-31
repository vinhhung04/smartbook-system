from __future__ import annotations

import os
import unittest

import faq_retrieval
from faq_data import FAQ_ENTRIES


class FAQDataTests(unittest.TestCase):
    def test_entries_have_required_fields(self):
        for entry in FAQ_ENTRIES:
            with self.subTest(entry=entry.get("id")):
                self.assertTrue(entry.get("id"))
                self.assertTrue(entry.get("category"))
                self.assertTrue(entry.get("question"))
                self.assertTrue(entry.get("answer"))

    def test_ids_are_unique(self):
        ids = [entry["id"] for entry in FAQ_ENTRIES]
        self.assertEqual(len(ids), len(set(ids)))

    def test_has_at_least_ten_entries(self):
        self.assertGreaterEqual(len(FAQ_ENTRIES), 10)


class FakeEmbedResponse:
    def __init__(self, embeddings):
        self.embeddings = embeddings


class FakeOllamaClient:
    """Deterministic fake: maps known text -> fixed vector, so cosine
    similarity in assertions is exact and doesn't depend on a real model."""

    def __init__(self, vectors: dict, default=None):
        self._vectors = vectors
        self._default = default

    def embed(self, model, input):
        texts = [input] if isinstance(input, str) else list(input)
        result = []
        for text in texts:
            vector = self._vectors.get(text, self._default)
            if vector is None:
                raise RuntimeError(f"no fake vector configured for: {text!r}")
            result.append(vector)
        return FakeEmbedResponse(embeddings=result)


class FailingOllamaClient:
    def embed(self, model, input):
        raise ConnectionError("ollama unreachable")


def _reset_module_state():
    faq_retrieval._faq_vectors = None
    if os.path.exists(faq_retrieval._CACHE_PATH):
        os.remove(faq_retrieval._CACHE_PATH)


class FindRelevantTests(unittest.TestCase):
    def setUp(self):
        _reset_module_state()
        # One-hot vectors per FAQ question so similarity is unambiguous: a
        # query vector equal to entry N's vector matches only entry N.
        self.vectors = {
            entry["question"]: [1.0 if i == idx else 0.0 for i in range(len(FAQ_ENTRIES))]
            for idx, entry in enumerate(FAQ_ENTRIES)
        }
        self.first_entry = FAQ_ENTRIES[0]

    def tearDown(self):
        _reset_module_state()

    def test_query_matching_first_faq_returns_it_above_threshold(self):
        client = FakeOllamaClient(self.vectors, default=self.vectors[self.first_entry["question"]])
        matches = faq_retrieval.find_relevant("cau hoi bat ky", client=client)
        self.assertTrue(matches)
        self.assertEqual(matches[0].entry["id"], self.first_entry["id"])
        self.assertGreaterEqual(matches[0].score, faq_retrieval.FAQ_MATCH_THRESHOLD)

    def test_unrelated_query_returns_no_match(self):
        orthogonal = [0.0] * len(FAQ_ENTRIES)
        client = FakeOllamaClient(self.vectors, default=orthogonal)
        matches = faq_retrieval.find_relevant("cau hoi khong lien quan gi ca", client=client)
        self.assertEqual(matches, [])

    def test_ollama_failure_returns_empty_list_not_exception(self):
        matches = faq_retrieval.find_relevant("bat ky cau hoi nao", client=FailingOllamaClient())
        self.assertEqual(matches, [])

    def test_cache_reused_on_second_load_without_reembedding(self):
        client = FakeOllamaClient(self.vectors, default=self.vectors[self.first_entry["question"]])
        first_load = faq_retrieval._load_faq_vectors(client=client)
        self.assertEqual(len(first_load), len(FAQ_ENTRIES))
        self.assertTrue(os.path.exists(faq_retrieval._CACHE_PATH))

        faq_retrieval._faq_vectors = None
        # FailingOllamaClient would raise on any embed() call — if this still
        # returns full vectors, they came from the on-disk cache, not a
        # fresh embedding call.
        second_load = faq_retrieval._load_faq_vectors(client=FailingOllamaClient())
        self.assertEqual(len(second_load), len(FAQ_ENTRIES))
        self.assertTrue(all(vector for _, vector in second_load))


if __name__ == "__main__":
    unittest.main()
