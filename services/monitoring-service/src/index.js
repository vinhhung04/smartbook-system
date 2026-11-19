require('dotenv').config();

const express = require('express');
const cors = require('cors');
const { createServiceLifecycle, createCorsOptions, createRateLimiter, createRequestContext, createRequestLogger, requireEnv, securityHeaders } = require('@smartbook/shared/runtime');
const prisma = require('./lib/prisma');
const metrics = require('./lib/metrics');
const { startWorker } = require('./services/delivery.service');
const { isDbUnavailable } = require('./lib/db-errors');

requireEnv(process.env, ['DATABASE_URL', 'JWT_SECRET', 'MONITORING_INGEST_TOKEN']);
if (String(process.env.MONITORING_INGEST_TOKEN).length < 24) {
  console.error('[monitoring-service] MONITORING_INGEST_TOKEN must be at least 24 characters');
  process.exit(1);
}

const app = express();
let lifecycle;
app.use((req, res, next) => (lifecycle ? lifecycle.middleware(req, res, next) : next()));
const port = Number(process.env.PORT || 3007);

app.use(createRequestContext('monitoring-service'));
app.use(createRequestLogger('monitoring-service'));
app.use(securityHeaders);

app.get('/health', (_req, res) => res.json({ service: 'monitoring-service', status: 'ok', version: '1.0.0' }));
app.get('/ready', async (_req, res) => {
  if (lifecycle && !lifecycle.isReady()) return res.status(503).json({ status: 'draining' });
  try {
    await prisma.$queryRaw`SELECT 1`;
    return res.json({ service: 'monitoring-service', status: 'ready' });
  } catch (_error) {
    return res.status(503).json({ service: 'monitoring-service', status: 'not_ready' });
  }
});

// Internal alert ingestion: never behind the gateway, token-authenticated.
const internalRoutes = require('./routes/internal.routes');
app.use('/internal', internalRoutes);

// Administrator API, reached through api-gateway (one proxy hop + Caddy).
app.use('/monitoring', cors(createCorsOptions(process.env.ALLOWED_ORIGINS)),
  createRateLimiter({ max: 600, windowMs: 15 * 60 * 1000, trustedProxyHops: 2 }),
  require('./routes/monitoring.routes'));

app.use((req, res) => res.status(404).json({ message: 'Không tìm thấy', path: req.originalUrl }));

app.use((error, req, res, _next) => {
  if (isDbUnavailable(error)) {
    return res.status(503).json({ message: 'Cơ sở dữ liệu giám sát tạm thời không khả dụng', code: 'MONITORING_DB_UNAVAILABLE', request_id: req.requestId || null });
  }
  const status = error.statusCode || (error.type === 'entity.parse.failed' ? 400 : error.type === 'entity.too.large' ? 413 : 500);
  if (status >= 500) {
    console.error(JSON.stringify({ level: 'error', service: 'monitoring-service', request_id: req.requestId || null, msg: 'request failed', error: String(error.message).slice(0, 300) }));
  }
  res.status(status).json({
    message: error.expose ? error.message : status === 400 ? 'Dữ liệu không hợp lệ' : status === 413 ? 'Dữ liệu quá lớn' : 'Lỗi máy chủ',
    ...(error.code && error.expose ? { code: error.code } : {}),
    request_id: req.requestId || null,
  });
});

metrics.registerStateGauges(prisma);
const stopWorker = process.env.MONITORING_DELIVERY_WORKER === 'off' ? null : startWorker(prisma);
const stopReplay = internalRoutes.startSpoolReplay();

const server = app.listen(port, () => console.log(`Monitoring service listening on port ${port}`));

lifecycle = createServiceLifecycle({
  server,
  stopWork: [stopReplay, ...(stopWorker ? [stopWorker] : [])],
  closeResources: [() => prisma.$disconnect(), () => require('./telemetry').shutdown?.()],
});
process.on('SIGINT', lifecycle.shutdown);
process.on('SIGTERM', lifecycle.shutdown);

module.exports = app;
