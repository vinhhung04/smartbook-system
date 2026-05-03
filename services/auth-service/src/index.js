require('dotenv').config();
const express = require('express');
const cors = require('cors');
const authRoutes = require('./routes/auth.routes');
const iamRoutes = require('./routes/iam.routes');
const redis = require('./lib/redis');

const app = express();
const PORT = process.env.PORT || 3002;

app.use(cors());
app.use(express.json());

// Connect to Redis
redis.connect().catch(err => {
  console.warn('[Auth] Redis not available, running without cache');
});

// Public auth endpoints under /auth
app.use('/auth', authRoutes);
app.use('/iam', iamRoutes);

app.get('/health', async (req, res) => {
  const redisStatus = redis.isConnected ? 'connected' : 'disconnected';
  res.json({ 
    status: 'ok', 
    service: 'auth-service',
    redis: redisStatus
  });
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
