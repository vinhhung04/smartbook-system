"""Action lifecycle through the real /actions/confirm handler and agent_store,
on an in-memory SQLite DB (same approach as test_agent_store.py). Only the
outside world is faked: the user's identity (auth-service), the warehouse
scope check and the executor's target service.

Lifecycle under test:
    PENDING_CONFIRMATION -> CONFIRMED -> EXECUTED
    PENDING_CONFIRMATION -> CANCELLED | EXPIRED
    CONFIRMED -> FAILED              target refused (4xx): nothing written, may be confirmed again
    CONFIRMED -> RECONCILE_REQUIRED  outcome unknown and the type is not retry-safe
    RECONCILE_REQUIRED -> EXECUTED | FAILED   POST /actions/reconcile (admin)
"""
from __future__ import annotations

import asyncio
import unittest
from datetime import timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from fastapi import HTTPException
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

import agent_store
import main
from agent_executor import ActionOutcomeUnknown
from agent_schemas import ConfirmActionRequest, UserContext
from db_models import ActionAuditLogRow, Base, PendingActionRow

# permissions as the auth seed grants them to WAREHOUSE_MANAGER / CUSTOMER
OWNER = UserContext(user_id="u-owner", roles=["WAREHOUSE_MANAGER"],
                    permissions=["inventory.operation.decide", "inventory.purchase.request"])
OTHER = UserContext(user_id="u-other", roles=["WAREHOUSE_MANAGER"], permissions=["inventory.operation.decide"])
ADMIN = UserContext(user_id="u-admin", roles=["ADMIN"], permissions=[])
CUSTOMER = UserContext(user_id="u-cust", roles=["CUSTOMER"], permissions=["customer.self.write"])
TOKENS = {"Bearer owner": OWNER, "Bearer other": OTHER, "Bearer admin": ADMIN, "Bearer cust": CUSTOMER}


def _request(token: str) -> SimpleNamespace:
    return SimpleNamespace(headers={"authorization": token}, client=SimpleNamespace(host="gw"))


class ActionLifecycleTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.engine = create_async_engine("sqlite+aiosqlite:///:memory:",
                                          connect_args={"check_same_thread": False}, poolclass=StaticPool)
        async with self.engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        sessions = async_sessionmaker(self.engine, expire_on_commit=False)
        self.executor = AsyncMock(return_value={"success": True, "mode": "real_api"})
        self._patches = [
            patch.object(agent_store, "get_session", lambda: sessions()),
            patch("main.get_user_context", new=AsyncMock(side_effect=lambda h: TOKENS[h])),
            patch("main.action_guard.require_write_scope", new=AsyncMock(return_value=None)),
            patch("main.execute_agent_action", new=self.executor),
            patch("main.push_ai_action_event", new=AsyncMock()),
        ]
        for p in self._patches:
            p.start()
        self.sessions = sessions

    async def asyncTearDown(self):
        for p in self._patches:
            p.stop()
        await self.engine.dispose()

    async def _action(self, action_type="CREATE_STAFF_TASK_DRAFT", user=OWNER, payload=None):
        return await agent_store.create_pending_action(
            action_type=action_type, summary="s", payload=payload or {}, risk="MEDIUM", user_context=user)

    async def _status(self, action_id):
        return (await agent_store.get_pending_action(action_id)).status

    async def _events(self, action_id):
        async with self.sessions() as session:
            rows = (await session.execute(select(ActionAuditLogRow).where(ActionAuditLogRow.action_id == action_id)
                                          .order_by(ActionAuditLogRow.created_at.asc()))).scalars().all()
        return [r.event_type for r in rows]

    async def _confirm(self, action_id, token="Bearer owner", override=None):
        return await main.confirm_action(_request(token), ConfirmActionRequest(action_id=action_id, override_payload=override))

    # -- happy path and refusals ------------------------------------------------

    async def test_executed_records_actor_and_audit(self):
        action = await self._action()
        resp = await self._confirm(action.id)
        self.assertEqual((resp.status, resp.success), ("EXECUTED", True))
        async with self.sessions() as session:
            row = (await session.execute(select(PendingActionRow).where(PendingActionRow.action_id == action.id))).scalar_one()
        self.assertEqual(row.confirmed_by_user_id, OWNER.user_id)
        self.assertIsNotNone(row.confirmed_at)
        self.assertEqual(await self._events(action.id), ["CREATED", "CONFIRMED", "EXECUTED"])

    async def test_target_refusal_marks_failed_and_can_be_confirmed_again(self):
        action = await self._action()
        self.executor.side_effect = HTTPException(status_code=422, detail="assignee is not in this warehouse")
        with self.assertRaises(HTTPException) as refused:
            await self._confirm(action.id)
        self.assertEqual(refused.exception.status_code, 422)
        self.assertEqual(await self._status(action.id), "FAILED")  # no longer stuck in CONFIRMED

        self.executor.side_effect = None
        resp = await self._confirm(action.id)  # nothing was written, so a retry is safe
        self.assertEqual(resp.status, "EXECUTED")
        self.assertEqual(await self._events(action.id), ["CREATED", "CONFIRMED", "FAILED", "CONFIRMED", "EXECUTED"])

    # -- unknown outcome --------------------------------------------------------

    async def test_unknown_outcome_of_a_non_idempotent_action_needs_reconciliation(self):
        action = await self._action("CREATE_STAFF_TASK_DRAFT")
        self.executor.side_effect = ActionOutcomeUnknown("timeout")
        with self.assertRaises(HTTPException) as unknown:
            await self._confirm(action.id)
        self.assertEqual(unknown.exception.status_code, 502)
        self.assertEqual(await self._status(action.id), "RECONCILE_REQUIRED")

        # never executed a second time, by the same or another click
        self.executor.side_effect = None
        with self.assertRaises(HTTPException) as again:
            await self._confirm(action.id)
        self.assertEqual(again.exception.status_code, 409)
        self.assertEqual(self.executor.await_count, 1)

    async def test_unknown_outcome_of_a_retry_safe_action_can_be_confirmed_again(self):
        action = await self._action("CREATE_RESERVATION_DRAFT", user=CUSTOMER,
                                    payload={"variant_id": "v1", "warehouse_id": "w1"})
        self.executor.side_effect = ActionOutcomeUnknown("connection reset")
        with self.assertRaises(HTTPException):
            await self._confirm(action.id, token="Bearer cust")
        self.assertEqual(await self._status(action.id), "FAILED")
        self.executor.side_effect = None
        resp = await self._confirm(action.id, token="Bearer cust")  # same Idempotency-Key downstream
        self.assertEqual(resp.status, "EXECUTED")

    async def test_unexpected_error_mid_execution_is_treated_as_unknown(self):
        action = await self._action("CREATE_STAFF_TASK_DRAFT")
        self.executor.side_effect = KeyError("data")
        with self.assertRaises(HTTPException):
            await self._confirm(action.id)
        self.assertEqual(await self._status(action.id), "RECONCILE_REQUIRED")

    async def test_multi_line_result_with_unknown_lines_needs_reconciliation(self):
        action = await self._action("CREATE_REORDER_DRAFT")
        self.executor.return_value = {"success": True, "mode": "partial", "needs_reconciliation": True,
                                      "failed_items": [{"title": "A", "outcome": "unknown"}]}
        resp = await self._confirm(action.id)
        self.assertEqual((resp.status, resp.success), ("RECONCILE_REQUIRED", False))
        self.assertEqual(await self._status(action.id), "RECONCILE_REQUIRED")

    async def test_reconcile_is_admin_only_and_resolves_to_a_terminal_state(self):
        action = await self._action("CREATE_STAFF_TASK_DRAFT")
        self.executor.side_effect = ActionOutcomeUnknown("timeout")
        with self.assertRaises(HTTPException):
            await self._confirm(action.id)

        body = main.ReconcileActionRequest(action_id=action.id, outcome="EXECUTED", note="task exists: TSK-1",
                                           evidence_reference="TSK-1")
        with self.assertRaises(HTTPException) as forbidden:
            await main.reconcile_action(_request("Bearer owner"), body)
        self.assertEqual(forbidden.exception.status_code, 403)

        await main.reconcile_action(_request("Bearer admin"), body)
        self.assertEqual(await self._status(action.id), "EXECUTED")
        with self.assertRaises(HTTPException) as twice:
            await main.reconcile_action(_request("Bearer admin"), body)
        self.assertEqual(twice.exception.status_code, 409)
        self.assertEqual((await self._events(action.id))[-1:], ["RECONCILED"])

    # -- restart mid-execution -------------------------------------------------

    async def test_stale_confirmed_actions_are_released_by_type(self):
        staff = await self._action("CREATE_STAFF_TASK_DRAFT")
        reservation = await self._action("CREATE_RESERVATION_DRAFT", user=CUSTOMER)
        fresh = await self._action("CREATE_STAFF_TASK_DRAFT")
        for action in (staff, reservation, fresh):
            self.assertTrue(await agent_store.mark_action_confirmed(action.id, actor_user_id="x"))
        async with self.sessions() as session:  # the first two were claimed by a run that never came back
            await session.execute(update(PendingActionRow)
                                  .where(PendingActionRow.action_id.in_([staff.id, reservation.id]))
                                  .values(confirmed_at=agent_store._now() - timedelta(hours=1)))
            await session.commit()

        self.assertEqual(await agent_store.release_stale_confirmed_actions(max_age_seconds=900), 2)
        self.assertEqual(await self._status(staff.id), "RECONCILE_REQUIRED")
        self.assertEqual(await self._status(reservation.id), "FAILED")
        self.assertEqual(await self._status(fresh.id), "CONFIRMED")  # still running: untouched

    # -- concurrency -------------------------------------------------------------

    async def test_two_concurrent_confirms_execute_once(self):
        action = await self._action()
        gate = asyncio.Event()

        async def slow_execute(*_args):
            await gate.wait()
            return {"success": True}
        self.executor.side_effect = slow_execute

        first = asyncio.create_task(self._confirm(action.id))
        # Wait until the first request holds the claim. A fixed sleep let the second
        # request claim first on a slow run; it then waited on `gate` forever (hang).
        for _ in range(500):
            if await self._status(action.id) == "CONFIRMED":
                break
            await asyncio.sleep(0.01)
        self.assertEqual(await self._status(action.id), "CONFIRMED")
        with self.assertRaises(HTTPException) as second:
            await self._confirm(action.id)
        self.assertEqual(second.exception.status_code, 409)
        gate.set()
        self.assertEqual((await first).status, "EXECUTED")
        self.assertEqual(self.executor.await_count, 1)

    # -- authorization at confirm time -------------------------------------------

    async def test_another_users_action_cannot_be_confirmed(self):
        action = await self._action()
        with self.assertRaises(HTTPException) as denied:
            await self._confirm(action.id, token="Bearer other")
        self.assertEqual(denied.exception.status_code, 403)
        self.assertEqual(await self._status(action.id), "PENDING_CONFIRMATION")
        self.executor.assert_not_awaited()

    async def test_expired_action_cannot_be_confirmed(self):
        action = await self._action()
        async with self.sessions() as session:
            await session.execute(update(PendingActionRow).where(PendingActionRow.action_id == action.id)
                                  .values(expires_at=agent_store._now() - timedelta(minutes=1)))
            await session.commit()
        with self.assertRaises(HTTPException) as gone:
            await self._confirm(action.id)
        self.assertEqual(gone.exception.status_code, 410)
        self.executor.assert_not_awaited()

    async def test_unverified_token_revocation_refuses_the_write(self):
        action = await self._action()
        unverified = OWNER.model_copy(update={"revocation_verified": False})
        with patch("main.get_user_context", new=AsyncMock(return_value=unverified)):
            with self.assertRaises(HTTPException) as refused:
                await self._confirm(action.id)
        self.assertEqual(refused.exception.status_code, 503)
        self.assertEqual(await self._status(action.id), "PENDING_CONFIRMATION")

    async def test_payload_tampering_through_override_is_rejected(self):
        action = await self._action("CREATE_STAFF_TASK_DRAFT", payload={"task_title": "Kiểm kê"})
        with self.assertRaises(HTTPException) as tampered:
            await self._confirm(action.id, override={"task_title": "Xóa dữ liệu", "assignee_user_id": "x"})
        self.assertEqual(tampered.exception.status_code, 400)
        self.executor.assert_not_awaited()

    async def test_cancelled_action_cannot_be_confirmed(self):
        action = await self._action()
        self.assertTrue(await agent_store.cancel_pending_action(action.id, actor_user_id=OWNER.user_id))
        with self.assertRaises(HTTPException) as cancelled:
            await self._confirm(action.id)
        self.assertEqual(cancelled.exception.status_code, 400)


if __name__ == "__main__":
    unittest.main()
