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
// The borrow-service due-soon reminder job calls this with the internal
// service key, not a user JWT - same convention as the two routes above.
router.get('/late-return-risk', authenticateInternalOrUser, analyticsController.getLateReturnRisk);
// ai-service's nightly briefing agent (services/ai-service/nightly_briefing.py) calls
// these six with the internal service key - same convention as the routes above.
router.get('/overdue-summary', authenticateInternalOrUser, analyticsController.getOverdueSummary);
router.get('/fine-summary', authenticateInternalOrUser, analyticsController.getFineSummary);
router.get('/warehouse-stock-risk', authenticateInternalOrUser, analyticsController.getWarehouseStockRisk);
router.get('/reorder-suggestions', authenticateInternalOrUser, analyticsController.getReorderSuggestions);
router.get('/reservation-funnel', authenticateInternalOrUser, analyticsController.getReservationFunnel);
router.get('/weeding-suggestions', authenticateInternalOrUser, analyticsController.getWeedingSuggestions);

router.use(authenticateToken, readAnalytics);

router.get('/dashboard/kpis', analyticsController.getDashboardKpis);
router.get('/borrow-trends', analyticsController.getBorrowTrends);
router.get('/top-books', analyticsController.getTopBooks);
router.get('/forecast-accuracy', analyticsController.getForecastAccuracy);
router.get('/reservation-no-show-risk', analyticsController.getReservationNoShowRisk);

module.exports = router;
