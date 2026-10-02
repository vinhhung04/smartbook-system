from __future__ import annotations

import json
import os
import tempfile
import unittest

import recommendation_v2 as v2
import recommendation_v2_service as svc

DAY = 86400.0
NOW = 1_800_000_000.0


def book(book_id, title, author, category, quantity=3, active=True, description=""):
    return {
        "id": book_id, "title": title, "author": author, "category": category,
        "available_quantity": quantity, "variant_ids": [f"v-{book_id}"], "description": description,
        "is_active": active,
    }


CATALOG = [
    book("b1", "Python co ban", "Nguyen A", "Cong nghe", description="lap trinh python"),
    book("b2", "Python nang cao", "Nguyen A", "Cong nghe", description="lap trinh python nang cao"),
    book("b3", "Hoc may", "Tran B", "Cong nghe", description="machine learning python"),
    book("b4", "Lich su the gioi", "Le C", "Lich su", description="lich su"),
    book("b5", "Nau an", "Pham D", "Nau an", quantity=0, description="mon ngon"),
    book("b6", "Sach ngung phat hanh", "Nguyen A", "Cong nghe", active=False),
]


def ev(kind, user, book_id, days_ago, rating=None, until_days_ago=None):
    return {
        "kind": kind, "user": user, "book_id": book_id, "at": NOW - days_ago * DAY,
        "rating": rating, "until": None if until_days_ago is None else NOW - until_days_ago * DAY,
    }


# u1..u3 co-borrow b1 and b3; u4 reads history. b2 has no interactions (new book).
HISTORY = v2.normalize_interactions([
    ev("LOAN", "u1", "b1", 50), ev("LOAN", "u1", "b3", 40),
    ev("LOAN", "u2", "b1", 45), ev("LOAN", "u2", "b3", 30),
    ev("LOAN", "u3", "b1", 20), ev("LOAN", "u3", "b3", 10),
    ev("LOAN", "u4", "b4", 15), ev("REVIEW", "u4", "b4", 14, rating=3),
    ev("REVIEW", "u1", "b3", 35, rating=5), ev("REVIEW", "u2", "b3", 25, rating=4),
    ev("REVIEW", "u3", "b3", 5, rating=5),
])
CONFIG = {
    "weights": dict(v2.DEFAULT_WEIGHTS),
    "feature_scale": {k: 1.0 for k in v2.FEATURES},
    "params": dict(v2.DEFAULT_PARAMS),
    "max_per_category": None,
}


def model(interactions=HISTORY, cutoff=NOW, params=None):
    return v2.build_global_model(CATALOG, interactions, cutoff, params)


class CollaborativeTests(unittest.TestCase):
    def test_item_item_cosine_with_shrinkage(self):
        sim = v2.item_similarity({"u1": {"a", "b"}, "u2": {"a", "b"}, "u3": {"a"}}, shrinkage=0.0)
        # co(a,b)=2, n_a=3, n_b=2 -> 2/sqrt(6)
        self.assertAlmostEqual(sim["a"]["b"], 2 / 6 ** 0.5)
        shrunk = v2.item_similarity({"u1": {"a", "b"}, "u2": {"a", "b"}, "u3": {"a"}}, shrinkage=10.0)
        self.assertLess(shrunk["a"]["b"], sim["a"]["b"])
        self.assertEqual(sim["a"]["b"], sim["b"]["a"])

    def test_reader_of_b1_gets_collaborative_signal_for_co_borrowed_b3(self):
        m = model()
        profile = v2.build_user_profile([ev("LOAN", "new", "b1", 3)], m)
        f3 = v2.feature_vector(CATALOG[2], profile, m, 1.0)
        f4 = v2.feature_vector(CATALOG[3], profile, m, 1.0)
        self.assertGreater(f3["collaborative"], 0)
        self.assertEqual(f4["collaborative"], 0)

    def test_disliked_books_do_not_count_as_co_interest(self):
        sets = v2._positive_sets(v2.normalize_interactions([
            ev("LOAN", "u", "b1", 3), ev("REVIEW", "u", "b1", 2, rating=1), ev("LOAN", "u", "b3", 1)]), NOW)
        self.assertEqual(sets["u"], {"b3"})


class TemporalTests(unittest.TestCase):
    def test_global_model_ignores_interactions_at_or_after_cutoff(self):
        future = HISTORY + v2.normalize_interactions([ev("LOAN", "u9", "b4", -1), ev("LOAN", "u9", "b2", 0)])
        a, b = model(HISTORY), model(future)
        self.assertEqual(a["popularity"], b["popularity"])
        self.assertEqual(a["similarity"], b["similarity"])
        self.assertEqual(a["rating_count"], b["rating_count"])

    def test_user_profile_ignores_future_interactions(self):
        m = model()
        past = [ev("LOAN", "x", "b4", 5)]
        with_future = past + [ev("LOAN", "x", "b1", -2), ev("REVIEW", "x", "b1", -1, rating=5)]
        p1 = v2.build_user_profile(v2.normalize_interactions(past), m)
        p2 = v2.build_user_profile(v2.normalize_interactions(with_future), m)
        self.assertEqual(p1["categories"], p2["categories"])
        self.assertEqual(p1["seen"], p2["seen"])

    def test_wishlist_removed_before_cutoff_is_invisible(self):
        m = model()
        rows = v2.normalize_interactions([ev("WISHLIST", "x", "b4", 20, until_days_ago=10)])
        profile = v2.build_user_profile(rows, m)
        self.assertNotIn("b4", profile["seen"])
        self.assertEqual(profile["signal_count"], 0)

    def test_active_reservation_is_excluded(self):
        m = model()
        rows = v2.normalize_interactions([ev("RESERVATION", "x", "b4", 1)])
        profile = v2.build_user_profile(rows, m)
        self.assertIn("b4", profile["seen"])
        ids = [e["book_id"] for e in v2.rank(CATALOG, profile, m, CONFIG["weights"])]
        self.assertNotIn("b4", ids)

    def test_recency_counts_only_the_trend_window(self):
        m = model(params={"trend_window_days": 30})
        self.assertEqual(m["trend"].get("b1"), 1)   # only u3's loan 20 days ago
        self.assertEqual(m["popularity"].get("b1"), 3)


class CandidateAndRuleTests(unittest.TestCase):
    def test_pool_deduplicates_books_found_by_several_generators(self):
        m = model()
        profile = v2.build_user_profile([ev("LOAN", "x", "b1", 3)], m)
        books = v2.eligible_books(CATALOG, profile)
        feats = {b["id"]: v2.feature_vector(b, profile, m, 1.0) for b in books}
        pool = v2.candidate_pool(books, feats, per_source_k=2)
        self.assertEqual(len(pool), len(set(pool)))
        self.assertIn("b3", pool)
        self.assertGreater(len(pool["b3"]), 1)  # e.g. COLLABORATIVE + POPULAR

    def test_exclusion_rules(self):
        m = model()
        rows = v2.normalize_interactions([ev("LOAN", "x", "b1", 3), ev("REVIEW", "x", "b4", 2, rating=3)])
        profile = v2.build_user_profile(rows, m)
        ids = {e["book_id"] for e in v2.rank(CATALOG, profile, m, CONFIG["weights"], use_pool=False)}
        self.assertNotIn("b1", ids)   # borrowed
        self.assertNotIn("b4", ids)   # rated
        self.assertNotIn("b6", ids)   # inactive
        self.assertIn("b5", ids)      # out of stock stays

    def test_unavailable_book_is_demoted_not_removed(self):
        m = model()
        profile = v2.build_user_profile([], m)
        weights = {**{k: 0.0 for k in v2.FEATURES}, "availability": 1.0}
        ranked = v2.rank(CATALOG, profile, m, weights, use_pool=False)
        self.assertEqual(ranked[-1]["book_id"], "b5")
        self.assertEqual(ranked[-1]["features"]["availability"], 0.0)

    def test_ranking_is_deterministic_with_book_id_tiebreak(self):
        m = model()
        profile = v2.build_user_profile([], m)
        zero = {k: 0.0 for k in v2.FEATURES}
        first = [e["book_id"] for e in v2.rank(CATALOG, profile, m, zero, use_pool=False)]
        again = [e["book_id"] for e in v2.rank(list(reversed(CATALOG)), profile, m, zero, use_pool=False)]
        self.assertEqual(first, again)
        self.assertEqual(first, sorted(first))

    def test_category_cap_moves_overflow_back_without_dropping(self):
        entries = [{"book_id": b["id"], "book": b} for b in CATALOG[:4]]
        capped = v2.apply_category_cap(entries, 1)
        self.assertEqual([e["book_id"] for e in capped], ["b1", "b4", "b2", "b3"])


class NewArrivalSlotTests(unittest.TestCase):
    @staticmethod
    def entries(new_ids, n=6):
        return [{"book_id": f"x{i}", "features": {"new_book": f"x{i}" in new_ids}} for i in range(n)]

    def test_best_new_title_is_guaranteed_the_last_top_place(self):
        out = v2.apply_new_arrival_slot(self.entries({"x4", "x5"}), limit=3, slots=1)
        self.assertEqual([e["book_id"] for e in out], ["x0", "x1", "x4", "x2", "x3", "x5"])

    def test_no_change_when_a_new_title_already_ranks_or_none_exists(self):
        same = self.entries({"x1", "x5"})
        self.assertEqual(v2.apply_new_arrival_slot(same, limit=3, slots=1), same)
        none = self.entries(set())
        self.assertEqual(v2.apply_new_arrival_slot(none, limit=3, slots=1), none)
        self.assertEqual(v2.apply_new_arrival_slot(self.entries({"x5"}), limit=3, slots=0), self.entries({"x5"}))


class ColdStartTests(unittest.TestCase):
    def test_new_user_gets_a_popularity_led_list_marked_cold_start(self):
        out = v2.recommend(CATALOG, [], model(), CONFIG, limit=3)
        self.assertEqual(len(out["entries"]), 3)
        self.assertEqual(out["entries"][0]["book_id"], "b3")  # most borrowed + best rated
        for e in out["entries"]:
            self.assertIn("COLD_START_FALLBACK", e["reason_codes"])
            self.assertEqual(e["tier"], "EXPLORE")

    def test_no_history_at_all_still_returns_books(self):
        empty = v2.build_global_model(CATALOG, [], NOW)
        out = v2.recommend(CATALOG, [], empty, CONFIG, limit=10)
        self.assertEqual(len(out["entries"]), 5)  # every active book

    def test_new_book_without_history_can_still_be_recommended_on_content(self):
        m = model()
        rows = v2.normalize_interactions([ev("LOAN", "x", "b1", 3), ev("REVIEW", "x", "b1", 2, rating=5)])
        profile = v2.build_user_profile(rows, m)
        f2 = v2.feature_vector(CATALOG[1], profile, m, 1.0)
        self.assertEqual(f2["popularity"], 0.0)
        self.assertEqual(f2["collaborative"], 0.0)
        self.assertAlmostEqual(f2["quality"], m["rating_global_mean"] / 5)  # neutral prior, not 0
        self.assertGreater(f2["semantic"], 0.3)
        self.assertGreater(f2["author"], 0)
        weights = {**{k: 0.0 for k in v2.FEATURES}, "semantic": 1.0, "author": 1.0}
        top = v2.rank(CATALOG, profile, m, weights, use_pool=False)[0]
        self.assertEqual(top["book_id"], "b2")

    def test_recently_added_book_gets_neutral_history_evidence(self):
        catalog = CATALOG + [book("b7", "Python moi", "Nguyen A", "Cong nghe", description="lap trinh python")]
        catalog[-1]["created_at"] = NOW - 5 * DAY
        m = v2.build_global_model(catalog, HISTORY, NOW)
        self.assertEqual(v2.new_book_ids(catalog, m), {"b7"})
        profile = v2.build_user_profile([], m)
        entries = {e["book_id"]: e for e in v2.rank(catalog, profile, m, CONFIG["weights"], use_pool=False)}
        others = [e for k, e in entries.items() if k != "b7"]
        mean_pop = sum(e["features"]["popularity"] for e in others) / len(others)
        self.assertAlmostEqual(entries["b7"]["features"]["popularity"], mean_pop)
        self.assertTrue(entries["b7"]["features"]["new_book"])
        out = v2.recommend(catalog, [], m, CONFIG, limit=10)
        codes = {e["book_id"]: e["reason_codes"] for e in out["entries"]}
        self.assertIn("NEW_ARRIVAL", codes["b7"])
        # An old title nobody borrowed is not "new": b2 has no created_at.
        self.assertNotIn("NEW_ARRIVAL", codes["b2"])

    def test_sparse_user_preference_is_smoothed_towards_the_library_mix(self):
        m = model(params={"prior_strength": 1.0})
        profile = v2.build_user_profile(v2.normalize_interactions([ev("LOAN", "x", "b4", 3)]), m)
        lich_su = v2.feature_vector(CATALOG[3], profile, m, 1.0)["preference_share"]
        cong_nghe = v2.feature_vector(CATALOG[0], profile, m, 1.0)["preference_share"]
        self.assertLess(lich_su, 1.0)
        self.assertGreater(cong_nghe, 0.0)
        self.assertGreater(lich_su, cong_nghe)


class EvidenceTests(unittest.TestCase):
    def test_contributions_sum_to_score_minus_pool_mean(self):
        m = model()
        profile = v2.build_user_profile([ev("LOAN", "x", "b1", 3)], m)
        ranked = v2.rank(CATALOG, profile, m, CONFIG["weights"], use_pool=False)
        contribs = v2.contributions(ranked, CONFIG["weights"])
        mean = sum(e["score"] for e in ranked) / len(ranked)
        for e, c in zip(ranked, contribs):
            self.assertAlmostEqual(sum(c.values()), e["score"] - mean, places=9)

    def test_reason_codes_are_backed_by_real_features(self):
        rows = v2.normalize_interactions([ev("LOAN", "x", "b1", 3), ev("REVIEW", "x", "b1", 2, rating=5)])
        out = v2.recommend(CATALOG, rows, model(), CONFIG, limit=5)
        by_id = {e["book_id"]: e for e in out["entries"]}
        self.assertIn("SIMILAR_USERS_LIKED", by_id["b3"]["reason_codes"])
        self.assertIn("HIGH_RATING", by_id["b3"]["reason_codes"])  # 3 reviews averaging 4.67
        self.assertIn("MATCHED_AUTHOR", by_id["b2"]["reason_codes"])
        self.assertNotIn("SIMILAR_USERS_LIKED", by_id["b4"]["reason_codes"])
        self.assertIn("CURRENTLY_UNAVAILABLE", by_id["b5"]["reason_codes"])
        for e in out["entries"]:
            self.assertIn(e["tier"], ("STRONG", "GOOD", "EXPLORE"))
            self.assertTrue(0.0 <= e["score"] <= 1.0)
            self.assertEqual(set(e["breakdown"]["contributions"]), set(v2.FEATURES))

    def test_rule_based_reason_uses_only_reason_codes(self):
        entry = {"category": "Cong nghe", "author": "Nguyen A", "reason_codes": ["MATCHED_AUTHOR", "AVAILABLE_NOW"]}
        text = v2.rule_based_reason_v2(entry)
        self.assertIn("Nguyen A", text)
        self.assertNotRegex(text, r"\d")
        self.assertIn("mới", v2.rule_based_reason_v2({"reason_codes": ["COLD_START_FALLBACK"]}))

    def test_unknown_availability_is_flagged_not_faked(self):
        m = model()
        profile = v2.build_user_profile([], m)
        f = v2.feature_vector({"id": "bx", "title": "x", "category": "Lich su"}, profile, m, None)
        self.assertFalse(f["availability_known"])


class MalformedInputTests(unittest.TestCase):
    def test_malformed_rows_are_dropped(self):
        rows = v2.normalize_interactions([
            None, {}, {"kind": "LOAN", "user": "u", "book_id": "b1"},              # no time
            {"kind": "LOAN", "user": "u", "book_id": "b1", "at": "not-a-date"},
            {"kind": "REVIEW", "user": "u", "book_id": "b1", "at": NOW, "rating": 9},
            {"kind": "HACK", "user": "u", "book_id": "b1", "at": NOW},
            {"kind": "LOAN", "user": "u", "book_id": "b1", "at": "2026-01-01T00:00:00Z"},
        ])
        self.assertEqual(len(rows), 1)

    def test_reader_payload_adapter_skips_garbage_and_maps_variants(self):
        rows = v2.interactions_from_reader_payloads(
            "me",
            loans=[None, {"borrow_date": "2026-01-01T00:00:00Z", "loan_items": [None, {"variant_id": "v-b1"}, {"variant_id": "nope"}]}],
            wishlists=[{"book_id": "b2", "created_at": "2026-01-02T00:00:00Z"}, "junk"],
            reviews=[{"book_id": "b3", "rating": 5, "created_at": "2026-01-03T00:00:00Z", "status": "HIDDEN"}],
            reservations=[{"variant_id": "v-b4", "status": "PENDING", "reserved_at": "2026-01-04T00:00:00Z"}],
            catalog=CATALOG,
        )
        self.assertEqual(sorted((r["kind"], r["book_id"]) for r in rows),
                         [("LOAN", "b1"), ("RESERVATION", "b4"), ("WISHLIST", "b2")])

    def test_global_payload_maps_variant_loans_to_books(self):
        rows = v2.interactions_from_global_payload(
            {"events": [{"kind": "LOAN", "u": 0, "variant_id": "v-b1", "at": "2026-01-01T00:00:00Z"},
                        {"kind": "LOAN", "u": 0, "variant_id": "unknown", "at": "2026-01-01T00:00:00Z"}, 7]},
            CATALOG)
        self.assertEqual([(r["user"], r["book_id"]) for r in rows], [("0", "b1")])


class FeatureFlagTests(unittest.TestCase):
    def test_select_model(self):
        self.assertEqual(svc.select_model("v1", CONFIG), ("v1", None))
        self.assertEqual(svc.select_model("V2", CONFIG), ("v2", None))
        model_name, reason = svc.select_model("v2", None)
        self.assertEqual(model_name, "v1")
        self.assertIn("missing", reason)
        self.assertEqual(svc.select_model("v3", CONFIG)[0], "v1")

    def test_load_config_rejects_invalid_files(self):
        with tempfile.TemporaryDirectory() as tmp:
            bad = os.path.join(tmp, "bad.json")
            with open(bad, "w", encoding="utf-8") as h:
                json.dump({"weights": {"semantic": 1}}, h)
            self.assertIsNone(v2.load_config(bad))
            self.assertIsNone(v2.load_config(os.path.join(tmp, "missing.json")))
            good = os.path.join(tmp, "good.json")
            with open(good, "w", encoding="utf-8") as h:
                json.dump({"weights": v2.DEFAULT_WEIGHTS, "feature_scale": {}, "params": {"prior_strength": 10}}, h)
            cfg = v2.load_config(good)
            self.assertEqual(cfg["params"]["prior_strength"], 10)
            self.assertEqual(cfg["feature_scale"]["popularity"], 1.0)

    def test_committed_weights_file_is_valid(self):
        self.assertIsNotNone(v2.load_config(), "recommendation_v2_weights.json must load")

    def test_global_cache_holds_only_the_shared_model_and_expires(self):
        clock = [0.0]
        cache = svc.GlobalModelCache(ttl_seconds=10, clock=lambda: clock[0])
        payload = {"events": [{"kind": "LOAN", "u": 0, "variant_id": "v-b1", "at": "2026-01-01T00:00:00Z"}]}
        first = svc.build_global(CATALOG, payload, CONFIG, cache, now=NOW)
        self.assertIs(svc.build_global(CATALOG, payload, CONFIG, cache, now=NOW), first)
        clock[0] = 11
        self.assertIsNot(svc.build_global(CATALOG, payload, CONFIG, cache, now=NOW), first)
        # A failed feed is not cached.
        cache.clear()
        svc.build_global(CATALOG, None, CONFIG, cache, now=NOW)
        self.assertIsNone(cache.get((svc.catalog_signature(CATALOG), json.dumps(CONFIG["params"], sort_keys=True))))

    def test_v2_response_is_backward_compatible_and_personal_per_reader(self):
        m, n = svc.build_global(CATALOG, None, CONFIG, None, now=NOW)
        m = model()
        reader_a = {"loans": [{"borrow_date": "2026-01-01T00:00:00Z", "loan_items": [{"variant_id": "v-b1"}]}], "loans_status": 200}
        reader_b = {"loans": [], "loans_status": 200}
        a = svc.build_response(CATALOG, reader_a, m, CONFIG, 3, 11)
        b = svc.build_response(CATALOG, reader_b, m, CONFIG, 3, 11)
        self.assertTrue(a["personalized"])
        self.assertFalse(b["personalized"])
        self.assertNotIn("b1", [e["book_id"] for e in a["recommendations"]])
        for key in ("book_id", "title", "author", "category", "score", "breakdown"):
            self.assertIn(key, a["recommendations"][0])
        for key in ("affinity", "semantic", "quality", "availability"):
            self.assertIn(key, a["recommendations"][0]["breakdown"])
        self.assertEqual(a["model"], "v2")


if __name__ == "__main__":
    unittest.main()
