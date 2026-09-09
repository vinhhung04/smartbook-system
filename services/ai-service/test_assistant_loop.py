"""Unit tests for assistant_loop.py - the shared fast-path-seeding and
tool-round-execution helpers /assistant and /assistant/stream both call into.

These test the helpers in isolation via fake run_tool_call/run_fast_path_tool/
render_tool_result callables, independent of main.py, Ollama, or the gateway.
"""
import asyncio
import unittest

from assistant_loop import (
    TOOL_LOOP_EXHAUSTED_MESSAGE,
    execute_tool_round,
    retry_once_if_ungrounded,
    seed_fast_path,
)


def _run(coro):
    return asyncio.run(coro)


class SeedFastPathTests(unittest.TestCase):
    def test_no_fast_path_hit_returns_empty_state_and_round_zero(self):
        async def run_fast_path_tool(message, auth_header):
            return []

        messages: list[dict] = []
        tools_used, collected_data, start_round = _run(
            seed_fast_path("hello", None, messages, run_fast_path_tool, lambda n, r: "x")
        )
        self.assertEqual(tools_used, [])
        self.assertEqual(collected_data, {})
        self.assertEqual(start_round, 0)
        self.assertEqual(messages, [])

    def test_fast_path_hit_seeds_messages_and_advances_to_round_one(self):
        async def run_fast_path_tool(message, auth_header):
            return [{"tool_name": "get_overdue_summary", "tool_args": {}, "tool_result": {"total_overdue_loans": 27}}]

        rendered = []

        def render_tool_result(name, result):
            rendered.append((name, result))
            return f"RENDERED:{name}"

        messages: list[dict] = [{"role": "system", "content": "sys"}]
        tools_used, collected_data, start_round = _run(
            seed_fast_path("bao nhieu qua han", "Bearer t", messages, run_fast_path_tool, render_tool_result)
        )

        self.assertEqual(start_round, 1)
        self.assertEqual(tools_used, [{"name": "get_overdue_summary", "arguments": {}}])
        self.assertEqual(collected_data, {"get_overdue_summary": {"total_overdue_loans": 27}})
        # Original messages list is preserved and appended to, not replaced.
        self.assertEqual(messages[0], {"role": "system", "content": "sys"})
        self.assertEqual(messages[1]["role"], "assistant")
        self.assertEqual(messages[1]["tool_calls"][0]["function"]["name"], "get_overdue_summary")
        self.assertEqual(messages[2], {"role": "tool", "tool_name": "get_overdue_summary", "content": "RENDERED:get_overdue_summary"})
        self.assertEqual(rendered, [("get_overdue_summary", {"total_overdue_loans": 27})])

    def test_multiple_fast_path_tools_all_seeded(self):
        async def run_fast_path_tool(message, auth_header):
            return [
                {"tool_name": "get_dashboard_kpis", "tool_args": {}, "tool_result": {"a": 1}},
                {"tool_name": "get_overdue_summary", "tool_args": {}, "tool_result": {"b": 2}},
            ]

        messages: list[dict] = []
        tools_used, collected_data, start_round = _run(
            seed_fast_path("kpi va qua han", None, messages, run_fast_path_tool, lambda n, r: "x")
        )
        self.assertEqual(start_round, 1)
        self.assertEqual(len(tools_used), 2)
        self.assertEqual(set(collected_data.keys()), {"get_dashboard_kpis", "get_overdue_summary"})
        # One assistant message carrying both tool_calls, then one tool message per result.
        self.assertEqual(len(messages), 3)
        self.assertEqual(len(messages[0]["tool_calls"]), 2)


class ExecuteToolRoundTests(unittest.TestCase):
    def test_runs_all_calls_and_appends_tool_messages(self):
        async def run_tool_call(name, args, auth_header):
            return name, {"echo": args}

        tool_calls = [
            {"function": {"name": "get_fine_summary", "arguments": {"warehouse": "hn"}}},
            {"function": {"name": "get_top_books", "arguments": None}},
        ]
        tools_used: list[dict] = []
        collected_data: dict = {}
        messages: list[dict] = []

        _run(execute_tool_round(
            tool_calls, "Bearer t", tools_used, collected_data, messages, run_tool_call, lambda n, r: f"R:{n}",
        ))

        self.assertEqual(tools_used, [
            {"name": "get_fine_summary", "arguments": {"warehouse": "hn"}},
            {"name": "get_top_books", "arguments": {}},
        ])
        self.assertEqual(collected_data["get_fine_summary"], {"echo": {"warehouse": "hn"}})
        self.assertEqual(collected_data["get_top_books"], {"echo": {}})
        self.assertEqual(len(messages), 2)
        self.assertEqual(messages[0]["role"], "tool")

    def test_second_call_to_same_tool_is_kept_under_hash2_key(self):
        async def run_tool_call(name, args, auth_header):
            return name, {"range": args.get("days")}

        tool_calls = [
            {"function": {"name": "get_borrow_trends", "arguments": {"days": 7}}},
            {"function": {"name": "get_borrow_trends", "arguments": {"days": 30}}},
        ]
        collected_data: dict = {}
        messages: list[dict] = []

        _run(execute_tool_round(
            tool_calls, None, [], collected_data, messages, run_tool_call, lambda n, r: "x",
        ))

        self.assertEqual(collected_data["get_borrow_trends"], {"range": 7})
        self.assertEqual(collected_data["get_borrow_trends#2"], {"range": 30})

    def test_existing_collected_data_and_messages_are_preserved(self):
        async def run_tool_call(name, args, auth_header):
            return name, {}

        collected_data = {"already_here": {"x": 1}}
        messages = [{"role": "system", "content": "sys"}]

        _run(execute_tool_round(
            [{"function": {"name": "get_reservation_funnel", "arguments": {}}}],
            None, [], collected_data, messages, run_tool_call, lambda n, r: "x",
        ))

        self.assertIn("already_here", collected_data)
        self.assertIn("get_reservation_funnel", collected_data)
        self.assertEqual(messages[0], {"role": "system", "content": "sys"})


class ExhaustedMessageTests(unittest.TestCase):
    def test_exhausted_message_is_vietnamese_and_nonempty(self):
        self.assertTrue(TOOL_LOOP_EXHAUSTED_MESSAGE)
        self.assertIn("Xin lỗi", TOOL_LOOP_EXHAUSTED_MESSAGE)


class _FakeUsage:
    def __init__(self, tag):
        self.tag = tag

    def as_dict(self):
        return {"tag": self.tag}


class _FakeChatResult:
    def __init__(self, assistant_message, tool_calls=None, text=""):
        self.assistant_message = assistant_message
        self.tool_calls = tool_calls or []
        self.text = text
        self.usage = _FakeUsage("retry")


class RetryOnceIfUngroundedTests(unittest.TestCase):
    def test_no_warning_means_no_retry_and_original_answer_kept(self):
        called = []

        async def call_model(messages, tools, *, num_predict, timeout):
            called.append(1)
            return _FakeChatResult({"role": "assistant", "content": "should not be used"})

        answer, usage = _run(retry_once_if_ungrounded(
            [], "Có 27 phiếu.", None, call_model, [], 700, 30,
        ))
        self.assertEqual(answer, "Có 27 phiếu.")
        self.assertIsNone(usage)
        self.assertEqual(called, [])

    def test_warning_triggers_one_corrective_turn_appended_to_messages(self):
        seen_messages = []

        async def call_model(messages, tools, *, num_predict, timeout):
            seen_messages.append([dict(m) for m in messages])
            return _FakeChatResult({"role": "assistant", "content": "Có 27 phiếu quá hạn."}, text="Có 27 phiếu quá hạn.")

        messages = [{"role": "system", "content": "sys"}]
        answer, usage = _run(retry_once_if_ungrounded(
            messages, "Có 9999 phiếu.", "Số 9999 không khớp dữ liệu.", call_model, [], 700, 30,
        ))

        self.assertEqual(answer, "Có 27 phiếu quá hạn.")
        self.assertEqual(usage, {"tag": "retry"})
        # The correction turn (original answer + a user correction message)
        # must have been appended before calling the model.
        self.assertEqual(seen_messages[0][-2], {"role": "assistant", "content": "Có 9999 phiếu."})
        self.assertEqual(seen_messages[0][-1]["role"], "user")
        self.assertIn("Số 9999 không khớp dữ liệu.", seen_messages[0][-1]["content"])
        # Retry's own reply is appended to `messages` too.
        self.assertEqual(messages[-1], {"role": "assistant", "content": "Có 27 phiếu quá hạn."})

    def test_retry_calling_a_tool_instead_of_answering_keeps_original_answer(self):
        async def call_model(messages, tools, *, num_predict, timeout):
            return _FakeChatResult(
                {"role": "assistant", "content": "", "tool_calls": [{"function": {"name": "x", "arguments": {}}}]},
                tool_calls=[{"function": {"name": "x", "arguments": {}}}],
            )

        answer, usage = _run(retry_once_if_ungrounded(
            [], "Có 9999 phiếu.", "cảnh báo", call_model, [], 700, 30,
        ))
        self.assertEqual(answer, "Có 9999 phiếu.")
        self.assertEqual(usage, {"tag": "retry"})


if __name__ == "__main__":
    unittest.main()
