const express = require('express');

const {
  listTransferReceivingQueue,
  getTransferReceivingLines,
  assignTransferReceiving,
  claimSelfTransferReceiving,
  confirmTransferReceiving,
} = require('../controllers/transfer-receiving.controller');
const {
  authorizeTaskRead,
  authorizeTaskProgress,
  authorizeManagerDecision,
} = require('../middlewares/auth.middleware');
const { requireRecordWarehouse } = require('../middlewares/warehouse-scope.middleware');
const { transferDestinationWarehouse } = require('../utils/record-warehouse');
const { listDiscrepancies, getDiscrepancy, resolveDiscrepancy } = require('../controllers/transfer-discrepancy.controller');

const router = express.Router();
// the destination warehouse receives: assign / claim / confirm need WRITE there
const writesDestination = requireRecordWarehouse(transferDestinationWarehouse, { fresh: true });
// reading line details only needs READ scope at the destination (same record, same loader)
const readsDestination = requireRecordWarehouse(transferDestinationWarehouse, { access: 'read' });

router.get('/', authorizeTaskRead(['inventory.task.read']), listTransferReceivingQueue);
router.get('/discrepancies', authorizeTaskRead(['inventory.task.read']), listDiscrepancies);
router.get('/:id/discrepancies', authorizeTaskRead(['inventory.task.read']), readsDestination, getDiscrepancy);
router.post('/:id/discrepancies/resolve', authorizeManagerDecision(['inventory.operation.decide']), writesDestination, resolveDiscrepancy);
router.get('/:id/lines', authorizeTaskRead(['inventory.task.read']), readsDestination, getTransferReceivingLines);
router.patch('/:id/assign', authorizeManagerDecision(['inventory.operation.decide']), writesDestination, assignTransferReceiving);
router.patch('/:id/claim-self', authorizeTaskProgress(['inventory.task.progress']), writesDestination, claimSelfTransferReceiving);
router.post('/:id/confirm', authorizeTaskProgress(['inventory.task.progress']), writesDestination, confirmTransferReceiving);

module.exports = router;
