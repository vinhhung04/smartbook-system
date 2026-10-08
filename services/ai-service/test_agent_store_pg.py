"""AI Action Center claim under REAL concurrency (separate Postgres connections).
Skipped without TEST_PG_DSN - point it at a throwaway database, not ai_db:

    TEST_PG_DSN=postgresql+asyncpg://user:pass@localhost:5432/ai_test python -m pytest test_agent_store_pg.py
"""
from __future__ import annotations

import asyncio
import importlib
import os
import unittest
from unittest import mock

TEST_DSN = os.getenv("TEST_PG_DSN", "")


@unittest.skipUnless(TEST_DSN, "TEST_PG_DSN khong duoc set - bo qua integration test")
class AgentStoreConcurrencyPgTest(unittest.TestCase):
    def setUp(self):
        os.environ["DATABASE_URL"] = TEST_DSN
        import db
        importlib.reload(db)
        import agent_store
        importlib.reload(agent_store)
        self.db, self.agent_store = db, agent_store

    def _run(self, scenario):
        async def wrapped():
            try:
                await self.db.init_db()
                return await scenario()
            finally:
                await self.db.engine.dispose()
        return asyncio.run(wrapped())

    def _user(self):
        from agent_schemas import UserContext
        return UserContext(user_id="pg-u1", roles=["ADMIN"], permissions=[], is_superuser=True)

    def test_exactly_one_of_many_concurrent_claims_wins(self):
        async def scenario():
            action = await self.agent_store.create_pending_action(
                action_type="CREATE_REORDER_DRAFT", summary="pg race", payload={}, risk="LOW", user_context=self._user())
            claims = await asyncio.gather(*[
                self.agent_store.mark_action_confirmed(action.id, actor_user_id="pg-u1") for _ in range(8)])
            status = (await self.agent_store.get_pending_action(action.id)).status
            return claims, status

        claims, status = self._run(scenario)
        self.assertEqual(sum(claims), 1)
        self.assertEqual(status, "CONFIRMED")

    def test_concurrent_confirm_requests_execute_the_action_once(self):
        import main
        from agent_schemas import ConfirmActionRequest

        executions = []

        async def slow_execute(action, auth_header, user_ctx):
            executions.append(action.id)
            await asyncio.sleep(0.2)
            return {"created": True}

        async def scenario():
            # main imported these by name from the agent_store it saw at import time;
            # point them at the store reloaded onto TEST_PG_DSN for this test only.
            store_functions = {name: getattr(self.agent_store, name) for name in (
                "get_pending_action", "mark_action_confirmed", "mark_action_executed", "mark_action_failed",
                "cancel_pending_action", "get_action_result", "cleanup_expired_actions")}
            action = await self.agent_store.create_pending_action(
                action_type="CREATE_REPORT_DRAFT", summary="pg endpoint", payload={}, risk="LOW", user_context=self._user())
            request = type("R", (), {"headers": {"authorization": "Bearer t"}})()
            req = ConfirmActionRequest(action_id=action.id, confirm=True)
            with mock.patch.multiple(main, **store_functions), \
                    mock.patch.object(main, "get_user_context", mock.AsyncMock(return_value=self._user())), \
                    mock.patch.object(main, "require_can_confirm_action", lambda *a, **k: None), \
                    mock.patch.object(main, "execute_agent_action", slow_execute), \
                    mock.patch.object(main, "push_ai_action_event", mock.AsyncMock()):
                results = await asyncio.gather(*[main.confirm_action(request, req) for _ in range(4)],
                                               return_exceptions=True)
            return results, (await self.agent_store.get_pending_action(action.id)).status

        results, final = self._run(scenario)
        self.assertEqual(len(executions), 1)
        self.assertEqual(final, "EXECUTED")
        conflicts = [r for r in results if getattr(r, "status_code", None) == 409]
        succeeded = [r for r in results if getattr(r, "status", None) == "EXECUTED"]
        self.assertEqual(len(conflicts) + len(succeeded), 4)
        self.assertGreaterEqual(len(succeeded), 1)


if __name__ == "__main__":
    unittest.main()
