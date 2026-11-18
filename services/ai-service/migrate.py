"""Explicit schema-owner job. Runtime production startup performs no DDL."""
from __future__ import annotations

import asyncio
from pathlib import Path

from sqlalchemy import text
from db import _load_statements, engine


async def migrate() -> None:
    root = Path(__file__).parent
    files = [root / "schema.sql", *sorted((root / "migrations").glob("*.sql"))]
    async with engine.begin() as connection:
        for path in files:
            for statement in _load_statements(path):
                await connection.execute(text(statement))
    await engine.dispose()
    print("AI owner schema job completed")


if __name__ == "__main__":
    asyncio.run(migrate())
