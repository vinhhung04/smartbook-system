from __future__ import annotations

import base64
import json
import logging
import os

import httpx
from fastapi import HTTPException

from agent_actions import normalize_role
from agent_schemas import PendingAction, UserContext

logger = logging.getLogger("uvicorn.error")

GATEWAY_URL = os.getenv("SMARTBOOK_GATEWAY_URL", "http://api-gateway:3000").rstrip("/")
PERMISSION_TIMEOUT = float(os.getenv("PERMISSION_TIMEOUT_SECONDS", "5"))


def _decode_jwt_payload_unverified(token: str) -> dict:
    """Base64-decode the JWT payload without signature verification.

    Fallback decode is for demo resilience only; executor still calls real backend
    with Authorization so backend RBAC remains enforced.
    """
    try:
        parts = token.split(".")
        if len(parts) != 3:
            return {}
        payload_b64 = parts[1]
        # Add padding if needed
        padding = 4 - len(payload_b64) % 4
        if padding != 4:
            payload_b64 += "=" * padding
        payload_bytes = base64.urlsafe_b64decode(payload_b64)
        return json.loads(payload_bytes)
    except Exception:
        return {}


def _parse_roles(raw_roles: list | None) -> list[str]:
    if not isinstance(raw_roles, list):
        return []
    result = []
    for r in raw_roles:
        if isinstance(r, str):
            result.append(normalize_role(r))
        elif isinstance(r, dict):
            name = r.get("name") or r.get("role") or ""
            if name:
                result.append(normalize_role(name))
    return result


def _parse_permissions(raw_perms: list | None) -> list[str]:
    if not isinstance(raw_perms, list):
        return []
    result = []
    for p in raw_perms:
        if isinstance(p, str):
            result.append(p.strip())
        elif isinstance(p, dict):
            name = p.get("name") or p.get("permission") or ""
            if name:
                result.append(name.strip())
    return result


async def get_user_context(auth_header: str | None) -> UserContext:
    """Fetch the current user from Gateway /auth/me.

    Falls back to unverified JWT decode if the gateway call fails.
    The fallback is for demo resilience only — all executor calls still send the
    original Authorization header so Gateway/service RBAC is enforced.
    """
    if not auth_header:
        raise HTTPException(status_code=401, detail="Authorization header required.")

    # Primary path: call Gateway /auth/me
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(PERMISSION_TIMEOUT)) as client:
            resp = await client.get(
                f"{GATEWAY_URL}/auth/me",
                headers={"Authorization": auth_header},
            )
            if resp.status_code == 200:
                data = resp.json()
                user = data.get("user") or data  # some services return {user: {...}}, others return the object directly
                roles = _parse_roles(user.get("roles") or [])
                permissions = _parse_permissions(user.get("permissions") or [])
                return UserContext(
                    user_id=str(user.get("id") or user.get("user_id") or ""),
                    username=user.get("username"),
                    email=user.get("email"),
                    roles=roles,
                    permissions=permissions,
                    is_superuser=bool(user.get("is_superuser", False)),
                )
    except Exception as exc:
        logger.warning("get_user_context: /auth/me failed (%s), falling back to JWT decode", exc)

    # Fallback: unverified JWT decode (demo resilience only)
    token = auth_header.removeprefix("Bearer ").removeprefix("bearer ").strip()
    payload = _decode_jwt_payload_unverified(token)
    if not payload:
        raise HTTPException(status_code=401, detail="Could not resolve user identity.")

    roles = _parse_roles(payload.get("roles") or [])
    permissions = _parse_permissions(payload.get("permissions") or [])
    return UserContext(
        user_id=str(payload.get("sub") or payload.get("user_id") or ""),
        username=payload.get("username"),
        email=payload.get("email"),
        roles=roles,
        permissions=permissions,
        is_superuser=bool(payload.get("is_superuser", False)),
    )


def can_confirm_action(user_context: UserContext, action: PendingAction) -> bool:
    """Return True if the user has permission to confirm this action."""
    if user_context.is_superuser:
        return True

    user_roles = {normalize_role(r) for r in user_context.roles}
    allowed_roles = {normalize_role(r) for r in action.allowed_roles}
    if user_roles & allowed_roles:
        return True

    user_perms = set(user_context.permissions)
    allowed_perms = set(action.allowed_permissions)
    if user_perms & allowed_perms:
        return True

    return False


def require_can_confirm_action(user_context: UserContext, action: PendingAction) -> None:
    """Raise HTTP 403 if the user cannot confirm this action."""
    if not can_confirm_action(user_context, action):
        raise HTTPException(
            status_code=403,
            detail=f"Insufficient permissions to confirm action type '{action.type}'. "
                   f"Required roles: {action.allowed_roles}.",
        )
