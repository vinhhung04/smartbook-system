"""Unit tests for llm_provider.py: the OpenRouter message/tool-call adapters,
the provider factory, and OpenRouterProvider's chat()/chat_stream()/
analyze_image() against a mocked httpx transport (no real network calls -
see eval/README.md for the live eval scripts that exercise the real API).
"""
import asyncio
import json
import os
import unittest
from unittest import mock

import httpx

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


class SniffImageMimeTests(unittest.TestCase):
    def test_jpeg_magic_bytes(self):
        self.assertEqual(lp._sniff_image_mime(b"\xff\xd8\xff\xe0rest"), "image/jpeg")

    def test_png_magic_bytes(self):
        self.assertEqual(lp._sniff_image_mime(b"\x89PNG\r\n\x1a\nrest"), "image/png")

    def test_webp_magic_bytes(self):
        self.assertEqual(lp._sniff_image_mime(b"RIFF????WEBPrest"), "image/webp")

    def test_unknown_bytes_default_to_jpeg(self):
        self.assertEqual(lp._sniff_image_mime(b"not-an-image"), "image/jpeg")


_RealAsyncClient = httpx.AsyncClient


def _make_transport(handler):
    return httpx.MockTransport(handler)


def _patch_async_client(handler):
    """Patches httpx.AsyncClient so every instance created inside
    llm_provider uses a MockTransport - no real network calls."""
    def _factory(*args, **kwargs):
        kwargs.pop("timeout", None)
        return _RealAsyncClient(transport=_make_transport(handler), timeout=5.0)
    return mock.patch("httpx.AsyncClient", side_effect=_factory)


def _run(coro):
    return asyncio.run(coro)


class ChatTests(unittest.TestCase):
    def setUp(self):
        self.provider = lp.OpenRouterProvider(api_key="sk-fake", base_url="https://openrouter.ai/api/v1", model="qwen/qwen3.7-flash")

    def test_chat_success_returns_text_and_usage(self):
        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(200, json={
                "choices": [{"message": {"role": "assistant", "content": "Xin chao"}}],
                "usage": {"prompt_tokens": 10, "completion_tokens": 3, "cost": 0.0001},
            })

        with _patch_async_client(handler):
            result = _run(self.provider.chat([{"role": "user", "content": "hi"}], [], num_predict=50, timeout=5, feature="chat"))

        self.assertEqual(result.text, "Xin chao")
        self.assertEqual(result.tool_calls, [])
        self.assertEqual(result.usage.prompt_tokens, 10)
        self.assertEqual(result.usage.completion_tokens, 3)
        self.assertEqual(result.usage.cost_usd, 0.0001)
        self.assertEqual(result.usage.feature, "chat")
        self.assertEqual(result.usage.model, "qwen/qwen3.7-flash")

    def test_chat_with_tool_calls(self):
        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(200, json={
                "choices": [{"message": {
                    "role": "assistant", "content": "",
                    "tool_calls": [{"id": "call_1", "type": "function",
                                     "function": {"name": "get_top_books", "arguments": '{"limit": 5}'}}],
                }}],
                "usage": {"prompt_tokens": 20, "completion_tokens": 8},
            })

        with _patch_async_client(handler):
            result = _run(self.provider.chat([{"role": "user", "content": "top books?"}], [{"type": "function"}], num_predict=50, timeout=5))

        self.assertEqual(result.text, "")
        self.assertEqual(result.tool_calls, [{"function": {"name": "get_top_books", "arguments": {"limit": 5}}}])
        self.assertEqual(result.usage.tool_call_count, 1)

    def test_malformed_response_missing_choices_raises_and_logs_error_usage(self):
        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(200, json={"choices": []})

        with _patch_async_client(handler):
            with self.assertRaises(Exception):
                _run(self.provider.chat([{"role": "user", "content": "hi"}], [], num_predict=50, timeout=5))

    def test_timeout_retries_once_then_raises_without_fallback(self):
        calls = []

        def handler(request: httpx.Request) -> httpx.Response:
            calls.append(1)
            raise httpx.TimeoutException("timed out", request=request)

        with _patch_async_client(handler):
            with self.assertRaises(httpx.TimeoutException):
                _run(self.provider.chat([{"role": "user", "content": "hi"}], [], num_predict=50, timeout=5))
        self.assertEqual(len(calls), 2)  # primary attempted, then retried once

    def test_primary_failure_falls_back_to_fallback_model(self):
        provider = lp.OpenRouterProvider(
            api_key="sk-fake", base_url="https://openrouter.ai/api/v1",
            model="qwen/qwen3.7-flash", fallback_model="qwen/qwen3.7-plus",
        )
        seen_models = []

        def handler(request: httpx.Request) -> httpx.Response:
            body = json.loads(request.content)
            seen_models.append(body["model"])
            if body["model"] == "qwen/qwen3.7-flash":
                return httpx.Response(500, json={"error": "upstream down"})
            return httpx.Response(200, json={
                "choices": [{"message": {"role": "assistant", "content": "from fallback"}}],
                "usage": {"prompt_tokens": 5, "completion_tokens": 2},
            })

        with _patch_async_client(handler):
            result = _run(provider.chat([{"role": "user", "content": "hi"}], [], num_predict=50, timeout=5))

        self.assertEqual(result.text, "from fallback")
        self.assertEqual(result.usage.model, "qwen/qwen3.7-plus")
        # primary tried twice (1 retry on 5xx), then fallback once
        self.assertEqual(seen_models, ["qwen/qwen3.7-flash", "qwen/qwen3.7-flash", "qwen/qwen3.7-plus"])

    def test_non_retryable_error_skips_same_model_retry(self):
        provider = lp.OpenRouterProvider(
            api_key="sk-fake", base_url="https://openrouter.ai/api/v1",
            model="qwen/qwen3.7-flash", fallback_model="qwen/qwen3.7-plus",
        )
        seen_models = []

        def handler(request: httpx.Request) -> httpx.Response:
            body = json.loads(request.content)
            seen_models.append(body["model"])
            if body["model"] == "qwen/qwen3.7-flash":
                return httpx.Response(400, json={"error": "bad request"})
            return httpx.Response(200, json={
                "choices": [{"message": {"role": "assistant", "content": "ok"}}],
                "usage": {},
            })

        with _patch_async_client(handler):
            _run(provider.chat([{"role": "user", "content": "hi"}], [], num_predict=50, timeout=5))

        self.assertEqual(seen_models, ["qwen/qwen3.7-flash", "qwen/qwen3.7-plus"])


class ChatStreamTests(unittest.TestCase):
    def test_stream_accumulates_text_and_usage(self):
        provider = lp.OpenRouterProvider(api_key="sk-fake", base_url="https://openrouter.ai/api/v1", model="qwen/qwen3.7-flash")
        sse_lines = [
            'data: {"choices": [{"delta": {"content": "Xin "}}]}',
            'data: {"choices": [{"delta": {"content": "chao"}}]}',
            'data: {"choices": [{"delta": {}}], "usage": {"prompt_tokens": 4, "completion_tokens": 2, "cost": 0.00002}}',
            "data: [DONE]",
        ]

        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(200, text="\n\n".join(sse_lines) + "\n\n", headers={"content-type": "text/event-stream"})

        async def collect():
            chunks = []
            with _patch_async_client(handler):
                async for chunk in provider.chat_stream([{"role": "user", "content": "hi"}], [], num_predict=50, timeout=5, feature="chat"):
                    chunks.append(chunk)
            return chunks

        chunks = _run(collect())
        self.assertEqual("".join(c.delta for c in chunks if not c.done), "Xin chao")
        final = chunks[-1]
        self.assertTrue(final.done)
        self.assertEqual(final.text, "Xin chao")
        self.assertEqual(final.usage.prompt_tokens, 4)
        self.assertEqual(final.usage.cost_usd, 0.00002)
        self.assertEqual(final.usage.feature, "chat")


class AnalyzeImageTests(unittest.TestCase):
    def setUp(self):
        self.provider = lp.OpenRouterProvider(api_key="sk-fake", base_url="https://openrouter.ai/api/v1", model="qwen/qwen3.7-flash")
        self.jpeg_bytes = b"\xff\xd8\xff\xe0fakejpegbytes"

    def test_sends_data_url_and_json_object_response_format(self):
        captured = {}

        def handler(request: httpx.Request) -> httpx.Response:
            captured["body"] = json.loads(request.content)
            return httpx.Response(200, json={
                "choices": [{"message": {"content": json.dumps({"title": "Doraemon", "author": "Fujiko F Fujio"})}}],
                "usage": {"prompt_tokens": 500, "completion_tokens": 15, "cost": 0.00003},
            })

        with _patch_async_client(handler):
            parsed, usage = _run(self.provider.analyze_image(
                self.jpeg_bytes, "Read the title/author.", max_tokens=200, timeout=15, feature="cover_ocr"))

        self.assertEqual(parsed, {"title": "Doraemon", "author": "Fujiko F Fujio"})
        self.assertEqual(usage.feature, "cover_ocr")
        self.assertEqual(usage.cost_usd, 0.00003)
        body = captured["body"]
        self.assertEqual(body["response_format"], {"type": "json_object"})
        image_url = body["messages"][0]["content"][1]["image_url"]["url"]
        self.assertTrue(image_url.startswith("data:image/jpeg;base64,"))

    def test_invalid_json_content_raises_vision_response_error(self):
        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(200, json={
                "choices": [{"message": {"content": "not json at all"}}],
                "usage": {},
            })

        with _patch_async_client(handler):
            with self.assertRaises(lp.VisionResponseError):
                _run(self.provider.analyze_image(self.jpeg_bytes, "prompt", max_tokens=200, timeout=15))

    def test_non_object_json_content_raises_vision_response_error(self):
        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(200, json={
                "choices": [{"message": {"content": "[1, 2, 3]"}}],
                "usage": {},
            })

        with _patch_async_client(handler):
            with self.assertRaises(lp.VisionResponseError):
                _run(self.provider.analyze_image(self.jpeg_bytes, "prompt", max_tokens=200, timeout=15))

    def test_upstream_error_propagates(self):
        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(500, json={"error": "down"})

        with _patch_async_client(handler):
            with self.assertRaises(Exception):
                _run(self.provider.analyze_image(self.jpeg_bytes, "prompt", max_tokens=200, timeout=15))


class GetOpenrouterProviderTests(unittest.TestCase):
    def setUp(self):
        lp.get_openrouter_provider.cache_clear()
        self._env_patch = mock.patch.dict(os.environ, {}, clear=False)
        self._env_patch.start()

    def tearDown(self):
        self._env_patch.stop()
        lp.get_openrouter_provider.cache_clear()

    def test_missing_api_key_raises(self):
        os.environ.pop("OPENROUTER_API_KEY", None)
        with self.assertRaises(ValueError):
            lp.get_openrouter_provider("qwen/qwen3.7-flash")

    def test_builds_provider_with_configured_model(self):
        os.environ["OPENROUTER_API_KEY"] = "sk-fake"
        provider = lp.get_openrouter_provider("qwen/qwen3.7-flash")
        self.assertIsInstance(provider, lp.OpenRouterProvider)
        self.assertEqual(provider.model, "qwen/qwen3.7-flash")
        self.assertEqual(provider._base_url, "https://openrouter.ai/api/v1")

    def test_is_cached_per_model(self):
        os.environ["OPENROUTER_API_KEY"] = "sk-fake"
        first = lp.get_openrouter_provider("qwen/qwen3.7-flash")
        second = lp.get_openrouter_provider("qwen/qwen3.7-flash")
        self.assertIs(first, second)


if __name__ == "__main__":
    unittest.main()
