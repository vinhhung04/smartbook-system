"""HTTP-only capability and resource boundary for standalone paid AI tools.

Guest chat/discovery retain their own established admission policies. Internal
helpers are not HTTP endpoints and remain callable by already authorized flows.
"""
from __future__ import annotations

import asyncio
import json
import logging
from contextlib import AsyncExitStack

from fastapi import HTTPException
from starlette.requests import Request
from starlette.responses import JSONResponse

import catalog_access
import catalog_sync
import image_input
from ai_core import capabilities, policy
from ai_core.inference_budget import budget, opaque_principal, setting

logger = logging.getLogger("uvicorn.error")
CATALOG_PATHS = {
    "/generate-book-summary", "/api/ai/generate-book-summary", "/generate-summary-vi",
    "/enrich-book-metadata", "/enrich-book-after-isbn", "/enrich-book-after-isbn/stream",
    "/metadata-intelligence/extract", "/metadata-intelligence/extract/stream", "/book-metadata/scan-images",
}
WAREHOUSE_PATHS = {"/scan-receipt", "/verify-packing-photo", "/explain-storage-suggestion"}
IMAGE_PATHS = {"/scan-receipt", "/verify-packing-photo", "/find-book-by-cover", "/vision/identify"}
INTERNAL_PATHS = {"/verify-packing-photo", "/explain-storage-suggestion"}
BODY_LIMIT = 16 * 1024 * 1024
MULTIPART_OVERHEAD = 64 * 1024


async def authorize(request: Request, path: str):
    if path in INTERNAL_PATHS and catalog_sync.is_valid_internal_key(request.headers.get("x-internal-service-key")):
        return "service:inventory-ai", None
    user = await policy.get_user_context(request.headers.get("authorization"))
    policy.require_verified_session(user)
    if path in CATALOG_PATHS or path in {"/lookup-book-by-isbn", "/isbn-intelligence"}:
        denied = await catalog_access.catalog_access_error(request.headers.get("authorization"))
        if denied:
            raise HTTPException(*denied)
    elif path in WAREHOUSE_PATHS:
        roles = {str(role).upper() for role in user.roles}
        permissions = set(user.permissions)
        if not (policy.is_admin(user) or (roles & {"WAREHOUSE_MANAGER", "WAREHOUSE_STAFF", "LIBRARIAN"} and
                permissions & {"inventory.stock.write", "inventory.task.progress", "inventory.operation.decide"})):
            raise HTTPException(403, "Không có quyền sử dụng AI kho.")
    elif path in {"/find-book-by-cover", "/vision/identify"}:
        if not capabilities.allows(user, "book.identify_image"):
            raise HTTPException(403, "Không có quyền nhận diện sách từ ảnh.")
    elif path == "/find-book-by-cover/reindex" and not policy.is_admin(user):
        raise HTTPException(403, "Forbidden")
    return f"user:{user.user_id}", user


class InferenceBoundaryMiddleware:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or scope.get("method") not in {"POST", "PUT", "PATCH"}:
            return await self.app(scope, receive, send)
        path = scope.get("path", "").rstrip("/") or "/"
        protected = path in CATALOG_PATHS | WAREHOUSE_PATHS | {"/find-book-by-cover", "/find-book-by-cover/reindex", "/vision/identify", "/recommendations"}
        isbn_lookup = path in {"/lookup-book-by-isbn", "/isbn-intelligence"}
        request = Request(scope, receive=receive)
        limit = min(BODY_LIMIT, image_input.MAX_IMAGE_BYTES + MULTIPART_OVERHEAD) if path in IMAGE_PATHS else BODY_LIMIT
        if isbn_lookup:
            limit = min(limit, 64 * 1024)
        if protected and path not in IMAGE_PATHS and path != '/book-metadata/scan-images':
            limit = min(limit, 512 * 1024 if path.startswith('/metadata-intelligence/') else 64 * 1024)
        async with AsyncExitStack() as admission:
            await self._dispatch(scope, receive, send, request, path, protected, isbn_lookup, limit, admission)

    async def _dispatch(self, scope, receive, send, request, path, protected, isbn_lookup, limit, admission):
        try:
            identity = None
            admitted = False
            if protected:
                identity, _ = await authorize(request, path)
                feature = "catalog" if path in CATALOG_PATHS else "warehouse" if path in WAREHOUSE_PATHS else "reader"
                await admission.enter_async_context(budget.reserve(feature, opaque_principal(identity)))
                admitted = True
            # Count received bytes before Starlette's multipart parser can spool
            # files, including missing/chunked/misleading Content-Length requests.
            declared = request.headers.get("content-length")
            if declared is not None:
                try:
                    if int(declared) < 0:
                        raise ValueError()
                    if int(declared) > limit:
                        raise HTTPException(413, "Dữ liệu gửi lên quá lớn.")
                except ValueError:
                    raise HTTPException(400, "Content-Length không hợp lệ.")
            async def read_body():
                body = bytearray()
                while True:
                    message = await receive()
                    if message["type"] == "http.disconnect":
                        return None
                    body.extend(message.get("body", b""))
                    if len(body) > limit:
                        raise HTTPException(413, "Dữ liệu gửi lên quá lớn.")
                    if not message.get("more_body", False):
                        return body
            try:
                body = await asyncio.wait_for(read_body(), timeout=30)
            except asyncio.TimeoutError:
                raise HTTPException(408, "Tải dữ liệu quá thời gian cho phép.")
            if body is None:
                return
            public_isbn = False
            if isbn_lookup:
                # Basic catalog lookup stays public; explicitly requested paid
                # generation has the same catalog boundary as its other aliases.
                try:
                    wants_summary = bool(json.loads(body or b"{}").get("generateVietnameseSummary"))
                except (ValueError, AttributeError):
                    wants_summary = False  # Pydantic reports malformed requests.
                if wants_summary:
                    protected = True
                    identity, _ = await authorize(request, path)
                else:
                    # Public catalog search remains supported, but some enabled
                    # ISBN source providers can themselves perform paid inference.
                    # Give this public path a smaller durable IP budget as well.
                    user = await policy.get_user_context(request.headers.get('authorization')) if request.headers.get('authorization') else None
                    if user is not None:
                        policy.require_verified_session(user)
                    identity = policy.rate_limit_key(request, user)
                    protected, public_isbn = True, True
            delivered = False

            async def replay():
                nonlocal delivered
                if not delivered:
                    delivered = True
                    return {"type": "http.request", "body": bytes(body), "more_body": False}
                return await receive()

            if not protected:
                return await self.app(scope, replay, send)
            principal = opaque_principal(identity)
            # The lease covers the entire response, including SSE. A hard
            # deadline prevents provider work from surviving lease expiration.
            started = False

            async def tracked_send(message):
                nonlocal started
                if message["type"] == "http.response.start":
                    started = True
                await send(message)

            feature = "public-isbn" if public_isbn else "catalog" if path in CATALOG_PATHS or isbn_lookup else "warehouse" if path in WAREHOUSE_PATHS else "reader"
            if not admitted:
                await admission.enter_async_context(budget.reserve(feature, principal))
            try:
                await asyncio.wait_for(self.app(scope, replay, tracked_send), timeout=min(setting("AI_PAID_REQUEST_TIMEOUT_SECONDS", 120), 180))
            except asyncio.TimeoutError:
                if started:
                    await send({"type": "http.response.body", "body": b"", "more_body": False})
                    return
                raise HTTPException(504, "AI xử lý quá thời gian cho phép.")
        except HTTPException as exc:
            await JSONResponse({"detail": exc.detail}, status_code=exc.status_code)(scope, receive, send)
