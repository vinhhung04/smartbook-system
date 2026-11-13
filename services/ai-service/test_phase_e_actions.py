"""Phase E: action lifecycle hardening.

- every /actions/* endpoint follows one session policy (require_verified_session):
  an unverified revocation check is refused on reads and writes alike;
- an EXECUTED action's stored result is never returned to someone who could
  not confirm the action (identity/ownership come before the replay);
- reconciliation: admin-only, note + evidence required, audit row with actor,
  roles, before/after status, note and evidence; never resolved twice, never
  re-executed by the resolution itself; the Action Center queue filters;
- reservation routing for multi-role accounts (agent_executor.reservation_route).

Real ai-service code throughout; the action store is in-memory SQLite and
get_user_context returns fixed users (auth-service is another process).
"""
from __future__ import annotations

import asyncio
import os
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

import agent_executor
import agent_store
import main
import routes_actions
from agent_executor import ActionOutcomeUnknown, reservation_route
from agent_schemas import CancelActionRequest, ConfirmActionRequest, UserContext
from db_models import ActionAuditLogRow, Base

OWNER = UserContext(user_id="u-owner", roles=["WAREHOUSE_MANAGER"],
                    permissions=["inventory.operation.decide", "inventory.purchase.request"])
OTHER = UserContext(user_id="u-other", roles=["WAREHOUSE_MANAGER"], permissions=["inventory.operation.decide"])
ADMIN = UserContext(user_id="u-admin", roles=["ADMIN"], permissions=[])
LIBRARIAN = UserContext(user_id="u-lib", roles=["LIBRARIAN"], permissions=["borrow.write"])
CUSTOMER = UserContext(user_id="u-cust", roles=["CUSTOMER"], permissions=["customer.self.write"])
UNVERIFIED_OWNER = OWNER.model_copy(update={"revocation_verified": False})
UNVERIFIED_ADMIN = ADMIN.model_copy(update={"revocation_verified": False})
TOKENS = {"Bearer owner": OWNER, "Bearer other": OTHER, "Bearer admin": ADMIN, "Bearer lib": LIBRARIAN,
          "Bearer cust": CUSTOMER, "Bearer owner-unverified": UNVERIFIED_OWNER,
          "Bearer admin-unverified": UNVERIFIED_ADMIN}


def _request(token: str, **query) -> SimpleNamespace:
    return SimpleNamespace(headers={"authorization": token}, client=SimpleNamespace(host="gw"), query_params=query)


class PhaseEActionTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        # A file, not :memory: + StaticPool: concurrent sessions must get separate
        # connections, or one session's rollback discards another's work.
        self.tmp = tempfile.TemporaryDirectory()
        self.engine = create_async_engine(f"sqlite+aiosqlite:///{os.path.join(self.tmp.name, 'actions.db')}",
                                          connect_args={"timeout": 30})
        async with self.engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        sessions = async_sessionmaker(self.engine, expire_on_commit=False)
        self.sessions = sessions
        self.executor = AsyncMock(return_value={"success": True, "mode": "real_api"})
        users = AsyncMock(side_effect=lambda h: TOKENS[h])
        self._patches = [
            patch.object(agent_store, "get_session", lambda: sessions()),
            patch.object(routes_actions, "get_session", lambda: sessions()),
            patch("main.get_user_context", new=users),
            patch("routes_actions.get_user_context", new=users),
            patch("main.action_guard.require_write_scope", new=AsyncMock(return_value=None)),
            patch("main.execute_agent_action", new=self.executor),
            patch("main.push_ai_action_event", new=AsyncMock()),
        ]
        for p in self._patches:
            p.start()

    async def asyncTearDown(self):
        for p in self._patches:
            p.stop()
        await self.engine.dispose()
        self.tmp.cleanup()

    async def _action(self, action_type="CREATE_STAFF_TASK_DRAFT", user=OWNER):
        return await agent_store.create_pending_action(
            action_type=action_type, summary="s", payload={}, risk="MEDIUM", user_context=user)

    async def _confirm(self, action_id, token="Bearer owner", confirm=True):
        return await main.confirm_action(_request(token), ConfirmActionRequest(action_id=action_id, confirm=confirm))

    async def _reconcile_required(self):
        action = await self._action()
        self.executor.side_effect = ActionOutcomeUnknown("timeout")
        with self.assertRaises(HTTPException):
            await self._confirm(action.id)
        self.executor.side_effect = None
        self.assertEqual((await agent_store.get_pending_action(action.id)).status, "RECONCILE_REQUIRED")
        return action

    def _reconcile(self, action_id, token="Bearer admin", outcome="EXECUTED", note="đã thấy bản ghi TSK-1 trong kho",
                   evidence="TSK-1"):
        return main.reconcile_action(_request(token), main.ReconcileActionRequest(
            action_id=action_id, outcome=outcome, note=note, evidence_reference=evidence))

    async def _list(self, token="Bearer admin", **filters):
        params = {"status": None, "limit": 50, "offset": 0, "conversation_id": None, "mine": False, "type": None,
                  "created_by": None, "created_from": None, "created_to": None, **filters}
        return await routes_actions.list_actions(_request(token), **params)

    # -- one session policy ------------------------------------------------------

    async def test_unverified_revocation_is_refused_on_every_action_endpoint(self):
        action = await self._action()
        calls = {
            "confirm": lambda: self._confirm(action.id, "Bearer owner-unverified"),
            "cancel-via-confirm": lambda: self._confirm(action.id, "Bearer owner-unverified", confirm=False),
            "cancel": lambda: main.cancel_action(_request("Bearer owner-unverified"),
                                                 CancelActionRequest(action_id=action.id)),
            "pending": lambda: main.get_action(_request("Bearer owner-unverified"), action.id),
            "reconcile": lambda: self._reconcile(action.id, token="Bearer admin-unverified"),
            "stats": lambda: main.actions_stats(_request("Bearer admin-unverified")),
            "list": lambda: self._list(token="Bearer admin-unverified"),
            "detail": lambda: routes_actions.get_action_detail(_request("Bearer admin-unverified"), action.id),
        }
        for name, call in calls.items():
            with self.subTest(endpoint=name):
                with self.assertRaises(HTTPException) as refused:
                    await call()
                self.assertEqual(refused.exception.status_code, 503)
        # nothing changed: the action is still waiting for its owner
        self.assertEqual((await agent_store.get_pending_action(action.id)).status, "PENDING_CONFIRMATION")

    async def test_executed_result_is_not_replayed_to_another_user(self):
        action = await self._action()
        self.executor.return_value = {"success": True, "secret": "purchase request PR-42"}
        await self._confirm(action.id)
        with self.assertRaises(HTTPException) as other:
            await self._confirm(action.id, "Bearer other")
        self.assertEqual(other.exception.status_code, 403)
        replay = await self._confirm(action.id)  # the owner still gets the idempotent replay
        self.assertEqual(replay.status, "EXECUTED")
        self.assertEqual(self.executor.await_count, 1)

    # -- state machine -------------------------------------------------------------

    async def test_cancelled_action_is_never_executed_and_executed_is_never_cancelled(self):
        cancelled = await self._action()
        await self._confirm(cancelled.id, confirm=False)
        with self.assertRaises(HTTPException):
            await self._confirm(cancelled.id)
        executed = await self._action()
        await self._confirm(executed.id)
        with self.assertRaises(HTTPException) as late_cancel:
            await main.cancel_action(_request("Bearer owner"), CancelActionRequest(action_id=executed.id))
        self.assertEqual(late_cancel.exception.status_code, 409)
        self.assertEqual(self.executor.await_count, 1)

    async def test_reconcile_required_is_never_confirmed_again(self):
        action = await self._reconcile_required()
        with self.assertRaises(HTTPException) as again:
            await self._confirm(action.id)
        self.assertEqual(again.exception.status_code, 409)
        self.assertEqual(self.executor.await_count, 1)

    async def test_stale_confirmed_is_released_when_the_queue_is_listed(self):
        action = await self._action()
        await agent_store.mark_action_confirmed(action.id, actor_user_id=OWNER.user_id)
        with patch.object(agent_store, "STALE_CONFIRMED_SECONDS", 0), \
                patch("routes_actions.release_stale_confirmed_actions",
                      new=lambda: agent_store.release_stale_confirmed_actions(max_age_seconds=0)):
            await asyncio.sleep(0.01)
            listed = await self._list(status="RECONCILE_REQUIRED")
        self.assertEqual([item["id"] for item in listed["items"]], [action.id])

    # -- reconciliation -------------------------------------------------------------

    async def test_reconciliation_requires_admin_note_and_evidence(self):
        action = await self._reconcile_required()
        cases = {
            "librarian": (dict(token="Bearer lib"), 403),
            "customer": (dict(token="Bearer cust"), 403),
            "owner (manager)": (dict(token="Bearer owner"), 403),
            "empty note": (dict(note="   "), 400),
            "short note": (dict(note="ok"), 400),
            "executed without evidence": (dict(evidence=None), 400),
        }
        for name, (kwargs, status) in cases.items():
            with self.subTest(case=name):
                with self.assertRaises(HTTPException) as refused:
                    await self._reconcile(action.id, **kwargs)
                self.assertEqual(refused.exception.status_code, status)
        self.assertEqual((await agent_store.get_pending_action(action.id)).status, "RECONCILE_REQUIRED")

    async def test_reconciliation_audit_and_single_resolution(self):
        action = await self._reconcile_required()
        results = await asyncio.gather(self._reconcile(action.id), self._reconcile(action.id), return_exceptions=True)
        ok = [r for r in results if isinstance(r, dict)]
        refused = [r for r in results if isinstance(r, HTTPException)]
        self.assertEqual((len(ok), [r.status_code for r in refused]), (1, [409]))
        async with self.sessions() as session:
            row = (await session.execute(select(ActionAuditLogRow).where(
                ActionAuditLogRow.action_id == action.id, ActionAuditLogRow.event_type == "RECONCILED"))).scalars().one()
        self.assertEqual((row.actor_user_id, row.actor_roles, row.old_status, row.new_status),
                         ("u-admin", ["ADMIN"], "RECONCILE_REQUIRED", "EXECUTED"))
        self.assertEqual(row.event_metadata["evidence_reference"], "TSK-1")
        self.assertIn("TSK-1", row.event_metadata["reconciliation_note"])
        self.assertIsNotNone(row.created_at)
        with self.assertRaises(HTTPException) as again:  # a terminal state is never reconciled again
            await self._reconcile(action.id, outcome="FAILED", evidence=None)
        self.assertEqual(again.exception.status_code, 409)

    async def test_failed_resolution_does_not_execute_again(self):
        action = await self._reconcile_required()
        await self._reconcile(action.id, outcome="FAILED", note="không có bản ghi nào trong kho", evidence=None)
        self.assertEqual((await agent_store.get_pending_action(action.id)).status, "FAILED")
        self.assertEqual(self.executor.await_count, 1)  # resolving never re-runs the action

    async def test_reconcile_queue_filters_and_scope(self):
        mine = await self._reconcile_required()
        await self._action("CREATE_REPORT_DRAFT")
        queue = await self._list(status="RECONCILE_REQUIRED", type="CREATE_STAFF_TASK_DRAFT", created_by="u-owner")
        self.assertEqual(([i["id"] for i in queue["items"]], queue["total"]), ([mine.id], 1))
        self.assertTrue(queue["items"][0]["error_message"])
        none = await self._list(status="RECONCILE_REQUIRED", created_from="2999-01-01T00:00:00")
        self.assertEqual(none["total"], 0)
        # a non-admin asking for everyone still only sees their own
        other = await self._list(token="Bearer other", status="RECONCILE_REQUIRED", created_by="u-owner")
        self.assertEqual(other["total"], 0)
        with self.assertRaises(HTTPException) as bad:
            await self._list(created_from="yesterday")
        self.assertEqual(bad.exception.status_code, 400)
        with self.assertRaises(HTTPException) as forbidden:
            await routes_actions.get_action_detail(_request("Bearer cust"), mine.id)
        self.assertEqual(forbidden.exception.status_code, 403)


class ReservationRouteTest(unittest.TestCase):
    """Who a reservation is created for, by account (agent_executor.reservation_route)."""

    BORROW = ["borrow.write"]
    READER = ["customer.self.read", "customer.self.write"]

    def _route(self, roles, perms, payload=None, superuser=False):
        user = UserContext(user_id="u", roles=roles, permissions=perms, is_superuser=superuser)
        return reservation_route(user, payload or {})

    def test_routes(self):
        for_customer = {"customer_id": "c-9"}
        cases = [
            ("CUSTOMER", ["CUSTOMER"], self.READER, {}, "self"),
            ("CUSTOMER with a stray customer_id", ["CUSTOMER"], self.READER, for_customer, "self"),
            ("LIBRARIAN for a customer", ["LIBRARIAN"], self.BORROW, for_customer, "staff"),
            ("LIBRARIAN, no customer", ["LIBRARIAN"], self.BORROW, {}, "draft_only"),
            ("ADMIN for a customer", ["ADMIN"], self.BORROW, for_customer, "staff"),
            ("CUSTOMER+LIBRARIAN, no customer", ["CUSTOMER", "LIBRARIAN"], self.READER + self.BORROW, {}, "draft_only"),
            ("CUSTOMER+LIBRARIAN for a customer", ["CUSTOMER", "LIBRARIAN"], self.READER + self.BORROW, for_customer,
             "staff"),
            ("CUSTOMER+ADMIN, no customer", ["CUSTOMER", "ADMIN"], self.READER + self.BORROW, {}, "draft_only"),
            ("superuser for a customer", [], [], for_customer, "staff"),
        ]
        for name, roles, perms, payload, expected in cases:
            with self.subTest(name):
                self.assertEqual(self._route(roles, perms, payload, superuser=name.startswith("superuser")), expected)

    def test_refusals(self):
        cases = [
            ("no role, no permission", [], []),
            ("CUSTOMER role without the reader permission", ["CUSTOMER"], []),
            ("LIBRARIAN role without borrow permission, for a customer", ["LIBRARIAN"], []),
            ("WAREHOUSE_STAFF for a customer", ["WAREHOUSE_STAFF"], ["inventory.purchase.request"]),
            ("CUSTOMER+WAREHOUSE_STAFF for a customer", ["CUSTOMER", "WAREHOUSE_STAFF"], self.READER),
        ]
        for name, roles, perms in cases:
            with self.subTest(name):
                payload = {"customer_id": "c-9"} if "customer" in name.split(", ")[-1] else {}
                with self.assertRaises(HTTPException) as refused:
                    self._route(roles, perms, payload)
                self.assertEqual(refused.exception.status_code, 403)

    def test_executor_never_sends_staff_plus_customer_to_the_self_route(self):
        sent = []

        async def run():
            action = SimpleNamespace(id="act_1", payload={"variant_id": "v", "warehouse_id": "w"})
            user = UserContext(user_id="u", roles=["CUSTOMER", "LIBRARIAN"], permissions=self.READER + self.BORROW)
            with patch.object(agent_executor.httpx, "AsyncClient", side_effect=lambda *a, **k: sent.append(1)):
                return await agent_executor._exec_reservation(action, "Bearer x", user)

        result = asyncio.run(run())
        self.assertEqual((result["mode"], sent), ("draft_only", []))


class ReservationDraftCatalogTest(unittest.IsolatedAsyncioTestCase):
    """A chat 'Đặt giúp tôi cuốn X' (RESERVATION_QUERY: retrieval brings analytics,
    no catalog) still resolves X to a reservable variant + warehouse, with the
    user's own token, so the confirmed draft can become a real reservation."""

    async def test_reservation_draft_resolves_the_book_from_the_catalog(self):
        import httpx
        import agent_planner
        seen = []

        def handler(request):
            seen.append(request)
            if request.url.path == "/public/catalog/branches":
                return httpx.Response(200, json={"data": [{"id": "branch-1"}, {"id": "branch-2"}]})
            loc = lambda w, q, **k: {"warehouse_id": w, "available_quantity": q, **k}  # noqa: E731
            return httpx.Response(200, json={"data": [
                {"id": "b2", "title": "Mắt Biếc - bản đặc biệt", "variant_id": "v2", "default_warehouse_id": "w2"},
                # central warehouse has the most copies, but readers can only pick up at a branch
                {"id": "b1", "title": "Mắt Biếc", "variant_id": "v1", "default_warehouse_id": "central",
                 "locations": [loc("central", 15), loc("branch-1", 2), loc("branch-2", 4),
                               loc("branch-2", 9, is_receiving=True)]},
                {"id": "b3", "title": "Mắt Biếc", "variant_id": "v3", "reservable": False},
            ]})

        real = httpx.AsyncClient
        with patch.object(agent_planner.httpx, "AsyncClient", lambda *a, **k: real(*a, transport=httpx.MockTransport(handler), **k)):
            planned = await agent_planner.plan_agent_action(
                "Đặt giúp tôi cuốn Mắt Biếc",
                {"intent": "RESERVATION_QUERY", "entities": {"book_title": "Mắt Biếc"}},
                {"raw": {"Reservation Funnel": {}}, "sources": []}, CUSTOMER, auth_header="Bearer cust")
        self.assertEqual((planned["payload"]["variant_id"], planned["payload"]["warehouse_id"]), ("v1", "branch-2"))
        self.assertFalse(planned["requires_review"])
        self.assertEqual(seen[0].headers["Authorization"], "Bearer cust")
        self.assertNotIn("Authorization", seen[1].headers)  # the branch list is public

    async def test_unknown_book_stays_a_draft(self):
        import httpx
        import agent_planner
        real = httpx.AsyncClient
        with patch.object(agent_planner.httpx, "AsyncClient",
                          lambda *a, **k: real(*a, transport=httpx.MockTransport(lambda r: httpx.Response(200, json={"data": []})), **k)):
            planned = await agent_planner.plan_agent_action(
                "Đặt giúp tôi cuốn Không Có", {"intent": "RESERVATION_QUERY", "entities": {"book_title": "Không Có"}},
                {"raw": {}, "sources": []}, CUSTOMER, auth_header="Bearer cust")
        self.assertIsNone(planned["payload"]["variant_id"])
        self.assertTrue(planned["requires_review"])


if __name__ == "__main__":
    unittest.main()
