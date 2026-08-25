from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import JSON, Boolean, DateTime, ForeignKey, Text, Uuid
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

# Portable JSON: JSONB on Postgres (indexable, native), plain JSON elsewhere (e.g. the
# aiosqlite engine used by tests) — lets tests run without a real Postgres instance.
JSONType = JSON().with_variant(JSONB(), "postgresql")

# Explicit timezone=True (rather than relying on the DateTime type inferred from
# Mapped[datetime]) so aware UTC datetimes round-trip correctly on both Postgres
# (asyncpg) and the SQLite/aiosqlite engine used by tests.
TZDateTime = DateTime(timezone=True)


def _now() -> datetime:
    return datetime.now(timezone.utc)


class Base(DeclarativeBase):
    pass


class ConversationRow(Base):
    __tablename__ = "ai_conversations"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    conversation_id: Mapped[uuid.UUID] = mapped_column(Uuid, unique=True, nullable=False)
    title: Mapped[str | None] = mapped_column(Text, nullable=True)
    user_id: Mapped[str] = mapped_column(nullable=False)
    user_roles: Mapped[list] = mapped_column(JSONType, nullable=False, default=list)
    status: Mapped[str] = mapped_column(nullable=False, default="ACTIVE")
    summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    last_intent: Mapped[str | None] = mapped_column(nullable=True)
    created_at: Mapped[datetime] = mapped_column(TZDateTime, nullable=False, default=_now)
    updated_at: Mapped[datetime] = mapped_column(TZDateTime, nullable=False, default=_now, onupdate=_now)
    last_message_at: Mapped[datetime | None] = mapped_column(TZDateTime, nullable=True)


class MessageRow(Base):
    __tablename__ = "ai_messages"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    conversation_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("ai_conversations.id", ondelete="CASCADE"), nullable=False
    )
    role: Mapped[str] = mapped_column(nullable=False)
    content: Mapped[str | None] = mapped_column(Text, nullable=True)
    tool_calls: Mapped[list | None] = mapped_column(JSONType, nullable=True)
    tool_results: Mapped[dict | None] = mapped_column(JSONType, nullable=True)
    data: Mapped[dict | None] = mapped_column(JSONType, nullable=True)
    pending_action_id: Mapped[str | None] = mapped_column(nullable=True)
    grounding_warning: Mapped[str | None] = mapped_column(Text, nullable=True)
    sources: Mapped[list | None] = mapped_column(JSONType, nullable=True)
    msg_metadata: Mapped[dict | None] = mapped_column("metadata", JSONType, nullable=True)
    created_at: Mapped[datetime] = mapped_column(TZDateTime, nullable=False, default=_now)


class PendingActionRow(Base):
    __tablename__ = "ai_pending_actions"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    action_id: Mapped[str] = mapped_column(unique=True, nullable=False)
    type: Mapped[str] = mapped_column(nullable=False)
    status: Mapped[str] = mapped_column(nullable=False, default="PENDING_CONFIRMATION")
    summary: Mapped[str] = mapped_column(Text, nullable=False)
    payload: Mapped[dict] = mapped_column(JSONType, nullable=False, default=dict)
    risk: Mapped[str] = mapped_column(nullable=False)
    requires_confirmation: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    allowed_roles: Mapped[list] = mapped_column(JSONType, nullable=False, default=list)
    allowed_permissions: Mapped[list] = mapped_column(JSONType, nullable=False, default=list)
    sources: Mapped[list] = mapped_column(JSONType, nullable=False, default=list)
    intent: Mapped[str | None] = mapped_column(nullable=True)
    created_from_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    warnings: Mapped[list] = mapped_column(JSONType, nullable=False, default=list)
    requires_review: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_by_user_id: Mapped[str | None] = mapped_column(nullable=True)
    created_by_roles: Mapped[list] = mapped_column(JSONType, nullable=False, default=list)
    confirmed_by_user_id: Mapped[str | None] = mapped_column(nullable=True)
    cancelled_by_user_id: Mapped[str | None] = mapped_column(nullable=True)
    result: Mapped[dict | None] = mapped_column(JSONType, nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    # References the public conversation_id (not the internal id PK) — that's the value
    # every caller (API responses, frontend, this column's own writers) actually holds.
    conversation_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("ai_conversations.conversation_id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(TZDateTime, nullable=False, default=_now)
    updated_at: Mapped[datetime] = mapped_column(TZDateTime, nullable=False, default=_now, onupdate=_now)
    expires_at: Mapped[datetime] = mapped_column(TZDateTime, nullable=False)
    confirmed_at: Mapped[datetime | None] = mapped_column(TZDateTime, nullable=True)
    executed_at: Mapped[datetime | None] = mapped_column(TZDateTime, nullable=True)
    cancelled_at: Mapped[datetime | None] = mapped_column(TZDateTime, nullable=True)
    failed_at: Mapped[datetime | None] = mapped_column(TZDateTime, nullable=True)
    expired_at: Mapped[datetime | None] = mapped_column(TZDateTime, nullable=True)


class ActionAuditLogRow(Base):
    __tablename__ = "ai_action_audit_logs"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    action_id: Mapped[str] = mapped_column(nullable=False)
    event_type: Mapped[str] = mapped_column(nullable=False)
    actor_user_id: Mapped[str | None] = mapped_column(nullable=True)
    actor_roles: Mapped[list] = mapped_column(JSONType, nullable=False, default=list)
    old_status: Mapped[str | None] = mapped_column(nullable=True)
    new_status: Mapped[str | None] = mapped_column(nullable=True)
    payload_snapshot: Mapped[dict | None] = mapped_column(JSONType, nullable=True)
    event_metadata: Mapped[dict | None] = mapped_column("metadata", JSONType, nullable=True)
    created_at: Mapped[datetime] = mapped_column(TZDateTime, nullable=False, default=_now)
