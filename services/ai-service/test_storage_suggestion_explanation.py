"""Tests for /explain-storage-suggestion: Qwen must only paraphrase backend-provided
reasons, and the rule-based fallback must still work when the AI call fails."""
import asyncio
import unittest
from unittest.mock import patch

import main


def _run(coro):
    return asyncio.run(coro)


class StorageSuggestionExplanationFallbackTests(unittest.TestCase):
    def test_falls_back_to_rule_based_explanation_when_the_ai_call_fails(self):
        request = main.StorageSuggestionRequest(
            book={"title": "Doraemon", "categories": ["Truyện tranh"], "authors": ["Fujiko F. Fujio"]},
            suggestions=[
                {"location_code": "A1-01", "score": 85, "reasons": ["Cùng variant"]},
                {"location_code": "A1-02", "score": 40, "reasons": []},
            ],
        )

        with patch("main._call_text_llm", side_effect=RuntimeError("LLM unavailable")):
            result = _run(main.explain_storage_suggestion(request))

        self.assertEqual(result["ai_provider"], "fallback")
        self.assertEqual(len(result["explanations"]), len(request.suggestions))
        for explanation in result["explanations"]:
            self.assertIsInstance(explanation, str)
            self.assertTrue(explanation)

    def test_falls_back_when_the_ai_response_has_the_wrong_number_of_explanations(self):
        request = main.StorageSuggestionRequest(
            book={"title": "Doraemon", "categories": [], "authors": []},
            suggestions=[
                {"location_code": "A1-01", "score": 85, "reasons": ["Cùng variant"]},
                {"location_code": "A1-02", "score": 40, "reasons": []},
            ],
        )

        with patch("main._call_text_llm", return_value=("[\"only one\"]", True)):
            result = _run(main.explain_storage_suggestion(request))

        self.assertEqual(result["ai_provider"], "fallback")
        self.assertEqual(len(result["explanations"]), len(request.suggestions))

    def test_empty_suggestions_short_circuits_without_calling_the_llm(self):
        request = main.StorageSuggestionRequest(book={}, suggestions=[])

        with patch("main._call_text_llm") as mock_call:
            result = _run(main.explain_storage_suggestion(request))

        mock_call.assert_not_called()
        self.assertEqual(result, {"explanations": []})


class StorageSuggestionPromptConstraintsTests(unittest.TestCase):
    """Weak but cheap regression guard: the anti-fabrication constraints must stay
    in the prompt if someone edits it later — Qwen must never invent facts or
    re-rank suggestions (see storage-suggestion.service.js: ranking is fully
    decided before this endpoint is ever called)."""

    def test_system_prompt_forbids_reordering_and_fabricating_reasons(self):
        captured = {}

        async def fake_call_text_llm(system_prompt, user_prompt, **kwargs):
            captured["system_prompt"] = system_prompt
            captured["user_prompt"] = user_prompt
            return "[]", False

        request = main.StorageSuggestionRequest(
            book={"title": "X", "categories": [], "authors": []},
            suggestions=[{"location_code": "A1-01", "score": 50, "reasons": ["r"]}],
        )

        with patch("main._call_text_llm", side_effect=fake_call_text_llm):
            _run(main.explain_storage_suggestion(request))

        system_prompt = captured["system_prompt"]
        self.assertIn("KHÔNG được", system_prompt)
        self.assertIn("thứ tự", system_prompt)
        self.assertIn("gần khu picking", system_prompt)

        user_prompt = captured["user_prompt"]
        self.assertIn("reasons", user_prompt)
        self.assertIn("KHÔNG", user_prompt)


if __name__ == "__main__":
    unittest.main()
