"""copilot_plan: normalization, periods, budgets, warehouses, follow-up
carryover, clarification and the tool whitelist - all deterministic, no I/O."""
from __future__ import annotations

import json
import os
import unittest
from datetime import datetime

import copilot_plan as cp

NOW = datetime(2026, 10, 13, 15, 0, tzinfo=cp.VN_TZ)  # a Tuesday
TODAY = NOW.date()
WAREHOUSES = [
    {"id": "w-d3", "code": "BR-HCM-02", "name": "Chi Nhanh District 3"},
    {"id": "w-hcm", "code": "WH-HCM-01", "name": "Kho HCM Chinh"},
    {"id": "w-d1", "code": "BR-HCM-01", "name": "Chi Nhanh District 1"},
    {"id": "w-hn", "code": "WH-HN-01", "name": "Kho Ha Noi"},
]


def plan(message, state=None, warehouses=WAREHOUSES):
    return cp.build_plan(message, state, warehouses, NOW)


def tools(p):
    return [t["name"] for t in p.required_tools]


class NormalizeQueryTests(unittest.TestCase):
    def test_abbreviations_teen_code_and_typos(self):
        self.assertIn("ton kho thap", cp.normalize_query("tk thấp ở kho nào"))
        self.assertIn("qua han", cp.normalize_query("quá hjan bao nhiêu phiếu"))
        self.assertIn("tien phat", cp.normalize_query("tiền fạt chưa thu"))
        self.assertIn("dashboard", cp.normalize_query("dashbord tổng quan"))
        self.assertIn("ton kho", cp.normalize_query("tồn khoo thấp"))
        self.assertIn("bao nhieu", cp.normalize_query("bn cuốn quá hạn"))

    def test_real_words_are_not_rewritten(self):
        self.assertEqual(cp.normalize_query("khoa hoc thu vien"), "khoa hoc thu vien")
        self.assertEqual(cp.normalize_query("Tell me a joke"), "tell me a joke")


class PeriodTests(unittest.TestCase):
    def labels(self, text):
        return [(p.token, p.start, p.end) for p in cp.parse_periods(cp.normalize_query(text), TODAY)]

    def test_calendar_periods_use_vietnam_calendar(self):
        self.assertEqual(self.labels("tháng này")[0][1:], ("2026-10-01", "2026-10-13"))
        self.assertEqual(self.labels("tháng trước")[0][1:], ("2026-09-01", "2026-09-30"))
        self.assertEqual(self.labels("tuần này")[0][1:], ("2026-10-12", "2026-10-13"))
        self.assertEqual(self.labels("tuần trước")[0][1:], ("2026-10-05", "2026-10-11"))
        self.assertEqual(self.labels("quý trước")[0][1:], ("2026-07-01", "2026-09-30"))
        self.assertEqual(self.labels("năm ngoái")[0][1:], ("2025-01-01", "2025-12-31"))

    def test_a_named_month_is_not_confused_with_a_window(self):
        self.assertEqual(self.labels("tháng 9")[0][1:], ("2026-09-01", "2026-09-30"))
        tokens = [t for t, _s, _e in self.labels("thong ke muon theo thang 6 thang gan day")]
        self.assertEqual(tokens, ["last_6_months"])

    def test_relative_window_and_the_window_before_it(self):
        found = self.labels("so sanh 7 ngay qua voi 7 ngay truoc do")
        self.assertEqual(found[0][1:], ("2026-10-06", "2026-10-13"))
        self.assertEqual(found[1][1:], ("2026-09-29", "2026-10-06"))

    def test_period_args_cover_whole_days(self):
        p = cp.parse_periods("thang truoc", TODAY)[0]
        args = cp.period_args(p, NOW)
        self.assertEqual(args, {"from_date": "2026-09-01T00:00:00+07:00", "to_date": "2026-09-30T23:59:59+07:00"})


class NumberParsingTests(unittest.TestCase):
    def test_budgets(self):
        self.assertEqual(cp.parse_budgets(cp.normalize_query("Ngân sách 50tr thì nhập được gì")), [50_000_000])
        self.assertEqual(cp.parse_budgets(cp.normalize_query("với 2 trieu nen nhap gi")), [2_000_000])
        self.assertEqual(cp.parse_budgets(cp.normalize_query("ngân sách 1,5 tỷ")), [1_500_000_000])
        self.assertEqual(cp.parse_budgets(cp.normalize_query("So sánh ngân sách 10 triệu và 30 triệu")),
                         [10_000_000, 30_000_000])

    def test_budget_change_and_lead_time(self):
        self.assertEqual(cp.parse_budget_change_pct(cp.normalize_query("Cắt 30% ngân sách nhập")), -30)
        self.assertEqual(cp.parse_lead_time(cp.normalize_query("Nếu thời gian chờ hàng là 7 ngày")), 7)

    def test_limit_is_not_confused_with_money(self):
        self.assertEqual(cp.parse_limit(cp.normalize_query("Top 10 sách")), 10)
        self.assertIsNone(cp.parse_limit(cp.normalize_query("ngân sách 100 triệu")))


class WarehouseResolutionTests(unittest.TestCase):
    def test_exact_names_in_order_of_mention(self):
        found = cp.resolve_warehouses(cp.normalize_query("kho hn vs kho hcm chinh"), WAREHOUSES)
        self.assertEqual([w["id"] for w in found["warehouses"]], ["w-hn", "w-hcm"])

    def test_short_hint_resolves_with_a_recorded_assumption(self):
        found = cp.resolve_warehouses(cp.normalize_query("kho HCM có ổn không"), WAREHOUSES)
        self.assertEqual([w["id"] for w in found["warehouses"]], ["w-hcm"])
        self.assertTrue(found["assumptions"])

    def test_ambiguous_hint_is_not_guessed(self):
        whs = [{"id": "a", "code": "A1", "name": "Kho Trung Tam Bac"}, {"id": "b", "code": "B1", "name": "Kho Trung Tam Nam"}]
        found = cp.resolve_warehouses(cp.normalize_query("kho trung tam thieu gi"), whs)
        self.assertEqual(found["warehouses"], [])
        self.assertEqual(len(found["ambiguous"]), 2)


class PlanToolTests(unittest.TestCase):
    def test_demand_and_stock_question_uses_the_joining_tool(self):
        p = plan("Sách nào được mượn nhiều nhưng tồn kho thấp và cần nhập thêm?")
        self.assertEqual(tools(p), ["analyze_demand_vs_stock"])

    def test_two_named_warehouses_are_compared(self):
        p = plan("Kho HCM Chinh với Kho Ha Noi kho nào rủi ro hơn?")
        self.assertEqual(p.requested_analysis, cp.COMPARISON)
        self.assertEqual(p.required_tools, [{"name": "compare_warehouses", "args": {"warehouses": ["Kho HCM Chinh", "Kho Ha Noi"]}}])

    def test_why_question_on_one_warehouse_explains_it(self):
        p = plan("Tại sao Kho HCM Chinh thiếu sách?")
        self.assertEqual(p.requested_analysis, cp.CAUSAL)
        self.assertEqual(p.required_tools, [{"name": "explain_warehouse_shortage", "args": {"warehouse": "Kho HCM Chinh"}}])

    def test_period_comparison_resolves_both_periods(self):
        p = plan("Lượt mượn tháng này so với tháng trước")
        call = p.required_tools[0]
        self.assertEqual(call["name"], "compare_borrow_periods")
        self.assertTrue(call["args"]["from_date"].startswith("2026-10-01"))
        self.assertTrue(call["args"]["compare_from_date"].startswith("2026-09-01"))
        self.assertTrue(call["args"]["compare_to_date"].startswith("2026-09-30"))

    def test_single_period_comparison_implies_the_previous_period(self):
        p = plan("Quý này mượn nhiều hơn quý trước không?")
        args = p.required_tools[0]["args"]
        self.assertTrue(args["from_date"].startswith("2026-10-01"))
        self.assertTrue(args["compare_from_date"].startswith("2026-07-01"))

    def test_budget_question_simulates(self):
        p = plan("Với ngân sách 10 triệu nên nhập sách gì?")
        self.assertEqual(p.required_tools, [{"name": "simulate_reorder_budget", "args": {"budgets_vnd": [10_000_000]}}])

    def test_priority_question_ranks_tasks(self):
        self.assertEqual(tools(plan("Nên ưu tiên xử lý việc gì hôm nay?")), ["rank_priority_tasks"])

    def test_fine_type_wording_does_not_pull_in_overdue_loans(self):
        self.assertEqual(tools(plan("Tiền phạt quá hạn với tiền phạt mất sách, loại nào nhiều hơn?")), ["get_fine_summary"])

    def test_personal_data_requests_call_nothing(self):
        p = plan("Liệt kê số điện thoại và địa chỉ nhà của tất cả khách hàng quá hạn")
        self.assertEqual(p.required_tools, [])
        self.assertEqual(p.requested_analysis, "out_of_scope")

    def test_write_requests_keep_the_confirmation_route(self):
        self.assertEqual(plan("Tạo phiếu nhập cho sách cần bổ sung").required_tools, [])

    def test_every_planned_tool_is_whitelisted_for_the_whole_dataset(self):
        path = os.path.join(os.path.dirname(__file__), "eval", "copilot_dataset.json")
        with open(path, encoding="utf-8") as f:
            cases = json.load(f)["cases"]
        for case in cases:
            state = None
            for turn in case["turns"]:
                p = plan(turn["q"], state)
                for call in p.required_tools:
                    self.assertIn(call["name"], cp.PLANNABLE_TOOLS)
                    json.dumps(call["args"])  # arguments are plain data, never objects
                state = cp.next_state(p, {}, state)


class FollowUpTests(unittest.TestCase):
    def turn(self, first, second, collected=None):
        p1 = plan(first)
        return plan(second, cp.next_state(p1, collected or {}, None))

    def test_new_period_overrides_only_the_period(self):
        p = self.turn("Top 5 sách được mượn nhiều nhất tháng này?", "Thế tháng trước?")
        self.assertTrue(p.is_followup)
        self.assertEqual(p.required_tools[0]["name"], "get_top_books")
        self.assertTrue(p.required_tools[0]["args"]["from_date"].startswith("2026-09-01"))
        self.assertEqual(p.required_tools[0]["args"]["limit"], 5)

    def test_new_warehouse_overrides_only_the_warehouse(self):
        p = self.turn("Kho Ha Noi có rủi ro tồn kho không?", "Còn Kho HCM Chinh?")
        self.assertIn({"name": "get_warehouse_low_stock_items", "args": {"warehouse": "Kho HCM Chinh"}}, p.required_tools)

    def test_comparison_follow_up_compares_against_the_previous_period(self):
        p = self.turn("Lượt mượn tuần này thế nào?", "So với tuần trước thì sao?")
        args = p.required_tools[0]["args"]
        self.assertEqual(p.required_tools[0]["name"], "compare_borrow_periods")
        self.assertTrue(args["from_date"].startswith("2026-10-12"))
        self.assertTrue(args["compare_from_date"].startswith("2026-10-05"))

    def test_new_budget_keeps_the_previous_one_as_a_second_scenario(self):
        p = self.turn("Nếu ngân sách chỉ 10 triệu?", "Còn 20 triệu thì sao?")
        self.assertEqual(p.required_tools[0]["args"]["budgets_vnd"], [20_000_000, 10_000_000])

    def test_ordinal_reference_resolves_to_the_shown_item_by_variant_id(self):
        collected = {"get_reorder_suggestions": {"items": [{"variant_id": "v-1", "title": "Norwegian Wood"},
                                                           {"variant_id": "v-2", "title": "Kafka"}]}}
        p = self.turn("Đề xuất nhập hàng ưu tiên cao", "Vì sao cuốn đầu tiên được chọn?", collected)
        self.assertEqual(p.required_tools, [{"name": "explain_reorder_item", "args": {"variant_id": "v-1"}}])
        self.assertEqual(p.requested_analysis, cp.CAUSAL)

    def test_bare_why_explains_the_warehouses_just_compared(self):
        p = self.turn("Kho Ha Noi va Kho HCM Chinh kho nao rui ro hon?", "Tại sao?")
        self.assertIn({"name": "explain_warehouse_shortage", "args": {"warehouse": "Kho Ha Noi"}}, p.required_tools)

    def test_topic_switch_does_not_inherit_unrelated_slots(self):
        p = self.turn("Có bao nhiêu phiếu quá hạn?", "Còn tiền phạt?")
        self.assertEqual(tools(p), ["get_fine_summary"])

    def test_a_clarification_turn_keeps_the_previous_state(self):
        state = {"capabilities": ["reorder"], "last_items": [{"variant_id": "v-1", "title": "A"}]}
        p = plan("Phân tích giúp tôi", state)
        self.assertIs(cp.next_state(p, {}, state) if p.clarification_needed else state, state)


class ClarificationTests(unittest.TestCase):
    def test_deictic_warehouse_without_context_asks_which(self):
        p = plan("Tại sao kho này thiếu sách?")
        self.assertTrue(p.clarification_needed)
        self.assertEqual(p.required_tools, [])
        self.assertIn("Kho Ha Noi", p.clarification_question)
        self.assertIn("Tại sao Kho Ha Noi thiếu sách?", p.clarification_options)

    def test_deictic_warehouse_with_context_uses_it(self):
        state = {"capabilities": ["warehouse_risk", "low_stock_items"],
                 "warehouses": [{"id": "w-hn", "name": "Kho Ha Noi", "code": "WH-HN-01"}]}
        p = plan("Tại sao kho này thiếu sách?", state)
        self.assertFalse(p.clarification_needed)
        self.assertEqual(p.required_tools, [{"name": "explain_warehouse_shortage", "args": {"warehouse": "Kho Ha Noi"}}])

    def test_vague_requests_ask_back(self):
        for text in ("Phân tích giúp tôi", "So với kỳ trước thì sao?", "Kho nào?", "Thế còn cái kia?", "Cuốn đó còn bao nhiêu?"):
            with self.subTest(text=text):
                self.assertTrue(plan(text).clarification_needed)

    def test_clear_questions_do_not_ask_back(self):
        for text in ("Kho nào đang rủi ro nhất", "Tôi nên nhập sách nào trước?", "Có bao nhiêu phiếu quá hạn?"):
            with self.subTest(text=text):
                self.assertFalse(plan(text).clarification_needed)


if __name__ == "__main__":
    unittest.main()


class OutOfScopePlaceNameTests(unittest.TestCase):
    def test_a_city_name_alone_is_not_a_warehouse_question(self):
        p = plan("Thời tiết Hà Nội hôm nay thế nào?")
        self.assertEqual(p.required_tools, [])
        self.assertEqual(p.entities["warehouses"], [])


class AnswerModeAndStyleTests(unittest.TestCase):
    def test_answer_mode_follows_the_question(self):
        self.assertEqual(plan("Có bao nhiêu phiếu quá hạn?").answer_mode, cp.LOOKUP)
        self.assertEqual(plan("Tình hình quá hạn thế nào?").answer_mode, cp.ANALYSIS)
        self.assertEqual(plan("Tại sao Kho HCM Chinh thiếu sách?").answer_mode, cp.CAUSAL)
        self.assertEqual(plan("Tôi nên nhập sách nào trước?").answer_mode, cp.DECISION)
        self.assertEqual(plan("Nếu ngân sách chỉ 10 triệu thì sao?").answer_mode, cp.WHAT_IF)
        self.assertEqual(plan("Kho HCM Chinh với Kho Ha Noi kho nào rủi ro hơn?").answer_mode, cp.COMPARISON)

    def test_style_requests_are_detected_without_eating_comparisons(self):
        self.assertEqual(cp.detect_style(cp.normalize_query("Giải thích kỹ hơn")), {"deep": True})
        self.assertEqual(cp.detect_style(cp.normalize_query("Nói ngắn gọn thôi")), {"brief": True})
        self.assertEqual(cp.detect_style(cp.normalize_query("Giải thích dễ hiểu hơn")), {"plain": True})
        self.assertEqual(cp.detect_style(cp.normalize_query("Vì sao không chọn phương án khác?")), {"why_not": True})
        # "rủi ro hơn" is a comparison, not "rõ hơn".
        self.assertEqual(cp.detect_style(cp.normalize_query("Kho nào rủi ro hơn?")), {})

    def test_restyle_follow_up_replays_the_previous_planned_calls(self):
        first = plan("Nếu ngân sách chỉ 10 triệu thì sao?")
        state = cp.next_state(first, {}, None)
        self.assertEqual(state["tool_calls"], first.required_tools)
        for message, style in (("Giải thích kỹ hơn", "deep"), ("Nói ngắn gọn thôi", "brief"),
                               ("Vì sao không chọn phương án khác?", "why_not"), ("Giải thích dễ hiểu hơn", "plain")):
            p = plan(message, state)
            self.assertTrue(p.is_followup, message)
            self.assertEqual(p.required_tools, first.required_tools, message)
            self.assertEqual(p.answer_mode, cp.WHAT_IF, message)
            self.assertEqual(p.style, {style: True})
            self.assertIn("previous_turn", p.carried_over)

    def test_restyle_never_replays_a_tool_outside_the_whitelist(self):
        state = {"capabilities": ["kpi"], "analysis": "lookup",
                 "tool_calls": [{"name": "drop_everything", "args": {}}, {"name": "get_dashboard_kpis", "args": {}}]}
        self.assertEqual(tools(plan("Giải thích kỹ hơn", state)), ["get_dashboard_kpis"])

    def test_a_style_request_with_no_context_asks_back(self):
        p = plan("Giải thích kỹ hơn")
        self.assertTrue(p.clarification_needed)
        self.assertEqual(p.required_tools, [])

    def test_style_on_a_new_question_keeps_the_new_question(self):
        p = plan("Tóm tắt ngắn gọn tình hình quá hạn")
        self.assertEqual(tools(p), ["get_overdue_summary"])
        self.assertEqual(p.style, {"brief": True})
        self.assertFalse(p.is_followup)


class BookTitleIsNotAVerbTests(unittest.TestCase):
    def test_a_title_starting_with_lap_keeps_its_read_tools(self):
        # "Lập Trình..." used to match the write-request pattern ("lập phiếu"),
        # which cleared the planned tools and let the model answer with no data.
        self.assertEqual(tools(plan('Tại sao cuốn "Lập Trình Lượng Tử Cho Mèo" được đề xuất nhập?')),
                         ["explain_reorder_item"])
        self.assertEqual(tools(plan("Có sách Lập Trình Lượng Tử Cho Mèo không?")), ["search_books"])

    def test_a_real_write_request_still_leaves_tool_choice_to_the_action_flow(self):
        self.assertEqual(plan("Lập phiếu đề xuất nhập cho sách ưu tiên cao").required_tools, [])


class Copilot33PlannerGapTests(unittest.TestCase):
    """Dev/val questions of the 3.3 evaluation that the 3.2 planner routed to no
    tool (the model then invented figures) or to the wrong one."""

    def test_returns_and_title_demand_questions_fetch_data(self):
        self.assertEqual(tools(plan("Lượt trả sách 30 ngày qua tăng hay giảm?")), ["compare_borrow_periods"])
        self.assertEqual(tools(plan("Nhu cầu đối với Kafka on the Shore đang tăng hay giảm?")), ["explain_reorder_item"])
        p = plan("Tại sao Norwegian Wood ít được mượn hơn trước?")
        self.assertFalse(p.clarification_needed)
        self.assertEqual(tools(p), ["explain_reorder_item"])

    def test_the_full_reorder_cost_question_reads_the_list(self):
        self.assertEqual(tools(plan("Cần bao nhiêu tiền để nhập đủ toàn bộ sách được đề xuất?")), ["get_reorder_suggestions"])

    def test_a_price_per_copy_is_not_a_budget(self):
        self.assertEqual(cp.parse_budgets(cp.normalize_query("Đầu sách ưu tiên cao nào có giá dưới 100 nghìn một bản?")), [])
        self.assertEqual(cp.parse_budgets(cp.normalize_query("Ngân sách 100 nghìn nhập được gì?")), [100000])

    def test_down_to_a_percentage(self):
        self.assertEqual(cp.parse_budget_change_pct(cp.normalize_query("giảm ngân sách 10 triệu xuống 20%")), -80.0)
        self.assertEqual(cp.parse_budget_change_pct(cp.normalize_query("giảm ngân sách 10 triệu 20%")), -20.0)
        self.assertEqual(cp.parse_budget_change_pct(cp.normalize_query("tăng ngân sách 12 triệu thêm 50%")), 50.0)
        p = plan("Nếu giảm ngân sách 10 triệu xuống 20% thì sao?")
        self.assertTrue(any("xuống 20%" in a for a in p.assumptions))

    def test_stock_comparison_is_not_aging(self):
        self.assertEqual(tools(plan("So sánh Kho HCM Chinh với Chi Nhanh District 3 về tồn kho")), ["compare_warehouses"])

    def test_post_test_gaps_fetch_data(self):
        # Exposed by the frozen test split (post-test fix, see copilot33_code_freeze.json).
        self.assertEqual(tools(plan("Hôm nay có bao nhiêu đầu sách đang dưới mức tồn tối thiểu?")), ["get_warehouse_stock_risk"])
        self.assertEqual(tools(plan("Tóm tắt nhanh các chỉ số chính của thư viện hôm nay")), ["get_dashboard_kpis"])
        self.assertEqual(tools(plan("Chỉ số tồn kho an toàn là gì?")), [])

    def test_a_reservation_trend_question_compares_periods(self):
        self.assertIn("compare_borrow_periods", tools(plan("Lượt đặt chỗ có đang tăng không?")))


class Phase6DecisionPlannerTests(unittest.TestCase):
    """Follow-ups and what-ifs of a manager's budget session (Phase 6)."""

    def chain(self, questions):
        state, plans = None, []
        for q in questions:
            p = cp.build_plan(q, state, [{"id": "w-hn", "code": "WH-HN-01", "name": "Kho Ha Noi", "is_active": True}])
            plans.append(p)
            state = cp.next_state(p, {}, state)
        return plans

    def args(self, p):
        return next((t["args"] for t in p.required_tools if t["name"] == "simulate_reorder_budget"), None)

    def test_minus_20_percent_follows_the_previous_budget(self):
        _, p = self.chain(["Với 15 triệu nên nhập những sách nào?", "Nếu giảm 20% thì bỏ bớt cuốn nào?"])
        self.assertEqual(self.args(p), {"budgets_vnd": [15000000], "budget_change_pct": -20.0})

    def test_least_risk_replays_the_scenarios_and_keeps_their_budgets(self):
        *_, risk, nxt = self.chain(["Với 15 triệu nên nhập những sách nào?", "Nếu ngân sách còn 5 triệu?",
                                    "Phương án nào ít rủi ro hơn?", "Nếu nhà cung cấp giao chậm thêm 7 ngày thì sao?"])
        self.assertEqual(self.args(risk), {"budgets_vnd": [5000000, 15000000]})
        self.assertEqual(risk.requested_analysis, "decision")
        self.assertEqual(self.args(nxt), {"budgets_vnd": [5000000], "lead_time_delay_days": 7})

    def test_priority_warehouse_keep_service_and_delay_parsing(self):
        _, p = self.chain(["Với 15 triệu nên nhập những sách nào?", "Nếu ưu tiên kho Hà Nội thì sao?"])
        self.assertEqual(self.args(p), {"budgets_vnd": [15000000], "priority_warehouse": "Kho Ha Noi"})
        self.assertEqual(self.args(plan("Làm sao giảm chi phí nhập sách mà vẫn giữ mức phục vụ?")), {"keep_service": True})
        self.assertEqual(cp.parse_lead_time_delay("nha cung cap giao cham 1 tuan"), 7)
        self.assertEqual(tools(plan("Kho nào rủi ro nhất?")), ["get_warehouse_stock_risk"])

    def test_a_draft_request_with_a_budget_reads_that_budget_allocation(self):
        p = plan("Lập phiếu đề xuất nhập nháp với ngân sách 15.000.000 ₫")
        self.assertEqual(p.required_tools, [{"name": "get_reorder_suggestions", "args": {"budget_vnd": 15000000, "limit": 100}}])
