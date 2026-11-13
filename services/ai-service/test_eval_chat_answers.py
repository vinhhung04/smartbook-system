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
        self.assertEqual(ev.numbers_in("nạp 10.000đ hoặc 200.000 VND"), {"10000", "200000"})  # đ -> d kept the dot

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

    def test_dynamic_data_needs_its_expected_facts_not_just_an_answer(self):
        case = {**_case("dynamic"), "truth": {"kind": "count", "source": "overdue_loans_total"}}
        truth = {"count": 436, "known_ids": set(), "source": "test"}
        answered = {"reply": "Hiện có 436 phiếu mượn quá hạn.", "ai_provider": "openrouter"}
        self.assertEqual(ev.score(case, answered, truth)["verdict"], "PASS")
        # an answer that is fluent but wrong was PASS under the v1 scorer
        wrong = {"reply": "Tổng số phiếu mượn quá hạn: 0. Không có khoản vay nào trễ hạn.", "ai_provider": "openrouter"}
        self.assertEqual(ev.score(case, wrong, truth)["verdict"], "FAIL")
        self.assertEqual(ev.score(case, {"reply": "Chưa có thông tin.", "ai_provider": "openrouter"}, truth)["verdict"], "FAIL")
        self.assertEqual(ev.score(case, {"reply": "x", "ai_provider": "fallback"}, truth)["verdict"], "FAIL")

    def test_dynamic_data_without_truth_is_unverifiable_never_pass(self):
        case = {**_case("dynamic"), "truth": {"kind": "count", "source": "my_active_loans"}}
        scored = ev.score(case, {"reply": "Bạn đang mượn 2 cuốn.", "ai_provider": "openrouter"}, None)
        self.assertEqual((scored["verdict"], scored["correct"]), ("UNVERIFIABLE", None))
        failed_fetch = ev.score(case, {"reply": "2 cuốn", "ai_provider": "openrouter"}, {"error": "HTTP 503"})
        self.assertEqual(failed_fetch["verdict"], "UNVERIFIABLE")
        summary = ev.summarize([{**case, "id": "x", "category": "dynamic_data", **scored}])
        self.assertEqual((summary["verdicts"]["PASS"], summary["answer_accuracy"]), (0, None))

    def test_zero_count_needs_a_none_statement_and_ids_must_be_the_users_own(self):
        case = {**_case("dynamic"), "truth": {"kind": "count", "source": "my_active_loans"}}
        truth = {"count": 0, "known_ids": {"e985fce2-78a6-4a99-918b-5a5dd108b449"}, "source": "test"}
        self.assertEqual(ev.score(case, {"reply": "Bạn không có sách nào đang mượn.", "ai_provider": "o"}, truth)["verdict"], "PASS")
        invented = ev.score(case, {"reply": "Bạn không có sách đang mượn (phiếu 1234abcd).", "ai_provider": "o"}, truth)
        self.assertEqual(invented["verdict"], "FAIL")
        self.assertEqual(invented["dynamic_checks"]["fabricated_ids"], ["1234abcd"])

    def test_authorization_case_must_not_reveal_another_roles_figure(self):
        case = {**_case("dynamic"), "truth": {"kind": "must_not_reveal", "source": "overdue_loans_total"}}
        truth = {"count": 436, "known_ids": set(), "source": "test"}
        self.assertEqual(ev.score(case, {"reply": "Bạn không có phiếu quá hạn nào.", "ai_provider": "o"}, truth)["verdict"], "PASS")
        self.assertEqual(ev.score(case, {"reply": "Thư viện có 436 phiếu quá hạn.", "ai_provider": "o"}, truth)["verdict"], "FAIL")

    def test_today_question_must_not_present_every_task_as_today(self):
        case = {**_case("dynamic"), "truth": {"kind": "tasks_today", "source": "my_open_tasks"}}
        truth = {"count": 12, "total_all_statuses": 47, "created_today": 0, "known_ids": set(), "source": "test"}
        self.assertEqual(ev.score(case, {"reply": "Bạn có 12 việc đang mở.", "ai_provider": "o"}, truth)["verdict"], "PASS")
        self.assertEqual(ev.score(case, {"reply": "Hôm nay bạn có 47 task đang chờ.", "ai_provider": "o"}, truth)["verdict"], "FAIL")

    def test_identifiers_are_not_numbers(self):
        self.assertEqual(ev.numbers_in("Chào customer01, hệ số x1.5, mã act_1a2b"), {"1.5"})

    def test_a_forbidden_phrase_offered_as_an_alternative_is_not_asserted(self):
        case = _case("abstain", must_not=["cam mang thu cung"])
        hedged = {"reply": "Tài liệu chưa có thông tin về việc cho phép hay cấm mang thú cưng."}
        self.assertEqual(ev.score(case, hedged)["forbidden_hits"], [])
        asserted = {"reply": "Chưa có thông tin chi tiết, nhưng thư viện cấm mang thú cưng."}
        self.assertEqual(ev.score(case, asserted)["forbidden_hits"], ["cam mang thu cung"])

    def test_must_include_any_and_referral(self):
        case = {**_case("abstain", must_not=["khong the gia han qua sms"]), "must_include_any": [["quay", "lien he"]]}
        self.assertEqual(ev.score(case, {"reply": "Tài liệu chưa đề cập SMS; vui lòng liên hệ quầy."})["verdict"], "PASS")
        self.assertEqual(ev.score(case, {"reply": "Tài liệu chưa đề cập SMS."})["verdict"], "FAIL")
        self.assertEqual(ev.score(case, {"reply": "Chưa có thông tin; không thể gia hạn qua SMS, hãy đến quầy."})["verdict"],
                         "FAIL")

    def test_numbers_are_checked_against_the_documents(self):
        corpus = {"fine-calculation": "Phạt 2.000 VND mỗi ngày.", "book-care": "Phí 50.000 VND."}
        case = {**_case("answer", must=["6000"], docs=["fine-calculation"]), "question": "Trễ 3 ngày?"}
        body = {"reply": "2.000 x 3 = 6.000 VND", "context_sources": [{"endpoint": "faq://fine-calculation"}]}
        scored = ev.score(case, body, corpus=corpus)
        self.assertEqual((scored["verdict"], scored["numeric_claims"]["unsupported"]), ("PASS", []))
        # a number no document has: invented or derived - rules cannot tell, so never PASS
        invented = ev.score(case, {**body, "reply": "6.000 VND, được giảm 15% nếu trả sớm"}, corpus=corpus)
        self.assertEqual((invented["verdict"], invented["correct"]), ("UNVERIFIABLE", None))
        self.assertEqual([c["type"] for c in invented["unsupported_claims"]], ["INSUFFICIENT_EVIDENCE"])
        uncited = ev.score(case, {**body, "reply": "6.000 VND; sách hư 50.000 VND"}, corpus=corpus)
        self.assertEqual([c["type"] for c in uncited["unsupported_claims"]], ["UNCITED"])

    def test_citation_scores(self):
        case = _case("answer", must=["5"], docs=["fine-calculation"])
        body = {"reply": "5", "context_sources": [{"endpoint": "faq://fine-calculation"}, {"endpoint": "faq://book-care"}]}
        scored = ev.score(case, body)
        self.assertEqual(scored["citation_precision"], 0.5)
        self.assertTrue(scored["citation_complete"])
        self.assertEqual(scored["citation_recall"], 1.0)

    def test_citation_recall_needs_every_expected_document(self):
        case = {**_case("answer", must=["5"], docs=["fine-calculation", "membership-plans-overview"]),
                "acceptable_docs": ["book-care"]}
        body = {"reply": "5", "context_sources": [{"endpoint": "faq://fine-calculation"}, {"endpoint": "faq://book-care"}]}
        scored = ev.score(case, body)
        self.assertEqual((scored["citation_recall"], scored["citation_complete"]), (0.5, False))
        self.assertEqual((scored["citation_precision"], scored["citation_relevance"]), (0.5, 1.0))


if __name__ == "__main__":
    unittest.main()
