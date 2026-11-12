"""Security & policy layer shared by both AI experiences. Every decision here
is made by the backend; nothing a client or a model sends can widen it.

    identity        get_user_context - auth-service /auth/me, fail-closed
    rate limit      rate_limit_key / enforce_rate_limit - per user, or per the
                    client IP the gateway vouches for (anonymous)
    assistant gate  can_use_assistant - manager role AND analytics permission
    actions         can_confirm_action / require_can_confirm_action - the
                    action type's policy, role AND permission, at confirm time
    warehouses      readable/writable/can_view - auth-service scopes, fail-closed
    action payload  validated_override / require_write_scope (action_guard)

The functions live in their original modules (their tests and callers stay
valid); this module is the one import surface the pipelines use.
"""
from __future__ import annotations

import os

from fastapi import HTTPException

from action_guard import require_write_scope, validated_override  # noqa: F401  (re-export)
from agent_permissions import can_confirm_action, get_user_context, require_can_confirm_action  # noqa: F401
from routes_conversations import can_use_assistant  # noqa: F401
from warehouse_scope import can_view, readable_warehouses, writable_warehouses  # noqa: F401

# The header the gateway sets from the TCP peer it saw, after deleting any
# copy the client sent (apps/api-gateway/src/index.js aiClientIpHeaders). It
# is trusted only because ai-service is reachable through the gateway alone
# (no published port in docker-compose); TRUST_GATEWAY_CLIENT_IP=false turns
# that trust off for a deployment where this does not hold.
GATEWAY_CLIENT_IP_HEADER = "x-smartbook-client-ip"


def _trust_gateway_client_ip() -> bool:
    return os.getenv("TRUST_GATEWAY_CLIENT_IP", "true").strip().lower() not in ("false", "0", "no")


def rate_limit_key(request, user_ctx) -> str:
    """The rate-limit bucket of a request: the user once authenticated;
    otherwise the client IP the gateway forwarded. Never X-Forwarded-For (any
    client can write it), and never the bare socket peer when the gateway
    vouched for an IP - that peer is the gateway itself, shared by everyone."""
    if user_ctx is not None and getattr(user_ctx, "user_id", None):
        return f"user:{user_ctx.user_id}"
    if _trust_gateway_client_ip():
        forwarded = str(request.headers.get(GATEWAY_CLIENT_IP_HEADER) or "").strip()
        if forwarded:
            return f"ip:{forwarded[:64]}"
    return f"ip:{request.client.host if request.client else 'unknown'}"


async def enforce_rate_limit(request, user_ctx, limiter) -> None:
    allowed, reason = await limiter.acquire(key=rate_limit_key(request, user_ctx))
    if not allowed:
        raise HTTPException(status_code=429, detail=reason)
