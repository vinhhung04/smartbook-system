"""Swappable chat-completion provider for /assistant's tool-calling loop
(also reused by main.py's other text-generation call sites - see
_get_text_llm_provider() - and by nlu.py's intent classifier - now that
OpenRouter has replaced Ollama as the default text/tool-calling backend).

Both /assistant and /assistant/stream build an Ollama-shaped message list
(`{"role": ..., "content": ..., "tool_calls": [...]}` for an assistant turn
that called tools, `{"role": "tool", "tool_name": ..., "content": ...}` for a
tool result) and an Ollama-shaped tool list (OpenAI-style
`{"type": "function", "function": {...}}`). This module lets that same
message/tool shape run against OpenRouter (LLM_PROVIDER=openrouter, the
default and primary provider - any model OpenRouter serves, e.g. Qwen) or
Ollama (the only path that runs fully offline, still used for the
vision/OCR models and kept available for local dev) without the call sites
caring which one is live. Anthropic and Groq were deliberately removed from
this service - OpenRouter/Qwen is the one cloud provider it depends on.

Every call also returns usage figures neither call site previously captured
anywhere: latency, prompt/completion tokens, provider, model. A structured
log line is emitted for every call so a slow or expensive turn is
diagnosable from logs alone; main.py additionally aggregates these across a
request's rounds and attaches them to the `/assistant` response under a
debug key.
"""
from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from typing import Any, AsyncIterator

from metrics import ai_request_duration

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
    cost_usd: float | None = None

    def as_dict(self) -> dict:
        return {
            "provider": self.provider,
            "model": self.model,
            "latency_ms": round(self.latency_ms, 1),
            "prompt_tokens": self.prompt_tokens,
            "completion_tokens": self.completion_tokens,
            "tool_call_count": self.tool_call_count,
            "costUsd": self.cost_usd,
            "error": self.error,
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
    ai_request_duration.labels(endpoint=usage.provider).observe(usage.latency_ms / 1000)
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

    async def chat(
        self, messages: list[dict], tools: list[dict], *, num_predict: int, timeout: float, temperature: float = 0.2
    ) -> ChatResult:
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
                    options={"temperature": temperature, "num_predict": num_predict},
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
        self, messages: list[dict], tools: list[dict], *, num_predict: int, timeout: float, temperature: float = 0.2
    ) -> AsyncIterator[StreamChunk]:
        import asyncio
        import ollama

        client = ollama.AsyncClient(host=self._host)
        started = time.perf_counter()
        try:
            stream = await client.chat(
                model=self.model, messages=messages, tools=tools, stream=True,
                options={"temperature": temperature, "num_predict": num_predict},
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


def to_openrouter_messages(messages: list[dict]) -> list[dict]:
    """Converts the Ollama-shaped message list /assistant builds
    (`{"role": "tool", "tool_name": ..., "content": ...}` for a tool result,
    `{"function": {"name", "arguments": dict}}` tool_calls with no id) into
    the strict OpenAI-format messages OpenRouter's /chat/completions expects:
    an assistant tool_calls entry needs an "id" plus a JSON-*string*
    "arguments", and each tool-result message must carry the matching
    "tool_call_id" instead of "tool_name". Ids are assigned fresh every round
    (never reused across rounds) and matched to the "tool" messages that
    follow in the same order - execute_tool_round appends tool results via
    asyncio.gather, which preserves the calls' input order.

    OpenAI-shaped system messages stay inline in the messages list (no
    separate top-level `system` field), so there is no system-extraction
    step here."""
    import json

    converted: list[dict] = []
    pending_tool_call_ids: list[str] = []
    counter = 0

    for msg in messages:
        role = msg.get("role")

        if role == "tool":
            tool_call_id = pending_tool_call_ids.pop(0) if pending_tool_call_ids else f"call_unmatched_{counter}"
            converted.append({
                "role": "tool",
                "tool_call_id": tool_call_id,
                "content": msg.get("content") or "",
            })
            continue

        if role == "assistant":
            tool_calls = msg.get("tool_calls") or []
            if not tool_calls:
                pending_tool_call_ids = []
                converted.append({"role": "assistant", "content": msg.get("content") or ""})
                continue

            ids_for_this_message: list[str] = []
            openrouter_tool_calls: list[dict] = []
            for call in tool_calls:
                counter += 1
                call_id = f"call_{counter}"
                ids_for_this_message.append(call_id)
                fn = call.get("function") or {}
                openrouter_tool_calls.append({
                    "id": call_id,
                    "type": "function",
                    "function": {
                        "name": fn.get("name"),
                        "arguments": json.dumps(fn.get("arguments") or {}, ensure_ascii=False),
                    },
                })
            pending_tool_call_ids = ids_for_this_message
            converted.append({
                "role": "assistant",
                "content": msg.get("content") or "",
                "tool_calls": openrouter_tool_calls,
            })
            continue

        converted.append({"role": role, "content": msg.get("content") or ""})

    return converted


def _openrouter_tool_calls(raw_tool_calls: list[dict] | None) -> list[dict]:
    """Normalizes an OpenRouter/OpenAI-shaped response's tool_calls (where
    function.arguments is a JSON *string*) into the same
    `{"function": {"name", "arguments": dict}}` shape OllamaProvider
    produces, so main.py's loop and assistant_loop.execute_tool_round don't
    need to know which provider answered."""
    import json

    if not raw_tool_calls:
        return []
    result = []
    for call in raw_tool_calls:
        fn = call.get("function") or {}
        raw_args = fn.get("arguments")
        try:
            args = json.loads(raw_args) if isinstance(raw_args, str) else (raw_args or {})
        except (TypeError, ValueError):
            args = {}
        result.append({"function": {"name": fn.get("name"), "arguments": args}})
    return result


class OpenRouterProvider:
    """Runs a chat/completion call against a model served through
    OpenRouter's OpenAI-compatible /chat/completions API - the sole
    production provider this module was extended for (replacing Ollama for
    text/tool-calling; Ollama stays available as an opt-in offline/dev
    alternative, selected the same way via get_llm_provider()).

    ANALYTICS_TOOLS is already OpenAI-shaped
    (`{"type": "function", "function": {...}}`), so tool *schemas* pass
    through unchanged - only the message list needs to_openrouter_messages()
    to add the tool_call ids / JSON-string arguments the strict OpenAI
    format requires (Ollama's own tool-calling is more lenient and never
    needed this).

    `fallback_model`, if set, is retried once (non-streaming only) when the
    primary model errors - e.g. a temporary 429/5xx from OpenRouter or the
    upstream model provider - using the same OpenRouter API key.

    Reasoning is explicitly disabled (`"reasoning": {"enabled": false}`) on
    every call: several OpenRouter models (e.g. Qwen3.7 Flash, the default -
    verified live) default reasoning to ON, and spend the `max_tokens` budget
    on an internal "thinking" trace before ever emitting `tool_calls` or
    `content` - confirmed live: the same tool-calling request that returned
    `finish_reason: "length"` with an empty `content`/no `tool_calls` at
    max_tokens=100 with reasoning left on returned a correct `tool_calls`
    response in 15 completion tokens once reasoning was disabled. The
    existing prompts/num_predict budgets in this service were tuned for
    non-reasoning models (Ollama); this keeps that assumption true for
    OpenRouter instead of risking every round silently starving on
    `finish_reason: "length"`."""

    name = "openrouter"

    def __init__(self, api_key: str, base_url: str, model: str, fallback_model: str | None = None):
        self._api_key = api_key
        self._base_url = (base_url or "https://openrouter.ai/api/v1").rstrip("/")
        self.model = model
        self._fallback_model = (fallback_model or "").strip() or None

    def _headers(self) -> dict:
        return {"Authorization": f"Bearer {self._api_key}", "Content-Type": "application/json"}

    async def chat(
        self, messages: list[dict], tools: list[dict], *, num_predict: int, timeout: float, temperature: float = 0.2
    ) -> ChatResult:
        import httpx

        payload: dict[str, Any] = {
            "messages": to_openrouter_messages(messages),
            "max_tokens": num_predict,
            "temperature": temperature,
            "reasoning": {"enabled": False},
        }
        if tools:
            payload["tools"] = tools

        started = time.perf_counter()
        models_to_try = [self.model] + ([self._fallback_model] if self._fallback_model else [])
        last_exc: Exception | None = None
        data: dict | None = None
        used_model = self.model
        async with httpx.AsyncClient(timeout=timeout) as http_client:
            for model in models_to_try:
                try:
                    response = await http_client.post(
                        f"{self._base_url}/chat/completions",
                        headers=self._headers(),
                        json={**payload, "model": model},
                    )
                    response.raise_for_status()
                    data = response.json()
                    used_model = model
                    break
                except Exception as exc:  # noqa: BLE001 - fall through to next model / re-raise below
                    last_exc = exc
                    continue

        if data is None:
            usage = ChatUsage(
                provider=self.name, model=self.model, latency_ms=(time.perf_counter() - started) * 1000,
                prompt_tokens=None, completion_tokens=None, tool_call_count=0, error=str(last_exc),
            )
            _log_call(usage)
            raise last_exc

        latency_ms = (time.perf_counter() - started) * 1000
        choice_message = data["choices"][0]["message"]
        tool_calls = _openrouter_tool_calls(choice_message.get("tool_calls"))
        usage_data = data.get("usage") or {}
        usage = ChatUsage(
            provider=self.name, model=used_model, latency_ms=latency_ms,
            prompt_tokens=usage_data.get("prompt_tokens"),
            completion_tokens=usage_data.get("completion_tokens"),
            tool_call_count=len(tool_calls),
            cost_usd=usage_data.get("cost"),
        )
        _log_call(usage)
        assistant_message = (
            {"role": "assistant", "content": "", "tool_calls": tool_calls} if tool_calls
            else {"role": "assistant", "content": (choice_message.get("content") or "")}
        )
        return ChatResult(
            assistant_message=assistant_message,
            tool_calls=tool_calls,
            text="" if tool_calls else (choice_message.get("content") or "").strip(),
            usage=usage,
        )

    async def chat_stream(
        self, messages: list[dict], tools: list[dict], *, num_predict: int, timeout: float, temperature: float = 0.2
    ) -> AsyncIterator[StreamChunk]:
        import json
        import httpx

        payload: dict[str, Any] = {
            "model": self.model,
            "messages": to_openrouter_messages(messages),
            "max_tokens": num_predict,
            "temperature": temperature,
            "reasoning": {"enabled": False},
            "stream": True,
            "stream_options": {"include_usage": True},
        }
        if tools:
            payload["tools"] = tools

        started = time.perf_counter()
        text_parts: list[str] = []
        # OpenRouter streams a tool call's arguments across many chunks, indexed
        # by position - same "accumulate until the done chunk" problem
        # OllamaProvider.chat_stream's comment describes for Ollama's own stream.
        tool_call_chunks: dict[int, dict] = {}
        prompt_tokens: int | None = None
        completion_tokens: int | None = None
        try:
            async with httpx.AsyncClient(timeout=timeout) as http_client:
                async with http_client.stream(
                    "POST", f"{self._base_url}/chat/completions",
                    headers=self._headers(), json=payload,
                ) as response:
                    response.raise_for_status()
                    async for line in response.aiter_lines():
                        if not line or not line.startswith("data:"):
                            continue
                        data_str = line[len("data:"):].strip()
                        if not data_str or data_str == "[DONE]":
                            continue
                        chunk = json.loads(data_str)
                        usage_chunk = chunk.get("usage")
                        if usage_chunk:
                            prompt_tokens = usage_chunk.get("prompt_tokens")
                            completion_tokens = usage_chunk.get("completion_tokens")
                        choices = chunk.get("choices") or []
                        if not choices:
                            continue
                        delta = choices[0].get("delta") or {}
                        content = delta.get("content") or ""
                        if content:
                            text_parts.append(content)
                            yield StreamChunk(delta=content)
                        for tc in delta.get("tool_calls") or []:
                            idx = tc.get("index", 0)
                            slot = tool_call_chunks.setdefault(idx, {"id": None, "name": None, "arguments": ""})
                            if tc.get("id"):
                                slot["id"] = tc["id"]
                            fn = tc.get("function") or {}
                            if fn.get("name"):
                                slot["name"] = fn["name"]
                            if fn.get("arguments"):
                                slot["arguments"] += fn["arguments"]
        except Exception as exc:
            usage = ChatUsage(
                provider=self.name, model=self.model, latency_ms=(time.perf_counter() - started) * 1000,
                prompt_tokens=None, completion_tokens=None, tool_call_count=0, error=str(exc),
            )
            _log_call(usage)
            raise

        latency_ms = (time.perf_counter() - started) * 1000
        tool_calls: list[dict] = []
        for idx in sorted(tool_call_chunks):
            slot = tool_call_chunks[idx]
            try:
                args = json.loads(slot["arguments"]) if slot["arguments"] else {}
            except (TypeError, ValueError):
                args = {}
            tool_calls.append({"function": {"name": slot["name"], "arguments": args}})

        text = "".join(text_parts).strip()
        assistant_message = (
            {"role": "assistant", "content": "", "tool_calls": tool_calls} if tool_calls
            else {"role": "assistant", "content": text}
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
            text="" if tool_calls else text,
            usage=usage,
        )


def get_llm_provider(
    provider: str,
    *,
    ollama_host: str,
    ollama_model: str,
    openrouter_api_key: str = "",
    openrouter_base_url: str | None = None,
    openrouter_model: str = "",
    openrouter_fallback_model: str | None = None,
) -> OllamaProvider | OpenRouterProvider:
    """Factory selecting the configured provider. Takes config as explicit
    parameters (rather than reading os.getenv itself) so this module has no
    dependency on main.py's env-parsing and stays independently testable."""
    normalized = (provider or "ollama").strip().lower()
    if normalized == "openrouter":
        if not openrouter_api_key:
            raise ValueError("LLM_PROVIDER=openrouter requires OPENROUTER_API_KEY to be set.")
        return OpenRouterProvider(
            api_key=openrouter_api_key,
            base_url=openrouter_base_url or "https://openrouter.ai/api/v1",
            model=openrouter_model,
            fallback_model=openrouter_fallback_model,
        )
    return OllamaProvider(host=ollama_host, model=ollama_model)
