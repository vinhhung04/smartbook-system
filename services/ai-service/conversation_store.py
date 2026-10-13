from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import select, update

from agent_schemas import UserContext
from db import get_session
from db_models import ConversationRow, MessageRow

RECENT_MESSAGE_LIMIT = 10
TITLE_MAX_LEN = 60


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _parse_uuid(value: str | None) -> uuid.UUID:
    if value:
        try:
            return uuid.UUID(value)
        except ValueError:
            pass
    return uuid.uuid4()


def _make_title(message: str) -> str:
    text = " ".join(message.strip().split())
    if len(text) <= TITLE_MAX_LEN:
        return text
    return text[:TITLE_MAX_LEN].rstrip() + "..."


class ConversationAccessDenied(Exception):
    """The conversation_id exists but belongs to another user."""


def is_conversation_owner(row: ConversationRow, user_ctx: UserContext) -> bool:
    # An empty user_id on either side never matches: a context without an id
    # must not inherit a conversation created by another id-less context.
    return bool(row.user_id) and bool(user_ctx.user_id) and row.user_id == user_ctx.user_id


async def get_or_create_conversation(
    conversation_id: str | None, user_ctx: UserContext, first_message: str | None = None
) -> ConversationRow:
    """Resolve an existing conversation by conversation_id, or create one under that
    same id (or a freshly generated one if conversation_id was missing/invalid).

    Raises ConversationAccessDenied when the id belongs to another user - the
    caller would otherwise load that user's history into its own prompt and
    append its turns to their conversation. No superuser exception here: this
    path writes, and an admin reading someone's conversation goes through the
    read-only GET /assistant/conversations/{id} instead."""
    cid = _parse_uuid(conversation_id)

    async with get_session() as session:
        result = await session.execute(
            select(ConversationRow).where(ConversationRow.conversation_id == cid)
        )
        row = result.scalar_one_or_none()
        if row is not None:
            if not is_conversation_owner(row, user_ctx):
                raise ConversationAccessDenied(str(cid))
            return row

        row = ConversationRow(
            conversation_id=cid,
            title=_make_title(first_message) if first_message else None,
            user_id=user_ctx.user_id or "",
            user_roles=list(user_ctx.roles or []),
            status="ACTIVE",
        )
        session.add(row)
        await session.commit()
        await session.refresh(row)
        return row


async def append_message(
    conversation_id: uuid.UUID,
    role: str,
    content: str | None = None,
    tool_calls: list | None = None,
    tool_results: dict | None = None,
    data: dict | None = None,
    pending_action_id: str | None = None,
    grounding_warning: str | None = None,
    sources: list | None = None,
    metadata: dict | None = None,
) -> None:
    async with get_session() as session:
        session.add(
            MessageRow(
                conversation_id=conversation_id,
                role=role,
                content=content,
                tool_calls=tool_calls,
                tool_results=tool_results,
                data=data,
                pending_action_id=pending_action_id,
                grounding_warning=grounding_warning,
                sources=sources,
                msg_metadata=metadata,
            )
        )
        await session.execute(
            update(ConversationRow)
            .where(ConversationRow.id == conversation_id)
            .values(last_message_at=_now(), updated_at=_now())
        )
        await session.commit()


async def get_recent_messages(conversation_id: uuid.UUID, limit: int = RECENT_MESSAGE_LIMIT) -> list[MessageRow]:
    async with get_session() as session:
        result = await session.execute(
            select(MessageRow)
            .where(MessageRow.conversation_id == conversation_id)
            .order_by(MessageRow.created_at.desc())
            .limit(limit)
        )
        rows = list(result.scalars().all())
        rows.reverse()
        return rows


async def list_conversations(user_id: str, include_archived: bool = False, limit: int = 50) -> list[ConversationRow]:
    async with get_session() as session:
        query = select(ConversationRow).where(ConversationRow.user_id == user_id)
        if not include_archived:
            query = query.where(ConversationRow.status == "ACTIVE")
        query = query.order_by(ConversationRow.last_message_at.desc().nullslast(), ConversationRow.created_at.desc()).limit(limit)
        result = await session.execute(query)
        return list(result.scalars().all())


async def get_conversation_detail(conversation_id: str) -> tuple[ConversationRow, list[MessageRow]] | None:
    cid = _parse_uuid(conversation_id)
    async with get_session() as session:
        result = await session.execute(
            select(ConversationRow).where(ConversationRow.conversation_id == cid)
        )
        row = result.scalar_one_or_none()
        if row is None:
            return None
        msg_result = await session.execute(
            select(MessageRow).where(MessageRow.conversation_id == row.id).order_by(MessageRow.created_at.asc())
        )
        return row, list(msg_result.scalars().all())


async def rename_conversation(conversation_id: str, title: str) -> ConversationRow | None:
    cid = _parse_uuid(conversation_id)
    async with get_session() as session:
        result = await session.execute(
            select(ConversationRow).where(ConversationRow.conversation_id == cid)
        )
        row = result.scalar_one_or_none()
        if row is None:
            return None
        row.title = title.strip()[:255] or row.title
        row.updated_at = _now()
        await session.commit()
        await session.refresh(row)
        return row


async def archive_conversation(conversation_id: str) -> bool:
    cid = _parse_uuid(conversation_id)
    async with get_session() as session:
        result = await session.execute(
            select(ConversationRow).where(ConversationRow.conversation_id == cid)
        )
        row = result.scalar_one_or_none()
        if row is None:
            return False
        row.status = "ARCHIVED"
        row.updated_at = _now()
        await session.commit()
        return True
