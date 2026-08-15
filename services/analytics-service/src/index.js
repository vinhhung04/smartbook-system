require('dotenv').config();

const express = require('express');
const cors = require('cors');
const { createCorsOptions, createRequestContext, requireEnv, securityHeaders } = require('@smartbook/shared/runtime');
const analyticsRoutes = require('./routes/analytics.routes');
const { closePools, pingDatabases } = require('./lib/db');

const app = express();
const port = Number(process.env.PORT || 3006);

requireEnv(process.env, ['INVENTORY_DATABASE_URL', 'BORROW_DATABASE_URL', 'JWT_SECRET', 'INTERNAL_SERVICE_KEY']);

app.use(createRequestContext('analytics-service'));
app.use(securityHeaders);
app.use(cors(createCorsOptions(process.env.ALLOWED_ORIGINS)));
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ service: 'analytics-service', status: 'ok', version: '1.0.0' });
});

app.get('/ready', async (_req, res) => {
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
  res.status(404).json({ message: 'Analytics route not found', path: req.originalUrl });
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

async function shutdown() {
  server.close(async () => {
    await closePools();
    process.exit(0);
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
