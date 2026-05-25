const express = require("express");
const { authorizeAnyPermission, authorizeManagerDecision } = require("../middlewares/auth.middleware");
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

const canReadReceiving = authorizeAnyPermission(["inventory.stock.read", "inventory.receiving.read", "inventory.task.read"]);
const canDecideReceiving = authorizeManagerDecision(["inventory.operation.decide"]);

/**
 * @route POST /receiving-smart/match
 * @desc Match extracted items against catalog
 */
router.post("/match", canDecideReceiving, matchItems);

/**
 * @route POST /receiving-smart/drafts
 * @desc Create a new smart receiving draft
 */
router.post("/drafts", canDecideReceiving, createDraft);

/**
 * @route GET /receiving-smart/drafts
 * @desc List all smart receiving drafts
 */
router.get("/drafts", canReadReceiving, listDrafts);

/**
 * @route GET /receiving-smart/drafts/:id
 * @desc Get draft details
 */
router.get("/drafts/:id", canReadReceiving, getDraft);

/**
 * @route PUT /receiving-smart/drafts/:id
 * @desc Update draft (user corrections)
 */
router.put("/drafts/:id", canDecideReceiving, updateDraft);

/**
 * @route POST /receiving-smart/drafts/:id/convert
 * @desc Convert draft to goods receipt
 */
router.post("/drafts/:id/convert", canDecideReceiving, convertDraft);

/**
 * @route DELETE /receiving-smart/drafts/:id
 * @desc Cancel a draft
 */
router.delete("/drafts/:id", canDecideReceiving, cancelDraft);

module.exports = router;
