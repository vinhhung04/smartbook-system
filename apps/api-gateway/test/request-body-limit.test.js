const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const { actualBodyLimit } = require('../src/request-body-limit');

test('gateway counts actual streamed bytes before any proxy forwards the request', async t => {
  let upstreamCalls = 0, upstreamBody;
  const upstream = http.createServer((req, res) => {
    upstreamCalls++;
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => { upstreamBody = Buffer.concat(chunks).toString(); res.end('ok'); });
  });
  await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
  const app = express();
  app.use(actualBodyLimit({ maxBytes: () => 32, maxConcurrent: () => 1, readTimeoutMs: () => 100 }));
  app.use(createProxyMiddleware({ target: `http://127.0.0.1:${upstream.address().port}` }));
  const gateway = await new Promise(resolve => { const server = app.listen(0, '127.0.0.1', () => resolve(server)); });
  function request(chunks, headers = {}) {
    return new Promise((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port: gateway.address().port, method: 'POST', path: '/ai/verify-packing-photo', headers }, res => {
        const data = [];
        res.on('data', chunk => data.push(chunk));
        res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(data).toString() }));
      });
      req.on('error', reject);
      for (const chunk of chunks) req.write(chunk);
      req.end();
    });
  }
  try {
    await t.test('bounded chunked payload reaches proxy with identical bytes', async () => {
      const response = await request(['first', '-second'], { 'content-type': 'application/octet-stream' });
      assert.equal(response.status, 200);
      assert.equal(upstreamBody, 'first-second');
      assert.equal(upstreamCalls, 1);
    });
    await t.test('chunked oversize receives 413 and never reaches upstream', async () => {
      const before = upstreamCalls;
      const response = await request(['x'.repeat(20), 'y'.repeat(20)]);
      assert.equal(response.status, 413);
      assert.equal(upstreamCalls, before);
    });
    await t.test('oversized declared length is refused without forwarding', async () => {
      const before = upstreamCalls;
      const response = await request(['x'.repeat(40)], { 'content-length': 40 });
      assert.equal(response.status, 413);
      assert.equal(upstreamCalls, before);
    });
    await t.test('slow ingress occupies one bounded slot, times out, then releases it', async () => {
      const before = upstreamCalls;
      let started;
      const waiting = new Promise(resolve => {
        started = http.request({ host: '127.0.0.1', port: gateway.address().port, path: '/ai/verify-packing-photo', method: 'POST' }, res => {
          res.resume();
          res.on('end', () => resolve(res.statusCode));
        });
        started.on('error', () => {});
        started.write('incomplete');
      });
      await new Promise(resolve => setTimeout(resolve, 20));
      assert.equal((await request(['bounded'])).status, 429);
      assert.equal(await waiting, 408);
      assert.equal(upstreamCalls, before);
      assert.equal((await request(['after-timeout'])).status, 200);
    });
    await t.test('small declared JSON bodies are not starved by a busy upload slot', async () => {
      let slow;
      const waiting = new Promise(resolve => {
        slow = http.request({ host: '127.0.0.1', port: gateway.address().port, path: '/ai/verify-packing-photo', method: 'POST' }, res => {
          res.resume();
          res.on('end', () => resolve(res.statusCode));
        });
        slow.on('error', () => {});
        slow.write('incomplete');
      });
      await new Promise(resolve => setTimeout(resolve, 20));
      const burst = await Promise.all(Array.from({ length: 6 }, (_, i) => request([`{"n":${i}}`], { 'content-type': 'application/json', 'content-length': String(`{"n":${i}}`.length) })));
      assert.deepEqual(burst.map(r => r.status), [200, 200, 200, 200, 200, 200]);
      assert.equal(await waiting, 408);
    });
    await t.test('small declared body that stalls still times out and is not forwarded', async () => {
      const before = upstreamCalls;
      const status = await new Promise(resolve => {
        const stalled = http.request({ host: '127.0.0.1', port: gateway.address().port, path: '/ai/verify-packing-photo', method: 'POST', headers: { 'content-length': 20 } }, res => {
          res.resume();
          res.on('end', () => resolve(res.statusCode));
        });
        stalled.on('error', () => {});
        stalled.write('partial');
      });
      assert.equal(status, 408);
      assert.equal(upstreamCalls, before);
    });
    await t.test('client abort releases a partially received body without forwarding', async () => {
      const before = upstreamCalls;
      const aborted = http.request({ host: '127.0.0.1', port: gateway.address().port, path: '/ai/verify-packing-photo', method: 'POST' });
      aborted.on('error', () => {});
      aborted.write('partial');
      await new Promise(resolve => setTimeout(resolve, 15));
      aborted.destroy();
      await new Promise(resolve => setTimeout(resolve, 15));
      assert.equal(upstreamCalls, before);
      assert.equal((await request(['after-abort'])).status, 200);
    });
    await t.test('overflow releases its permit for a subsequent valid request', async () => {
      assert.equal((await request(['x'.repeat(40)])).status, 413);
      assert.equal((await request(['after-overflow'])).status, 200);
    });
  } finally {
    await Promise.all([new Promise(resolve => gateway.close(resolve)), new Promise(resolve => upstream.close(resolve))]);
  }
});
