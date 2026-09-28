"""OpenRouter chat-completion and vision client, used by /assistant's
tool-calling loop (also reused by main.py's other text-generation call sites -
see _get_text_llm_provider() - by nlu.py's intent classifier, and by
routes_cover_search.py / main.py's vision endpoints via analyze_image()).

OpenRouter is the sole inference backend this service depends on (Ollama was
removed - no local chat/vision model, no GPU requirement). get_openrouter_provider()
is the one place OPENROUTER_API_KEY/OPENROUTER_BASE_URL/OPENROUTER_FALLBACK_MODEL
are read from env, so main.py/nlu.py/routes_cover_search.py don't each parse
their own copy.

/assistant and /assistant/stream build an OpenAI-shaped-ish message list
(`{"role": ..., "content": ..., "tool_calls": [...]}` for an assistant turn
that called tools, `{"role": "tool", "tool_name": ..., "content": ...}` for a
tool result) and an OpenAI-style tool list (`{"type": "function", "function":
{...}}`). to_openrouter_messages() converts that message shape into the
strict OpenAI format OpenRouter's /chat/completions requires (tool_call ids,
JSON-string arguments).

Every call returns usage figures: latency, prompt/completion tokens, cost
(OpenRouter reports this directly), provider, model, and which feature made
the call. A structured log line is emitted for every call so a slow or
expensive turn is diagnosable from logs alone; main.py additionally
aggregates these across a request's rounds and attaches them to the
`/assistant` response under a debug key.
"""
from __future__ import annotations

import functools
import logging
import os
import time
from dataclasses import dataclass, field
from typing import Any, AsyncIterator

from metrics import ai_request_duration, ai_llm_cost_usd_total, ai_llm_tokens_total

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
    feature: str = ""

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
            "feature": self.feature,
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


class VisionResponseError(RuntimeError):
    """Raised by analyze_image() when the vision model's response isn't a
    JSON object - callers (cover OCR, packing verification, receipt scan)
    catch this and degrade (CLIP-only / HTTP 502) instead of crashing."""


def _log_call(usage: ChatUsage) -> None:
    ai_request_duration.labels(endpoint=usage.feature or usage.provider).observe(usage.latency_ms / 1000)
    if usage.prompt_tokens is not None:
        ai_llm_tokens_total.labels(feature=usage.feature, model=usage.model, kind="prompt").inc(usage.prompt_tokens)
    if usage.completion_tokens is not None:
        ai_llm_tokens_total.labels(feature=usage.feature, model=usage.model, kind="completion").inc(usage.completion_tokens)
    if usage.cost_usd:
        ai_llm_cost_usd_total.labels(feature=usage.feature, model=usage.model).inc(usage.cost_usd)
    if usage.error:
        logger.warning(
            "llm_call feature=%s provider=%s model=%s latency_ms=%.0f error=%s",
            usage.feature, usage.provider, usage.model, usage.latency_ms, usage.error,
        )
    else:
        logger.info(
            "llm_call feature=%s provider=%s model=%s latency_ms=%.0f prompt_tokens=%s "
            "completion_tokens=%s tool_calls=%d cost_usd=%s",
            usage.feature, usage.provider, usage.model, usage.latency_ms, usage.prompt_tokens,
            usage.completion_tokens, usage.tool_call_count, usage.cost_usd,
        )


def to_openrouter_messages(messages: list[dict]) -> list[dict]:
    """Converts this service's own message list shape (`{"role": "tool",
    "tool_name": ..., "content": ...}` for a tool result, `{"function":
    {"name", "arguments": dict}}` tool_calls with no id) into the strict
    OpenAI-format messages OpenRouter's /chat/completions expects: an
    assistant tool_calls entry needs an "id" plus a JSON-*string* "arguments",
    and each tool-result message must carry the matching "tool_call_id"
    instead of "tool_name". Ids are assigned fresh every round (never reused
    across rounds) and matched to the "tool" messages that follow in the same
    order - execute_tool_round appends tool results via asyncio.gather, which
    preserves the calls' input order.

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
    function.arguments is a JSON *string*) into this service's own
    `{"function": {"name", "arguments": dict}}` shape, so main.py's loop and
    assistant_loop.execute_tool_round don't need any provider-specific
    handling."""
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


def _is_retryable(exc: Exception) -> bool:
    """Whether the SAME model is worth retrying once more: a timeout,
    connection error, rate limit (429) or upstream 5xx. A 4xx like 400/401/404
    means retrying the same model wastes a request - go straight to the
    fallback model (if any) instead."""
    import httpx

    if isinstance(exc, httpx.HTTPStatusError):
        status = exc.response.status_code
        return status == 429 or status >= 500
    return isinstance(exc, (httpx.TimeoutException, httpx.TransportError))


def _sniff_image_mime(image_bytes: bytes) -> str:
    """Detects the image format from its magic bytes so analyze_image() can
    build a correct data: URL. Defaults to image/jpeg (the most common camera
    upload format) when nothing matches - OpenRouter's vision models decode
    the bytes regardless of a slightly wrong declared mime type."""
    if image_bytes[:3] == b"\xff\xd8\xff":
        return "image/jpeg"
    if image_bytes[:8] == b"\x89PNG\r\n\x1a\n":
        return "image/png"
    if image_bytes[:4] == b"RIFF" and image_bytes[8:12] == b"WEBP":
        return "image/webp"
    if image_bytes[:6] in (b"GIF87a", b"GIF89a"):
        return "image/gif"
    return "image/jpeg"


class OpenRouterProvider:
    """Runs chat, streaming-chat and vision calls against OpenRouter's
    OpenAI-compatible API - the sole inference backend this service depends
    on. ANALYTICS_TOOLS is already OpenAI-shaped (`{"type": "function",
    "function": {...}}`), so tool *schemas* pass through unchanged - only the
    message list needs to_openrouter_messages() to add the tool_call ids /
    JSON-string arguments the strict OpenAI format requires.

    `fallback_model`, if set, is tried once (non-streaming only) when the
    primary model fails after one retry - e.g. a persistent 429/5xx from
    OpenRouter or the upstream model provider - using the same OpenRouter API
    key. No fallback is ever hard-coded; it is entirely OPENROUTER_FALLBACK_MODEL.

    Reasoning is explicitly disabled (`"reasoning": {"enabled": false}`) on
    every call: several OpenRouter models (e.g. Qwen3.7 Flash, the default -
    verified live) default reasoning to ON, and spend the `max_tokens` budget
    on an internal "thinking" trace before ever emitting `tool_calls` or
    `content` - confirmed live: the same tool-calling request that returned
    `finish_reason: "length"` with an empty `content`/no `tool_calls` at
    max_tokens=100 with reasoning left on returned a correct `tool_calls`
    response in 15 completion tokens once reasoning was disabled."""

    name = "openrouter"

    def __init__(self, api_key: str, base_url: str, model: str, fallback_model: str | None = None):
        self._api_key = api_key
        self._base_url = (base_url or "https://openrouter.ai/api/v1").rstrip("/")
        self.model = model
        self._fallback_model = (fallback_model or "").strip() or None

    def _headers(self) -> dict:
        return {"Authorization": f"Bearer {self._api_key}", "Content-Type": "application/json"}

    async def _request_completion(self, payload: dict, timeout: float) -> tuple[dict, str]:
        """POSTs /chat/completions: the primary model gets one retry on a
        transient error (see _is_retryable), then the fallback model (if
        configured) gets one attempt. Returns (response JSON, model that
        actually answered). Raises the last exception if every attempt
        fails."""
        import httpx

        models_and_retry = [(self.model, True)]
        if self._fallback_model:
            models_and_retry.append((self._fallback_model, False))

        last_exc: Exception | None = None
        async with httpx.AsyncClient(timeout=timeout) as http_client:
            for model, retry_once in models_and_retry:
                attempts = 2 if retry_once else 1
                for attempt in range(attempts):
                    try:
                        response = await http_client.post(
                            f"{self._base_url}/chat/completions",
                            headers=self._headers(),
                            json={**payload, "model": model},
                        )
                        response.raise_for_status()
                        data = response.json()
                        if not data.get("choices"):
                            raise ValueError(f"OpenRouter response has no choices: {data!r}")
                        return data, model
                    except Exception as exc:  # noqa: BLE001 - fall through to retry/fallback/raise below
                        last_exc = exc
                        if attempt == 0 and retry_once and not _is_retryable(exc):
                            break  # non-transient: skip the same-model retry, go to fallback
                        continue

        assert last_exc is not None
        raise last_exc

    async def chat(
        self, messages: list[dict], tools: list[dict], *, num_predict: int, timeout: float,
        temperature: float = 0.2, feature: str = "",
    ) -> ChatResult:
        payload: dict[str, Any] = {
            "messages": to_openrouter_messages(messages),
            "max_tokens": num_predict,
            "temperature": temperature,
            "reasoning": {"enabled": False},
        }
        if tools:
            payload["tools"] = tools

        started = time.perf_counter()
        try:
            data, used_model = await self._request_completion(payload, timeout)
        except Exception as exc:
            usage = ChatUsage(
                provider=self.name, model=self.model, latency_ms=(time.perf_counter() - started) * 1000,
                prompt_tokens=None, completion_tokens=None, tool_call_count=0, error=str(exc), feature=feature,
            )
            _log_call(usage)
            raise

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
            feature=feature,
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
        self, messages: list[dict], tools: list[dict], *, num_predict: int, timeout: float,
        temperature: float = 0.2, feature: str = "",
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
        # by position - accumulate until the final usage-bearing chunk arrives.
        tool_call_chunks: dict[int, dict] = {}
        prompt_tokens: int | None = None
        completion_tokens: int | None = None
        cost_usd: float | None = None
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
                            cost_usd = usage_chunk.get("cost")
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
                prompt_tokens=None, completion_tokens=None, tool_call_count=0, error=str(exc), feature=feature,
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
            cost_usd=cost_usd, feature=feature,
        )
        _log_call(usage)
        yield StreamChunk(
            done=True,
            assistant_message=assistant_message,
            tool_calls=tool_calls,
            text="" if tool_calls else text,
            usage=usage,
        )

    async def analyze_image(
        self, image_bytes: bytes, prompt: str, *, max_tokens: int, timeout: float,
        feature: str = "vision", temperature: float = 0.0,
    ) -> tuple[dict, ChatUsage]:
        """One image + one text prompt, JSON-object response. Returns
        (parsed_json, usage). Raises VisionResponseError if the model's
        content isn't valid JSON - callers decide how to degrade (main.py's
        packing/receipt endpoints return HTTP 502; routes_cover_search.py
        falls back to CLIP-only, never crashing the request).

        Uses response_format={"type": "json_object"} rather than a strict
        json_schema: OpenRouter's model listing for qwen/qwen3.7-flash does
        not advertise `structured_outputs` support, only `response_format`,
        so schema *validation* happens at the call site (Pydantic) instead of
        being enforced upstream."""
        import base64
        import json

        mime = _sniff_image_mime(image_bytes)
        data_url = f"data:{mime};base64,{base64.b64encode(image_bytes).decode('ascii')}"
        payload: dict[str, Any] = {
            "messages": [{
                "role": "user",
                "content": [
                    {"type": "text", "text": prompt},
                    {"type": "image_url", "image_url": {"url": data_url}},
                ],
            }],
            "max_tokens": max_tokens,
            "temperature": temperature,
            "reasoning": {"enabled": False},
            "response_format": {"type": "json_object"},
        }

        started = time.perf_counter()
        try:
            data, used_model = await self._request_completion(payload, timeout)
        except Exception as exc:
            usage = ChatUsage(
                provider=self.name, model=self.model, latency_ms=(time.perf_counter() - started) * 1000,
                prompt_tokens=None, completion_tokens=None, tool_call_count=0, error=str(exc), feature=feature,
            )
            _log_call(usage)
            raise

        latency_ms = (time.perf_counter() - started) * 1000
        content = (data["choices"][0]["message"].get("content") or "").strip()
        usage_data = data.get("usage") or {}
        usage = ChatUsage(
            provider=self.name, model=used_model, latency_ms=latency_ms,
            prompt_tokens=usage_data.get("prompt_tokens"),
            completion_tokens=usage_data.get("completion_tokens"),
            tool_call_count=0, cost_usd=usage_data.get("cost"), feature=feature,
        )
        _log_call(usage)

        try:
            parsed = json.loads(content)
        except (TypeError, ValueError) as exc:
            raise VisionResponseError(f"vision response is not valid JSON: {content[:200]!r}") from exc
        if not isinstance(parsed, dict):
            raise VisionResponseError(f"vision response is not a JSON object: {content[:200]!r}")
        return parsed, usage


TEXT_MODEL = os.getenv("OPENROUTER_TEXT_MODEL", "qwen/qwen3.7-flash")
ASSISTANT_MODEL = os.getenv("OPENROUTER_ASSISTANT_MODEL", TEXT_MODEL)
VISION_MODEL = os.getenv("OPENROUTER_VISION_MODEL", TEXT_MODEL)


@functools.lru_cache(maxsize=None)
def get_openrouter_provider(model: str) -> OpenRouterProvider:
    """Cached OpenRouterProvider for a given model - one HTTP client
    "identity" per distinct model instead of every call site (main.py,
    nlu.py, routes_cover_search.py) parsing its own copy of
    OPENROUTER_API_KEY/OPENROUTER_BASE_URL/OPENROUTER_FALLBACK_MODEL.
    Raises ValueError if OPENROUTER_API_KEY isn't set - callers already
    catch and degrade (e.g. main.py's _call_text_llm_messages)."""
    api_key = os.getenv("OPENROUTER_API_KEY", "").strip()
    if not api_key:
        raise ValueError("OPENROUTER_API_KEY must be set to use OpenRouter.")
    base_url = os.getenv("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1").rstrip("/")
    fallback_model = os.getenv("OPENROUTER_FALLBACK_MODEL", "").strip() or None
    return OpenRouterProvider(api_key=api_key, base_url=base_url, model=model, fallback_model=fallback_model)
