"""Compact, Vietnamese-labeled rendering of a tool_result for the prompt.

Replaces `json.dumps(tool_result, ensure_ascii=False)` at both /assistant's
tool-loop call sites (main.py's `_render_tool_result`, wired through
assistant_loop.py), which sent the raw payload straight to the model with no
summarization or length limit. `get_reorder_suggestions` - the largest
payload among ANALYTICS_TOOLS - is the direct, reproduced cause of 2 of 7
fails in `eval/reports/assistant_answers_20260908_180847.md`: the model lost
the question entirely and started narrating the JSON's structure in English
instead of answering it.

Reuses evidence.py's per-tool extractors rather than writing a second
summarizer: they already produce labeled, Vietnamese, unit-carrying,
pre-truncated {label, value, unit, description} items for the UI's evidence
citations. That pre-truncation (2-3 representative rows + a total count, per
extractor) is exactly the "don't dump the whole list" behaviour a tool
result needs here too, so there is no separate ASSISTANT_TOOL_LIST_LIMIT
knob in this module - evidence.py already owns "how many rows", and this
module would only be duplicating it. ASSISTANT_TOOL_CONTEXT_CHARS remains as
a length safety net for tools with no extractor (or one that legitimately
still returns something long).

`collected_data` (the full, untouched tool_result) is unaffected - it still
goes through evidence extraction and grounding checks unchanged. Only what
is sent *into the prompt* is compacted here.
"""
from __future__ import annotations

import json
import os

from evidence import extract_evidence

ASSISTANT_TOOL_CONTEXT_CHARS = int(os.getenv("ASSISTANT_TOOL_CONTEXT_CHARS", "2000"))

_UNIT_DISPLAY = {"đ": "₫"}


def _format_number(value: float | int) -> str:
    """English-style grouping (`1,234.56`) then swapped to Vietnamese
    convention (`1.234,56`) via a placeholder so the two separators don't
    collide mid-swap. Trailing ".00"/".0" is stripped first so a whole
    number (45.0 -> "45", not "45,0" or "45,00")."""
    if isinstance(value, int):
        text = f"{value:,}"
    elif isinstance(value, float):
        text = f"{value:,.2f}"
        if "." in text:
            text = text.rstrip("0").rstrip(".")
    else:
        return str(value)
    return text.replace(",", "\x00").replace(".", ",").replace("\x00", ".")


def _format_value(value, unit: str) -> str:
    unit_display = _UNIT_DISPLAY.get(unit, unit)
    text = _format_number(value) if isinstance(value, (int, float)) and not isinstance(value, bool) else str(value)
    return f"{text} {unit_display}".strip() if unit_display else text


def _truncate(text: str, limit: int) -> str:
    if len(text) <= limit:
        return text
    cut = text.rfind("\n", 0, limit)
    if cut <= 0:
        cut = limit
    return text[:cut].rstrip() + "\n... (đã rút gọn)"


def render_tool_result(tool_name: str, tool_result) -> str:
    """The text placed in the "tool" role message sent back to the model for
    one tool call."""
    if isinstance(tool_result, dict) and tool_result.get("error"):
        return f"Lỗi khi gọi {tool_name}: {tool_result['error']}"

    items = extract_evidence(tool_name, tool_result)
    if items:
        lines = []
        for item in items:
            line = f"- {item['label']}: {_format_value(item.get('value'), item.get('unit', ''))}"
            if item.get("description"):
                line += f" ({item['description']})"
            lines.append(line)
        return _truncate("\n".join(lines), ASSISTANT_TOOL_CONTEXT_CHARS)

    # No extractor for this tool, or its result produced no evidence (e.g. a
    # genuinely empty list) - fall back to the raw payload, still length-capped
    # so it can't dominate the prompt the way the unbounded json.dumps() did.
    raw = json.dumps(tool_result, ensure_ascii=False, default=str)
    return _truncate(raw, ASSISTANT_TOOL_CONTEXT_CHARS)
