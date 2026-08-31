from __future__ import annotations

import unittest

import recommendation as rec


def book(book_id, title, author="", category="", quantity=5, variant_suffix="v"):
    return {
        "id": book_id,
        "title": title,
        "author": author,
        "category": category,
        "available_quantity": quantity,
        "variant_ids": [f"{variant_suffix}-{book_id}"],
        "description": f"Mo ta cua {title}",
        "summary_vi": "",
    }


CATALOG = [
    book("b1", "Lap trinh Python", author="Nguyen A", category="Cong nghe"),
    book("b2", "Python nang cao", author="Nguyen A", category="Cong nghe"),
    book("b3", "Lich su the gioi", author="Tran B", category="Lich su"),
    book("b4", "Nau an gia dinh", author="Le C", category="Nau an", quantity=0),
]


class VariantResolutionTests(unittest.TestCase):
    """The bug this feature was built to fix: loans were matched against book ids."""

    def test_loans_resolve_to_books_through_variant_ids(self):
        loans = [{"loan_items": [{"variant_id": "v-b1"}, {"variant_id": "v-b3"}]}]
        resolved = rec.books_from_loans(loans, CATALOG)
        self.assertEqual([b["id"] for b in resolved], ["b1", "b3"])

    def test_matching_a_book_id_instead_of_a_variant_id_resolves_nothing(self):
        # book ids and variant ids are different primary keys; the old frontend
        # compared them directly, which is why every loan became "Unknown".
        loans = [{"loan_items": [{"variant_id": "b1"}, {"variant_id": "b3"}]}]
        self.assertEqual(rec.books_from_loans(loans, CATALOG), [])

    def test_falls_back_to_single_variant_id_when_variant_ids_absent(self):
        legacy_catalog = [{"id": "b9", "title": "Cu", "variant_id": "legacy-v"}]
        loans = [{"loan_items": [{"variant_id": "legacy-v"}]}]
        self.assertEqual([b["id"] for b in rec.books_from_loans(loans, legacy_catalog)], ["b9"])

    def test_same_book_borrowed_twice_appears_once(self):
        loans = [
            {"loan_items": [{"variant_id": "v-b1"}]},
            {"loan_items": [{"variant_id": "v-b1"}]},
        ]
        self.assertEqual([b["id"] for b in rec.books_from_loans(loans, CATALOG)], ["b1"])

    def test_malformed_loan_payloads_are_skipped_not_fatal(self):
        loans = [None, {"loan_items": None}, {"loan_items": [None, {"variant_id": "v-b2"}]}]
        self.assertEqual([b["id"] for b in rec.books_from_loans(loans, CATALOG)], ["b2"])


class TasteProfileTests(unittest.TestCase):
    def test_wishlist_outweighs_a_past_borrow(self):
        signals = rec.collect_signals(
            loan_books=[CATALOG[2]],       # Lich su, weight 1.0
            wishlist_books=[CATALOG[0]],   # Cong nghe, weight 1.5
            rated_books=[],
        )
        profile = rec.build_taste_profile(signals)
        self.assertGreater(profile["categories"]["cong nghe"], profile["categories"]["lich su"])

    def test_high_rating_adds_weight_and_low_rating_subtracts(self):
        liked = rec.build_taste_profile(rec.collect_signals([], [], [(CATALOG[0], 5)]))
        disliked = rec.build_taste_profile(rec.collect_signals([], [], [(CATALOG[0], 1)]))
        self.assertEqual(liked["categories"]["cong nghe"], rec.WEIGHT_RATING_LIKED)
        self.assertEqual(disliked["categories"]["cong nghe"], rec.WEIGHT_RATING_DISLIKED)

    def test_middling_rating_is_ignored(self):
        self.assertEqual(rec.collect_signals([], [], [(CATALOG[0], 3)]), [])

    def test_disliked_book_does_not_enter_the_semantic_query_text(self):
        profile = rec.build_taste_profile(rec.collect_signals([], [], [(CATALOG[0], 1)]))
        self.assertNotIn("Lap trinh Python", profile["text"])

    def test_liked_book_does_enter_the_semantic_query_text(self):
        profile = rec.build_taste_profile(rec.collect_signals([CATALOG[0]], [], []))
        self.assertIn("Lap trinh Python", profile["text"])


class CandidateSelectionTests(unittest.TestCase):
    def test_already_borrowed_and_wishlisted_books_are_excluded(self):
        signals = rec.collect_signals(loan_books=[CATALOG[0]], wishlist_books=[CATALOG[2]], rated_books=[])
        profile = rec.build_taste_profile(signals)
        candidates = rec.select_candidates(CATALOG, profile)
        self.assertEqual(sorted(b["id"] for b in candidates), ["b2", "b4"])

    def test_no_history_means_the_whole_catalog_is_a_candidate(self):
        profile = rec.build_taste_profile([])
        self.assertEqual(len(rec.select_candidates(CATALOG, profile)), len(CATALOG))


class ScoringTests(unittest.TestCase):
    def test_rating_from_a_single_review_ranks_below_a_well_reviewed_book(self):
        lone_five_star = rec.quality_score({"averageRating": 5.0, "totalReviews": 1})
        many_four_and_a_half = rec.quality_score({"averageRating": 4.5, "totalReviews": 40})
        self.assertLess(lone_five_star, many_four_and_a_half)

    def test_no_reviews_scores_zero_rather_than_penalising(self):
        self.assertEqual(rec.quality_score({"averageRating": 0, "totalReviews": 0}), 0.0)
        self.assertEqual(rec.quality_score(None), 0.0)

    def test_out_of_stock_is_demoted_not_removed(self):
        profile = rec.build_taste_profile([])
        ranked = rec.rank_candidates(CATALOG, profile, limit=10)
        ids = [entry["book_id"] for entry in ranked]
        self.assertIn("b4", ids, "an out-of-stock book must still be recommendable")
        out_of_stock = next(e for e in ranked if e["book_id"] == "b4")
        in_stock = next(e for e in ranked if e["book_id"] == "b1")
        self.assertLess(out_of_stock["breakdown"]["availability"], in_stock["breakdown"]["availability"])

    def test_same_author_outranks_an_unrelated_book(self):
        profile = rec.build_taste_profile(rec.collect_signals([CATALOG[0]], [], []))
        candidates = rec.select_candidates(CATALOG, profile)
        ranked = rec.rank_candidates(candidates, profile, limit=10)
        self.assertEqual(ranked[0]["book_id"], "b2", "same author + same category should lead")

    def test_semantic_scores_shift_the_ranking_when_available(self):
        profile = rec.build_taste_profile([])
        candidates = rec.select_candidates(CATALOG, profile)
        target = candidates.index(next(b for b in candidates if b["id"] == "b3"))
        semantic = [0.0] * len(candidates)
        semantic[target] = 1.0
        ranked = rec.rank_candidates(candidates, profile, semantic=semantic, limit=10)
        self.assertEqual(ranked[0]["book_id"], "b3")

    def test_mismatched_semantic_length_is_ignored_rather_than_crashing(self):
        profile = rec.build_taste_profile([])
        ranked = rec.rank_candidates(CATALOG, profile, semantic=[0.9], limit=10)
        self.assertEqual(len(ranked), len(CATALOG))
        self.assertTrue(all(entry["breakdown"]["semantic"] == 0.0 for entry in ranked))

    def test_every_returned_book_id_comes_from_the_catalog(self):
        profile = rec.build_taste_profile([])
        catalog_ids = {b["id"] for b in CATALOG}
        ranked = rec.rank_candidates(CATALOG, profile, limit=10)
        self.assertTrue(all(entry["book_id"] in catalog_ids for entry in ranked))

    def test_scores_stay_within_zero_and_one(self):
        profile = rec.build_taste_profile(rec.collect_signals([CATALOG[0]], [CATALOG[1]], [(CATALOG[2], 5)]))
        ranked = rec.rank_candidates(CATALOG, profile, semantic=[1.0] * len(CATALOG), limit=10)
        for entry in ranked:
            self.assertGreaterEqual(entry["score"], 0.0)
            self.assertLessEqual(entry["score"], 1.0)


class RuleBasedReasonTests(unittest.TestCase):
    def test_mentions_the_author_the_reader_already_likes(self):
        profile = rec.build_taste_profile(rec.collect_signals([CATALOG[0]], [], []))
        entry = {"author": "Nguyen A", "category": "Cong nghe", "breakdown": {"availability": 1.0}}
        self.assertIn("Nguyen A", rec.rule_based_reason(entry, profile))

    def test_flags_an_out_of_stock_recommendation(self):
        profile = rec.build_taste_profile([])
        entry = {"author": "", "category": "", "breakdown": {"availability": 0.3}}
        self.assertIn("hết hàng", rec.rule_based_reason(entry, profile))

    def test_falls_back_to_popularity_wording_with_no_signals(self):
        profile = rec.build_taste_profile([])
        entry = {"author": "", "category": "", "breakdown": {"availability": 1.0}}
        self.assertIn("phổ biến", rec.rule_based_reason(entry, profile))


if __name__ == "__main__":
    unittest.main()
