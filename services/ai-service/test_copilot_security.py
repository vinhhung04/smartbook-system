"""Copilot 3.2 security regressions on the AI side. Each test asserts that no
data reaches the caller - not only the status code: authentication fails
closed, caches are partitioned by access, history is re-authorised on read,
and an AI action is re-validated when it is confirmed."""
from __future__ import annotations

import base64
import json
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import httpx
from fastapi import HTTPException

import action_guard
import agent_permissions
import copilot_tools
import main
import routes_conversations
import warehouse_scope
from agent_schemas import ConfirmActionRequest, PendingAction, UserContext
from main import AssistantRequest
from test_copilot_endpoints import FakeProvider, _request
from test_copilot_visualization import COMPARE, NOW, WAREHOUSES, FakeStoreWithData

HN, HCM = "w-hn", "w-hcm"
MANAGER = UserContext(user_id="11111111-1111-4111-8111-111111111111", username="m", roles=["WAREHOUSE_MANAGER"],
                      permissions=["analytics.read"], is_superuser=False)
NO_ASSISTANT = UserContext(user_id=MANAGER.user_id, username="m", roles=["WAREHOUSE_STAFF"], permissions=["inventory.task.read"],
                           is_superuser=False)
OTHER = UserContext(user_id="22222222-2222-4222-8222-222222222222", username="o", roles=["WAREHOUSE_MANAGER"],
                    permissions=["analytics.read"], is_superuser=False)
ADMIN = UserContext(user_id="admin-1", username="a", roles=["ADMIN"], permissions=[], is_superuser=True)
COMPARE_IDS = {**COMPARE, "ranking": [{**COMPARE["ranking"][0], "warehouse_id": HCM},
                                      {**COMPARE["ranking"][1], "warehouse_id": HN}]}


def _forged_superuser_token() -> str:
    def b64(obj):
        return base64.urlsafe_b64encode(json.dumps(obj).encode()).decode().rstrip("=")
    return f"Bearer {b64({'alg': 'none'})}.{b64({'sub': OTHER.user_id, 'roles': ['ADMIN'], 'is_superuser': True})}.x"


class AuthenticationFailsClosedTests(unittest.IsolatedAsyncioTestCase):
    async def _ctx(self, handler, header="Bearer t"):
        transport = httpx.MockTransport(handler)
        real = httpx.AsyncClient

        def client(*args, **kwargs):
            kwargs["transport"] = transport
            return real(*args, **kwargs)

        with patch("agent_permissions.httpx.AsyncClient", side_effect=client):
            return await agent_permissions.get_user_context(header)

    async def test_auth_unreachable_never_trusts_a_forged_token(self):
        def down(_request):
            raise httpx.ConnectError("auth down")

        with self.assertRaises(HTTPException) as err:
            await self._ctx(down, _forged_superuser_token())
        self.assertEqual(err.exception.status_code, 503)
        self.assertNotIn("is_superuser", str(err.exception.detail))

    async def test_auth_errors_are_unavailable_not_valid(self):
        for code in (502, 504, 429):
            with self.assertRaises(HTTPException) as err:
                await self._ctx(lambda r, c=code: httpx.Response(c))
            self.assertEqual(err.exception.status_code, 503)

    async def test_revoked_or_inactive_user_is_refused(self):
        with self.assertRaises(HTTPException) as err:
            await self._ctx(lambda r: httpx.Response(401, json={"message": "Token has been revoked"}))
        self.assertEqual(err.exception.status_code, 401)
        locked = {"user": {"id": "u", "status": "LOCKED", "roles": ["ADMIN"], "is_superuser": True}}
        with self.assertRaises(HTTPException) as err:
            await self._ctx(lambda r: httpx.Response(200, json=locked))
        self.assertEqual(err.exception.status_code, 401)

    async def test_unverifiable_revocation_is_carried_to_the_context(self):
        # Phase 5: auth-service answers GET /auth/me while Redis is down but marks it
        body = {"user": {"id": "u", "status": "ACTIVE", "roles": ["WAREHOUSE_MANAGER"]}}
        ctx = await self._ctx(lambda r: httpx.Response(200, json=body, headers={"X-Token-Revocation-Check": "unverified"}))
        self.assertFalse(ctx.revocation_verified)
        ctx = await self._ctx(lambda r: httpx.Response(200, json=body))
        self.assertTrue(ctx.revocation_verified)

    async def test_roles_come_from_the_live_auth_answer(self):
        body = {"user": {"id": "u", "status": "ACTIVE", "roles": ["WAREHOUSE_MANAGER"], "permissions": ["analytics.read"]}}
        ctx = await self._ctx(lambda r: httpx.Response(200, json=body))
        self.assertEqual((ctx.roles, ctx.is_superuser), (["WAREHOUSE_MANAGER"], False))

    async def test_a_revoked_user_reaches_no_tool(self):
        tool = AsyncMock(return_value={"ranking": []})
        with patch("main.rate_limiter.acquire", new=AsyncMock(return_value=(True, None))), \
                patch("main.get_user_context", new=AsyncMock(side_effect=HTTPException(401, "revoked"))), \
                patch.dict(main.TOOL_FUNCTIONS, {"compare_warehouses": tool}):
            with self.assertRaises(HTTPException) as err:
                await main.assistant(_request(), AssistantRequest(message="So sánh kho HCM và Hà Nội", conversation_id="r"))
        self.assertEqual(err.exception.status_code, 401)
        tool.assert_not_awaited()


class CachePartitionTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        copilot_tools._cache.clear()

    async def test_tool_cache_is_not_shared_across_access(self):
        answers = iter([{"rows": [HN, HCM]}, {"rows": [HN]}, {"rows": [HN]}])
        fake = AsyncMock(side_effect=lambda *a, **k: next(answers))
        with patch("copilot_tools._get", new=fake):
            copilot_tools.CACHE_PARTITION.set("before-revocation")
            first = await copilot_tools._cached_get("/analytics/warehouse-stock-risk", "Bearer same-token")
            copilot_tools.CACHE_PARTITION.set("after-revocation")  # same token, scope changed
            second = await copilot_tools._cached_get("/analytics/warehouse-stock-risk", "Bearer same-token")
            copilot_tools.CACHE_PARTITION.set(None)  # scope unreadable: never cached
            await copilot_tools._cached_get("/analytics/warehouse-stock-risk", "Bearer same-token")
        self.assertEqual(first["rows"], [HN, HCM])
        self.assertEqual(second["rows"], [HN])  # the pre-revocation result is not served
        self.assertEqual(fake.await_count, 3)
        copilot_tools.CACHE_PARTITION.set("")

    async def test_fingerprint_follows_permissions_and_scope(self):
        async def readable(user_ctx):
            return frozenset({HN, HCM}) if user_ctx.permissions == ["analytics.read"] else frozenset({HN})

        with patch("warehouse_scope.readable_warehouses", new=readable):
            a = await main._access_fingerprint(MANAGER)
            b = await main._access_fingerprint(UserContext(**{**MANAGER.model_dump(), "permissions": ["reports.read"]}))
        self.assertNotEqual(a, b)
        with patch("warehouse_scope.readable_warehouses", new=AsyncMock(side_effect=warehouse_scope.ScopeUnavailable())):
            self.assertIsNone(await main._access_fingerprint(MANAGER))


class StoredDataReauthorisationTests(unittest.IsolatedAsyncioTestCase):
    """Manager could read HN and HCM, asked, then lost access in different ways."""

    def setUp(self):
        self.store = FakeStoreWithData()
        self.provider = FakeProvider("Kho HCM Chinh rủi ro thiếu sách cao hơn Kho Ha Noi.")
        self.readable = frozenset({HN, HCM})
        self.user = MANAGER

        async def compare_warehouses(auth_header=None, warehouses=None):
            ranking = [r for r in COMPARE_IDS["ranking"] if r["warehouse_id"] in self.readable]
            return {**COMPARE_IDS, "ranking": ranking, "comparison": None if len(ranking) < 2 else COMPARE_IDS["comparison"]}

        async def readable(_user_ctx):
            return self.readable

        async def user(_header):
            return self.user

        main.assistant_response_cache.clear()
        copilot_tools._cache.clear()
        self._patches = [
            patch("main.rate_limiter.acquire", new=AsyncMock(return_value=(True, None))),
            patch("main.get_user_context", new=user),
            patch("routes_conversations.get_user_context", new=user),
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

    async def ask(self, message, cid="sec"):
        return (await main.assistant(_request(), AssistantRequest(message=message, conversation_id=cid))).model_dump()

    def _history(self, cid="sec", owner=MANAGER.user_id):
        rows = [SimpleNamespace(**{**vars(m), "created_at": NOW}) for m in self.store.messages if m.conversation_id == cid]
        conv = SimpleNamespace(conversation_id=cid, user_id=owner, title="t", status="ACTIVE", last_intent=None,
                               created_at=NOW, updated_at=NOW, last_message_at=NOW)
        return conv, rows

    async def test_masked_turns_carry_no_check_details(self):
        await self.ask("So sánh tình hình tồn kho Hà Nội và HCM bằng biểu đồ.")
        self.assertIn("verification", self.store.messages[-1].msg_metadata["extras"])
        self.readable = frozenset({HN})
        with patch("conversation_store.get_conversation_detail", new=AsyncMock(return_value=self._history())):
            body = await routes_conversations.get_conversation(_request(), "sec")
        masked = body["messages"][-1]
        dumped = json.dumps(masked, ensure_ascii=False)
        self.assertNotIn("HCM", dumped)
        self.assertNotIn("121", dumped)  # a figure of the revoked warehouse
        self.assertNotIn("verification", masked["extras"])
        self.assertNotIn("faithfulness", masked["extras"])

    async def test_a_reader_who_lost_the_assistant_sees_no_old_figures(self):
        await self.ask("So sánh tình hình tồn kho Hà Nội và HCM bằng biểu đồ.")
        self.user = NO_ASSISTANT  # role changed; same person, same conversation
        with patch("conversation_store.get_conversation_detail", new=AsyncMock(return_value=self._history())):
            body = await routes_conversations.get_conversation(_request(), "sec")
        answers = [m for m in body["messages"] if m["role"] == "assistant"]
        self.assertTrue(answers)
        for m in answers:
            self.assertEqual(m["content"], routes_conversations.NO_ACCESS_NOTICE)
            self.assertIsNone(m["data"])
        self.assertNotIn("Kho HCM Chinh", json.dumps(answers, ensure_ascii=False))
        self.assertEqual(body["messages"][0]["role"], "user")  # their own questions stay

    async def test_another_users_conversation_is_refused_without_content(self):
        await self.ask("So sánh tình hình tồn kho Hà Nội và HCM bằng biểu đồ.")
        self.user = OTHER
        with patch("conversation_store.get_conversation_detail", new=AsyncMock(return_value=self._history())):
            with self.assertRaises(HTTPException) as err:
                await routes_conversations.get_conversation(_request(), "sec")
        self.assertEqual(err.exception.status_code, 403)
        self.assertNotIn("HCM", str(err.exception.detail))

    async def test_superuser_reads_history_under_the_superuser_policy(self):
        await self.ask("So sánh tình hình tồn kho Hà Nội và HCM bằng biểu đồ.")
        self.user = ADMIN
        with patch("conversation_store.get_conversation_detail", new=AsyncMock(return_value=self._history())), \
                patch("warehouse_scope.readable_warehouses", new=AsyncMock(return_value=None)):
            body = await routes_conversations.get_conversation(_request(), "sec")
        self.assertIn("HCM", body["messages"][-1]["content"])

    async def test_cached_answer_is_not_served_after_a_permission_change(self):
        q = "So sánh tình hình tồn kho Hà Nội và HCM bằng biểu đồ."
        await self.ask(q, "pc")
        calls = len(self.provider.calls)
        await self.ask(q, "pc")
        self.assertEqual(len(self.provider.calls), calls)  # same access: served from the cache
        self.user = UserContext(**{**MANAGER.model_dump(), "permissions": ["reports.read"]})
        await self.ask(q, "pc")
        self.assertEqual(len(self.provider.calls), calls + 1)  # changed access: answered afresh

    async def test_scope_service_down_disables_the_cache(self):
        q = "So sánh tình hình tồn kho Hà Nội và HCM bằng biểu đồ."
        with patch("warehouse_scope.readable_warehouses", new=AsyncMock(side_effect=warehouse_scope.ScopeUnavailable())):
            await self.ask(q, "sd")
            calls = len(self.provider.calls)
            await self.ask(q, "sd")
        self.assertEqual(len(self.provider.calls), calls + 1)


def _action(payload, *, type_="CREATE_REORDER_DRAFT", owner=MANAGER.user_id):
    return PendingAction(id="a1", type=type_, status="PENDING_CONFIRMATION", summary="s", payload=payload, risk="MEDIUM",
                         requires_confirmation=True, allowed_roles=["WAREHOUSE_MANAGER", "ADMIN"], allowed_permissions=[],
                         created_from_message="m", created_at="2026-10-16T00:00:00", expires_at="2099-01-01T00:00:00",
                         created_by_user_id=owner)


REORDER_PAYLOAD = {"warehouse_id": HN, "items": [
    {"book_variant_id": "v1", "title": "Norwegian Wood", "suggested_quantity": 28, "warehouse_id": HN},
    {"book_variant_id": "v2", "title": "Tam Cam", "suggested_quantity": 8, "warehouse_id": HN}]}


class ActionConfirmationTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.executed = []
        self.claimed = AsyncMock(return_value=True)
        self.user = MANAGER
        self.writable = frozenset({HN})

        async def execute(action, auth_header, user_ctx):
            self.executed.append(action.payload)
            return {"success": True}

        async def user(_header):
            return self.user

        async def writable(_user_ctx):
            if isinstance(self.writable, Exception):
                raise self.writable
            return self.writable

        self._patches = [
            patch("main.cleanup_expired_actions", new=AsyncMock()),
            patch("main.get_user_context", new=user),
            patch("main.mark_action_confirmed", new=self.claimed),
            patch("main.mark_action_executed", new=AsyncMock()),
            patch("main.execute_agent_action", new=execute),
            patch("main.push_ai_action_event", new=AsyncMock()),
            patch("warehouse_scope.writable_warehouses", new=writable),
        ]
        for p in self._patches:
            p.start()

    def tearDown(self):
        for p in self._patches:
            p.stop()

    async def confirm(self, payload=REORDER_PAYLOAD, override=None, **kw):
        with patch("main.get_pending_action", new=AsyncMock(return_value=_action(payload, **kw))):
            return await main.confirm_action(_request(), ConfirmActionRequest(action_id="a1", override_payload=override))

    async def refused(self, code, **kw):
        with self.assertRaises(HTTPException) as err:
            await self.confirm(**kw)
        self.assertEqual(err.exception.status_code, code)
        self.assertEqual(self.executed, [])          # nothing ran
        self.claimed.assert_not_awaited()            # and the action is still pending

    async def test_legitimate_confirmation_with_an_edited_quantity(self):
        result = await self.confirm(override={"items": [{"book_variant_id": "v1", "title": "X", "suggested_quantity": 10,
                                                         "warehouse_id": HCM}]})
        self.assertEqual(result.status, "EXECUTED")
        line = self.executed[0]["items"][0]
        self.assertEqual((line["suggested_quantity"], line["title"], line["warehouse_id"]), (10, "Norwegian Wood", HN))

    async def test_override_cannot_change_the_proposal(self):
        await self.refused(400, override={"warehouse_resolution_status": "RESOLVED"})
        await self.refused(400, override={"items": [{"book_variant_id": "v-new", "suggested_quantity": 5}]})
        await self.refused(400, override={"items": [{"book_variant_id": "v1", "suggested_quantity": 0}]})
        await self.refused(400, override={"items": [{"book_variant_id": "v1", "suggested_quantity": 50000}]})
        await self.refused(400, override={"items": []})

    async def test_out_of_scope_warehouse_is_refused_at_confirm_time(self):
        await self.refused(403, override={"warehouse_id": HCM})
        self.writable = frozenset()  # write access revoked after the proposal
        await self.refused(403)

    async def test_scope_unreadable_keeps_the_action_pending(self):
        self.writable = warehouse_scope.ScopeUnavailable("auth down")
        await self.refused(503)

    async def test_unverifiable_session_cannot_confirm_and_the_action_stays_pending(self):
        self.user = self.user.model_copy(update={"revocation_verified": False})
        await self.refused(503)

    async def test_another_users_action_cannot_be_confirmed(self):
        self.user = OTHER
        await self.refused(403)

    async def test_superuser_may_confirm_any_warehouse(self):
        self.user = ADMIN
        self.writable = None
        result = await self.confirm(override={"warehouse_id": HCM})
        self.assertEqual(result.status, "EXECUTED")

    def test_target_warehouses_cover_per_line_ids(self):
        payload = {"warehouse_id": HN, "items": [{"warehouse_id": HCM}, {"title": "x"}]}
        self.assertEqual(action_guard.target_warehouses(payload), {HN, HCM})


if __name__ == "__main__":
    unittest.main()


class LegacyChatAuthTests(unittest.IsolatedAsyncioTestCase):
    """Phase 5: /chat and /chat/stream verify a presented token like /assistant
    instead of silently continuing as anonymous."""

    async def _chat(self, endpoint, auth_error=None, header="Bearer revoked"):
        classify = AsyncMock(side_effect=AssertionError("must not reach intent / retrieval / cache"))
        request = SimpleNamespace(headers={"authorization": header} if header else {}, client=SimpleNamespace(host="test"))
        ctx = AsyncMock(side_effect=auth_error) if auth_error else AsyncMock(return_value=None)
        with patch("main.rate_limiter.acquire", new=AsyncMock(return_value=(True, None))), \
                patch("main.get_user_context", new=ctx), patch("main.classify_user_message", new=classify), \
                patch.object(main.response_cache, "get", side_effect=AssertionError("cache read before auth")):
            await endpoint(request, main.ChatRequest(message="Tình hình tồn kho thế nào?"))

    async def test_a_revoked_token_gets_401_and_never_its_cached_answer(self):
        for endpoint in (main.chat, main.chat_stream):
            with self.assertRaises(HTTPException) as err:
                await self._chat(endpoint, HTTPException(401, "Token has been revoked"))
            self.assertEqual(err.exception.status_code, 401)

    async def test_auth_unreachable_is_503_not_anonymous(self):
        with self.assertRaises(HTTPException) as err:
            await self._chat(main.chat, HTTPException(503, "auth down"))
        self.assertEqual(err.exception.status_code, 503)

    async def test_no_header_stays_anonymous(self):
        self.assertIsNone(await main._legacy_chat_user(None))
