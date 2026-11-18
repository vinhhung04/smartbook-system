import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import http from 'node:http';

const gateway = createRequire(resolve(import.meta.dirname, '../../../apps/api-gateway/package.json'));

async function withServer(run) {
  const socketIo = gateway.resolve('socket.io');
  const child = spawn(process.execPath, ['-e', `
    const http=require('http'),{Server}=require(${JSON.stringify(socketIo)});
    const server=http.createServer((_q,r)=>r.end('alive'));
    const io=new Server(server,{path:'/socket.io'});
    io.use((_socket,next)=>next(new Error('Authentication required')));
    server.listen(0,'127.0.0.1',()=>process.send({port:server.address().port}));
  `], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk; });
  try {
    const port = await new Promise((yes, no) => {
      const timer = setTimeout(() => no(new Error('Socket.IO child startup timed out')), 5000);
      child.once('message', message => { clearTimeout(timer); yes(message.port); });
      child.once('error', error => { clearTimeout(timer); no(error); });
      child.once('exit', code => { clearTimeout(timer); no(new Error(`Socket.IO child exited ${code}: ${stderr}`)); });
    });
    await run(port, child);
  } finally {
    if (child.exitCode === null) await new Promise(done => { child.once('exit', done); child.kill(); });
  }
}

async function handshake(port) {
  const response = await fetch(`http://127.0.0.1:${port}/socket.io/?EIO=4&transport=polling`, { signal: AbortSignal.timeout(3000) });
  assert.equal(response.status, 200);
  const open = await response.text();
  assert.equal(open[0], '0');
  return JSON.parse(open.slice(1)).sid;
}

function upgradeStatus(port, query) {
  return new Promise((yes, no) => {
    const request = http.request({ host: '127.0.0.1', port,
      path: `/socket.io/?transport=websocket&${query}`, headers: {
        Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Version': '13',
        'Sec-WebSocket-Key': 'c21hcnRib29rLXN5bnRoZQ==',
      } });
    request.setTimeout(3000, () => request.destroy(new Error('Upgrade response timed out')));
    request.once('response', response => { response.resume(); yes(response.statusCode); });
    request.once('upgrade', (response, socket) => { socket.destroy(); yes(response.statusCode); });
    request.once('error', no);
    request.end();
  });
}

test('PRA21: installed Socket.IO retains valid polling to WebSocket transport upgrades', async () => {
  await withServer(async port => {
    const sid = await handshake(port);
    assert.equal(await upgradeStatus(port, `EIO=4&sid=${sid}`), 101);
    assert.equal((await fetch(`http://127.0.0.1:${port}/`)).status, 200);
  });
});

for (const revision of ['EIO=3&', '']) {
  test(`PRA21: transport upgrade rejects ${revision ? 'mismatched' : 'missing'} EIO before Socket.IO authentication`, async () => {
    await withServer(async (port, child) => {
      const sid = await handshake(port);
      assert.equal(await upgradeStatus(port, `${revision}sid=${sid}`), 400,
        'an unauthenticated Engine.IO session must retain its negotiated parser revision');
      assert.equal(child.exitCode, null);
      assert.equal((await fetch(`http://127.0.0.1:${port}/`)).status, 200);
    });
  });
}
