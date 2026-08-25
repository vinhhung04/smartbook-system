from __future__ import annotations

from datetime import datetime, timedelta, timezone
from uuid import UUID, uuid4

from sqlalchemy import select

from agent_actions import (
    PENDING_CONFIRMATION,
    EXECUTED,
    CANCELLED,
    FAILED,
    EXPIRED,
    get_action_config,
)
from agent_schemas import PendingAction, UserContext
from db import get_session
from db_models import ActionAuditLogRow, PendingActionRow

DEFAULT_TTL_SECONDS = 600


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _aware(dt: datetime) -> datetime:
    """Postgres (asyncpg) returns tz-aware datetimes for timestamptz columns; SQLite
    (aiosqlite, used only by tests) drops tzinfo on read even with DateTime(timezone=True).
    Every datetime this module writes is UTC, so a naive readback is safely treated as UTC."""
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _row_to_pending_action(row: PendingActionRow) -> PendingAction:
    return PendingAction(
        id=row.action_id,
        type=row.type,
        status=row.status,
        summary=row.summary,
        payload=row.payload or {},
        risk=row.risk,
        requires_confirmation=row.requires_confirmation,
        allowed_roles=row.allowed_roles or [],
        allowed_permissions=row.allowed_permissions or [],
        sources=row.sources or [],
        intent=row.intent,
        created_from_message=row.created_from_message or "",
        created_at=_aware(row.created_at).isoformat(),
        expires_at=_aware(row.expires_at).isoformat(),
        created_by_user_id=row.created_by_user_id,
        created_by_roles=row.created_by_roles or [],
        warnings=row.warnings or [],
        requires_review=row.requires_review,
    )


async def _log_audit(
    session,
    action_id: str,
    event_type: str,
    old_status: str | None,
    new_status: str | None,
    actor_user_id: str | None = None,
    actor_roles: list[str] | None = None,
    payload_snapshot: dict | None = None,
    event_metadata: dict | None = None,
) -> None:
    session.add(
        ActionAuditLogRow(
            action_id=action_id,
            event_type=event_type,
            actor_user_id=actor_user_id,
            actor_roles=actor_roles or [],
            old_status=old_status,
            new_status=new_status,
            payload_snapshot=payload_snapshot,
            event_metadata=event_metadata,
        )
    )


def is_expired(action: PendingAction) -> bool:
    try:
        expires = datetime.fromisoformat(action.expires_at.replace("Z", "+00:00"))
        return datetime.now(timezone.utc) > expires
    except Exception:
        return False


async def create_pending_action(
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
    conversation_id: str | None = None,
    ttl_seconds: int = DEFAULT_TTL_SECONDS,
) -> PendingAction:
    config = get_action_config(action_type) or {}
    action_id = "act_" + uuid4().hex[:8]
    now = _now()

    conversation_uuid: UUID | None = None
    if conversation_id:
        try:
            conversation_uuid = UUID(conversation_id)
        except ValueError:
            conversation_uuid = None

    row = PendingActionRow(
        action_id=action_id,
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
        created_at=now,
        expires_at=now + timedelta(seconds=ttl_seconds),
        created_by_user_id=user_context.user_id if user_context else None,
        created_by_roles=list(user_context.roles) if user_context else [],
        warnings=warnings or [],
        requires_review=requires_review,
        conversation_id=conversation_uuid,
    )

    async with get_session() as session:
        session.add(row)
        await session.flush()
        await _log_audit(
            session,
            action_id=action_id,
            event_type="CREATED",
            old_status=None,
            new_status=PENDING_CONFIRMATION,
            actor_user_id=user_context.user_id if user_context else None,
            actor_roles=list(user_context.roles) if user_context else [],
            payload_snapshot=payload,
        )
        await session.commit()

    return _row_to_pending_action(row)


async def get_pending_action(action_id: str) -> PendingAction | None:
    async with get_session() as session:
        result = await session.execute(
            select(PendingActionRow).where(PendingActionRow.action_id == action_id)
        )
        row = result.scalar_one_or_none()
        if row is None:
            return None

        if row.status == PENDING_CONFIRMATION and _now() > _aware(row.expires_at):
            old_status = row.status
            row.status = EXPIRED
            row.expired_at = _now()
            await _log_audit(
                session,
                action_id=action_id,
                event_type="EXPIRED",
                old_status=old_status,
                new_status=EXPIRED,
            )
            await session.commit()
            await session.refresh(row)

        return _row_to_pending_action(row)


async def cancel_pending_action(action_id: str, actor_user_id: str | None = None) -> bool:
    async with get_session() as session:
        result = await session.execute(
            select(PendingActionRow).where(PendingActionRow.action_id == action_id)
        )
        row = result.scalar_one_or_none()
        if row is None:
            return False

        old_status = row.status
        row.status = CANCELLED
        row.cancelled_at = _now()
        row.cancelled_by_user_id = actor_user_id
        await _log_audit(
            session,
            action_id=action_id,
            event_type="CANCELLED",
            old_status=old_status,
            new_status=CANCELLED,
            actor_user_id=actor_user_id,
        )
        await session.commit()
        return True


async def mark_action_executed(action_id: str, result: dict, actor_user_id: str | None = None) -> bool:
    async with get_session() as session:
        db_result = await session.execute(
            select(PendingActionRow).where(PendingActionRow.action_id == action_id)
        )
        row = db_result.scalar_one_or_none()
        if row is None:
            return False

        old_status = row.status
        row.status = EXECUTED
        row.executed_at = _now()
        row.confirmed_at = row.confirmed_at or row.executed_at
        row.confirmed_by_user_id = row.confirmed_by_user_id or actor_user_id
        row.result = result
        await _log_audit(
            session,
            action_id=action_id,
            event_type="EXECUTED",
            old_status=old_status,
            new_status=EXECUTED,
            actor_user_id=actor_user_id,
            event_metadata={"result_summary": str(result)[:200] if result else None},
        )
        await session.commit()
        return True


async def mark_action_failed(action_id: str, error: str, actor_user_id: str | None = None) -> bool:
    async with get_session() as session:
        result = await session.execute(
            select(PendingActionRow).where(PendingActionRow.action_id == action_id)
        )
        row = result.scalar_one_or_none()
        if row is None:
            return False

        old_status = row.status
        row.status = FAILED
        row.failed_at = _now()
        row.error_message = error
        row.result = {"error": error}
        await _log_audit(
            session,
            action_id=action_id,
            event_type="FAILED",
            old_status=old_status,
            new_status=FAILED,
            actor_user_id=actor_user_id,
            event_metadata={"error": error[:200]},
        )
        await session.commit()
        return True


async def mark_action_confirmed(action_id: str, actor_user_id: str | None = None) -> None:
    """Record the CONFIRMED transition in the audit log. Status stays PENDING_CONFIRMATION
    in the row itself until execution finishes (mark_action_executed/mark_action_failed
    move it to its terminal state) — this only marks *who* confirmed and *when*."""
    async with get_session() as session:
        result = await session.execute(
            select(PendingActionRow).where(PendingActionRow.action_id == action_id)
        )
        row = result.scalar_one_or_none()
        if row is None:
            return
        row.confirmed_at = _now()
        row.confirmed_by_user_id = actor_user_id
        await _log_audit(
            session,
            action_id=action_id,
            event_type="CONFIRMED",
            old_status=row.status,
            new_status=row.status,
            actor_user_id=actor_user_id,
        )
        await session.commit()


async def get_action_result(action_id: str) -> dict | None:
    async with get_session() as session:
        result = await session.execute(
            select(PendingActionRow.result).where(PendingActionRow.action_id == action_id)
        )
        row = result.scalar_one_or_none()
        return row


async def cleanup_expired_actions() -> int:
    async with get_session() as session:
        result = await session.execute(
            select(PendingActionRow).where(
                PendingActionRow.status == PENDING_CONFIRMATION,
                PendingActionRow.expires_at < _now(),
            )
        )
        rows = result.scalars().all()
        for row in rows:
            old_status = row.status
            row.status = EXPIRED
            row.expired_at = _now()
            await _log_audit(
                session,
                action_id=row.action_id,
                event_type="EXPIRED",
                old_status=old_status,
                new_status=EXPIRED,
            )
        if rows:
            await session.commit()
        return len(rows)
