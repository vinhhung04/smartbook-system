const express = require('express');
const { getPublicReviewsByBook, getBookRatingStats } = require('../controllers/review.controller');

// Anonymous read access for the public website's book pages. GET only;
// writing, editing and deleting a review stay on /borrow/my/reviews behind
// authenticateToken + authorizeCustomerSelf.
const router = express.Router();

router.get('/stats', getBookRatingStats);
router.get('/book/:bookId', getPublicReviewsByBook);

module.exports = router;
