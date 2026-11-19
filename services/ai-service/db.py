from __future__ import annotations

import logging
import os
from pathlib import Path

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

logger = logging.getLogger("uvicorn.error")

DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql+asyncpg://user:password@localhost:5432/ai_db",
)

# SQLite (aiosqlite) is only ever used in tests, in-memory — StaticPool keeps every
# connection on the same in-memory DB for the life of the process (the default pool
# would otherwise hand out a fresh, empty DB per connection). No effect on Postgres.
if DATABASE_URL.startswith("sqlite"):
    from sqlalchemy.pool import StaticPool

    engine = create_async_engine(
        DATABASE_URL, connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
else:
    engine = create_async_engine(DATABASE_URL, pool_pre_ping=True)
async_session_factory = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)


def get_session() -> AsyncSession:
    """Return a new AsyncSession. Callers are responsible for closing it
    (use `async with get_session() as session:`)."""
    return async_session_factory()


def _load_statements(schema_path: Path) -> list[str]:
    """Strip full-line SQL comments, then split into individual statements on ';'.
    Simple by design — schema.sql only ever contains CREATE ... IF NOT EXISTS
    statements with no semicolons inside string literals."""
    lines = [
        line for line in schema_path.read_text(encoding="utf-8").splitlines()
        if not line.strip().startswith("--")
    ]
    sql_text = "\n".join(lines)
    return [stmt.strip() for stmt in sql_text.split(";") if stmt.strip()]


async def init_db() -> None:
    """Apply schema.sql idempotently against DATABASE_URL. Safe to call on every
    service startup — every statement is CREATE ... IF NOT EXISTS."""
    if os.getenv("AI_SCHEMA_MANAGED_EXTERNALLY", "false").lower() == "true":
        async with engine.connect() as connection:
            # Fail closed when the explicit owner job was not run. No CREATE,
            # ALTER, migration password, or quota schema auto-repair at runtime.
            await connection.execute(text("SELECT 1 FROM ai_conversations LIMIT 0"))
            await connection.execute(text("SELECT 1 FROM ai_inference_leases LIMIT 0"))
        return
    # Same files as migrate.py: the budget gate needs ai_inference_leases from migrations/.
    root = Path(__file__).parent
    statements = [stmt for path in [root / "schema.sql", *sorted((root / "migrations").glob("*.sql"))]
                  for stmt in _load_statements(path)]
    async with engine.begin() as conn:
        for statement in statements:
            await conn.execute(text(statement))
    logger.info("ai-service: DB schema ready (%d statements applied)", len(statements))
