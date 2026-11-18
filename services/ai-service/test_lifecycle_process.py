import asyncio
import json
import os
import pathlib
import queue
import signal
import subprocess
import sys
import threading
import time
import unittest
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import httpx


@unittest.skipUnless(os.name == 'posix', 'real Uvicorn signals require the Linux QA runtime')
class AiLifecycleProcessTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.provider_keys = set()
        owner = self
        class Provider(BaseHTTPRequestHandler):
            def do_POST(self):
                owner.provider_keys.add(self.headers.get('idempotency-key'))
                self.send_response(200)
                self.end_headers()
            def log_message(self, *args):
                pass
        self.provider = ThreadingHTTPServer(('127.0.0.1', 0), Provider)
        threading.Thread(target=self.provider.serve_forever, daemon=True).start()
        self.children = []

    async def asyncTearDown(self):
        for child in self.children:
            if child.poll() is None:
                child.kill()
            await asyncio.to_thread(child.wait, 5)
            for stream in (child.stdin, child.stdout):
                stream.close()
        await asyncio.to_thread(self.provider.shutdown)
        self.provider.server_close()

    def launch(self, seconds=3):
        root = pathlib.Path(__file__).parent
        operation = str(uuid.uuid4())
        child = subprocess.Popen([sys.executable, str(root / 'tests/lifecycle_process.py')],
            env={**os.environ, 'PYTHONPATH': str(root), 'PROBE_SHUTDOWN_SECONDS': str(seconds), 'PROBE_OPERATION_ID': operation,
                'PROBE_PROVIDER_URL': f'http://127.0.0.1:{self.provider.server_port}'},
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1)
        self.children.append(child)
        messages = queue.Queue()
        def read():
            for line in child.stdout:
                try:
                    message = json.loads(line)
                    if 'event' in message:
                        messages.put(message)
                except ValueError:
                    pass
        threading.Thread(target=read, daemon=True).start()
        async def event(name):
            while True:
                message = await asyncio.to_thread(messages.get, True, 6)
                if message['event'] == name:
                    return message
        def send(value):
            child.stdin.write(value + '\n')
            child.stdin.flush()
        return child, operation, event, send

    async def test_sigterm_and_repeated_sigint_drain_http_and_background_work_before_cleanup(self):
        child, operation, event, send = self.launch()
        port = (await event('listening'))['port']
        async with httpx.AsyncClient() as client:
            request = asyncio.create_task(client.get(f'http://127.0.0.1:{port}/work'))
            await event('active')
            child.send_signal(signal.SIGTERM)
            await asyncio.sleep(0.03)
            send('state')
            self.assertFalse((await event('state'))['ready'])
            child.send_signal(signal.SIGINT)
            await asyncio.sleep(0.03)
            self.assertIsNone(child.poll())
            send('release-http')
            self.assertEqual((await request).status_code, 200)
            self.assertIsNone(child.poll(), 'background work must drain after the HTTP response')
            send('release-job')
            result = await event('shutdown')
        self.assertFalse(result['timed_out'])
        self.assertEqual(result['events'], ['provider-completed', 'http-drained', 'job-drained', 'database-closed'])
        self.assertEqual(await asyncio.to_thread(child.wait, 5), 0)
        self.assertIn(operation, self.provider_keys)

    async def test_total_deadline_forces_nonzero_exit_without_disposing_under_stuck_work(self):
        child, operation, event, _send = self.launch(seconds=1)
        port = (await event('listening'))['port']
        async with httpx.AsyncClient() as client:
            request = asyncio.create_task(client.get(f'http://127.0.0.1:{port}/work'))
            await event('active')
            started = time.monotonic()
            child.send_signal(signal.SIGTERM)
            self.assertEqual(await asyncio.to_thread(child.wait, 4), 1)
            self.assertLess(time.monotonic() - started, 3)
            await asyncio.gather(request, return_exceptions=True)
        self.assertIn(operation, self.provider_keys)


if __name__ == '__main__':
    unittest.main()
