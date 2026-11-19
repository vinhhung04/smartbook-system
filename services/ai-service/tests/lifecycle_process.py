"""Real Uvicorn process probe, offline provider stub supplied by its parent."""
import asyncio
import json
import os
import sys
from contextlib import asynccontextmanager
from types import SimpleNamespace

import httpx
import uvicorn
from fastapi import FastAPI

from ai_core.lifecycle import AiServiceLifecycle, AiLifecycleMiddleware
from run import GracefulServer

registry = SimpleNamespace(current=None)
http_gate = asyncio.Event()
job_gate = asyncio.Event()
events = []


def emit(event, **data):
    print(json.dumps({'event': event, 'events': list(events), **data}), flush=True)


@asynccontextmanager
async def lifespan(app):
    state = AiServiceLifecycle(float(os.environ['PROBE_SHUTDOWN_SECONDS']))
    registry.current = state
    state.mark_ready()
    def control():
        line = sys.stdin.readline().strip()
        if line == 'release-http':
            http_gate.set()
        elif line == 'release-job':
            job_gate.set()
        elif line == 'state':
            emit('state', ready=state.is_ready())
    asyncio.get_running_loop().add_reader(sys.stdin.fileno(), control)
    try:
        yield
    finally:
        async def close_database():
            events.append('database-closed')
        result = await state.shutdown([close_database])
        emit('shutdown', **result)


app = FastAPI(lifespan=lifespan)
app.add_middleware(AiLifecycleMiddleware, registry=registry)


@app.get('/work')
async def work():
    async with httpx.AsyncClient() as client:
        response = await client.post(os.environ['PROBE_PROVIDER_URL'], headers={'idempotency-key': os.environ['PROBE_OPERATION_ID']})
        response.raise_for_status()
    events.append('provider-completed')
    async def job():
        await job_gate.wait()
        events.append('job-drained')
    registry.current.track(job(), 'active-background-probe')
    emit('active')
    await http_gate.wait()
    events.append('http-drained')
    return {'status': 'complete'}


class ProbeServer(GracefulServer):
    async def startup(self, sockets=None):
        await super().startup(sockets=sockets)
        emit('listening', port=self.servers[0].sockets[0].getsockname()[1])


seconds = float(os.environ['PROBE_SHUTDOWN_SECONDS'])
server = ProbeServer(uvicorn.Config(app, host='127.0.0.1', port=0, log_level='warning', access_log=False,
    timeout_graceful_shutdown=seconds * 0.8), lambda: registry.current, seconds)
server.run()
raise SystemExit(1 if registry.current.forced or registry.current.failed else 0)
