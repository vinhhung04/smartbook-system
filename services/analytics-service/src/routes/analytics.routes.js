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
