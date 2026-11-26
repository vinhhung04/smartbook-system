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

/** storage_ref -> absolute file path inside the evidence root; null for anything else
 *  (basename only, so a crafted ref can never escape the directory). */
function resolveVideoPath(storageRef) {
  const ref = String(storageRef || "");
  if (!ref.startsWith("packing/")) return null;
  const name = path.basename(ref);
  if (!name || name !== ref.slice("packing/".length)) return null;
  return path.join(EVIDENCE_ROOT, name);
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
  limits: {
    fileSize: 300 * 1024 * 1024,
    fieldNameSize: 100, fieldNestingDepth: 4, fieldArrayIndexLimit: 100,
  },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype || !file.mimetype.startsWith("video/")) {
      return cb(new Error("Only video uploads are accepted"));
    }
    cb(null, true);
  },
});

/** Runs the multer upload and turns its failures into JSON the packing UI can show, instead of
 *  Express's default HTML 500 page (which also leaked the container path). */
function handleVideoUpload(req, res, next) {
  return videoUploadMiddleware.single("video")(req, res, (error) => {
    if (!error) return next();
    if (error.code === "LIMIT_FILE_SIZE") {
      return res.status(413).json({ message: "Video vượt quá dung lượng cho phép (300 MB)", code: "PACKING_VIDEO_TOO_LARGE" });
    }
    if (error instanceof multer.MulterError || error.message === "Only video uploads are accepted") {
      return res.status(400).json({ message: "Tệp tải lên không phải video hợp lệ", code: "PACKING_VIDEO_INVALID" });
    }
    // EACCES/ENOSPC/EROFS...: the evidence volume is not writable — a server problem, the client may retry
    console.error("Packing video storage failed:", error);
    return res.status(503).json({
      message: "Máy chủ chưa lưu được video (kho lưu trữ bằng chứng không ghi được). Video vẫn được giữ trên máy, hãy thử tải lại; nếu vẫn lỗi, báo quản trị hệ thống.",
      code: "PACKING_VIDEO_STORAGE_UNAVAILABLE",
    });
  });
}

module.exports = {
  ensureEvidenceRoot,
  buildVideoFilename,
  toStorageRef,
  resolveVideoPath,
  videoUploadMiddleware,
  handleVideoUpload,
};
