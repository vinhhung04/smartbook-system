"""Track admitted HTTP/background work and drain it before resource teardown."""
from __future__ import annotations

import asyncio
import time

from starlette.responses import JSONResponse


class AiServiceLifecycle:
    def __init__(self, timeout_seconds=35):
        self.timeout_seconds = max(0.01, float(timeout_seconds))
        self.stop_event = asyncio.Event()
        self.tasks = set()
        self.requests = set()
        self.ready = False
        self.forced = False
        self.failed = False
        self.deadline = None
        self._shutdown_task = None

    def mark_ready(self):
        if not self.stop_event.is_set():
            self.ready = True

    def is_ready(self):
        return self.ready and not self.stop_event.is_set()

    def begin_draining(self):
        self.ready = False
        self.stop_event.set()
        if self.deadline is None:
            self.deadline = time.monotonic() + self.timeout_seconds

    def track(self, coroutine, name):
        if self.stop_event.is_set():
            coroutine.close()
            raise RuntimeError('service is draining')
        task = asyncio.create_task(coroutine, name=name)
        self.tasks.add(task)
        def finished(done):
            self.tasks.discard(done)
            if not done.cancelled() and done.exception() is not None:
                self.failed = True
        task.add_done_callback(finished)
        return task

    async def shutdown(self, close_resources=()):
        self.begin_draining()
        if self._shutdown_task is None:
            self._shutdown_task = asyncio.create_task(self._finish(close_resources))
        return await asyncio.shield(self._shutdown_task)

    async def _finish(self, close_resources):
        pending = set(self.tasks) | set(self.requests)
        if pending:
            _, pending = await asyncio.wait(pending, timeout=max(0, self.deadline - time.monotonic()))
        if pending:
            self.forced = True
            for task in pending:
                task.cancel()
            # Never dispose a pool underneath unfinished work. The executable's
            # total-deadline watchdog terminates an uncooperative process.
            return {'timed_out': True, 'failed': True}
        for close in close_resources:
            remaining = max(0, self.deadline - time.monotonic())
            task = asyncio.create_task(close())
            done, _ = await asyncio.wait({task}, timeout=remaining)
            if not done:
                task.cancel()
                self.forced = True
                return {'timed_out': True, 'failed': True}
            try:
                task.result()
            except Exception:
                self.failed = True
        return {'timed_out': False, 'failed': self.failed}


class AiLifecycleMiddleware:
    def __init__(self, app, registry):
        self.app, self.registry = app, registry

    async def __call__(self, scope, receive, send):
        state = self.registry.current
        if scope['type'] != 'http' or state is None:
            return await self.app(scope, receive, send)
        if not state.is_ready():
            return await JSONResponse({'status': 'draining'}, status_code=503,
                headers={'Connection': 'close'})(scope, receive, send)
        task = asyncio.current_task()
        state.requests.add(task)
        try:
            await self.app(scope, receive, send)
        except asyncio.CancelledError:
            if state.stop_event.is_set():
                state.forced = True
            raise
        finally:
            state.requests.discard(task)


async def wait_for_next(stop_event, seconds):
    if stop_event is None:
        await asyncio.sleep(seconds)
        return
    try:
        await asyncio.wait_for(stop_event.wait(), timeout=max(0, seconds))
    except asyncio.TimeoutError:
        pass
