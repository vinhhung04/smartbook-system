"""Integration coverage for the /chat + /chat/stream hybrid abstention branch
(main.py): a NO_EVIDENCE retrieval decision on an information-seeking
GENERAL_QUERY message skips the LLM entirely and returns a fixed reply,
while the same decision on small talk still reaches the LLM (Chức năng 1.4/1.5).

Mocks every collaborator main.chat()/chat_stream() call before the point this
module cares about (auth, intent classification, personal context, retrieval)
so the test exercises only the abstention branch itself - no live network,
DB or LLM call.
"""
from __future__ import annotations

import json
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import main
import retrieval_confidence as confidence
from intent import GENERAL_QUERY
from main import ChatRequest


def _fake_request() -> SimpleNamespace:
    return SimpleNamespace(headers={}, client=SimpleNamespace(host="test"))


NO_EVIDENCE_RETRIEVAL = {
    "summary": "", "raw": {}, "sources": [], "warnings": [], "retrieved_at": "",
    "retrieval_status": confidence.NO_EVIDENCE, "retrieval_confidence": 0.1, "reason_codes": ["EMPTY_RESULT"],
}


class ChatAbstentionTest(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self._patches = [
            patch("main.rate_limiter.acquire", new=AsyncMock(return_value=(True, None))),
            patch("main.classify_user_message", new=AsyncMock(
                return_value={"intent": GENERAL_QUERY, "confidence": 0.35, "query": ""})),
            patch("main.build_user_personal_context", new=AsyncMock(
                return_value={"role": "LIBRARIAN", "persona": "x", "summary": ""})),
        ]
        for p in self._patches:
            p.start()

    def tearDown(self):
        for p in self._patches:
            p.stop()

    async def test_information_seeking_message_abstains_without_calling_the_llm(self):
        with patch("main.retrieve_context", new=AsyncMock(return_value=NO_EVIDENCE_RETRIEVAL)), \
             patch("main._chat_with_text_llm", new=AsyncMock(side_effect=AssertionError("LLM must not be called"))):
            result = await main.chat(_fake_request(), ChatRequest(message="Phí in ấn tài liệu là bao nhiêu?"))

        self.assertEqual(result["reply"], main.GENERAL_QUERY_ABSTENTION_REPLY)
        self.assertEqual(result["ai_provider"], "abstention")
        self.assertEqual(result["retrievalStatus"], confidence.NO_EVIDENCE)
        self.assertEqual(result["context_sources"], [])

    async def test_small_talk_message_still_reaches_the_llm_despite_no_evidence(self):
        with patch("main.retrieve_context", new=AsyncMock(return_value=NO_EVIDENCE_RETRIEVAL)), \
             patch("main._chat_with_text_llm", new=AsyncMock(return_value=("Xin chào! Tôi có thể giúp gì?", True))), \
             patch("main._get_text_llm_provider", return_value=SimpleNamespace(name="openrouter")):
            result = await main.chat(_fake_request(), ChatRequest(message="Chào bạn"))

        self.assertEqual(result["reply"], "Xin chào! Tôi có thể giúp gì?")
        self.assertNotEqual(result.get("ai_provider"), "abstention")

    async def test_confident_match_never_abstains(self):
        confident_retrieval = {
            **NO_EVIDENCE_RETRIEVAL, "retrieval_status": confidence.CONFIDENT_MATCH,
            "summary": "Cau hoi thuong gap lien quan:\n- Q: A",
            "sources": [{"name": "FAQ: Q", "endpoint": "faq://x", "status": "ok"}],
        }
        with patch("main.retrieve_context", new=AsyncMock(return_value=confident_retrieval)), \
             patch("main._chat_with_text_llm", new=AsyncMock(return_value=("A.", True))), \
             patch("main._get_text_llm_provider", return_value=SimpleNamespace(name="openrouter")):
            result = await main.chat(_fake_request(), ChatRequest(message="Phí phạt tính thế nào?"))

        self.assertNotEqual(result.get("ai_provider"), "abstention")

    async def test_stream_abstains_with_token_and_done_events(self):
        with patch("main.retrieve_context", new=AsyncMock(return_value=NO_EVIDENCE_RETRIEVAL)), \
             patch("main._chat_with_text_llm", new=AsyncMock(side_effect=AssertionError("LLM must not be called"))):
            response = await main.chat_stream(_fake_request(), ChatRequest(message="Phí in ấn tài liệu là bao nhiêu?"))
            events = [chunk async for chunk in response.body_iterator]

        self.assertEqual(len(events), 2)
        self.assertIn("event: token", events[0])
        done_payload = json.loads(events[1].split("data: ", 1)[1])
        self.assertEqual(done_payload["reply"], main.GENERAL_QUERY_ABSTENTION_REPLY)
        self.assertEqual(done_payload["ai_provider"], "abstention")
        self.assertEqual(done_payload["retrievalStatus"], confidence.NO_EVIDENCE)


if __name__ == "__main__":
    unittest.main()
