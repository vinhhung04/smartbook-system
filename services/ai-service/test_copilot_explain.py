"""copilot_explain: claims built from tool data (FACT / INFERENCE / ASSUMPTION /
UNKNOWN), certainty by stated rule, alternatives, the prompt brief, and the
post-generation wording check."""
from __future__ import annotations

import json
import unittest
from datetime import datetime

import copilot_explain as ce
import copilot_plan as cp

NOW = datetime(2026, 10, 14, 10, 0, tzinfo=cp.VN_TZ)
WAREHOUSES = [{"id": "w-hcm", "code": "WH-HCM-01", "name": "Kho HCM Chinh"},
              {"id": "w-hn", "code": "WH-HN-01", "name": "Kho Ha Noi"}]


def plan(message, state=None):
    return cp.build_plan(message, state, WAREHOUSES, NOW)


def kinds(expl, kind):
    return [c for c in expl["claims"] if c["kind"] == kind]


def _row(name, oos, low, avail):
    return {"warehouse_name": name, "out_of_stock_variants": oos, "low_stock_variants": low, "total_available_qty": avail}


COMPARE = {"ranking": [_row("Kho HCM Chinh", 3, 7, 120), _row("Kho Ha Noi", 0, 1, 8)], "unresolved": []}

SHORTAGE = {
    "warehouse_name": "Kho HCM Chinh",
    "summary": {"low_stock_items": 7, "out_of_stock_items": 3, "items_with_recent_demand": 6, "items_with_rising_demand": 1},
    "items": [
        {"title": "Norwegian Wood", "status": "HẾT HÀNG", "borrow_count": 72, "demand_trend_pct": -40.5,
         "reservation_count": 2, "lead_time_days": 30, "lead_time_source": "SUPPLIER_DECLARED"},
        {"title": "Tam Cam", "status": "HẾT HÀNG", "borrow_count": 3, "demand_trend_pct": 12.0, "lead_time_days": 7,
         "lead_time_source": "LEARNED"},
        {"title": "So do", "status": "DƯỚI NGƯỠNG", "borrow_count": 0, "lead_time_days": 7},
    ],
    "limitations": ["Nhu cầu mượn lấy từ mô hình đề xuất nhập, tính trên toàn hệ thống, không tách riêng theo kho."],
}

SIMULATION = {
    "full_need": {"total_candidates": 116, "high_priority": 97, "estimated_total_cost": 72979250,
                  "estimated_total_reorder_qty": 700},
    "scenarios": [
        {"label": "Ngân sách 5.000.000 ₫", "budget_vnd": 5e6, "funded_cost": 4890000, "remaining_vnd": 110000,
         "funded_lines": 4, "funded_qty": 29, "funded_high_priority": 3, "unfunded_high_priority": 94,
         "shortfall_covered_pct": 0.0, "funded_shortfall_lines": 0},
        {"label": "Ngân sách 20.000.000 ₫", "budget_vnd": 2e7, "funded_cost": 19888000, "remaining_vnd": 112000,
         "funded_lines": 11, "funded_qty": 151, "funded_high_priority": 10, "unfunded_high_priority": 87,
         "shortfall_covered_pct": 100.0, "funded_shortfall_lines": 5,
         "vs_first_scenario": {"budget_vnd": 15e6, "funded_cost": 14998000, "funded_lines": 7, "funded_qty": 122,
                               "unfunded_high_priority": -7}},
    ],
    "scenarios_are_assumed": False, "funding_rule": "Phân bổ theo thiếu hụt dự kiến trên mỗi đồng.",
    "items_counted": 100, "lines_with_shortfall": 5, "items_not_listed": 16,
}


def _item(title, priority, demand_score, **kw):
    base = {"variant_id": f"v-{title}", "title": title, "priority": priority, "demand_score": demand_score,
            "available_qty": 0, "reorder_point": 10, "borrow_count": 40, "suggested_reorder_qty": 12,
            "estimated_cost": 1_200_000, "lead_time_source": "DEFAULT", "lead_time_samples": 0}
    base.update(kw)
    return base


REORDER = {"summary": {"total_candidates": 3, "high_priority": 2, "estimated_total_reorder_qty": 36,
                       "estimated_total_cost": 3_600_000},
           "items": [_item("Sách A", "HIGH", 9.5, estimated_days_until_stockout=4),
                     _item("Sách B", "HIGH", 7.25), _item("Sách C", "MEDIUM", 9.9)]}


class WarehouseComparisonTests(unittest.TestCase):
    def test_ranking_conclusion_is_an_inference_with_the_deciding_criterion(self):
        expl = ce.build_explanation(plan("Kho HCM Chinh với Kho Ha Noi kho nào rủi ro hơn?"), {"compare_warehouses": COMPARE})
        inference = kinds(expl, ce.INFERENCE)[0]
        self.assertEqual(inference["statement"], "Kho HCM Chinh rủi ro thiếu sách cao hơn Kho Ha Noi.")
        self.assertEqual(inference["certainty"], ce.HIGH)  # decided by the first criterion
        self.assertIn("số đầu sách hết hàng: 3 so với 0", inference["meaning"])
        # The figure that looks contradictory (more stock, more risk) is explained.
        self.assertIn("tổng tồn nhiều không có nghĩa", inference["meaning"])
        self.assertTrue(inference["basis"].startswith("Xếp hạng rủi ro"))
        self.assertEqual(len(kinds(expl, ce.FACT)), 2)
        self.assertTrue(any("theo từng kho" in c["statement"] for c in kinds(expl, ce.UNKNOWN)))
        self.assertEqual(expl["mode"], cp.COMPARISON)

    def test_certainty_drops_when_only_a_weaker_criterion_separates_them(self):
        r = {"ranking": [_row("Kho A", 1, 2, 10), _row("Kho B", 1, 2, 50)]}
        expl = ce.build_explanation(plan("Kho HCM Chinh với Kho Ha Noi kho nào rủi ro hơn?"), {"compare_warehouses": r})
        self.assertEqual(kinds(expl, ce.INFERENCE)[0]["certainty"], ce.LOW)
        tie = {"ranking": [_row("Kho A", 1, 2, 10), _row("Kho B", 1, 2, 10)]}
        expl = ce.build_explanation(plan("Kho HCM Chinh với Kho Ha Noi kho nào rủi ro hơn?"), {"compare_warehouses": tie})
        self.assertIn("ngang nhau", kinds(expl, ce.INFERENCE)[0]["statement"])

    def test_every_evidence_value_comes_from_the_tool_data(self):
        expl = ce.build_explanation(plan("Kho HCM Chinh với Kho Ha Noi kho nào rủi ro hơn?"), {"compare_warehouses": COMPARE})
        raw = json.dumps(COMPARE)
        for value in ce.numbers_in(expl):
            self.assertIn(str(value), raw)


class CausalTests(unittest.TestCase):
    def test_shortage_factors_are_correlations_with_unknowns_stated(self):
        expl = ce.build_explanation(plan("Tại sao Kho HCM Chinh thiếu sách?"), {"explain_warehouse_shortage": SHORTAGE})
        self.assertIn("causal", expl["flags"])
        self.assertIn("tương quan", expl["headline"])
        for claim in kinds(expl, ce.INFERENCE):
            self.assertIn(claim["certainty"], (ce.MEDIUM, ce.LOW))
            self.assertTrue(claim["basis"])
        demand = next(c for c in kinds(expl, ce.INFERENCE) if "nhu cầu mượn thực" in c["statement"])
        self.assertEqual(demand["evidence"][0]["label"], "Norwegian Wood")
        self.assertEqual(demand["evidence"][0]["value"], 72)
        self.assertEqual(len(kinds(expl, ce.UNKNOWN)), 2)
        self.assertTrue(kinds(expl, ce.ASSUMPTION))  # 30-day lead time is the supplier's word
        self.assertEqual(expl["next_actions"], [])  # causal question, not advice


class SimulationTests(unittest.TestCase):
    def test_zero_shortfall_coverage_is_explained_not_left_contradictory(self):
        expl = ce.build_explanation(plan("Nếu ngân sách 5 triệu và 20 triệu thì sao?"), {"simulate_reorder_budget": SIMULATION})
        zero = next(c for c in kinds(expl, ce.INFERENCE) if "chưa bù được" in c["statement"])
        self.assertEqual(zero["certainty"], ce.HIGH)
        self.assertIn("5 dòng có thiếu hụt dự kiến", zero["meaning"])

    def test_full_coverage_of_listed_lines_is_not_presented_as_all_need(self):
        expl = ce.build_explanation(plan("Nếu ngân sách 5 triệu và 20 triệu thì sao?"), {"simulate_reorder_budget": SIMULATION})
        self.assertIn("coverage_incomplete", expl["flags"])
        twenty = next(c for c in kinds(expl, ce.FACT) if c["statement"].startswith("Ngân sách 20.000.000"))
        self.assertIn("16 đầu sách ngoài danh sách chưa được tính", twenty["meaning"])

    def test_scenarios_become_alternatives_with_computed_tradeoffs(self):
        expl = ce.build_explanation(plan("Nếu ngân sách 5 triệu và 20 triệu thì sao?"), {"simulate_reorder_budget": SIMULATION})
        alt = expl["alternatives"][0]
        self.assertEqual(alt["option"], "Ngân sách 20.000.000 ₫")
        self.assertIn("+14.998.000 ₫", alt["tradeoff"])
        self.assertIn("-7 ưu tiên cao", alt["tradeoff"])
        self.assertTrue(any("tối ưu tuyệt đối" in c["statement"] for c in kinds(expl, ce.INFERENCE)))
        self.assertTrue(expl["next_actions"])

    def test_assumed_budgets_are_marked_and_get_no_purchase_step(self):
        data = {**SIMULATION, "scenarios_are_assumed": True}
        expl = ce.build_explanation(plan("Nếu giảm ngân sách nhập hàng thì sao?"), {"simulate_reorder_budget": data})
        self.assertTrue(any("giả định theo %" in c["statement"] for c in kinds(expl, ce.ASSUMPTION)))
        self.assertEqual(expl["next_actions"], [])

    def test_a_failed_scenario_is_an_unknown(self):
        data = {**SIMULATION, "scenarios": [{"label": "Ngân sách 1 ₫", "error": "HTTP 500"}]}
        expl = ce.build_explanation(plan("Nếu ngân sách 5 triệu thì sao?"), {"simulate_reorder_budget": data})
        self.assertTrue(any("Không mô phỏng được" in c["statement"] for c in kinds(expl, ce.UNKNOWN)))


class ReorderTests(unittest.TestCase):
    def test_first_line_is_recommended_with_rule_based_certainty_and_why_others_rank_lower(self):
        expl = ce.build_explanation(plan("Tôi nên nhập sách nào trước?"), {"get_reorder_suggestions": REORDER})
        first = kinds(expl, ce.INFERENCE)[0]
        self.assertEqual(first["statement"], "Nên xem xét nhập Sách A trước.")
        self.assertEqual(first["certainty"], ce.LOW)  # default lead time -> data confidence THẤP
        reasons = {a["option"]: a["tradeoff"] for a in expl["alternatives"]}
        self.assertIn("điểm nhu cầu thấp hơn (7,25 so với 9,5)", reasons["Sách B"])
        self.assertIn("mức ưu tiên thấp hơn (MEDIUM so với HIGH)", reasons["Sách C"])
        self.assertTrue(any("thời gian chờ" in c["statement"] for c in kinds(expl, ce.ASSUMPTION)))
        self.assertIn("xác nhận", expl["next_actions"][0])

    def test_lookup_keeps_only_facts_and_hides_the_panel(self):
        expl = ce.build_explanation(plan("Có bao nhiêu phiếu quá hạn?"),
                                    {"get_overdue_summary": {"total_overdue_loans": 371, "average_overdue_days": 238.4,
                                                             "oldest_overdue_days": 500}})
        self.assertEqual(expl["mode"], cp.LOOKUP)
        self.assertFalse(kinds(expl, ce.INFERENCE))
        self.assertFalse(expl["display"])
        self.assertEqual(expl["alternatives"], [])

    def test_unknown_book_is_not_explained_with_made_up_reasons(self):
        expl = ce.build_explanation(plan('Tại sao "Sách Không Có" được đề xuất nhập?'),
                                    {"explain_reorder_item": {"found": False, "query": "Sách Không Có", "total_candidates": 116}})
        self.assertTrue(kinds(expl, ce.UNKNOWN))
        self.assertEqual(kinds(expl, ce.INFERENCE)[0]["certainty"], ce.LOW)


class MissingDataTests(unittest.TestCase):
    def test_permission_and_errors_become_unknowns_without_numbers(self):
        expl = ce.build_explanation(plan("Tình hình quá hạn thế nào?"), {
            "get_overdue_summary": {"error": "/analytics/overdue-summary tra ve HTTP 403"},
            "get_fine_summary": {"error": "timeout"},
        })
        unknown = [c["statement"] for c in kinds(expl, ce.UNKNOWN)]
        self.assertIn("không có quyền xem dữ liệu phiếu quá hạn", unknown[0])
        self.assertIn("Chưa lấy được dữ liệu tiền phạt", unknown[1])
        self.assertEqual(ce.numbers_in(expl), [])

    def test_why_not_without_alternative_data_says_so(self):
        state = {"capabilities": ["overdue"], "analysis": "lookup", "tool_calls": [{"name": "get_overdue_summary", "args": {}}]}
        p = plan("Vì sao không chọn phương án khác?", state)
        expl = ce.build_explanation(p, {"get_overdue_summary": {"total_overdue_loans": 3}})
        self.assertTrue(any("không có phương án thay thế" in c["statement"] for c in kinds(expl, ce.UNKNOWN)))

    def test_nothing_to_explain(self):
        self.assertIsNone(ce.build_explanation(plan("Tại sao kho này thiếu sách?"), {"x": 1}))  # clarification
        self.assertIsNone(ce.build_explanation(plan("Tôi nên nhập sách nào trước?"), {}))
        self.assertIsNone(ce.build_explanation(None, {"get_top_books": []}))


class BriefTests(unittest.TestCase):
    def test_brief_tags_each_claim_and_names_the_cards(self):
        expl = ce.build_explanation(plan("Tôi nên nhập sách nào trước?"), {"get_reorder_suggestions": REORDER})
        brief = ce.explanation_brief(expl, ["Sách A"])
        self.assertIn("[SUY LUẬN, mức chắc chắn THẤP] Nên xem xét nhập Sách A trước.", brief)
        self.assertIn("[DỮ KIỆN]", brief)
        self.assertIn("[GIẢ ĐỊNH]", brief)
        self.assertIn("[PHƯƠNG ÁN KHÁC] Sách B", brief)
        self.assertIn("thẻ đề xuất kèm số liệu cho: Sách A", brief)
        self.assertLessEqual(len(ce.explanation_brief(expl, limit=400)), 420)
        self.assertEqual(ce.explanation_brief(None), "")


class OverclaimTests(unittest.TestCase):
    def setUp(self):
        self.causal = ce.build_explanation(plan("Tại sao Kho HCM Chinh thiếu sách?"), {"explain_warehouse_shortage": SHORTAGE})
        self.sim = ce.build_explanation(plan("Nếu ngân sách 5 triệu và 20 triệu thì sao?"), {"simulate_reorder_budget": SIMULATION})

    def phrases(self, answer, expl):
        return [f["phrase"] for f in ce.overclaims(answer, expl)]

    def test_causal_assertions_are_flagged(self):
        self.assertEqual(self.phrases("Kho thiếu sách chủ yếu do nhu cầu tăng.", self.causal), ["chủ yếu do"])
        self.assertEqual(self.phrases("Nguyên nhân chính là thời gian chờ hàng.", self.causal), ["nguyên nhân chính"])

    def test_hedged_or_negated_wording_passes(self):
        self.assertEqual(self.phrases("Chưa thể khẳng định đây là do nhu cầu; dữ liệu cho thấy hai yếu tố đi kèm.",
                                      self.causal), [])
        self.assertEqual(self.phrases("Mức chắc chắn: trung bình.", self.causal), [])
        self.assertEqual(self.phrases("Mô phỏng không khẳng định đây là mức tối ưu.", self.sim), [])
        self.assertEqual(self.phrases("Hệ thống tối ưu hóa theo thiếu hụt.", self.sim), [])

    def test_optimality_certainty_and_full_coverage_claims_in_a_simulation(self):
        found = self.phrases("Đây là phương án tối ưu, chắc chắn đáp ứng toàn bộ nhu cầu.", self.sim)
        self.assertEqual(sorted(found), sorted(["tối ưu", "chắc chắn", "đáp ứng toàn bộ"]))
        self.assertEqual(self.phrases("Bù đủ 100% thiếu hụt, tức đáp ứng 100% của 100 dòng được liệt kê.", self.sim), [])
        self.assertEqual(self.phrases("Ngân sách này đáp ứng **100%** thiếu hụt.", self.sim), ["đáp ứng 100%"])

    def test_scenario_names_and_selected_lines_are_not_coverage_claims(self):
        # false positives found in the 3.1 held-out evaluation (xai-wi-05, xai-wi-02)
        self.assertEqual(self.phrases("- **100% nhu cầu (68.375.250 ₫)**: duyệt 68.375.250 ₫ cho 100 đầu sách.", self.sim), [])
        self.assertEqual(self.phrases("- Từ \"100% nhu cầu\" xuống \"75%\": tiết kiệm 17.133.150 ₫.", self.sim), [])
        self.assertEqual(self.phrases("Mức ngân sách này đáp ứng đủ thiếu hụt dự kiến của các dòng được chọn, nhưng chưa "
                                      "bao phủ toàn bộ nhu cầu.", self.sim), [])
        self.assertEqual(self.phrases("Ngân sách này đáp ứng 100% nhu cầu của thư viện.", self.sim), ["đáp ứng 100%"])

    def test_no_explanation_means_nothing_to_check(self):
        self.assertEqual(ce.overclaims("chắc chắn là do", None), [])
        self.assertIsNone(ce.overclaim_warning([]))
        warning = ce.overclaim_warning([{"phrase": "chủ yếu do", "reason": "tương quan"}])
        self.assertIn("\"chủ yếu do\"", warning)


if __name__ == "__main__":
    unittest.main()
