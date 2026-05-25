const express = require("express");
const { authorizeAnyPermission } = require("../middlewares/auth.middleware");
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

const canReadStock = authorizeAnyPermission(["inventory.stock.read", "inventory.stock.write"]);
const canWriteStock = authorizeAnyPermission(["inventory.stock.write"]);

/**
 * @route POST /receiving-smart/match
 * @desc Match extracted items against catalog
 */
router.post("/match", canWriteStock, matchItems);

/**
 * @route POST /receiving-smart/drafts
 * @desc Create a new smart receiving draft
 */
router.post("/drafts", canWriteStock, createDraft);

/**
 * @route GET /receiving-smart/drafts
 * @desc List all smart receiving drafts
 */
router.get("/drafts", canReadStock, listDrafts);

/**
 * @route GET /receiving-smart/drafts/:id
 * @desc Get draft details
 */
router.get("/drafts/:id", canReadStock, getDraft);

/**
 * @route PUT /receiving-smart/drafts/:id
 * @desc Update draft (user corrections)
 */
router.put("/drafts/:id", canWriteStock, updateDraft);

/**
 * @route POST /receiving-smart/drafts/:id/convert
 * @desc Convert draft to goods receipt
 */
router.post("/drafts/:id/convert", canWriteStock, convertDraft);

/**
 * @route DELETE /receiving-smart/drafts/:id
 * @desc Cancel a draft
 */
router.delete("/drafts/:id", canWriteStock, cancelDraft);

module.exports = router;
