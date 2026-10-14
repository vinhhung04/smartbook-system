"""eval/eval_explain.py scorer: gold derivations from tool data, fact matching,
and the wording checks - pinned so a before/after comparison means the same
thing on both runs."""
from __future__ import annotations

import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "eval"))
import eval_explain as ee  # noqa: E402

DATA = {
    "get_warehouse_stock_risk": [
        {"warehouse_name": "Kho Ha Noi", "out_of_stock_variants": 0, "low_stock_variants": 1, "total_available_qty": 8},
        {"warehouse_name": "Kho HCM Chinh", "out_of_stock_variants": 3, "low_stock_variants": 7, "total_available_qty": 120},
    ],
    "get_reorder_suggestions": {"budget": {"funded_cost": 9_876_000}, "items": [
        {"title": "Sách đắt", "within_budget": False}, {"title": "Kafka on the Shore", "within_budget": True}]},
    "compare_borrow_periods": {"metrics": {"loans": {"current": 72, "previous": 921, "per_day_change_pct": -82.0}}},
    "get_overdue_summary#2": {"error": "HTTP 403"},
}


class GoldTests(unittest.TestCase):
    def test_derivations_read_the_turn_data(self):
        self.assertEqual(ee.gold_value("riskiest_wh", DATA), "Kho HCM Chinh")
        self.assertEqual(ee.gold_value("riskiest_wh_oos", DATA), 3)
        self.assertEqual(ee.gold_value("reorder_first_title", DATA), "Kafka on the Shore")  # within budget only
        self.assertEqual(ee.gold_value("sim_funded_cost", DATA), 9_876_000)
        self.assertEqual(ee.gold_value("loans_per_day_change", DATA), 82.0)
        self.assertIsNone(ee.gold_value("overdue_total", DATA))  # an error result is not data
        self.assertIsNone(ee.gold_value("top1_title", {}))

    def test_fact_matching(self):
        self.assertTrue(ee.fact_in(9_876_000, "duyệt 9.876.000 ₫"))
        self.assertTrue(ee.fact_in(82.0, "giảm 82% mỗi ngày"))
        self.assertTrue(ee.fact_in(238.4, "trễ trung bình 238,4 ngày"))
        self.assertFalse(ee.fact_in(72, "có 720 lượt"))
        self.assertTrue(ee.fact_in("Kho HCM Chinh", "kho hcm chinh rủi ro hơn"))
        self.assertTrue(ee.fact_in("Dế Mèn Phiêu Lưu Ký", "sách de men phieu luu ky"))
        self.assertTrue(ee.fact_in("Kho HCM Chinh", "Kho **HCM Chinh** rủi ro hơn"))  # markdown emphasis
        self.assertFalse(ee.fact_in(None, "anything"))


class WordingTests(unittest.TestCase):
    def test_overclaims_by_mode_with_negation(self):
        self.assertEqual(ee.overclaims("Thiếu sách chủ yếu do nhu cầu tăng.", "causal", {}), ["chu yeu do"])
        self.assertEqual(ee.overclaims("Chưa thể khẳng định đây là do nhu cầu.", "causal", {}), [])
        self.assertEqual(ee.overclaims("Thiếu sách chủ yếu do nhu cầu tăng.", "lookup", {}), [])
        self.assertEqual(ee.overclaims("Đây là phương án tối ưu.", "decision", {}), ["toi uu"])
        sim = {"simulate_reorder_budget": {"items_not_listed": 16, "scenarios": []}}
        self.assertEqual(ee.overclaims("Mức này đáp ứng 100% thiếu hụt.", "what_if", sim), ["dap ung 100%"])
        self.assertEqual(ee.overclaims("Đáp ứng 100% thiếu hụt của 100 dòng được liệt kê.", "what_if", sim), [])

    def test_card_duplication_counts_card_figures_repeated_in_text(self):
        recs = [{"metrics": [{"value": 29, "unit": "bản"}, {"value": 5_220_000, "unit": "đ"}, {"value": 5, "unit": "bản"}]}]
        self.assertEqual(ee.card_duplication("Nhập 29 bản, khoảng 5.220.000 ₫.", recs), 1.0)
        self.assertEqual(ee.card_duplication("Nên nhập Norwegian Wood trước.", recs), 0.0)
        self.assertIsNone(ee.card_duplication("x", []))


if __name__ == "__main__":
    unittest.main()
