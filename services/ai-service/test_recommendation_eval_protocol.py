"""Evaluation protocol guarantees for Recommendation V2 (eval/recsys_*.py)."""
from __future__ import annotations

import math
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "eval"))

import recommendation_v2 as v2  # noqa: E402
import recsys_protocol as proto  # noqa: E402
import recsys_tuning as tuning  # noqa: E402

DAY = 86400.0


def ev(kind, user, book_id, day, rating=None, until=None, variant=None):
    return {"kind": kind, "user": user, "book_id": book_id, "at": day * DAY, "rating": rating,
            "until": None if until is None else until * DAY, "variant_id": variant}


CATALOG = [
    {"id": f"b{i}", "title": f"Sach {i}", "author": f"Tac gia {i % 3}", "category": f"The loai {i % 2}",
     "variant_ids": [f"v{i}"], "description": ""}
    for i in range(1, 9)
]


def history():
    rows = []
    for u in range(6):
        user = f"u{u}"
        for d, b in enumerate(("b1", "b2", "b3", "b4")):
            if (u + d) % 2 == 0 or b == "b1":
                rows.append(ev("LOAN", user, b, 1 + d + u))
        rows.append(ev("LOAN", user, "b5" if u % 2 else "b6", 60 + u))   # validation window
        rows.append(ev("LOAN", user, "b7" if u % 2 else "b8", 90 + u))   # test window
    return v2.normalize_interactions(rows)


class SplitTests(unittest.TestCase):
    def test_quantile_cutoff_matches_evaluation_js_rule(self):
        rows = v2.normalize_interactions([ev("LOAN", "u", f"b{i}", i) for i in range(1, 11)])
        # floor(10 * 0.8) = 8 -> the 9th time (day 9)
        self.assertEqual(proto.loan_time_quantile(rows, 0.8), 9 * DAY)

    def test_targets_are_future_loans_not_seen_before_cutoff(self):
        rows = v2.normalize_interactions([
            ev("LOAN", "u", "b1", 1), ev("LOAN", "u", "b1", 20),        # re-borrow: not a target
            ev("LOAN", "u", "b2", 21),                                   # target
            ev("LOAN", "u", "b3", 40),                                   # after end: not a target
        ])
        split = proto.make_split(rows, 10 * DAY, 30 * DAY)
        self.assertEqual(split["users"]["u"]["targets"], {"b2"})
        self.assertEqual(split["users"]["u"]["train_loans"], 1)

    def test_wishlist_point_in_time_vs_legacy_snapshot(self):
        # Saved on day 2, removed on day 15 (after the cutoff) when it was borrowed.
        rows = v2.normalize_interactions([ev("LOAN", "u", "b9", 1), ev("WISHLIST", "u", "b1", 2, until=15), ev("LOAN", "u", "b1", 15)])
        audited = proto.make_split(rows, 10 * DAY, 30 * DAY, "audited")
        legacy = proto.make_split(rows, 10 * DAY, 30 * DAY, "legacy")
        # At the cutoff the row existed -> seen, the later loan is no valid target.
        self.assertNotIn("u", audited["users"])
        # The end-of-window snapshot lost the row -> legacy counts the loan as a target.
        self.assertEqual(legacy["users"]["u"]["targets"], {"b1"})

    def test_active_reservation_is_seen_only_in_audited_protocol(self):
        rows = v2.normalize_interactions([ev("LOAN", "u", "b9", 1), ev("RESERVATION", "u", "b1", 9, until=12), ev("LOAN", "u", "b1", 12)])
        self.assertNotIn("u", proto.make_split(rows, 10 * DAY, 30 * DAY, "audited")["users"])
        self.assertIn("u", proto.make_split(rows, 10 * DAY, 30 * DAY, "legacy")["users"])

    def test_availability_is_point_in_time(self):
        rows = v2.normalize_interactions([
            ev("LOAN", "a", "b1", 1, until=5, variant="v1"),
            ev("LOAN", "b", "b1", 3, until=None, variant="v1"),
            ev("RESERVATION", "c", "b2", 2, until=4, variant="v2"),
        ])
        copies = {"v1": 2, "v2": 1}
        at4 = proto.availability_at(CATALOG[:2], copies, rows, 4 * DAY)
        self.assertEqual(at4["b1"], 0.0)   # both copies out
        self.assertEqual(at4["b2"], 1.0)   # reservation ended at day 4
        self.assertEqual(proto.availability_at(CATALOG[:2], copies, rows, 3.5 * DAY)["b2"], 0.0)


class MetricTests(unittest.TestCase):
    def test_hand_computed_metrics(self):
        m = proto.per_user_metrics(["x", "a", "y", "b"], {"a", "b"}, k=3)
        self.assertEqual(m["hit_rate@3"], 1.0)
        self.assertEqual(m["recall@3"], 0.5)
        self.assertAlmostEqual(m["ndcg@3"], (1 / math.log2(3)) / (1 + 1 / math.log2(3)))
        self.assertEqual(m["mrr"], 0.5)

    def test_personalization_and_coverage(self):
        split = {"users": {"u1": {"targets": {"a"}}, "u2": {"targets": {"b"}}}}
        same = proto.ranking_metrics({"u1": ["a", "b"], "u2": ["a", "b"]}, split, 4, 2)
        diff = proto.ranking_metrics({"u1": ["a", "b"], "u2": ["c", "d"]}, split, 4, 2)
        self.assertEqual(same["personalization@2"], 0.0)
        self.assertEqual(diff["personalization@2"], 1.0)
        self.assertEqual(diff["catalog_coverage@2"], 1.0)

    def test_bootstrap_is_deterministic_and_paired(self):
        a = {f"u{i}": float(i % 2) for i in range(40)}
        b = {f"u{i}": 0.0 for i in range(40)}
        first = proto.paired_bootstrap(a, b, resamples=200)
        self.assertEqual(first, proto.paired_bootstrap(a, b, resamples=200))
        self.assertGreater(first["low"], 0)
        self.assertEqual(first["wins"] + first["losses"] + first["ties"], 40)


class LeakageTests(unittest.TestCase):
    def test_tuner_refuses_data_from_after_the_validation_window(self):
        rows = history()
        split = proto.make_split(rows, 50 * DAY, 80 * DAY)
        harness = tuning.Harness(CATALOG, rows, split, {})   # rows still contain the test window
        with self.assertRaises(ValueError):
            tuning.tune(harness, passes=1)

    def test_tuning_result_is_independent_of_the_test_window(self):
        rows = history()
        t_val, t_test = 50 * DAY, 80 * DAY
        visible = [r for r in rows if r["at"] < t_test]
        split = proto.make_split(visible, t_val, t_test)
        a = tuning.tune(tuning.Harness(CATALOG, visible, split, {}), passes=2)
        # Changing what happens in the test window cannot change the choice.
        rows_b = [r for r in rows if r["at"] < t_test] + v2.normalize_interactions([ev("LOAN", "u0", "b8", 95)] * 5)
        visible_b = [r for r in rows_b if r["at"] < t_test]
        b = tuning.tune(tuning.Harness(CATALOG, visible_b, proto.make_split(visible_b, t_val, t_test), {}), passes=2)
        self.assertEqual(a["weights"], b["weights"])
        self.assertEqual(a["params"], b["params"])

    def test_features_for_test_do_not_change_when_test_window_changes(self):
        rows = history()
        t_test = 80 * DAY
        split = proto.make_split(rows, t_test, 200 * DAY)
        extra = v2.normalize_interactions([ev("LOAN", "u1", "b2", 85), ev("REVIEW", "u1", "b2", 86, rating=1)])
        m1 = tuning.Harness(CATALOG, rows, split, {}).matrix(dict(v2.DEFAULT_PARAMS))
        m2 = tuning.Harness(CATALOG, rows + extra, split, {}).matrix(dict(v2.DEFAULT_PARAMS))
        for uid in m1["users"]:
            self.assertEqual(m1["users"][uid]["rows"], m2["users"][uid]["rows"])

    def test_tuning_is_deterministic(self):
        rows = [r for r in history() if r["at"] < 80 * DAY]
        split = proto.make_split(rows, 50 * DAY, 80 * DAY)
        a = tuning.tune(tuning.Harness(CATALOG, rows, split, {}), passes=2)
        b = tuning.tune(tuning.Harness(CATALOG, list(reversed(rows)), split, {}), passes=2)
        self.assertEqual(a["weights"], b["weights"])
        self.assertEqual(a["validation_objective"], b["validation_objective"])

    def test_ablation_keeps_removed_features_at_zero(self):
        rows = [r for r in history() if r["at"] < 80 * DAY]
        split = proto.make_split(rows, 50 * DAY, 80 * DAY)
        out = tuning.tune(tuning.Harness(CATALOG, rows, split, {}), fixed_zero=("collaborative",), passes=2)
        self.assertEqual(out["weights"]["collaborative"], 0.0)


if __name__ == "__main__":
    unittest.main()
