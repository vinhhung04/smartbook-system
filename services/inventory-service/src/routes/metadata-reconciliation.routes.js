const router = require('express').Router();
const { authorizeAnyPermission, authorizeManagerDecision } = require('../middlewares/auth.middleware');
const { createDraft, getDraft, decideField } = require('../controllers/metadata-reconciliation.controller');
router.post('/', authorizeManagerDecision(['inventory.catalog.write']), createDraft);
router.get('/:id', authorizeAnyPermission(['inventory.catalog.read', 'inventory.catalog.write']), getDraft);
router.patch('/:id/fields/:field', authorizeManagerDecision(['inventory.catalog.write']), decideField);
module.exports = router;
