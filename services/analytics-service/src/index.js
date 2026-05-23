require('dotenv').config();

const express = require('express');
const cors = require('cors');
const analyticsRoutes = require('./routes/analytics.routes');
const { closePools, pingDatabases } = require('./lib/db');

const app = express();
const port = Number(process.env.PORT || 3006);

app.use(cors());
app.use(express.json());

app.get('/health', async (_req, res) => {
  try {
    const databases = await pingDatabases();
    return res.json({
      status: 'ok',
      service: 'analytics-service',
      databases,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return res.status(503).json({
      status: 'error',
      service: 'analytics-service',
      message: 'Analytics databases are not ready',
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
