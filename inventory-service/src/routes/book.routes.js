const express = require('express');

const { getAllBooks } = require('../controllers/book.controller');

const router = express.Router();

router.get('/', getAllBooks);

module.exports = router;