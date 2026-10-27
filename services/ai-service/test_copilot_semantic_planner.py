"""Phase 1 - hybrid semantic planning: routing, strict validation, safe
reconciliation, fallbacks, multi-intent decomposition, context resolution and
cache keys. The LLM is always a fake (no OpenRouter)."""
from __future__ import annotations

import asyncio
import unittest
from datetime import datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import copilot_plan as cp
import copilot_response
import copilot_semantic_planner as sp
from llm_provider import JSONContentError

NOW = datetime(2026, 10, 26, 10, 0, tzinfo=cp.VN_TZ)
WAREHOUSES = [
    {"id": "w-hcm", "code": "WH-HCM-01", "name": "Kho HCM Chinh"},
    {"id": "w-hn", "code": "WH-HN-01", "name": "Kho Ha Noi"},
    {"id": "w-ct", "code": "WH-CT-01", "name": "Kho Cần Thơ"},
]
HCM_ONLY = [WAREHOUSES[0]]


class FakeLLM:
    def __init__(self, reply=None, error=None, delay=0.0):
        self.reply, self.error, self.delay, self.calls = reply, error, delay, []

    async def chat_json(self, messages, *, max_tokens, timeout, feature=""):
        self.calls.append(messages)
        if self.delay:
            await asyncio.sleep(self.delay)
        if self.error:
            raise self.error
        return self.reply, SimpleNamespace(as_dict=lambda: {"prompt_tokens": 100, "completion_tokens": 40,
                                                            "costUsd": 0.00005, "latency_ms": 900})


def reading(**kw):
    base = {"capabilities": [], "analysis_type": "lookup", "time_range": None, "comparison_period": None,
            "warehouses": [], "references_previous": False, "sub_questions": [], "out_of_scope": False,
            "action_request": False, "needs_clarification": False, "clarification_reason": None, "confidence": 0.8}
    base.update(kw)
    return base


def tools(plan):
    return [t["name"] for t in plan.required_tools]


class SemanticPlannerTests(unittest.IsolatedAsyncioTestCase):
    async def turn(self, message, llm, state=None, warehouses=WAREHOUSES, enabled=True, timeout=1.0):
        sp._cache.clear()
        return await sp.plan_turn(message, state, warehouses, provider=llm, now=NOW, enabled=enabled, timeout=timeout)

    async def test_a_question_the_rules_fully_understand_never_calls_the_llm(self):
        llm = FakeLLM(reading(capabilities=["kpi"]))
        for q in ("Có bao nhiêu phiếu mượn đang quá hạn?", "Top 10 sách được mượn nhiều nhất tháng này",
                  "Kho Hà Nội có những sách nào sắp hết?"):
            plan, info = await self.turn(q, llm)
            self.assertFalse(info["routed"], q)
        self.assertEqual(llm.calls, [])

    async def test_flag_off_is_the_rule_plan(self):
        llm = FakeLLM(reading(capabilities=["kpi"]))
        plan, info = await self.turn("Dạo này thư viện hoạt động ra sao?", llm, enabled=False)
        self.assertEqual(llm.calls, [])
        self.assertEqual(plan.capabilities, [])
        self.assertEqual(info["status"], "off")

    async def test_paraphrase_gets_a_capability_and_whitelisted_tools(self):
        llm = FakeLLM(reading(capabilities=["kpi"], analysis_type="lookup"))
        plan, info = await self.turn("Dạo này thư viện hoạt động ra sao?", llm)
        self.assertTrue(info["routed"])
        self.assertEqual(info["reasons"], ["no_capability"])
        self.assertEqual(plan.capabilities, ["kpi"])
        self.assertEqual(tools(plan), ["get_dashboard_kpis"])
        self.assertTrue(info["decision"].startswith("merged"))
        self.assertTrue(any("Đã hiểu câu hỏi" in a for a in plan.assumptions))

    async def test_model_cannot_name_tools_endpoints_or_unknown_capabilities(self):
        llm = FakeLLM(reading(capabilities=["delete_loans", "kpi", "sql"], tools=["drop_table"],
                              endpoint="/admin/users", analysis_type="exfiltrate"))
        plan, info = await self.turn("Dạo này thư viện hoạt động ra sao?", llm)
        self.assertEqual(tools(plan), ["get_dashboard_kpis"])
        self.assertTrue(set(tools(plan)) <= cp.PLANNABLE_TOOLS)
        dropped = info["reading"]["dropped"]
        self.assertIn("capability:delete_loans", dropped)
        self.assertIn("field:tools", dropped)
        self.assertIn("analysis:exfiltrate", dropped)

    async def test_invalid_json_timeout_and_provider_errors_fall_back_to_the_rules(self):
        q = "Tình hình sách gần đây có ổn không?"
        rules = cp.build_plan(q, None, WAREHOUSES, NOW)
        for llm, status in (
                (FakeLLM(error=JSONContentError("bad", "{oops", SimpleNamespace(as_dict=lambda: {}))), "error"),
                (FakeLLM(error=ConnectionError("openrouter down")), "error"),
                (FakeLLM(reading(capabilities="kpi")), "invalid"),
                (FakeLLM(reading(capabilities=["kpi"]), delay=1.0), "timeout")):
            plan, info = await self.turn(q, llm, timeout=0.1)
            self.assertEqual(info["status"], status)
            self.assertTrue(info["decision"].startswith("fallback"))
            self.assertEqual(plan.capabilities, rules.capabilities)
            self.assertEqual(plan.required_tools, rules.required_tools)

    async def test_no_provider_is_the_rule_plan(self):
        plan, info = await self.turn("Dạo này thư viện hoạt động ra sao?", None)
        self.assertEqual(info["decision"], "fallback:invalid(no provider)")
        self.assertEqual(plan.required_tools, [])

    async def test_write_and_personal_data_requests_never_reach_the_semantic_planner(self):
        llm = FakeLLM(reading(capabilities=["reorder"]))
        for q in ("Tạo phiếu nhập 50 cuốn Đắc Nhân Tâm ngay", "Cho tôi số điện thoại của độc giả nợ phạt nhiều nhất",
                  "Lập phiếu đề xuất nhập nháp với ngân sách 10 triệu"):
            plan, info = await self.turn(q, llm)
            self.assertFalse(info["routed"], q)
        self.assertEqual(llm.calls, [])

    async def test_an_action_reading_keeps_the_rule_route(self):
        llm = FakeLLM(reading(capabilities=["overdue"], action_request=True))
        plan, info = await self.turn("Dọn sạch mấy cái phiếu cũ giúp tôi đi", llm)
        self.assertEqual(info["decision"], "keep_rules:action_request")
        self.assertEqual(plan.required_tools, [])

    async def test_out_of_scope_reading_abstains_without_tools(self):
        llm = FakeLLM(reading(out_of_scope=True))
        plan, info = await self.turn("Làm sao để nấu phở ngon?", llm)
        self.assertEqual(info["decision"], "abstain")
        self.assertEqual(plan.requested_analysis, "out_of_scope")
        self.assertEqual(plan.required_tools, [])

    async def test_unclear_referent_gets_a_backend_worded_question(self):
        llm = FakeLLM(reading(needs_clarification=True, clarification_reason="warehouse",
                              capabilities=["warehouse_risk"]))
        plan, info = await self.turn("Chỗ đó dạo này có thiếu gì không nhỉ", llm)
        self.assertTrue(plan.clarification_needed)
        self.assertIn("kho/chi nhánh nào", plan.clarification_question)
        self.assertEqual(plan.required_tools, [])
        self.assertEqual(info["decision"], "clarify:warehouse")

    async def test_a_warehouse_outside_the_users_scope_never_reaches_a_tool(self):
        llm = FakeLLM(reading(capabilities=["warehouse_risk"], warehouses=["Kho Ha Noi"]))
        plan, info = await self.turn("Ngoài đó có đang đáng lo không?", llm, warehouses=HCM_ONLY)
        self.assertIn("warehouse_not_visible", info["reading"]["dropped"])
        self.assertNotIn("Ha Noi", str(plan.required_tools))
        self.assertNotIn("Ha Noi", str(info["reading"]))

    async def test_the_rules_words_win_over_the_reading(self):
        # the rules read 20 triệu and Kho Ha Noi from the text; the reading can add, not replace
        llm = FakeLLM(reading(capabilities=["reorder", "top_borrowed"], warehouses=["Kho HCM Chinh"],
                              time_range="last_year"))
        plan, info = await self.turn("Với 20 triệu cho kho Hà Nội, những đầu sách được quan tâm nhiều nhất có nên "
                                     "bổ sung không, tình hình chung ra sao", llm)
        self.assertTrue(info["routed"])
        self.assertEqual(plan.entities["budgets_vnd"], [20_000_000])
        self.assertEqual([w["code"] for w in plan.entities["warehouses"]], ["WH-HN-01"])

    async def test_multi_intent_reading_adds_the_missing_part_and_dedupes_tools(self):
        q = ("Tháng này lượt mượn tăng hay giảm, những đầu sách nào được quan tâm nhiều nhất và cần nhập thêm không?")
        llm = FakeLLM(reading(capabilities=["borrow_trend", "top_borrowed", "reorder"], analysis_type="comparison",
                              sub_questions=[{"question": "a", "capabilities": ["borrow_trend"]},
                                             {"question": "b", "capabilities": ["top_borrowed"]},
                                             {"question": "c", "capabilities": ["reorder"]}]))
        plan, info = await self.turn(q, llm)
        self.assertEqual(info["reasons"], ["uncovered_clause"])
        self.assertEqual(set(plan.capabilities), {"borrow_trend", "top_borrowed", "reorder"})
        names = tools(plan)
        self.assertEqual(len(names), len(set(names)))
        self.assertIn("compare_borrow_periods", names)
        self.assertEqual(len(plan.sub_questions), 3)
        self.assertTrue(all(p["status"] == "planned" for p in plan.sub_questions))

    async def test_readings_are_cached_per_context_not_per_text(self):
        llm = FakeLLM(reading(capabilities=["kpi"]))
        sp._cache.clear()
        q = "Dạo này thư viện hoạt động ra sao?"
        await sp.plan_turn(q, None, WAREHOUSES, provider=llm, now=NOW, enabled=True)
        await sp.plan_turn(q, None, WAREHOUSES, provider=llm, now=NOW, enabled=True)
        self.assertEqual(len(llm.calls), 1)
        await sp.plan_turn(q, {"capabilities": ["fines"]}, WAREHOUSES, provider=llm, now=NOW, enabled=True)
        await sp.plan_turn(q, None, HCM_ONLY, provider=llm, now=NOW, enabled=True)
        self.assertEqual(len(llm.calls), 3)

    async def test_prompt_carries_structured_context_not_previous_answers(self):
        llm = FakeLLM(reading(capabilities=["warehouse_risk"]))
        state = {"capabilities": ["warehouse_risk"], "warehouses": [{"id": "w-hn", "name": "Kho Ha Noi"}],
                 "last_items": [{"variant_id": "v1", "title": "Sapiens"}]}
        await self.turn("Liệu lượng sách hiện tại có đáp ứng được nhu cầu không?", llm, state=state)
        prompt = llm.calls[0][1]["content"]
        self.assertIn("Kho Ha Noi", prompt)
        self.assertIn("<question>", prompt)
        self.assertIn("Sapiens", prompt)  # titles shown, as data
        self.assertNotIn("assistant", prompt)


class DecompositionTests(unittest.TestCase):
    def test_composite_tool_answers_three_parts_and_parts_build_on_each_other(self):
        plan = cp.build_plan("Các sách được mượn nhiều nhất tháng này là gì, sách nào sắp hết và cần nhập thêm bao "
                             "nhiêu?", None, WAREHOUSES, NOW)
        self.assertEqual(tools(plan), ["analyze_demand_vs_stock"])
        parts = {p["capability"]: p for p in plan.sub_questions}
        self.assertEqual(set(parts), {"top_borrowed", "warehouse_risk", "reorder"})
        self.assertTrue(all(p["tools"] == ["analyze_demand_vs_stock"] for p in parts.values()))
        self.assertEqual(parts["reorder"]["depends_on"], [parts["top_borrowed"]["id"], parts["warehouse_risk"]["id"]])

    def test_tool_calls_per_turn_are_bounded(self):
        plan = cp.build_plan("KPI, quá hạn, tiền phạt, đặt chỗ, sách tồn lâu, thanh lý, top sách và kho nào rủi ro",
                             None, WAREHOUSES, NOW)
        self.assertLessEqual(len(plan.required_tools), cp.MAX_PLANNED_TOOLS)

    def test_borrow_trend_per_warehouse_is_marked_partial(self):
        plan = cp.build_plan("Kho Hà Nội đang thiếu gì, và lượt mượn ở đó có tăng không?", None, WAREHOUSES, NOW)
        trend = next(p for p in plan.sub_questions if p["capability"] == "borrow_trend")
        self.assertEqual(trend["status"], "partial")

    def test_prompt_lists_the_parts_and_failed_parts_are_reported(self):
        plan = cp.build_plan("Cho tôi số phiếu quá hạn và tổng tiền phạt chưa thu", None, WAREHOUSES, NOW)
        self.assertIn("Câu hỏi gồm 2 ý", copilot_response.plan_note(plan, NOW))
        note = copilot_response.coverage_note(plan, {"get_overdue_summary": {"total": 3},
                                                     "get_fine_summary": {"error": "timeout"}})
        self.assertIn("Tiền phạt: không truy xuất được dữ liệu", note)
        self.assertEqual(copilot_response.coverage_note(plan, {"get_overdue_summary": {}, "get_fine_summary": {}}), "")

    def test_same_question_anaphora_is_not_a_reference_to_the_previous_turn(self):
        plan = cp.build_plan("Nhập thêm sách gì với ngân sách 15 triệu, và những sách đó có đang được mượn nhiều "
                             "không?", None, WAREHOUSES, NOW)
        self.assertFalse(plan.clarification_needed)
        self.assertEqual(plan.entities["budgets_vnd"], [15_000_000])


class ContextResolutionTests(unittest.TestCase):
    def run_turns(self, *turns, warehouses=WAREHOUSES, collected=None):
        state, plan = None, None
        for i, q in enumerate(turns):
            plan = cp.build_plan(q, state, warehouses, NOW)
            state = cp.next_state(plan, (collected or {}).get(i, {}), state)
        return plan, state

    def test_increase_by_amount_is_relative_to_the_previous_budget(self):
        plan, _ = self.run_turns("Với ngân sách 10 triệu nên nhập những sách gì?", "Nếu tăng thêm 5 triệu?")
        self.assertEqual(plan.entities["budgets_vnd"], [15_000_000])
        self.assertTrue(any("10 triệu + 5 triệu = 15 triệu" in a for a in plan.assumptions))
        plan, _ = self.run_turns("Với ngân sách 10 triệu nên nhập những sách gì?", "Nếu tăng lên 25 triệu?")
        self.assertEqual(plan.entities["budgets_vnd"][0], 25_000_000)

    def test_reduce_by_percent_is_not_reduce_to_percent(self):
        by, _ = self.run_turns("Ngân sách 20 triệu nên nhập gì?", "Nếu giảm ngân sách 20%?")
        to, _ = self.run_turns("Ngân sách 20 triệu nên nhập gì?", "Nếu giảm xuống còn 20%?")
        self.assertEqual(by.entities["budget_change_pct"], -20)
        self.assertEqual(to.entities["budget_change_pct"], -80)
        self.assertEqual(by.entities["budgets_vnd"], [20_000_000])

    def test_which_is_worse_after_a_comparison_stays_on_the_compared_warehouses(self):
        plan, _ = self.run_turns("So sánh tình hình tồn kho của Hà Nội và Hồ Chí Minh.", "Kho nào đáng lo hơn?")
        self.assertTrue(plan.is_followup)
        self.assertEqual({w["code"] for w in plan.entities["warehouses"]}, {"WH-HN-01", "WH-HCM-01"})
        self.assertEqual(tools(plan), ["compare_warehouses"])

    def test_remaining_warehouse_is_the_one_not_singled_out(self):
        riskier = {"compare_warehouses": {"comparison": {"riskier": "Kho HCM Chinh"}}}
        plan, _ = self.run_turns("So sánh kho Hà Nội và kho HCM", "Kho còn lại thì sao?", collected={0: riskier})
        self.assertEqual([w["code"] for w in plan.entities["warehouses"]], ["WH-HN-01"])
        plan, _ = self.run_turns("So sánh kho Hà Nội và kho HCM", "Kho còn lại thì sao?")
        self.assertTrue(plan.clarification_needed)  # nothing was singled out: ask, do not guess

    def test_these_two_warehouses_are_the_last_two_mentioned(self):
        plan, _ = self.run_turns("Kho HCM có bao nhiêu đầu sách dưới ngưỡng tồn?", "Còn kho Hà Nội?",
                                 "So sánh hai kho này")
        self.assertEqual({w["code"] for w in plan.entities["warehouses"]}, {"WH-HCM-01", "WH-HN-01"})
        self.assertEqual(tools(plan), ["compare_warehouses"])

    def test_a_revoked_warehouse_is_not_carried_into_the_next_turn(self):
        state = cp.next_state(cp.build_plan("Kho Hà Nội có sách nào sắp hết?", None, WAREHOUSES, NOW), {}, None)
        plan = cp.build_plan("Tại sao kho đó thiếu sách?", state, HCM_ONLY, NOW)
        self.assertNotIn("Ha Noi", str(plan.required_tools))
        self.assertTrue(plan.clarification_needed)

    def test_an_independent_new_topic_inherits_no_budget_or_warehouse(self):
        plan, _ = self.run_turns("Ngân sách 50 triệu thì nhập được gì?", "Sách nào được mượn nhiều nhất tuần này?")
        self.assertEqual(plan.entities["budgets_vnd"], [])
        plan, _ = self.run_turns("Kho Cần Thơ có sách nào sắp hết?", "Còn tiền phạt chưa thu thì sao?")
        self.assertEqual(plan.entities["warehouses"], [])
        self.assertEqual(tools(plan), ["get_fine_summary"])

    def test_presentation_change_reuses_data_instead_of_a_new_query(self):
        plan, _ = self.run_turns("Lượt mượn tháng này thế nào?", "Đổi sang biểu đồ cột.")
        self.assertEqual(plan.visualization.get("mode"), "retype")
        plan, _ = self.run_turns("Tình hình quá hạn tuần này", "Tóm tắt trong 3 câu.")
        self.assertTrue(plan.style.get("brief"))
        self.assertEqual(tools(plan), ["get_overdue_summary"])


class VietnameseRobustnessTests(unittest.TestCase):
    def test_informal_and_unaccented_questions(self):
        cases = {
            "thang nay muon co giam ko": {"borrow_trend"},
            "kpi hnay": {"kpi"},
            "kho dn con it sach ko": {"warehouse_risk"},
        }
        for q, caps in cases.items():
            self.assertEqual(set(cp.build_plan(q, None, WAREHOUSES + [{"id": "w-dn", "code": "WH-DN-01",
                                                                     "name": "Kho Đà Nẵng"}], NOW).capabilities),
                             caps, q)

    def test_budget_lists_share_their_unit_and_decimals_stay_whole(self):
        self.assertEqual(cp.parse_budgets(cp.normalize_query("3 phương án 5, 15, 30 triệu")),
                         [5_000_000, 15_000_000, 30_000_000])
        self.assertEqual(cp.parse_budgets(cp.normalize_query("ngân sách 1,5 tỷ")), [1_500_000_000])
        self.assertEqual(cp.parse_budgets(cp.normalize_query("10 và 20 triệu")), [10_000_000, 20_000_000])

    def test_abbreviations(self):
        self.assertEqual(cp.normalize_query("can uu tien gi trc"), "can uu tien gi truoc")
        self.assertEqual(cp.normalize_query("thg nay"), "thang nay")

    def test_isbn_numbers_and_titles_are_not_rewritten(self):
        self.assertIn("9786042125352", cp.normalize_query("ISBN 9786042125352 còn không"))
        self.assertIn("harry potter", cp.normalize_query("co sach harry potter ko"))

    def test_duration_in_stock_is_not_a_reference_to_a_warehouse(self):
        plan = cp.build_plan("Sách nào nằm kho trên 90 ngày, sách nào nên thanh lý và kho nào đang thiếu hàng?",
                             None, WAREHOUSES, NOW)
        self.assertFalse(plan.clarification_needed)
        self.assertEqual(set(plan.capabilities), {"aging", "weeding", "warehouse_risk"})


class EndpointPlanningTests(unittest.IsolatedAsyncioTestCase):
    async def test_both_endpoints_plan_through_the_same_function(self):
        import main
        with patch("main.copilot_tools._warehouses", new=AsyncMock(return_value=WAREHOUSES)), \
                patch("main.copilot_semantic_planner.plan_turn",
                      new=AsyncMock(return_value=(cp.QueryPlan(intent="GENERAL_QUERY"), {}))) as planned:
            await main._plan_assistant_turn("Dạo này thư viện hoạt động ra sao?", None, "Bearer t")
        planned.assert_awaited_once()
        import inspect
        src = inspect.getsource(main._start_assistant_turn)
        self.assertIn("_plan_assistant_turn", src)
        self.assertIn("_start_assistant_turn", inspect.getsource(main.assistant))
        self.assertIn("_start_assistant_turn", inspect.getsource(main.assistant_stream))

    async def test_a_planner_crash_degrades_to_an_empty_plan(self):
        import main
        with patch("main.copilot_tools._warehouses", new=AsyncMock(return_value=WAREHOUSES)), \
                patch("main.copilot_semantic_planner.plan_turn", new=AsyncMock(side_effect=RuntimeError("boom"))):
            plan, _w = await main._plan_assistant_turn("x", None, "Bearer t")
        self.assertEqual(plan.required_tools, [])

    def test_follow_up_answers_are_cached_per_previous_turn(self):
        import main
        a = main._assistant_cache_key("c", "Tại sao?", "p", {"capabilities": ["fines"]})
        b = main._assistant_cache_key("c", "Tại sao?", "p", {"capabilities": ["overdue"]})
        self.assertNotEqual(a, b)
        main.assistant_response_cache.clear()
        main.assistant_response_cache.set(a, {"answer": "fines", "context_free": False})
        self.assertIsNone(main._cache_lookup(main._assistant_cache_key("c", "Tại sao?", "p"), b))
        self.assertEqual(main._cache_lookup(main._assistant_cache_key("c", "Tại sao?", "p"), a)["answer"], "fines")


class NluCacheTests(unittest.IsolatedAsyncioTestCase):
    async def test_llm_classification_is_not_shared_across_histories(self):
        import nlu
        nlu._nlu_cache.clear()
        calls = []

        async def fake_llm(message, history):
            calls.append(history)
            return {}, False
        with patch("nlu._call_llm", new=fake_llm):
            await nlu.classify_user_message("còn tháng trước?", [{"role": "user", "content": "tiền phạt"}])
            await nlu.classify_user_message("còn tháng trước?", [{"role": "user", "content": "lượt mượn"}])
        self.assertEqual(len(calls), 2)


if __name__ == "__main__":
    unittest.main()
