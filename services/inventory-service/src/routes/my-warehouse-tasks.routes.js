const express = require('express');
const { getAvailableTasks } = require('../controllers/my-warehouse-tasks.controller');
const { authorizeTaskRead } = require('../middlewares/auth.middleware');

const router = express.Router();

router.get('/available', authorizeTaskRead(['inventory.task.read']), getAvailableTasks);

module.exports = router;
