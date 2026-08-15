require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createCorsOptions, createRequestContext, requireEnv, securityHeaders } = require('@smartbook/shared/runtime');
const authRoutes = require('./routes/auth.routes');
const iamRoutes = require('./routes/iam.routes');
const redis = require('./lib/redis');
const prisma = require('./lib/prisma');

const app = express();
const PORT = process.env.PORT || 3002;

requireEnv(process.env, ['DATABASE_URL', 'JWT_SECRET', 'INTERNAL_SERVICE_KEY']);

app.use(createRequestContext('auth-service'));
app.use(securityHeaders);
app.use(cors(createCorsOptions(process.env.ALLOWED_ORIGINS)));
app.use(express.json());

// Connect to Redis
redis.connect().catch(err => {
  console.warn('[Auth] Redis not available, running without cache');
});

// Public auth endpoints under /auth
app.use('/auth', authRoutes);
app.use('/iam', iamRoutes);

app.get('/health', (_req, res) => {
  res.json({ service: 'auth-service', status: 'ok', version: '1.0.0' });
});

app.get('/ready', async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return res.json({ service: 'auth-service', status: 'ready' });
  } catch (_error) {
    return res.status(503).json({ service: 'auth-service', status: 'not_ready' });
  }
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('[Auth] Shutting down...');
  await redis.disconnect();
  process.exit(0);
});

app.listen(PORT, () => {
  console.log(`Auth Service running on http://localhost:${PORT}`);
});
