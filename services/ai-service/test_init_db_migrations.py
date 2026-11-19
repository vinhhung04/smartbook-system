"""Dev startup (schema not managed externally) must create the inference-budget table."""
import asyncio
import os
import unittest
from contextlib import asynccontextmanager
from unittest import mock

import db


class _Conn:
    def __init__(self, seen):
        self.seen = seen

    async def execute(self, statement):
        self.seen.append(str(statement))


class InitDbMigrationsTest(unittest.TestCase):
    def test_runtime_init_applies_migrations_like_migrate_py(self):
        seen = []

        @asynccontextmanager
        async def begin():
            yield _Conn(seen)

        with mock.patch.dict(os.environ, {"AI_SCHEMA_MANAGED_EXTERNALLY": "false"}), \
                mock.patch.object(db, "engine", mock.Mock(begin=begin)):
            asyncio.run(db.init_db())
        self.assertTrue(any("CREATE TABLE IF NOT EXISTS ai_inference_leases" in s for s in seen))


if __name__ == "__main__":
    unittest.main()
