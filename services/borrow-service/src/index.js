require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { authenticateToken } = require('./middlewares/auth.middleware');
const customerRoutes = require('./routes/customer.routes');
const customerInternalRoutes = require('./routes/customer-internal.routes');
const myRoutes = require('./routes/my.routes');
const reservationRoutes = require('./routes/reservation.routes');
const loanRoutes = require('./routes/loan.routes');
const fineRoutes = require('./routes/fine.routes');
const reviewRoutes = require('./routes/review.routes');
const auditRoutes = require('./routes/audit.routes');
const membershipPlanRoutes = require('./routes/membership-plan.routes');
const notificationAdminRoutes = require('./routes/notification-admin.routes');
const { startOverdueSweepJob } = require('./jobs/overdue.job');

const app = express();
const PORT = process.env.PORT || 3005;
const JSON_BODY_LIMIT = process.env.JSON_BODY_LIMIT || '4mb';

function validateRequiredEnv() {
  const required = ['DATABASE_URL', 'JWT_SECRET'];
  const missing = required.filter((name) => !String(process.env[name] || '').trim());
  if (missing.length > 0) {
    throw new Error(`Missing required env: ${missing.join(', ')}`);
  }
}

validateRequiredEnv();

app.use(cors());
app.use(express.json({ limit: JSON_BODY_LIMIT }));
app.use(express.urlencoded({ extended: true, limit: JSON_BODY_LIMIT }));

app.use((req, _res, next) => {
  req.requestId = req.headers['x-request-id'] || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  console.log('[borrow-service] request', {
    requestId: req.requestId,
    method: req.method,
    path: req.originalUrl,
    actor: req.user?.id || null,
  });
  next();
});

app.get('/health', (_req, res) => {
  res.json({
    service: 'borrow-service',
    status: 'ok',
  });
});

app.use('/internal/customers', customerInternalRoutes);

app.use('/borrow', authenticateToken);

app.use('/borrow/customers', customerRoutes);
app.use('/borrow/my', myRoutes);
app.use('/borrow/reservations', reservationRoutes);
app.use('/borrow/loans', loanRoutes);
app.use('/borrow/fines', fineRoutes);
app.use('/borrow/reviews', reviewRoutes);
app.use('/borrow/audit-logs', auditRoutes);
app.use('/borrow/membership-plans', membershipPlanRoutes);
app.use('/borrow/notifications', notificationAdminRoutes);

app.use((err, req, res, next) => {
  if (err?.type === 'entity.too.large') {
    return res.status(413).json({
      message: `Payload too large (current limit: ${JSON_BODY_LIMIT})`,
    });
  }

  const status = Number(err?.status) || Number(err?.statusCode) || 500;
  const safeMessage = status >= 500 ? 'Internal server error' : (err?.message || 'Request failed');

  console.error('[borrow-service] unhandled error', {
    requestId: req.requestId || null,
    method: req.method,
    path: req.originalUrl,
    status,
    message: err?.message,
    stack: err?.stack,
  });

  return res.status(status).json({
    message: safeMessage,
    request_id: req.requestId || null,
  });
});

app.listen(PORT, () => {
  console.log(`Borrow Service running on http://localhost:${PORT}`);
  startOverdueSweepJob();
});
