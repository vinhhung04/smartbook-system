const express = require('express');

const {
  listTransferReceivingQueue,
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

const router = express.Router();
// the destination warehouse receives: assign / claim / confirm need WRITE there
const writesDestination = requireRecordWarehouse(transferDestinationWarehouse, { fresh: true });

router.get('/', authorizeTaskRead(['inventory.task.read']), listTransferReceivingQueue);
router.patch('/:id/assign', authorizeManagerDecision(['inventory.operation.decide']), writesDestination, assignTransferReceiving);
router.patch('/:id/claim-self', authorizeTaskProgress(['inventory.task.progress']), writesDestination, claimSelfTransferReceiving);
router.post('/:id/confirm', authorizeTaskProgress(['inventory.task.progress']), writesDestination, confirmTransferReceiving);

module.exports = router;
