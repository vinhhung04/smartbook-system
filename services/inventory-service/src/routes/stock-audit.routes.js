const express = require('express');

const {
  getStockAudits,
  getStockAuditById,
  createStockAudit,
  assignStockAudit,
  submitLineCount,
  submitStockAudit,
  approveStockAudit,
  cancelStockAudit,
} = require('../controllers/stock-audit.controller');
const {
  authorizeAnyPermission,
  authorizeManagerDecision,
  authorizeTaskRead,
  authorizeTaskProgress,
} = require('../middlewares/auth.middleware');

const router = express.Router();

const canRead = authorizeAnyPermission(['inventory.audit.read']);
const canCount = authorizeTaskProgress(['inventory.stock.audit']);
const canCreate = authorizeManagerDecision(['inventory.stock.audit']);
const canDecide = authorizeManagerDecision(['inventory.operation.decide']);
const canApprove = authorizeManagerDecision(['inventory.audit.approve']);

router.get('/', canRead, getStockAudits);
router.get('/:id', canRead, getStockAuditById);
router.post('/', canCreate, createStockAudit);
router.patch('/:id/assign', canDecide, assignStockAudit);
router.patch('/:id/lines/:lineId', canCount, submitLineCount);
router.patch('/:id/submit', canCount, submitStockAudit);
router.patch('/:id/approve', canApprove, approveStockAudit);
router.patch('/:id/cancel', canDecide, cancelStockAudit);

module.exports = router;
