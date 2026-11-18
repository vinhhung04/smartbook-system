require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createServiceLifecycle, createCorsOptions, createRequestContext, createRequestLogger, requireEnv, securityHeaders } = require('@smartbook/shared/runtime');
const authRoutes = require('./routes/auth.routes');
const iamRoutes = require('./routes/iam.routes');
const { createInternalRouter } = require('./routes/internal.routes');
const redis = require('./lib/redis');
const prisma = require('./lib/prisma');

const app = express();
let lifecycle;
app.use((req, res, next) => lifecycle ? lifecycle.middleware(req, res, next) : next());
const PORT = process.env.PORT || 3002;

requireEnv(process.env, ['DATABASE_URL', 'JWT_SECRET', 'INTERNAL_SERVICE_KEY']);

app.use(createRequestContext('auth-service'));
app.use(createRequestLogger('auth-service'));
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
app.use('/internal', createInternalRouter({ prisma }));

app.get('/health', (_req, res) => {
  res.json({ service: 'auth-service', status: 'ok', version: '1.0.0' });
});

app.get('/ready', async (_req, res) => {
  if (lifecycle && !lifecycle.isReady()) return res.status(503).json({ status: 'draining' });
  try {
    await prisma.$queryRaw`SELECT 1`;
    return res.json({ service: 'auth-service', status: 'ready' });
  } catch (_error) {
    return res.status(503).json({ service: 'auth-service', status: 'not_ready' });
  }
});


const server = app.listen(PORT, () => {
  console.log(`Auth Service running on http://localhost:${PORT}`);
});

lifecycle = createServiceLifecycle({
  server,
  stopWork: [],
  closeResources: [() => redis.disconnect(), () => prisma.$disconnect(), () => require('./telemetry').shutdown?.()],
});
process.on('SIGINT', lifecycle.shutdown);
process.on('SIGTERM', lifecycle.shutdown);
