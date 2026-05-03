/**
 * Storage Suggestion Routes
 */

const express = require('express');
const router = express.Router();
const storageSuggestionController = require('../controllers/storage-suggestion.controller');

router.post('/', storageSuggestionController.getSuggestions);
router.get('/context', storageSuggestionController.getContext);
router.post('/apply', storageSuggestionController.applySuggestion);

module.exports = router;
