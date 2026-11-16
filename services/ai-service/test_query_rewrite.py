"""RAG Phase 3: selective query rewriting - offline (the LLM provider is mocked)."""
from __future__ import annotations

import asyncio
import unittest
from types import SimpleNamespace
from unittest import mock

import nlu
import query_rewrite

HISTORY = "user: Mỗi hạng thành viên được mượn tối đa bao nhiêu quyển sách?"


def provider_returning(text=None, error=None):
    async def chat(**_kwargs):
        if error:
            raise error
        return SimpleNamespace(text=text)
    return mock.patch.object(query_rewrite, "_provider", return_value=SimpleNamespace(chat=mock.AsyncMock(side_effect=chat)))


def rewrite(message, history=HISTORY):
    return asyncio.run(query_rewrite.rewrite(message, history))


class EligibilityTest(unittest.TestCase):
    def test_follow_ups_are_eligible_only_with_history(self):
        for message in ("Còn hạng Bạc Sĩ thì sao?", "Hạng đó phạt bao nhiêu một ngày?", "Còn gia hạn được mấy lần?",
                        "Bao lâu?"):
            self.assertTrue(query_rewrite.is_eligible(message, HISTORY), message)
            self.assertFalse(query_rewrite.is_eligible(message, ""), message)

    def test_identifiers_and_complete_questions_are_never_eligible(self):
        for message in ("Tìm sách ISBN 9780735211292", 'Có cuốn "Mắt Biếc" không?', "Thẻ Đọc được mượn mấy cuốn?",
                        "Phí phạt trả sách trễ hạn được tính như thế nào?",
                        "Còn nợ tiền phạt thì có mượn thêm sách được không?"):
            self.assertFalse(query_rewrite.is_eligible(message, HISTORY), message)


class RewriteTest(unittest.TestCase):
    def test_valid_rewrite_is_used_and_original_kept(self):
        with provider_returning("Hạng Bạc Sĩ được mượn tối đa bao nhiêu quyển sách?"):
            result = rewrite("Còn hạng Bạc Sĩ thì sao?")
        self.assertEqual((result.status, result.query), ("rewritten", "Hạng Bạc Sĩ được mượn tối đa bao nhiêu quyển sách?"))
        self.assertEqual(result.original, "Còn hạng Bạc Sĩ thì sao?")

    def test_rewrite_that_adds_a_number_or_drops_the_users_words_falls_back(self):
        for bad in ("Hạng Bạc Sĩ được mượn tối đa 7 quyển sách?", "Hạng Vàng Hoàng được mượn tối đa bao nhiêu?", ""):
            with provider_returning(bad):
                result = rewrite("Còn hạng Bạc Sĩ thì sao?")
            self.assertEqual((result.status, result.query), ("invalid", "Còn hạng Bạc Sĩ thì sao?"), bad)

    def test_provider_error_or_timeout_falls_back_to_the_original(self):
        for error in (TimeoutError(), RuntimeError("boom")):
            with provider_returning(error=error):
                result = rewrite("Còn hạng Bạc Sĩ thì sao?")
            self.assertEqual((result.status, result.query), ("failed", "Còn hạng Bạc Sĩ thì sao?"))

    def test_not_eligible_or_disabled_never_calls_the_provider(self):
        with provider_returning("x") as patched:
            self.assertEqual(rewrite("Phí phạt trả sách trễ hạn được tính như thế nào?").status, "not_eligible")
            with mock.patch.object(query_rewrite, "QUERY_REWRITE_ENABLED", False):
                self.assertEqual(rewrite("Còn hạng Bạc Sĩ thì sao?").status, "disabled")
        patched.assert_not_called()


class NluWiringTest(unittest.TestCase):
    # the NLU cache key includes a hash of the history, so each test uses its own history
    def test_policy_follow_up_gets_a_standalone_query(self):
        history = [{"role": "user", "content": "Mỗi hạng thành viên được mượn tối đa bao nhiêu quyển sách?"},
                   {"role": "assistant", "content": "Thẻ Đọc 3 cuốn... (wiring test)"}]
        with provider_returning("Hạng Bạc Sĩ được mượn tối đa bao nhiêu quyển sách?"):
            shape = asyncio.run(nlu.classify_user_message("Còn hạng Bạc Sĩ thì sao?", history))
        self.assertEqual(shape["intent"], nlu.GENERAL_QUERY)
        self.assertEqual(shape["query"], "Hạng Bạc Sĩ được mượn tối đa bao nhiêu quyển sách?")
        self.assertEqual((shape["query_original"], shape["query_rewrite"]), ("Còn hạng Bạc Sĩ thì sao?", "rewritten"))

    def test_without_history_the_query_is_the_message(self):
        with provider_returning("should not be used"):
            shape = asyncio.run(nlu.classify_user_message("Còn hạng Thượng Đế thì sao?", []))
        self.assertEqual(shape["query"], "Còn hạng Thượng Đế thì sao?")
        self.assertEqual(shape["query_rewrite"], "not_eligible")


if __name__ == "__main__":
    unittest.main()
