from __future__ import annotations

from datetime import datetime, timedelta, timezone
from uuid import UUID, uuid4

from sqlalchemy import select, update

import os

from agent_actions import (
    PENDING_CONFIRMATION,
    CONFIRMED,
    EXECUTED,
    CANCELLED,
    FAILED,
    EXPIRED,
    RECONCILE_REQUIRED,
    RETRY_SAFE_ACTIONS,
    get_action_config,
)
from agent_schemas import PendingAction, UserContext
from db import get_session
from db_models import ActionAuditLogRow, PendingActionRow

DEFAULT_TTL_SECONDS = 600
# A CONFIRMED action is being executed by the request that claimed it. Older
# than this, that request is gone (crash/restart mid-execution): see
# release_stale_confirmed_actions. Well above the longest executor run.
STALE_CONFIRMED_SECONDS = int(os.getenv("ACTION_STALE_CONFIRMED_SECONDS", "900"))
# Where an execution may end: from CONFIRMED (normal), or from
# RECONCILE_REQUIRED when a slow run finishes after the stale sweep flagged it.
_EXECUTING = (CONFIRMED, RECONCILE_REQUIRED)


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
    """Cancel only an action still waiting for confirmation. Returns False when
    it is already confirmed/executing, executed, failed or expired - marking an
    executed action CANCELLED would make the audit log claim its side effects
    never happened. Conditional UPDATE, so a concurrent confirm cannot slip in
    between the check and the write."""
    async with get_session() as session:
        result = await session.execute(
            update(PendingActionRow)
            .where(PendingActionRow.action_id == action_id, PendingActionRow.status == PENDING_CONFIRMATION)
            .values(status=CANCELLED, cancelled_at=_now(), cancelled_by_user_id=actor_user_id)
        )
        if result.rowcount != 1:
            return False
        await _log_audit(
            session,
            action_id=action_id,
            event_type="CANCELLED",
            old_status=PENDING_CONFIRMATION,
            new_status=CANCELLED,
            actor_user_id=actor_user_id,
        )
        await session.commit()
        return True


async def _finish_execution(action_id: str, new_status: str, event_type: str, actor_user_id: str | None,
                            result: dict | None, error: str | None = None,
                            from_statuses: tuple[str, ...] = _EXECUTING,
                            actor_roles: list[str] | None = None, extra_metadata: dict | None = None) -> bool:
    """Move an executing action to where its execution ended. Conditional on
    the current status (from_statuses), so a terminal state is never
    overwritten - e.g. an EXECUTED action cannot be turned FAILED by a late,
    duplicate report. Returns False when the action was not in from_statuses."""
    async with get_session() as session:
        row = (await session.execute(
            select(PendingActionRow).where(PendingActionRow.action_id == action_id).with_for_update()
        )).scalar_one_or_none()
        if row is None or row.status not in from_statuses:
            return False
        old_status, now = row.status, _now()
        if event_type == "RECONCILED" and row.result:
            result = {**result, "execution_result": row.result}  # keep what the run itself reported
        if new_status == EXECUTED:
            values = {"executed_at": now, "confirmed_at": row.confirmed_at or now,
                      "confirmed_by_user_id": row.confirmed_by_user_id or actor_user_id, "result": result}
        else:
            values = {"failed_at": now, "error_message": error,
                      "result": result if result is not None else {"error": error}}
        # Conditional on the status read above, not only on the row lock: two
        # concurrent finishers (two reconciliations, a late run vs. a
        # reconciliation) cannot both win even where FOR UPDATE is a no-op.
        moved = await session.execute(
            update(PendingActionRow)
            .where(PendingActionRow.action_id == action_id, PendingActionRow.status == old_status)
            .values(status=new_status, **values)
            .execution_options(synchronize_session=False)
        )
        if moved.rowcount != 1:
            await session.rollback()
            return False
        await _log_audit(
            session,
            action_id=action_id,
            event_type=event_type,
            old_status=old_status,
            new_status=new_status,
            actor_user_id=actor_user_id,
            actor_roles=actor_roles,
            event_metadata={"result_summary": str(result)[:200] if result else None, "error": (error or "")[:200] or None,
                            **(extra_metadata or {})},
        )
        await session.commit()
        return True


async def mark_action_executed(action_id: str, result: dict, actor_user_id: str | None = None) -> bool:
    return await _finish_execution(action_id, EXECUTED, "EXECUTED", actor_user_id, result)


async def mark_action_failed(action_id: str, error: str, actor_user_id: str | None = None) -> bool:
    """The target refused the action (or a local precondition did): nothing
    was written, so FAILED stays re-confirmable (mark_action_confirmed)."""
    return await _finish_execution(action_id, FAILED, "FAILED", actor_user_id, None, error)


async def mark_action_needs_reconciliation(action_id: str, error: str, actor_user_id: str | None = None,
                                           result: dict | None = None) -> bool:
    """The outcome is unknown: the target may have written. Not re-confirmable;
    a person resolves it (resolve_reconciliation)."""
    return await _finish_execution(action_id, RECONCILE_REQUIRED, "RECONCILE_REQUIRED", actor_user_id,
                                   result, error, from_statuses=(CONFIRMED,))


async def resolve_reconciliation(action_id: str, outcome: str, note: str, actor_user_id: str | None,
                                 evidence_reference: str | None = None, actor_roles: list[str] | None = None) -> bool:
    """A person checked the target service: RECONCILE_REQUIRED -> EXECUTED (it
    was written) or FAILED (it was not; FAILED may then be confirmed again by
    hand - never automatically). The audit row records who, when, the status
    before and after, the note and the evidence reference. Row-locked and
    conditional on RECONCILE_REQUIRED, so of two concurrent resolutions only
    one succeeds and a terminal state is never resolved again."""
    if outcome not in (EXECUTED, FAILED):
        raise ValueError("outcome must be EXECUTED or FAILED")
    resolution = {"reconciled": True, "note": note, "outcome": outcome, "evidence_reference": evidence_reference,
                  "reconciled_by_user_id": actor_user_id, "reconciled_at": _now().isoformat()}
    audit = {"reconciliation_note": note, "evidence_reference": evidence_reference, "outcome": outcome}
    if outcome == EXECUTED:
        return await _finish_execution(action_id, EXECUTED, "RECONCILED", actor_user_id, resolution,
                                       from_statuses=(RECONCILE_REQUIRED,), actor_roles=actor_roles,
                                       extra_metadata=audit)
    return await _finish_execution(action_id, FAILED, "RECONCILED", actor_user_id, resolution,
                                   f"reconciled as not executed: {note}", from_statuses=(RECONCILE_REQUIRED,),
                                   actor_roles=actor_roles, extra_metadata=audit)


async def release_stale_confirmed_actions(max_age_seconds: int = STALE_CONFIRMED_SECONDS) -> int:
    """Actions left CONFIRMED by a request that never finished (the service
    restarted mid-execution). A retry-safe type (RETRY_SAFE_ACTIONS) goes to
    FAILED, so the user can simply confirm again; any other type goes to
    RECONCILE_REQUIRED, because the write may have happened."""
    cutoff = _now() - timedelta(seconds=max_age_seconds)
    async with get_session() as session:
        rows = (await session.execute(
            select(PendingActionRow).where(
                PendingActionRow.status == CONFIRMED, PendingActionRow.confirmed_at < cutoff,
            ).with_for_update(skip_locked=True)
        )).scalars().all()
        for row in rows:
            new_status = FAILED if row.type in RETRY_SAFE_ACTIONS else RECONCILE_REQUIRED
            error = f"execution did not finish within {max_age_seconds}s (service restart or crash)"
            row.status = new_status
            row.failed_at = _now()
            row.error_message = error
            await _log_audit(session, action_id=row.action_id, event_type="STALE_EXECUTION",
                             old_status=CONFIRMED, new_status=new_status, event_metadata={"error": error})
        if rows:
            await session.commit()
        return len(rows)


async def mark_action_confirmed(action_id: str, actor_user_id: str | None = None) -> bool:
    """Claim the action for execution: PENDING_CONFIRMATION (or FAILED, which may
    be retried) -> CONFIRMED in ONE conditional UPDATE, recording who confirmed
    and when. Returns False if another request already claimed it (double click,
    client retry, a second tab) - the caller must then NOT execute, otherwise the
    same draft/order would be created twice. mark_action_executed /
    mark_action_failed move CONFIRMED to its terminal state."""
    async with get_session() as session:
        current = (await session.execute(
            select(PendingActionRow.status).where(PendingActionRow.action_id == action_id)
        )).scalar_one_or_none()
        result = await session.execute(
            update(PendingActionRow)
            .where(PendingActionRow.action_id == action_id,
                   PendingActionRow.status.in_([PENDING_CONFIRMATION, FAILED]))
            .values(status=CONFIRMED, confirmed_at=_now(), confirmed_by_user_id=actor_user_id)
        )
        if result.rowcount != 1:
            return False
        await _log_audit(
            session,
            action_id=action_id,
            event_type="CONFIRMED",
            old_status=current,
            new_status=CONFIRMED,
            actor_user_id=actor_user_id,
        )
        await session.commit()
        return True


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
