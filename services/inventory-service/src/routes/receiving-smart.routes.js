const express = require("express");
const router = express.Router();
const { authorizeAnyPermission } = require("../middlewares/auth.middleware");

const {
  matchItems,
  createDraft,
  getDraft,
  listDrafts,
  updateDraft,
  convertDraft,
  cancelDraft,
} = require("../controllers/receiving-smart.controller");

const canRead = authorizeAnyPermission(["inventory.receiving.read", "inventory.receiving.write"]);
const canWrite = authorizeAnyPermission(["inventory.receiving.write", "ai.scan.receipt"]);

/**
 * @route POST /receiving-smart/match
 * @desc Match extracted items against catalog
 */
router.post("/match", canWrite, matchItems);

/**
 * @route POST /receiving-smart/drafts
 * @desc Create a new smart receiving draft
 */
router.post("/drafts", canWrite, createDraft);

/**
 * @route GET /receiving-smart/drafts
 * @desc List all smart receiving drafts
 */
router.get("/drafts", canRead, listDrafts);

/**
 * @route GET /receiving-smart/drafts/:id
 * @desc Get draft details
 */
router.get("/drafts/:id", canRead, getDraft);

/**
 * @route PUT /receiving-smart/drafts/:id
 * @desc Update draft (user corrections)
 */
router.put("/drafts/:id", canWrite, updateDraft);

/**
 * @route POST /receiving-smart/drafts/:id/convert
 * @desc Convert draft to goods receipt
 */
router.post("/drafts/:id/convert", canWrite, convertDraft);

/**
 * @route DELETE /receiving-smart/drafts/:id
 * @desc Cancel a draft
 */
router.delete("/drafts/:id", canWrite, cancelDraft);

module.exports = router;
