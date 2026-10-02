const express = require('express');
const { getRecommendationInteractions } = require('../controllers/recommendation-internal.controller');

const router = express.Router();

// ai-service Recommendation V2 (popularity / trend / collaborative filtering).
router.get('/interactions', getRecommendationInteractions);

module.exports = router;
