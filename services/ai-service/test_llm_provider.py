"""Unit tests for llm_provider.py's pure logic: the OpenRouter message/tool-call
adapters and the provider factory. No network calls - OllamaProvider/
OpenRouterProvider's actual chat()/chat_stream() methods talk to real services
and are exercised by the live eval scripts instead (see eval/README.md), not
here.
"""
import unittest

import llm_provider as lp


class ToOpenrouterMessagesTests(unittest.TestCase):
    def test_system_and_user_messages_pass_through_inline(self):
        messages = [{"role": "system", "content": "You are helpful."}, {"role": "user", "content": "hi"}]
        converted = lp.to_openrouter_messages(messages)
        self.assertEqual(converted, [
            {"role": "system", "content": "You are helpful."},
            {"role": "user", "content": "hi"},
        ])

    def test_assistant_tool_calls_get_an_id_and_json_string_arguments(self):
        messages = [{
            "role": "assistant", "content": "",
            "tool_calls": [{"function": {"name": "get_dashboard_kpis", "arguments": {"days": 7}}}],
        }]
        converted = lp.to_openrouter_messages(messages)
        tool_call = converted[0]["tool_calls"][0]
        self.assertEqual(tool_call["type"], "function")
        self.assertTrue(tool_call["id"])
        self.assertEqual(tool_call["function"]["name"], "get_dashboard_kpis")
        self.assertEqual(tool_call["function"]["arguments"], '{"days": 7}')

    def test_tool_result_ids_match_the_preceding_tool_calls_in_order(self):
        messages = [
            {
                "role": "assistant", "content": "",
                "tool_calls": [
                    {"function": {"name": "tool_a", "arguments": {}}},
                    {"function": {"name": "tool_b", "arguments": {}}},
                ],
            },
            {"role": "tool", "tool_name": "tool_a", "content": "A"},
            {"role": "tool", "tool_name": "tool_b", "content": "B"},
        ]
        converted = lp.to_openrouter_messages(messages)
        assistant_msg, tool_msg_a, tool_msg_b = converted
        ids_used = [c["id"] for c in assistant_msg["tool_calls"]]
        self.assertEqual(ids_used, [tool_msg_a["tool_call_id"], tool_msg_b["tool_call_id"]])

    def test_second_round_of_tool_calls_gets_fresh_ids_not_reused(self):
        messages = [
            {"role": "assistant", "content": "", "tool_calls": [{"function": {"name": "a", "arguments": {}}}]},
            {"role": "tool", "tool_name": "a", "content": "1"},
            {"role": "assistant", "content": "", "tool_calls": [{"function": {"name": "b", "arguments": {}}}]},
            {"role": "tool", "tool_name": "b", "content": "2"},
        ]
        converted = lp.to_openrouter_messages(messages)
        first_id = converted[0]["tool_calls"][0]["id"]
        second_id = converted[2]["tool_calls"][0]["id"]
        self.assertNotEqual(first_id, second_id)

    def test_plain_assistant_text_message_round_trips(self):
        messages = [{"role": "assistant", "content": "Xin chao."}]
        converted = lp.to_openrouter_messages(messages)
        self.assertEqual(converted, [{"role": "assistant", "content": "Xin chao."}])


class OpenrouterToolCallsTests(unittest.TestCase):
    def test_none_or_empty_returns_empty_list(self):
        self.assertEqual(lp._openrouter_tool_calls(None), [])
        self.assertEqual(lp._openrouter_tool_calls([]), [])

    def test_json_string_arguments_are_parsed_into_a_dict(self):
        raw = [{"id": "call_1", "type": "function", "function": {"name": "get_top_books", "arguments": '{"limit": 5}'}}]
        converted = lp._openrouter_tool_calls(raw)
        self.assertEqual(converted, [{"function": {"name": "get_top_books", "arguments": {"limit": 5}}}])

    def test_malformed_arguments_json_falls_back_to_empty_dict(self):
        raw = [{"function": {"name": "x", "arguments": "not json"}}]
        converted = lp._openrouter_tool_calls(raw)
        self.assertEqual(converted[0]["function"]["arguments"], {})


class OpenRouterProviderBaseUrlTests(unittest.TestCase):
    def test_trailing_slash_is_stripped(self):
        provider = lp.OpenRouterProvider(api_key="sk-fake", base_url="https://openrouter.ai/api/v1/", model="qwen/qwen3.7-flash")
        self.assertEqual(provider._base_url, "https://openrouter.ai/api/v1")

    def test_empty_fallback_model_normalizes_to_none(self):
        provider = lp.OpenRouterProvider(api_key="sk-fake", base_url="https://openrouter.ai/api/v1", model="m", fallback_model="  ")
        self.assertIsNone(provider._fallback_model)

    def test_fallback_model_is_kept_when_set(self):
        provider = lp.OpenRouterProvider(api_key="sk-fake", base_url="https://openrouter.ai/api/v1", model="m", fallback_model="qwen/other")
        self.assertEqual(provider._fallback_model, "qwen/other")


class GetLlmProviderTests(unittest.TestCase):
    def test_default_and_unknown_values_select_ollama(self):
        for value in ["ollama", "", "  ", "something-else"]:
            provider = lp.get_llm_provider(value, ollama_host="http://x:1", ollama_model="m")
            self.assertIsInstance(provider, lp.OllamaProvider)

    def test_is_case_and_whitespace_insensitive(self):
        provider = lp.get_llm_provider("  Ollama  ", ollama_host="http://x:1", ollama_model="m")
        self.assertIsInstance(provider, lp.OllamaProvider)

    def test_openrouter_without_api_key_raises(self):
        with self.assertRaises(ValueError):
            lp.get_llm_provider("openrouter", ollama_host="h", ollama_model="m", openrouter_api_key="")

    def test_openrouter_with_api_key_builds_openrouter_provider(self):
        provider = lp.get_llm_provider(
            "openrouter", ollama_host="h", ollama_model="m",
            openrouter_api_key="sk-fake", openrouter_model="qwen/qwen3.7-flash",
            openrouter_fallback_model="qwen/other",
        )
        self.assertIsInstance(provider, lp.OpenRouterProvider)
        self.assertEqual(provider.model, "qwen/qwen3.7-flash")
        self.assertEqual(provider._fallback_model, "qwen/other")

    def test_openrouter_default_base_url(self):
        provider = lp.get_llm_provider(
            "openrouter", ollama_host="h", ollama_model="m", openrouter_api_key="sk-fake", openrouter_model="m2",
        )
        self.assertEqual(provider._base_url, "https://openrouter.ai/api/v1")


if __name__ == "__main__":
    unittest.main()
