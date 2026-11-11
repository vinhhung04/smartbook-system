const express = require('express');

const {
  listStaffTasks,
  getMyStaffTasks,
  createStaffTask,
  updateStaffTask,
  updateStaffTaskStatus,
  getEntityOptions,
  getOpenTaskSummary,
  getStaffWorkload,
} = require('../controllers/staff-task.controller');
const {
  authorizeTaskRead,
  authorizeManagerDecision,
} = require('../middlewares/auth.middleware');

const router = express.Router();

const canReadTask = authorizeTaskRead(['inventory.task.read']);
const canManageTask = authorizeManagerDecision(['inventory.operation.decide']);

router.get('/entity-options', canManageTask, getEntityOptions);
router.get('/open-summary', canManageTask, getOpenTaskSummary);
router.get('/workload', canManageTask, getStaffWorkload);
router.get('/', canReadTask, listStaffTasks);
router.get('/my', canReadTask, getMyStaffTasks);
router.post('/', canManageTask, createStaffTask);
router.patch('/:id/status', canReadTask, updateStaffTaskStatus);
router.patch('/:id', canReadTask, updateStaffTask);

module.exports = router;
