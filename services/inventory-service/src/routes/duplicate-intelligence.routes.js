const router = require('express').Router();
const { authorizeAnyPermission, authorizeManagerDecision } = require('../middlewares/auth.middleware');
const { check, getReview, decide } = require('../controllers/duplicate-intelligence.controller');

router.post('/check', authorizeAnyPermission(['inventory.catalog.read', 'inventory.catalog.write']), check);
router.get('/reviews/:id', authorizeAnyPermission(['inventory.catalog.read', 'inventory.catalog.write']), getReview);
router.patch('/reviews/:id', authorizeManagerDecision(['inventory.catalog.write']), decide);

module.exports = router;
