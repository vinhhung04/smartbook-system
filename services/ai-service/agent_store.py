from __future__ import annotations

# Production TODO:
# - Migrate PENDING_ACTIONS to a persistent DB table (e.g., PostgreSQL ai_pending_actions)
# - Add audit log table for all action lifecycle events (created, confirmed, cancelled, failed, expired)
# - Store per-user action history for rate-limiting and traceability
# - Use a persistent task queue (Celery/Redis/BullMQ) for long-running executor jobs
# - Add cleanup job (cron) to purge old EXECUTED/CANCELLED/EXPIRED records

from datetime import datetime, timedelta, timezone
from uuid import uuid4

from agent_actions import (
    PENDING_CONFIRMATION,
    EXECUTED,
    CANCELLED,
    FAILED,
    EXPIRED,
    get_action_config,
)
from agent_schemas import PendingAction, UserContext

DEFAULT_TTL_SECONDS = 600

# In-memory stores
PENDING_ACTIONS: dict[str, PendingAction] = {}
ACTION_RESULTS: dict[str, dict] = {}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _expires_iso(ttl: int = DEFAULT_TTL_SECONDS) -> str:
    return (datetime.now(timezone.utc) + timedelta(seconds=ttl)).isoformat()


def is_expired(action: PendingAction) -> bool:
    try:
        expires = datetime.fromisoformat(action.expires_at.replace("Z", "+00:00"))
        return datetime.now(timezone.utc) > expires
    except Exception:
        return False


def create_pending_action(
    action_type: str,
    summary: str,
    payload: dict,
    risk: str,
    sources: list[dict] | None = None,
    intent: str | None = None,
    created_from_message: str = "",
    warnings: list[str] | None = None,
    requires_review: bool = False,
    user_context: UserContext | None = None,
) -> PendingAction:
    config = get_action_config(action_type) or {}
    action_id = "act_" + uuid4().hex[:8]

    action = PendingAction(
        id=action_id,
        type=action_type,
        status=PENDING_CONFIRMATION,
        summary=summary,
        payload=payload,
        risk=risk,
        requires_confirmation=config.get("requires_confirmation", True),
        allowed_roles=config.get("allowed_roles", []),
        allowed_permissions=config.get("allowed_permissions", []),
        sources=sources or [],
        intent=intent,
        created_from_message=created_from_message,
        created_at=_now_iso(),
        expires_at=_expires_iso(),
        created_by_user_id=user_context.user_id if user_context else None,
        created_by_roles=list(user_context.roles) if user_context else [],
        warnings=warnings or [],
        requires_review=requires_review,
    )
    PENDING_ACTIONS[action_id] = action
    return action


def get_pending_action(action_id: str) -> PendingAction | None:
    action = PENDING_ACTIONS.get(action_id)
    if action and is_expired(action) and action.status == PENDING_CONFIRMATION:
        # Mark expired in-place by rebuilding with updated status
        PENDING_ACTIONS[action_id] = action.model_copy(update={"status": EXPIRED})
        return PENDING_ACTIONS[action_id]
    return action


def cancel_pending_action(action_id: str) -> bool:
    action = PENDING_ACTIONS.get(action_id)
    if not action:
        return False
    PENDING_ACTIONS[action_id] = action.model_copy(update={"status": CANCELLED})
    return True


def mark_action_executed(action_id: str, result: dict) -> bool:
    action = PENDING_ACTIONS.get(action_id)
    if not action:
        return False
    PENDING_ACTIONS[action_id] = action.model_copy(update={"status": EXECUTED})
    ACTION_RESULTS[action_id] = result
    return True


def mark_action_failed(action_id: str, error: str) -> bool:
    action = PENDING_ACTIONS.get(action_id)
    if not action:
        return False
    PENDING_ACTIONS[action_id] = action.model_copy(update={"status": FAILED})
    ACTION_RESULTS[action_id] = {"error": error}
    return True


def cleanup_expired_actions() -> int:
    expired_ids = [
        action_id
        for action_id, action in list(PENDING_ACTIONS.items())
        if action.status == PENDING_CONFIRMATION and is_expired(action)
    ]
    for action_id in expired_ids:
        action = PENDING_ACTIONS[action_id]
        PENDING_ACTIONS[action_id] = action.model_copy(update={"status": EXPIRED})
    return len(expired_ids)
