"""Shared building blocks for /assistant and /assistant/stream's tool-calling loop.

Before this module, the fast-path seeding step and the "execute this round's
tool calls" step were two independent, nearly byte-identical copies - one in
main.py's non-streaming /assistant, one in its SSE /assistant/stream event
generator. They had already drifted out of sync once (a fix landing in only
one of the two copies), which is the whole reason this module exists: a fix
to how tool results are rendered into the prompt, or to fast-path seeding,
now lands in exactly one place.

What stays out of this module, deliberately: the actual model call (sync
`ollama.Client().chat()` for /assistant vs. streamed `ollama.AsyncClient()`
with per-chunk token yielding for /assistant/stream) and each endpoint's own
`for _round in range(...)` control flow. Those two call styles are genuinely
different - stream needs to yield SSE token events as text arrives, from
inside an async generator - and forcing them through one shared interface
would trade the duplication this module removes for a queue/task bridge that
is harder to follow and to debug. See docs/superpowers/specs (or ask before
"fixing" this asymmetry) before unifying further.
"""
from __future__ import annotations

import asyncio
from typing import Awaitable, Callable

# Identical give-up text both endpoints used when ASSISTANT_MAX_TOOL_ROUNDS is
# exhausted without the model producing a final answer. Was duplicated as a
# literal string in both call sites; centralised so it can't drift.
TOOL_LOOP_EXHAUSTED_MESSAGE = (
    "Xin lỗi, tôi cần quá nhiều bước tra cứu để trả lời câu này. Bạn có thể hỏi cụ thể hơn không?"
)

# (tool_name, tool_args, auth_header) -> (tool_name, tool_result)
RunToolCall = Callable[[str, dict, "str | None"], Awaitable[tuple[str, dict]]]
# (message_text, auth_header) -> fast-path results, each a
# {"tool_name": str, "tool_args": dict, "tool_result": dict}
RunFastPathTool = Callable[[str, "str | None"], Awaitable[list[dict]]]
# (tool_name, tool_result) -> the text placed in the "tool" role message sent
# back to the model. Step 2 of the plan (tool_context.py) replaces the
# previous `json.dumps(tool_result, ensure_ascii=False)` here.
RenderToolResult = Callable[[str, dict], str]


async def seed_fast_path(
    message_text: str,
    auth_header: "str | None",
    messages: list[dict],
    run_fast_path_tool: RunFastPathTool,
    render_tool_result: RenderToolResult,
) -> tuple[list[dict], dict, int]:
    """Runs the rule-based fast-path tool(s) for round 0, if any apply, and
    appends the resulting synthetic assistant+tool messages to `messages` in
    place (both endpoints then start their real tool-calling loop at the
    returned `start_round`, so a fast-path hit skips a redundant round-0 model
    call for tool selection it already resolved for free).

    Returns (tools_used, collected_data, start_round) - start_round is 1 when
    the fast path fired, else 0 (fall through to the normal loop from round 0).
    """
    fast_results = await run_fast_path_tool(message_text, auth_header)
    if not fast_results:
        return [], {}, 0

    tools_used = [{"name": r["tool_name"], "arguments": r["tool_args"]} for r in fast_results]
    collected_data = {r["tool_name"]: r["tool_result"] for r in fast_results}
    messages.append({
        "role": "assistant", "content": "",
        "tool_calls": [{"function": {"name": r["tool_name"], "arguments": r["tool_args"]}} for r in fast_results],
    })
    for r in fast_results:
        messages.append({
            "role": "tool", "tool_name": r["tool_name"],
            "content": render_tool_result(r["tool_name"], r["tool_result"]),
        })
    return tools_used, collected_data, 1


async def execute_tool_round(
    tool_calls: list[dict],
    auth_header: "str | None",
    tools_used: list[dict],
    collected_data: dict,
    messages: list[dict],
    run_tool_call: RunToolCall,
    render_tool_result: RenderToolResult,
) -> None:
    """Runs every tool call the model requested in one round concurrently
    (all ANALYTICS_TOOLS are read-only GETs, so this is safe), then records
    the results into `tools_used`, `collected_data`, and `messages` - all
    three mutated in place, matching how both endpoints already carried these
    as loop-local state before this extraction.

    A tool called twice in one conversation (e.g. the model asks for two
    different date ranges) must not silently overwrite the first result under
    the same key - the second is stored under f"{name}#2".
    """
    calls = [
        (call["function"]["name"], dict(call["function"]["arguments"] or {}))
        for call in tool_calls
    ]
    tools_used.extend({"name": name, "arguments": args} for name, args in calls)
    results = await asyncio.gather(*(run_tool_call(name, args, auth_header) for name, args in calls))
    for name, tool_result in results:
        key = name if name not in collected_data else f"{name}#2"
        collected_data[key] = tool_result
        messages.append({
            "role": "tool",
            "tool_name": name,
            "content": render_tool_result(name, tool_result),
        })
