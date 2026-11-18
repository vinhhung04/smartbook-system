import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import net from 'node:net';
import { gzipSync } from 'node:zlib';
const root = resolve(import.meta.dirname, '../../..');
const shared = createRequire(resolve(root, 'packages/shared/package.json'));
const auth = createRequire(resolve(root, 'services/auth-service/package.json'));
async function launch(code) {
  const child = spawn(process.execPath, ['-e', code], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  let stderr = ''; child.stderr.on('data', data => stderr += data);
  try {
    const ready = await new Promise((yes, no) => {
      const timer = setTimeout(() => no(new Error('Isolated child startup timed out')), 5000);
      child.once('message', value => { clearTimeout(timer); yes(value); });
      child.once('exit', code => { clearTimeout(timer); no(new Error(`Isolated child exited ${code}: ${stderr}`)); });
      child.once('error', no);
    });
    return { child, ready, error: () => stderr };
  } catch(error) { child.kill(); throw error; }
}
async function stop(child) {
  if (child.exitCode !== null) return;
  await new Promise(resolve => { child.once('exit', resolve); child.kill(); });
}
test('PRA21: malformed metrics URL cannot terminate the actual installed Prometheus exporter', async () => {
  const exporter = shared.resolve('@opentelemetry/exporter-prometheus');
  const sdk = shared.resolve('@opentelemetry/sdk-metrics');
  const server = await launch(`const {PrometheusExporter}=require(${JSON.stringify(exporter)});const {MeterProvider}=require(${JSON.stringify(sdk)});setInterval(()=>{},1000);const exporter=new PrometheusExporter({host:'127.0.0.1',port:0},error=>{if(error)throw error;process.send({port:exporter._server.address().port});});new MeterProvider({readers:[exporter]});`);
  try {
    await new Promise(resolve => {
      const socket = net.connect(server.ready.port, '127.0.0.1');
      const timer = setTimeout(() => { socket.destroy(); resolve(); }, 300);
      socket.once('connect', () => socket.write('GET http://[::1 HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n'));
      socket.on('data', () => {});
      socket.once('error', () => {});
      socket.once('close', () => { clearTimeout(timer); resolve(); });
    });
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(server.child.exitCode, null, server.error());
    const health = await fetch(`http://127.0.0.1:${server.ready.port}/metrics`, { signal: AbortSignal.timeout(2000) });
    assert.equal(health.status, 200);
  } finally { await stop(server.child); }
});
test('PRA21: patched body-parser graph preserves gzip JSON and rejects malformed compressed input without a crash', async () => {
  const express = auth.resolve('express');
  const expressRequire = createRequire(express);
  const version = expressRequire('body-parser/package.json').version;
  const server = await launch(`const app=require(${JSON.stringify(express)})();app.use(require(${JSON.stringify(express)}).json());app.get('/ready',(_q,r)=>r.json({ok:true}));app.post('/',(q,r)=>r.json(q.body));app.use((e,_q,r,_n)=>r.status(e.status||400).end());const s=app.listen(0,'127.0.0.1',()=>process.send({port:s.address().port}));`);
  try {
    const base = `http://127.0.0.1:${server.ready.port}`;
    const valid = await fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Encoding': 'gzip' }, body: gzipSync(Buffer.from('{"synthetic":true}')) });
    assert.equal(valid.status, 200); assert.deepEqual(await valid.json(), { synthetic: true });
    const malformed = await fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Encoding': 'gzip' }, body: Buffer.concat([gzipSync(Buffer.from('{}')), Buffer.from('not-a-gzip-frame')]) });
    assert.equal(malformed.status, 400);
    assert.equal((await fetch(`${base}/ready`)).status, 200);
    const [major, minor, patch] = version.split('.').map(Number);
    assert.ok(major > 2 || major === 2 && minor >= 4 || major === 1 && (minor > 20 || minor === 20 && patch >= 9), `Reachable installed body-parser ${version} is below the maintainer's patched version`);
  } finally { await stop(server.child); }
});
