const express = require('express');
const { attachWarehouseScope } = require('../middlewares/warehouse-scope.middleware');
const { declareDataScope } = require('../middlewares/data-scope.middleware');
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

// Separate gate for routes that expose borrow-domain business data (some with direct
// customer PII: overdue-summary and late-return-risk return customer_name per record).
// WAREHOUSE_MANAGER intentionally has no borrow.* access (see auth-service/prisma/seed.js)
// and previously fell through to the broad `readAnalytics` set above for these too.
const readBorrowAnalytics = authorizeAnyPermission(['analytics.borrow.read']);

// Allows the inventory-service periodic job to call this read-only endpoint
// without a user JWT, using the same internal service key convention as
// other cross-service calls in this codebase (e.g. auth-service -> borrow-service).
// `permissionCheck` lets borrow-domain routes below require readBorrowAnalytics
// instead of the broad readAnalytics once a user JWT is presented.
function authenticateInternalOrUser(permissionCheck = readAnalytics) {
  return (req, res, next) => {
    const providedKey = String(req.headers['x-internal-service-key'] || '').trim();
    const expectedKey = String(process.env.INTERNAL_SERVICE_KEY || '').trim();
    if (providedKey && providedKey === expectedKey) {
      return next();
    }
    return authenticateToken(req, res, () => permissionCheck(req, res, next));
  };
}

router.get('/aging-inventory', declareDataScope('WAREHOUSE_SCOPED'), authenticateInternalOrUser(), attachWarehouseScope(), analyticsController.getAgingInventory);
router.get('/book-turnover', declareDataScope('SYSTEM'), authenticateInternalOrUser(), analyticsController.getBookTurnover);
// inventory-service's public catalog (popular / trending / top rated) calls this
// with the internal service key; the response holds aggregate counts only.
router.get('/catalog-signals', declareDataScope('SYSTEM'), authenticateInternalOrUser(), analyticsController.getCatalogSignals);
// The borrow-service due-soon reminder job calls this with the internal
// service key, not a user JWT - same convention as the two routes above.
router.get('/late-return-risk', declareDataScope('SYSTEM'), authenticateInternalOrUser(readBorrowAnalytics), analyticsController.getLateReturnRisk);
// ai-service's nightly briefing agent (services/ai-service/nightly_briefing.py) calls
// these six with the internal service key - same convention as the routes above.
router.get('/overdue-summary', declareDataScope('SYSTEM'), authenticateInternalOrUser(readBorrowAnalytics), analyticsController.getOverdueSummary);
router.get('/fine-summary', declareDataScope('SYSTEM'), authenticateInternalOrUser(readBorrowAnalytics), analyticsController.getFineSummary);
// Per-warehouse rows: only the warehouses in the caller's scope (attachWarehouseScope).
router.get('/warehouse-stock-risk', declareDataScope('WAREHOUSE_SCOPED'), authenticateInternalOrUser(), attachWarehouseScope(), analyticsController.getWarehouseStockRisk);
router.get('/warehouse-stock-items', declareDataScope('WAREHOUSE_SCOPED'), authenticateInternalOrUser(), attachWarehouseScope(), analyticsController.getWarehouseStockItems);
router.get('/reorder-suggestions', declareDataScope('SYSTEM'), authenticateInternalOrUser(), analyticsController.getReorderSuggestions);
router.get('/reservation-funnel', declareDataScope('SYSTEM'), authenticateInternalOrUser(readBorrowAnalytics), analyticsController.getReservationFunnel);
router.get('/weeding-suggestions', declareDataScope('WAREHOUSE_SCOPED'), authenticateInternalOrUser(), attachWarehouseScope(), analyticsController.getWeedingSuggestions);

router.use(authenticateToken, readAnalytics);

router.get('/dashboard/kpis', declareDataScope('SYSTEM'), analyticsController.getDashboardKpis);
router.get('/borrow-trends', declareDataScope('SYSTEM'), readBorrowAnalytics, analyticsController.getBorrowTrends);
router.get('/top-books', declareDataScope('SYSTEM'), analyticsController.getTopBooks);
router.get('/forecast-accuracy', declareDataScope('SYSTEM'), analyticsController.getForecastAccuracy);
router.get('/reservation-no-show-risk', declareDataScope('SYSTEM'), readBorrowAnalytics, analyticsController.getReservationNoShowRisk);

module.exports = router;
