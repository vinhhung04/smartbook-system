const router = require('express').Router();
const { authorizeAnyPermission, authorizeManagerDecision } = require('../middlewares/auth.middleware');
const { createDraft, getDraft, decideField, applyDraft } = require('../controllers/metadata-reconciliation.controller');
router.post('/', authorizeManagerDecision(['inventory.catalog.write']), createDraft);
router.get('/:id', authorizeAnyPermission(['inventory.catalog.read', 'inventory.catalog.write']), getDraft);
router.patch('/:id/fields/:field', authorizeManagerDecision(['inventory.catalog.write']), decideField);
router.post('/:id/apply', authorizeManagerDecision(['inventory.catalog.write']), applyDraft);
module.exports = router;
