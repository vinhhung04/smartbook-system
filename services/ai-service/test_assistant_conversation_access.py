"""Access-control regression for /assistant and /assistant/stream: a
conversation_id that belongs to another user must be refused with 403 before
any history is loaded, any message is appended, or any tool/LLM call runs."""
from __future__ import annotations

import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from fastapi import HTTPException

import conversation_store
import main
from agent_schemas import UserContext
from main import AssistantRequest


def _fake_request() -> SimpleNamespace:
    return SimpleNamespace(headers={"authorization": "Bearer t"}, client=SimpleNamespace(host="test"))


MANAGER = UserContext(
    user_id="intruder", username="b", email=None, roles=["WAREHOUSE_MANAGER"], permissions=[], is_superuser=False,
)


class AssistantConversationAccessTest(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.append = AsyncMock(side_effect=AssertionError("must not append to a foreign conversation"))
        self.recent = AsyncMock(side_effect=AssertionError("must not read a foreign conversation"))
        self._patches = [
            patch("main.rate_limiter.acquire", new=AsyncMock(return_value=(True, None))),
            patch("main.get_user_context", new=AsyncMock(return_value=MANAGER)),
            patch("main.conversation_store.get_or_create_conversation", new=AsyncMock(
                side_effect=conversation_store.ConversationAccessDenied("x"))),
            patch("main.conversation_store.append_message", new=self.append),
            patch("main.conversation_store.get_recent_messages", new=self.recent),
            patch("main._get_assistant_provider", side_effect=AssertionError("LLM must not be called")),
        ]
        for p in self._patches:
            p.start()

    def tearDown(self):
        for p in self._patches:
            p.stop()

    async def test_assistant_rejects_foreign_conversation(self):
        with self.assertRaises(HTTPException) as ctx:
            await main.assistant(_fake_request(), AssistantRequest(message="Tồn kho thế nào?", conversation_id="c-of-a"))
        self.assertEqual(ctx.exception.status_code, 403)

    async def test_assistant_stream_rejects_foreign_conversation(self):
        # Must fail before the StreamingResponse is built: once streaming starts the
        # status code is already 200.
        with self.assertRaises(HTTPException) as ctx:
            await main.assistant_stream(
                _fake_request(), AssistantRequest(message="Tồn kho thế nào?", conversation_id="c-of-a"))
        self.assertEqual(ctx.exception.status_code, 403)


if __name__ == "__main__":
    unittest.main()
