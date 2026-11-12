"""Scorer of eval/eval_chat_answers.py: deterministic rules, checked on
hand-written replies so a bug here cannot inflate the live numbers."""
from __future__ import annotations

import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "eval"))
import eval_chat_answers as ev  # noqa: E402


def _case(expect, must=(), must_not=(), docs=()):
    return {"expect": expect, "must_include": list(must), "must_not_include": list(must_not), "expected_docs": list(docs)}


class ChatAnswerScoringTest(unittest.TestCase):
    def test_numbers_and_diacritics_are_normalized(self):
        self.assertIn("5000", ev.normalize("phạt 5.000 VND"))
        self.assertIn("5 phut", ev.normalize("hiệu lực 5 phút"))

    def test_answer_needs_every_fact_and_no_refusal(self):
        case = _case("answer", must=["5", "21"])
        self.assertTrue(ev.score(case, {"reply": "Bạc Sĩ: 5 cuốn, 21 ngày."})["correct"])
        self.assertFalse(ev.score(case, {"reply": "Bạc Sĩ: 5 cuốn."})["correct"])
        refused = ev.score(case, {"reply": "Tài liệu chưa có thông tin về 5 hay 21."})
        self.assertFalse(refused["correct"])
        self.assertTrue(refused["false_refusal"])

    def test_abstention_must_not_invent_a_negative(self):
        case = _case("abstain", must_not=["khong ho tro"])
        self.assertTrue(ev.score(case, {"reply": "Tài liệu của thư viện chưa có thông tin về bãi đỗ xe."})["correct"])
        self.assertFalse(ev.score(case, {"reply": "Chưa có thông tin, SmartBook không hỗ trợ việc này."})["correct"])
        self.assertTrue(ev.score(case, {"reply": "x", "ai_provider": "abstention"})["correct"])

    def test_partial_needs_the_known_half_and_the_gap(self):
        case = _case("partial", must=["17:00"])
        self.assertTrue(ev.score(case, {"reply": "Chủ nhật đến 17:00; wifi thì chưa có thông tin."})["correct"])
        self.assertFalse(ev.score(case, {"reply": "Chủ nhật đến 17:00 và có wifi."})["correct"])

    def test_dynamic_data_must_be_answered_not_refused(self):
        case = _case("dynamic")
        self.assertTrue(ev.score(case, {"reply": "Bạn đang mượn 2 cuốn.", "ai_provider": "openrouter"})["correct"])
        self.assertFalse(ev.score(case, {"reply": "Chưa có thông tin.", "ai_provider": "openrouter"})["correct"])
        self.assertFalse(ev.score(case, {"reply": "x", "ai_provider": "fallback"})["correct"])

    def test_citation_scores(self):
        case = _case("answer", must=["5"], docs=["fine-calculation"])
        body = {"reply": "5", "context_sources": [{"endpoint": "faq://fine-calculation"}, {"endpoint": "faq://book-care"}]}
        scored = ev.score(case, body)
        self.assertEqual(scored["citation_precision"], 0.5)
        self.assertTrue(scored["citation_complete"])


if __name__ == "__main__":
    unittest.main()
