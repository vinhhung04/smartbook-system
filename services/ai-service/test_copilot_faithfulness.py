"""Semantic faithfulness validator (copilot_faithfulness) and its place in
/assistant and /assistant/stream: one retry at most, a deterministic fallback
when the data is still contradicted, labels repaired without any LLM call."""
from __future__ import annotations

import json
import unittest
from unittest.mock import AsyncMock, patch

import copilot_faithfulness as cf
import main
from main import AssistantRequest
from test_copilot_endpoints import ADMIN, SequenceProvider, _request
from test_copilot_visualization import COMPARE, MONTHLY, WAREHOUSES, FakeStoreWithData, frozen_clock, plan
from copilot_explain import build_explanation
import copilot_visualization as cv

CTX = cf.Context(trend="giảm", trend_pct=-25.0, riskiest="Kho HCM Chinh", warehouses=["Kho HCM Chinh", "Kho Ha Noi"],
                 borrow_data=True)


def types(answer, ctx=CTX):
    return [i.type for i in cf.validate(answer, ctx)]


class DetectorTests(unittest.TestCase):
    """Development examples (the rules were written against these)."""

    def test_contradiction(self):
        self.assertEqual(types("Lượt mượn có xu hướng tăng trong các tháng trọn kỳ."), [cf.CONTRADICTION])
        self.assertEqual(types("Lượt mượn tăng 25% so với tháng 5."), [cf.CONTRADICTION])
        self.assertEqual(types("Lượt mượn có xu hướng giảm 25%."), [])
        self.assertEqual(types("Lượt mượn không tăng mà giảm dần."), [])
        self.assertEqual(types("Lượt mượn tăng ở tháng 8 nhưng xu hướng chung vẫn giảm."), [])

    def test_ranking(self):
        self.assertEqual(types("Kho Ha Noi rủi ro thiếu sách cao hơn Kho HCM Chinh."), [cf.RANKING_INCONSISTENCY])
        self.assertEqual(types("Kho HCM Chinh có rủi ro thiếu sách thấp hơn Kho Ha Noi."), [cf.RANKING_INCONSISTENCY])
        self.assertEqual(types("Kho HCM Chinh rủi ro thiếu sách cao hơn Kho Ha Noi."), [])
        self.assertEqual(types("Kho Hà Nội rủi ro cao nhất."), [cf.RANKING_INCONSISTENCY])  # accents do not matter
        tie = cf.Context(risk_tie=True, warehouses=["Kho A", "Kho B"])
        self.assertEqual(types("Kho A rủi ro cao hơn Kho B.", tie), [cf.RANKING_INCONSISTENCY])

    def test_scope_confusion(self):
        self.assertEqual(types("Có 5.445 lượt mượn tại kho Hà Nội trong kỳ."), [cf.SCOPE_CONFUSION])
        self.assertEqual(types("Kho HCM Chinh có 5.445 lượt mượn trong kỳ."), [cf.SCOPE_CONFUSION])
        self.assertEqual(types("Toàn hệ thống có 5.445 lượt mượn trong kỳ."), [])
        self.assertEqual(types("Lượt mượn của kho HCM chưa được tách riêng, đây là số toàn hệ thống."), [])

    def test_causal(self):
        self.assertEqual(types("Thiếu hàng là do nhu cầu tăng."), [cf.UNSUPPORTED_CAUSAL])
        self.assertEqual(types("Nguyên nhân chính là thời gian chờ hàng dài."), [cf.UNSUPPORTED_CAUSAL])
        self.assertEqual(types("Thiếu hàng có thể là do nhu cầu tăng, nhưng dữ liệu chưa đủ để khẳng định."), [])
        self.assertEqual(types("Chưa thể khẳng định nguyên nhân chính là gì."), [])

    def test_recommendation_and_overclaim(self):
        self.assertEqual(types("Ngân sách 20 triệu là phương án tối ưu nhất."), [cf.UNSUPPORTED_RECOMMENDATION])
        self.assertEqual(types("Không có phương án nào tối ưu tuyệt đối."), [])
        expl = {"certainty": "TRUNG BÌNH", "mode": "analysis", "flags": []}
        ctx = cf.Context(explanation=expl)
        self.assertIn(cf.REASONING_OVERCLAIM, types("Chắc chắn lượt mượn sẽ còn giảm.", ctx))

    def test_internal_labels_are_repaired_without_a_retry(self):
        cleaned, issues = cf.strip_internal_labels("Không có kịch bản tối ưu. Ý nghĩa: chọn mức nào tùy bạn. [DỮ KIỆN] 116 đầu sách.")
        self.assertNotIn("Ý nghĩa:", cleaned)
        self.assertNotIn("[DỮ KIỆN]", cleaned)
        self.assertIn("Chọn mức nào tùy bạn", cleaned)  # a new sentence starts with a capital again
        self.assertEqual({i.type for i in issues}, {cf.INTERNAL_LABEL})
        cleaned, _ = cf.strip_internal_labels("- **Tồn khả dụng**: 121 bản, Ý nghĩa: còn nhiều.\nÝ nghĩa: ổn.")
        self.assertEqual(cleaned, "- **Tồn khả dụng**: 121 bản, còn nhiều.\nỔn.")

    def test_context_is_built_from_the_same_data_as_the_charts(self):
        p = plan("Vẽ biểu đồ lượt mượn 6 tháng gần đây và phân tích xu hướng")
        data = {"get_borrow_trends": MONTHLY, "compare_warehouses": COMPARE}
        specs, _ = cv.build_visualizations(p, data)
        ctx = cf.build_context(data, build_explanation(p, data), specs)
        self.assertEqual((ctx.trend, ctx.trend_pct), ("giảm", -25.0))
        self.assertEqual(ctx.riskiest, "Kho HCM Chinh")
        self.assertTrue(ctx.borrow_data)

    def test_fallback_uses_only_the_explanation(self):
        expl = {"headline": "Lượt mượn có xu hướng giảm.", "claims": [
            {"kind": "FACT", "statement": "Tổng 635 lượt."}, {"kind": "UNKNOWN", "statement": "Lý do chưa rõ."}]}
        text = cf.fallback_answer(expl)
        self.assertTrue(text.startswith("Lượt mượn có xu hướng giảm."))
        self.assertIn("Tổng 635 lượt.", text)
        self.assertIsNone(cf.fallback_answer(None))


class FaithfulnessEndpointTests(unittest.IsolatedAsyncioTestCase):
    Q = "Vẽ biểu đồ lượt mượn 6 tháng gần đây và phân tích xu hướng"

    def setUp(self):
        self.store = FakeStoreWithData()
        main.assistant_response_cache.clear()

        async def borrow_trends(auth_header=None, from_date=None, to_date=None, granularity=None):
            return MONTHLY

        self._patches = [
            patch("main.rate_limiter.acquire", new=AsyncMock(return_value=(True, None))),
            patch("main.get_user_context", new=AsyncMock(return_value=ADMIN)),
            patch("main.conversation_store.get_or_create_conversation", new=self.store.get_or_create_conversation),
            patch("main.conversation_store.append_message", new=self.store.append_message),
            patch("main.conversation_store.get_recent_messages", new=self.store.get_recent_messages),
            patch("main.copilot_tools._warehouses", new=AsyncMock(return_value=WAREHOUSES)),
            patch.dict(main.TOOL_FUNCTIONS, {"get_borrow_trends": borrow_trends}),
            *frozen_clock(),
        ]
        for p in self._patches:
            p.start()

    def tearDown(self):
        for p in self._patches:
            p.stop()

    async def ask(self, texts, cid, stream=False):
        provider = SequenceProvider(texts)
        with patch("main._get_assistant_provider", return_value=provider):
            if stream:
                response = await main.assistant_stream(_request(), AssistantRequest(message=self.Q, conversation_id=cid))
                events = [chunk async for chunk in response.body_iterator]
                done = json.loads([e for e in events if e.startswith("event: done")][0].split("data: ", 1)[1])
                streamed = "".join(json.loads(e.split("data: ", 1)[1])["text"] for e in events if e.startswith("event: token"))
                return done, provider, streamed
            body = (await main.assistant(_request(), AssistantRequest(message=self.Q, conversation_id=cid))).model_dump()
            return body, provider, None

    async def test_a_faithful_answer_costs_no_extra_call(self):
        body, provider, _ = await self.ask(["Lượt mượn có xu hướng giảm 25% giữa các tháng trọn kỳ."], "f1")
        self.assertEqual(len(provider.calls), 1)
        self.assertEqual(body["faithfulness"]["status"], "passed")
        self.assertFalse(body["faithfulness"]["retried"])

    async def test_a_contradiction_is_retried_once_and_fixed(self):
        body, provider, _ = await self.ask(["Lượt mượn có xu hướng tăng mạnh.", "Lượt mượn có xu hướng giảm 25%."], "f2")
        self.assertEqual(len(provider.calls), 2)
        self.assertEqual(body["faithfulness"]["status"], "retried_passed")
        self.assertIn("giảm", body["answer"])
        retry_prompt = " ".join(str(m.get("content")) for m in provider.calls[1])
        self.assertIn("mâu thuẫn với xu hướng", retry_prompt)

    async def test_a_contradiction_that_survives_the_retry_is_replaced(self):
        body, provider, _ = await self.ask(["Lượt mượn có xu hướng tăng mạnh."], "f3")
        self.assertEqual(len(provider.calls), 2)  # never more than one retry
        self.assertEqual(body["faithfulness"]["status"], "fallback")
        self.assertIn("xu hướng giảm", body["answer"])
        self.assertNotIn("tăng mạnh", body["answer"])
        self.assertTrue(body["visualizations"])  # charts and evidence are kept
        self.assertEqual(body["faithfulness"]["issues"][0]["type"], cf.CONTRADICTION)

    async def test_stream_done_carries_the_validated_answer(self):
        done, _provider, streamed = await self.ask(["Lượt mượn có xu hướng tăng mạnh."], "f4", stream=True)
        self.assertIn("tăng mạnh", streamed)  # what was streamed first
        self.assertEqual(done["faithfulness"]["status"], "fallback")  # what replaces it
        self.assertNotIn("tăng mạnh", done["answer"])
        body, _p, _ = await self.ask(["Lượt mượn có xu hướng tăng mạnh."], "f5")
        self.assertEqual(done["answer"], body["answer"])  # same rule on both endpoints

    async def test_labels_are_repaired_without_a_retry(self):
        body, provider, _ = await self.ask(["Lượt mượn có xu hướng giảm 25%. Ý nghĩa: cần theo dõi thêm."], "f6")
        self.assertEqual(len(provider.calls), 1)
        self.assertEqual(body["faithfulness"]["status"], "repaired")
        self.assertNotIn("Ý nghĩa:", body["answer"])

    async def test_the_result_is_kept_with_the_conversation(self):
        await self.ask(["Lượt mượn có xu hướng giảm 25%."], "f7")
        self.assertEqual(self.store.messages[-1].msg_metadata["extras"]["faithfulness"]["status"], "passed")


if __name__ == "__main__":
    unittest.main()
