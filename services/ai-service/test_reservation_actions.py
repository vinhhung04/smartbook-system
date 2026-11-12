"""Reservation actions end to end inside ai-service: /actions/confirm ->
policy -> action_guard -> agent_executor -> HTTP request to borrow-service.
Real code for all of it; only the borrow-service side is an httpx
MockTransport (recording exactly what was sent) and the action store is
in-memory SQLite.

Rules under test (borrow-service guards, verified 2026-11-12):
- a customer reserves for themself through /my/reservations - the body never
  carries a customer_id, so they cannot reserve for someone else;
- a customer needs no warehouse write scope (readers hold none);
- library staff reserve for a customer through /borrow/reservations;
- every call carries Idempotency-Key ai-reservation-<action id>, so a retry
  after an unknown outcome replays instead of creating a second reservation.
"""
from __future__ import annotations

import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import httpx
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

import agent_executor
import agent_store
import main
from agent_schemas import ConfirmActionRequest, UserContext
from db_models import Base

# permissions as the auth seed grants them
CUSTOMER = UserContext(user_id="cust-1", roles=["CUSTOMER"], permissions=["customer.self.read", "customer.self.write"])
LIBRARIAN = UserContext(user_id="lib-1", roles=["LIBRARIAN"], permissions=["borrow.write", "borrow.customers.write"])
STAFF = UserContext(user_id="staff-1", roles=["WAREHOUSE_STAFF"], permissions=["inventory.purchase.request"])
TOKENS = {"Bearer cust": CUSTOMER, "Bearer lib": LIBRARIAN, "Bearer staff": STAFF}
PAYLOAD = {"variant_id": "11111111-1111-4111-8111-111111111111",
           "warehouse_id": "22222222-2222-4222-8222-222222222222", "quantity": 1}


class ReservationActionTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.engine = create_async_engine("sqlite+aiosqlite:///:memory:",
                                          connect_args={"check_same_thread": False}, poolclass=StaticPool)
        async with self.engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        sessions = async_sessionmaker(self.engine, expire_on_commit=False)
        self.sent: list[httpx.Request] = []
        self.reply = httpx.Response(201, json={"id": "res-1", "status": "PENDING"})

        def handler(request: httpx.Request) -> httpx.Response:
            self.sent.append(request)
            if isinstance(self.reply, Exception):
                raise self.reply
            return self.reply

        real_client = httpx.AsyncClient

        def client_factory(*args, **kwargs):
            return real_client(*args, transport=httpx.MockTransport(handler), **kwargs)

        self._patches = [
            patch.object(agent_store, "get_session", lambda: sessions()),
            patch("main.get_user_context", new=AsyncMock(side_effect=lambda h: TOKENS[h])),
            patch.object(agent_executor.httpx, "AsyncClient", client_factory),
            # readers and librarians hold no warehouse scope: the check must not even be asked
            patch("warehouse_scope.writable_warehouses",
                  new=AsyncMock(side_effect=AssertionError("reservation must not require warehouse scope"))),
            patch("main.push_ai_action_event", new=AsyncMock()),
        ]
        for p in self._patches:
            p.start()

    async def asyncTearDown(self):
        for p in self._patches:
            p.stop()
        await self.engine.dispose()

    async def _draft(self, user, payload=None):
        return await agent_store.create_pending_action(
            action_type="CREATE_RESERVATION_DRAFT", summary="Giữ sách", payload=payload or dict(PAYLOAD),
            risk="MEDIUM", user_context=user)

    async def _confirm(self, action_id, token, override=None):
        request = SimpleNamespace(headers={"authorization": token}, client=SimpleNamespace(host="gw"))
        return await main.confirm_action(request, ConfirmActionRequest(action_id=action_id, override_payload=override))

    async def test_customer_reserves_for_themself_without_warehouse_scope(self):
        action = await self._draft(CUSTOMER, {**PAYLOAD, "customer_id": "someone-else"})
        resp = await self._confirm(action.id, "Bearer cust")

        self.assertEqual(resp.status, "EXECUTED")
        (sent,) = self.sent
        self.assertTrue(sent.url.path.endswith("/my/reservations"))
        body = sent.read().decode()
        self.assertNotIn("customer_id", body)          # identity comes from the token only
        self.assertNotIn("someone-else", body)
        self.assertEqual(sent.headers["Idempotency-Key"], f"ai-reservation-{action.id}")
        self.assertEqual(sent.headers["Authorization"], "Bearer cust")

    async def test_customer_cannot_retarget_the_reservation_through_override(self):
        action = await self._draft(CUSTOMER)
        with self.assertRaises(HTTPException) as tampered:
            await self._confirm(action.id, "Bearer cust", override={"customer_id": "someone-else"})
        self.assertEqual(tampered.exception.status_code, 400)
        self.assertEqual(self.sent, [])

    async def test_librarian_reserves_for_a_customer_through_the_desk_route(self):
        action = await self._draft(LIBRARIAN, {**PAYLOAD, "customer_id": "cust-9"})
        resp = await self._confirm(action.id, "Bearer lib")

        self.assertEqual(resp.status, "EXECUTED")
        (sent,) = self.sent
        self.assertTrue(sent.url.path.endswith("/borrow/reservations"))
        self.assertIn("cust-9", sent.read().decode())

    async def test_staff_without_borrow_rights_cannot_confirm_a_reservation(self):
        action = await self._draft(STAFF, {**PAYLOAD, "customer_id": "cust-9"})
        with self.assertRaises(HTTPException) as denied:
            await self._confirm(action.id, "Bearer staff")
        self.assertEqual(denied.exception.status_code, 403)
        self.assertEqual(self.sent, [])

    async def test_out_of_stock_refusal_fails_cleanly_and_is_retryable(self):
        self.reply = httpx.Response(409, json={"message": "Insufficient stock"})
        action = await self._draft(CUSTOMER)
        with self.assertRaises(HTTPException) as refused:
            await self._confirm(action.id, "Bearer cust")
        self.assertEqual(refused.exception.status_code, 409)
        self.assertEqual((await agent_store.get_pending_action(action.id)).status, "FAILED")

    async def test_timeout_then_retry_reuses_the_idempotency_key(self):
        self.reply = httpx.ReadTimeout("no answer")
        action = await self._draft(CUSTOMER)
        with self.assertRaises(HTTPException) as unknown:
            await self._confirm(action.id, "Bearer cust")
        self.assertEqual(unknown.exception.status_code, 502)
        self.assertEqual((await agent_store.get_pending_action(action.id)).status, "FAILED")  # retry-safe type

        self.reply = httpx.Response(201, json={"id": "res-1"})
        resp = await self._confirm(action.id, "Bearer cust")
        self.assertEqual(resp.status, "EXECUTED")
        self.assertEqual({r.headers["Idempotency-Key"] for r in self.sent}, {f"ai-reservation-{action.id}"})
        self.assertEqual(len(self.sent), 2)

    async def test_draft_without_variant_is_never_sent(self):
        action = await self._draft(CUSTOMER, {"warehouse_id": PAYLOAD["warehouse_id"]})
        resp = await self._confirm(action.id, "Bearer cust")
        self.assertEqual(resp.result["mode"], "draft_only")
        self.assertEqual(self.sent, [])


if __name__ == "__main__":
    unittest.main()
