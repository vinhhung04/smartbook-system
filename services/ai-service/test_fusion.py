from __future__ import annotations

import unittest

import fusion
from vector_store import Hit


def hit(source_id: str, score: float = 0.0) -> Hit:
    return Hit(chunk_id=f"c-{source_id}", document_id=f"d-{source_id}",
               source_id=source_id, corpus="BOOK_METADATA",
               content=source_id, score=score, metadata={})


class ReciprocalRankFusionTest(unittest.TestCase):
    def test_document_in_both_rankings_beats_document_in_one(self):
        semantic = [hit("a"), hit("b")]
        keyword = [hit("c"), hit("a")]
        fused = fusion.reciprocal_rank_fusion([semantic, keyword])
        self.assertEqual(fused[0].source_id, "a")

    def test_higher_rank_wins_within_same_coverage(self):
        fused = fusion.reciprocal_rank_fusion([[hit("a"), hit("b")]])
        self.assertEqual([h.source_id for h in fused], ["a", "b"])
        self.assertGreater(fused[0].score, fused[1].score)

    def test_empty_rankings_return_empty(self):
        self.assertEqual(fusion.reciprocal_rank_fusion([]), [])
        self.assertEqual(fusion.reciprocal_rank_fusion([[], []]), [])

    def test_score_is_rrf_score_not_original(self):
        fused = fusion.reciprocal_rank_fusion([[hit("a", score=0.99)]], k=60)
        self.assertAlmostEqual(fused[0].score, 1 / 61)

    def test_limit_truncates(self):
        fused = fusion.reciprocal_rank_fusion([[hit("a"), hit("b"), hit("c")]], limit=2)
        self.assertEqual(len(fused), 2)

    def test_deduplicates_by_source_id(self):
        fused = fusion.reciprocal_rank_fusion([[hit("a"), hit("a")]])
        self.assertEqual(len(fused), 1)


if __name__ == "__main__":
    unittest.main()
