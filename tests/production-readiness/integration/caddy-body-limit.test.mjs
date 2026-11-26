import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { caddyImage, borrowTestImage } from '../helpers/runtime-images.mjs';
const root = resolve(import.meta.dirname, '../../..');
const run = args => spawnSync('docker', args, { encoding: 'utf8', timeout: 30000 });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
test('PRA16: production Caddy caps declared and chunked AI bodies while forwarding valid bytes', async () => {
  const source = readFileSync(resolve(root, 'deploy/Caddyfile'), 'utf8');
  const global = source.match(/^\{\s*$[\s\S]*?^\}/m)?.[0] || '';
  const common = source.match(/^\(common\)\s*\{[\s\S]*?^\}/m)?.[0];
  assert.ok(common);
  const id = randomBytes(5).toString('hex'), edge = `smartbook-caddy-body-${id}`, upstream = `smartbook-caddy-body-node-${id}`;
  const dir = resolve(root, '.git', `caddy-body-${id}`); mkdirSync(dir, { recursive: true });
  const config = resolve(dir, 'Caddyfile');
  writeFileSync(config, `${global}\n${common}\nhttp://127.0.0.1:8080 {\n import common\n reverse_proxy 127.0.0.1:8081\n}\n`);
  const server = `const http=require('http');http.createServer((req,res)=>{let n=0;req.on('data',b=>n+=b.length);req.on('end',()=>res.end(JSON.stringify({bytes:n})));req.on('error',()=>{});}).listen(8081,'127.0.0.1');`;
  const client = `const http=require('http');
async function send(size,declared){return new Promise((resolve,reject)=>{let settled=false;const req=http.request({host:'127.0.0.1',port:8080,path:'/ai/verify-packing-photo',method:'POST',headers:declared?{'Content-Length':size}:{'Transfer-Encoding':'chunked'}},res=>{let body='';res.on('data',b=>body+=b);res.on('end',()=>{settled=true;resolve({status:res.statusCode,body});});});req.on('error',e=>{if(!settled)reject(e);});req.end(Buffer.alloc(size,65));});}
(async()=>{const small=await send(2048,true);const declared=await send(16777217,true);const chunked=await send(16777217,false);console.log(JSON.stringify({small,declared:{status:declared.status},chunked:{status:chunked.status}}));})().catch(e=>{console.error(e.code||e.message);process.exitCode=1;});`;
  const clientPath = resolve(dir, 'client.cjs'); writeFileSync(clientPath, client);
  let edgeCreated = false, nodeCreated = false;
  try {
    const c = run(['create', '--name', edge, '--network', 'none', '--mount', `type=bind,source=${config},target=/etc/caddy/Caddyfile,readonly`, caddyImage(root), 'caddy', 'run', '--config', '/etc/caddy/Caddyfile', '--adapter', 'caddyfile']);
    assert.equal(c.status, 0, c.stderr); edgeCreated = true; assert.equal(run(['start', edge]).status, 0);
    const n = run(['create', '--name', upstream, '--network', `container:${edge}`, '--entrypoint', 'node', borrowTestImage(root), '-e', server]);
    assert.equal(n.status, 0, n.stderr); nodeCreated = true; assert.equal(run(['start', upstream]).status, 0);
    assert.equal(run(['cp', clientPath, `${upstream}:/app/caddy-body-client.cjs`]).status, 0);
    let ready = false;
    for (let i=0;i<30;i++) {
      const r = run(['exec', upstream, 'node', '-e', `fetch('http://127.0.0.1:8080/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))`]);
      if (r.status === 0) { ready=true; break; } await pause(100);
    }
    assert.ok(ready, 'Caddy and actual upstream must be ready');
    const result = run(['exec', upstream, 'node', '/app/caddy-body-client.cjs']);
    assert.equal(result.status, 0, result.stderr);
    const observed = JSON.parse(result.stdout.trim());
    assert.equal(observed.small.status, 200);
    assert.equal(JSON.parse(observed.small.body).bytes, 2048);
    assert.equal(observed.declared.status, 413);
    assert.equal(observed.chunked.status, 413);
  } finally {
    if(nodeCreated) run(['stop','--time','2',upstream]);
    if(edgeCreated) run(['stop','--time','2',edge]);
  }
});
