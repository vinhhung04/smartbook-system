from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

import conversation_store
import warehouse_scope
from agent_permissions import get_user_context
from db_models import ConversationRow, MessageRow

router = APIRouter(prefix="/assistant", tags=["ai-conversations"])


def _conversation_summary(row: ConversationRow) -> dict:
    return {
        "conversation_id": str(row.conversation_id),
        "title": row.title,
        "status": row.status,
        "last_intent": row.last_intent,
        "created_at": row.created_at.isoformat(),
        "updated_at": row.updated_at.isoformat(),
        "last_message_at": row.last_message_at.isoformat() if row.last_message_at else None,
    }


def _message_summary(row: MessageRow) -> dict:
    return {
        "role": row.role,
        "content": row.content,
        "tool_calls": row.tool_calls,
        "tool_results": row.tool_results,
        "data": row.data,
        "pending_action_id": row.pending_action_id,
        "grounding_warning": row.grounding_warning,
        "sources": row.sources,
        # Copilot extras (recommendations, caveats, follow-ups) so a reopened
        # conversation renders like the live one. The internal conversation
        # state stays server-side.
        "extras": (row.msg_metadata or {}).get("extras") if isinstance(row.msg_metadata, dict) else None,
        "created_at": row.created_at.isoformat(),
    }


def _stored_warehouse_ids(row: MessageRow) -> set[str]:
    meta = row.msg_metadata if isinstance(row.msg_metadata, dict) else {}
    if isinstance(meta.get("warehouse_ids"), list):
        return {str(x) for x in meta["warehouse_ids"]}
    # Turns stored before warehouse_ids was recorded: read them off the data.
    return warehouse_scope.warehouse_ids_in(row.data) | warehouse_scope.warehouse_ids_in(row.tool_results)


def _masked_summary(row: MessageRow, notice: str) -> dict:
    """The stored turn as shown when its warehouses are outside the reader's
    current scope: text, charts, data and cards withheld; the row is kept."""
    summary = _message_summary(row)
    extras = dict(summary.get("extras") or {})
    for key in ("visualizations", "recommendations", "caveats", "suggested_followups"):
        extras[key] = []
    extras.update(explanation=None, visualization_notes=[notice], withheld=True)
    summary.update(content=notice, data=None, tool_results=None, tool_calls=None, sources=None, extras=extras)
    return summary


async def _scoped_summaries(messages: list[MessageRow], user_ctx) -> list[dict]:
    """History is shown under the reader's CURRENT warehouse scope: a turn
    whose data names a warehouse they can no longer read is masked (fail-closed
    when the scope cannot be read). Snapshots are never refreshed here."""
    try:
        readable = await warehouse_scope.readable_warehouses(user_ctx)
        notice = warehouse_scope.MASKED_NOTICE
    except warehouse_scope.ScopeUnavailable:
        readable, notice = frozenset(), warehouse_scope.UNVERIFIED_NOTICE
    out = []
    for row in messages:
        ids = _stored_warehouse_ids(row) if row.role == "assistant" else set()
        out.append(_message_summary(row) if warehouse_scope.covered(ids, readable) else _masked_summary(row, notice))
    return out


class RenameConversationRequest(BaseModel):
    title: str


async def _require_owner(auth_header: str | None, conversation_id: str):
    if not auth_header:
        raise HTTPException(status_code=401, detail="Authorization header required.")
    user_ctx = await get_user_context(auth_header)
    detail = await conversation_store.get_conversation_detail(conversation_id)
    if detail is None:
        raise HTTPException(status_code=404, detail="Conversation not found.")
    conv, messages = detail
    if conv.user_id != user_ctx.user_id and not user_ctx.is_superuser:
        raise HTTPException(status_code=403, detail="Forbidden.")
    return conv, messages, user_ctx


@router.get("/conversations")
async def list_conversations(request: Request):
    auth_header = request.headers.get("authorization")
    if not auth_header:
        raise HTTPException(status_code=401, detail="Authorization header required.")
    user_ctx = await get_user_context(auth_header)
    rows = await conversation_store.list_conversations(user_ctx.user_id or "")
    return {"items": [_conversation_summary(row) for row in rows]}


@router.get("/conversations/{conversation_id}")
async def get_conversation(request: Request, conversation_id: str):
    auth_header = request.headers.get("authorization")
    conv, messages, user_ctx = await _require_owner(auth_header, conversation_id)
    return {
        "conversation": _conversation_summary(conv),
        "messages": await _scoped_summaries(messages, user_ctx),
    }


@router.patch("/conversations/{conversation_id}")
async def rename_conversation(request: Request, conversation_id: str, body: RenameConversationRequest):
    auth_header = request.headers.get("authorization")
    await _require_owner(auth_header, conversation_id)
    if not body.title.strip():
        raise HTTPException(status_code=400, detail="Title không được để trống.")
    updated = await conversation_store.rename_conversation(conversation_id, body.title)
    return _conversation_summary(updated)


@router.delete("/conversations/{conversation_id}")
async def delete_conversation(request: Request, conversation_id: str):
    auth_header = request.headers.get("authorization")
    await _require_owner(auth_header, conversation_id)
    await conversation_store.archive_conversation(conversation_id)
    return {"success": True, "conversation_id": conversation_id, "status": "ARCHIVED"}
