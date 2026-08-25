from __future__ import annotations

import uuid

from fastapi import APIRouter, HTTPException, Query, Request
from sqlalchemy import select

from agent_permissions import get_user_context
from agent_store import cleanup_expired_actions
from db import get_session
from db_models import ActionAuditLogRow, PendingActionRow

# Action Center endpoints — additive, alongside the existing /actions/confirm,
# /actions/cancel, /actions/pending/{id}, /actions/stats in main.py (kept where they
# are for frontend compatibility). Mounted under /assistant so it reads as part of the
# assistant surface, per the upgrade spec.
router = APIRouter(prefix="/assistant", tags=["ai-actions"])


def _is_admin(user_ctx) -> bool:
    return user_ctx.is_superuser or "ADMIN" in {r.upper() for r in (user_ctx.roles or [])}


def _row_to_summary(row: PendingActionRow) -> dict:
    return {
        "id": row.action_id,
        "type": row.type,
        "status": row.status,
        "summary": row.summary,
        "risk": row.risk,
        "requires_review": row.requires_review,
        "created_by_user_id": row.created_by_user_id,
        "created_at": row.created_at.isoformat(),
        "expires_at": row.expires_at.isoformat(),
        "conversation_id": str(row.conversation_id) if row.conversation_id else None,
    }


def _row_to_detail(row: PendingActionRow) -> dict:
    return {
        "id": row.action_id,
        "type": row.type,
        "status": row.status,
        "summary": row.summary,
        "payload": row.payload,
        "risk": row.risk,
        "requires_confirmation": row.requires_confirmation,
        "allowed_roles": row.allowed_roles,
        "allowed_permissions": row.allowed_permissions,
        "sources": row.sources,
        "intent": row.intent,
        "created_from_message": row.created_from_message,
        "warnings": row.warnings,
        "requires_review": row.requires_review,
        "created_by_user_id": row.created_by_user_id,
        "created_by_roles": row.created_by_roles,
        "confirmed_by_user_id": row.confirmed_by_user_id,
        "cancelled_by_user_id": row.cancelled_by_user_id,
        "result": row.result,
        "error_message": row.error_message,
        "conversation_id": str(row.conversation_id) if row.conversation_id else None,
        "created_at": row.created_at.isoformat(),
        "updated_at": row.updated_at.isoformat(),
        "expires_at": row.expires_at.isoformat(),
        "confirmed_at": row.confirmed_at.isoformat() if row.confirmed_at else None,
        "executed_at": row.executed_at.isoformat() if row.executed_at else None,
        "cancelled_at": row.cancelled_at.isoformat() if row.cancelled_at else None,
        "failed_at": row.failed_at.isoformat() if row.failed_at else None,
        "expired_at": row.expired_at.isoformat() if row.expired_at else None,
    }


@router.get("/actions")
async def list_actions(
    request: Request,
    status: str | None = Query(None),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    conversation_id: str | None = Query(None),
    mine: bool = Query(True),
):
    auth_header = request.headers.get("authorization")
    if not auth_header:
        raise HTTPException(status_code=401, detail="Authorization header required.")
    user_ctx = await get_user_context(auth_header)

    await cleanup_expired_actions()

    async with get_session() as session:
        query = select(PendingActionRow)
        if status:
            query = query.where(PendingActionRow.status == status.upper())
        if conversation_id:
            try:
                query = query.where(PendingActionRow.conversation_id == uuid.UUID(conversation_id))
            except ValueError:
                raise HTTPException(status_code=400, detail="conversation_id không hợp lệ.")
        # Non-admin/non-superuser callers can only browse their own actions, regardless
        # of `mine` — Action Center is not an audit-everyone view for regular staff.
        if mine or not _is_admin(user_ctx):
            query = query.where(PendingActionRow.created_by_user_id == user_ctx.user_id)
        query = query.order_by(PendingActionRow.created_at.desc()).offset(offset).limit(limit)
        result = await session.execute(query)
        rows = result.scalars().all()

    return {"items": [_row_to_summary(row) for row in rows], "limit": limit, "offset": offset}


@router.get("/actions/{action_id}")
async def get_action_detail(request: Request, action_id: str):
    auth_header = request.headers.get("authorization")
    if not auth_header:
        raise HTTPException(status_code=401, detail="Authorization header required.")
    user_ctx = await get_user_context(auth_header)

    async with get_session() as session:
        result = await session.execute(select(PendingActionRow).where(PendingActionRow.action_id == action_id))
        row = result.scalar_one_or_none()
        if row is None:
            raise HTTPException(status_code=404, detail="Action not found.")
        if row.created_by_user_id and row.created_by_user_id != user_ctx.user_id and not _is_admin(user_ctx):
            raise HTTPException(status_code=403, detail="Forbidden.")

        audit_result = await session.execute(
            select(ActionAuditLogRow)
            .where(ActionAuditLogRow.action_id == action_id)
            .order_by(ActionAuditLogRow.created_at.asc())
        )
        audit_rows = audit_result.scalars().all()

    return {
        "action": _row_to_detail(row),
        "audit_logs": [
            {
                "event_type": a.event_type,
                "actor_user_id": a.actor_user_id,
                "actor_roles": a.actor_roles,
                "old_status": a.old_status,
                "new_status": a.new_status,
                "metadata": a.event_metadata,
                "created_at": a.created_at.isoformat(),
            }
            for a in audit_rows
        ],
    }
