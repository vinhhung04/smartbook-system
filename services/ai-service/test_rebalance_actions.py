"""Rebalancing drafts and their execution (Phase 5), end to end inside
ai-service: plan_draft -> pending action (SQLite store) -> "Tôi xác nhận" ->
main.confirm_action (the card's route) -> executor -> gateway (mock).
Covers: only executable lines are drafted, collaborative ones stay proposals,
fresh permission re-check at confirm, duplicate tags, stock changed (409),
unknown outcome -> reconciliation, scope unavailable -> nothing written,
another user's draft is never confirmed."""
from __future__ import annotations

import json
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import httpx
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

import agent_store
import copilot_plan as cp
import copilot_rebalance_decision as rd
import main
import rebalance_actions
import warehouse_scope
from agent_schemas import UserContext
from db_models import Base

HCM, HN, DN = "w-hcm", "w-hn", "w-dn"
MANAGER = UserContext(user_id="u-m", username="m", roles=["MANAGER"],
                      permissions=["inventory.operation.decide", "inventory.purchase.request", "analytics.read"])
OTHER = UserContext(user_id="u-x", username="x", roles=["MANAGER"],
                    permissions=["inventory.operation.decide", "inventory.purchase.request"])


def _plan_data():
    """An analytics /rebalancing-plan body: HN (READ) and DN (WRITE) can supply HCM."""
    t_dn = {"variant_id": "v1", "title": "Sách A", "from_warehouse_id": DN, "to_warehouse_id": HCM, "quantity": 2,
            "source_available_after": 3, "permission": "EXECUTABLE", "permission_reason": None}
    t_hn = {"variant_id": "v1", "title": "Sách A", "from_warehouse_id": HN, "to_warehouse_id": HCM, "quantity": 6,
            "permission": "COLLABORATIVE", "permission_reason": "NO_WRITE_ON_SOURCE"}
    buy = {"variant_id": "v2", "title": "Sách B", "warehouse_id": HCM, "quantity": 4, "unit_cost": 80000, "cost": 320000,
           "permission": "EXECUTABLE"}
    return {
        "generated_at": "2026-11-20T02:00:00Z",
        "scope": {"warehouses": [{"warehouse_id": HCM, "name": "Kho HCM", "access": "WRITE"},
                                 {"warehouse_id": HN, "name": "Kho Ha Noi", "access": "READ"},
                                 {"warehouse_id": DN, "name": "Kho Da Nang", "access": "WRITE"}]},
        "options": {
            "HYBRID": {"code": "HYBRID", "transfers": [t_hn], "purchases": [buy], "transfer_lines": 1, "purchase_lines": 1},
            "HYBRID_EXECUTABLE": {"code": "HYBRID_EXECUTABLE", "transfers": [t_dn], "purchases": [buy],
                                  "transfer_lines": 1, "purchase_lines": 1, "shortage_covered_pct": 66.7},
        },
        "recommendation": {"best_business_option": "HYBRID", "executable_option": "HYBRID_EXECUTABLE"},
    }


class PayloadTests(unittest.TestCase):
    def test_only_executable_lines_are_drafted(self):
        payload = rebalance_actions.build_payload(_plan_data(), {"destination_warehouses": ["Kho HCM"]})
        self.assertEqual(payload["option"], "HYBRID_EXECUTABLE")
        self.assertEqual([(g["from_warehouse_id"], [ln["quantity"] for ln in g["lines"]]) for g in payload["transfers"]],
                         [(DN, [2])])
        self.assertEqual([p["quantity"] for p in payload["purchases"]], [4])
        self.assertEqual([(p["kind"], p["from_warehouse"]) for p in payload["proposals"]], [("TRANSFER", "Kho Ha Noi")])

    def test_nothing_executable_means_no_draft(self):
        data = _plan_data()
        data["recommendation"]["executable_option"] = None
        self.assertIsNone(rebalance_actions.build_payload(data, {}))


class ExecutionTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.engine = create_async_engine("sqlite+aiosqlite:///:memory:", connect_args={"check_same_thread": False},
                                          poolclass=StaticPool)
        async with self.engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        sessions = async_sessionmaker(self.engine, expire_on_commit=False)
        self.sent: list[httpx.Request] = []
        self.existing_transfers: list[dict] = []
        self.transfer_reply = httpx.Response(201, json={"data": {"task_id": "t-1", "order_number": "TO-1", "status": "REQUESTED"}})
        self.writable = frozenset({HCM, DN})
        self.user = MANAGER

        def handler(request: httpx.Request) -> httpx.Response:
            self.sent.append(request)
            path = request.url.path
            if request.method == "GET" and path == "/api/order-requests":
                return httpx.Response(200, json={"data": self.existing_transfers})
            if request.method == "GET" and path == "/api/purchase-requests/my":
                return httpx.Response(200, json={"data": []})
            if path == "/api/order-requests/transfer":
                if isinstance(self.transfer_reply, Exception):
                    raise self.transfer_reply
                return self.transfer_reply
            if path == "/api/purchase-requests":
                return httpx.Response(201, json={"data": {"request_number": "PR-1", "status": "PENDING"}})
            return httpx.Response(404)

        real_client = httpx.AsyncClient

        def client_factory(*args, **kwargs):
            kwargs.pop("transport", None)
            return real_client(*args, transport=httpx.MockTransport(handler), **kwargs)

        async def writable(_user, **kw):
            if isinstance(self.writable, Exception):
                raise self.writable
            return self.writable

        self._patches = [
            patch.object(agent_store, "get_session", lambda: sessions()),
            patch.object(rebalance_actions.httpx, "AsyncClient", client_factory),
            patch("warehouse_scope.writable_warehouses", new=writable),
            patch("main.get_user_context", new=AsyncMock(side_effect=lambda h: self.user)),
            patch("main.push_ai_action_event", new=AsyncMock()),
            patch.object(rebalance_actions.copilot_tools, "fetch_rebalancing_plan",
                         new=AsyncMock(return_value=(_plan_data(), []))),
            patch.object(main.conversation_store, "append_message", new=AsyncMock()),
        ]
        for p in self._patches:
            p.start()
        self.conversation_id = "11111111-2222-4333-8444-555555555555"

    async def asyncTearDown(self):
        for p in self._patches:
            p.stop()
        await self.engine.dispose()

    def _draft_plan(self):
        return cp.QueryPlan(intent="INVENTORY_REBALANCING_QUERY", normalized="tao ban nhap",
                            required_tools=[{"name": "analyze_inventory_rebalancing",
                                             "args": {"destination_warehouses": ["Kho HCM"], "budget_vnd": 15000000}}],
                            style={"rebalance_draft": True})

    async def _draft(self):
        action, note = await rebalance_actions.plan_draft(self._draft_plan(), MANAGER, "Bearer t", self.conversation_id)
        self.assertIsNone(note)
        return action

    async def _confirm(self, user=None):
        self.user = user or MANAGER
        plan = cp.QueryPlan(intent="INVENTORY_REBALANCING_QUERY", style={"confirm_request": True})
        turn = {"plan": plan, "conversation": SimpleNamespace(id=1), "user_ctx": self.user,
                "conversation_id_str": self.conversation_id, "state": {}}
        request = SimpleNamespace(headers={"authorization": "Bearer t"}, client=SimpleNamespace(host="test"))
        return await main._confirm_rebalance_turn(request, turn)

    def _posts(self, path):
        return [json.loads(r.content) for r in self.sent if r.method == "POST" and r.url.path == path]

    async def test_confirm_creates_requests_through_the_confirm_route(self):
        action = await self._draft()
        self.assertEqual(action["type"], "CREATE_REBALANCE_DRAFT")
        payload = await self._confirm()
        self.assertEqual(payload["execution"]["status"], "EXECUTED")
        transfers = self._posts("/api/order-requests/transfer")
        self.assertEqual(len(transfers), 1)
        self.assertEqual(transfers[0]["from_warehouse_id"], DN)
        self.assertIn(f"[AI-REB:{action['id']}#T1]", transfers[0]["note"])
        self.assertEqual(len(self._posts("/api/purchase-requests")), 1)
        self.assertIn("TO-1", payload["answer"])
        self.assertIn("Kho Ha Noi", payload["answer"])  # the collaborative part is named, not executed
        # executed once: a second confirmation creates nothing
        again = await self._confirm()
        self.assertIsNone(again["execution"]["action_id"])
        self.assertEqual(len(self._posts("/api/order-requests/transfer")), 1)

    async def test_write_scope_revoked_while_pending_skips_that_part(self):
        await self._draft()
        self.writable = frozenset({HCM})  # DN revoked after the draft
        payload = await self._confirm()
        self.assertEqual(self._posts("/api/order-requests/transfer"), [])
        self.assertEqual(len(self._posts("/api/purchase-requests")), 1)
        self.assertTrue(any("thu hồi" in s["reason"] for s in payload["execution"]["result"]["skipped"]))

    async def test_scope_unavailable_writes_nothing(self):
        await self._draft()
        self.writable = warehouse_scope.ScopeUnavailable("down")
        payload = await self._confirm()
        self.assertEqual(payload["execution"]["status"], "FAILED")
        self.assertEqual([r for r in self.sent if r.method == "POST"], [])

    async def test_duplicate_tag_is_not_created_again(self):
        action = await self._draft()
        self.existing_transfers = [{"order_number": "TO-OLD", "status": "REQUESTED",
                                    "note": f"[AI-REB:{action['id']}#T1] earlier attempt"}]
        payload = await self._confirm()
        self.assertEqual(self._posts("/api/order-requests/transfer"), [])
        self.assertEqual(payload["execution"]["result"]["already_created"][0]["number"], "TO-OLD")

    async def test_stock_changed_is_reported_not_forced(self):
        await self._draft()
        self.transfer_reply = httpx.Response(409, json={"message": "Không đủ tồn kho", "error_code": "INSUFFICIENT_STOCK"})
        payload = await self._confirm()
        self.assertTrue(any("tồn khả dụng" in s["reason"] for s in payload["execution"]["result"]["skipped"]))

    async def test_unknown_outcome_goes_to_reconciliation(self):
        await self._draft()
        self.transfer_reply = httpx.ReadTimeout("timeout")
        payload = await self._confirm()
        self.assertEqual(payload["execution"]["status"], "RECONCILE_REQUIRED")

    async def test_another_users_draft_is_never_confirmed(self):
        await self._draft()
        payload = await self._confirm(user=OTHER)
        self.assertIsNone(payload["execution"]["action_id"])
        self.assertEqual([r for r in self.sent if r.method == "POST"], [])


class HistoryMaskingTests(unittest.TestCase):
    def test_stored_rebalancing_result_names_every_warehouse_it_shows(self):
        """A reopened conversation is masked when any warehouse it shows is no
        longer readable (warehouse_scope.can_view): the tool result must name
        the source, the destination and every diagnosed warehouse."""
        stored = {"analyze_inventory_rebalancing": {
            "scope": [{"warehouse_id": HCM}, {"warehouse_id": HN}],
            "diagnosis": [{"warehouse_id": DN}],
            "options": {"HYBRID": {"transfers": [{"from_warehouse_id": HN, "to_warehouse_id": HCM}]}}}}
        self.assertEqual(warehouse_scope.warehouse_ids_in(stored), {HCM, HN, DN})
        self.assertFalse(warehouse_scope.covered(warehouse_scope.warehouse_ids_in(stored), frozenset({HCM, DN})))


class DecisionAndTimelineTests(unittest.TestCase):
    def _result(self, covered, cost, budget):
        opt = {"label": "Kết hợp", "shortage_covered_pct": covered, "remaining_shortage_qty": 100 - covered,
               "remaining_high_priority_qty": 0, "purchase_cost_vnd": cost, "transfer_qty": 10, "purchase_qty": 5,
               "remaining_budget_vnd": budget - cost, "covered_qty": covered, "total_shortage_qty": 100, "risk_level": "LOW"}
        return {"source": "analytics/rebalancing-plan", "retrieved_at": "t", "budget_vnd": budget,
                "scope": [{"warehouse": "Kho HCM", "access": "WRITE"}], "diagnosis": [],
                "options": {"HYBRID": opt}, "recommendation": {"best_business_option": "HYBRID"}}

    def test_what_if_difference_is_computed_from_both_results(self):
        collected = {"analyze_inventory_rebalancing": self._result(90, 15e6, 15e6),
                     "analyze_inventory_rebalancing#2": self._result(70, 12e6, 12e6)}
        decision = rd.build(None, collected)
        self.assertEqual(decision["comparison"]["diff"]["shortage_covered_pct"], -20)
        self.assertEqual(decision["comparison"]["diff"]["purchase_cost_vnd"], -3e6)

    def test_timeline_reports_only_what_ran(self):
        ok = rd.timeline(None, {"analyze_inventory_rebalancing": self._result(90, 1, 2)}, {"status": "PASSED"})
        self.assertEqual({s["key"]: s["status"] for s in ok}["scenario"], "skipped")
        self.assertTrue(all(s["status"] == "done" for s in ok if s["key"] not in ("scenario",)))
        denied = rd.timeline(None, {"analyze_inventory_rebalancing": {"error": "x", "permission_denied": True}})
        status = {s["key"]: s["status"] for s in denied}
        self.assertEqual(status["permission"], "failed")
        self.assertEqual(status["transfer"], "skipped")
        self.assertEqual(rd.timeline(None, {"get_top_books": []}), [])


if __name__ == "__main__":
    unittest.main()
