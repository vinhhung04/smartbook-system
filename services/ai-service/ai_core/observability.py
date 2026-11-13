"""Request correlation. The gateway gives every request an x-request-id
(packages/shared runtime createRequestContext) and forwards it; ai-service
keeps it in a context variable so every log line of that request - LLM calls,
tool calls - carries the same id as the gateway's access log."""
from __future__ import annotations

import re
import uuid
from contextvars import ContextVar

REQUEST_ID: ContextVar[str] = ContextVar("ai_request_id", default="-")
_VALID = re.compile(r"^[A-Za-z0-9._:-]{1,128}$")  # same rule as the gateway's


def current_request_id() -> str:
    return REQUEST_ID.get()


def request_id_from(headers: dict) -> str:
    incoming = str(headers.get("x-request-id") or "").strip()
    return incoming if _VALID.match(incoming) else uuid.uuid4().hex


class RequestIdMiddleware:
    """Pure ASGI (not BaseHTTPMiddleware, which would sit between an SSE
    stream and the client and hide disconnects from /chat/stream and
    /assistant/stream): binds the request id for the request's lifetime,
    including a streamed body, and echoes it in the response headers."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        headers = {k.decode("latin-1").lower(): v.decode("latin-1") for k, v in scope.get("headers") or []}
        request_id = request_id_from(headers)
        token = REQUEST_ID.set(request_id)

        async def send_with_id(message):
            if message["type"] == "http.response.start":
                message = {**message, "headers": [*message.get("headers", []), (b"x-request-id", request_id.encode())]}
            await send(message)

        try:
            await self.app(scope, receive, send_with_id)
        finally:
            REQUEST_ID.reset(token)
