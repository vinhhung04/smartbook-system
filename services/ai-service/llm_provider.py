"""Swappable chat-completion provider for /assistant's tool-calling loop.

Both /assistant and /assistant/stream build an Ollama-shaped message list
(`{"role": ..., "content": ..., "tool_calls": [...]}` for an assistant turn
that called tools, `{"role": "tool", "tool_name": ..., "content": ...}` for a
tool result) and an Ollama-shaped tool list (OpenAI-style
`{"type": "function", "function": {...}}`). This module lets that same
message/tool shape run against Ollama (the default, and the only path that
runs fully offline) or Anthropic Claude (opt-in via ASSISTANT_PROVIDER=
anthropic, for an eval A/B comparison against the local model) without the
call sites caring which one is live.

Every call also returns usage figures neither call site previously captured
anywhere: latency, prompt/completion tokens, provider, model. Ollama returns
`prompt_eval_count`/`eval_count` on every response and Anthropic returns a
`usage` block on every response - both were being read for content only and
the rest discarded. A structured log line is emitted for every call so a
slow or expensive turn is diagnosable from logs alone; main.py additionally
aggregates these across a request's rounds and attaches them to the
`/assistant` response under a debug key.
"""
from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from typing import Any, AsyncIterator

logger = logging.getLogger("uvicorn.error")


@dataclass
class ChatUsage:
    provider: str
    model: str
    latency_ms: float
    prompt_tokens: int | None
    completion_tokens: int | None
    tool_call_count: int
    error: str | None = None

    def as_dict(self) -> dict:
        return {
            "provider": self.provider,
            "model": self.model,
            "latency_ms": round(self.latency_ms, 1),
            "prompt_tokens": self.prompt_tokens,
            "completion_tokens": self.completion_tokens,
            "tool_call_count": self.tool_call_count,
        }


@dataclass
class ChatResult:
    """Result of one non-streaming chat() round."""
    assistant_message: dict
    tool_calls: list[dict]
    text: str
    usage: ChatUsage


@dataclass
class StreamChunk:
    """One item from chat_stream(). `delta` carries text as it arrives; the
    terminal chunk (`done=True`) carries everything else - tool_calls, the
    assistant message to append to history, and usage."""
    delta: str = ""
    done: bool = False
    assistant_message: dict | None = None
    tool_calls: list[dict] = field(default_factory=list)
    text: str = ""
    usage: ChatUsage | None = None


def _log_call(usage: ChatUsage) -> None:
    if usage.error:
        logger.warning(
            "assistant_llm_call provider=%s model=%s latency_ms=%.0f error=%s",
            usage.provider, usage.model, usage.latency_ms, usage.error,
        )
    else:
        logger.info(
            "assistant_llm_call provider=%s model=%s latency_ms=%.0f prompt_tokens=%s "
            "completion_tokens=%s tool_calls=%d",
            usage.provider, usage.model, usage.latency_ms, usage.prompt_tokens,
            usage.completion_tokens, usage.tool_call_count,
        )


class OllamaProvider:
    """Wraps the exact ollama.Client()/AsyncClient() calls /assistant and
    /assistant/stream made directly before this module existed - same model,
    same options, same per-chunk timeout handling. This class changes
    nothing about Ollama's behaviour; it exists so main.py's two endpoints
    can call one interface regardless of which provider is configured."""

    name = "ollama"

    def __init__(self, host: str, model: str):
        self._host = host
        self.model = model

    async def chat(self, messages: list[dict], tools: list[dict], *, num_predict: int, timeout: float) -> ChatResult:
        import asyncio
        import ollama

        client = ollama.Client(host=self._host)
        started = time.perf_counter()
        try:
            response = await asyncio.wait_for(
                asyncio.to_thread(
                    client.chat,
                    model=self.model,
                    messages=messages,
                    tools=tools,
                    options={"temperature": 0.2, "num_predict": num_predict},
                ),
                timeout=timeout,
            )
        except Exception as exc:
            usage = ChatUsage(
                provider=self.name, model=self.model, latency_ms=(time.perf_counter() - started) * 1000,
                prompt_tokens=None, completion_tokens=None, tool_call_count=0, error=str(exc),
            )
            _log_call(usage)
            raise

        latency_ms = (time.perf_counter() - started) * 1000
        message = response["message"]
        tool_calls = message.get("tool_calls") or []
        usage = ChatUsage(
            provider=self.name, model=self.model, latency_ms=latency_ms,
            prompt_tokens=response.get("prompt_eval_count"),
            completion_tokens=response.get("eval_count"),
            tool_call_count=len(tool_calls),
        )
        _log_call(usage)
        return ChatResult(
            assistant_message=message,
            tool_calls=tool_calls,
            text=(message.get("content") or "").strip(),
            usage=usage,
        )

    async def chat_stream(
        self, messages: list[dict], tools: list[dict], *, num_predict: int, timeout: float
    ) -> AsyncIterator[StreamChunk]:
        import asyncio
        import ollama

        client = ollama.AsyncClient(host=self._host)
        started = time.perf_counter()
        try:
            stream = await client.chat(
                model=self.model, messages=messages, tools=tools, stream=True,
                options={"temperature": 0.2, "num_predict": num_predict},
            )

            last_message = None
            prompt_tokens = None
            completion_tokens = None
            # Ollama sends the parsed tool call on the chunk that decides it, then a
            # separate final "done" sentinel chunk whose own tool_calls is always None -
            # naively keeping only the *last* chunk's tool_calls silently drops the call.
            accumulated_tool_calls: list[dict] = []
            iterator = stream.__aiter__()
            while True:
                try:
                    chunk = await asyncio.wait_for(iterator.__anext__(), timeout=timeout)
                except StopAsyncIteration:
                    break
                last_message = chunk.message
                if chunk.message.tool_calls:
                    accumulated_tool_calls = chunk.message.tool_calls
                if getattr(chunk, "done", False):
                    prompt_tokens = getattr(chunk, "prompt_eval_count", None)
                    completion_tokens = getattr(chunk, "eval_count", None)
                delta = chunk.message.content or ""
                if delta:
                    yield StreamChunk(delta=delta)
        except Exception as exc:
            usage = ChatUsage(
                provider=self.name, model=self.model, latency_ms=(time.perf_counter() - started) * 1000,
                prompt_tokens=None, completion_tokens=None, tool_call_count=0, error=str(exc),
            )
            _log_call(usage)
            raise

        latency_ms = (time.perf_counter() - started) * 1000
        if last_message is None:
            usage = ChatUsage(
                provider=self.name, model=self.model, latency_ms=latency_ms,
                prompt_tokens=prompt_tokens, completion_tokens=completion_tokens, tool_call_count=0,
            )
            _log_call(usage)
            yield StreamChunk(done=True, assistant_message=None, tool_calls=[], text="", usage=usage)
            return

        tool_calls = accumulated_tool_calls or []
        assistant_message = (
            {"role": "assistant", "content": "", "tool_calls": tool_calls} if tool_calls else last_message
        )
        usage = ChatUsage(
            provider=self.name, model=self.model, latency_ms=latency_ms,
            prompt_tokens=prompt_tokens, completion_tokens=completion_tokens, tool_call_count=len(tool_calls),
        )
        _log_call(usage)
        yield StreamChunk(
            done=True,
            assistant_message=assistant_message,
            tool_calls=tool_calls,
            text=(last_message.get("content") or "").strip() if not tool_calls else "",
            usage=usage,
        )


def _to_anthropic_tools(tools: list[dict]) -> list[dict]:
    """ANALYTICS_TOOLS is OpenAI/Ollama-shaped ({"type": "function", "function":
    {"name", "description", "parameters"}}); Anthropic wants {"name",
    "description", "input_schema"} with no wrapper."""
    converted = []
    for t in tools:
        fn = t.get("function", t)
        converted.append({
            "name": fn["name"],
            "description": fn.get("description", ""),
            "input_schema": fn.get("parameters") or {"type": "object", "properties": {}},
        })
    return converted


def to_anthropic_messages(messages: list[dict]) -> tuple[str, list[dict]]:
    """Converts the Ollama-shaped message list /assistant builds into
    Anthropic's (system_text, messages) shape.

    The tricky part: Ollama's tool-result messages carry `tool_name`, not a
    `tool_use_id` - Anthropic requires the latter, and requires every
    tool_result answering one round's tool_use blocks to land in a SINGLE
    user message (see "Parallel tool use" - splitting them across messages
    trains the model to stop calling tools in parallel). This function
    assigns tool_use ids when it converts an assistant message's tool_calls,
    then matches them to the tool-result messages that follow in the same
    order (execute_tool_round appends tool results via asyncio.gather, which
    preserves the calls' input order), grouping consecutive "tool" messages
    into one user message.
    """
    system_parts: list[str] = []
    anthropic_messages: list[dict] = []
    pending_tool_use_ids: list[str] = []
    tool_result_blocks: list[dict] = []
    counter = 0

    def flush_tool_results() -> None:
        nonlocal tool_result_blocks
        if tool_result_blocks:
            anthropic_messages.append({"role": "user", "content": tool_result_blocks})
            tool_result_blocks = []

    for msg in messages:
        role = msg.get("role")
        if role == "system":
            content = msg.get("content") or ""
            if content:
                system_parts.append(content)
            continue

        if role == "tool":
            tool_use_id = pending_tool_use_ids.pop(0) if pending_tool_use_ids else f"toolu_unmatched_{counter}"
            tool_result_blocks.append({
                "type": "tool_result",
                "tool_use_id": tool_use_id,
                "content": msg.get("content") or "",
            })
            continue

        flush_tool_results()

        if role == "assistant":
            tool_calls = msg.get("tool_calls") or []
            content_blocks: list[dict] = []
            text = (msg.get("content") or "").strip()
            if text:
                content_blocks.append({"type": "text", "text": text})
            ids_for_this_message: list[str] = []
            for call in tool_calls:
                counter += 1
                tool_use_id = f"toolu_{counter}"
                ids_for_this_message.append(tool_use_id)
                fn = call.get("function") or {}
                content_blocks.append({
                    "type": "tool_use",
                    "id": tool_use_id,
                    "name": fn.get("name"),
                    "input": fn.get("arguments") or {},
                })
            pending_tool_use_ids = ids_for_this_message
            if not content_blocks:
                content_blocks = [{"type": "text", "text": ""}]
            anthropic_messages.append({"role": "assistant", "content": content_blocks})
        else:
            anthropic_messages.append({"role": "user", "content": msg.get("content") or ""})

    flush_tool_results()
    return "\n\n".join(system_parts), anthropic_messages


def _message_from_anthropic_response(content_blocks: list[Any]) -> tuple[dict, list[dict], str]:
    """Normalizes an Anthropic response's content blocks into the same
    (assistant_message, tool_calls, text) shape OllamaProvider produces, so
    main.py's loop and assistant_loop.execute_tool_round don't need to know
    which provider answered."""
    text_parts: list[str] = []
    tool_calls: list[dict] = []
    for block in content_blocks:
        block_type = getattr(block, "type", None) or (block.get("type") if isinstance(block, dict) else None)
        if block_type == "text":
            text_parts.append(getattr(block, "text", None) or block.get("text", ""))
        elif block_type == "tool_use":
            name = getattr(block, "name", None) or block.get("name")
            tool_input = getattr(block, "input", None)
            if tool_input is None and isinstance(block, dict):
                tool_input = block.get("input")
            tool_calls.append({"function": {"name": name, "arguments": tool_input or {}}})

    text = "".join(text_parts).strip()
    assistant_message = (
        {"role": "assistant", "content": "", "tool_calls": tool_calls} if tool_calls
        else {"role": "assistant", "content": text}
    )
    return assistant_message, tool_calls, text


class AnthropicProvider:
    """Runs /assistant's tool-calling loop against Anthropic Claude instead
    of the local Ollama model - opt-in via ASSISTANT_PROVIDER=anthropic, for
    an eval A/B comparison. The `anthropic` package is imported lazily
    (inside __init__) so an Ollama-only deployment never needs it installed.

    Current-generation Claude models (Sonnet 5, Opus 5) don't accept
    temperature/top_p/top_k - adaptive thinking replaces explicit sampling
    control - so this provider doesn't set them; `thinking` is left at its
    default (adaptive)."""

    name = "anthropic"

    def __init__(self, api_key: str, base_url: str | None, model: str):
        import anthropic

        self.model = model
        # ANTHROPIC_BASE_URL's default/documented value ("https://api.anthropic.com/v1")
        # was written for the old raw-httpx call sites (main.py's _call_anthropic etc.),
        # which append "/messages" themselves. The SDK's own base_url is the API ROOT -
        # it appends "/v1/messages" internally - so passing the same env var through
        # unchanged produces "/v1/v1/messages" and every call 404s. Strip a trailing
        # "/v1" so both conventions can share the one env var.
        if base_url and base_url.rstrip("/").endswith("/v1"):
            base_url = base_url.rstrip("/")[: -len("/v1")] or None
        self._client = anthropic.AsyncAnthropic(api_key=api_key, base_url=base_url or None)

    async def chat(self, messages: list[dict], tools: list[dict], *, num_predict: int, timeout: float) -> ChatResult:
        import asyncio

        system, anthropic_messages = to_anthropic_messages(messages)
        started = time.perf_counter()
        try:
            response = await asyncio.wait_for(
                self._client.messages.create(
                    model=self.model,
                    max_tokens=num_predict,
                    system=system or None,
                    messages=anthropic_messages,
                    tools=_to_anthropic_tools(tools) if tools else None,
                ),
                timeout=timeout,
            )
        except Exception as exc:
            usage = ChatUsage(
                provider=self.name, model=self.model, latency_ms=(time.perf_counter() - started) * 1000,
                prompt_tokens=None, completion_tokens=None, tool_call_count=0, error=str(exc),
            )
            _log_call(usage)
            raise

        latency_ms = (time.perf_counter() - started) * 1000
        assistant_message, tool_calls, text = _message_from_anthropic_response(response.content)
        usage = ChatUsage(
            provider=self.name, model=self.model, latency_ms=latency_ms,
            prompt_tokens=response.usage.input_tokens, completion_tokens=response.usage.output_tokens,
            tool_call_count=len(tool_calls),
        )
        _log_call(usage)
        return ChatResult(assistant_message=assistant_message, tool_calls=tool_calls, text=text, usage=usage)

    async def chat_stream(
        self, messages: list[dict], tools: list[dict], *, num_predict: int, timeout: float
    ) -> AsyncIterator[StreamChunk]:
        import asyncio

        system, anthropic_messages = to_anthropic_messages(messages)
        started = time.perf_counter()
        try:
            async with asyncio.timeout(timeout):
                async with self._client.messages.stream(
                    model=self.model,
                    max_tokens=num_predict,
                    system=system or None,
                    messages=anthropic_messages,
                    tools=_to_anthropic_tools(tools) if tools else None,
                ) as stream:
                    async for text_delta in stream.text_stream:
                        if text_delta:
                            yield StreamChunk(delta=text_delta)
                    final_message = await stream.get_final_message()
        except Exception as exc:
            usage = ChatUsage(
                provider=self.name, model=self.model, latency_ms=(time.perf_counter() - started) * 1000,
                prompt_tokens=None, completion_tokens=None, tool_call_count=0, error=str(exc),
            )
            _log_call(usage)
            raise

        latency_ms = (time.perf_counter() - started) * 1000
        assistant_message, tool_calls, text = _message_from_anthropic_response(final_message.content)
        usage = ChatUsage(
            provider=self.name, model=self.model, latency_ms=latency_ms,
            prompt_tokens=final_message.usage.input_tokens, completion_tokens=final_message.usage.output_tokens,
            tool_call_count=len(tool_calls),
        )
        _log_call(usage)
        yield StreamChunk(done=True, assistant_message=assistant_message, tool_calls=tool_calls, text=text, usage=usage)


def get_llm_provider(
    provider: str,
    *,
    ollama_host: str,
    ollama_model: str,
    anthropic_api_key: str = "",
    anthropic_base_url: str | None = None,
    anthropic_model: str = "",
) -> OllamaProvider | AnthropicProvider:
    """Factory selecting the configured provider. Takes config as explicit
    parameters (rather than reading os.getenv itself) so this module has no
    dependency on main.py's env-parsing and stays independently testable."""
    normalized = (provider or "ollama").strip().lower()
    if normalized == "anthropic":
        if not anthropic_api_key:
            raise ValueError("ASSISTANT_PROVIDER=anthropic requires ANTHROPIC_API_KEY to be set.")
        return AnthropicProvider(api_key=anthropic_api_key, base_url=anthropic_base_url, model=anthropic_model)
    return OllamaProvider(host=ollama_host, model=ollama_model)
