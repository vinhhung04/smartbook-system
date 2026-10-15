"""Stored copilot data under the user's CURRENT warehouse scope: a manager whose
access to a warehouse is revoked does not get that warehouse's figures back
through a reopened conversation, a chart follow-up or the answer cache."""
from __future__ import annotations

import json
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import httpx

import main
import routes_conversations
import warehouse_scope
from agent_schemas import UserContext
from main import AssistantRequest
from test_copilot_visualization import COMPARE, NOW, WAREHOUSES, FakeStoreWithData
from test_copilot_endpoints import FakeProvider, _request

HN = "w-hn"
HCM = "w-hcm"
MANAGER = UserContext(user_id="11111111-1111-4111-8111-111111111111", username="m", roles=["WAREHOUSE_MANAGER"],
                      permissions=["analytics.read"], is_superuser=False)
COMPARE_IDS = {**COMPARE, "ranking": [{**COMPARE["ranking"][0], "warehouse_id": HCM},
                                      {**COMPARE["ranking"][1], "warehouse_id": HN}]}


class ScopeHelpersTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        warehouse_scope.clear_cache()

    def test_warehouse_ids_are_found_at_any_depth(self):
        data = {"compare_warehouses": COMPARE_IDS, "x": [{"nested": {"to_warehouse_id": "w-dn"}}]}
        self.assertEqual(warehouse_scope.warehouse_ids_in(data), {HN, HCM, "w-dn"})
        self.assertEqual(warehouse_scope.warehouse_ids_in({"get_borrow_trends": [{"loans": 1}]}), set())

    def test_covered(self):
        self.assertTrue(warehouse_scope.covered(set(), frozenset()))
        self.assertTrue(warehouse_scope.covered({HN}, None))  # superuser
        self.assertTrue(warehouse_scope.covered({HN}, frozenset({HN, HCM})))
        self.assertFalse(warehouse_scope.covered({HN, HCM}, frozenset({HN})))

    async def _readable(self, handler, user=MANAGER):
        transport = httpx.MockTransport(handler)
        async with httpx.AsyncClient(transport=transport) as client:
            with patch.dict("os.environ", {"INTERNAL_SERVICE_KEY": "k"}):
                return await warehouse_scope.readable_warehouses(user, client=client)

    async def test_scope_is_read_from_auth_with_the_internal_key(self):
        seen = {}

        def handler(request):
            seen["url"], seen["key"] = str(request.url), request.headers.get("x-internal-service-key")
            return httpx.Response(200, json={"data": {"status": "ACTIVE", "is_superuser": False, "scopes": [
                {"warehouse_id": HN, "access_level": "READ"}, {"warehouse_id": HCM, "access_level": "NONE"}]}})

        self.assertEqual(await self._readable(handler), frozenset({HN}))
        self.assertTrue(seen["url"].endswith(f"/internal/users/{MANAGER.user_id}/warehouse-scopes"))
        self.assertEqual(seen["key"], "k")

    async def test_fail_closed(self):
        with self.assertRaises(warehouse_scope.ScopeUnavailable):
            await self._readable(lambda r: httpx.Response(500))
        warehouse_scope.clear_cache()
        self.assertEqual(await self._readable(lambda r: httpx.Response(404)), frozenset())
        warehouse_scope.clear_cache()
        locked = {"data": {"status": "LOCKED", "scopes": [{"warehouse_id": HN, "access_level": "FULL"}]}}
        self.assertEqual(await self._readable(lambda r: httpx.Response(200, json=locked)), frozenset())
        with patch.dict("os.environ", {"INTERNAL_SERVICE_KEY": ""}):
            warehouse_scope.clear_cache()
            with self.assertRaises(warehouse_scope.ScopeUnavailable):
                await warehouse_scope.readable_warehouses(MANAGER)
        # can_view turns "unavailable" into "not viewable" for warehouse data only
        with patch("warehouse_scope.readable_warehouses", new=AsyncMock(side_effect=warehouse_scope.ScopeUnavailable())):
            self.assertFalse(await warehouse_scope.can_view(MANAGER, {HN}))
            self.assertTrue(await warehouse_scope.can_view(MANAGER, set()))


class RevokedScopeTests(unittest.IsolatedAsyncioTestCase):
    """Manager A could read HN and HCM, asked for a chart, then lost HCM."""

    def setUp(self):
        self.store = FakeStoreWithData()
        self.provider = FakeProvider("Kho HCM Chinh rủi ro thiếu sách cao hơn Kho Ha Noi.")
        self.readable = frozenset({HN, HCM})
        self.tool_calls = 0

        async def compare_warehouses(auth_header=None, warehouses=None):
            self.tool_calls += 1
            # The analytics API filters by the CURRENT scope - emulate it.
            ranking = [r for r in COMPARE_IDS["ranking"] if r["warehouse_id"] in self.readable]
            return {**COMPARE_IDS, "ranking": ranking, "comparison": None if len(ranking) < 2 else COMPARE_IDS["comparison"]}

        async def readable(_user_ctx):
            return self.readable

        main.assistant_response_cache.clear()
        self._patches = [
            patch("main.rate_limiter.acquire", new=AsyncMock(return_value=(True, None))),
            patch("main.get_user_context", new=AsyncMock(return_value=MANAGER)),
            patch("routes_conversations.get_user_context", new=AsyncMock(return_value=MANAGER)),
            patch("main.conversation_store.get_or_create_conversation", new=self.store.get_or_create_conversation),
            patch("main.conversation_store.append_message", new=self.store.append_message),
            patch("main.conversation_store.get_recent_messages", new=self.store.get_recent_messages),
            patch("main.copilot_tools._warehouses", new=AsyncMock(return_value=WAREHOUSES)),
            patch("main._get_assistant_provider", return_value=self.provider),
            patch("warehouse_scope.readable_warehouses", new=readable),
            patch.dict(main.TOOL_FUNCTIONS, {"compare_warehouses": compare_warehouses}),
        ]
        for p in self._patches:
            p.start()

    def tearDown(self):
        for p in self._patches:
            p.stop()

    async def ask(self, message, cid="rv"):
        return (await main.assistant(_request(), AssistantRequest(message=message, conversation_id=cid))).model_dump()

    def _history(self, cid="rv"):
        rows = [SimpleNamespace(**{**vars(m), "created_at": NOW}) for m in self.store.messages if m.conversation_id == cid]
        conv = SimpleNamespace(conversation_id=cid, user_id=MANAGER.user_id, title="t", status="ACTIVE", last_intent=None,
                               created_at=NOW, updated_at=NOW, last_message_at=NOW)
        return conv, rows

    async def test_history_is_masked_after_revocation_and_shown_while_allowed(self):
        await self.ask("So sánh tình hình tồn kho Hà Nội và HCM bằng biểu đồ.")
        self.assertEqual(sorted(self.store.messages[-1].msg_metadata["warehouse_ids"]), [HCM, HN])
        with patch("conversation_store.get_conversation_detail", new=AsyncMock(return_value=self._history())):
            before = await routes_conversations.get_conversation(_request(), "rv")
            self.readable = frozenset({HN})  # HCM revoked
            after = await routes_conversations.get_conversation(_request(), "rv")
        shown, masked = before["messages"][-1], after["messages"][-1]
        self.assertTrue(shown["extras"]["visualizations"])
        self.assertIn("HCM", shown["content"])
        self.assertEqual(masked["extras"]["visualizations"], [])
        self.assertIsNone(masked["data"])
        self.assertNotIn("HCM", json.dumps(masked, ensure_ascii=False))
        self.assertTrue(masked["extras"]["withheld"])
        # the stored row itself is untouched
        self.assertIn("HCM", self.store.messages[-1].content)

    async def test_chart_follow_up_does_not_reuse_a_snapshot_with_a_revoked_warehouse(self):
        await self.ask("So sánh tình hình tồn kho Hà Nội và HCM bằng biểu đồ.")
        calls = self.tool_calls
        self.readable = frozenset({HN})
        body = await self.ask("Đổi sang dạng bảng")
        self.assertEqual(self.tool_calls, calls + 1)  # re-read through the tool, not the snapshot
        self.assertNotIn("Kho HCM Chinh", json.dumps(body["visualizations"], ensure_ascii=False))
        self.assertNotIn(HCM, json.dumps(body["data"]))

    async def test_cached_answer_is_not_served_after_revocation(self):
        q = "So sánh tình hình tồn kho Hà Nội và HCM bằng biểu đồ."
        await self.ask(q, "rc")
        self.readable = frozenset({HN})
        llm_calls = len(self.provider.calls)
        body = await self.ask(q, "rc")
        self.assertEqual(len(self.provider.calls), llm_calls + 1)  # answered afresh, not from cache
        self.assertNotIn(HCM, json.dumps(body["data"]))

    async def test_scope_unavailable_withholds_warehouse_history(self):
        await self.ask("So sánh tình hình tồn kho Hà Nội và HCM bằng biểu đồ.")

        async def down(_user_ctx):
            raise warehouse_scope.ScopeUnavailable("auth down")

        with patch("warehouse_scope.readable_warehouses", new=down), \
                patch("conversation_store.get_conversation_detail", new=AsyncMock(return_value=self._history())):
            body = await routes_conversations.get_conversation(_request(), "rv")
        self.assertEqual(body["messages"][-1]["content"], warehouse_scope.UNVERIFIED_NOTICE)
        self.assertEqual(body["messages"][0]["role"], "user")  # questions themselves stay visible


if __name__ == "__main__":
    unittest.main()
