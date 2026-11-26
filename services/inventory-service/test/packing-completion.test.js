const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');

test('markPackingTaskCompleted completes and audits once, returns null when already completed', async () => {
  const { markPackingTaskCompleted } = require('../src/services/packing.service');
  let completed = false;
  const audits = [];
  const tx = {
    packing_tasks: {
      updateMany: async ({ where }) => {
        assert.deepEqual(where.status, { not: 'COMPLETED' });
        if (completed) return { count: 0 };
        completed = true;
        return { count: 1 };
      },
      findUnique: async () => ({ id: 't1', status: 'COMPLETED' }),
    },
    inventory_audit_logs: { create: async ({ data }) => audits.push(data.action_name) },
  };
  const first = await markPackingTaskCompleted(tx, { taskId: 't1', actorUserId: 'u1', rootOrderId: 'o1' });
  const second = await markPackingTaskCompleted(tx, { taskId: 't1', actorUserId: 'u1', rootOrderId: 'o1' });
  assert.equal(first.status, 'COMPLETED');
  assert.equal(second, null);
  assert.deepEqual(audits, ['PACKING_TASK_COMPLETED']);
});

test('video upload to an unwritable evidence store answers 503 JSON, not an HTML 500', async () => {
  // a FILE where the evidence directory should be makes mkdir/open fail like EACCES does
  const blocker = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sb-pack-')), 'not-a-dir');
  fs.writeFileSync(blocker, 'x');
  process.env.PACKING_EVIDENCE_DIR = path.join(blocker, 'packing');
  delete require.cache[require.resolve('../src/services/packing-video-storage.service')];
  const { handleVideoUpload } = require('../src/services/packing-video-storage.service');

  const app = express();
  app.post('/upload', (req, _res, next) => { req.packingTaskNumber = 'PACK-T'; next(); }, handleVideoUpload, (_req, res) => res.json({ ok: true }));
  const server = app.listen(0);
  const errorLog = console.error;
  console.error = () => {};
  try {
    const fd = new FormData();
    fd.append('video', new Blob([Buffer.alloc(16)], { type: 'video/webm' }), 'v.webm');
    const res = await fetch(`http://127.0.0.1:${server.address().port}/upload`, { method: 'POST', body: fd });
    assert.equal(res.status, 503);
    const body = await res.json();
    assert.equal(body.code, 'PACKING_VIDEO_STORAGE_UNAVAILABLE');
  } finally {
    console.error = errorLog;
    server.close();
    delete process.env.PACKING_EVIDENCE_DIR;
  }
});

test('evidence storage_ref only resolves inside the packing evidence folder', () => {
  const { resolveVideoPath } = require('../src/services/packing-video-storage.service');
  const ok = resolveVideoPath('packing/PACK-1.webm');
  assert.ok(ok && ok.endsWith('PACK-1.webm'));
  assert.equal(resolveVideoPath('packing/../../etc/passwd'), null);
  assert.equal(resolveVideoPath('procurement/x.pdf'), null);
  assert.equal(resolveVideoPath(''), null);
});
