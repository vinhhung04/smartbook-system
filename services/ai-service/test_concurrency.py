"""Concurrency behaviour of the chat pipeline, in process: many simultaneous
requests through the real /chat and /chat/stream handlers and the real
RateLimiter, with the model and retrieval replaced by fakes. It checks
correctness under load (no lost or mixed-up streams, exact limiter
accounting); it does not measure network or model latency - see
eval/measure_assistant_latency.py and eval/eval_chat_answers.py for live runs.
"""
from __future__ import annotations

import asyncio
import json
import time
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from fastapi import HTTPException

import main
import retrieval_confidence as confidence
from agent_schemas import UserContext
from cache import RateLimiter, ResponseCache
from intent import GENERAL_QUERY
from main import ChatRequest

RETRIEVAL = {"summary": "Câu hỏi thường gặp liên quan:\n- Q: A", "raw": {}, "warnings": [], "retrieved_at": "",
             "sources": [{"name": "FAQ: Q", "endpoint": "faq://q", "status": "ok"}],
             "retrieval_status": confidence.CONFIDENT_MATCH, "retrieval_confidence": 0.9}


def _request(user_id: str):
    return SimpleNamespace(headers={"authorization": f"Bearer {user_id}"}, client=SimpleNamespace(host="gateway"))


class _EchoStreamingProvider:
    """Streams back the user's own question word by word, after a short yield,
    so interleaved streams would show up as mixed-up text."""
    name = "fake"

    async def chat_stream(self, messages, tools, **kwargs):
        for word in messages[-1]["content"].split():
            await asyncio.sleep(0.001)
            yield SimpleNamespace(delta=word + " ", done=False)
        yield SimpleNamespace(delta="", done=True)


class ChatConcurrencyTest(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self._patches = [
            patch("main.get_user_context", new=AsyncMock(side_effect=lambda h: UserContext(
                user_id=h.split()[1], roles=["LIBRARIAN"], permissions=[]))),
            patch("main.classify_user_message", new=AsyncMock(return_value={"intent": GENERAL_QUERY, "query": "q"})),
            patch("main.build_user_personal_context", new=AsyncMock(
                return_value={"role": "LIBRARIAN", "persona": "x", "summary": ""})),
            patch("main.retrieve_context", new=AsyncMock(return_value=RETRIEVAL)),
            patch("main.plan_agent_action", new=AsyncMock(return_value=None)),
            patch("main._get_text_llm_provider", return_value=_EchoStreamingProvider()),
            patch("main._chat_with_text_llm", new=AsyncMock(return_value=("Trả lời.", True))),
            patch("main.response_cache", ResponseCache()),
        ]
        for p in self._patches:
            p.start()

    def tearDown(self):
        for p in self._patches:
            p.stop()

    async def test_one_user_flooding_gets_exactly_the_limit(self):
        with patch("main.rate_limiter", RateLimiter(requests_per_minute=15, requests_per_hour=100)):
            results = await asyncio.gather(*(main.chat(_request("flood"), ChatRequest(message=f"Câu {i}?"))
                                             for i in range(40)), return_exceptions=True)
        refused = [r for r in results if isinstance(r, HTTPException) and r.status_code == 429]
        self.assertEqual((len(results) - len(refused), len(refused)), (15, 25))

    async def test_many_users_at_once_are_not_throttled_by_each_other(self):
        with patch("main.rate_limiter", RateLimiter(requests_per_minute=15, requests_per_hour=100)):
            started = time.perf_counter()
            results = await asyncio.gather(*(main.chat(_request(f"user{u}"), ChatRequest(message=f"Câu {u}-{i}?"))
                                             for u in range(20) for i in range(10)), return_exceptions=True)
            elapsed = time.perf_counter() - started
        self.assertEqual([r for r in results if isinstance(r, Exception)], [])
        self.assertEqual(len(results), 200)
        print(f"\n200 concurrent /chat requests (20 users, fake model/retrieval): {elapsed * 1000:.0f} ms")

    async def test_concurrent_streams_stay_separate_and_complete(self):
        async def consume(i: int) -> dict:
            response = await main.chat_stream(_request(f"s{i}"), ChatRequest(message=f"câu hỏi số {i} kết thúc"))
            events = [e async for e in response.body_iterator]
            tokens = "".join(json.loads(e.split("data: ", 1)[1])["text"] for e in events if e.startswith("event: token"))
            done = json.loads([e for e in events if e.startswith("event: done")][0].split("data: ", 1)[1])
            return {"i": i, "tokens": tokens.strip(), "done": done["reply"]}

        with patch("main.rate_limiter.acquire", new=AsyncMock(return_value=(True, ""))):
            outcomes = await asyncio.gather(*(consume(i) for i in range(50)))
        for outcome in outcomes:
            self.assertEqual(outcome["tokens"], f"câu hỏi số {outcome['i']} kết thúc")  # no interleaving
            self.assertTrue(outcome["done"].startswith(outcome["tokens"]))


if __name__ == "__main__":
    unittest.main()
