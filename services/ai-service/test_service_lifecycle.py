import asyncio
import unittest
from contextlib import ExitStack
from unittest.mock import AsyncMock, patch
from types import SimpleNamespace

import httpx

from ai_core.lifecycle import AiServiceLifecycle


class AiLifecycleTests(unittest.IsolatedAsyncioTestCase):
    async def test_stop_prevents_new_work_and_waits_for_active_job_before_resources(self):
        lifecycle = AiServiceLifecycle(timeout_seconds=1)
        lifecycle.mark_ready()
        release = asyncio.Event()
        events = []
        async def work():
            await release.wait()
            events.append('work-drained')
        lifecycle.track(work(), 'test-work')
        ending = asyncio.create_task(lifecycle.shutdown([lambda: close()]))
        async def close():
            events.append('resources-closed')
        await asyncio.sleep(0)

        self.assertFalse(lifecycle.is_ready())
        self.assertTrue(lifecycle.stop_event.is_set())
        self.assertEqual(events, [])
        with self.assertRaises(RuntimeError):
            lifecycle.track(work(), 'late-work')
        release.set()
        result = await ending
        self.assertFalse(result['timed_out'])
        self.assertEqual(events, ['work-drained', 'resources-closed'])

    async def test_cleanup_failure_does_not_skip_remaining_resources_or_run_twice(self):
        lifecycle = AiServiceLifecycle(timeout_seconds=1)
        events = []
        async def fail():
            events.append('first')
            raise RuntimeError('mock cleanup failure')
        async def second():
            events.append('second')
        first, replay = await asyncio.gather(lifecycle.shutdown([fail, second]), lifecycle.shutdown([fail, second]))
        self.assertEqual(first, replay)
        self.assertTrue(first['failed'])
        self.assertEqual(events, ['first', 'second'])

    async def test_timeout_cannot_close_database_under_unfinished_work(self):
        lifecycle = AiServiceLifecycle(timeout_seconds=0.02)
        events = []
        async def work():
            await asyncio.Event().wait()
        lifecycle.track(work(), 'stuck-work')
        async def close():
            events.append('database-closed')
        result = await lifecycle.shutdown([close])
        self.assertTrue(result['timed_out'])
        self.assertTrue(lifecycle.forced)
        self.assertEqual(events, [])
        await asyncio.sleep(0)


class MainLifespanTests(unittest.IsolatedAsyncioTestCase):
    async def test_main_lifespan_gates_requests_and_disposes_only_after_tracked_work(self):
        import main
        import db
        with ExitStack() as patches:
            patches.enter_context(patch.object(main.lifecycle_state, 'current', None))
            for name in ('_startup_init_db', '_startup_warmup_cover_model', '_startup_nightly_briefing',
                         '_startup_release_stale_actions', '_startup_bookstore_code_index', '_startup_ingest_corpus'):
                patches.enter_context(patch.object(main, name, AsyncMock()))
            disposed = AsyncMock()
            patches.enter_context(patch.object(db, 'engine', SimpleNamespace(dispose=disposed)))
            release = asyncio.Event()
            async with main.lifespan(main.app):
                state = main.lifecycle_state.current
                self.assertTrue(state.is_ready())
                state.track(release.wait(), 'main-lifespan-test-work')
                state.begin_draining()
                async with httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app), base_url='http://test') as client:
                    response = await client.get('/health')
                self.assertEqual(response.status_code, 503)
                self.assertEqual(response.headers['connection'], 'close')
                disposed.assert_not_awaited()
                release.set()
            disposed.assert_awaited_once()

if __name__ == '__main__':
    unittest.main()
