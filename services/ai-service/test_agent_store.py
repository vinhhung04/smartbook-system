"""agent_store tests — run against an in-memory SQLite DB (aiosqlite) instead of a
real Postgres, so they work without any DB infrastructure. See db.py for how the
StaticPool keeps the whole test run on one shared in-memory DB."""
from __future__ import annotations

import asyncio
import uuid

from sqlalchemy import event, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

import agent_store
from agent_schemas import UserContext
from db_models import ActionAuditLogRow, Base, ConversationRow

_engine = create_async_engine(
    "sqlite+aiosqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool
)
_session_factory = async_sessionmaker(_engine, expire_on_commit=False)


@event.listens_for(_engine.sync_engine, "connect")
def _enable_sqlite_fk(dbapi_connection, _connection_record):
    # SQLite ignores FK constraints unless explicitly turned on per connection — without
    # this, a bad FK target (like the ai_conversations.id vs .conversation_id mismatch
    # this suite once had) would silently pass tests but fail against real Postgres.
    dbapi_connection.execute("PRAGMA foreign_keys=ON")


def _test_session():
    return _session_factory()


# Redirect agent_store's DB access to the in-memory test engine.
agent_store.get_session = _test_session


def _run(coro):
    return asyncio.run(coro)


def _user(user_id: str = "u1") -> UserContext:
    return UserContext(
        user_id=user_id, username="tester", email="t@example.com",
        roles=["ADMIN"], permissions=[], is_superuser=False,
    )


def setup_module(_module):
    _run(_create_tables())


async def _create_tables():
    async with _engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


async def _audit_events(action_id: str) -> list[str]:
    async with _test_session() as session:
        rows = (
            await session.execute(
                select(ActionAuditLogRow)
                .where(ActionAuditLogRow.action_id == action_id)
                .order_by(ActionAuditLogRow.created_at.asc())
            )
        ).scalars().all()
    return [row.event_type for row in rows]


def test_create_pending_action_writes_created_audit_log():
    async def _t():
        action = await agent_store.create_pending_action(
            action_type="CREATE_REPORT_DRAFT", summary="s1", payload={"a": 1}, risk="LOW",
            user_context=_user(),
        )
        assert action.status == "PENDING_CONFIRMATION"
        assert action.id.startswith("act_")
        assert await _audit_events(action.id) == ["CREATED"]

    _run(_t())


def test_get_pending_action_round_trips():
    async def _t():
        created = await agent_store.create_pending_action(
            action_type="CREATE_STOCK_ALERT", summary="s2", payload={}, risk="LOW", user_context=_user(),
        )
        fetched = await agent_store.get_pending_action(created.id)
        assert fetched is not None
        assert fetched.id == created.id
        assert fetched.summary == "s2"

    _run(_t())


def test_confirm_execute_lifecycle():
    async def _t():
        action = await agent_store.create_pending_action(
            action_type="CREATE_REPORT_DRAFT", summary="s3", payload={}, risk="LOW", user_context=_user(),
        )
        await agent_store.mark_action_confirmed(action.id, actor_user_id="u1")
        ok = await agent_store.mark_action_executed(action.id, {"done": True}, actor_user_id="u1")
        assert ok

        fetched = await agent_store.get_pending_action(action.id)
        assert fetched.status == "EXECUTED"
        assert await agent_store.get_action_result(action.id) == {"done": True}
        assert await _audit_events(action.id) == ["CREATED", "CONFIRMED", "EXECUTED"]

    _run(_t())


def test_mark_action_failed():
    async def _t():
        action = await agent_store.create_pending_action(
            action_type="CREATE_STOCK_ALERT", summary="s4", payload={}, risk="LOW", user_context=_user(),
        )
        ok = await agent_store.mark_action_failed(action.id, "boom", actor_user_id="u1")
        assert ok
        fetched = await agent_store.get_pending_action(action.id)
        assert fetched.status == "FAILED"
        assert await agent_store.get_action_result(action.id) == {"error": "boom"}
        assert await _audit_events(action.id) == ["CREATED", "FAILED"]

    _run(_t())


def test_cancel_pending_action():
    async def _t():
        action = await agent_store.create_pending_action(
            action_type="CREATE_STOCK_ALERT", summary="s5", payload={}, risk="LOW", user_context=_user(),
        )
        ok = await agent_store.cancel_pending_action(action.id, actor_user_id="u1")
        assert ok
        fetched = await agent_store.get_pending_action(action.id)
        assert fetched.status == "CANCELLED"
        assert await _audit_events(action.id) == ["CREATED", "CANCELLED"]

    _run(_t())


def test_expired_action_flips_status_on_read():
    async def _t():
        action = await agent_store.create_pending_action(
            action_type="CREATE_STOCK_ALERT", summary="s6", payload={}, risk="LOW",
            user_context=_user(), ttl_seconds=-1,
        )
        fetched = await agent_store.get_pending_action(action.id)
        assert fetched.status == "EXPIRED"
        assert agent_store.is_expired(fetched)
        assert await _audit_events(action.id) == ["CREATED", "EXPIRED"]

    _run(_t())


def test_create_pending_action_with_conversation_id_links_to_conversation():
    # Regression test: conversation_id must reference ai_conversations.conversation_id
    # (the public id), not the internal id PK — a real bug caught only by testing
    # against actual Postgres, since SQLite silently ignores FK violations unless
    # PRAGMA foreign_keys=ON (enabled above).
    async def _t():
        conv = ConversationRow(conversation_id=uuid.uuid4(), user_id="u1", user_roles=["ADMIN"])
        async with _test_session() as session:
            session.add(conv)
            await session.commit()
            await session.refresh(conv)

        action = await agent_store.create_pending_action(
            action_type="CREATE_REORDER_DRAFT", summary="s9", payload={}, risk="LOW",
            user_context=_user(), conversation_id=str(conv.conversation_id),
        )
        assert action.status == "PENDING_CONFIRMATION"

    _run(_t())


def test_cleanup_expired_actions_counts_due_rows():
    async def _t():
        await agent_store.create_pending_action(
            action_type="CREATE_STOCK_ALERT", summary="s7", payload={}, risk="LOW",
            user_context=_user(), ttl_seconds=-1,
        )
        await agent_store.create_pending_action(
            action_type="CREATE_STOCK_ALERT", summary="s8", payload={}, risk="LOW",
            user_context=_user(),
        )
        count = await agent_store.cleanup_expired_actions()
        assert count >= 1

    _run(_t())
