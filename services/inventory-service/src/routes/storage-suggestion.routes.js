/**
 * Storage Suggestion Routes
 */

const express = require('express');
const router = express.Router();
const storageSuggestionController = require('../controllers/storage-suggestion.controller');
const { authorizeAnyPermission } = require('../middlewares/auth.middleware');

router.post('/', authorizeAnyPermission(['inventory.warehouse.read', 'inventory.putaway.execute']), storageSuggestionController.getSuggestions);
router.get('/context', authorizeAnyPermission(['inventory.warehouse.read', 'inventory.putaway.execute']), storageSuggestionController.getContext);
router.post('/apply', authorizeAnyPermission(['inventory.putaway.execute']), storageSuggestionController.applySuggestion);

module.exports = router;
