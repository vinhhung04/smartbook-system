"""Unit tests for routes_cover_search.py's pure merge/rank/parse logic.

No real Ollama, no real CLIP model, no real Postgres — matching this repo's
existing testing philosophy (see test_book_index.py). cover_gallery.py's
get_gallery()/_sync() talk to a real DB session and an external
inventory-service call, so they're exercised manually per the plan's demo
script rather than unit-tested here; what's covered below is the part that
is actually pure and where a merge/ranking mistake would be easy to miss.
"""
from __future__ import annotations

import unittest
from unittest.mock import patch

import routes_cover_search as cover_search

BOOKS = [
    {"id": "b1", "variant_id": "v1-default", "title": "Lap trinh Python co ban"},
    {"id": "b2", "variant_id": "v2-default", "title": "Doraemon tap 1"},
    {"id": "b3", "variant_id": "v3-default", "title": "Lich su the gioi"},
]


class ExtractTitleAuthorTests(unittest.TestCase):
    def test_parses_direct_json(self):
        data = cover_search._extract_title_author('{"title": "Doraemon", "author": "Fujiko F. Fujio"}')
        self.assertEqual(data, {"title": "Doraemon", "author": "Fujiko F. Fujio"})

    def test_parses_fenced_json_block(self):
        raw = 'Day la ket qua:\n```json\n{"title": "Doraemon", "author": null}\n```\nHet.'
        data = cover_search._extract_title_author(raw)
        self.assertEqual(data, {"title": "Doraemon", "author": None})

    def test_parses_first_object_in_free_text(self):
        raw = 'Toi thay {"title": "Doraemon", "author": "Fujiko"} tren bia sach.'
        data = cover_search._extract_title_author(raw)
        self.assertEqual(data["title"], "Doraemon")

    def test_unparseable_text_falls_back_to_nulls(self):
        data = cover_search._extract_title_author("khong doc duoc chu gi tren bia")
        self.assertEqual(data, {"title": None, "author": None})


class CleanOcrValueTests(unittest.TestCase):
    """Regression coverage for a real bug found by
    scripts/cover-search-integration.mjs: on a blank/unreadable image, llava
    sometimes fills the JSON string fields with its own hedge phrase (e.g.
    "Không tìm thấy") instead of the requested JSON null. That's still valid
    JSON, so _extract_title_author happily returns it — the bug was treating
    that hedge text as a real title and searching for it, producing a false
    match with ~0.87 confidence."""

    def test_strips_known_hedge_phrases(self):
        for phrase in ("Không tìm thấy", "khong tim thay", "Unknown", "N/A", "  không rõ  "):
            self.assertIsNone(cover_search._clean_ocr_value(phrase), msg=phrase)

    def test_keeps_a_real_title(self):
        self.assertEqual(cover_search._clean_ocr_value("Doraemon tap 1"), "Doraemon tap 1")

    def test_treats_none_and_empty_string_as_none(self):
        self.assertIsNone(cover_search._clean_ocr_value(None))
        self.assertIsNone(cover_search._clean_ocr_value("   "))

    def test_run_cover_ocr_drops_hedge_phrases_end_to_end(self):
        fake_response = {"response": '{"title": "Không tìm thấy", "author": "Không tìm thấy"}'}
        with patch.object(cover_search.ollama, "Client") as mock_client_cls:
            mock_client_cls.return_value.generate.return_value = fake_response
            result = cover_search._run_cover_ocr(b"fake-image-bytes")
        self.assertEqual(result, {"title": None, "author": None})


class MergeCandidatesTests(unittest.TestCase):
    def test_visual_only_match_uses_raw_visual_score_as_confidence(self):
        visual = [{"variant_id": "v1-alt", "book_id": "b1", "score": 0.9}]
        candidates = cover_search._merge_candidates(BOOKS, [], visual)
        self.assertEqual(len(candidates), 1)
        self.assertEqual(candidates[0]["id"], "b1")
        self.assertAlmostEqual(candidates[0]["confidence"], 0.9)
        self.assertEqual([e["signal"] for e in candidates[0]["evidence"]], ["visual"])

    def test_ocr_only_match_uses_raw_ocr_score_as_confidence(self):
        ocr = [{"id": "b2", "title": "Doraemon tap 1", "score": 0.75}]
        candidates = cover_search._merge_candidates(BOOKS, ocr, [])
        self.assertEqual(len(candidates), 1)
        self.assertEqual(candidates[0]["id"], "b2")
        self.assertAlmostEqual(candidates[0]["confidence"], 0.75)
        self.assertEqual([e["signal"] for e in candidates[0]["evidence"]], ["ocr_text"])

    def test_both_signals_on_same_book_use_weighted_average(self):
        visual = [{"variant_id": "v2-alt", "book_id": "b2", "score": 0.9}]
        ocr = [{"id": "b2", "title": "Doraemon tap 1", "score": 0.6}]
        candidates = cover_search._merge_candidates(BOOKS, ocr, visual)
        self.assertEqual(len(candidates), 1)
        expected = 0.9 * cover_search.COVER_SEARCH_VISUAL_WEIGHT + 0.6 * (1 - cover_search.COVER_SEARCH_VISUAL_WEIGHT)
        self.assertAlmostEqual(candidates[0]["confidence"], round(expected, 3))
        signals = {e["signal"] for e in candidates[0]["evidence"]}
        self.assertEqual(signals, {"visual", "ocr_text"})

    def test_visual_match_below_threshold_is_dropped(self):
        below = cover_search.COVER_SEARCH_VISUAL_THRESHOLD - 0.1
        visual = [{"variant_id": "v1-alt", "book_id": "b1", "score": below}]
        candidates = cover_search._merge_candidates(BOOKS, [], visual)
        self.assertEqual(candidates, [])

    def test_match_pointing_at_a_book_no_longer_in_the_catalog_is_dropped(self):
        visual = [{"variant_id": "v9-alt", "book_id": "b9-deactivated", "score": 0.95}]
        candidates = cover_search._merge_candidates(BOOKS, [], visual)
        self.assertEqual(candidates, [])

    def test_visual_matched_variant_wins_over_the_books_default_variant(self):
        # The photo matched a specific edition (v1-alt), not the catalog's
        # arbitrary "first variant" default (v1-default) — the more precise
        # id should be what a "reserve this" action uses.
        visual = [{"variant_id": "v1-alt", "book_id": "b1", "score": 0.85}]
        candidates = cover_search._merge_candidates(BOOKS, [], visual)
        self.assertEqual(candidates[0]["variant_id"], "v1-alt")

    def test_no_signals_yields_no_candidates(self):
        self.assertEqual(cover_search._merge_candidates(BOOKS, [], []), [])

    def test_results_sorted_by_confidence_descending(self):
        visual = [
            {"variant_id": "v1-alt", "book_id": "b1", "score": 0.82},
            {"variant_id": "v3-alt", "book_id": "b3", "score": 0.95},
        ]
        candidates = cover_search._merge_candidates(BOOKS, [], visual)
        self.assertEqual([c["id"] for c in candidates], ["b3", "b1"])


if __name__ == "__main__":
    unittest.main()
