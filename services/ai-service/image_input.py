"""Safe intake of a user-uploaded book photo (Phase F3).

The declared Content-Type is never trusted: the bytes must start with a JPEG,
PNG or WebP signature, decode with Pillow as that same format, stay under a
byte and a pixel budget, and decode completely (a truncated or corrupt file
is refused). SVG, GIF, HEIC and everything else are refused - SVG is text that
can carry script and has no business reaching a vision model.

normalize() re-encodes the decoded pixels as a JPEG of bounded size: EXIF
(GPS position, device serial) and any trailing payload never leave the
service, and the OCR provider receives a smaller file. The original bytes
are not stored or logged anywhere.
"""
from __future__ import annotations

import io
import os

from fastapi import HTTPException, UploadFile
from PIL import Image, ImageOps, UnidentifiedImageError

MAX_IMAGE_BYTES = int(os.getenv("AI_IMAGE_MAX_BYTES", str(8 * 1024 * 1024)))
MAX_IMAGE_PIXELS = int(os.getenv("AI_IMAGE_MAX_PIXELS", str(40_000_000)))
MIN_IMAGE_SIDE = 64
NORMALIZED_MAX_SIDE = int(os.getenv("AI_IMAGE_NORMALIZED_MAX_SIDE", "1600"))
ALLOWED_FORMATS = {"JPEG": "image/jpeg", "PNG": "image/png", "WEBP": "image/webp"}
_READ_CHUNK = 256 * 1024


def sniff_format(data: bytes) -> str | None:
    """The format the file really is, from its first bytes."""
    if data[:3] == b"\xff\xd8\xff":
        return "JPEG"
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return "PNG"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "WEBP"
    return None


async def read_upload(file: UploadFile, limit: int = MAX_IMAGE_BYTES) -> bytes:
    """At most `limit` bytes of the upload; one byte more is a 413."""
    buf = bytearray()
    while True:
        chunk = await file.read(_READ_CHUNK)
        if not chunk:
            break
        buf += chunk
        if len(buf) > limit:
            raise HTTPException(status_code=413, detail=f"Ảnh vượt quá {limit // (1024 * 1024)} MB.")
    if not buf:
        raise HTTPException(status_code=400, detail="File ảnh rỗng.")
    return bytes(buf)


def validate(data: bytes) -> dict:
    """{'format', 'mime', 'width', 'height'} of a safe image, or an HTTP 4xx."""
    if len(data) > MAX_IMAGE_BYTES:
        raise HTTPException(status_code=413, detail=f"Ảnh vượt quá {MAX_IMAGE_BYTES // (1024 * 1024)} MB.")
    fmt = sniff_format(data)
    if fmt is None:
        raise HTTPException(status_code=415, detail="Chỉ nhận ảnh JPEG, PNG hoặc WebP.")
    try:
        with Image.open(io.BytesIO(data)) as img:
            if img.format != fmt:
                raise HTTPException(status_code=415, detail="Nội dung file không khớp định dạng ảnh.")
            width, height = img.size
            # Checked before decoding, so a decompression bomb is never expanded.
            if width * height > MAX_IMAGE_PIXELS:
                raise HTTPException(status_code=413, detail="Ảnh có độ phân giải quá lớn.")
            if min(width, height) < MIN_IMAGE_SIDE:
                raise HTTPException(status_code=400, detail="Ảnh quá nhỏ để nhận diện.")
            img.load()  # full decode: truncated / corrupt data fails here
    except HTTPException:
        raise
    except (UnidentifiedImageError, OSError, SyntaxError, ValueError, Image.DecompressionBombError):
        raise HTTPException(status_code=400, detail="Không đọc được ảnh (file hỏng hoặc không hợp lệ).")
    return {"format": fmt, "mime": ALLOWED_FORMATS[fmt], "width": width, "height": height}


def normalize(data: bytes) -> bytes:
    """A metadata-free JPEG of the same picture, longest side <= NORMALIZED_MAX_SIDE."""
    with Image.open(io.BytesIO(data)) as img:
        # keep the photo upright: the orientation tag is dropped with the rest of EXIF
        img = ImageOps.exif_transpose(img).convert("RGB")
        img.thumbnail((NORMALIZED_MAX_SIDE, NORMALIZED_MAX_SIDE))
        out = io.BytesIO()
        img.save(out, format="JPEG", quality=88)
    return out.getvalue()
