"""Copilot 3.2 structured decision verification (copilot_verification) and its
place in /assistant and /assistant/stream.

Fixtures copy the shapes (and, for the regressions, the values) of real tool
results collected on 2026-10-15 (eval/faithfulness_answers_live.json)."""
from __future__ import annotations

import json
import unittest
from unittest.mock import AsyncMock, patch

import copilot_verification as v
import main
from main import AssistantRequest
from test_copilot_endpoints import ADMIN, SequenceProvider, _request
from test_copilot_visualization import WAREHOUSES, FakeStoreWithData

HCM, HN, D1 = "d8e151d8-fd15-4477-bbfd-59d10f778ab5", "73318a97-5043-4338-b88b-797fa76e51b7", "7fda99eb-8bf0-4b50-9d64-fe195beb724d"

SIM = {
    "full_need": {"total_candidates": 116, "high_priority": 95, "estimated_total_cost": 68375250, "estimated_total_reorder_qty": 563},
    "scenarios": [
        {"label": "Ngân sách 10.000.000 ₫", "budget_vnd": 10000000.0, "funded_cost": 9987000, "remaining_vnd": 13000,
         "funded_lines": 9, "funded_qty": 92, "funded_high_priority": 5, "unfunded_high_priority": 90,
         "shortfall_covered_pct": 100.0, "funded_shortfall_lines": 1,
         "funded_items": [{"variant_id": "v1", "title": "Norwegian Wood", "priority": "HIGH", "suggested_reorder_qty": 28,
                           "estimated_cost": 5040000}]},
        {"label": "Ngân sách 20.000.000 ₫", "budget_vnd": 20000000.0, "funded_cost": 19944000, "remaining_vnd": 56000,
         "funded_lines": 19, "funded_qty": 155, "funded_high_priority": 15, "unfunded_high_priority": 80,
         "shortfall_covered_pct": 100.0, "funded_shortfall_lines": 1,
         "vs_first_scenario": {"budget_vnd": 10000000.0, "funded_cost": 9957000, "funded_lines": 10, "funded_qty": 63,
                               "unfunded_high_priority": -10}},
    ],
    "scenarios_are_assumed": False, "items_counted": 100, "lines_with_shortfall": 1, "items_not_listed": 16,
    "funding_rule": "ưu tiên dòng giảm được nhiều thiếu hụt dự kiến nhất trên mỗi đồng.",
    "retrieved_at": "2026-10-15T07:02:17+00:00",
}
# the task's money example: 8.976.000 approved, an answer saying 9.876.000
SIM_MONEY = {"full_need": {"total_candidates": 40, "high_priority": 12, "estimated_total_cost": 30000000},
             "scenarios": [{"label": "Ngân sách 10.000.000 ₫", "budget_vnd": 10000000.0, "funded_cost": 8976000,
                            "remaining_vnd": 1024000, "funded_lines": 9, "funded_qty": 70, "funded_high_priority": 6,
                            "unfunded_high_priority": 6}]}
PERIODS = {
    "current_period": {"from": "2026-10-01", "to": "2026-10-15", "days": 15, "peak_day": "2026-10-06", "peak_loans": 33},
    "previous_period": {"from": "2026-09-01", "to": "2026-09-30", "days": 30, "peak_day": "2026-09-07", "peak_loans": 54},
    "metrics": {"loans": {"current": 79, "previous": 921, "change": -842, "change_pct": -91.4, "current_per_day": 5.27,
                          "previous_per_day": 30.7, "per_day_change_pct": -82.8}},
    "unequal_length": True, "retrieved_at": "2026-10-15T06:59:32+00:00",
}
MONTHS = [{"date": d, "loans": n, "returns": n, "reservations": 1} for d, n in
          (("2026-05", 1096), ("2026-06", 905), ("2026-07", 908), ("2026-08", 1092), ("2026-09", 921))]
RISK = [
    {"warehouse_id": HCM, "warehouse_name": "Kho HCM Chinh", "out_of_stock_variants": 3, "low_stock_variants": 7, "total_available_qty": 121},
    {"warehouse_id": D1, "warehouse_name": "Chi Nhanh District 1", "out_of_stock_variants": 1, "low_stock_variants": 1, "total_available_qty": 19},
    {"warehouse_id": HN, "warehouse_name": "Kho Ha Noi", "out_of_stock_variants": 0, "low_stock_variants": 1, "total_available_qty": 8},
]
REORDER = {
    "generated_at": "2026-10-15T07:00:56.393Z", "range": {"from": "2026-09-15", "to": "2026-10-15"},
    "summary": {"total_candidates": 116, "high_priority": 95, "estimated_total_reorder_qty": 563, "estimated_total_cost": 68375250},
    "budget": None,
    "items": [
        {"variant_id": "v-nw", "title": "Norwegian Wood", "available_qty": 5, "on_hand_qty": 5, "reorder_point": 10,
         "borrow_count": 60, "previous_borrow_count": 123, "demand_trend_pct": -51.2, "priority": "HIGH",
         "suggested_reorder_qty": 28, "lead_time_days": 30, "lead_time_source": "SUPPLIER_DECLARED", "unit_cost": 180000,
         "estimated_cost": 5040000, "forecast_30d": 0},
        {"variant_id": "v-kf", "title": "Kafka on the Shore", "available_qty": 3, "on_hand_qty": 3, "reorder_point": 1,
         "borrow_count": 19, "previous_borrow_count": 63, "demand_trend_pct": -69.8, "priority": "HIGH",
         "suggested_reorder_qty": 7, "lead_time_days": 14, "lead_time_source": "DEFAULT", "unit_cost": None,
         "estimated_cost": None},
        {"variant_id": "v-pm", "title": "Project Hail Mary", "available_qty": 6, "on_hand_qty": 6, "reorder_point": 6,
         "borrow_count": 30, "previous_borrow_count": 29, "demand_trend_pct": 3.4, "priority": "MEDIUM",
         "suggested_reorder_qty": 4, "lead_time_days": 14, "lead_time_source": "DEFAULT", "estimated_cost": 400000},
    ],
}
LOW_TRUNCATED = {"warehouse_id": HCM, "warehouse_name": "Kho HCM Chinh", "total_items": 12, "out_of_stock_count": 4,
                 "truncated": True, "items": [
                     {"variant_id": "v-nw", "title": "Norwegian Wood", "status": "DƯỚI NGƯỠNG", "available_qty": 2,
                      "on_hand_qty": 2, "reorder_point": 10},
                     {"variant_id": "v-tc", "title": "Tam Cam", "status": "HẾT HÀNG", "available_qty": 0, "on_hand_qty": 20,
                      "reorder_point": 10}]}
SHORTAGE = {"warehouse_id": HCM, "warehouse_name": "Kho HCM Chinh",
            "summary": {"low_stock_items": 7, "out_of_stock_items": 3, "items_with_recent_demand": 5, "items_with_rising_demand": 0},
            "items": []}
OVERDUE = {"total_overdue_items": 675, "total_overdue_loans": 400, "average_overdue_days": 226.5, "items": []}


def check(answer, data, explanation=None, visualizations=None):
    sheet = v.build_sheet(data, explanation, visualizations)
    return v.verify(answer, sheet)


def bad(answer, data, **kw):
    """(category, verdict) of every problem found."""
    return sorted({(c.category, c.verdict) for c in check(answer, data, **kw).problems})


class NumericClaimTests(unittest.TestCase):
    def test_wrong_title_count_regression_xai_mt_03(self):
        # real draft: "hệ thống đề xuất nhập 5 đầu sách" - 9 approved; 5 is the high-priority count
        rep = check("Với ngân sách 10.000.000 ₫, hệ thống đề xuất nhập 5 đầu sách sau:", {"simulate_reorder_budget": SIM})
        c = rep.critical[0]
        self.assertEqual((c.category, c.verdict, c.severity), ("COUNT", "CONTRADICTED", "critical"))
        self.assertIn("9 đầu sách", c.detail)
        self.assertIn("ưu tiên cao", c.detail)  # says what the 5 actually is
        self.assertEqual(bad("Với 10 triệu, hệ thống duyệt 9 đầu sách (92 bản).", {"simulate_reorder_budget": SIM}), [])

    def test_titles_are_not_copies(self):
        self.assertEqual(bad("Mức 20 triệu duyệt được 155 đầu sách.", {"simulate_reorder_budget": SIM}),
                         [("COUNT", "CONTRADICTED")])
        self.assertEqual(bad("Mức 20 triệu duyệt được 19 đầu sách, tổng 155 bản.", {"simulate_reorder_budget": SIM}), [])

    def test_wrong_money_and_budget_versus_approved_cost(self):
        self.assertEqual(bad("Với ngân sách 10 triệu, chi phí được duyệt là 9.876.000 ₫.", {"simulate_reorder_budget": SIM_MONEY}),
                         [("MONEY", "CONTRADICTED")])
        self.assertEqual(bad("Với ngân sách 10 triệu, chi phí được duyệt là 8.976.000 ₫.", {"simulate_reorder_budget": SIM_MONEY}), [])
        # the budget presented as the approved cost
        self.assertEqual(bad("Phương án 20 triệu dùng hết 20.000.000 ₫.", {"simulate_reorder_budget": SIM}),
                         [("MONEY", "CONTRADICTED")])
        # remaining of another scenario
        self.assertEqual(bad("Với 10 triệu, chi phí duyệt 9.987.000 ₫ và còn dư 56.000 ₫.", {"simulate_reorder_budget": SIM}),
                         [("MONEY", "CONTRADICTED")])

    def test_budget_compliance(self):
        self.assertEqual(bad("Cả hai phương án đều vượt ngân sách.", {"simulate_reorder_budget": SIM}), [("BUDGET", "CONTRADICTED")])
        self.assertEqual(bad("Cả hai phương án đều không vượt ngân sách.", {"simulate_reorder_budget": SIM}), [])

    def test_addition_between_scenarios(self):
        self.assertEqual(bad("Chuyển từ 10 triệu lên 20 triệu, chi phí duyệt tăng thêm 10.957.000 ₫.", {"simulate_reorder_budget": SIM}),
                         [("MONEY", "CONTRADICTED")])
        self.assertEqual(bad("So với mức 10 triệu, mức 20 triệu chi thêm 9.957.000 ₫ và duyệt thêm 10 đầu sách.",
                             {"simulate_reorder_budget": SIM}), [])

    def test_percent_sign_and_magnitude(self):
        self.assertEqual(bad("Lượt mượn trung bình mỗi ngày tăng 82,8% so với tháng trước.", {"compare_borrow_periods": PERIODS}),
                         [("PERCENT", "CONTRADICTED")])
        self.assertEqual(bad("Tính theo ngày, lượt mượn giảm khoảng 28% so với tháng trước.", {"compare_borrow_periods": PERIODS}),
                         [("PERCENT", "CONTRADICTED")])
        self.assertEqual(bad("Tính theo trung bình mỗi ngày, lượt mượn giảm 82,8%.", {"compare_borrow_periods": PERIODS}), [])
        # a budget cut is not a borrowing percentage
        self.assertEqual(bad("Nếu giảm 30% ngân sách thì số đầu sách được duyệt giảm.", {"compare_borrow_periods": PERIODS}), [])

    def test_paraphrased_and_rounded_values_pass(self):
        self.assertEqual(bad("Nhập đủ toàn bộ danh sách đề xuất ước tính khoảng 68,4 triệu đồng.", {"get_reorder_suggestions": REORDER}), [])
        self.assertEqual(bad("Mức 10 triệu dùng gần hết ngân sách, chỉ còn dư khoảng 13 nghìn đồng.", {"simulate_reorder_budget": SIM}), [])
        self.assertEqual(bad("Để nhập toàn bộ đề xuất cần 68.735.250 ₫.", {"get_reorder_suggestions": REORDER}),
                         [("MONEY", "CONTRADICTED")])


class TemporalClaimTests(unittest.TestCase):
    def test_days_into_the_month_regression_viz_cp_04(self):
        rep = check("Tổng lượt mượn tháng này mới là 79 so với 921, nhưng tháng này mới qua 13 ngày nên so sánh tổng chưa công bằng.",
                    {"compare_borrow_periods": PERIODS})
        self.assertEqual([(c.category, c.expected) for c in rep.critical], [("PERIOD", "15 ngày")])

    def test_period_swap(self):
        self.assertEqual(bad("Tháng 10 ghi nhận 921 lượt mượn, còn tháng 9 chỉ có 79 lượt.", {"compare_borrow_periods": PERIODS}),
                         [("PERIOD", "CONTRADICTED")])
        self.assertEqual(bad("Từ 01/10 đến 15/10 có 79 lượt mượn, so với 921 lượt của cả tháng 9.", {"compare_borrow_periods": PERIODS}), [])

    def test_monthly_total_called_a_peak_day_regression_viz_tr_02(self):
        self.assertEqual(bad("Ngày cao điểm nhất ghi nhận được là vào tháng 05/2026 với 1.096 lượt mượn.", {"get_borrow_trends": MONTHS}),
                         [("PERIOD", "CONTRADICTED")])
        self.assertEqual(bad("Ngày cao điểm của tháng này là 07/10 với 33 lượt.", {"compare_borrow_periods": PERIODS}),
                         [("PERIOD", "CONTRADICTED")])
        self.assertEqual(bad("Ngày cao điểm của tháng này là 06/10 với 33 lượt.", {"compare_borrow_periods": PERIODS}), [])

    def test_month_value_mixup(self):
        self.assertEqual(bad("Tháng 08/2026 có 1.096 lượt mượn.", {"get_borrow_trends": MONTHS}), [("PERIOD", "CONTRADICTED")])
        self.assertEqual(bad("Tháng 05/2026 có 1.096 lượt mượn, tháng 09/2026 còn 921 lượt.", {"get_borrow_trends": MONTHS}), [])


class ComparativeClaimTests(unittest.TestCase):
    def test_stable_trend_for_a_falling_title_regression_xai_mt_01(self):
        rep = check("Dù lượt mượn của Norwegian Wood giảm 51,2%, điều này cho thấy cuốn sách vẫn giữ được sức hút ổn định.",
                    {"get_reorder_suggestions": REORDER})
        self.assertIn(("TREND", "CONTRADICTED"), [(c.category, c.verdict) for c in rep.problems])
        self.assertEqual(bad("Project Hail Mary có lượt mượn ổn định.", {"get_reorder_suggestions": REORDER}), [])
        self.assertEqual(bad("Sức hút của Norwegian Wood ổn định hơn Kafka on the Shore.", {"get_reorder_suggestions": REORDER}), [])

    def test_library_trend_called_stable(self):
        self.assertEqual(bad("Nhìn chung lượt mượn tháng này vẫn ổn định so với tháng trước.", {"compare_borrow_periods": PERIODS}),
                         [("TREND", "CONTRADICTED")])
        self.assertEqual(bad("Lượt mượn không tăng mà giảm mạnh.", {"compare_borrow_periods": PERIODS}), [])

    def test_ranking_reversal(self):
        data = {"get_warehouse_stock_risk": RISK}
        self.assertEqual(bad("Kho Ha Noi đang đáng lo hơn Kho HCM Chinh về thiếu sách.", data), [("RANKING", "CONTRADICTED")])
        self.assertEqual(bad("Kho HCM Chinh an toàn hơn Kho Ha Noi vì tồn khả dụng nhiều hơn.", data), [("RANKING", "CONTRADICTED")])
        self.assertEqual(bad("Chi Nhanh District 1 là nơi có nguy cơ thiếu sách lớn nhất.", data), [("RANKING", "CONTRADICTED")])
        self.assertEqual(bad("So với Kho HCM Chinh, Kho Ha Noi ít rủi ro hơn.", data), [])
        self.assertEqual(bad("Mặc dù tồn khả dụng của Kho HCM Chinh lớn hơn (121 so với 8 bản của Kho Ha Noi), kho này vẫn rủi ro hơn.",
                             data), [])

    def test_warehouse_a_b_mixup(self):
        rep = check("Kho Ha Noi có 3 đầu sách hết hàng, còn Kho HCM Chinh chưa có đầu sách nào hết.", {"get_warehouse_stock_risk": RISK})
        self.assertEqual([c.category for c in rep.critical], ["ENTITY", "ENTITY"])  # 3 is HCM's, 0 is Ha Noi's
        self.assertEqual(bad("Kho HCM Chinh có 3 đầu sách hết hàng và 7 đầu sách dưới ngưỡng.", {"get_warehouse_stock_risk": RISK}), [])

    def test_system_versus_warehouse(self):
        self.assertEqual(bad("Toàn hệ thống chỉ có 3 đầu sách hết hàng.", {"get_warehouse_stock_risk": RISK}), [("SCOPE", "CONTRADICTED")])
        self.assertEqual(bad("Cộng cả 3 kho có 4 đầu sách hết hàng.", {"get_warehouse_stock_risk": RISK}), [])
        self.assertEqual(bad("Kho HCM Chinh ghi nhận 5.452 lượt mượn trong 6 tháng qua.", {"get_borrow_trends": MONTHS}),
                         [("SCOPE", "CONTRADICTED")])
        # the library-wide stock of a title quoted for the warehouse that was asked about
        data = {"get_reorder_suggestions": REORDER, "get_warehouse_low_stock_items": LOW_TRUNCATED}
        self.assertEqual(bad("Tại Kho HCM Chinh, Norwegian Wood còn tồn 5 bản.", data), [("SCOPE", "UNSUPPORTED")])


class DecisionClaimTests(unittest.TestCase):
    def test_recommendation_order(self):
        self.assertEqual(bad("Nên nhập Kafka on the Shore trước tiên.", {"get_reorder_suggestions": REORDER}),
                         [("RECOMMENDATION", "CONTRADICTED")])
        self.assertEqual(bad("Nên xem xét nhập Norwegian Wood trước.", {"get_reorder_suggestions": REORDER}), [])

    def test_unproven_optimality(self):
        self.assertEqual(bad("Đầu tư 20 triệu là cách chi tiêu khôn ngoan nhất.", {"simulate_reorder_budget": SIM}),
                         [("OPTIMALITY", "UNSUPPORTED")])
        self.assertEqual(bad("Không có phương án nào tối ưu tuyệt đối.", {"simulate_reorder_budget": SIM}), [])

    def test_unproven_causality(self):
        self.assertEqual(bad("Lượt mượn giảm là do thư viện thiếu nhân sự.", {"compare_borrow_periods": PERIODS}),
                         [("CAUSALITY", "UNSUPPORTED")])
        self.assertEqual(bad("Có thể liên quan tới lịch học, nhưng cần kiểm tra thêm.", {"compare_borrow_periods": PERIODS}), [])
        # a reason that IS the system's own rule is not an unproven cause
        self.assertEqual(bad("Kho HCM Chinh rủi ro hơn vì có 3 đầu sách hết hàng.", {"get_warehouse_stock_risk": RISK}), [])

    def test_coverage_and_constraints(self):
        self.assertEqual(bad("Với 10 triệu, thư viện đáp ứng được toàn bộ nhu cầu nhập sách.", {"simulate_reorder_budget": SIM}),
                         [("COVERAGE", "CONTRADICTED")])
        self.assertEqual(bad("Phương án 20 triệu đã tính đủ số lượng đặt tối thiểu của nhà cung cấp.", {"simulate_reorder_budget": SIM}),
                         [("CONSTRAINT", "UNSUPPORTED")])

    def test_long_lead_time_called_short_regression_xai_de_04(self):
        self.assertEqual(bad("Thời gian chờ hàng ngắn: Norwegian Wood chờ 30 ngày.", {"get_reorder_suggestions": REORDER}),
                         [("ASSESSMENT", "CONTRADICTED")])


class LiveFailureRulesTests(unittest.TestCase):
    """Rules added after the first LIVE32 run (its misses and false alarms),
    tested with phrasings different from the live answers."""

    def test_stock_against_threshold_is_arithmetic(self):
        self.assertEqual(bad("Kafka on the Shore chỉ còn 3 bản, dưới ngưỡng 1 bản.", {"get_reorder_suggestions": REORDER}),
                         [("ASSESSMENT", "CONTRADICTED")])
        self.assertEqual(bad("Kafka on the Shore còn 3 bản (thấp hơn mức tồn tối thiểu).", {"get_reorder_suggestions": REORDER}),
                         [("ASSESSMENT", "CONTRADICTED")])
        self.assertEqual(bad("Norwegian Wood còn 5 bản, dưới ngưỡng 10 bản.", {"get_reorder_suggestions": REORDER}), [])

    def test_another_titles_stock_is_an_entity_mixup(self):
        rep = check("Nên nhập Norwegian Wood trước. Đầu sách này hiện còn 6 bản tồn khả dụng.", {"get_reorder_suggestions": REORDER})
        self.assertEqual([(c.category, c.verdict) for c in rep.problems], [("ENTITY", "CONTRADICTED")])  # 6 is Project Hail Mary's

    def test_below_threshold_already_includes_out_of_stock(self):
        data = {"get_warehouse_stock_risk": RISK}
        self.assertEqual(bad("Kho HCM Chinh có 3 đầu sách đã hết hàng và thêm 7 đầu sách khác dưới ngưỡng.", data),
                         [("COUNT", "CONTRADICTED")])
        self.assertEqual(bad("Chi Nhanh District 1 có 1 đầu sách hết hàng và 1 đầu sách dưới ngưỡng, tổng cộng 2 đầu sách.", data),
                         [("COUNT", "CONTRADICTED")])
        self.assertEqual(bad("Kho HCM Chinh có 7 đầu sách dưới ngưỡng, trong đó 3 đầu sách đã hết hàng.", data), [])

    def test_a_part_larger_than_its_whole(self):
        fines = {"get_fine_summary": {"total_unpaid": 500000, "by_type": [{"fine_type": "OVERDUE", "amount": 900000}]}}
        self.assertEqual(bad("Tiền phạt chưa thu là 500.000 ₫. Trong đó phạt quá hạn là 900.000 ₫.", fines), [("MONEY", "CONTRADICTED")])
        self.assertEqual(bad("Tiền phạt chưa thu là 900.000 ₫. Trong đó phạt quá hạn là 500.000 ₫.", fines), [])

    def test_denying_the_trend(self):
        self.assertEqual(bad("Dữ liệu không cho thấy lượt mượn giảm.", {"compare_borrow_periods": PERIODS}), [("TREND", "CONTRADICTED")])
        self.assertEqual(bad("Dữ liệu không cho thấy lượt mượn tăng.", {"compare_borrow_periods": PERIODS}), [])

    def test_monthly_returns(self):
        self.assertEqual(bad("Tháng 06/2026 có 905 lượt mượn và 1.300 lượt trả.", {"get_borrow_trends": MONTHS}), [("COUNT", "CONTRADICTED")])
        self.assertEqual(bad("Tháng 06/2026 có 905 lượt mượn và 905 lượt trả.", {"get_borrow_trends": MONTHS}), [])

    def test_false_alarms_found_live_stay_fixed(self):
        # "đáp ứng được 0%" is not "đáp ứng đủ"; a partial-coverage sentence is not full coverage
        self.assertEqual(bad("Mức này chỉ đáp ứng được 0% thiếu hụt dự kiến.", {"simulate_reorder_budget": SIM}), [])
        self.assertEqual(bad("Nguồn lực hiện tại chỉ đáp ứng được một phần nhỏ nhu cầu.", {"simulate_reorder_budget": SIM}), [])
        # the subject before the colon: returns compared with returns
        periods = {**PERIODS, "metrics": {**PERIODS["metrics"], "returns": {"change_pct": -63.0, "per_day_change_pct": -63.0}}}
        self.assertEqual(bad("Lượt trả: số sách hoàn trả giảm sâu (-63%).", {"compare_borrow_periods": periods}), [])
        # "còn lại chỉ khoảng 13.000 ₫" is the remainder, not the approved cost
        self.assertEqual(bad("Với 10 triệu, số tiền còn lại chỉ khoảng 13.000 ₫.", {"simulate_reorder_budget": SIM}), [])
        # a warehouse named in an earlier sentence is not carried into "kho này"
        self.assertEqual(bad("Chi Nhanh District 1 có 1 đầu sách hết hàng. Ngoài ra kho này có 7 đầu sách dưới ngưỡng.",
                             {"get_warehouse_stock_risk": RISK}), [])
        # "duy trì mức quan tâm cao … dù đã giảm 51,2%" is not a stability claim
        self.assertEqual(bad("Norwegian Wood vẫn duy trì mức quan tâm cao với 60 lượt mượn (dù đã giảm 51,2%).",
                             {"get_reorder_suggestions": REORDER}), [])


class LiveRun2FalseBlockTests(unittest.TestCase):
    """False blocks seen in LIVE32 run 2 (new phrasings) stay fixed."""

    def test_the_cost_of_full_coverage_is_not_a_coverage_claim(self):
        self.assertEqual(bad("Chi phí để đáp ứng đầy đủ nhu cầu nhập hàng là khoảng 68.375.250 ₫ cho 116 đầu sách.",
                             {"simulate_reorder_budget": SIM}), [])
        self.assertEqual(bad("Toàn bộ nhu cầu nhập hàng cần 99.000.000 ₫.", {"simulate_reorder_budget": SIM}),
                         [("MONEY", "CONTRADICTED")])
        # a real coverage claim is still caught
        self.assertEqual(bad("Với 10 triệu, thư viện đáp ứng được toàn bộ nhu cầu nhập sách.", {"simulate_reorder_budget": SIM}),
                         [("COVERAGE", "CONTRADICTED")])

    def test_a_warehouse_in_an_aside_is_not_the_subject(self):
        self.assertEqual(bad("Chi Nhanh District 1 cần quan tâm hơn: kho này có 1 đầu sách hết hàng (trong khi Kho Ha Noi không có).",
                             {"get_warehouse_stock_risk": RISK}), [])

    def test_a_small_rise_may_be_called_stable(self):
        rising = {"compare_borrow_periods": {**PERIODS, "unequal_length": False,
                                             "metrics": {"loans": {"current": 75, "previous": 70, "change_pct": 7.1}}}}
        self.assertEqual(bad("Nhu cầu mượn sách khá ổn định hoặc tăng nhẹ.", rising), [])


class MissingDataTests(unittest.TestCase):
    def test_tool_error_or_timeout_is_never_zero(self):
        self.assertEqual(bad("Hiện không có đầu sách nào cần nhập thêm.", {"get_reorder_suggestions": {"error": "HTTP 503"}}),
                         [("MISSING_DATA", "CONTRADICTED")])
        self.assertEqual(bad("Tất cả các kho đều đang ổn.", {"get_warehouse_stock_risk": {"error": "Request timed out"}}),
                         [("MISSING_DATA", "CONTRADICTED")])
        self.assertEqual(bad("Chưa lấy được dữ liệu đề xuất nhập nên chưa thể kết luận.", {"get_reorder_suggestions": {"error": "x"}}), [])

    def test_truncated_list_and_null_cost(self):
        self.assertEqual(bad("Kho HCM Chinh chỉ có 2 đầu sách dưới ngưỡng.", {"get_warehouse_low_stock_items": LOW_TRUNCATED}),
                         [("COUNT", "CONTRADICTED")])
        self.assertEqual(bad("Kho HCM Chinh có 12 đầu sách dưới ngưỡng, trong đó 4 đầu sách đã hết hàng.",
                             {"get_warehouse_low_stock_items": LOW_TRUNCATED}), [])
        self.assertEqual(bad("Nhập 7 bản Kafka on the Shore sẽ tốn 0 đồng.", {"get_reorder_suggestions": REORDER}),
                         [("MISSING_DATA", "CONTRADICTED")])

    def test_shortage_and_overdue_counts(self):
        self.assertEqual(bad("Có 5 đầu sách đang thiếu mà nhu cầu lại tăng.", {"explain_warehouse_shortage": SHORTAGE}),
                         [("COUNT", "CONTRADICTED")])
        self.assertEqual(bad("Hiện có 675 phiếu mượn quá hạn.", {"get_overdue_summary": OVERDUE}), [("COUNT", "CONTRADICTED")])
        self.assertEqual(bad("Hiện có 400 phiếu mượn quá hạn với 675 cuốn sách chưa trả.", {"get_overdue_summary": OVERDUE}), [])

    def test_answers_without_decisions_are_left_alone(self):
        rep = check("Chào bạn! Tôi có thể giúp gì thêm?", {"get_overdue_summary": OVERDUE})
        self.assertEqual(rep.claims, [])
        self.assertEqual(v.status_of(rep, repaired=False, fallback=False), v.PASSED)
        self.assertEqual(check("Bất kỳ câu nào.", {}).claims, [])


class RepairAndStatusTests(unittest.TestCase):
    def test_safe_repair(self):
        text = "Với ngân sách 10 triệu, hệ thống duyệt 7 đầu sách với chi phí 9.987.000 ₫."
        rep = check(text, {"simulate_reorder_budget": SIM})
        fixed, repaired = v.repair(text, rep)
        self.assertIn("duyệt 9 đầu sách", fixed)
        self.assertEqual(len(repaired), 1)
        self.assertEqual(check(fixed, {"simulate_reorder_budget": SIM}).critical, [])

    def test_another_quantity_of_the_data_is_not_rewritten(self):
        # 5 is the number of HIGH-priority titles approved: the sentence may mean that,
        # so it is contradicted (retry) but never silently rewritten (3.3)
        text = "Với ngân sách 10 triệu, hệ thống duyệt 5 đầu sách với chi phí 9.987.000 ₫."
        rep = check(text, {"simulate_reorder_budget": SIM})
        self.assertTrue(rep.critical)
        self.assertEqual(v.repair(text, rep)[1], [])

    def test_full_need_and_left_out_counts_in_a_budget_answer(self):
        # live test run B (c33-bd-10 / c33-bd-11): the 3.2 repair rewrote these correct drafts
        sim = {**SIM, "full_need": {**SIM["full_need"], "total_candidates": 117, "estimated_total_cost": 85791250,
                                    "estimated_total_reorder_qty": 763}}
        text = ("Ngân sách 10.000.000 ₫ không đủ để nhập hết các sách cần thiết, vì tổng nhu cầu thực tế lên tới "
                "85.791.250 ₫ cho 117 đầu sách (763 bản).")
        rep = check(text, {"simulate_reorder_budget": sim})
        self.assertEqual(rep.problems, [])
        text = "Với ngân sách 10 triệu, hệ thống sẽ duyệt nhập 5 đầu sách ưu tiên cao và bỏ lại 90 đầu sách khác."
        rep = check(text, {"simulate_reorder_budget": SIM})
        self.assertEqual(rep.problems, [])
        text = "Với ngân sách 10 triệu, hệ thống sẽ duyệt nhập 5 đầu sách ưu tiên cao và bỏ lại 5 đầu sách khác."
        rep = check(text, {"simulate_reorder_budget": SIM})
        self.assertTrue(rep.problems)
        self.assertEqual(v.repair(text, rep)[1], [])

    def test_no_blind_substitution(self):
        # "5" also appears in another context: not repaired
        text = "Với ngân sách 10 triệu, hệ thống duyệt 5 đầu sách, mỗi đầu sách 5 bản."
        self.assertEqual(v.repair(text, check(text, {"simulate_reorder_budget": SIM}))[1], [])
        # the count heads a list the text enumerates: fixing it would contradict the list
        text = "Với ngân sách 10 triệu, hệ thống đề xuất nhập 5 đầu sách sau:\n* Norwegian Wood\n* Tam Cam"
        self.assertEqual(v.repair(text, check(text, {"simulate_reorder_budget": SIM}))[1], [])

    def test_status_and_summary_hide_internal_codes(self):
        rep = check("Lượt mượn giảm là do thiếu nhân sự.", {"compare_borrow_periods": PERIODS})
        self.assertEqual(v.status_of(rep, repaired=False, fallback=False), v.WARNING)
        summary = v.summarize(rep, v.WARNING, repaired=[], retried=False, started=0.0)
        dumped = json.dumps(summary, ensure_ascii=False)
        for code in ("claim_id", "scope_id", "verifier_code", "100%"):
            self.assertNotIn(code, dumped)
        self.assertTrue(summary["safe_to_act"])
        self.assertFalse(v.summarize(rep, v.BLOCKED, repaired=[], retried=False, started=0.0)["safe_to_act"])

    def test_a_faulty_rule_leaves_its_claims_unverified_instead_of_failing(self):
        with patch("copilot_verification._check_budget", side_effect=RuntimeError("bug")):
            rep = check("Mức 20 triệu duyệt được 155 đầu sách. Kho Ha Noi đáng lo hơn Kho HCM Chinh.",
                        {"simulate_reorder_budget": SIM, "get_warehouse_stock_risk": RISK})
        self.assertEqual([c.category for c in rep.critical], ["RANKING"])  # the other rules still ran

    def test_fallback_adds_no_claim_of_its_own(self):
        sheet = v.build_sheet({"get_overdue_summary": OVERDUE})
        text = v.fallback_answer(None, sheet)
        self.assertIn("Không kiểm chứng được", text)
        self.assertEqual(v.verify(text, sheet).problems, [])

    def test_evidence_carries_scope_time_and_limits(self):
        sheet = v.build_sheet({"get_reorder_suggestions": REORDER, "get_warehouse_low_stock_items": LOW_TRUNCATED,
                               "get_overdue_summary": {"error": "HTTP 503"}})
        by_source = {e["source"]: e for e in sheet.evidence}
        self.assertEqual(by_source["get_reorder_suggestions"]["scope"], "system")
        self.assertEqual(by_source["get_reorder_suggestions"]["time_range"]["from"], "2026-09-15")
        self.assertEqual(by_source["get_warehouse_low_stock_items"]["warehouse"], "Kho HCM Chinh")
        self.assertTrue(by_source["get_warehouse_low_stock_items"]["limitations"])
        self.assertTrue(by_source["get_overdue_summary"]["error"])
        self.assertIn("Kho HCM Chinh", sheet.titles["norwegian wood"]["warehouse"]["warehouse"])


class VerificationEndpointTests(unittest.IsolatedAsyncioTestCase):
    """The same policy on /assistant and /assistant/stream; no action for a
    blocked answer; one retry at most."""
    Q = "Với ngân sách 10 triệu nên nhập sách gì?"

    def setUp(self):
        self.store = FakeStoreWithData()
        main.assistant_response_cache.clear()

        async def simulate(auth_header=None, **_kw):
            return SIM

        self.action = AsyncMock(return_value={"id": "act-1", "type": "CREATE_REORDER_DRAFT"})
        self._patches = [
            patch("main.rate_limiter.acquire", new=AsyncMock(return_value=(True, None))),
            patch("main.get_user_context", new=AsyncMock(return_value=ADMIN)),
            patch("main.conversation_store.get_or_create_conversation", new=self.store.get_or_create_conversation),
            patch("main.conversation_store.append_message", new=self.store.append_message),
            patch("main.conversation_store.get_recent_messages", new=self.store.get_recent_messages),
            patch("main.copilot_tools._warehouses", new=AsyncMock(return_value=WAREHOUSES)),
            patch("main._build_assistant_pending_action", new=self.action),
            patch.dict(main.TOOL_FUNCTIONS, {"simulate_reorder_budget": simulate}),
        ]
        for p in self._patches:
            p.start()

    def tearDown(self):
        for p in self._patches:
            p.stop()

    async def ask(self, texts, cid, stream=False):
        provider = SequenceProvider(texts)
        with patch("main._get_assistant_provider", return_value=provider):
            if stream:
                response = await main.assistant_stream(_request(), AssistantRequest(message=self.Q, conversation_id=cid))
                events = [chunk async for chunk in response.body_iterator]
                names = [e.split("\n", 1)[0] for e in events]
                done = json.loads([e for e in events if e.startswith("event: done")][0].split("data: ", 1)[1])
                return done, provider, names
            body = (await main.assistant(_request(), AssistantRequest(message=self.Q, conversation_id=cid))).model_dump()
            return body, provider, None

    async def test_a_verified_answer_costs_no_extra_call_and_may_propose_an_action(self):
        body, provider, _ = await self.ask(["Với 10 triệu, hệ thống duyệt 9 đầu sách (92 bản), chi phí 9.987.000 ₫."], "v1")
        self.assertEqual(len(provider.calls), 1)
        self.assertEqual(body["verification"]["status"], "PASSED")
        self.assertGreater(body["verification"]["counts"]["SUPPORTED"], 0)
        self.assertTrue(body["verification"]["safe_to_act"])
        self.action.assert_awaited()

    async def test_a_wrong_count_is_repaired_without_an_llm_call(self):
        body, provider, _ = await self.ask(["Với 10 triệu, hệ thống duyệt 7 đầu sách, chi phí 9.987.000 ₫."], "v2")
        self.assertEqual(len(provider.calls), 1)
        self.assertEqual(body["verification"]["status"], "REPAIRED")
        self.assertIn("duyệt 9 đầu sách", body["answer"])
        self.assertEqual(body["verification"]["repairs"][0]["to"], "9")

    async def test_an_unrepairable_contradiction_is_retried_once_with_the_true_value(self):
        wrong = "Với ngân sách 10.000.000 ₫, hệ thống đề xuất nhập 5 đầu sách sau:\n* Norwegian Wood\n* Tam Cam"
        right = "Với 10 triệu, hệ thống duyệt 9 đầu sách (92 bản), chi phí 9.987.000 ₫."
        body, provider, _ = await self.ask([wrong, right], "v3")
        self.assertEqual(len(provider.calls), 2)
        retry_prompt = " ".join(str(m.get("content")) for m in provider.calls[1])
        self.assertIn("đúng: 9 đầu sách", retry_prompt)
        self.assertEqual(body["verification"]["status"], "REPAIRED")
        self.assertTrue(body["verification"]["retried"])

    async def test_a_contradiction_that_survives_is_blocked_and_no_action_is_proposed(self):
        wrong = "Với ngân sách 10.000.000 ₫, hệ thống đề xuất nhập 5 đầu sách sau:\n* Norwegian Wood\n* Tam Cam"
        body, provider, _ = await self.ask([wrong], "v4")
        self.assertEqual(len(provider.calls), 2)  # never more than one retry
        self.assertEqual(body["verification"]["status"], "BLOCKED")
        self.assertFalse(body["verification"]["safe_to_act"])
        self.assertEqual(body["faithfulness"]["status"], "fallback")  # 3.1 clients still see the replacement
        self.assertNotIn("5 đầu sách", body["answer"])
        self.assertIsNone(body["pending_action"])
        self.action.assert_not_awaited()

    async def test_stream_announces_verification_and_matches_the_json_endpoint(self):
        wrong = "Với ngân sách 10.000.000 ₫, hệ thống đề xuất nhập 5 đầu sách sau:\n* Norwegian Wood\n* Tam Cam"
        done, _provider, names = await self.ask([wrong], "v5", stream=True)
        self.assertIn("event: status", names)
        self.assertLess(names.index("event: status"), names.index("event: done"))
        self.assertEqual(done["verification"]["status"], "BLOCKED")
        self.assertIsNone(done["pending_action"])
        body, _p, _ = await self.ask([wrong], "v6")
        self.assertEqual(done["answer"], body["answer"])

    async def test_verification_is_kept_with_the_conversation(self):
        await self.ask(["Với 10 triệu, hệ thống duyệt 9 đầu sách (92 bản), chi phí 9.987.000 ₫."], "v7")
        self.assertEqual(self.store.messages[-1].msg_metadata["extras"]["verification"]["status"], "PASSED")


if __name__ == "__main__":
    unittest.main()


class FundedTitleCopiesTests(unittest.TestCase):
    """3.3: a budget can fund a line in part; the copies stated per title must be
    the funded ones (live: 'Đắc trung … (68 bản)' when 67 were funded)."""

    SIM_PARTIAL = {**SIM, "scenarios": [{**SIM["scenarios"][0], "funded_lines": 2, "funded_qty": 68,
                                         "funded_items": [{"title": "Norwegian Wood", "priority": "HIGH", "suggested_reorder_qty": 183,
                                                           "funded_qty": 67, "estimated_cost": 5963000},
                                                          {"title": "Tam Cam", "priority": "HIGH", "suggested_reorder_qty": 5,
                                                           "funded_qty": 1, "estimated_cost": 34000}]}]}

    def test_funded_copies_per_title(self):
        data = {"simulate_reorder_budget": self.SIM_PARTIAL}
        ok = check("Với 10 triệu, hệ thống duyệt Norwegian Wood (67 bản) và Tam Cam (1 bản).", data)
        self.assertEqual(ok.problems, [])
        bad = check("Với 10 triệu, hệ thống duyệt Norwegian Wood (68 bản) và Tam Cam (68 bản).", data)
        self.assertTrue([c for c in bad.problems if c.category == "COUNT"])
        second = check("Với 10 triệu, hệ thống duyệt Norwegian Wood (67 bản) và Tam Cam (68 bản).", data)
        self.assertEqual([c.expected for c in second.problems if c.category == "COUNT"], ["1 bản"])
        self.assertEqual(v.repair("Với 10 triệu, hệ thống duyệt Norwegian Wood (68 bản).", bad)[1], [])  # 68 = scenario copies

    def test_the_full_suggestion_is_not_read_as_the_approved_count(self):
        data = {"simulate_reorder_budget": self.SIM_PARTIAL}
        rep = check("Norwegian Wood cần 183 bản nhưng với 10 triệu chỉ được duyệt 67 bản.", data)
        self.assertEqual([c for c in rep.problems if c.category == "COUNT"], [])


class FundedTitleCostTests(unittest.TestCase):
    def test_cost_per_funded_title(self):
        sim = FundedTitleCopiesTests.SIM_PARTIAL
        data = {"simulate_reorder_budget": sim}
        self.assertEqual(check("Với 10 triệu: Norwegian Wood nhập 67 bản (chi phí ~5.963.000 ₫).", data).problems, [])
        # live: the leftover budget (13.000 here) written as a title's cost
        bad = check("Với 10 triệu: Tam Cam nhập 1 bản (chi phí ~13.000 ₫).", data)
        self.assertEqual([c.expected for c in bad.problems if c.category == "MONEY"], ["34.000 đ"])

    def test_a_budget_that_funds_the_whole_position_need_is_full_coverage(self):
        sim = {**SIM, "items_not_listed": 16,
               "scenarios": [{**SIM["scenarios"][0], "unfunded_high_priority": 0, "covers_need_with_position": True}]}
        rep = check("Với 10 triệu, phương án này đáp ứng toàn bộ nhu cầu.", {"simulate_reorder_budget": sim})
        self.assertEqual([c for c in rep.problems if c.category == "COVERAGE"], [])
        sim["scenarios"][0]["covers_need_with_position"] = False
        rep = check("Với 10 triệu, phương án này đáp ứng toàn bộ nhu cầu.", {"simulate_reorder_budget": sim})
        self.assertTrue([c for c in rep.problems if c.category == "COVERAGE"])


class PartialFundingClaimTests(unittest.TestCase):
    def test_partial_funding_claims(self):
        sim = {**SIM, "scenarios": [{**SIM["scenarios"][0], "partially_funded_lines": 2}]}
        data = {"simulate_reorder_budget": sim}
        bad = check("Với 10 triệu, không có đầu sách nào bị duyệt một phần.", data)
        self.assertEqual([c.category for c in bad.problems], ["COUNT"])
        self.assertEqual(check("Với 10 triệu, có 2 đầu sách chỉ được duyệt một phần.", data).problems, [])
        self.assertTrue(check("Với 10 triệu, có 5 đầu sách chỉ được duyệt một phần.", data).problems)
        none = {"simulate_reorder_budget": {**SIM, "scenarios": [{**SIM["scenarios"][0], "partially_funded_lines": 0}]}}
        self.assertEqual(check("Với 10 triệu, không có đầu sách nào bị duyệt một phần.", none).problems, [])


class DecisionTurnFalseAlarmTests(unittest.TestCase):
    """Phase 6 live multi-turn run: correct answers the 3.3 rules blocked."""

    def test_not_approved_high_priority_titles_are_the_unfunded_ones(self):
        data = {"simulate_reorder_budget": SIM}
        self.assertEqual(check("Với 10 triệu, có tới 90 đầu sách ưu tiên cao không được nhập trong đợt này.", data).problems, [])
        self.assertTrue(check("Với 10 triệu, có tới 70 đầu sách ưu tiên cao không được nhập trong đợt này.", data).problems)

    def test_a_cost_on_the_service_curve_is_a_true_figure(self):
        sim = {**SIM, "service_curve": {"cost_for_service_pct": {"90": 14004530, "95": 17116110}}}
        text = ("Để cải thiện, bạn cần tăng ngân sách lên mức tối thiểu khoảng 14.004.530 ₫ để đạt mức phục vụ 90%, "
                "hoặc 20.000.000 ₫ để đáp ứng gần như toàn bộ nhu cầu dự kiến.")
        self.assertEqual([c for c in check(text, {"simulate_reorder_budget": sim}).problems if c.category == "MONEY"], [])

    def test_quoting_the_100_percent_shortfall_metric_is_not_a_coverage_claim(self):
        text = "Phương án ngân sách 10.000.000 ₫ ít rủi ro hơn vì nó đáp ứng được 100% thiếu hụt dự kiến."
        self.assertEqual([c for c in check(text, {"simulate_reorder_budget": SIM}).problems if c.category == "COVERAGE"], [])
        self.assertTrue([c for c in check("Với 10 triệu, phương án này đáp ứng toàn bộ nhu cầu.",
                                          {"simulate_reorder_budget": SIM}).problems if c.category == "COVERAGE"])


class DecisionRun3FalseAlarmTests(unittest.TestCase):
    """Phase 6 live run 3: true sentences the rules blocked."""

    def test_listed_and_not_listed_row_counts(self):
        data = {"simulate_reorder_budget": SIM}  # items_counted 100, items_not_listed 16
        text = ("Với 10 triệu, bạn sẽ đáp ứng được 100% thiếu hụt dự kiến của các dòng sách trong danh sách tối đa 100 đầu sách "
                "cần nhập nhất. Vẫn còn 16 đầu sách nằm ngoài phạm vi tính toán này nên chưa thể khẳng định toàn bộ nhu cầu "
                "đã được đáp ứng.")
        self.assertEqual([c for c in check(text, data).problems if c.category == "COUNT"], [])
        self.assertTrue(check("Có 100 đầu sách cần nhập.", data).problems)  # still the full-need figure (116)

    def test_a_comparative_sentence_may_quote_the_other_scenario(self):
        data = {"simulate_reorder_budget": SIM}
        # live: "Chỉ còn lại 36 … (so với 69 … ở mức 5 triệu)" - only the OTHER scenario is named
        text = "Chỉ còn lại 80 đầu sách ưu tiên cao chưa được nhập (so với 90 đầu sách bị bỏ lại ở mức 10 triệu)."
        self.assertEqual([c for c in check(text, data).problems if c.category == "COUNT"], [])
        # a figure of neither scenario is still contradicted (a count FOLLOWED by "bị bỏ lại" gets no role - known gap)
        wrong = "Chỉ còn lại 85 đầu sách ưu tiên cao chưa được nhập (so với 90 đầu sách bị bỏ lại ở mức 10 triệu)."
        self.assertTrue([c for c in check(wrong, data).problems if c.category == "COUNT"])

    def test_a_from_to_change_quotes_both_scenarios(self):
        data = {"simulate_reorder_budget": SIM}
        text = "Số lượng đầu sách ưu tiên cao chưa được duyệt giảm xuống 80 (từ 90 đầu sách ở mức 10 triệu)."
        self.assertEqual([c for c in check(text, data).problems if c.category == "COUNT"], [])

    def test_savings_between_scenarios_and_demand_wording(self):
        # live run 5: "tiết kiệm khoảng 3 triệu" (difference of the approved costs) read as the full need
        data = {"simulate_reorder_budget": SIM}  # approved 9.987.000 vs 19.944.000 -> 9.957.000
        text = ("Đánh đổi: Việc giảm ngân sách giúp tiết kiệm khoảng 10 triệu đồng nhưng làm tăng đáng kể rủi ro hết hàng "
                "ở các đầu sách đang có nhu cầu thực tế cao.")
        self.assertEqual([c for c in check(text, data).problems if c.category == "MONEY"], [])
        wrong = "Việc giảm ngân sách giúp tiết kiệm khoảng 25 triệu đồng."
        self.assertTrue([c for c in check(wrong, data).problems if c.category == "MONEY"])
