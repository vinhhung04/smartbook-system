const router = require('express').Router();
const { authorizeAnyPermission, authorizeManagerDecision } = require('../middlewares/auth.middleware');
const { createDraft, getDraft, decideField, applyDraft } = require('../controllers/metadata-reconciliation.controller');
router.get('/capabilities', authorizeAnyPermission(['inventory.catalog.read', 'inventory.catalog.write']), (_req, res) => res.json({ metadataIntelligence: true }));
// ai-service's book OCR scan asks this before spending an inference call: same gate as creating a draft.
router.get('/capabilities/import', authorizeManagerDecision(['inventory.catalog.write']), (_req, res) => res.json({ catalogImport: true }));
router.post('/', authorizeManagerDecision(['inventory.catalog.write']), createDraft);
router.get('/:id', authorizeAnyPermission(['inventory.catalog.read', 'inventory.catalog.write']), getDraft);
router.patch('/:id/fields/:field', authorizeManagerDecision(['inventory.catalog.write']), decideField);
router.post('/:id/apply', authorizeManagerDecision(['inventory.catalog.write']), applyDraft);
module.exports = router;
