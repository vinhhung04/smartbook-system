"""Phase 6: structured decision response and backend what-if scenarios."""
from __future__ import annotations

import asyncio
import json
import unittest
from types import SimpleNamespace
from unittest.mock import patch

import main

import copilot_decision as cd
import copilot_tools as ct
from test_copilot_tools import FakeGateway, reorder_item

SIM = {
    "full_need": {"total_candidates": 116, "high_priority": 93, "estimated_total_cost": 79_000_000,
                  "need_with_position_vnd": 31_800_000},
    "scenarios": [
        {"label": "Ngân sách 5.000.000 ₫", "budget_vnd": 5_000_000, "funded_cost": 4_990_000, "remaining_vnd": 10_000,
         "funded_lines": 3, "funded_qty": 60, "expected_service_pct": 62.0, "unfunded_high_priority": 70,
         "unfunded_high_examples": [{"title": "Kafka on the Shore"}], "funded_items": [{"title": "A", "funded_qty": 50}]},
        {"label": "Ngân sách 15.000.000 ₫", "budget_vnd": 15_000_000, "funded_cost": 14_970_000, "remaining_vnd": 30_000,
         "funded_lines": 34, "funded_qty": 166, "expected_service_pct": 91.9, "unfunded_high_priority": 37,
         "partially_funded_lines": 21, "vs_first_scenario": {"expected_service_pct": 29.9}},
    ],
    "least_risk_scenario": {"label": "Ngân sách 15.000.000 ₫", "expected_service_pct": 91.9, "unfunded_high_priority": 37,
                            "rule": "nhiều nhu cầu dự kiến nhất"},
    "service_curve": {"cost_for_service_pct": {"90": 14_000_000, "95": 17_100_000, "99": 22_400_000, "100": 27_000_000}},
    "scenarios_are_assumed": False, "budget_assumptions": ["Tồn = khả dụng + đang về + dự kiến trả."],
    "limitations": ["Không tối ưu theo ràng buộc nhà cung cấp."], "retrieved_at": "2026-10-18T10:00:00+00:00",
}
SAFE = {"status": "PASSED", "safe_to_act": True}


def plan(analysis):
    return SimpleNamespace(requested_analysis=analysis)


class DecisionObjectTests(unittest.TestCase):
    def test_simple_lookup_gets_no_decision(self):
        self.assertIsNone(cd.build(plan("lookup"), {"simulate_reorder_budget": SIM}, SAFE))
        self.assertIsNone(cd.build(plan("decision"), {"get_overdue_summary": {}}, SAFE))

    def test_options_pros_cons_and_a_conditional_recommendation(self):
        d = cd.build(plan("what_if"), {"simulate_reorder_budget": SIM}, SAFE)
        cheap, safe = d["options"]
        self.assertIn("Chi phí thấp nhất trong các phương án", cheap["pros"])
        self.assertTrue(any("70 đầu sách ưu tiên cao" in c for c in cheap["cons"]))
        self.assertIn("Đáp ứng nhiều nhu cầu dự kiến nhất trong thời gian chờ hàng", safe["pros"])
        self.assertTrue(safe["is_least_risk"])
        rec = d["recommendation"]
        self.assertEqual(rec["option"], "Ngân sách 15.000.000 ₫")
        self.assertIn("Nếu ưu tiên giảm rủi ro hết sách", rec["condition"])
        self.assertIn("Nếu ưu tiên chi phí", rec["condition"])
        # SmartBook states trade-offs; it never calls an option optimal
        self.assertNotIn("tối ưu", json.dumps({k: v for k, v in d.items() if k != "assumptions"}, ensure_ascii=False))

    def test_every_figure_comes_from_the_tool_data(self):
        d = cd.build(plan("decision"), {"simulate_reorder_budget": SIM}, SAFE)
        self.assertIn("4.990.000 ₫", d["conclusion"])
        self.assertIn("62%", d["conclusion"])
        labels = {p["label"]: p["value"] for p in d["data_points"]}
        self.assertEqual(labels["Chi phí tối thiểu để đạt 95% mức phục vụ của toàn bộ kế hoạch"], 17_100_000)
        self.assertEqual(d["evidence"][0]["as_of"], SIM["retrieved_at"])

    def test_draft_step_only_when_safe_and_never_automatic(self):
        d = cd.build(plan("decision"), {"simulate_reorder_budget": SIM}, SAFE)
        self.assertEqual(d["next_step"]["type"], "CREATE_REORDER_DRAFT")
        self.assertIn("15.000.000 ₫", d["next_step"]["message"])
        self.assertIn("không tự tạo hay duyệt", d["next_step"]["note"])
        blocked = cd.build(plan("decision"), {"simulate_reorder_budget": SIM}, {"status": "BLOCKED", "safe_to_act": False})
        self.assertIsNone(blocked["next_step"])
        self.assertEqual(blocked["verification"]["status"], "BLOCKED")
        assumed = cd.build(plan("decision"), {"simulate_reorder_budget": {**SIM, "scenarios_are_assumed": True}}, SAFE)
        self.assertIsNone(assumed["next_step"])
        self.assertTrue(assumed["assumptions"][0].startswith("Chưa nêu ngân sách"))


class WhatIfToolTests(unittest.TestCase):
    """The what-if scenarios are analytics calls with the right parameters; the
    model computes nothing."""

    def _gateway(self, seen):
        items = [reorder_item("v-1", "A")]

        def reorder(params):
            seen.append(dict(params))
            body = {"summary": {"total_candidates": 1, "high_priority": 1, "estimated_total_cost": 400_000,
                                "estimated_total_reorder_qty": 4}, "items": [dict(i) for i in items]}
            if params.get("budgetVnd") is not None:
                delay = params.get("leadTimeDelayDays")
                body["budget"] = {"budget_vnd": params["budgetVnd"], "funded_cost": min(400_000, params["budgetVnd"]),
                                  "remaining_vnd": 0, "funding_order": "MARGINAL_SERVICE_PER_COST",
                                  "expected_service_pct": 70.0 if delay else 90.0,
                                  **({"lead_time_delay_days": delay} if delay else {}),
                                  **({"priority_warehouse_id": params["priorityWarehouseId"], "priority_lines": 2,
                                      "priority_lines_funded": 1} if params.get("priorityWarehouseId") else {}),
                                  "service_curve": {"cost_for_service_pct": {"90": 300_000, "95": 350_000, "99": 390_000,
                                                                             "100": 400_000}, "full_plan_cost": 400_000}}
                for i in body["items"]:
                    i.update(within_budget=True, funded_qty=4, funded_cost=400_000)
            return body
        return FakeGateway({"/analytics/reorder-suggestions": reorder,
                            "/api/warehouses": lambda p: [{"id": "w-hn", "code": "WH-HN-01", "name": "Kho Ha Noi",
                                                           "is_active": True}]})

    def run_tool(self, **kw):
        seen = []
        with patch.object(ct, "_cached_get", self._gateway(seen)):
            return asyncio.run(ct.simulate_reorder_budget("Bearer t", **kw)), seen

    def test_supplier_delay_compares_the_same_budget(self):
        r, seen = self.run_tool(budgets_vnd=[15_000_000], lead_time_delay_days=7)
        self.assertEqual([s["label"] for s in r["scenarios"]],
                         ["Ngân sách 15.000.000 ₫", "Ngân sách 15.000.000 ₫, nhà cung cấp giao chậm thêm 7 ngày"])
        self.assertIn({"limit": 100, "budgetVnd": 15_000_000.0, "leadTimeDelayDays": 7}, seen)
        self.assertEqual(r["scenarios"][1]["vs_first_scenario"]["expected_service_pct"], -20.0)
        self.assertEqual([s["kind"] for s in r["scenarios"]], ["choice", "condition"])
        self.assertIsNone(r["least_risk_scenario"])  # a delay is not an option to rank

    def test_priority_warehouse_is_resolved_to_its_id(self):
        r, seen = self.run_tool(budgets_vnd=[15_000_000], priority_warehouse="Kho Ha Noi")
        self.assertTrue(any(p.get("priorityWarehouseId") == "w-hn" for p in seen))
        s = r["scenarios"][1]
        self.assertEqual((s["priority_warehouse"], s["priority_lines"], s["priority_lines_funded"]), ("Kho Ha Noi", 2, 1))

    def test_keep_service_adds_the_least_budgets_for_99_95_90(self):
        r, _ = self.run_tool(keep_service=True)
        labels = [s["label"] for s in r["scenarios"]]
        self.assertEqual(labels[0], "Đủ nhu cầu hiện tại (400.000 ₫)")
        self.assertTrue(labels[1].startswith("Giữ 99% mức phục vụ"))
        self.assertEqual([s["budget_vnd"] for s in r["scenarios"][1:]], [390_000.0, 350_000.0, 300_000.0])
        self.assertFalse(r["scenarios_are_assumed"])


from test_copilot_endpoints import SequenceProvider, _request  # noqa: E402
from test_copilot_verification import ADMIN  # noqa: E402
from test_copilot_visualization import WAREHOUSES, FakeStoreWithData  # noqa: E402
from unittest.mock import AsyncMock  # noqa: E402
from main import AssistantRequest  # noqa: E402

BUDGETED = {"summary": {"total_candidates": 2, "high_priority": 2, "estimated_total_cost": 900_000, "estimated_total_reorder_qty": 9},
            "budget": {"budget_vnd": 15_000_000, "funded_cost": 700_000, "remaining_vnd": 14_300_000, "funded_lines": 2,
                       "funded_qty": 7, "partially_funded_lines": 1, "funding_order": "MARGINAL_SERVICE_PER_COST"},
            "items": [{"variant_id": "v1", "title": "Norwegian Wood", "priority": "HIGH", "suggested_reorder_qty": 5,
                       "funded_qty": 5, "within_budget": True, "estimated_cost": 500_000, "unit_cost": 100_000},
                      {"variant_id": "v2", "title": "Tam Cam", "priority": "HIGH", "suggested_reorder_qty": 4, "funded_qty": 2,
                       "within_budget": True, "estimated_cost": 400_000, "unit_cost": 100_000}]}


class DraftRequestEndpointTests(unittest.IsolatedAsyncioTestCase):
    """The decision card's draft button: deterministic text on both endpoints,
    no LLM call, and the draft is still only a pending, confirmable action."""
    Q = "Lập phiếu đề xuất nhập nháp với ngân sách 15.000.000 ₫"

    def setUp(self):
        self.store = FakeStoreWithData()
        main.assistant_response_cache.clear()
        self.seen = []

        async def reorder(auth_header=None, budget_vnd=None, limit=None, days=None, lead_time_days=None, priority=None):
            self.seen.append({k: v for k, v in (("budget_vnd", budget_vnd), ("limit", limit)) if v is not None})
            return BUDGETED

        self.action = AsyncMock(return_value={"id": "act-1", "type": "CREATE_REORDER_DRAFT", "status": "PENDING_CONFIRMATION"})
        self._patches = [
            patch("main.rate_limiter.acquire", new=AsyncMock(return_value=(True, None))),
            patch("main.get_user_context", new=AsyncMock(return_value=ADMIN)),
            patch("main.conversation_store.get_or_create_conversation", new=self.store.get_or_create_conversation),
            patch("main.conversation_store.append_message", new=self.store.append_message),
            patch("main.conversation_store.get_recent_messages", new=self.store.get_recent_messages),
            patch("main.copilot_tools._warehouses", new=AsyncMock(return_value=WAREHOUSES)),
            patch("main._build_assistant_pending_action", new=self.action),
            patch.dict(main.TOOL_FUNCTIONS, {"get_reorder_suggestions": reorder}),
        ]
        for p in self._patches:
            p.start()

    def tearDown(self):
        for p in self._patches:
            p.stop()

    async def ask(self, cid, stream):
        provider = SequenceProvider(["(the model must not be called)"])
        with patch("main._get_assistant_provider", return_value=provider):
            if stream:
                response = await main.assistant_stream(_request(), AssistantRequest(message=self.Q, conversation_id=cid))
                events = [chunk async for chunk in response.body_iterator]
                done = json.loads([e for e in events if e.startswith("event: done")][0].split("data: ", 1)[1])
                return done, provider
            return (await main.assistant(_request(), AssistantRequest(message=self.Q, conversation_id=cid))).model_dump(), provider

    async def test_both_endpoints_answer_without_the_model(self):
        for stream, cid in ((False, "d1"), (True, "d2")):
            body, provider = await self.ask(cid, stream)
            self.assertEqual(provider.calls, [])
            self.assertIn("CHƯA được tạo", body["answer"])
            self.assertIn("2 đầu sách / 7 bản", body["answer"])
            self.assertEqual(body["verification"]["status"], "PASSED")
            self.assertEqual(body["pending_action"]["type"], "CREATE_REORDER_DRAFT")
        self.assertEqual(self.seen[0], {"budget_vnd": 15000000, "limit": 100})


class ConditionScenarioTests(unittest.TestCase):
    def test_a_supplier_delay_is_a_condition_not_an_option(self):
        sim = {**SIM, "least_risk_scenario": None, "scenarios": [
            {**SIM["scenarios"][1], "kind": "choice"},
            {**SIM["scenarios"][1], "label": "Ngân sách 15.000.000 ₫, nhà cung cấp giao chậm thêm 7 ngày", "kind": "condition",
             "expected_service_pct": 80.2, "lead_time_delay_days": 7}]}
        d = cd.build(plan("what_if"), {"simulate_reorder_budget": sim}, SAFE)
        self.assertEqual([o["kind"] for o in d["options"]], ["choice", "condition"])
        self.assertFalse(any(o["is_least_risk"] for o in d["options"]))
        self.assertIn("điều kiện giả định, không phải lựa chọn", d["recommendation"]["condition"])
        self.assertIn("-11,7 điểm %", d["recommendation"]["condition"])
        self.assertEqual(d["recommendation"]["option"], "Ngân sách 15.000.000 ₫")
