from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

import conversation_store
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
        "created_at": row.created_at.isoformat(),
    }


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
    return conv, messages


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
    conv, messages = await _require_owner(auth_header, conversation_id)
    return {
        "conversation": _conversation_summary(conv),
        "messages": [_message_summary(m) for m in messages],
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
