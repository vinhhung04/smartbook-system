const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const http = require('node:http');
const path = require('node:path');

const boundary = 'smartbook-synthetic-multipart';
const header = (field, name, type) => Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${field}"; filename="${name}"\r\nContent-Type: ${type}\r\n\r\n`);
const ending = Buffer.from(`\r\n--${boundary}--\r\n`);
const childSource = String.raw`
  const express=require('express'),fs=require('fs'),os=require('os'),path=require('path');
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'smartbook-multipart-'));
  process.env.PACKING_EVIDENCE_DIR=root;
  process.env.PROCUREMENT_DOCUMENT_DIR=root;
  process.env.PROCUREMENT_DOCUMENT_MAX_BYTES='1024';
  const kind=process.env.UPLOAD_TEST_KIND;
  const documents=require('./src/services/procurement-document-storage.service');
  const packing=require('./src/services/packing-video-storage.service');
  const middleware=kind==='document'?documents.handleDocumentUpload:packing.videoUploadMiddleware.single('video');
  const app=express();
  app.get('/ready',(_q,r)=>r.json({ready:true}));
  app.post('/upload',(q,r,n)=>{q.packingTaskNumber='SYNTHETIC';middleware(q,r,n);},(q,r)=>{
    const file=q.file;
    if(!file)return r.status(400).json({missing:true});
    const bytes=kind==='document'?file.buffer:fs.readFileSync(file.path);
    if(kind==='document')documents.inspectUpload(file);
    r.json({size:file.size,bytes:bytes.toString('hex'),fields:q.body});
  });
  app.use((error,_q,r,_n)=>r.status(error.code==='LIMIT_FILE_SIZE'?413:400).json({code:error.code||'INVALID_MULTIPART'}));
  const server=app.listen(0,'127.0.0.1',()=>process.send({port:server.address().port,version:require('multer/package.json').version}));
`;

async function withUpload(kind, run) {
  const child = spawn(process.execPath, ['-e', childSource], {
    cwd: path.resolve(__dirname, '..'), env: { ...process.env, UPLOAD_TEST_KIND: kind },
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
  });
  let stderr = '';
  child.stderr.on('data', data => { stderr += data; });
  try {
    const state = await new Promise((yes, no) => {
      const timer = setTimeout(() => no(new Error('Upload child startup timed out')), 15000);
      child.once('message', state => { clearTimeout(timer); yes(state); });
      child.once('error', error => { clearTimeout(timer); no(error); });
      child.once('exit', code => { clearTimeout(timer); no(new Error(`Upload child exited ${code}: ${stderr}`)); });
    });
    await run(state, child);
    assert.equal(child.exitCode, null, stderr);
    const ready = await fetch(`http://127.0.0.1:${state.port}/ready`, { signal: AbortSignal.timeout(5000) });
    assert.equal(ready.status, 200, 'rejected upload must leave the child responsive');
  } finally {
    if (child.exitCode === null) await new Promise(done => { child.once('exit', done); child.kill(); });
  }
}

function send(port, chunks, contentType = `multipart/form-data; boundary=${boundary}`) {
  return new Promise((yes, no) => {
    const req = http.request({ host: '127.0.0.1', port, path: '/upload', method: 'POST', headers: { 'Content-Type': contentType } }, res => {
      let body = ''; res.setEncoding('utf8'); res.on('data', value => { body += value; });
      res.on('end', () => yes({ status: res.statusCode, body: JSON.parse(body) }));
    });
    req.setTimeout(20000, () => req.destroy(new Error('Upload response timed out')));
    req.on('error', no);
    (async () => {
      for await (const chunk of chunks) if (!req.write(chunk)) await new Promise((done, fail) => {
        const cleanup = () => { req.off('drain', drain); req.off('error', error); req.off('close', closed); };
        const drain = () => { cleanup(); done(); }, error = err => { cleanup(); fail(err); };
        const closed = () => { cleanup(); fail(new Error('Upload closed before all bytes were written')); };
        req.once('drain', drain); req.once('error', error); req.once('close', closed);
      });
      req.end();
    })().catch(error => { req.destroy(); no(error); });
  });
}

test('PRA21: actual Inventory Multer graph includes the maintainer multipart fixes', () => {
  const [major, minor] = require('multer/package.json').version.split('.').map(Number);
  assert.ok(major > 2 || major === 2 && minor >= 5, 'installed Multer must be at least 2.5.0');
});

for (const kind of ['document', 'packing']) {
  const field = kind === 'document' ? 'file' : 'video';
  const mime = kind === 'document' ? 'application/pdf' : 'video/webm';
  const bytes = kind === 'document' ? Buffer.from('%PDF-synthetic') : Buffer.from([0x1a, 0x45, 0xdf, 0xa3]);

  test(`PRA21 ${kind}: actual storage accepts valid bytes and repeated text fields`, async () => {
    await withUpload(kind, async ({ port }) => {
      const metadata = JSON.stringify({ kind: 'synthetic', labels: ['a', 'b'] });
      const lines = JSON.stringify([{ variant_id: 'synthetic', quantity: 1 }]);
      const fields = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="note"\r\n\r\none\r\n--${boundary}\r\nContent-Disposition: form-data; name="note"\r\n\r\ntwo\r\n--${boundary}\r\nContent-Disposition: form-data; name="metadata"\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Disposition: form-data; name="lines"\r\n\r\n${lines}\r\n`);
      const result = await send(port, [fields, header(field, 'synthetic.bin', mime), bytes, ending]);
      assert.equal(result.status, 200);
      assert.equal(result.body.bytes, bytes.toString('hex'));
      assert.deepEqual(result.body.fields.note, ['one', 'two']);
      assert.equal(result.body.fields.metadata, metadata);
      assert.equal(result.body.fields.lines, lines);
    });
  });

  test(`PRA21 ${kind}: missing boundary and truncated body are refused without process failure`, async () => {
    await withUpload(kind, async ({ port }) => {
      assert.equal((await send(port, [Buffer.from('invalid')], 'multipart/form-data')).status, 400);
      const result = await send(port, [header(field, 'synthetic.bin', mime), bytes]);
      assert.equal(result.status, 400);
    });
  });

  test(`PRA21 ${kind}: a second file is refused by the real single-file middleware`, async () => {
    await withUpload(kind, async ({ port }) => {
      const result = await send(port, [header(field, 'one.bin', mime), bytes, Buffer.from('\r\n'), header(field, 'two.bin', mime), bytes, ending]);
      assert.equal(result.status, 400);
    });
  });

  for (const attack of ['nested field names', 'oversized array index']) {
    test(`PRA21 ${kind}: ${attack} are rejected within the isolated parser deadline`, async () => {
      await withUpload(kind, async ({ port }) => {
        // Maintainer GHSA-72gw-mp4g-v24j / GHSA-535w-7cp7-47q4.
        // The body stays tiny; a vulnerable parser alone expands/iterates it.
        const names = attack === 'nested field names' ? ['a' + '[b]'.repeat(1000)] : ['items[4294967294]', 'items[other]'];
        const fields = Buffer.from(names.map(name => `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\nsynthetic\r\n`).join(''));
        const body = Buffer.concat([fields, header(field, 'synthetic.bin', mime), bytes, ending]);
        assert.ok(body.length < 128 * 1024);
        let timer;
        try {
          const result = await Promise.race([send(port, [body]), new Promise((_yes, no) => {
            timer = setTimeout(() => no(new Error('multipart parser exceeded isolated 3s deadline')), 3000);
          })]);
          assert.equal(result.status, 400);
        } finally { clearTimeout(timer); }
      });
    });
  }

  test(`PRA21 ${kind}: client abort does not terminate the process or poison the next upload`, async () => {
    await withUpload(kind, async ({ port }) => {
      await new Promise((done, no) => {
        const req = http.request({ host: '127.0.0.1', port, path: '/upload', method: 'POST', headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` } });
        req.on('error', () => {}); req.once('close', done);
        req.once('socket', socket => socket.once('connect', () => {
          req.write(header(field, 'aborted.bin', mime)); req.write(bytes);
          setTimeout(() => req.destroy(), 75);
        }));
        req.setTimeout(5000, () => { req.destroy(); no(new Error('Abort probe timed out')); });
      });
      const result = await send(port, [header(field, 'next.bin', mime), bytes, ending]);
      assert.equal(result.status, 200);
    });
  });

  test(`PRA21 ${kind}: configured file size limit refuses an oversized streamed file`, { timeout: 90000 }, async () => {
    await withUpload(kind, async ({ port }) => {
      async function* oversized() {
        yield header(field, 'oversized.bin', mime);
        const limit = kind === 'document' ? 1024 : 300 * 1024 * 1024;
        const block = Buffer.alloc(64 * 1024);
        for (let remaining = limit + 1; remaining > 0; remaining -= Math.min(block.length, remaining)) yield block.subarray(0, Math.min(block.length, remaining));
        yield ending;
      }
      const result = await send(port, oversized());
      assert.equal(result.status, 413);
      if (kind === 'packing') assert.equal(result.body.code, 'LIMIT_FILE_SIZE');
    });
  });
}
