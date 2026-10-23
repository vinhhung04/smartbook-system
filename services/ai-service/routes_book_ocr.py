"""POST /book-metadata/scan-images - multi-image OCR for the AI Import form.

multipart/form-data, at most one file per slot: `front_cover`,
`back_cover`, `copyright_page` (1-3 files), plus an optional `barcode` text
field (an EAN the browser decoded from the back cover). Read-only: the scan
never writes to the catalog. Errors are `{"message", "code"}` JSON.
Dependencies are injected by main.py (no import of main here, as with the
other routes_* modules).
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from starlette.datastructures import UploadFile

from book_ocr.config import IMAGE_KINDS, load_settings
from book_ocr.errors import BookOcrError
from book_ocr.service import scan_book_images
from catalog_access import CATALOG_IMPORT_CAPABILITY, catalog_access_error

logger = logging.getLogger("uvicorn.error")
_MULTIPART_OVERHEAD = 64 * 1024
_AUTH_MESSAGES = {401: "Vui lòng đăng nhập lại.", 403: "Bạn không có quyền nhập sách vào catalog.",
                  503: "Chưa xác minh được quyền truy cập catalog. Vui lòng thử lại sau."}


def _error(status: int, code: str, message: str) -> JSONResponse:
    return JSONResponse(status_code=status, content={"message": message, "code": code})


def build_router(lookup_isbn):
    router = APIRouter(tags=["book-ocr"])

    @router.get("/book-metadata/capabilities")
    async def capabilities():
        settings = load_settings()
        return {
            "enabled": settings.enabled, "imageKinds": list(IMAGE_KINDS), "maxImages": settings.max_images,
            "maxFileBytes": settings.max_file_bytes, "maxTotalBytes": settings.max_total_bytes,
            "acceptedTypes": ["image/jpeg", "image/png", "image/webp"], "model": settings.model,
        }

    @router.post("/book-metadata/scan-images")
    async def scan_images(request: Request):
        settings = load_settings()
        if not settings.enabled:
            return _error(404, "BOOK_OCR_DISABLED", "Tính năng nhập sách bằng ảnh đang tắt.")
        denied = await catalog_access_error(request.headers.get("authorization"), CATALOG_IMPORT_CAPABILITY)
        if denied:
            return _error(denied[0], "FORBIDDEN" if denied[0] == 403 else "UNAUTHORIZED" if denied[0] == 401
                          else "AUTH_UNAVAILABLE", _AUTH_MESSAGES[denied[0]])
        try:
            declared = int(request.headers.get("content-length") or 0)
        except ValueError:
            declared = 0
        if declared > settings.max_total_bytes + _MULTIPART_OVERHEAD:
            return _error(413, "UPLOAD_TOO_LARGE",
                          f"Tổng dung lượng ảnh vượt quá {settings.max_total_bytes // (1024 * 1024)} MB.")
        form = None
        try:
            try:
                form = await request.form(max_files=len(IMAGE_KINDS), max_fields=4)
            except Exception:  # noqa: BLE001 - malformed multipart or too many parts
                return _error(400, "INVALID_UPLOAD", "Dữ liệu tải lên không hợp lệ (tối đa 3 ảnh, mỗi loại 1 ảnh).")
            uploads: dict[str, bytes] = {}
            barcode = None
            for name, value in form.multi_items():
                if isinstance(value, UploadFile):
                    if name not in IMAGE_KINDS:
                        return _error(400, "UNKNOWN_IMAGE_SLOT", f"Loại ảnh không hợp lệ: {name[:40]}")
                    if name in uploads:
                        return _error(400, "DUPLICATE_IMAGE_SLOT", "Mỗi loại ảnh chỉ được tải lên một lần.")
                    # Read one byte past the limit: enough to know it is too big.
                    uploads[name] = await value.read(settings.max_file_bytes + 1)
                elif name == "barcode" and value:
                    barcode = str(value)[:32]
            result = await scan_book_images(uploads, barcode=barcode, lookup_isbn=lookup_isbn, settings=settings)
            return result
        except BookOcrError as error:
            return _error(error.status, error.code, error.message)
        except Exception as exc:  # noqa: BLE001 - never leak internals to the client
            logger.exception("book_ocr scan failed: %s", type(exc).__name__)
            return _error(500, "INTERNAL_ERROR", "Lỗi không mong muốn khi xử lý ảnh. Vui lòng thử lại.")
        finally:
            if form is not None:
                await form.close()  # drops any spooled temp files right away

    return router
