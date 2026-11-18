// Alert ingestion. Not proxied by the gateway: only reachable on the internal
// Docker network, and every request must carry MONITORING_INGEST_TOKEN.
// While monitoring_db is unreachable, valid payloads are spooled to disk and
// acknowledged (202), then replayed in order when the database is back.
const express = require('express');
const prisma = require('../lib/prisma');
const spool = require('../lib/spool');
const { isDbUnavailable } = require('../lib/db-errors');
const { requireIngestToken } = require('../middlewares/auth.middleware');
const { parseGrafanaPayload, parseHealthcheckPayload } = require('../domain/alerts');
const { ingestSignal, ingestHealthcheck } = require('../services/incident.service');
const metrics = require('../lib/metrics');

const router = express.Router();
const json = express.json({ limit: '256kb' });

function log(level, fields) {
  console.log(JSON.stringify({ level, service: 'monitoring-service', ...fields }));
}

async function processGrafana(body, now) {
  const results = [];
  for (const signal of parseGrafanaPayload(body)) {
    const result = await ingestSignal(prisma, signal, { now });
    metrics.recordIngest('grafana', result.action);
    results.push({ fingerprint: signal.fingerprint, action: result.action, incident_id: result.incident?.id || null });
  }
  return results;
}

async function processHealthcheck(body, now) {
  const results = await ingestHealthcheck(prisma, parseHealthcheckPayload(body), { now });
  for (const result of results) metrics.recordIngest('healthcheck', result.action);
  return results.map((r) => ({ action: r.action, incident_id: r.incident?.id || null }));
}

const PROCESSORS = { grafana: processGrafana, healthcheck: processHealthcheck };

function ingestRoute(source, validate) {
  return async (req, res, next) => {
    const receivedAt = new Date();
    try {
      validate(req.body); // a malformed payload is refused, never spooled
      const results = await PROCESSORS[source](req.body, receivedAt);
      log('info', { request_id: req.requestId || null, msg: `${source} alerts ingested`, results: results.map((r) => r.action) });
      return res.status(202).json({ accepted: results.length, results });
    } catch (error) {
      if (!isDbUnavailable(error)) return next(error);
      if (!spool.append({ source, body: req.body, received_at: receivedAt.toISOString() })) {
        log('error', { request_id: req.requestId || null, msg: 'alert spool full; payload not stored' });
        return res.status(503).json({ message: 'monitoring database unavailable and spool full', code: 'SPOOL_FULL' });
      }
      metrics.recordIngest(source, 'spooled');
      log('warn', { request_id: req.requestId || null, msg: `${source} alerts spooled: monitoring_db unavailable` });
      return res.status(202).json({ accepted: 0, spooled: true });
    }
  };
}

router.post('/alerts/grafana', requireIngestToken, json, ingestRoute('grafana', parseGrafanaPayload));
router.post('/alerts/healthcheck', requireIngestToken, json, ingestRoute('healthcheck', parseHealthcheckPayload));

/** Replays spooled payloads with their original receive time (see lib/spool.js). */
function startSpoolReplay({ intervalMs = 15_000 } = {}) {
  let stopped = false;
  let running = null;
  const tick = async () => {
    if (stopped) return;
    running = spool.replay(async (entry) => {
      const processor = PROCESSORS[entry.source];
      if (!processor) return;
      try {
        await processor(entry.body, new Date(entry.received_at));
      } catch (error) {
        if (isDbUnavailable(error)) throw error; // keep it for the next run
        log('error', { msg: 'spooled payload dropped (invalid)', error: String(error.message).slice(0, 200) });
      }
    }).then((count) => { if (count) log('info', { msg: 'spooled alerts replayed', count }); })
      .catch((error) => { if (!isDbUnavailable(error)) log('error', { msg: 'spool replay failed', error: String(error.message).slice(0, 200) }); });
    await running;
    running = null;
    if (!stopped) timer = setTimeout(tick, intervalMs);
  };
  let timer = setTimeout(tick, 2000);
  return async () => { stopped = true; clearTimeout(timer); if (running) await running; };
}

module.exports = router;
module.exports.startSpoolReplay = startSpoolReplay;
