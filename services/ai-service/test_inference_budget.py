"""Admission across independent processes, against the isolated ai_audit DB."""
import asyncio
import multiprocessing
import os
import unittest
import uuid
from unittest.mock import patch

from fastapi import HTTPException
from sqlalchemy import text

from ai_core.inference_budget import InferenceBudget, opaque_principal
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker


def _worker(feature, principal, start, results):
    start.wait(10)
    try:
        async def admit():
            engine = create_async_engine(os.environ['AI_BUDGET_TEST_DATABASE_URL'])
            try:
                return await InferenceBudget(async_sessionmaker(engine, expire_on_commit=False)).admit(feature, principal)
            finally:
                await engine.dispose()
        lease = asyncio.run(admit())
        results.put((200, lease))
    except HTTPException as exc:
        results.put((exc.status_code, None))


@unittest.skipUnless(os.getenv('AI_BUDGET_TEST_DATABASE_URL'), 'isolated AI quota database required')
class InferenceBudgetDatabaseTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        from sqlalchemy.engine import make_url
        target = make_url(os.environ['AI_BUDGET_TEST_DATABASE_URL'])
        self.assertIn(target.host, ('127.0.0.1', 'localhost'))
        self.assertEqual(target.database, 'ai_audit')
        self.engine = create_async_engine(os.environ['AI_BUDGET_TEST_DATABASE_URL'])
        self.session_factory = async_sessionmaker(self.engine, expire_on_commit=False)
        self.budget = InferenceBudget(self.session_factory)
        self.feature = 'test-' + uuid.uuid4().hex
        self.principal = opaque_principal('test:' + uuid.uuid4().hex)
        self.leases = []
        async with self.session_factory() as session:
            self.baseline = (await session.execute(text("SELECT count(*) FROM ai_inference_leases WHERE created_at >= date_trunc('day', CURRENT_TIMESTAMP AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'"))).scalar_one()
        self.settings = patch.dict(os.environ, {'AI_PAID_USER_HOURLY_REQUESTS': '40', 'AI_PAID_USER_DAILY_REQUESTS': '100',
            'AI_PAID_GLOBAL_DAILY_REQUESTS': str(self.baseline + 100), 'AI_PAID_MAX_CONCURRENT': '20'})
        self.settings.start()

    async def asyncTearDown(self):
        for lease in self.leases:
            await self.budget.complete(lease)
        self.settings.stop()
        # IsolatedAsyncioTestCase changes event loops between tests.
        await self.engine.dispose()

    async def competing_processes(self, count=4, same_principal=False):
        context = multiprocessing.get_context('spawn')
        start, results = context.Event(), context.Queue()
        processes = [context.Process(target=_worker, args=(self.feature,
            self.principal if same_principal else opaque_principal('worker:' + uuid.uuid4().hex), start, results)) for _ in range(count)]
        for process in processes:
            process.start()
        start.set()
        responses = [await asyncio.to_thread(results.get, True, 20) for _ in processes]
        for process in processes:
            await asyncio.to_thread(process.join, 10)
            self.assertEqual(process.exitcode, 0)
        self.leases.extend(lease for status, lease in responses if status == 200)
        return sorted(status for status, _ in responses)

    async def test_same_principal_quota_is_shared_across_independent_processes(self):
        os.environ['AI_PAID_USER_HOURLY_REQUESTS'] = '1'
        self.assertEqual(await self.competing_processes(same_principal=True), [200, 429, 429, 429])

    async def test_global_daily_budget_is_shared_across_different_users_and_processes(self):
        os.environ['AI_PAID_GLOBAL_DAILY_REQUESTS'] = str(self.baseline + 2)
        self.assertEqual(await self.competing_processes(), [200, 200, 429, 429])

    async def test_concurrency_is_shared_across_different_users_and_processes(self):
        os.environ['AI_PAID_MAX_CONCURRENT'] = '1'
        self.assertEqual(await self.competing_processes(), [200, 429, 429, 429])

    async def test_failed_provider_attempt_consumes_quota_and_releases_concurrency(self):
        os.environ['AI_PAID_USER_HOURLY_REQUESTS'] = '1'
        with self.assertRaisesRegex(RuntimeError, 'mock provider failed'):
            async with self.budget.reserve(self.feature, self.principal):
                raise RuntimeError('mock provider failed')
        with self.assertRaises(HTTPException) as conflict:
            await self.budget.admit(self.feature, self.principal)
        self.assertEqual(conflict.exception.status_code, 429)
        async with self.session_factory() as session:
            active = (await session.execute(text('SELECT count(*) FROM ai_inference_leases WHERE feature=:feature AND completed_at IS NULL'), {'feature': self.feature})).scalar_one()
        self.assertEqual(active, 0)

    async def test_expired_crashed_lease_releases_capacity_without_refunding_attempt(self):
        os.environ['AI_PAID_MAX_CONCURRENT'] = '1'
        lease = await self.budget.admit(self.feature, self.principal)
        self.leases.append(lease)
        async with self.session_factory() as session, session.begin():
            await session.execute(text("UPDATE ai_inference_leases SET created_at=CURRENT_TIMESTAMP-INTERVAL '10 minutes', expires_at=CURRENT_TIMESTAMP-INTERVAL '5 minutes' WHERE id=CAST(:id AS uuid)"), {'id': lease})
        self.leases.append(await self.budget.admit(self.feature, self.principal))
        async with self.session_factory() as session:
            attempts = (await session.execute(text('SELECT count(*) FROM ai_inference_leases WHERE feature=:feature'), {'feature': self.feature})).scalar_one()
        self.assertEqual(attempts, 2)


class InferenceBudgetUnavailableTests(unittest.IsolatedAsyncioTestCase):
    async def test_unavailable_database_fails_closed(self):
        def unavailable():
            raise RuntimeError('mock database unavailable')
        with self.assertRaises(HTTPException) as denied:
            await InferenceBudget(unavailable).admit('test', '0' * 64)
        self.assertEqual(denied.exception.status_code, 503)

    async def test_principal_hash_is_stable_and_contains_no_raw_user_identity(self):
        with patch.dict(os.environ, {'AI_BUDGET_PRINCIPAL_SALT': 'test-only-stable-salt'}):
            one = opaque_principal('user:private-user-id')
            two = opaque_principal('user:private-user-id')
        self.assertEqual(one, two)
        self.assertEqual(len(one), 64)
        self.assertNotIn('private-user-id', one)


if __name__ == '__main__':
    unittest.main()
