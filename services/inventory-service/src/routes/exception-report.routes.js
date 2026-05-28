const express = require('express');

const {
  createExceptionReport,
  getMyExceptionReports,
  getAllExceptionReports,
  getExceptionReportById,
  resolveExceptionReport,
  assignExceptionReport,
} = require('../controllers/exception-report.controller');
const {
  authorizeAnyPermission,
  authorizeManagerDecision,
} = require('../middlewares/auth.middleware');

const router = express.Router();

// STAFF can create and view their own exception reports
const canStaffReport = authorizeAnyPermission(['inventory.exception.report']);
// Only MANAGER/ADMIN can see all reports or resolve them
const canManagerResolve = authorizeManagerDecision(['inventory.exception.report']);

router.post('/', canStaffReport, createExceptionReport);
router.get('/my', canStaffReport, getMyExceptionReports);
router.get('/', canManagerResolve, getAllExceptionReports);
router.get('/:id', canStaffReport, getExceptionReportById);
router.post('/:id/resolve', canManagerResolve, resolveExceptionReport);
router.patch('/:id/assign', canManagerResolve, assignExceptionReport);

module.exports = router;
