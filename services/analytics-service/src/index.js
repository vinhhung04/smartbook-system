require('dotenv').config();

const express = require('express');
const cors = require('cors');
const { createServiceLifecycle, createCorsOptions, createRateLimiter, createRequestContext, createRequestLogger, requireEnv, securityHeaders } = require('@smartbook/shared/runtime');
const analyticsRoutes = require('./routes/analytics.routes');
const { closePools, pingDatabases } = require('./lib/db');

const app = express();
let lifecycle;
app.use((req, res, next) => lifecycle ? lifecycle.middleware(req, res, next) : next());
const port = Number(process.env.PORT || 3006);

requireEnv(process.env, ['INVENTORY_DATABASE_URL', 'BORROW_DATABASE_URL', 'JWT_SECRET', 'INTERNAL_SERVICE_KEY']);

app.use(createRequestContext('analytics-service'));
app.use(createRequestLogger('analytics-service'));
app.use(securityHeaders);
app.use(cors(createCorsOptions(process.env.ALLOWED_ORIGINS)));
app.use(express.json());
// No rate limiting previously existed here; several endpoints (getReorderSuggestions,
// getInventorySnapshot, getDashboardKpis) run unbounded multi-query aggregates on every
// call, so a low-privilege authenticated caller could loop them to exhaust the two DB
// pools (max 5 connections each, see lib/db.js). trustedProxyHops: 2 — same nginx +
// api-gateway chain as auth-service/supplier-portal (see packages/shared/runtime).
app.use(createRateLimiter({ max: 600, windowMs: 15 * 60 * 1000, trustedProxyHops: 2 }));

app.get('/health', (_req, res) => {
  res.json({ service: 'analytics-service', status: 'ok', version: '1.0.0' });
});

app.get('/ready', async (_req, res) => {
  if (lifecycle && !lifecycle.isReady()) return res.status(503).json({ status: 'draining' });
  try {
    await pingDatabases();
    return res.json({ service: 'analytics-service', status: 'ready' });
  } catch (_error) {
    return res.status(503).json({
      service: 'analytics-service',
      status: 'not_ready',
    });
  }
});

app.use('/analytics', analyticsRoutes);

app.use((req, res) => {
  res.status(404).json({ message: 'Không tìm thấy đường dẫn báo cáo phân tích', path: req.originalUrl });
});

app.use((error, _req, res, _next) => {
  console.error('analytics-service error:', error.message);
  res.status(error.statusCode || 500).json({
    message: error.expose ? error.message : 'Internal server error',
  });
});

const server = app.listen(port, () => {
  console.log(`Analytics service listening on port ${port}`);
});

lifecycle = createServiceLifecycle({ server, closeResources: [closePools, () => require('./telemetry').shutdown?.()] });
process.on('SIGINT', lifecycle.shutdown);
process.on('SIGTERM', lifecycle.shutdown);
