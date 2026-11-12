"""Tool registry: every tool a model can request, and every action it can
propose, declared in one place with its kind and execution policy.

Kinds
    READ                 analytics / catalog reads (tool_registry.TOOL_FUNCTIONS).
                         The only kind a model may call directly. Each read is
                         sent with the CALLER's token, so the target service
                         applies the caller's permissions and warehouse scope.
    DRAFT_THEN_CONFIRM   writes (agent_actions.ACTION_CONFIG). A model never
                         runs one: the backend builds a pending action, a
                         person with the type's policy confirms it, and only
                         then does agent_executor call the target service.
    FORBIDDEN            agent_actions.DANGEROUS_ACTION_DENYLIST - never run.

run_read_tool is the single execution path for model-requested reads (both
assistant endpoints and the fast paths): unknown tool -> error result, unknown
or mistyped argument -> dropped, total timeout, one audit log line.
"""
from __future__ import annotations

import asyncio
import inspect
import logging
import os
import time
from dataclasses import dataclass

from agent_actions import ACTION_CONFIG, DANGEROUS_ACTION_DENYLIST
from ai_core.observability import current_request_id
from tool_registry import ANALYTICS_TOOLS, TOOL_FUNCTIONS

logger = logging.getLogger("uvicorn.error")

READ = "READ"
DRAFT_THEN_CONFIRM = "DRAFT_THEN_CONFIRM"
FORBIDDEN = "FORBIDDEN"
# Upper bound for one tool call, composite tools included (each HTTP read
# inside has its own ASSISTANT_TOOL_TIMEOUT_SECONDS).
TOOL_TOTAL_TIMEOUT_SECONDS = float(os.getenv("TOOL_TOTAL_TIMEOUT_SECONDS", "30"))
_JSON_TYPES = {"string": (str,), "integer": (int,), "number": (int, float), "boolean": (bool,),
               "array": (list,), "object": (dict,)}


@dataclass(frozen=True)
class ToolSpec:
    name: str
    kind: str
    description: str
    input_schema: dict
    permission: str
    timeout_seconds: float | None


def _read_specs() -> dict[str, ToolSpec]:
    specs = {}
    for schema in ANALYTICS_TOOLS:
        fn = schema.get("function") or {}
        specs[fn["name"]] = ToolSpec(
            name=fn["name"], kind=READ, description=fn.get("description", ""),
            input_schema=fn.get("parameters") or {"type": "object", "properties": {}},
            permission="caller's token; target service enforces permissions and warehouse scope",
            timeout_seconds=TOOL_TOTAL_TIMEOUT_SECONDS,
        )
    return specs


def _action_specs() -> dict[str, ToolSpec]:
    return {
        name: ToolSpec(name=name, kind=DRAFT_THEN_CONFIRM, description=config["description"], input_schema={},
                       permission=f"confirm policy (role AND permission): {config['policy']}", timeout_seconds=None)
        for name, config in ACTION_CONFIG.items()
    }


READ_TOOLS = _read_specs()
ACTION_TOOLS = _action_specs()
FORBIDDEN_ACTIONS = frozenset(DANGEROUS_ACTION_DENYLIST)


def _valid_arguments(name: str, tool_fn, args: dict) -> tuple[dict, list[str]]:
    """Arguments the tool really takes, with the declared JSON type; anything
    else is dropped (and reported) instead of reaching the tool."""
    try:
        accepted = set(inspect.signature(tool_fn).parameters) - {"auth_header"}
    except (TypeError, ValueError):
        accepted = set(args)
    declared = (READ_TOOLS[name].input_schema.get("properties") or {}) if name in READ_TOOLS else {}
    kept, dropped = {}, []
    for key, value in (args or {}).items():
        declared_type = (declared.get(key) or {}).get("type")
        value = _coerce_number(value, declared_type)
        expected = _JSON_TYPES.get(declared_type)
        type_ok = expected is None or (isinstance(value, expected) and not (isinstance(value, bool) and bool not in expected))
        if key in accepted and type_ok:
            kept[key] = value
        else:
            dropped.append(key)
    return kept, dropped


def _coerce_number(value, declared_type):
    """Models often send numbers as strings ("limit": "5"): accept those."""
    if declared_type in ("integer", "number") and isinstance(value, str):
        text = value.strip()
        try:
            return int(text) if declared_type == "integer" else float(text)
        except ValueError:
            return value
    return value


async def run_read_tool(name: str, args: dict, auth_header: str | None) -> dict:
    """Run one model-requested READ tool with the caller's token."""
    tool_fn = TOOL_FUNCTIONS.get(name)
    if tool_fn is None or name not in READ_TOOLS:
        logger.warning("tool_call request_id=%s name=%s rejected=unknown_tool", current_request_id(), name)
        return {"error": f"Unknown tool: {name}"}
    kept, dropped = _valid_arguments(name, tool_fn, args)
    started = time.perf_counter()
    try:
        result = await asyncio.wait_for(tool_fn(auth_header, **kept), timeout=TOOL_TOTAL_TIMEOUT_SECONDS)
        outcome = "error" if isinstance(result, dict) and result.get("error") else "ok"
    except asyncio.TimeoutError:
        result, outcome = {"error": f"{name} timed out after {TOOL_TOTAL_TIMEOUT_SECONDS:.0f}s"}, "timeout"
    logger.info("tool_call request_id=%s name=%s outcome=%s latency_ms=%.0f dropped_args=%s",
                current_request_id(), name, outcome, (time.perf_counter() - started) * 1000, dropped or "-")
    return result
