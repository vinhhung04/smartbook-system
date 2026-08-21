require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createCorsOptions, createRequestContext, createRequestLogger, requireEnv, securityHeaders } = require('@smartbook/shared/runtime');
const { prisma } = require('./lib/prisma');
const { authenticateToken, authorizeCustomerSelf } = require('./middlewares/auth.middleware');
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
const { startReservationExpiryJob } = require('./jobs/reservation-expiry.job');

const app = express();
const PORT = process.env.PORT || 3005;
const JSON_BODY_LIMIT = process.env.JSON_BODY_LIMIT || '4mb';

function validateRequiredEnv() {
  requireEnv(process.env, ['DATABASE_URL', 'JWT_SECRET', 'INTERNAL_SERVICE_KEY']);
}

validateRequiredEnv();

app.use(createRequestContext('borrow-service'));
app.use(createRequestLogger('borrow-service'));
app.use(securityHeaders);
app.use(cors(createCorsOptions(process.env.ALLOWED_ORIGINS)));
app.use(express.json({ limit: JSON_BODY_LIMIT }));
app.use(express.urlencoded({ extended: true, limit: JSON_BODY_LIMIT }));

app.use((req, _res, next) => {
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
    version: '1.0.0',
  });
});

app.get('/ready', async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return res.json({ service: 'borrow-service', status: 'ready' });
  } catch (_error) {
    return res.status(503).json({ service: 'borrow-service', status: 'not_ready' });
  }
});

app.use('/internal/customers', customerInternalRoutes);

app.use('/borrow', authenticateToken);

app.use('/borrow/customers', customerRoutes);
app.use('/borrow/my', authorizeCustomerSelf, myRoutes);
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
  startReservationExpiryJob();
});
