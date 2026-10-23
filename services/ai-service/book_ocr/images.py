"""Upload validation + cost-aware preprocessing, entirely in memory.

The declared Content-Type is never trusted: the format comes from the file's
magic bytes and must then decode as that same format. Dimensions are checked
from the header before any pixel data is decoded (decompression bombs), the
EXIF orientation is applied, transparency is flattened, and the image is
downscaled (never upscaled) to `max_image_edge` and re-encoded as JPEG - which
also strips EXIF/GPS metadata before anything leaves the server.
"""
from __future__ import annotations

import io
import warnings
from dataclasses import dataclass

from PIL import Image, ImageOps

from .errors import BookOcrError

_ALLOWED = {"JPEG": "image/jpeg", "PNG": "image/png", "WEBP": "image/webp"}
MIN_EDGE_PX = 64
JPEG_QUALITY = 90


@dataclass(frozen=True)
class PreparedImage:
    kind: str
    data: bytes
    mime: str
    source_format: str
    original_bytes: int
    original_size: tuple[int, int]
    size: tuple[int, int]
    resized: bool

    def summary(self) -> dict:
        return {
            "kind": self.kind, "sourceFormat": self.source_format,
            "originalBytes": self.original_bytes, "processedBytes": len(self.data),
            "originalSize": list(self.original_size), "size": list(self.size), "resized": self.resized,
        }


def sniff_format(data: bytes) -> str | None:
    if data[:3] == b"\xff\xd8\xff":
        return "JPEG"
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return "PNG"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "WEBP"
    return None


def prepare_image(kind: str, raw: bytes, *, max_file_bytes: int, max_pixels: int, max_edge: int) -> PreparedImage:
    label = {"front_cover": "bìa trước", "back_cover": "bìa sau", "copyright_page": "trang thông tin xuất bản"}.get(kind, kind)
    if not raw:
        raise BookOcrError(400, "EMPTY_IMAGE", f"Ảnh {label} rỗng.")
    if len(raw) > max_file_bytes:
        raise BookOcrError(413, "IMAGE_TOO_LARGE",
                           f"Ảnh {label} vượt quá {max_file_bytes // (1024 * 1024)} MB.")
    sniffed = sniff_format(raw)
    if sniffed is None:
        raise BookOcrError(415, "UNSUPPORTED_IMAGE_TYPE", f"Ảnh {label} phải là JPG, PNG hoặc WebP.")
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            image = Image.open(io.BytesIO(raw))
            if image.format != sniffed or image.format not in _ALLOWED:
                raise BookOcrError(415, "UNSUPPORTED_IMAGE_TYPE", f"Ảnh {label} không đúng định dạng khai báo.")
            width, height = image.size
            if width * height > max_pixels:
                raise BookOcrError(413, "IMAGE_DIMENSIONS_TOO_LARGE", f"Ảnh {label} có độ phân giải quá lớn.")
            if min(width, height) < MIN_EDGE_PX:
                raise BookOcrError(400, "IMAGE_TOO_SMALL", f"Ảnh {label} quá nhỏ để đọc chữ.")
            image.seek(0)  # animated WebP/PNG: first frame only
            image.load()
    except BookOcrError:
        raise
    except (Image.DecompressionBombError, Image.DecompressionBombWarning):
        raise BookOcrError(413, "IMAGE_DIMENSIONS_TOO_LARGE", f"Ảnh {label} có độ phân giải quá lớn.")
    except (OSError, ValueError, SyntaxError, EOFError):
        raise BookOcrError(400, "CORRUPT_IMAGE", f"Ảnh {label} bị lỗi hoặc không đọc được.")

    image = ImageOps.exif_transpose(image)
    if image.mode in ("RGBA", "LA") or (image.mode == "P" and "transparency" in image.info):
        rgba = image.convert("RGBA")
        flattened = Image.new("RGB", rgba.size, (255, 255, 255))
        flattened.paste(rgba, mask=rgba.getchannel("A"))
        image = flattened
    elif image.mode != "RGB":
        image = image.convert("RGB")
    upright_size = image.size
    resized = max(upright_size) > max_edge
    if resized:
        image.thumbnail((max_edge, max_edge), Image.Resampling.LANCZOS)
    out = io.BytesIO()
    image.save(out, format="JPEG", quality=JPEG_QUALITY)
    return PreparedImage(
        kind=kind, data=out.getvalue(), mime="image/jpeg", source_format=sniffed,
        original_bytes=len(raw), original_size=upright_size, size=image.size, resized=resized,
    )
