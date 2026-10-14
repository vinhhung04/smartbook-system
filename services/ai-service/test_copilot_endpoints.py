"""/assistant and /assistant/stream with the copilot: planned tools seed the
loop, both endpoints emit the same body, structured state carries a
follow-up, clarifications skip the LLM - with store, tools and LLM faked."""
from __future__ import annotations

import json
import unittest
import uuid
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import main
from agent_schemas import UserContext
from main import AssistantRequest

ADMIN = UserContext(user_id="admin-1", username="a", email=None, roles=["ADMIN"], permissions=[], is_superuser=True)
WAREHOUSES = [{"id": "w-hn", "code": "WH-HN-01", "name": "Kho Ha Noi"}]


def _request():
    return SimpleNamespace(headers={"authorization": "Bearer t"}, client=SimpleNamespace(host="test"))


class FakeStore:
    """In-memory conversation_store: one owner, message rows with metadata."""

    def __init__(self):
        self.conversations = {}
        self.messages = []

    async def get_or_create_conversation(self, conversation_id, user_ctx, first_message=None):
        cid = conversation_id or str(uuid.uuid4())
        conv = self.conversations.setdefault(cid, SimpleNamespace(id=cid, conversation_id=cid, user_id=user_ctx.user_id))
        return conv

    async def append_message(self, conversation_id, role, content=None, metadata=None, **_kw):
        self.messages.append(SimpleNamespace(conversation_id=conversation_id, role=role, content=content,
                                             msg_metadata=metadata))

    async def get_recent_messages(self, conversation_id, limit=10):
        return [m for m in self.messages if m.conversation_id == conversation_id][-limit:]


class FakeProvider:
    """Answers in text on its first call (tools were already seeded)."""

    def __init__(self, text="Câu trả lời."):
        self.text = text
        self.calls = []

    def _result(self):
        return SimpleNamespace(text=self.text, tool_calls=[], assistant_message={"role": "assistant", "content": self.text},
                               usage=SimpleNamespace(as_dict=lambda: {"prompt_tokens": 1}))

    async def chat(self, messages, tools, **_kw):
        self.calls.append(messages)
        return self._result()

    async def chat_stream(self, messages, tools, **_kw):
        self.calls.append(messages)
        yield SimpleNamespace(delta=self.text, done=False)
        yield SimpleNamespace(delta="", done=True, assistant_message={"role": "assistant", "content": self.text},
                              tool_calls=[], usage=SimpleNamespace(as_dict=lambda: {"prompt_tokens": 1}))


class CopilotEndpointTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.store = FakeStore()
        self.provider = FakeProvider()
        self.tool_calls = []

        async def top_books(auth_header=None, limit=None, from_date=None, to_date=None):
            self.tool_calls.append(("get_top_books", from_date, limit))
            return [{"variant_id": "v-1", "title": "Norwegian Wood", "borrow_count": 30}]

        main.assistant_response_cache.clear()
        self._patches = [
            patch("main.rate_limiter.acquire", new=AsyncMock(return_value=(True, None))),
            patch("main.get_user_context", new=AsyncMock(return_value=ADMIN)),
            patch("main.conversation_store.get_or_create_conversation", new=self.store.get_or_create_conversation),
            patch("main.conversation_store.append_message", new=self.store.append_message),
            patch("main.conversation_store.get_recent_messages", new=self.store.get_recent_messages),
            patch("main.copilot_tools._warehouses", new=AsyncMock(return_value=WAREHOUSES)),
            patch("main._get_assistant_provider", return_value=self.provider),
            patch.dict(main.TOOL_FUNCTIONS, {"get_top_books": top_books}),
        ]
        for p in self._patches:
            p.start()

    def tearDown(self):
        for p in self._patches:
            p.stop()

    async def _stream_done(self, message, cid):
        response = await main.assistant_stream(_request(), AssistantRequest(message=message, conversation_id=cid))
        events = [chunk async for chunk in response.body_iterator]
        done = [e for e in events if e.startswith("event: done")][0]
        return json.loads(done.split("data: ", 1)[1]), events

    async def test_planned_tools_run_and_the_prompt_carries_today(self):
        body = await main.assistant(_request(), AssistantRequest(message="Top 5 sách mượn nhiều tháng này", conversation_id="c1"))
        self.assertEqual([t.name for t in body.tools_used], ["get_top_books"])
        self.assertEqual(self.tool_calls[0][2], 5)
        system = self.provider.calls[0][0]["content"]
        self.assertIn("Ngữ cảnh lượt này", system)
        self.assertEqual(body.plan["requested_analysis"], "lookup")
        self.assertIsNotNone(body.data_as_of)

    async def test_stream_done_has_exactly_the_non_stream_body(self):
        body = (await main.assistant(_request(), AssistantRequest(message="Top 5 sách mượn nhiều tháng này",
                                                                  conversation_id="c-a"))).model_dump()
        done, events = await self._stream_done("Top 5 sách mượn nhiều tháng này", "c-b")
        self.assertTrue(events[0].startswith("event: token"))
        self.assertEqual(set(body) - {"debug"}, set(done) - {"debug"})
        self.assertEqual([t["name"] for t in body["tools_used"]], [t["name"] for t in done["tools_used"]])

    async def test_follow_up_inherits_topic_and_limit_but_takes_the_new_period(self):
        await main.assistant(_request(), AssistantRequest(message="Top 5 sách mượn nhiều tháng này", conversation_id="c2"))
        body = await main.assistant(_request(), AssistantRequest(message="Thế tháng trước?", conversation_id="c2"))
        self.assertEqual([t.name for t in body.tools_used], ["get_top_books"])
        first, second = self.tool_calls
        self.assertNotEqual(first[1], second[1])
        self.assertEqual(second[2], 5)
        self.assertTrue(body.plan["is_followup"])
        self.assertIn("capabilities", body.plan["carried_over"])

    async def test_state_never_crosses_conversations(self):
        await main.assistant(_request(), AssistantRequest(message="Top 5 sách mượn nhiều tháng này", conversation_id="c3"))
        body = await main.assistant(_request(), AssistantRequest(message="Thế tháng trước?", conversation_id="c4"))
        self.assertFalse(body.plan["is_followup"])

    async def test_clarification_asks_back_without_any_tool_or_llm_call(self):
        body = await main.assistant(_request(), AssistantRequest(message="Tại sao kho này thiếu sách?", conversation_id="c5"))
        self.assertEqual(body.tools_used, [])
        self.assertEqual(self.provider.calls, [])
        self.assertTrue(body.plan["clarification_needed"])
        self.assertIn("Kho Ha Noi", body.answer)
        done, _events = await self._stream_done("Tại sao kho này thiếu sách?", "c6")
        self.assertEqual(done["answer"], body.answer)



class GroundingAndOutputGuardTests(unittest.TestCase):
    def test_backend_computed_totals_and_system_dates_are_grounded(self):
        data = {"get_borrow_trends": [{"date": "2026-10-01", "loans": 500, "returns": 1, "reservations": 0},
                                      {"date": "2026-10-02", "loans": 30, "returns": 0, "reservations": 0}]}
        self.assertIsNone(main._grounding_check("Ngày 13/10/2026 có 530 lượt mượn", data, "q", "Hôm nay: 13/10/2026"))
        self.assertIsNotNone(main._grounding_check("Có 999 lượt mượn", data, "q", "Hôm nay: 13/10/2026"))

    def test_raw_json_replies_are_detected(self):
        self.assertTrue(main._RAW_JSON_REPLY.match('{"error": {"code": "X"}}'))
        self.assertTrue(main._RAW_JSON_REPLY.match('```json\n{"a": 1}\n```'))
        self.assertFalse(main._RAW_JSON_REPLY.match("Kho HCM Chinh rủi ro hơn [1]."))


TWO_WAREHOUSES = [{"id": "w-hcm", "code": "WH-HCM-01", "name": "Kho HCM Chinh"},
                  {"id": "w-hn", "code": "WH-HN-01", "name": "Kho Ha Noi"}]
COMPARE = {"ranking": [{"rank": 1, "warehouse_name": "Kho HCM Chinh", "out_of_stock_variants": 3, "low_stock_variants": 7,
                        "total_available_qty": 120},
                       {"rank": 2, "warehouse_name": "Kho Ha Noi", "out_of_stock_variants": 0, "low_stock_variants": 1,
                        "total_available_qty": 8}],
           "comparison": {"riskier": "Kho HCM Chinh", "less_risky": "Kho Ha Noi", "tie": False}, "unresolved": []}
SHORTAGE = {"warehouse_name": "Kho HCM Chinh",
            "summary": {"low_stock_items": 7, "out_of_stock_items": 3, "items_with_recent_demand": 6,
                        "items_with_rising_demand": 0},
            "items": [{"title": "Norwegian Wood", "status": "HẾT HÀNG", "borrow_count": 72}], "limitations": []}


class SequenceProvider(FakeProvider):
    """Answers with the given texts in order (the last one repeats)."""

    def __init__(self, texts):
        super().__init__(texts[0])
        self.texts = list(texts)

    def _result(self):
        self.text = self.texts[min(len(self.calls), len(self.texts)) - 1]
        return super()._result()


class ExplainableCopilotEndpointTests(unittest.IsolatedAsyncioTestCase):
    """Explainable AI 2.0 through the real endpoint functions."""

    def setUp(self):
        self.store = FakeStore()
        self.provider = FakeProvider("Kho HCM Chinh rủi ro thiếu sách cao hơn Kho Ha Noi.")
        self.calls = []
        self.compare_result = COMPARE

        async def compare_warehouses(auth_header=None, warehouses=None):
            self.calls.append(("compare_warehouses", tuple(warehouses or [])))
            return self.compare_result

        async def explain_warehouse_shortage(auth_header=None, warehouse=""):
            self.calls.append(("explain_warehouse_shortage", warehouse))
            return SHORTAGE

        main.assistant_response_cache.clear()
        self._patches = [
            patch("main.rate_limiter.acquire", new=AsyncMock(return_value=(True, None))),
            patch("main.get_user_context", new=AsyncMock(return_value=ADMIN)),
            patch("main.conversation_store.get_or_create_conversation", new=self.store.get_or_create_conversation),
            patch("main.conversation_store.append_message", new=self.store.append_message),
            patch("main.conversation_store.get_recent_messages", new=self.store.get_recent_messages),
            patch("main.copilot_tools._warehouses", new=AsyncMock(return_value=TWO_WAREHOUSES)),
            patch("main._get_assistant_provider", side_effect=lambda: self.provider),
            patch.dict(main.TOOL_FUNCTIONS, {"compare_warehouses": compare_warehouses,
                                             "explain_warehouse_shortage": explain_warehouse_shortage}),
        ]
        for p in self._patches:
            p.start()

    def tearDown(self):
        for p in self._patches:
            p.stop()

    async def _stream_done(self, message, cid):
        response = await main.assistant_stream(_request(), AssistantRequest(message=message, conversation_id=cid))
        events = [chunk async for chunk in response.body_iterator]
        done = [e for e in events if e.startswith("event: done")][0]
        return json.loads(done.split("data: ", 1)[1])

    async def test_both_endpoints_return_the_same_explanation_and_the_prompt_carries_the_brief(self):
        question = "Kho HCM Chinh với Kho Ha Noi kho nào rủi ro hơn?"
        body = (await main.assistant(_request(), AssistantRequest(message=question, conversation_id="e1"))).model_dump()
        done = await self._stream_done(question, "e2")
        self.assertEqual(body["explanation"], done["explanation"])
        self.assertEqual(body["explanation"]["claims"][0]["kind"], "INFERENCE")
        system = self.provider.calls[0][0]["content"]
        self.assertIn("Bản giải thích có cấu trúc", system)
        self.assertIn("[SUY LUẬN, mức chắc chắn CAO] Kho HCM Chinh rủi ro thiếu sách cao hơn Kho Ha Noi.", system)
        self.assertIn("Ví dụ minh họa cách diễn đạt", system)
        self.assertEqual(body["plan"]["answer_mode"], "comparison")

    async def test_overclaiming_wording_gets_one_corrective_retry(self):
        self.provider = SequenceProvider([
            "Kho HCM Chinh thiếu sách chủ yếu do nhu cầu mượn cao.",
            "Thiếu sách ở Kho HCM Chinh đi kèm nhu cầu mượn còn cao; dữ liệu chỉ cho thấy tương quan.",
        ])
        body = await main.assistant(_request(), AssistantRequest(message="Tại sao Kho HCM Chinh thiếu sách?",
                                                                 conversation_id="e3"))
        self.assertEqual(len(self.provider.calls), 2)
        retry_prompt = next(m["content"] for m in reversed(self.provider.calls[1]) if m["role"] == "user")
        self.assertIn("\"chủ yếu do\"", retry_prompt)
        self.assertTrue(body.answer.startswith("Thiếu sách ở Kho HCM Chinh đi kèm"))
        self.assertEqual(body.explanation["language_flags"], [])
        self.assertIsNone(body.grounding_warning)

    async def test_a_clean_answer_costs_no_extra_call(self):
        await main.assistant(_request(), AssistantRequest(message="Kho HCM Chinh với Kho Ha Noi kho nào rủi ro hơn?",
                                                          conversation_id="e4"))
        self.assertEqual(len(self.provider.calls), 1)

    async def test_restyle_follow_up_reruns_the_same_planned_call(self):
        question = "Kho HCM Chinh với Kho Ha Noi kho nào rủi ro hơn?"
        await main.assistant(_request(), AssistantRequest(message=question, conversation_id="e5"))
        body = await main.assistant(_request(), AssistantRequest(message="Nói ngắn gọn thôi", conversation_id="e5"))
        self.assertEqual(self.calls[0], self.calls[1])
        self.assertEqual(body.plan["style"], {"brief": True})
        self.assertIn("tối đa 3 câu", self.provider.calls[-1][0]["content"])
        user_turn = next(m["content"] for m in reversed(self.provider.calls[-1]) if m["role"] == "user")
        self.assertTrue(user_turn.startswith("Nói ngắn gọn thôi\n\n(Yêu cầu trình bày:"))
        self.assertEqual(self.store.messages[-2].content, "Nói ngắn gọn thôi")  # stored as typed
        self.assertEqual(body.explanation["mode"], "comparison")

    async def test_permission_denied_data_is_an_unknown_not_a_number(self):
        self.compare_result = {"error": "/analytics/warehouse-stock-risk tra ve HTTP 403"}
        self.provider = FakeProvider("Bạn không có quyền xem dữ liệu so sánh kho.")
        body = await main.assistant(_request(), AssistantRequest(message="Kho HCM Chinh với Kho Ha Noi kho nào rủi ro hơn?",
                                                                 conversation_id="e6"))
        kinds = {c["kind"] for c in body.explanation["claims"]}
        self.assertEqual(kinds, {"UNKNOWN"})
        self.assertTrue(any("không có quyền" in c for c in body.caveats))
        self.assertEqual(body.recommendations, [])

    async def test_a_data_question_with_nothing_fetched_is_told_not_to_guess(self):
        await main.assistant(_request(), AssistantRequest(message="Tạo phiếu nhập cho Kho HCM Chinh", conversation_id="e7"))
        system = self.provider.calls[0][0]["content"]
        self.assertIn("Chưa có dữ liệu cho câu hỏi này", system)


if __name__ == "__main__":
    unittest.main()
