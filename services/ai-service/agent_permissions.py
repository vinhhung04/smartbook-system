from __future__ import annotations

import logging
import os

import httpx
from fastapi import HTTPException

from agent_actions import get_action_config, normalize_role, policy_allows
from agent_schemas import PendingAction, UserContext

logger = logging.getLogger("uvicorn.error")

GATEWAY_URL = os.getenv("SMARTBOOK_GATEWAY_URL", "http://api-gateway:3000").rstrip("/")
PERMISSION_TIMEOUT = float(os.getenv("PERMISSION_TIMEOUT_SECONDS", "5"))


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
    """The current user from Gateway /auth/me (auth-service: signature, token
    blacklist, tokens-valid-after cutoff, and roles/permissions read fresh from
    the database).

    Fail-closed (Copilot 3.2): when /auth/me cannot be reached the request is
    refused with 503. The former fallback decoded the JWT WITHOUT verifying
    its signature and trusted the roles / is_superuser / sub it declared, so
    during an auth outage (or a timeout) a forged token could read another
    user's stored conversations; it could not check revocation either. A
    reachable Gateway that rejects the token is a 401, as before.
    """
    if not auth_header:
        raise HTTPException(status_code=401, detail="Authorization header required.")

    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(PERMISSION_TIMEOUT)) as client:
            resp = await client.get(
                f"{GATEWAY_URL}/auth/me",
                headers={"Authorization": auth_header},
            )
    except Exception as exc:
        logger.warning("get_user_context: /auth/me unreachable (%s); refusing the request (fail-closed)", type(exc).__name__)
        raise HTTPException(status_code=503, detail="Chưa xác minh được phiên đăng nhập lúc này. Vui lòng thử lại sau.")

    if resp.status_code == 200:
        data = resp.json()
        user = data.get("user") or data  # some services return {user: {...}}, others return the object directly
        status = str(user.get("status") or "ACTIVE").upper()
        if status != "ACTIVE" or user.get("deleted_at"):
            raise HTTPException(status_code=401, detail="Tài khoản không còn hoạt động.")
        roles = _parse_roles(user.get("roles") or [])
        permissions = _parse_permissions(user.get("permissions") or [])
        return UserContext(
            user_id=str(user.get("id") or user.get("user_id") or ""),
            username=user.get("username"),
            email=user.get("email"),
            roles=roles,
            permissions=permissions,
            is_superuser=bool(user.get("is_superuser", False)),
            revocation_verified=resp.headers.get("x-token-revocation-check") != "unverified",
        )
    if resp.status_code >= 500 or resp.status_code == 429:  # auth down / gateway throttling: unknown, not invalid
        raise HTTPException(status_code=503, detail="Chưa xác minh được phiên đăng nhập lúc này. Vui lòng thử lại sau.")

    raise HTTPException(status_code=401, detail="Invalid or expired token.")


SESSION_UNVERIFIED_DETAIL = ("Chưa xác minh được trạng thái phiên đăng nhập; thao tác tạm thời bị từ chối, "
                             "vui lòng thử lại sau.")


def require_verified_session(user_context: UserContext) -> None:
    """One policy for every endpoint that reads or changes a private action:
    the session must be fully verified, revocation included. get_user_context
    already gives 401 for an invalid/revoked/locked token and 503 when auth
    cannot answer; this adds 503 when auth answered but could not check
    revocation (its Redis down: X-Token-Revocation-Check: unverified). The flag
    comes only from the auth response header - nothing a client sends sets it."""
    if not user_context.user_id:
        raise HTTPException(status_code=401, detail="Could not resolve user identity.")
    if not user_context.revocation_verified:
        raise HTTPException(status_code=503, detail=SESSION_UNVERIFIED_DETAIL)


def is_admin(user_context: UserContext) -> bool:
    """ADMIN by the roles auth-service read from its database - never by a JWT claim."""
    return user_context.is_superuser or "ADMIN" in {normalize_role(r) for r in user_context.roles or []}


def can_confirm_action(user_context: UserContext, action: PendingAction) -> bool:
    """Whether the user may confirm this action NOW: the action type's current
    policy (agent_actions.ACTION_CONFIG - role AND permission, mirroring the
    target service), never the role list copied onto the action when it was
    drafted. An unknown type is never confirmable."""
    config = get_action_config(action.type)
    if config is None:
        return False
    return policy_allows(config["policy"], user_context.roles, user_context.permissions, user_context.is_superuser)


def require_can_confirm_action(user_context: UserContext, action: PendingAction) -> None:
    """Raise HTTP 403 if the user cannot confirm this action."""
    if not can_confirm_action(user_context, action):
        raise HTTPException(
            status_code=403,
            detail=f"Insufficient permissions to confirm action type '{action.type}'.",
        )
