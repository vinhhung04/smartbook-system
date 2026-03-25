const express = require('express');
const {
  getReviewsByBook,
  getBookRatingStats,
} = require('../controllers/review.controller');

const router = express.Router();

router.get('/stats', getBookRatingStats);
router.get('/book/:bookId', getReviewsByBook);

module.exports = router;
