"""Unit tests for llm_provider.py's pure logic: the Ollama<->Anthropic message
and tool-schema adapters, response parsing, and the provider factory. No
network calls - AnthropicProvider/OllamaProvider's actual chat()/chat_stream()
methods talk to real services and are exercised by the live eval scripts
instead (see eval/README.md), not here.
"""
import unittest
from types import SimpleNamespace

import llm_provider as lp


class ToAnthropicToolsTests(unittest.TestCase):
    def test_unwraps_the_openai_style_function_wrapper(self):
        tools = [{
            "type": "function",
            "function": {
                "name": "get_overdue_summary",
                "description": "Lay tong so phieu qua han.",
                "parameters": {"type": "object", "properties": {}, "required": []},
            },
        }]
        converted = lp._to_anthropic_tools(tools)
        self.assertEqual(converted, [{
            "name": "get_overdue_summary",
            "description": "Lay tong so phieu qua han.",
            "input_schema": {"type": "object", "properties": {}, "required": []},
        }])

    def test_missing_parameters_falls_back_to_empty_object_schema(self):
        tools = [{"type": "function", "function": {"name": "x"}}]
        converted = lp._to_anthropic_tools(tools)
        self.assertEqual(converted[0]["input_schema"], {"type": "object", "properties": {}})


class ToAnthropicMessagesTests(unittest.TestCase):
    def test_system_messages_are_pulled_out_of_the_list(self):
        messages = [{"role": "system", "content": "You are helpful."}, {"role": "user", "content": "hi"}]
        system, converted = lp.to_anthropic_messages(messages)
        self.assertEqual(system, "You are helpful.")
        self.assertEqual(converted, [{"role": "user", "content": "hi"}])

    def test_multiple_system_messages_are_joined(self):
        messages = [
            {"role": "system", "content": "Part one."},
            {"role": "system", "content": "Part two."},
            {"role": "user", "content": "hi"},
        ]
        system, _ = lp.to_anthropic_messages(messages)
        self.assertEqual(system, "Part one.\n\nPart two.")

    def test_assistant_tool_calls_become_tool_use_blocks_with_generated_ids(self):
        messages = [{
            "role": "assistant", "content": "",
            "tool_calls": [{"function": {"name": "get_dashboard_kpis", "arguments": {}}}],
        }]
        _, converted = lp.to_anthropic_messages(messages)
        self.assertEqual(len(converted), 1)
        block = converted[0]["content"][0]
        self.assertEqual(block["type"], "tool_use")
        self.assertEqual(block["name"], "get_dashboard_kpis")
        self.assertTrue(block["id"])

    def test_consecutive_tool_messages_are_grouped_into_one_user_message(self):
        messages = [
            {"role": "user", "content": "kpi va qua han?"},
            {
                "role": "assistant", "content": "",
                "tool_calls": [
                    {"function": {"name": "get_dashboard_kpis", "arguments": {}}},
                    {"function": {"name": "get_overdue_summary", "arguments": {}}},
                ],
            },
            {"role": "tool", "tool_name": "get_dashboard_kpis", "content": "{\"a\": 1}"},
            {"role": "tool", "tool_name": "get_overdue_summary", "content": "{\"b\": 2}"},
        ]
        _, converted = lp.to_anthropic_messages(messages)
        # user, assistant(tool_use x2), user(tool_result x2) - not two separate user messages.
        self.assertEqual(len(converted), 3)
        tool_result_message = converted[2]
        self.assertEqual(tool_result_message["role"], "user")
        self.assertEqual(len(tool_result_message["content"]), 2)
        self.assertEqual(tool_result_message["content"][0]["type"], "tool_result")

    def test_tool_result_ids_match_the_preceding_tool_use_ids_in_order(self):
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
        _, converted = lp.to_anthropic_messages(messages)
        assistant_msg, tool_result_msg = converted
        ids_used = [b["id"] for b in assistant_msg["content"]]
        ids_referenced = [b["tool_use_id"] for b in tool_result_msg["content"]]
        self.assertEqual(ids_used, ids_referenced)
        self.assertEqual([b["content"] for b in tool_result_msg["content"]], ["A", "B"])

    def test_plain_assistant_text_message_round_trips(self):
        messages = [{"role": "assistant", "content": "Xin chao."}]
        _, converted = lp.to_anthropic_messages(messages)
        self.assertEqual(converted, [{"role": "assistant", "content": [{"type": "text", "text": "Xin chao."}]}])

    def test_second_round_of_tool_calls_gets_fresh_ids_not_reused(self):
        messages = [
            {"role": "assistant", "content": "", "tool_calls": [{"function": {"name": "a", "arguments": {}}}]},
            {"role": "tool", "tool_name": "a", "content": "1"},
            {"role": "assistant", "content": "", "tool_calls": [{"function": {"name": "b", "arguments": {}}}]},
            {"role": "tool", "tool_name": "b", "content": "2"},
        ]
        _, converted = lp.to_anthropic_messages(messages)
        first_id = converted[0]["content"][0]["id"]
        second_id = converted[2]["content"][0]["id"]
        self.assertNotEqual(first_id, second_id)


class MessageFromAnthropicResponseTests(unittest.TestCase):
    def test_text_only_response(self):
        blocks = [SimpleNamespace(type="text", text="Xin chao")]
        message, tool_calls, text = lp._message_from_anthropic_response(blocks)
        self.assertEqual(tool_calls, [])
        self.assertEqual(text, "Xin chao")
        self.assertEqual(message, {"role": "assistant", "content": "Xin chao"})

    def test_tool_use_response(self):
        blocks = [SimpleNamespace(type="tool_use", name="get_top_books", input={"limit": 5}, id="toolu_1")]
        message, tool_calls, text = lp._message_from_anthropic_response(blocks)
        self.assertEqual(tool_calls, [{"function": {"name": "get_top_books", "arguments": {"limit": 5}}}])
        self.assertEqual(message["tool_calls"], tool_calls)

    def test_mixed_text_and_tool_use_keeps_only_tool_calls_in_message(self):
        blocks = [
            SimpleNamespace(type="text", text="Đang tra cứu..."),
            SimpleNamespace(type="tool_use", name="get_fine_summary", input={}, id="toolu_2"),
        ]
        message, tool_calls, text = lp._message_from_anthropic_response(blocks)
        self.assertEqual(len(tool_calls), 1)
        self.assertEqual(message["content"], "")  # matches OllamaProvider's own convention


class AnthropicProviderBaseUrlTests(unittest.TestCase):
    """Regression: ANTHROPIC_BASE_URL's documented default
    ("https://api.anthropic.com/v1") was written for the old raw-httpx call
    sites, which append "/messages" themselves. The SDK's base_url is the
    API root and appends "/v1/messages" internally - passing the env var
    through unchanged 404s every real call (found running the live eval
    against the actual endpoint, not caught by earlier isolated smoke tests
    that never passed a base_url override)."""

    def test_trailing_v1_is_stripped(self):
        provider = lp.AnthropicProvider(api_key="sk-fake", base_url="https://api.anthropic.com/v1", model="claude-sonnet-5")
        self.assertEqual(str(provider._client.base_url).rstrip("/"), "https://api.anthropic.com")

    def test_trailing_v1_with_trailing_slash_is_stripped(self):
        provider = lp.AnthropicProvider(api_key="sk-fake", base_url="https://api.anthropic.com/v1/", model="claude-sonnet-5")
        self.assertEqual(str(provider._client.base_url).rstrip("/"), "https://api.anthropic.com")

    def test_a_root_url_without_v1_is_left_alone(self):
        provider = lp.AnthropicProvider(api_key="sk-fake", base_url="https://api.anthropic.com", model="claude-sonnet-5")
        self.assertEqual(str(provider._client.base_url).rstrip("/"), "https://api.anthropic.com")

    def test_none_base_url_uses_the_sdk_default(self):
        provider = lp.AnthropicProvider(api_key="sk-fake", base_url=None, model="claude-sonnet-5")
        self.assertEqual(str(provider._client.base_url).rstrip("/"), "https://api.anthropic.com")


class GetLlmProviderTests(unittest.TestCase):
    def test_default_and_unknown_values_select_ollama(self):
        for value in ["ollama", "", "  ", "something-else"]:
            provider = lp.get_llm_provider(value, ollama_host="http://x:1", ollama_model="m")
            self.assertIsInstance(provider, lp.OllamaProvider)

    def test_is_case_and_whitespace_insensitive(self):
        provider = lp.get_llm_provider("  Ollama  ", ollama_host="http://x:1", ollama_model="m")
        self.assertIsInstance(provider, lp.OllamaProvider)

    def test_anthropic_without_api_key_raises(self):
        with self.assertRaises(ValueError):
            lp.get_llm_provider("anthropic", ollama_host="h", ollama_model="m", anthropic_api_key="")

    def test_anthropic_with_api_key_builds_anthropic_provider(self):
        provider = lp.get_llm_provider(
            "anthropic", ollama_host="h", ollama_model="m",
            anthropic_api_key="sk-fake", anthropic_model="claude-sonnet-5",
        )
        self.assertIsInstance(provider, lp.AnthropicProvider)
        self.assertEqual(provider.model, "claude-sonnet-5")


if __name__ == "__main__":
    unittest.main()
