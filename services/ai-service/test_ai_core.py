"""Shared AI Core (ai_core/): tool registry and execution policy, prompt
registry, request correlation and the rate-limit key."""
from __future__ import annotations

import asyncio
import os
import unittest
from types import SimpleNamespace
from unittest.mock import patch

import ai_core.tools as tools
from agent_actions import ACTION_CONFIG, DANGEROUS_ACTION_DENYLIST
from agent_schemas import UserContext
from ai_core import observability, policy, prompts
from tool_registry import ANALYTICS_TOOLS, TOOL_FUNCTIONS


class ToolRegistryTest(unittest.TestCase):
    def test_every_model_tool_is_registered_as_read_only(self):
        self.assertEqual(set(tools.READ_TOOLS), set(TOOL_FUNCTIONS))
        self.assertTrue(all(spec.kind == tools.READ for spec in tools.READ_TOOLS.values()))

    def test_no_write_or_forbidden_action_is_exposed_to_the_model(self):
        exposed = {schema["function"]["name"] for schema in ANALYTICS_TOOLS}
        self.assertFalse(exposed & set(ACTION_CONFIG))
        self.assertFalse(exposed & set(DANGEROUS_ACTION_DENYLIST))
        self.assertTrue(all(spec.kind == tools.DRAFT_THEN_CONFIRM for spec in tools.ACTION_TOOLS.values()))
        self.assertTrue(all(config["requires_confirmation"] for config in ACTION_CONFIG.values()))


class RunReadToolTest(unittest.IsolatedAsyncioTestCase):
    async def test_unknown_tool_is_refused(self):
        result = await tools.run_read_tool("delete_all_books", {}, "Bearer x")
        self.assertIn("Unknown tool", result["error"])

    async def test_arguments_are_validated_before_the_tool_runs(self):
        seen = {}

        async def get_top_books(auth_header=None, limit: int = 5, from_date: str = ""):
            seen.update(auth_header=auth_header, limit=limit, from_date=from_date)
            return {"data": []}

        with patch.dict(TOOL_FUNCTIONS, {"get_top_books": get_top_books}), \
             patch.dict(tools.READ_TOOLS, {"get_top_books": tools.ToolSpec(
                 "get_top_books", tools.READ, "", {"properties": {"limit": {"type": "integer"},
                                                                 "from_date": {"type": "string"}}}, "", 30)}):
            await tools.run_read_tool("get_top_books", {"limit": "7", "from_date": 20260101, "warehouse_id": "w-other"},
                                      "Bearer caller")
        # numeric string coerced; wrong type and undeclared arg dropped; the caller's token is the one used
        self.assertEqual(seen, {"auth_header": "Bearer caller", "limit": 7, "from_date": ""})

    async def test_a_hanging_tool_times_out_into_an_error_result(self):
        async def slow(auth_header=None):
            await asyncio.sleep(5)

        with patch.dict(TOOL_FUNCTIONS, {"get_dashboard_kpis": slow}), \
             patch.object(tools, "TOOL_TOTAL_TIMEOUT_SECONDS", 0.05):
            result = await tools.run_read_tool("get_dashboard_kpis", {}, "Bearer x")
        self.assertIn("timed out", result["error"])


class PromptRegistryTest(unittest.TestCase):
    def test_each_use_case_has_its_own_versioned_prompt(self):
        versions = prompts.versions()
        for name in ("chat.system", "chat.rag_rules", "assistant.system", "nlu.classifier"):
            self.assertRegex(versions[name], r"^[0-9a-f]{8}$")
        self.assertNotEqual(prompts.get("chat.system").text, prompts.get("assistant.system").text)
        self.assertEqual(prompts.get("chat.system").use_case, "general_chatbot")
        self.assertEqual(prompts.get("assistant.system").use_case, "decision_assistant")

    def test_version_follows_the_text(self):
        a = prompts.Prompt("x", "u", "một")
        self.assertNotEqual(a.version, prompts.Prompt("x", "u", "hai").version)
        self.assertEqual(a.version, prompts.Prompt("y", "v", "một").version)


class RequestIdTest(unittest.IsolatedAsyncioTestCase):
    async def _call(self, headers):
        seen, sent = {}, []

        async def app(scope, receive, send):
            seen["id"] = observability.current_request_id()
            await send({"type": "http.response.start", "status": 200, "headers": []})

        async def send(message):
            sent.append(message)

        scope = {"type": "http", "headers": [(k.encode(), v.encode()) for k, v in headers.items()]}
        await observability.RequestIdMiddleware(app)(scope, None, send)
        return seen["id"], dict(sent[0]["headers"])[b"x-request-id"].decode()

    async def test_gateway_request_id_is_kept_and_echoed(self):
        inner, echoed = await self._call({"x-request-id": "gw-123"})
        self.assertEqual((inner, echoed), ("gw-123", "gw-123"))
        self.assertEqual(observability.current_request_id(), "-")  # reset after the request

    async def test_malformed_request_id_is_replaced(self):
        inner, _ = await self._call({"x-request-id": "bad id\nwith newline"})
        self.assertRegex(inner, r"^[0-9a-f]{32}$")


class RateLimitKeyTest(unittest.TestCase):
    def _req(self, headers, host="172.18.0.9"):
        return SimpleNamespace(headers=headers, client=SimpleNamespace(host=host))

    def test_authenticated_user_is_keyed_by_user_id(self):
        user = UserContext(user_id="u1")
        self.assertEqual(policy.rate_limit_key(self._req({"x-smartbook-client-ip": "1.2.3.4"}), user), "user:u1")

    def test_anonymous_caller_is_keyed_by_the_ip_the_gateway_vouches_for(self):
        self.assertEqual(policy.rate_limit_key(self._req({"x-smartbook-client-ip": "203.0.113.7"}), None),
                         "ip:203.0.113.7")

    def test_client_written_x_forwarded_for_is_never_trusted(self):
        spoofed = self._req({"x-forwarded-for": "1.1.1.1"})
        self.assertEqual(policy.rate_limit_key(spoofed, None), "ip:172.18.0.9")

    def test_trust_can_be_turned_off(self):
        with patch.dict(os.environ, {"TRUST_GATEWAY_CLIENT_IP": "false"}):
            self.assertEqual(policy.rate_limit_key(self._req({"x-smartbook-client-ip": "203.0.113.7"}), None),
                             "ip:172.18.0.9")


if __name__ == "__main__":
    unittest.main()
