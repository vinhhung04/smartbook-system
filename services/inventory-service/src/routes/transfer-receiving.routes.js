const express = require('express');

const {
  listTransferReceivingQueue,
  assignTransferReceiving,
  confirmTransferReceiving,
} = require('../controllers/transfer-receiving.controller');
const {
  authorizeTaskRead,
  authorizeTaskProgress,
  authorizeManagerDecision,
} = require('../middlewares/auth.middleware');

const router = express.Router();

router.get('/', authorizeTaskRead(['inventory.task.read']), listTransferReceivingQueue);
router.patch('/:id/assign', authorizeManagerDecision(['inventory.operation.decide']), assignTransferReceiving);
router.post('/:id/confirm', authorizeTaskProgress(['inventory.task.progress']), confirmTransferReceiving);

module.exports = router;
