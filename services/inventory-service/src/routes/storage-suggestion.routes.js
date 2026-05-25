/**
 * Storage Suggestion Routes
 */

const express = require('express');
const router = express.Router();
const storageSuggestionController = require('../controllers/storage-suggestion.controller');
const { authorizeAnyPermission } = require('../middlewares/auth.middleware');

router.post('/', authorizeAnyPermission(['inventory.stock.read', 'inventory.stock.write']), storageSuggestionController.getSuggestions);
router.get('/context', authorizeAnyPermission(['inventory.stock.read', 'inventory.stock.write']), storageSuggestionController.getContext);
router.post('/apply', authorizeAnyPermission(['inventory.stock.write']), storageSuggestionController.applySuggestion);

module.exports = router;
