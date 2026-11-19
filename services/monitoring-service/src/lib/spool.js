// Durable hand-off for alert payloads that arrive while monitoring_db is
// unreachable (PostgreSQL itself is often the incident). The payload is appended
// to a local file and acknowledged, so Grafana records the notification as sent
// and later sends its "resolved" too (Alertmanager only resolves what it has
// successfully notified). Replay runs in arrival order, with each entry's
// original receive time, once the database answers again.
//
// shortcut: one spool file per replica on a local volume; a multi-replica
// deployment would need a shared queue instead.
const fs = require('node:fs');
const path = require('node:path');

const MAX_BYTES = 10 * 1024 * 1024;

function files(dir) {
  return { spool: path.join(dir, 'alerts.ndjson'), processing: path.join(dir, 'alerts.processing.ndjson') };
}

function defaultDir() {
  return process.env.MONITORING_SPOOL_DIR || path.join(__dirname, '../../spool');
}

/** Returns true when stored; false when the spool is full (the caller then fails the request). */
function append(entry, dir = defaultDir()) {
  fs.mkdirSync(dir, { recursive: true });
  const { spool } = files(dir);
  const line = `${JSON.stringify(entry)}\n`;
  const size = fs.existsSync(spool) ? fs.statSync(spool).size : 0;
  if (size + Buffer.byteLength(line) > MAX_BYTES) return false;
  fs.appendFileSync(spool, line);
  return true;
}

function pending(dir = defaultDir()) {
  const { spool, processing } = files(dir);
  return [processing, spool].reduce((n, file) => n + (fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).length : 0), 0);
}

/**
 * Replays the spool through `handle(entry)`. A leftover processing file (from a
 * failed run) goes first, so order is kept. Stops at the first failure and
 * keeps the remaining entries for the next run. Returns the number replayed.
 */
async function replay(handle, dir = defaultDir()) {
  const { spool, processing } = files(dir);
  if (!fs.existsSync(processing)) {
    if (!fs.existsSync(spool)) return 0;
    fs.renameSync(spool, processing);
  }
  const lines = fs.readFileSync(processing, 'utf8').split('\n').filter(Boolean);
  let done = 0;
  for (; done < lines.length; done += 1) {
    let entry;
    try { entry = JSON.parse(lines[done]); } catch { continue; } // a torn line cannot be replayed
    try {
      await handle(entry);
    } catch (error) {
      fs.writeFileSync(processing, lines.slice(done).map((line) => `${line}\n`).join(''));
      throw error;
    }
  }
  fs.rmSync(processing, { force: true });
  return done;
}

module.exports = { append, replay, pending, MAX_BYTES };
