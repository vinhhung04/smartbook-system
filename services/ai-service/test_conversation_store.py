"""conversation_store tests — in-memory SQLite, same pattern as test_agent_store.py."""
from __future__ import annotations

import asyncio
import uuid

from sqlalchemy import event
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

import conversation_store
from agent_schemas import UserContext
from db_models import Base

_engine = create_async_engine(
    "sqlite+aiosqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool
)
_session_factory = async_sessionmaker(_engine, expire_on_commit=False)


@event.listens_for(_engine.sync_engine, "connect")
def _enable_sqlite_fk(dbapi_connection, _connection_record):
    dbapi_connection.execute("PRAGMA foreign_keys=ON")


def _test_session():
    return _session_factory()


conversation_store.get_session = _test_session


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


def test_get_or_create_conversation_generates_title_from_first_message():
    async def _t():
        conv = await conversation_store.get_or_create_conversation(
            None, _user(), first_message="Top sách mượn nhiều nhất tháng này?"
        )
        assert conv.title == "Top sách mượn nhiều nhất tháng này?"
        assert conv.user_id == "u1"
        assert conv.status == "ACTIVE"

    _run(_t())


def test_get_or_create_conversation_is_idempotent_for_same_id():
    async def _t():
        cid = str(uuid.uuid4())
        first = await conversation_store.get_or_create_conversation(cid, _user(), first_message="hỏi 1")
        second = await conversation_store.get_or_create_conversation(cid, _user(), first_message="hỏi khác")
        assert first.id == second.id
        # Title only set on first creation, not overwritten by later calls.
        assert second.title == "hỏi 1"

    _run(_t())


def test_append_message_and_get_recent_messages_respects_limit():
    async def _t():
        conv = await conversation_store.get_or_create_conversation(None, _user(), first_message="ctx test")
        for i in range(15):
            await conversation_store.append_message(conv.id, role="user", content=f"msg {i}")

        recent = await conversation_store.get_recent_messages(conv.id, limit=10)
        assert len(recent) == 10
        # Oldest-first order, and it's the *last* 10, not the first 10.
        assert [m.content for m in recent] == [f"msg {i}" for i in range(5, 15)]

    _run(_t())


def test_list_conversations_excludes_archived_by_default():
    async def _t():
        user = _user("u2")
        active = await conversation_store.get_or_create_conversation(None, user, first_message="active convo")
        archived = await conversation_store.get_or_create_conversation(None, user, first_message="archived convo")
        await conversation_store.archive_conversation(str(archived.conversation_id))

        rows = await conversation_store.list_conversations(user.user_id)
        ids = {row.id for row in rows}
        assert active.id in ids
        assert archived.id not in ids

    _run(_t())


def test_rename_conversation():
    async def _t():
        conv = await conversation_store.get_or_create_conversation(None, _user(), first_message="ban đầu")
        updated = await conversation_store.rename_conversation(str(conv.conversation_id), "Tên mới")
        assert updated.title == "Tên mới"

    _run(_t())


def test_get_conversation_detail_returns_messages_in_order():
    async def _t():
        conv = await conversation_store.get_or_create_conversation(None, _user(), first_message="q1")
        await conversation_store.append_message(conv.id, role="user", content="q1")
        await conversation_store.append_message(conv.id, role="assistant", content="a1")

        detail = await conversation_store.get_conversation_detail(str(conv.conversation_id))
        assert detail is not None
        row, messages = detail
        assert row.id == conv.id
        assert [m.role for m in messages] == ["user", "assistant"]

    _run(_t())
