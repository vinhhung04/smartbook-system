const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const multer = require("multer");

// Procurement document files are stored on disk next to the packing evidence (same approach as
// packing-video-storage.service.js), under evidence/procurement/. They are never served from a
// public URL: every download goes through an authenticated, permission-checked endpoint.
// Mount a volume on this path in docker-compose so files survive container rebuilds.

const STORAGE_ROOT = path.resolve(
  __dirname,
  "..",
  "..",
  process.env.PROCUREMENT_DOCUMENT_DIR || "evidence/procurement",
);

const MAX_FILE_BYTES = Number(process.env.PROCUREMENT_DOCUMENT_MAX_BYTES || 10 * 1024 * 1024);

// Detected from the file's own bytes; the client-declared MIME type is never trusted.
const FILE_KINDS = {
  pdf: { mime: "application/pdf", ext: "pdf" },
  xml: { mime: "application/xml", ext: "xml" },
  png: { mime: "image/png", ext: "png" },
  jpeg: { mime: "image/jpeg", ext: "jpg" },
};

class DocumentFileError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}

function detectFileKind(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 4) return null;
  if (buffer.subarray(0, 5).toString("latin1") === "%PDF-") return FILE_KINDS.pdf;
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return FILE_KINDS.png;
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return FILE_KINDS.jpeg;
  // XML e-invoice: text starting with "<" (optionally after a UTF-8 BOM / whitespace).
  const head = buffer.subarray(0, 2048).toString("utf8").replace(/^﻿/, "").trimStart();
  if (head.startsWith("<")) {
    if (buffer.includes(0)) return null; // binary masquerading as XML
    if (/<!DOCTYPE|<!ENTITY/i.test(head)) return null; // no DTDs / entity tricks
    return FILE_KINDS.xml;
  }
  return null;
}

function sanitizeOriginalName(name) {
  const base = path.basename(String(name || "document")).replace(/[\u0000-\u001f\u007f"\\/<>:|?*]/g, "_").trim();
  return (base || "document").slice(0, 200);
}

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

/** Validate an uploaded buffer and return its detected kind + checksum. Pure (no disk access). */
function inspectUpload(file) {
  if (!file || !Buffer.isBuffer(file.buffer) || file.buffer.length === 0) {
    throw new DocumentFileError("Thiếu file đính kèm");
  }
  if (file.buffer.length > MAX_FILE_BYTES) {
    throw new DocumentFileError(`File vượt quá dung lượng cho phép (${Math.round(MAX_FILE_BYTES / 1024 / 1024)} MB)`, 413);
  }
  const kind = detectFileKind(file.buffer);
  if (!kind) {
    throw new DocumentFileError("Chỉ chấp nhận file PDF, XML hóa đơn điện tử, PNG hoặc JPEG hợp lệ", 415);
  }
  return {
    mime_type: kind.mime,
    ext: kind.ext,
    size_bytes: file.buffer.length,
    sha256: sha256(file.buffer),
    original_name: sanitizeOriginalName(file.originalname),
  };
}

function resolveStoragePath(storageRef) {
  const full = path.resolve(STORAGE_ROOT, storageRef);
  if (!full.startsWith(STORAGE_ROOT + path.sep)) {
    throw new DocumentFileError("Đường dẫn file không hợp lệ", 400);
  }
  return full;
}

/**
 * Write one immutable version. Uses the "wx" flag so an existing file can never be overwritten.
 * @returns {string} storage_ref relative to the storage root
 */
async function writeVersionFile({ documentId, versionNo, buffer, info }) {
  const safeDocId = String(documentId).replace(/[^a-zA-Z0-9-]/g, "");
  const storageRef = `${safeDocId}/v${versionNo}-${info.sha256.slice(0, 12)}.${info.ext}`;
  const full = resolveStoragePath(storageRef);
  await fs.promises.mkdir(path.dirname(full), { recursive: true });
  await fs.promises.writeFile(full, buffer, { flag: "wx" });
  return storageRef;
}

async function removeOrphanFile(storageRef) {
  try {
    await fs.promises.unlink(resolveStoragePath(storageRef));
  } catch (_error) {
    // best effort: only used to clean up after a failed database transaction
  }
}

function openReadStream(storageRef) {
  const full = resolveStoragePath(storageRef);
  if (!fs.existsSync(full)) {
    throw new DocumentFileError("Không tìm thấy file trên kho lưu trữ", 404);
  }
  return fs.createReadStream(full);
}

// Multipart parser for document uploads (single field "file"). Memory storage: the buffer is
// inspected (magic bytes + size + checksum) before anything touches the disk.
const documentUploadMiddleware = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_BYTES, files: 1, fields: 40 },
}).single("file");

function handleDocumentUpload(req, res, next) {
  // Plain JSON requests (no file) skip multer entirely.
  if (!String(req.headers["content-type"] || "").toLowerCase().startsWith("multipart/form-data")) return next();
  return documentUploadMiddleware(req, res, (error) => {
    if (!error) return next();
    if (error.code === "LIMIT_FILE_SIZE") {
      return res.status(413).json({ message: `File vượt quá dung lượng cho phép (${Math.round(MAX_FILE_BYTES / 1024 / 1024)} MB)` });
    }
    return res.status(400).json({ message: "Dữ liệu tải lên không hợp lệ" });
  });
}

module.exports = {
  DocumentFileError,
  MAX_FILE_BYTES,
  STORAGE_ROOT,
  detectFileKind,
  inspectUpload,
  sanitizeOriginalName,
  writeVersionFile,
  removeOrphanFile,
  openReadStream,
  resolveStoragePath,
  handleDocumentUpload,
};
