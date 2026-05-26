/**
 * Storage Suggestion Routes
 */

const express = require('express');
const router = express.Router();
const storageSuggestionController = require('../controllers/storage-suggestion.controller');
const { authorizeAnyPermission, authorizeManagerDecision } = require('../middlewares/auth.middleware');

router.post('/', authorizeAnyPermission(['inventory.stock.read', 'inventory.operation.decide']), storageSuggestionController.getSuggestions);
router.get('/context', authorizeAnyPermission(['inventory.stock.read', 'inventory.operation.decide']), storageSuggestionController.getContext);
router.post('/apply', authorizeManagerDecision(['inventory.operation.decide']), storageSuggestionController.applySuggestion);

module.exports = router;
