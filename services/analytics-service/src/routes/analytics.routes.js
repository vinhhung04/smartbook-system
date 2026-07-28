const express = require('express');
const analyticsController = require('../controllers/analytics.controller');
const { authenticateToken, authorizeAnyPermission } = require('../middlewares/auth.middleware');

const router = express.Router();

const readAnalytics = authorizeAnyPermission([
  'analytics.reports.view',
  'analytics.dashboard.read',
  'analytics.forecast.view',
  'analytics.read',
  'reports.read',
]);

// Allows the inventory-service periodic job to call this read-only endpoint
// without a user JWT, using the same internal service key convention as
// other cross-service calls in this codebase (e.g. auth-service -> borrow-service).
function authenticateInternalOrUser(req, res, next) {
  const providedKey = String(req.headers['x-internal-service-key'] || '').trim();
  const expectedKey = String(process.env.INTERNAL_SERVICE_KEY || 'smartbook_internal_key').trim();
  if (providedKey && providedKey === expectedKey) {
    return next();
  }
  return authenticateToken(req, res, () => readAnalytics(req, res, next));
}

router.get('/aging-inventory', authenticateInternalOrUser, analyticsController.getAgingInventory);
router.get('/book-turnover', authenticateInternalOrUser, analyticsController.getBookTurnover);

router.use(authenticateToken, readAnalytics);

router.get('/dashboard/kpis', analyticsController.getDashboardKpis);
router.get('/borrow-trends', analyticsController.getBorrowTrends);
router.get('/top-books', analyticsController.getTopBooks);
router.get('/overdue-summary', analyticsController.getOverdueSummary);
router.get('/fine-summary', analyticsController.getFineSummary);
router.get('/warehouse-stock-risk', analyticsController.getWarehouseStockRisk);
router.get('/reorder-suggestions', analyticsController.getReorderSuggestions);
router.get('/reservation-funnel', analyticsController.getReservationFunnel);

module.exports = router;
