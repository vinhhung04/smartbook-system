"""Policy questions go to the library's documents, not to statistics.

The keyword intents match a topic word ("phạt", "quá hạn", "đặt sách"), so
"Phí phạt trễ hạn được tính như thế nào?" was answered with fine statistics
(FINE_SUMMARY_QUERY) and readers - blocked from statistics - got "chưa có
thông tin". intent.is_policy_question tells a question about the rules from
one about current data; nlu.classify_user_message routes the first kind to
GENERAL_QUERY (FAQ retrieval) without asking the LLM classifier.
"""
from __future__ import annotations

import json
import os
import unittest
from unittest.mock import AsyncMock, patch

import nlu
from intent import GENERAL_QUERY, detect_intent, is_policy_question

HERE = os.path.dirname(os.path.abspath(__file__))


def _datasets():
    rag = json.load(open(os.path.join(HERE, "eval", "rag_dataset.json"), encoding="utf-8"))
    copilot = json.load(open(os.path.join(HERE, "eval", "copilot_dataset.json"), encoding="utf-8"))["cases"]
    policy = [c["question"] for c in rag if c["corpus"] == "INTERNAL_DOC" and c["expected_ids"]]
    data = [c["question"] for c in rag if c["corpus"] == "BOOK_METADATA"] + [t["q"] for c in copilot for t in c["turns"]]
    with open(os.path.join(HERE, "tests", "low_stock_reorder_questions.jsonl"), encoding="utf-8") as fh:
        data += [json.loads(line)["question"] for line in fh if line.strip()]
    return policy, data


class PolicyDetectorTest(unittest.TestCase):
    def test_policy_questions_the_keyword_intents_misrouted(self):
        for question in (
            "Phí phạt trả sách trễ hạn được tính như thế nào?",
            "Trả sách trễ hạn có bị phạt tiền không?",
            "Phí phạt trễ hạn của Thẻ Đọc là 10.000đ một ngày đúng không?",
            "Thanh toán tiền phạt online được không?",
            "Có những loại tiền phạt nào trong thư viện?",
            "Đặt sách online rồi thì bao lâu phải ra lấy?",
            "Thư viện có cho mượn sách nói (audiobook) không?",
            "Hạng Bạc Sĩ được mượn tối đa bao nhiêu cuốn và bao nhiêu ngày?",
            "Purchase request và purchase order khác nhau như thế nào?",
        ):
            with self.subTest(question=question):
                self.assertTrue(is_policy_question(question))

    def test_questions_about_current_data_stay_data(self):
        for question in (
            "Có loan nào quá hạn?",
            "Tổng tiền phạt chưa thu là bao nhiêu?",
            "Tôi có khoản phạt nào chưa thanh toán?",
            "Sách nào tồn kho thấp?",
            "Tình hình thư viện hôm nay thế nào?",
            "Tháng 9 so với tháng 8 lượt mượn thế nào",
            "Có cuốn Harry Potter và Hòn đá Phù thủy không?",
            "Nếu ngân sách còn 5 triệu thì nhập được bao nhiêu?",
        ):
            with self.subTest(question=question):
                self.assertFalse(is_policy_question(question))

    def test_quality_on_the_eval_datasets(self):
        """Measured 2026-11-13: 71/79 policy questions caught, 0/316 data
        questions caught. A cue change that drops below these bars is a regression."""
        policy, data = _datasets()
        recall = sum(map(is_policy_question, policy)) / len(policy)
        false_positive_rate = sum(map(is_policy_question, data)) / len(data)
        self.assertGreaterEqual(recall, 0.88)
        self.assertLessEqual(false_positive_rate, 0.01)


class PolicyRoutingTest(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        nlu._nlu_cache.clear()

    async def test_policy_question_goes_to_the_documents_without_the_llm(self):
        question = "Phí phạt trả sách trễ hạn được tính như thế nào?"
        self.assertEqual(detect_intent(question)["intent"], "OVERDUE_LOAN_QUERY")  # what the keywords say
        with patch.object(nlu, "_call_llm", new=AsyncMock(side_effect=AssertionError("no LLM call expected"))):
            shape = await nlu.classify_user_message(question)
        self.assertEqual((shape["intent"], shape["source"], shape["query"]), (GENERAL_QUERY, "rule_policy", question))
        self.assertFalse(shape["wants_action"])

    async def test_an_action_request_phrased_as_a_question_is_not_rerouted(self):
        llm = AsyncMock(return_value=({"intent": "RESERVATION_QUERY", "confidence": 0.9, "wants_action": True,
                                       "action_type": "CREATE_RESERVATION_DRAFT", "entities": {}}, True))
        with patch.object(nlu, "_call_llm", new=llm):
            shape = await nlu.classify_user_message("Bạn có thể đặt giữ giúp tôi cuốn Clean Code được không?")
        llm.assert_awaited_once()
        self.assertNotEqual(shape["source"], "rule_policy")

    async def test_data_question_keeps_its_intent(self):
        shape = await nlu.classify_user_message("Có loan nào quá hạn?")
        self.assertEqual(shape["intent"], "OVERDUE_LOAN_QUERY")


if __name__ == "__main__":
    unittest.main()
