/**
 * Re-slotting Suggestion Routes
 */

const express = require('express');
const router = express.Router();
const reslottingSuggestionController = require('../controllers/reslotting-suggestion.controller');

router.get('/', reslottingSuggestionController.getSuggestions);

module.exports = router;
