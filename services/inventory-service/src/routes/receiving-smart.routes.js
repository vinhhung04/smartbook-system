const express = require("express");
const router = express.Router();

const {
  matchItems,
  createDraft,
  getDraft,
  listDrafts,
  updateDraft,
  convertDraft,
  cancelDraft,
} = require("../controllers/receiving-smart.controller");

/**
 * @route POST /receiving-smart/match
 * @desc Match extracted items against catalog
 */
router.post("/match", matchItems);

/**
 * @route POST /receiving-smart/drafts
 * @desc Create a new smart receiving draft
 */
router.post("/drafts", createDraft);

/**
 * @route GET /receiving-smart/drafts
 * @desc List all smart receiving drafts
 */
router.get("/drafts", listDrafts);

/**
 * @route GET /receiving-smart/drafts/:id
 * @desc Get draft details
 */
router.get("/drafts/:id", getDraft);

/**
 * @route PUT /receiving-smart/drafts/:id
 * @desc Update draft (user corrections)
 */
router.put("/drafts/:id", updateDraft);

/**
 * @route POST /receiving-smart/drafts/:id/convert
 * @desc Convert draft to goods receipt
 */
router.post("/drafts/:id/convert", convertDraft);

/**
 * @route DELETE /receiving-smart/drafts/:id
 * @desc Cancel a draft
 */
router.delete("/drafts/:id", cancelDraft);

module.exports = router;
