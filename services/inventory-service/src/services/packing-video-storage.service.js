const fs = require("fs");
const path = require("path");
const multer = require("multer");

/**
 * Video Storage Service for Packing evidence. Writes recordings straight to disk instead of
 * base64-in-JSON (a full packing-session recording can easily exceed JSON_BODY_LIMIT). Files are
 * written under evidence/packing/ inside the service — mount a volume onto that path in
 * docker-compose so recordings survive container rebuilds.
 */

const EVIDENCE_ROOT = path.resolve(
  __dirname,
  "..",
  "..",
  process.env.PACKING_EVIDENCE_DIR || "evidence/packing",
);

let ensured = false;
function ensureEvidenceRoot() {
  if (!ensured) {
    fs.mkdirSync(EVIDENCE_ROOT, { recursive: true });
    ensured = true;
  }
  return EVIDENCE_ROOT;
}

function sanitizeForFilename(value) {
  return String(value || "").replace(/[^a-zA-Z0-9_-]/g, "");
}

/** e.g. PACK-20260726-3F2A1B9C-1721970000000.webm, or OB-OUT0001-1721970000000.webm as fallback. */
function buildVideoFilename({ taskNumber, outboundNumber }) {
  const base = taskNumber ? sanitizeForFilename(taskNumber) : `OB-${sanitizeForFilename(outboundNumber)}`;
  return `${base}-${Date.now()}.webm`;
}

function toStorageRef(filename) {
  return `packing/${filename}`;
}

const videoUploadMiddleware = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      try {
        cb(null, ensureEvidenceRoot());
      } catch (error) {
        cb(error);
      }
    },
    filename: (req, file, cb) => {
      cb(null, buildVideoFilename({ taskNumber: req.packingTaskNumber, outboundNumber: req.packingOutboundNumber }));
    },
  }),
  limits: { fileSize: 300 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype || !file.mimetype.startsWith("video/")) {
      return cb(new Error("Only video uploads are accepted"));
    }
    cb(null, true);
  },
});

module.exports = {
  ensureEvidenceRoot,
  buildVideoFilename,
  toStorageRef,
  videoUploadMiddleware,
};
