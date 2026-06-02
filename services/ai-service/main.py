from fastapi import FastAPI, UploadFile, File, Form, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import ollama
import httpx
import os
import json
import re
import logging
import asyncio
import xml.etree.ElementTree as ET
import hashlib
import html as _html_module
import time
from html.parser import HTMLParser
from cache import response_cache, rate_limiter, summary_cache
from intent import detect_intent, normalize_text
from rag import (
    RAG_SYSTEM_RULES,
    build_fallback_reply,
    build_no_data_context,
    build_rag_context,
    ensure_source_line,
)
from retrieval import retrieve_context
from intent import BOOK_SEARCH_QUERY as _BOOK_SEARCH_INTENT
from agent_planner import plan_agent_action
from socket_emitter import push_ai_action_event
from agent_store import (
    create_pending_action,
    get_pending_action,
    cancel_pending_action,
    mark_action_executed,
    mark_action_failed,
    cleanup_expired_actions,
    is_expired,
    PENDING_ACTIONS,
    ACTION_RESULTS,
)
from agent_permissions import get_user_context, can_confirm_action, require_can_confirm_action
from user_personal_context import build_user_personal_context, get_primary_role, ANALYTICS_BLOCKED_ROLES
from agent_executor import execute_agent_action
from agent_schemas import ConfirmActionRequest, CancelActionRequest, ConfirmActionResponse
from agent_actions import (
    PENDING_CONFIRMATION,
    EXECUTED,
    CANCELLED,
    EXPIRED as ACTION_EXPIRED,
    get_action_config,
)

logger = logging.getLogger("uvicorn.error")

app = FastAPI(title="SmartBook AI Service")

# ── CORS ─────────────────────────────────────────────────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Lấy host Ollama từ biến môi trường (mặc định cho Docker Compose)
OLLAMA_HOST = os.getenv("OLLAMA_HOST", "http://ollama:11434")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "llava")
SUMMARY_MODEL = os.getenv("SUMMARY_MODEL", os.getenv("OLLAMA_MODEL", "llava"))
GOOGLE_BOOKS_API_BASE_URL = os.getenv(
    "GOOGLE_BOOKS_API_BASE_URL",
    "https://www.googleapis.com/books/v1/volumes",
)
OPEN_LIBRARY_API_BASE_URL = os.getenv(
    "OPEN_LIBRARY_API_BASE_URL",
    "https://openlibrary.org/api/books",
)
# Trang chủ OL (dùng để lấy /books/… .json và /works/… .json — API books không có description)
OPEN_LIBRARY_SITE_ORIGIN = os.getenv("OPEN_LIBRARY_SITE_ORIGIN", "https://openlibrary.org").rstrip("/")
WORLDCAT_CLASSIFY_API_BASE_URL = os.getenv(
    "WORLDCAT_CLASSIFY_API_BASE_URL",
    "https://classify.oclc.org/classify2/Classify",
)
GOOGLE_BOOKS_API_KEY = os.getenv("GOOGLE_BOOKS_API_KEY", "").strip()
BOOK_LOOKUP_TIMEOUT_SECONDS = float(os.getenv("BOOK_LOOKUP_TIMEOUT_SECONDS", "8"))
ENABLE_WORLDCAT_LOOKUP = os.getenv("ENABLE_WORLDCAT_LOOKUP", "false").lower() == "true"

# ── Marketplace lookup (Fahasa / Tiki / Vinabook) ─────────────────────────────
ENABLE_MARKETPLACE_LOOKUP = os.getenv("ENABLE_MARKETPLACE_LOOKUP", "false").lower() == "true"
BOOK_MARKETPLACE_TIMEOUT_SECONDS = float(os.getenv("BOOK_MARKETPLACE_TIMEOUT_SECONDS", "6"))
BOOK_LOOKUP_MAX_WEB_RESULTS = int(os.getenv("BOOK_LOOKUP_MAX_WEB_RESULTS", "5"))
BOOK_LOOKUP_USER_AGENT = os.getenv("BOOK_LOOKUP_USER_AGENT", "SmartBookBot/1.0")
MARKETPLACE_DOMAIN_ALLOWLIST: set[str] = {"fahasa.com", "tiki.vn", "vinabook.com"}
ENABLE_FAHA_CLOAKBROWSER = os.getenv("ENABLE_FAHA_CLOAKBROWSER", "false").lower() == "true"
BOOK_BROWSER_TIMEOUT_SECONDS = float(os.getenv("BOOK_BROWSER_TIMEOUT_SECONDS", "15"))

# Anthropic Claude LLM — dùng cloud API. Nếu không set key sẽ fallback Ollama local.
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "").strip()
ANTHROPIC_BASE_URL = os.getenv("ANTHROPIC_BASE_URL", "https://api.anthropic.com/v1").rstrip("/")
ANTHROPIC_MODEL = os.getenv("ANTHROPIC_MODEL", "claude-sonnet-4-6")
CHAT_LLM_TIMEOUT_SECONDS = float(os.getenv("CHAT_LLM_TIMEOUT_SECONDS", "12"))

PROMPT = (
    "Bạn là chuyên gia biên mục và giới thiệu sách cho thư viện. "
    "Dựa trên 2 thông tin đầu vào gồm Tên sách và Nhà xuất bản, hãy viết một đoạn mô tả ngắn về nội dung chính, chủ đề hoặc giá trị nổi bật của cuốn sách. "
    "Chỉ được suy luận từ chính các thông tin đã cung cấp. "
    "Không bịa thêm các chi tiết cụ thể như tên nhân vật, cốt truyện chi tiết, chương sách, giải thưởng hoặc nội dung chuyên sâu nếu không đủ căn cứ. "
    "Nếu thông tin không đủ để mô tả một cách đáng tin cậy, hãy trả về null. "
    "Nếu có thể suy luận hợp lý, hãy viết mô tả dài từ 3 đến 4 câu, văn phong trang trọng, lôi cuốn, phù hợp để hiển thị trong hệ thống thư viện. "
    "Nội dung mô tả nên tập trung vào chủ đề của sách, giá trị dành cho người đọc và ý nghĩa hoặc tính ứng dụng nổi bật của cuốn sách. "
    "Chỉ trả về DUY NHẤT một JSON hợp lệ, không có lời dẫn, không có giải thích, không có markdown, theo đúng định dạng: "
    '{"description": "..."}'
    " hoặc "
    '{"description": null}'
)


def _extract_json(raw: str) -> dict:
    """Trích xuất JSON từ response text của Ollama (có thể lẫn markdown/text thừa)."""
    # Thử parse thẳng trước
    try:
        return json.loads(raw.strip())
    except json.JSONDecodeError:
        pass

    # Tìm block ```json ... ``` hoặc ``` ... ```
    block = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", raw, re.DOTALL)
    if block:
        try:
            return json.loads(block.group(1))
        except json.JSONDecodeError:
            pass

    # Tìm object JSON đầu tiên xuất hiện trong chuỗi
    obj = re.search(r"\{.*?\}", raw, re.DOTALL)
    if obj:
        try:
            return json.loads(obj.group(0))
        except json.JSONDecodeError:
            pass

    # Trả về raw text nếu không parse được
    return {"title": raw.strip(), "author": None, "isbn": None, "publisher": None}


def _validate_and_read_image(file: UploadFile) -> bytes:
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="File phải là ảnh (image/*).")

    image_bytes = file.file.read()
    if len(image_bytes) == 0:
        raise HTTPException(status_code=400, detail="File ảnh rỗng.")
    return image_bytes


def _normalize_book_payload(book_data: dict, raw_text: str) -> dict:
    return {
        "title": book_data.get("title") or None,
        "author": book_data.get("author") or None,
        "isbn": book_data.get("isbn") or None,
        "publisher": book_data.get("publisher") or None,
        "raw": raw_text,
    }


def _recognize_book_from_bytes(image_bytes: bytes) -> dict:
    client = ollama.Client(host=OLLAMA_HOST)
    response = client.generate(
        model=OLLAMA_MODEL,
        prompt=PROMPT,
        images=[image_bytes],
        options={"temperature": 0},
    )
    raw_text: str = response.get("response", "")
    return _normalize_book_payload(_extract_json(raw_text), raw_text)


def _scan_back_cover_from_bytes(image_bytes: bytes) -> dict:
    client = ollama.Client(host=OLLAMA_HOST)
    response = client.generate(
        model=OLLAMA_MODEL,
        prompt=PROMPT_BACK,
        images=[image_bytes],
        options={"temperature": 0},
    )
    raw_text: str = response.get("response", "")
    data = _extract_json(raw_text)
    return {
        "isbn": data.get("isbn") or None,
        "price": data.get("price") or None,
        "raw": raw_text,
    }


PROMPT_BACK = (
    "Hãy đóng vai một quản lý kho sách. "
    "Nhìn vào ảnh mặt sau của cuốn sách này. "
    "Hãy tìm và trích xuất: Mã vạch/ISBN (dãy số dưới barcode), Giá bán (thường định dạng như 85.000đ hoặc 120,000 VND). "
    "Trả về kết quả CHỈ gồm định dạng JSON chuẩn, không thêm bất kỳ chú thích hay markdown nào: "
    '{"isbn": "...", "price": "..."}. '
    "Nếu không tìm thấy thông tin nào hãy để giá trị là null."
)


@app.get("/health")
async def health():
    return {"status": "ok", "model": OLLAMA_MODEL, "ollama_host": OLLAMA_HOST}


@app.post("/scan-back-cover")
async def scan_back_cover(file: UploadFile = File(...)):
    image_bytes = _validate_and_read_image(file)

    try:
        return _scan_back_cover_from_bytes(image_bytes)
    except ollama.ResponseError as e:
        raise HTTPException(status_code=502, detail=f"Ollama lỗi: {e.error}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ────────────────────────────────────────────────────────────────────────────────
# Smart Receiving AI — Receipt/Invoice OCR Scanning
# ────────────────────────────────────────────────────────────────────────────────

PROMPT_RECEIPT = (
    "Bạn là một chuyên gia nhập liệu kho sách cho hệ thống thư viện SmartBook. "
    "Nhìn vào hình ảnh hóa đơn / phiếu giao hàng / phiếu nhập kho này. "
    "Hãy trích xuất tất cả thông tin một cách chính xác nhất.\n\n"
    "YÊU CẦU ĐẦU RA:\n"
    "Trả về DUY NHẤT một JSON hợp lệ, không có markdown, không có giải thích, theo định dạng:\n\n"
    "{\n"
    '  "supplier_name": "...",\n'
    '  "invoice_number": "...",\n'
    '  "invoice_date": "YYYY-MM-DD",\n'
    '  "line_items": [\n'
    '    {\n'
    '      "title": "...",\n'
    '      "isbn": "...",\n'
    '      "quantity": số_nguyên,\n'
    '      "unit_price": số_thập_phân\n'
    '    }\n'
    '  ]\n'
    "}\n\n"
    "QUY TẮC:\n"
    "- supplier_name: tên nhà cung cấp (nếu không thấy ghi null)\n"
    "- invoice_number: số hóa đơn (nếu không thấy ghi null)\n"
    "- invoice_date: ngày tháng theo định dạng YYYY-MM-DD (nếu không thấy ghi null)\n"
    "- line_items: MẢNG các dòng sản phẩm, mỗi dòng gồm:\n"
    "  * title: tên sách (bắt buộc)\n"
    "  * isbn: mã ISBN (10 hoặc 13 số, có thể ghi null nếu không thấy)\n"
    "  * quantity: số lượng (số nguyên dương, mặc định 1 nếu không thấy)\n"
    "  * unit_price: đơn giá (số, có thể làm tròn, mặc định 0 nếu không thấy)\n"
    "- Nếu không trích xuất được gì, trả về {\"error\": \"Không thể đọc nội dung hóa đơn\"}\n"
    "- Đọc tất cả các dòng sản phẩm trong hóa đơn, không bỏ sót\n"
    "- Ưu tiên ISBN chuẩn (13 số bắt đầu bằng 978)"
)


def _scan_receipt_from_bytes(image_bytes: bytes) -> dict:
    """Extract structured data from receipt/invoice image using Ollama vision."""
    client = ollama.Client(host=OLLAMA_HOST)
    response = client.generate(
        model=OLLAMA_MODEL,
        prompt=PROMPT_RECEIPT,
        images=[image_bytes],
        options={"temperature": 0},
    )
    raw_text: str = response.get("response", "")

    # Try to parse JSON from response
    try:
        return json.loads(raw_text.strip())
    except json.JSONDecodeError:
        pass

    # Try to extract JSON from markdown code block
    import re
    block = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", raw_text, re.DOTALL)
    if block:
        try:
            return json.loads(block.group(1))
        except json.JSONDecodeError:
            pass

    # Try to find JSON object anywhere in text
    obj = re.search(r"\{[\s\S]*\}", raw_text)
    if obj:
        try:
            return json.loads(obj.group(0))
        except json.JSONDecodeError:
            pass

    return {"error": "Không thể trích xuất dữ liệu từ hình ảnh", "raw": raw_text}


@app.post("/scan-receipt")
async def scan_receipt(file: UploadFile = File(...)):
    """
    Trích xuất dữ liệu cấu trúc từ hình ảnh hóa đơn / phiếu giao hàng / phiếu nhập kho.
    Trả về: supplier_name, invoice_number, invoice_date, line_items[]
    """
    # Validate file type
    content_type = file.content_type or ""
    allowed_types = ["image/jpeg", "image/png", "image/webp", "application/pdf"]
    if not any(content_type.startswith(t) for t in allowed_types):
        raise HTTPException(
            status_code=400,
            detail=f"File type không hợp lệ. Chỉ chấp nhận: {', '.join(allowed_types)}"
        )

    image_bytes = _validate_and_read_image(file)

    try:
        result = _scan_receipt_from_bytes(image_bytes)

        # Validate response structure
        if "error" in result:
            return {
                "success": False,
                "error": result["error"],
                "raw": result.get("raw"),
            }

        # Normalize line_items
        line_items = result.get("line_items") or []
        normalized_items = []
        for item in line_items:
            normalized_item = {
                "title": item.get("title") or "Không rõ",
                "isbn": item.get("isbn"),
                "quantity": max(1, int(item.get("quantity") or 1)),
                "unit_price": float(item.get("unit_price") or 0),
            }
            normalized_items.append(normalized_item)

        return {
            "success": True,
            "supplier_name": result.get("supplier_name"),
            "invoice_number": result.get("invoice_number"),
            "invoice_date": result.get("invoice_date"),
            "line_items": normalized_items,
            "total_items": len(normalized_items),
        }

    except ollama.ResponseError as e:
        raise HTTPException(status_code=502, detail=f"Ollama lỗi: {e.error}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/recognize-book")
async def recognize_book(file: UploadFile = File(...)):
    image_bytes = _validate_and_read_image(file)

    try:
        return _recognize_book_from_bytes(image_bytes)

    except ollama.ResponseError as e:
        raise HTTPException(status_code=502, detail=f"Ollama lỗi: {e.error}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/analyze")
async def analyze(
    file: UploadFile | None = File(default=None),
    imageUrl: str | None = Form(default=None),
    type: str = Form(default="METADATA_EXTRACTION"),
):
    """
    Contract cho frontend legacy AI page.
    Trả về shape ổn định: { data, confidence, type }.
    """
    if file is None and imageUrl:
        raise HTTPException(
            status_code=400,
            detail="imageUrl hiện chưa được hỗ trợ, vui lòng gửi file ảnh.",
        )
    if file is None:
        raise HTTPException(status_code=400, detail="Thiếu file ảnh đầu vào.")

    image_bytes = _validate_and_read_image(file)
    try:
        book = _recognize_book_from_bytes(image_bytes)
        return {
            "data": {
                "title": book.get("title"),
                "author": book.get("author"),
                "isbn": book.get("isbn"),
                "publisher": book.get("publisher"),
            },
            "confidence": 0.8,
            "type": type,
        }
    except ollama.ResponseError as e:
        raise HTTPException(status_code=502, detail=f"Ollama lỗi: {e.error}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/extract-metadata")
async def extract_metadata(file: UploadFile = File(...)):
    """
    Kết hợp nhận diện bìa và quét mặt sau để trả metadata tối thiểu.
    """
    image_bytes = _validate_and_read_image(file)
    try:
        book = _recognize_book_from_bytes(image_bytes)
        back = _scan_back_cover_from_bytes(image_bytes)
        return {
            "title": book.get("title"),
            "author": book.get("author"),
            "isbn": back.get("isbn") or book.get("isbn"),
            "publisher": book.get("publisher"),
            "price": back.get("price"),
            "raw": {
                "recognize_book": book.get("raw"),
                "scan_back_cover": back.get("raw"),
            },
        }
    except ollama.ResponseError as e:
        raise HTTPException(status_code=502, detail=f"Ollama lỗi: {e.error}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/recommendations")
async def get_recommendations():
    """
    Contract tối thiểu ổn định để UI không bị 404 khi mở màn gợi ý.
    """
    return {
        "recommendations": [
            {
                "title": "Bổ sung đầu sách kỹ năng mềm",
                "description": "Nhu cầu mượn nhóm sách kỹ năng tăng trong 30 ngày gần đây.",
                "priority": "MEDIUM",
                "category": "Demand",
            },
            {
                "title": "Rà soát tồn kho sách công nghệ",
                "description": "Một số đầu sách công nghệ có tần suất mượn cao nhưng tồn thấp.",
                "priority": "HIGH",
                "category": "Inventory",
            },
        ]
    }


# ────────────────────────────────────────────────────────────────────────────────
# ISBN metadata lookup (Google Books + Open Library)
# ────────────────────────────────────────────────────────────────────────────────


class IsbnLookupRequest(BaseModel):
    isbn: str
    generateVietnameseSummary: bool = False


def _manual_entry_response(raw_isbn: str, normalized_isbn: str | None, reason: str) -> dict:
    return {
        "success": False,
        "found": False,
        "isbn": normalized_isbn or raw_isbn,
        "title": None,
        "subtitle": None,
        "authors": [],
        "publisher": None,
        "publishedDate": None,
        "description": None,
        "categories": [],
        "language": None,
        "pageCount": None,
        "thumbnail": None,
        "source": {
            "googleBooks": False,
            "openLibrary": False,
            "worldCat": False,
            "fahasa": False,
            "tiki": False,
            "vinabook": False,
            "webSearch": False,
            "aiSummary": "none",
        },
        "confidence": {
            "overall": 0.0,
            "googleBooks": 0.0,
            "openLibrary": 0.0,
            "worldCat": 0.0,
            "fahasa": 0.0,
            "tiki": 0.0,
            "vinabook": 0.0,
            "webSearch": 0.0,
        },
        "summaryVi": None,
        "keywords": [],
        "manualEntryRequired": True,
        "reason": reason,
    }


def _normalize_isbn(raw_isbn: str) -> str:
    cleaned = re.sub(r"[^0-9Xx]", "", str(raw_isbn or "").strip())
    if len(cleaned) == 10:
        return cleaned[:9] + cleaned[9].upper()
    return cleaned


def _is_valid_isbn10(isbn10: str) -> bool:
    if not re.fullmatch(r"\d{9}[\dX]", isbn10):
        return False
    total = 0
    for idx, char in enumerate(isbn10):
        value = 10 if char == "X" else int(char)
        total += (10 - idx) * value
    return total % 11 == 0


def _is_valid_isbn13(isbn13: str) -> bool:
    if not re.fullmatch(r"\d{13}", isbn13):
        return False
    total = 0
    for idx, char in enumerate(isbn13[:12]):
        total += int(char) * (1 if idx % 2 == 0 else 3)
    check_digit = (10 - (total % 10)) % 10
    return check_digit == int(isbn13[12])


def _isbn10_to_isbn13(isbn10: str) -> str:
    core = "978" + isbn10[:9]
    total = 0
    for idx, char in enumerate(core):
        total += int(char) * (1 if idx % 2 == 0 else 3)
    check_digit = (10 - (total % 10)) % 10
    return f"{core}{check_digit}"


def _isbn13_to_isbn10(isbn13: str) -> str | None:
    if not isbn13.startswith("978"):
        return None
    core = isbn13[3:12]
    total = 0
    for idx, char in enumerate(core):
        total += (10 - idx) * int(char)
    remainder = total % 11
    check = (11 - remainder) % 11
    check_char = "X" if check == 10 else str(check)
    return f"{core}{check_char}"


def _normalize_and_validate_isbn(raw_isbn: str) -> tuple[str | None, str | None, str | None]:
    normalized = _normalize_isbn(raw_isbn)
    if not normalized:
        return None, None, "isbn is required"

    if len(normalized) == 10:
        if not _is_valid_isbn10(normalized):
            return None, None, "invalid ISBN-10 checksum"
        return _isbn10_to_isbn13(normalized), normalized, None

    if len(normalized) == 13:
        if not _is_valid_isbn13(normalized):
            return None, None, "invalid ISBN-13 checksum"
        return normalized, _isbn13_to_isbn10(normalized), None

    return None, None, "isbn must be ISBN-10 or ISBN-13"


# ────────────────────────────────────────────────────────────────────────────────
# Marketplace lookup helpers (Fahasa / Tiki / Vinabook)
# ────────────────────────────────────────────────────────────────────────────────


# ── 1. JSON-LD parser ──────────────────────────────────────────────────────────

_JSON_LD_SCRIPT_RE = re.compile(
    r'<script[^>]+type=["\']application/ld\+json["\'][^>]*>(.*?)</script>',
    re.DOTALL | re.IGNORECASE,
)


def _parse_json_ld_product(html_text: str) -> dict | None:
    """Parse all JSON-LD blocks, return first Product/Book schema found."""
    for match in _JSON_LD_SCRIPT_RE.finditer(html_text):
        raw = match.group(1).strip()
        try:
            data = json.loads(raw)
        except (json.JSONDecodeError, ValueError) as exc:
            logger.debug("JSON-LD parse error (skipping block): %s", exc)
            continue

        items = data if isinstance(data, list) else [data]
        for item in items:
            if not isinstance(item, dict):
                continue
            item_type = item.get("@type", "")
            if isinstance(item_type, list):
                item_type = " ".join(item_type)
            if not any(t in item_type for t in ("Product", "Book")):
                continue

            name = (item.get("name") or "").strip() or None
            description = (item.get("description") or "").strip() or None
            if not name and not description:
                continue

            # image
            img = item.get("image")
            thumbnail = None
            if isinstance(img, str):
                thumbnail = img or None
            elif isinstance(img, dict):
                thumbnail = img.get("url") or img.get("contentUrl")
            elif isinstance(img, list) and img:
                thumbnail = img[0] if isinstance(img[0], str) else None

            # author
            author_raw = item.get("author") or item.get("creator")
            authors: list[str] = []
            if isinstance(author_raw, str):
                authors = [author_raw] if author_raw else []
            elif isinstance(author_raw, dict):
                n = (author_raw.get("name") or "").strip()
                if n:
                    authors = [n]
            elif isinstance(author_raw, list):
                for a in author_raw:
                    n = (a.get("name") if isinstance(a, dict) else a) or ""
                    n = str(n).strip()
                    if n:
                        authors.append(n)

            # publisher
            pub = item.get("publisher")
            publisher = None
            if isinstance(pub, str):
                publisher = pub.strip() or None
            elif isinstance(pub, dict):
                publisher = (pub.get("name") or "").strip() or None

            # isbn — may appear as isbn, gtin13, gtin14
            isbn_from_ld = None
            for isbn_key in ("isbn", "gtin13", "gtin14"):
                v = (item.get(isbn_key) or "").strip()
                if v:
                    isbn_from_ld = v
                    break

            num_pages = item.get("numberOfPages")
            page_count = num_pages if isinstance(num_pages, int) else None

            return {
                "title": name,
                "subtitle": None,
                "authors": authors,
                "publisher": publisher,
                "publishedDate": (item.get("datePublished") or "").strip() or None,
                "description": description,
                "categories": [],
                "language": (item.get("inLanguage") or "").strip() or None,
                "pageCount": page_count,
                "thumbnail": thumbnail,
                "_isbn_from_ld": isbn_from_ld,
            }
    return None


# ── 2. OpenGraph / meta parser ─────────────────────────────────────────────────

class _MetaTagParser(HTMLParser):
    """Lightweight parser for og:title, og:description, og:image, description meta."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.og_title: str | None = None
        self.og_description: str | None = None
        self.og_image: str | None = None
        self.meta_description: str | None = None
        self._done = False

    def handle_starttag(self, tag, attrs):
        if self._done or tag != "meta":
            return
        attr_dict = dict(attrs)
        prop = (attr_dict.get("property") or attr_dict.get("name") or "").strip()
        content = _html_module.unescape(attr_dict.get("content") or "").strip()
        if prop == "og:title" and not self.og_title:
            self.og_title = content or None
        elif prop == "og:description" and not self.og_description:
            self.og_description = content or None
        elif prop == "og:image" and not self.og_image:
            self.og_image = content or None
        elif prop == "description" and not self.meta_description:
            self.meta_description = content or None
        # Stop iterating after all 4 fields are found
        if all([self.og_title, self.og_description, self.og_image, self.meta_description]):
            self._done = True


def _parse_meta_product(html_text: str) -> dict | None:
    """Parse OpenGraph and standard meta tags from an HTML page."""
    parser = _MetaTagParser()
    try:
        parser.feed(html_text)
    except Exception:
        pass  # HTMLParser can raise on malformed HTML; partial results are fine

    title = parser.og_title
    description = parser.og_description or parser.meta_description
    image = parser.og_image

    if not title and not description:
        return None

    return {
        "title": title,
        "subtitle": None,
        "authors": [],
        "publisher": None,
        "publishedDate": None,
        "description": description,
        "categories": [],
        "language": None,
        "pageCount": None,
        "thumbnail": image,
    }


# ── 3. Fetch + parse a single product URL ─────────────────────────────────────

async def _fetch_and_parse_product_page(
    client: httpx.AsyncClient,
    url: str,
    source_name: str,
    search_code: str | None = None,
) -> tuple[dict | None, float]:
    """
    Fetch a product page and extract metadata via JSON-LD then OpenGraph fallback.
    If search_code is provided, the page must contain that code to be accepted —
    this prevents using metadata from an unrelated book that DuckDuckGo matched by URL.
    """
    try:
        response = await client.get(
            url,
            headers={
                "User-Agent": BOOK_LOOKUP_USER_AGENT,
                "Accept-Language": "vi-VN,vi;q=0.9,en;q=0.8",
            },
            follow_redirects=True,
        )
        response.raise_for_status()
        html_text = response.text
    except Exception as exc:
        logger.warning("Marketplace fetch failed [%s] %s: %s", source_name, url, exc)
        return None, 0.0

    # Verify the searched code actually appears in the page HTML before trusting metadata
    if search_code and search_code not in html_text:
        logger.debug("Marketplace [%s] page does not contain code %s, skipping %s", source_name, search_code, url)
        return None, 0.0

    metadata = _parse_json_ld_product(html_text) or _parse_meta_product(html_text)
    if not metadata:
        logger.debug("Marketplace [%s] no parseable metadata from %s", source_name, url)
        return None, 0.0

    # _metadata_completeness_score is defined later in this file but used here —
    # safe because this function is only called at runtime, not at import time.
    score = _metadata_completeness_score(metadata)
    logger.info("Marketplace [%s] found metadata score=%.3f from %s", source_name, score, url)
    return metadata, score


async def _fetch_first_valid(
    client: httpx.AsyncClient,
    urls: list[str],
    source_name: str,
    search_code: str | None = None,
) -> tuple[dict | None, float]:
    """Try each URL in order; for Fahasa, fall back to CloakBrowser when httpx fails.
    If all DDGS URLs are exhausted with no result, do a final browser-based Fahasa
    search to discover the real product URL via the internal Elastic search API."""
    for url in urls[:2]:
        metadata, score = await _fetch_and_parse_product_page(client, url, source_name, search_code)
        if metadata:
            metadata["sourceUrl"] = url
            metadata["sourceProvider"] = source_name
            metadata["sourceFetchMode"] = "httpx"

            # Fahasa httpx usually only gets title/description/thumbnail from og: tags,
            # missing authors/publisher/year. Enhance with DOM extraction on the same URL.
            if source_name == "fahasa" and ENABLE_FAHA_CLOAKBROWSER and not metadata.get("authors"):
                dom = await _fahasa_enhance_metadata(url)
                if dom:
                    for field in ("authors", "publisher", "publishedDate", "pageCount", "language"):
                        if not metadata.get(field) and dom.get(field):
                            metadata[field] = dom[field]
                    dom_desc = dom.get("description")
                    http_desc = metadata.get("description") or ""
                    if dom_desc:
                        # Always prefer DOM description — it's cleaned and from #desc_content,
                        # whereas httpx og:description often has title repetition prepended.
                        metadata["description"] = dom_desc
                    elif http_desc:
                        metadata["description"] = _clean_fahasa_description(http_desc, metadata.get("title")) or http_desc
                    if dom.get("thumbnail") and not metadata.get("thumbnail"):
                        metadata["thumbnail"] = dom.get("thumbnail")
                    metadata["sourceFetchMode"] = "httpx+cloakbrowser"
                    score = _metadata_completeness_score(metadata)

            return metadata, score

        if source_name == "fahasa" and ENABLE_FAHA_CLOAKBROWSER:
            metadata, score = await _fetch_and_parse_product_page_with_browser(
                url,
                source_name,
                search_code,
            )
            if metadata:
                return metadata, score

    # Last resort: use CloakBrowser to search Fahasa and extract metadata in one session
    if source_name == "fahasa" and ENABLE_FAHA_CLOAKBROWSER and search_code:
        discovered_url, dom_meta = await _fahasa_discover_url_via_browser(search_code)
        if discovered_url:
            logger.info("Fahasa browser search found URL for %s: %s", search_code, discovered_url)
            if dom_meta and (dom_meta.get("title") or dom_meta.get("description")):
                metadata = {
                    "title": dom_meta.get("title"),
                    "subtitle": None,
                    "authors": dom_meta.get("authors") or [],
                    "publisher": dom_meta.get("publisher"),
                    "publishedDate": dom_meta.get("publishedDate"),
                    "description": dom_meta.get("description"),
                    "categories": [],
                    "language": dom_meta.get("language") or "vi",
                    "pageCount": dom_meta.get("pageCount"),
                    "thumbnail": dom_meta.get("thumbnail"),
                    "sourceUrl": discovered_url,
                    "sourceProvider": source_name,
                    "sourceFetchMode": "cloakbrowser",
                }
                score = _metadata_completeness_score(metadata)
                logger.info(
                    "Browser marketplace [%s] found metadata score=%.3f from %s",
                    source_name, score, discovered_url,
                )
                return metadata, score
            # dom_meta empty or no useful fields → fallback to HTML-based parse
            metadata, score = await _fetch_and_parse_product_page_with_browser(
                discovered_url, source_name, search_code,
            )
            if metadata:
                return metadata, score

    return None, 0.0


# ── CloakBrowser fallback (Fahasa only) ────────────────────────────────────────

def _fetch_html_with_cloakbrowser(url: str, search_code: str | None = None) -> str | None:
    browser = None
    try:
        from cloakbrowser import launch

        browser = launch(headless=True)
        page = browser.new_page()
        page.goto(
            url,
            wait_until="domcontentloaded",
            timeout=int(BOOK_BROWSER_TIMEOUT_SECONDS * 1000),
        )
        page.wait_for_timeout(1200)
        html_text = page.content()

        if search_code and search_code not in html_text:
            logger.debug(
                "CloakBrowser page does not contain code %s, skipping %s",
                search_code,
                url,
            )
            return None

        return html_text

    except Exception as exc:
        logger.warning("CloakBrowser fetch failed %s: %s", url, exc)
        return None

    finally:
        if browser:
            try:
                browser.close()
            except Exception:
                pass


async def _fetch_and_parse_product_page_with_browser(
    url: str,
    source_name: str,
    search_code: str | None = None,
) -> tuple[dict | None, float]:
    html_text = await asyncio.to_thread(_fetch_html_with_cloakbrowser, url, search_code)

    if not html_text:
        return None, 0.0

    metadata = _parse_json_ld_product(html_text) or _parse_meta_product(html_text)
    if not metadata:
        logger.debug("Browser marketplace [%s] no metadata from %s", source_name, url)
        return None, 0.0

    metadata["sourceUrl"] = url
    metadata["sourceProvider"] = source_name
    metadata["sourceFetchMode"] = "cloakbrowser"

    score = _metadata_completeness_score(metadata)
    logger.info(
        "Browser marketplace [%s] found metadata score=%.3f from %s",
        source_name,
        score,
        url,
    )
    return metadata, score


def _evaluate_fahasa_product_metadata(page) -> dict:
    """
    Run JavaScript in a rendered Fahasa product page to extract book metadata
    from the DOM. Uses multiple selector fallbacks for each field.
    Returns a (possibly partial) dict — caller must handle empty/None values.
    """
    try:
        data = page.evaluate("""() => {
            const h1 = document.querySelector('h1.page-title span')
                    || document.querySelector('h1.page-title')
                    || document.querySelector('h1[itemprop="name"]')
                    || document.querySelector('h1');
            let title = h1 ? h1.innerText.trim() : null;
            if (!title) {
                title = document.title
                    .replace(/ - FAHASA\\.COM$/i, '')
                    .replace(/^Sách\\s+/i, '')
                    .trim() || null;
            }

            const allImgs = Array.from(document.querySelectorAll('img'));
            const coverImg = allImgs.find(img =>
                img.src && img.src.includes('cdn1.fahasa.com/media/catalog/product')
            );
            const thumbnail = coverImg ? coverImg.src : null;

            const descEl = document.querySelector('#desc_content')
                        || document.querySelector('#product_tabs_description_contents')
                        || document.querySelector('.product-description .value')
                        || document.querySelector('#description .std')
                        || document.querySelector('[itemprop="description"]')
                        || document.querySelector('.product.description .value')
                        || document.querySelector('.product-info-description p');
            const description = descEl ? descEl.innerText.trim() || null : null;

            const attrs = {};
            const rows = document.querySelectorAll(
                '.product-attribute, .product-info-attributes tr, ' +
                'table.data.additional-attributes tr, .attributes-table tr, table tr'
            );
            rows.forEach(row => {
                const labelEl = row.querySelector('.attribute-label, th, td:first-child, .label');
                const valueEl = row.querySelector('.attribute-value, td:last-child, .value');
                if (labelEl && valueEl) {
                    const lbl = labelEl.innerText.trim().toLowerCase();
                    const val = valueEl.innerText.trim();
                    if (lbl && val) attrs[lbl] = val;
                }
            });

            return { title, thumbnail, description, attrs };
        }""")
    except Exception:
        return {}

    if not isinstance(data, dict):
        return {}

    attrs = data.get("attrs") or {}
    authors: list[str] = []
    publisher = None
    published_date = None
    page_count = None
    language = None

    for lbl, val in attrs.items():
        if not val:
            continue
        lbl_lower = lbl.lower()
        if any(k in lbl_lower for k in ("tác giả", "tac gia", "author")):
            authors = [v.strip() for v in val.replace(";", ",").split(",") if v.strip()]
        elif any(k in lbl_lower for k in ("nhà xuất bản", "nha xuat ban", "nxb", "publisher")):
            publisher = val.strip() or None
        elif any(k in lbl_lower for k in ("năm xb", "năm xuất bản", "nam xuat ban", "ngày xuất bản", "year")):
            published_date = val.strip() or None
        elif any(k in lbl_lower for k in ("số trang", "so trang", "page")):
            try:
                page_count = int("".join(filter(str.isdigit, val))) or None
            except (ValueError, TypeError):
                pass
        elif any(k in lbl_lower for k in ("ngôn ngữ", "ngon ngu", "language")):
            raw_lang = val.strip().lower()
            if "việt" in raw_lang or "viet" in raw_lang:
                language = "vi"
            elif "anh" in raw_lang or "english" in raw_lang:
                language = "en"
            else:
                language = val.strip() or None

    raw_desc = data.get("description")
    clean_desc = _clean_fahasa_description(raw_desc, data.get("title"))

    return {
        "title": data.get("title"),
        "thumbnail": data.get("thumbnail"),
        "description": clean_desc,
        "authors": authors,
        "publisher": publisher,
        "publishedDate": published_date,
        "pageCount": page_count,
        "language": language,
    }


def _clean_fahasa_description(desc: str | None, title: str | None) -> str | None:
    """Strip leading lines that repeat the book title from Fahasa description.
    Checks both directions: title fragment in line, and line fragment in title —
    because Fahasa h1 sometimes has a 'Bộ ' prefix not present in #desc_content.
    """
    if not desc:
        return desc
    title_lower = (title or "").strip().lower()
    title_fragment = title_lower[:30]
    lines = desc.split("\n")
    start = 0
    for i, line in enumerate(lines):
        stripped = line.strip()
        if not stripped:
            start = i + 1
            continue
        stripped_lower = stripped.lower()
        stripped_fragment = stripped_lower[:40]
        is_title_line = (
            (title_fragment and title_fragment in stripped_lower)
            or (stripped_fragment and title_lower and stripped_fragment in title_lower)
        )
        if is_title_line:
            start = i + 1
        else:
            break
    cleaned = "\n".join(lines[start:]).strip()
    return cleaned or desc


def _fahasa_enhance_metadata_sync(product_url: str) -> dict:
    """Load a known Fahasa product URL and extract full metadata via DOM evaluation."""
    browser = None
    try:
        from cloakbrowser import launch

        browser = launch(headless=True)
        page = browser.new_page()
        page.goto(
            product_url,
            wait_until="domcontentloaded",
            timeout=int(BOOK_BROWSER_TIMEOUT_SECONDS * 1000),
        )
        page.wait_for_timeout(1500)
        return _evaluate_fahasa_product_metadata(page)
    except Exception as exc:
        logger.warning("Fahasa metadata enhancement failed %s: %s", product_url, exc)
        return {}
    finally:
        if browser:
            try:
                browser.close()
            except Exception:
                pass


async def _fahasa_enhance_metadata(product_url: str) -> dict:
    return await asyncio.to_thread(_fahasa_enhance_metadata_sync, product_url)


def _fahasa_discover_url_sync(barcode: str) -> tuple[str | None, dict]:
    """
    Load Fahasa search page via CloakBrowser, intercept the internal Elastic search
    API response to find the product URL, then navigate to that page and extract
    metadata via DOM evaluation — all in one browser session.
    Sync — must be called via asyncio.to_thread.
    """
    browser = None
    try:
        from cloakbrowser import launch

        browser = launch(headless=True)
        page = browser.new_page()
        found_url: list[str] = []

        def _on_response(resp):
            if found_url:
                return
            if "elsearch" in resp.url and "search.json" in resp.url:
                try:
                    data = resp.json()
                    for result in data.get("results") or []:
                        sku = str((result.get("sku") or {}).get("raw", "")).strip()
                        if sku == barcode:
                            link = str((result.get("link") or {}).get("raw", "")).strip()
                            if link:
                                found_url.append("https://www.fahasa.com" + link)
                                return
                except Exception:
                    pass

        page.on("response", _on_response)
        page.goto(
            f"https://www.fahasa.com/catalogsearch/result/?q={barcode}",
            wait_until="networkidle",
            timeout=int(BOOK_BROWSER_TIMEOUT_SECONDS * 1000),
        )
        page.wait_for_timeout(1000)

        if not found_url:
            return None, {}

        product_url = found_url[0]

        # Navigate to product page in the same browser session to extract metadata
        page2 = browser.new_page()
        dom_meta: dict = {}
        try:
            page2.goto(
                product_url,
                wait_until="domcontentloaded",
                timeout=int(BOOK_BROWSER_TIMEOUT_SECONDS * 1000),
            )
            page2.wait_for_timeout(1500)

            dom_meta = _evaluate_fahasa_product_metadata(page2)

            # Fallback: extract title from <title> tag if DOM gave nothing
            if not dom_meta.get("title"):
                html = page2.content()
                m = re.search(r"<title>(.*?)</title>", html, re.IGNORECASE)
                if m:
                    raw_title = m.group(1)
                    raw_title = re.sub(r"\s*-\s*FAHASA\.COM\s*$", "", raw_title, flags=re.IGNORECASE).strip()
                    raw_title = re.sub(r"^Sách\s+", "", raw_title, flags=re.IGNORECASE).strip()
                    if raw_title:
                        dom_meta["title"] = raw_title

            # Fallback: extract CDN thumbnail from raw HTML if DOM gave nothing
            if not dom_meta.get("thumbnail"):
                html = page2.content()
                m = re.search(
                    r"(https://cdn1\.fahasa\.com/media/catalog/product/[^\s\"']+\.(?:jpg|jpeg|png|webp))",
                    html,
                    re.IGNORECASE,
                )
                if m:
                    dom_meta["thumbnail"] = m.group(1)

        except Exception as exc:
            logger.warning("Fahasa product page extraction failed %s: %s", product_url, exc)
        finally:
            try:
                page2.close()
            except Exception:
                pass

        return product_url, dom_meta

    except Exception as exc:
        logger.warning("Fahasa browser search failed for %s: %s", barcode, exc)
        return None, {}

    finally:
        if browser:
            try:
                browser.close()
            except Exception:
                pass


async def _fahasa_discover_url_via_browser(barcode: str) -> tuple[str | None, dict]:
    return await asyncio.to_thread(_fahasa_discover_url_sync, barcode)


# ── 4. DuckDuckGo search (sync — each domain runs in its own thread) ─────────

def _ddgs_search_one_domain(code: str, domain: str, max_results: int) -> list[str]:
    """Search DuckDuckGo for a single domain. Sync — runs via asyncio.to_thread."""
    urls: list[str] = []
    try:
        from ddgs import DDGS
        query = f"{code} site:{domain}"
        with DDGS() as ddgs:
            results = list(ddgs.text(query, max_results=max_results))
            for r in results:
                url = r.get("href", "")
                if domain in url and url not in urls:
                    urls.append(url)
    except Exception as exc:
        logger.warning("DDGS query '%s site:%s' failed: %s", code, domain, exc)
    return urls


# ── 5. Tiki direct API ────────────────────────────────────────────────────────

async def _fetch_tiki_by_isbn_api(
    client: httpx.AsyncClient,
    isbn: str,
) -> tuple[dict | None, float]:
    """
    Query Tiki's public product search API.
    Tiki stores ISBN as the product SKU, so we match on sku == isbn.
    We also fetch the full product detail to get description.
    """
    logger.info("Calling tiki-api for ISBN %s", isbn)
    try:
        resp = await client.get(
            "https://tiki.vn/api/v2/products",
            params={"q": isbn, "limit": 5, "category": 8322},
            headers={"User-Agent": BOOK_LOOKUP_USER_AGENT},
        )
        resp.raise_for_status()
        data = resp.json() or {}
        items = data.get("data") or []
        for item in items:
            sku = (item.get("sku") or item.get("master_product_sku") or "").strip()
            name = (item.get("name") or "").strip()
            # Accept only if SKU exactly matches our ISBN (most reliable check)
            if sku != isbn:
                continue
            thumbnail = item.get("thumbnail_url") or None
            product_id = item.get("id")
            # Fetch full product detail for description
            description = None
            if product_id:
                try:
                    detail_resp = await client.get(
                        f"https://tiki.vn/api/v2/products/{product_id}",
                        headers={"User-Agent": BOOK_LOOKUP_USER_AGENT},
                    )
                    detail_resp.raise_for_status()
                    detail = detail_resp.json() or {}
                    description = _safe_text(detail.get("description") or detail.get("short_description"))
                    # Authors and publisher from specifications
                    specs = detail.get("specifications") or []
                    authors_text, publisher_text = None, None
                    for spec_group in specs:
                        for attr in (spec_group.get("attributes") or []):
                            code = attr.get("code", "")
                            val = _safe_text(attr.get("value"))
                            if code in ("author", "tac_gia") and val:
                                authors_text = val
                            elif code in ("publisher", "nha_xuat_ban") and val:
                                publisher_text = val
                except Exception:
                    pass

            metadata = {
                "title": name or None,
                "subtitle": None,
                "authors": [authors_text] if authors_text else [],
                "publisher": publisher_text,
                "publishedDate": None,
                "description": description,
                "categories": [],
                "language": "vi",
                "pageCount": None,
                "thumbnail": thumbnail,
            }
            score = _metadata_completeness_score(metadata)
            logger.info("tiki-api returned data, score=%.3f for ISBN %s", score, isbn)
            return metadata, score
    except Exception as exc:
        logger.warning("Tiki API lookup failed for %s: %s", isbn, exc)
    return None, 0.0


# ── 6. Orchestrate all marketplace providers ──────────────────────────────────

async def _fetch_all_marketplace(
    isbn13: str,
    isbn10: str | None,
) -> tuple[dict | None, float, dict | None, float, dict | None, float, bool]:
    """
    Run Fahasa (DDGS+scrape), Tiki (API), Vinabook (DDGS+scrape) in parallel.
    Returns: (fahasa_data, fahasa_score, tiki_data, tiki_score, vinabook_data, vinabook_score, web_searched)
    """
    # Step 1: DuckDuckGo search for Fahasa + Vinabook URLs (Tiki handled via API)
    # Run both DDGS queries in parallel threads — each in its own thread so total
    # time = max(fahasa_query, vinabook_query) instead of sum.
    fahasa_urls: list[str] = []
    vinabook_urls: list[str] = []
    try:
        ddgs_results = await asyncio.wait_for(
            asyncio.gather(
                asyncio.to_thread(_ddgs_search_one_domain, isbn13, "fahasa.com", BOOK_LOOKUP_MAX_WEB_RESULTS),
                asyncio.to_thread(_ddgs_search_one_domain, isbn13, "vinabook.com", BOOK_LOOKUP_MAX_WEB_RESULTS),
                return_exceptions=True,
            ),
            timeout=9.0,
        )
        if not isinstance(ddgs_results[0], Exception):
            fahasa_urls = ddgs_results[0]
        if not isinstance(ddgs_results[1], Exception):
            vinabook_urls = ddgs_results[1]
    except asyncio.TimeoutError:
        logger.warning("DuckDuckGo marketplace search timed out for ISBN %s", isbn13)
    except Exception as exc:
        logger.warning("DuckDuckGo marketplace search error for ISBN %s: %s", isbn13, exc)

    web_searched = bool(fahasa_urls or vinabook_urls)

    # Step 2: Fetch pages + Tiki API in parallel
    mp_timeout = httpx.Timeout(BOOK_MARKETPLACE_TIMEOUT_SECONDS)
    async with httpx.AsyncClient(timeout=mp_timeout) as client:
        logger.info("Calling marketplace providers for ISBN %s", isbn13)
        results = await asyncio.gather(
            _fetch_first_valid(client, fahasa_urls, "fahasa", isbn13),
            _fetch_tiki_by_isbn_api(client, isbn13),
            _fetch_first_valid(client, vinabook_urls, "vinabook", isbn13),
            return_exceptions=True,
        )

    def _safe_unpack(r):
        return r if not isinstance(r, Exception) else (None, 0.0)

    fahasa_data, fahasa_score = _safe_unpack(results[0])
    tiki_data, tiki_score = _safe_unpack(results[1])
    vinabook_data, vinabook_score = _safe_unpack(results[2])

    return fahasa_data, fahasa_score, tiki_data, tiki_score, vinabook_data, vinabook_score, web_searched


# ── 7. Merge marketplace data into base metadata ─────────────────────────────

def _merge_with_marketplace(
    base: dict,
    fahasa: dict | None,
    tiki: dict | None,
    vinabook: dict | None,
) -> dict:
    """
    Fill missing fields in base from marketplace sources.
    Marketplace is lower priority — only fills gaps, never overwrites existing values.
    """
    result = dict(base)
    for src in [fahasa, tiki, vinabook]:
        if not src:
            continue
        for field in ("title", "publisher", "publishedDate", "language", "pageCount"):
            if not result.get(field) and src.get(field):
                result[field] = src[field]
        if not result.get("authors") and src.get("authors"):
            result["authors"] = src["authors"]
        if not result.get("description") and src.get("description"):
            result["description"] = src["description"]
        if not result.get("thumbnail") and src.get("thumbnail"):
            result["thumbnail"] = src["thumbnail"]
    return result


# ── 8. Standard lookups extracted as helper ───────────────────────────────────

async def _run_standard_lookups(isbn13: str, isbn10: str | None) -> list:
    """Run Google Books, Open Library (and optionally WorldCat) in parallel."""
    timeout = httpx.Timeout(BOOK_LOOKUP_TIMEOUT_SECONDS)
    headers = {"User-Agent": BOOK_LOOKUP_USER_AGENT}
    async with httpx.AsyncClient(timeout=timeout, headers=headers) as client:
        tasks: list = [
            _fetch_google_books_by_isbn(client, isbn13),
            _fetch_open_library_by_isbn(client, isbn13, isbn10),
        ]
        if ENABLE_WORLDCAT_LOOKUP:
            tasks.append(_fetch_worldcat_by_isbn(client, isbn13, isbn10))
        return await asyncio.gather(*tasks, return_exceptions=True)


def _safe_text(value) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _safe_list(values) -> list[str]:
    if not isinstance(values, list):
        return []
    out = []
    for value in values:
        text = _safe_text(value)
        if text:
            out.append(text)
    return out


def _ollama_generate_with_summary_fallback(client: ollama.Client, prompt: str, options: dict | None = None):
    """Generate with SUMMARY_MODEL, then fallback to OLLAMA_MODEL if summary model is missing."""
    summary_model = os.getenv("SUMMARY_MODEL", os.getenv("OLLAMA_MODEL", "llava"))
    fallback_model = os.getenv("OLLAMA_MODEL", "llava")
    opts = options or {}

    try:
        return client.generate(
            model=summary_model,
            prompt=prompt,
            options=opts,
        )
    except ollama.ResponseError as exc:
        err_text = str(getattr(exc, "error", exc) or "").lower()
        if "not found" in err_text and fallback_model and fallback_model != summary_model:
            logger.warning(
                "SUMMARY_MODEL '%s' not found. Falling back to OLLAMA_MODEL '%s'.",
                summary_model,
                fallback_model,
            )
            return client.generate(
                model=fallback_model,
                prompt=prompt,
                options=opts,
            )
        raise


def _anthropic_extract_text(payload: dict) -> str:
    content = payload.get("content") or []
    parts: list[str] = []
    for item in content:
        if isinstance(item, dict) and item.get("type") == "text":
            parts.append(str(item.get("text", "")))
        elif isinstance(item, str):
            parts.append(item)
    return "".join(parts).strip()


def _split_anthropic_messages(messages: list[dict]) -> tuple[str, list[dict]]:
    system_parts: list[str] = []
    filtered: list[dict] = []
    for msg in messages:
        role = msg.get("role")
        content = msg.get("content", "")
        if role == "system":
            if content:
                system_parts.append(content)
            continue
        if role in {"user", "assistant"}:
            filtered.append({"role": role, "content": content})
    return "\n\n".join(system_parts).strip(), filtered


async def _call_anthropic(metadata: dict) -> tuple[str | None, list[str], bool]:
    """
    Gọi Anthropic Claude để sinh summaryVi + keywords.
    Trả về (summary_vi, keywords, success).
    Chỉ gọi khi ANTHROPIC_API_KEY đã được set.
    """
    if not ANTHROPIC_API_KEY:
        return None, [], False

    title = _safe_text(metadata.get("title")) or "Không rõ"
    authors = _safe_list(metadata.get("authors"))
    author_text = authors[0] if authors else "Không rõ"
    publisher_text = _safe_text(metadata.get("publisher")) or ""
    categories = _safe_list(metadata.get("categories"))
    category_text = ", ".join(categories[:3]) if categories else "không rõ"
    description_hint = (_safe_text(metadata.get("description")) or "")[:1200]

    system_prompt = (
        "Bạn là biên tập viên nội dung sách cho một nhà sách online Việt Nam. "
        "Nhiệm vụ của bạn là viết mô tả sách hấp dẫn, tự nhiên, đáng tin cậy, "
        "dùng để hiển thị trên trang chi tiết sản phẩm. "
        "Văn phong giống mô tả sách trên Fahasa/Tiki/Nhã Nam: giàu cảm xúc vừa đủ, "
        "có tính giới thiệu, làm nổi bật giá trị của sách, "
        "nhưng tuyệt đối không bịa thông tin."
    )

    user_prompt = f"""Dữ liệu sách:
- Tên sách: {title}
- Tác giả: {author_text}
- Nhà xuất bản: {publisher_text or 'không rõ'}
- Thể loại: {category_text}
- Mô tả gốc/metadata: {description_hint or 'không có'}

Hãy viết mô tả tiếng Việt theo yêu cầu:
1. Độ dài khoảng 180–280 từ.
2. Viết thành 3–5 đoạn ngắn, dễ đọc trên giao diện web.
3. Đoạn mở đầu phải cuốn hút, giới thiệu tinh thần chính của cuốn sách.
4. Các đoạn sau làm rõ nội dung/chủ đề/giá trị mà người đọc có thể nhận được.
5. Có một đoạn hoặc cụm câu gợi ý nhóm độc giả phù hợp.
6. Có thể dùng tiêu đề ngắn như "Vì sao nên đọc cuốn sách này?" nếu phù hợp.
7. Không dùng markdown code block.
8. Không bịa nhân vật, tình tiết, giải thưởng, số liệu, tên chương hoặc nội dung cụ thể nếu dữ liệu không cung cấp.
9. Nếu metadata ít, hãy viết an toàn dựa trên tên sách, tác giả và thể loại; không phóng đại.
10. Tránh các câu sáo rỗng như "cuốn sách đáng chú ý", "mở ra góc nhìn sâu sắc", "phù hợp nhiều đối tượng" nếu không giải thích cụ thể.

Trả về DUY NHẤT JSON hợp lệ:
{{
  "summaryVi": "...",
  "keywords": ["...", "...", "...", "...", "..."]
}}"""

    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(25.0)) as http_client:
            resp = await http_client.post(
                f"{ANTHROPIC_BASE_URL}/messages",
                headers={
                    "Content-Type": "application/json",
                    "x-api-key": ANTHROPIC_API_KEY,
                    "anthropic-version": "2023-06-01",
                },
                json={
                    "model": ANTHROPIC_MODEL,
                    "system": system_prompt,
                    "messages": [{"role": "user", "content": user_prompt}],
                    "temperature": 0.55,
                    "max_tokens": 900,
                },
            )
            resp.raise_for_status()
            raw = _anthropic_extract_text(resp.json())

            parsed = _extract_json(raw)
            summary_vi = _safe_text(parsed.get("summaryVi"))
            keywords = _safe_list(parsed.get("keywords"))

            # Fallback: model không trả JSON, lấy raw text
            if not summary_vi and raw.strip() and not raw.strip().startswith("{"):
                summary_vi = raw.strip()

            return summary_vi, keywords, bool(summary_vi)
    except Exception as exc:
        logger.warning("Anthropic call failed: %s", exc)
        return None, [], False


async def _call_anthropic_json(system_prompt: str, user_prompt: str, max_tokens: int = 600) -> tuple[dict, bool]:
    """Generic Anthropic call returning parsed JSON dict. Parse via _extract_json (no json_object mode)."""
    if not ANTHROPIC_API_KEY:
        return {}, False
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(25.0)) as client:
            resp = await client.post(
                f"{ANTHROPIC_BASE_URL}/messages",
                headers={
                    "Content-Type": "application/json",
                    "x-api-key": ANTHROPIC_API_KEY,
                    "anthropic-version": "2023-06-01",
                },
                json={
                    "model": ANTHROPIC_MODEL,
                    "system": system_prompt,
                    "messages": [{"role": "user", "content": user_prompt}],
                    "temperature": 0.3,
                    "max_tokens": max_tokens,
                },
            )
            resp.raise_for_status()
            raw = _anthropic_extract_text(resp.json())
            return _extract_json(raw), True
    except Exception as e:
        logger.warning("Anthropic JSON call failed: %s", e)
        return {}, False


async def _call_ollama_json(system_prompt: str, user_prompt: str) -> tuple[dict, bool]:
    """Generic Ollama call returning parsed JSON dict. Reuses _ollama_generate_with_summary_fallback."""
    try:
        client = ollama.Client(host=OLLAMA_HOST)
        full_prompt = f"{system_prompt}\n\n{user_prompt}"
        response = await asyncio.to_thread(
            _ollama_generate_with_summary_fallback,
            client,
            full_prompt,
            {"temperature": 0.3, "num_predict": 600},
        )
        raw = response.get("response", "")
        return _extract_json(raw), True
    except Exception as e:
        logger.warning("Ollama JSON call failed: %s", e)
        return {}, False


def _check_book_quality(
    title: str,
    authors: list[str],
    publisher: str | None,
    description: str | None,
    categories: list[str],
) -> list[str]:
    """Rule-based quality checks for book metadata. No AI needed."""
    warnings = []
    if not authors:
        warnings.append("Thiếu thông tin tác giả")
    if not publisher:
        warnings.append("Thiếu thông tin nhà xuất bản")
    if not categories:
        warnings.append("Thiếu thể loại sách")
    if not description:
        warnings.append("Mô tả sách còn trống")
    else:
        desc = description.strip()
        if len(desc) < 80:
            warnings.append(f"Mô tả quá ngắn ({len(desc)} ký tự, nên có ít nhất 80 ký tự)")
        if re.search(r"<[^>]+>", desc):
            warnings.append("Mô tả chứa thẻ HTML cần loại bỏ")
        if re.search(r"[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]", desc):
            warnings.append("Mô tả chứa ký tự rác (control characters)")
        vi_chars = set("àáâãèéêìíòóôõùúưăđÀÁÂÃÈÉÊÌÍÒÓÔÕÙÚƯĂĐ")
        if len(desc) > 50 and not any(c in vi_chars for c in desc):
            warnings.append("Mô tả có thể không phải tiếng Việt hoặc đang thiếu dấu tiếng Việt")
    return warnings


def _metadata_completeness_score(data: dict) -> float:
    weighted = {
        "title": 2.0,
        "authors": 2.0,
        "publisher": 1.0,
        "publishedDate": 1.0,
        "description": 1.5,
        "categories": 0.5,
        "language": 0.5,
        "pageCount": 1.0,
        "thumbnail": 0.5,
    }
    total_weight = sum(weighted.values())
    score = 0.0
    for key, weight in weighted.items():
        value = data.get(key)
        if isinstance(value, list):
            if len(value) > 0:
                score += weight
        elif value not in (None, ""):
            score += weight
    return round(score / total_weight, 3) if total_weight else 0.0


def _parse_google_books_item(item: dict) -> dict:
    volume_info = item.get("volumeInfo") or {}
    image_links = volume_info.get("imageLinks") or {}
    return {
        "title": _safe_text(volume_info.get("title")),
        "subtitle": _safe_text(volume_info.get("subtitle")),
        "authors": _safe_list(volume_info.get("authors")),
        "publisher": _safe_text(volume_info.get("publisher")),
        "publishedDate": _safe_text(volume_info.get("publishedDate")),
        "description": _safe_text(volume_info.get("description")),
        "categories": _safe_list(volume_info.get("categories")),
        "language": _safe_text(volume_info.get("language")),
        "pageCount": volume_info.get("pageCount") if isinstance(volume_info.get("pageCount"), int) else None,
        "thumbnail": _safe_text(image_links.get("thumbnail") or image_links.get("smallThumbnail")),
    }


def _open_library_structured_text_field(raw) -> str | None:
    """Mô tả / first_sentence trên OL có thể là chuỗi hoặc {'type': ..., 'value': '...'}."""
    if raw is None:
        return None
    if isinstance(raw, str):
        return _safe_text(raw)
    if isinstance(raw, dict):
        return _safe_text(raw.get("value"))
    return None


async def _fetch_open_library_description_via_json(
    client: httpx.AsyncClient,
    edition_key: str | None,
) -> str | None:
    """
    /api/books?jscmd=data thường không trả description; cần đọc edition .json rồi work .json.
    """
    if not edition_key or not str(edition_key).startswith("/books/"):
        return None
    edition_url = f"{OPEN_LIBRARY_SITE_ORIGIN}{edition_key}.json"
    try:
        ed_resp = await client.get(edition_url)
        ed_resp.raise_for_status()
        edition = ed_resp.json() or {}
    except Exception as exc:
        logger.warning("Open Library edition JSON failed %s: %s", edition_key, exc)
        return None

    for field in ("description", "first_sentence"):
        text = _open_library_structured_text_field(edition.get(field))
        if text:
            return text

    works = edition.get("works") or []
    work_key = None
    if works and isinstance(works[0], dict):
        work_key = works[0].get("key")
    if not work_key or not str(work_key).startswith("/works/"):
        return None

    work_url = f"{OPEN_LIBRARY_SITE_ORIGIN}{work_key}.json"
    try:
        w_resp = await client.get(work_url)
        w_resp.raise_for_status()
        work = w_resp.json() or {}
    except Exception as exc:
        logger.warning("Open Library work JSON failed %s: %s", work_key, exc)
        return None

    for field in ("description", "first_sentence"):
        text = _open_library_structured_text_field(work.get(field))
        if text:
            return text
    return None


def _parse_open_library_item(item: dict) -> dict:
    publish_date = _safe_text(item.get("publish_date"))
    authors = []
    for author in item.get("authors") or []:
        name = _safe_text(author.get("name")) if isinstance(author, dict) else None
        if name:
            authors.append(name)

    categories = []
    for subject in item.get("subjects") or []:
        if isinstance(subject, dict):
            name = _safe_text(subject.get("name"))
            if name:
                categories.append(name)

    thumbnail = None
    cover = item.get("cover") or {}
    if isinstance(cover, dict):
        thumbnail = _safe_text(cover.get("medium") or cover.get("small") or cover.get("large"))

    return {
        "title": _safe_text(item.get("title")),
        "subtitle": _safe_text(item.get("subtitle")),
        "authors": authors,
        "publisher": _safe_text((item.get("publishers") or [{}])[0].get("name") if item.get("publishers") else None),
        "publishedDate": publish_date,
        "description": _safe_text(item.get("description", {}).get("value") if isinstance(item.get("description"), dict) else item.get("description")),
        "categories": categories,
        "language": _safe_text((item.get("languages") or [{}])[0].get("key", "").split("/")[-1] if item.get("languages") else None),
        "pageCount": item.get("number_of_pages") if isinstance(item.get("number_of_pages"), int) else None,
        "thumbnail": thumbnail,
    }


async def _fetch_google_books_by_isbn(client: httpx.AsyncClient, isbn13: str) -> tuple[dict | None, float]:
    for isbn in [isbn13, _isbn13_to_isbn10(isbn13)]:
        if not isbn:
            continue

        params = {"q": f"isbn:{isbn}"}
        if GOOGLE_BOOKS_API_KEY:
            params["key"] = GOOGLE_BOOKS_API_KEY

        try:
            response = await client.get(GOOGLE_BOOKS_API_BASE_URL, params=params)
            response.raise_for_status()
            items = (response.json() or {}).get("items") or []
            if not items:
                continue
            metadata = _parse_google_books_item(items[0])
            return metadata, _metadata_completeness_score(metadata)
        except Exception as exc:
            logger.warning("Google Books lookup failed for ISBN %s: %s", isbn, exc)

    return None, 0.0


def _parse_worldcat_classify_xml(payload_text: str) -> dict | None:
    try:
        root = ET.fromstring(payload_text)
    except Exception:
        return None

    works_node = root.find("works")
    if works_node is None:
        return None

    work = works_node.find("work")
    if work is None:
        return None

    title = _safe_text(work.attrib.get("title"))
    author = _safe_text(work.attrib.get("author"))
    if not title and not author:
        return None

    authors = [author] if author else []
    return {
        "title": title,
        "subtitle": None,
        "authors": authors,
        "publisher": None,
        "publishedDate": None,
        "description": None,
        "categories": [],
        "language": None,
        "pageCount": None,
        "thumbnail": None,
    }


async def _fetch_worldcat_by_isbn(
    client: httpx.AsyncClient,
    isbn13: str,
    isbn10: str | None,
) -> tuple[dict | None, float]:
    for isbn in [isbn13, isbn10]:
        if not isbn:
            continue

        try:
            response = await client.get(
                WORLDCAT_CLASSIFY_API_BASE_URL,
                params={
                    "isbn": isbn,
                    "summary": "true",
                },
            )
            response.raise_for_status()
            metadata = _parse_worldcat_classify_xml(response.text)
            if not metadata:
                continue
            return metadata, _metadata_completeness_score(metadata)
        except Exception as exc:
            logger.warning("WorldCat lookup failed for ISBN %s: %s", isbn, exc)

    return None, 0.0


async def _fetch_open_library_by_isbn(
    client: httpx.AsyncClient,
    isbn13: str,
    isbn10: str | None,
) -> tuple[dict | None, float]:
    for isbn in [isbn13, isbn10]:
        if not isbn:
            continue
        try:
            response = await client.get(
                OPEN_LIBRARY_API_BASE_URL,
                params={
                    "bibkeys": f"ISBN:{isbn}",
                    "format": "json",
                    "jscmd": "data",
                },
            )
            response.raise_for_status()
            payload = response.json() or {}
            item = payload.get(f"ISBN:{isbn}")
            if not item:
                continue
            metadata = _parse_open_library_item(item)
            if not metadata.get("description"):
                extra = await _fetch_open_library_description_via_json(client, item.get("key"))
                if extra:
                    metadata["description"] = extra
            return metadata, _metadata_completeness_score(metadata)
        except Exception as exc:
            logger.warning("Open Library lookup failed for ISBN %s: %s", isbn, exc)

    return None, 0.0


def _pick_value(primary, secondary):
    if isinstance(primary, list):
        return primary if primary else (secondary if isinstance(secondary, list) else [])
    if primary not in (None, ""):
        return primary
    return secondary


def _merge_lookup_metadata(google_data: dict | None, open_data: dict | None) -> dict:
    primary = google_data or {}
    secondary = open_data or {}
    return {
        "title": _pick_value(primary.get("title"), secondary.get("title")),
        "subtitle": _pick_value(primary.get("subtitle"), secondary.get("subtitle")),
        "authors": _pick_value(primary.get("authors"), secondary.get("authors")) or [],
        "publisher": _pick_value(primary.get("publisher"), secondary.get("publisher")),
        "publishedDate": _pick_value(primary.get("publishedDate"), secondary.get("publishedDate")),
        "description": _pick_value(primary.get("description"), secondary.get("description")),
        "categories": _pick_value(primary.get("categories"), secondary.get("categories")) or [],
        "language": _pick_value(primary.get("language"), secondary.get("language")),
        "pageCount": _pick_value(primary.get("pageCount"), secondary.get("pageCount")),
        "thumbnail": _pick_value(primary.get("thumbnail"), secondary.get("thumbnail")),
    }


def _merge_lookup_metadata_with_fallbacks(
    google_data: dict | None,
    open_data: dict | None,
    worldcat_data: dict | None,
) -> dict:
    merged = _merge_lookup_metadata(google_data, open_data)
    if worldcat_data:
        merged = _merge_lookup_metadata(merged, worldcat_data)
    return merged


def _should_generate_summary(merged: dict) -> bool:
    return bool(merged.get("title") and (merged.get("authors") or merged.get("description")))


def _build_legacy_book_description_prompt(title: str, author: str, context_block: str = "") -> str:
    title_text = (title or "").strip() or "Không rõ"
    author_text = (author or "").strip() or "Không rõ"
    return (
        f"Bạn là một biên tập viên nội dung sách cao cấp và chuyên gia giới thiệu sách cho hệ thống thư viện số. "
        f"Nhiệm vụ của bạn là viết phần mô tả sách bằng tiếng Việt thật cuốn hút, giàu hình ảnh, chuyên nghiệp, dễ đọc, "
        f"nhưng vẫn tự nhiên và đáng tin cậy. "
        f"Dựa trên tên sách '{title_text}' của tác giả '{author_text}', "
        f"hãy tạo một bài mô tả sách chất lượng cao để hiển thị trong hệ thống thư viện. "
        f"Độ dài mong muốn: khoảng 250-350 từ. "
        f"Nội dung cần vừa có tính giới thiệu, vừa làm nổi bật giá trị của cuốn sách, giúp người đọc nhanh chóng cảm nhận được "
        f"tinh thần, chủ đề và sức hấp dẫn của tác phẩm. "
        f"Yêu cầu bắt buộc: "
        f"Không viết thành một đoạn liền. "
        f"Trình bày thành nhiều phần rõ ràng, xuống dòng hợp lý, văn phong mượt mà. "
        f"Chỉ trả về văn bản thuần túy, không dùng markdown code block. "
        f"Có thể dùng emoji nhẹ nhàng như 📘 ✨ 🎯 • để tạo điểm nhấn, nhưng không lạm dụng. "
        f"Bố cục đầu ra bắt buộc gồm các phần sau: "
        f"📘 Tổng quan: 1 đoạn ngắn giới thiệu khái quát về cuốn sách, bối cảnh hoặc giá trị cốt lõi. "
        f"🧠 Nội dung và chủ đề: 1 đoạn 3-5 câu làm rõ nội dung chính, thông điệp nổi bật, chiều sâu tư tưởng hoặc cảm xúc mà sách mang lại. "
        f"✨ Điểm nổi bật: 3 gạch đầu dòng, mỗi gạch đầu dòng nêu một điểm đáng chú ý như phong cách viết, giá trị kiến thức, cảm hứng, chiều sâu nhân vật hoặc tính ứng dụng. "
        f"🎯 Gợi ý bạn đọc: 2-3 câu nêu nhóm độc giả phù hợp và lý do vì sao họ nên đọc cuốn sách này. "
        f"Phong cách viết cần: "
        f"ấm áp, tinh tế, hấp dẫn, có chiều sâu, tránh sáo rỗng, tránh lặp ý, tránh liệt kê khô khan. "
        f"Ưu tiên cách diễn đạt giàu hình ảnh và có tính gợi mở, giống phần giới thiệu sách chuyên nghiệp trên các nền tảng thư viện hoặc nhà sách lớn. "
        f"Quy tắc quan trọng về độ chính xác: "
        f"Nếu có đủ dữ liệu trong ngữ cảnh cung cấp, hãy bám sát dữ liệu đó. "
        f"Nếu thông tin về nội dung sách chưa đầy đủ, không được bịa chi tiết cụ thể như tên nhân vật, tình tiết hoặc kết thúc. "
        f"Trong trường hợp thiếu dữ liệu, hãy viết theo hướng giới thiệu khái quát, an toàn nhưng vẫn hấp dẫn, dựa trên tinh thần từ nhan đề, tác giả và ngữ cảnh hiện có. "
        f"Mục tiêu cuối cùng là tạo ra một mô tả khiến người đọc cảm thấy đây là một cuốn sách đáng chú ý, đáng mượn hoặc đáng khám phá. "
        f"{context_block}"
    )


def _build_summary_prompt(metadata: dict) -> str:
    title = _safe_text(metadata.get("title")) or "Không rõ"
    authors = _safe_list(metadata.get("authors"))
    author_text = authors[0] if authors else "Không rõ"
    publisher_text = _safe_text(metadata.get("publisher")) or "không rõ"
    categories = _safe_list(metadata.get("categories"))
    category_text = ", ".join(categories[:3]) if categories else "không rõ"
    description_hint = (_safe_text(metadata.get("description")) or "")[:1200]
    if len(description_hint) > 1200:
        description_hint = description_hint[:1200].rsplit(" ", 1)[0] + "..."

    return (
        f"Dữ liệu sách:\n"
        f"- Tên sách: {title}\n"
        f"- Tác giả: {author_text}\n"
        f"- Nhà xuất bản: {publisher_text}\n"
        f"- Thể loại: {category_text}\n"
        f"- Mô tả gốc: {description_hint or 'không có'}\n\n"
        "Bạn là biên tập viên nội dung cho nhà sách online Việt Nam. "
        "Hãy viết mô tả sách tiếng Việt 180–280 từ, 3–5 đoạn, "
        "phong cách giới thiệu như Fahasa/Tiki, không bịa thông tin, "
        "làm rõ giá trị và độc giả phù hợp.\n\n"
        "Trả về DUY NHẤT JSON hợp lệ:\n"
        "{\"summaryVi\": \"...\", \"keywords\": [\"...\", \"...\", \"...\", \"...\", \"...\"]}"
    )


def _is_weak_summary(summary_text: str | None) -> bool:
    text = _safe_text(summary_text)
    if not text:
        return True

    compact = re.sub(r"\s+", " ", text).strip()
    if len(compact) < 80:
        return True

    weak_tokens = ["...", "đang cập nhật", "chưa có thông tin", "không rõ"]
    lowered = compact.lower()
    if any(token in lowered for token in weak_tokens):
        return True

    return False


def _build_metadata_fallback_summary(metadata: dict) -> str:
    title = _safe_text(metadata.get("title")) or "cuốn sách này"
    authors = _safe_list(metadata.get("authors"))
    author_text = authors[0] if authors else None
    publisher_text = _safe_text(metadata.get("publisher"))
    categories = _safe_list(metadata.get("categories"))
    category_text = ", ".join(categories[:2]) if categories else None

    parts = []
    if author_text:
        parts.append(f"của tác giả {author_text}")
    if publisher_text:
        parts.append(f"do {publisher_text} xuất bản")
    if category_text:
        parts.append(f"thuộc lĩnh vực {category_text}")

    context_str = ", ".join(parts)
    intro = f'"{title}"'
    if context_str:
        intro += f" {context_str}"
    intro += " là một tựa sách đáng khám phá dành cho những ai muốn mở rộng kiến thức và tư duy."

    second = "Cuốn sách mang đến những nội dung được chắt lọc kỹ lưỡng, phù hợp với độc giả có nhu cầu tìm hiểu sâu hơn về chủ đề này."

    return f"{intro}\n\n{second}"


async def _generate_summary_vi_and_keywords(metadata: dict) -> tuple[str | None, list[str], bool]:
    if not _should_generate_summary(metadata):
        return None, [], False

    try:
        client = ollama.Client(host=OLLAMA_HOST)
        response = await asyncio.to_thread(
            _ollama_generate_with_summary_fallback,
            client,
            _build_summary_prompt(metadata),
            {"temperature": 0.55, "num_predict": 700},
        )
        raw_text = response.get("response", "")
        parsed = _extract_json(raw_text)

        summary_vi = _safe_text(parsed.get("summaryVi"))
        if not summary_vi:
            raw_candidate = _safe_text(raw_text)
            if raw_candidate and not raw_candidate.startswith("{"):
                summary_vi = raw_candidate

        if _is_weak_summary(summary_vi):
            summary_vi = _build_metadata_fallback_summary(metadata)

        summary_vi = _normalize_bookstore_description(summary_vi or "") or None
        if _is_weak_summary(summary_vi):
            summary_vi = _build_metadata_fallback_summary(metadata)

        keywords = _safe_list(parsed.get("keywords"))
        if not keywords:
            keywords = _safe_list(metadata.get("categories"))[:5]
        if not keywords and metadata.get("title"):
            keywords = [str(metadata.get("title"))]

        return summary_vi, keywords, bool(summary_vi or keywords)
    except Exception as exc:
        logger.warning("Ollama summary generation failed: %s", exc)
        return None, [], False


@app.post("/lookup-book-by-isbn")
async def lookup_book_by_isbn(req: IsbnLookupRequest):
    raw_isbn = str(req.isbn or "").strip()
    isbn13, isbn10, validation_error = _normalize_and_validate_isbn(raw_isbn)

    # Check if the input looks like a numeric barcode (10 or 13 digits) even if not a valid ISBN
    raw_barcode = re.sub(r"[^0-9]", "", raw_isbn)
    is_barcode_candidate = len(raw_barcode) in (10, 13)

    # ── Barcode mode: non-ISBN but numeric code → try marketplace first ───────
    if validation_error and is_barcode_candidate and ENABLE_MARKETPLACE_LOOKUP:
        logger.info("ISBN validation failed (%s), trying marketplace barcode lookup for %s", validation_error, raw_barcode)
        mp_results = await _fetch_all_marketplace(raw_barcode, None)
        fahasa_b, fahasa_bs, tiki_b, tiki_bs, vinabook_b, vinabook_bs, web_b = mp_results
        mp_merged = _merge_with_marketplace({}, fahasa_b, tiki_b, vinabook_b)
        mp_found = bool(mp_merged.get("title") or mp_merged.get("description"))

        if mp_found:
            # Try to extract a canonical ISBN from JSON-LD if marketplace returned one
            canonical_isbn13 = None
            canonical_isbn10 = None
            for src in [fahasa_b, tiki_b, vinabook_b]:
                if not src:
                    continue
                ld_isbn = (src.get("_isbn_from_ld") or "").strip()
                if ld_isbn:
                    c13, c10, err = _normalize_and_validate_isbn(ld_isbn)
                    if not err:
                        canonical_isbn13, canonical_isbn10 = c13, c10
                        break

            mp_score = max(fahasa_bs, tiki_bs, vinabook_bs)
            return {
                "success": True,
                "found": True,
                "isbn": canonical_isbn13 or raw_barcode,
                "isbn13": canonical_isbn13,
                "isbn10": canonical_isbn10,
                "title": mp_merged.get("title"),
                "subtitle": mp_merged.get("subtitle"),
                "authors": mp_merged.get("authors") or [],
                "publisher": mp_merged.get("publisher"),
                "publishedDate": mp_merged.get("publishedDate"),
                "description": mp_merged.get("description"),
                "categories": mp_merged.get("categories") or [],
                "language": mp_merged.get("language"),
                "pageCount": mp_merged.get("pageCount"),
                "thumbnail": mp_merged.get("thumbnail"),
                "source": {
                    "googleBooks": False,
                    "openLibrary": False,
                    "worldCat": False,
                    "fahasa": bool(fahasa_b),
                    "tiki": bool(tiki_b),
                    "vinabook": bool(vinabook_b),
                    "webSearch": web_b,
                    "aiSummary": "none",
                },
                "confidence": {
                    "overall": round(mp_score, 3),
                    "googleBooks": 0.0,
                    "openLibrary": 0.0,
                    "worldCat": 0.0,
                    "fahasa": round(fahasa_bs, 3),
                    "tiki": round(tiki_bs, 3),
                    "vinabook": round(vinabook_bs, 3),
                    "webSearch": 0.0,
                },
                "summaryVi": None,
                "keywords": [],
                "manualEntryRequired": False,
                "reason": "barcode is not a valid ISBN but marketplace lookup attempted",
            }

        logger.info("Barcode %s not found in any marketplace source", raw_barcode)
        return _manual_entry_response(raw_isbn, raw_barcode, "barcode not found in any source")

    if validation_error:
        return _manual_entry_response(raw_isbn, None, validation_error)

    # ── Standard ISBN lookup: run standard providers + marketplace in parallel ─
    if ENABLE_MARKETPLACE_LOOKUP:
        std_gather, mp_gather = await asyncio.gather(
            _run_standard_lookups(isbn13, isbn10),
            _fetch_all_marketplace(isbn13, isbn10),
            return_exceptions=True,
        )
        std_results: list = std_gather if not isinstance(std_gather, Exception) else []
        mp_tuple = mp_gather if not isinstance(mp_gather, Exception) else (None, 0.0, None, 0.0, None, 0.0, False)
    else:
        std_results = await _run_standard_lookups(isbn13, isbn10)
        mp_tuple = (None, 0.0, None, 0.0, None, 0.0, False)

    # Unpack standard results
    google_data, google_score = std_results[0] if len(std_results) > 0 and not isinstance(std_results[0], Exception) else (None, 0.0)
    open_data, open_score = std_results[1] if len(std_results) > 1 and not isinstance(std_results[1], Exception) else (None, 0.0)
    worldcat_data, worldcat_score = None, 0.0
    if ENABLE_WORLDCAT_LOOKUP and len(std_results) > 2 and not isinstance(std_results[2], Exception):
        worldcat_data, worldcat_score = std_results[2]

    # Unpack marketplace results
    fahasa_data, fahasa_score, tiki_data, tiki_score, vinabook_data, vinabook_score, web_searched = mp_tuple

    # ── Merge all sources ─────────────────────────────────────────────────────
    merged = _merge_lookup_metadata_with_fallbacks(google_data, open_data, worldcat_data)
    if ENABLE_MARKETPLACE_LOOKUP:
        merged = _merge_with_marketplace(merged, fahasa_data, tiki_data, vinabook_data)

    found = bool(merged.get("title") or merged.get("authors") or merged.get("description"))

    # ── Not found → return empty response with source flags ───────────────────
    if not found:
        result = _manual_entry_response(raw_isbn, isbn13, "metadata not found from providers")
        result["isbn"] = isbn13
        result["source"].update({
            "googleBooks": bool(google_data),
            "openLibrary": bool(open_data),
            "worldCat": bool(worldcat_data) if ENABLE_WORLDCAT_LOOKUP else False,
            "fahasa": bool(fahasa_data),
            "tiki": bool(tiki_data),
            "vinabook": bool(vinabook_data),
            "webSearch": web_searched,
        })
        result["confidence"].update({
            "googleBooks": google_score,
            "openLibrary": open_score,
            "worldCat": worldcat_score if ENABLE_WORLDCAT_LOOKUP else 0.0,
            "fahasa": fahasa_score,
            "tiki": tiki_score,
            "vinabook": vinabook_score,
            "overall": max(google_score, open_score,
                           worldcat_score if ENABLE_WORLDCAT_LOOKUP else 0.0,
                           fahasa_score, tiki_score, vinabook_score),
        })
        return result

    # ── Generate Vietnamese summary ───────────────────────────────────────────
    summary_vi = None
    keywords = []
    ai_provider = "none"
    if req.generateVietnameseSummary and _should_generate_summary(merged):
        summary_vi, keywords, anthropic_ok = await _call_anthropic(merged)
        if anthropic_ok:
            ai_provider = "anthropic"
        else:
            summary_vi, keywords, ollama_ok = await _generate_summary_vi_and_keywords(merged)
            ai_provider = "ollama" if ollama_ok else "none"

    # ── Calculate overall confidence ──────────────────────────────────────────
    all_scores = [
        google_score, open_score,
        worldcat_score if ENABLE_WORLDCAT_LOOKUP else 0.0,
        fahasa_score, tiki_score, vinabook_score,
    ]
    overall_confidence = round(max(all_scores), 3)
    active_scores = [s for s in all_scores if s > 0]
    if len(active_scores) >= 2:
        avg_score = sum(active_scores) / len(active_scores)
        overall_confidence = round(max(overall_confidence, min(1.0, avg_score + 0.1)), 3)

    return {
        "success": True,
        "found": True,
        "isbn": isbn13,
        "isbn13": isbn13,
        "isbn10": isbn10,
        "title": merged.get("title"),
        "subtitle": merged.get("subtitle"),
        "authors": merged.get("authors") or [],
        "publisher": merged.get("publisher"),
        "publishedDate": merged.get("publishedDate"),
        "description": merged.get("description"),
        "categories": merged.get("categories") or [],
        "language": merged.get("language"),
        "pageCount": merged.get("pageCount"),
        "thumbnail": merged.get("thumbnail"),
        "source": {
            "googleBooks": bool(google_data),
            "openLibrary": bool(open_data),
            "worldCat": bool(worldcat_data) if ENABLE_WORLDCAT_LOOKUP else False,
            "fahasa": bool(fahasa_data),
            "tiki": bool(tiki_data),
            "vinabook": bool(vinabook_data),
            "webSearch": web_searched,
            "aiSummary": ai_provider,
        },
        "confidence": {
            "overall": overall_confidence,
            "googleBooks": google_score,
            "openLibrary": open_score,
            "worldCat": worldcat_score if ENABLE_WORLDCAT_LOOKUP else 0.0,
            "fahasa": fahasa_score,
            "tiki": tiki_score,
            "vinabook": vinabook_score,
            "webSearch": 0.0,
        },
        "summaryVi": summary_vi,
        "keywords": keywords,
        "manualEntryRequired": False,
        "sourceUrl": (fahasa_data or tiki_data or vinabook_data or {}).get("sourceUrl"),
        "sourceFetchMode": (fahasa_data or tiki_data or vinabook_data or {}).get("sourceFetchMode"),
    }


# ────────────────────────────────────────────────────────────────────────────────
# AI Generate Book Summary (Vietnamese description)
# ────────────────────────────────────────────────────────────────────────────────

class BookSummaryRequest(BaseModel):
    title: str
    author: str


def _search_book_context(title: str, author: str) -> str:
    """Tìm kiếm thông tin sách trên web qua DuckDuckGo. Trả về chuỗi rỗng nếu thất bại."""
    try:
        from ddgs import DDGS
        query = f"{title} {author} sách tóm tắt nội dung"
        with DDGS() as ddgs:
            results = list(ddgs.text(query, region="vn-vi", max_results=3))
        if not results:
            return ""
        snippets = [r.get("body", "") for r in results if r.get("body")]
        return " ".join(snippets)[:800]  # Giới hạn context 800 ký tự
    except Exception as exc:
        logger.warning("DuckDuckGo search thất bại, sẽ sử dụng kiến thức nội tại: %s", exc)
        return ""


def _normalize_bookstore_description(text: str) -> str:
    """Normalize whitespace only — không ép format 4 section."""
    if not text:
        return ""
    cleaned = re.sub(r"[^\S\n]+", " ", text)      # collapse horizontal whitespace
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned)   # max 2 newlines liên tiếp
    cleaned = cleaned.strip()
    if len(cleaned) > 2500:
        cleaned = cleaned[:2500].rsplit("\n", 1)[0].strip()
    return cleaned


def _generate_fallback_description(title: str, author: str, web_context: str = "") -> str:
    """Generate a simple description when Ollama is unavailable."""
    web_info = ""
    if web_context:
        web_info = f"\n\nThông tin tham khảo:\n{web_context}"
    
    return (
        f"📘 Tổng quan\n"
        f"'{title}' của tác giả {author} là một tác phẩm đáng chú ý trong lĩnh vực văn học."
        f"{web_info}\n\n"
        f"🧠 Nội dung và chủ đề\n"
        f"Tác phẩm mở ra góc nhìn rõ ràng về chủ đề trung tâm, nhấn mạnh giá trị nhận thức và cảm hứng đọc cho người dùng thư viện.\n\n"
        f"✨ Điểm nổi bật\n"
        f"• Tác phẩm được viết bởi tác giả nổi tiếng {author}\n"
        f"• Nội dung có tính ứng dụng và khả năng gợi mở suy nghĩ\n"
        f"• Nằm trong bộ sưu tập sách của thư viện\n\n"
        f"🎯 Gợi ý bạn đọc\n"
        f"Phù hợp với bạn đọc quan tâm đến thể loại này và muốn tìm hiểu thêm về tác phẩm của {author}."
    )


@app.post("/api/ai/generate-book-summary")
async def generate_book_summary_legacy(req: BookSummaryRequest):
    """
    Tạo mô tả sách bằng Tiếng Việt sử dụng Ollama.
    Nhập: title (tên sách), author (tác giả)
    Xuất: description (mô tả 150-200 từ, có bố cục nhiều dòng), web_context_used (có sử dụng web search hay không)
    """
    return await _generate_book_summary(req)


@app.post("/generate-book-summary")
async def generate_book_summary(req: BookSummaryRequest):
    return await _generate_book_summary(req)


class SummaryViRequest(BaseModel):
    title: str
    author: str = ""
    publisher: str | None = None
    description: str = ""
    categories: list[str] = []


@app.post("/generate-summary-vi")
async def generate_summary_vi(req: SummaryViRequest):
    """
    Endpoint nhẹ: chỉ sinh summaryVi + keywords.
    Ưu tiên Anthropic, fallback Ollama local.
    Dùng cho bước 2 trên UI — user click nút riêng sau khi đã lookup metadata.
    """
    if not req.title.strip():
        raise HTTPException(status_code=400, detail="Thiếu tên sách (title).")

    # Cache key tính cả description + categories để tránh trả kết quả cũ khi metadata thay đổi
    _cache_raw = "|".join([
        req.title.strip().lower(),
        (req.author or "").strip().lower(),
        (req.description or "").strip()[:500],
        ",".join(sorted(req.categories or [])),
    ])
    cache_key = f"summary:{hashlib.sha256(_cache_raw.encode()).hexdigest()[:16]}"
    cached = summary_cache.get(cache_key)
    if cached:
        return {**cached, "ai_provider": "cached"}

    metadata = {
        "title": req.title.strip(),
        "authors": [req.author] if req.author else [],
        "publisher": req.publisher,
        "description": req.description,
        "categories": req.categories,
    }

    # Ưu tiên Anthropic
    summary_vi, keywords, anthropic_ok = await _call_anthropic(metadata)
    if anthropic_ok:
        description = _normalize_bookstore_description(summary_vi or "")
        result = {"summaryVi": description, "keywords": keywords, "ai_provider": "anthropic"}
        summary_cache.set(cache_key, result)
        return result

    # Fallback Ollama
    summary_vi, keywords, ollama_ok = await _generate_summary_vi_and_keywords(metadata)
    if ollama_ok:
        description = _normalize_bookstore_description(summary_vi or "")
        result = {"summaryVi": description, "keywords": keywords, "ai_provider": "ollama"}
        summary_cache.set(cache_key, result)
        return result

    raise HTTPException(status_code=503, detail="Không thể sinh summary. Vui lòng nhập tay.")


class EnrichBookMetadataRequest(BaseModel):
    title: str
    authors: list[str] = []
    publisher: str | None = None
    description: str | None = None
    categories: list[str] = []
    mode: str = "keywords"  # keywords | short_summary | normalize_description | suggest_categories | quality_check


class EnrichBookMetadataResponse(BaseModel):
    success: bool
    mode: str
    ai_provider: str = "none"
    keywords: list[str] = []
    shortSummary: str | None = None
    normalizedDescription: str | None = None
    suggestedCategories: list[str] = []
    qualityWarnings: list[str] = []
    confidence: float = 0.8


VALID_ENRICH_MODES = {"keywords", "short_summary", "normalize_description", "suggest_categories", "quality_check"}


@app.post("/enrich-book-metadata")
async def enrich_book_metadata(req: EnrichBookMetadataRequest):
    """
    AI enrichment toolkit for book metadata.
    Modes: keywords, short_summary, normalize_description, suggest_categories, quality_check.
    quality_check is rule-based (no AI). Others use Anthropic → Ollama fallback.
    Never overwrites frontend data — returns suggestions for user to apply.
    """
    title = (req.title or "").strip()
    if not title:
        raise HTTPException(status_code=422, detail="title is required")

    mode = (req.mode or "keywords").strip()
    if mode not in VALID_ENRICH_MODES:
        raise HTTPException(status_code=422, detail=f"mode must be one of {sorted(VALID_ENRICH_MODES)}")

    authors_str = ", ".join(req.authors) if req.authors else "Chưa rõ"
    desc = (req.description or "").strip()
    categories_str = ", ".join(req.categories[:3]) if req.categories else "Chưa phân loại"

    # quality_check: rule-based only, no AI call
    if mode == "quality_check":
        warnings = _check_book_quality(title, req.authors, req.publisher, req.description, req.categories)
        return EnrichBookMetadataResponse(
            success=True,
            mode=mode,
            ai_provider="rule_based",
            qualityWarnings=warnings,
            confidence=1.0,
        )

    SYSTEM = (
        "Bạn là biên tập viên nội dung sách cho nhà sách Việt Nam. "
        "Chỉ dùng thông tin được cung cấp. "
        "Tuyệt đối không bịa nhân vật, tình tiết, giải thưởng, số liệu, hay nội dung cụ thể. "
        "Trả về JSON hợp lệ duy nhất."
    )

    if mode == "keywords":
        user_prompt = (
            f"Sách: {title}\nTác giả: {authors_str}\nNhà xuất bản: {req.publisher or 'Chưa rõ'}\n"
            f"Thể loại: {categories_str}\nMô tả: {desc[:800] or 'Không có'}\n\n"
            "Tạo 5-10 từ khóa tìm kiếm tiếng Việt ngắn gọn, bám sát thông tin trên.\n"
            'Trả về: {"keywords": ["...", ...]}'
        )
    elif mode == "short_summary":
        user_prompt = (
            f"Sách: {title}\nTác giả: {authors_str}\nMô tả gốc: {desc[:1000] or 'Không có'}\n\n"
            "Viết tóm tắt 2-3 câu tiếng Việt, bám sát mô tả gốc. Không thêm thông tin mới.\n"
            'Trả về: {"shortSummary": "..."}'
        )
    elif mode == "normalize_description":
        if not desc:
            return EnrichBookMetadataResponse(
                success=False,
                mode=mode,
                ai_provider="none",
                qualityWarnings=["Mô tả đang trống, không có gì để chuẩn hóa"],
            )
        user_prompt = (
            f"Mô tả gốc:\n{desc[:1500]}\n\n"
            "Chuẩn hóa: loại bỏ HTML, ký tự rác, whitespace thừa; đảm bảo tiếng Việt tự nhiên. "
            "KHÔNG thêm thông tin mới.\n"
            'Trả về: {"normalizedDescription": "..."}'
        )
    elif mode == "suggest_categories":
        user_prompt = (
            f"Sách: {title}\nTác giả: {authors_str}\nMô tả: {desc[:600] or 'Không có'}\n\n"
            "Đề xuất 1-3 thể loại sách phù hợp, chỉ dựa vào thông tin trên. Không đoán mò.\n"
            'Trả về: {"suggestedCategories": ["..."]}'
        )
    else:
        raise HTTPException(status_code=422, detail=f"Unknown mode: {mode}")

    # Try Anthropic first, fallback Ollama
    data, ok = await _call_anthropic_json(SYSTEM, user_prompt)
    ai_provider = "anthropic" if ok else "none"
    if not ok:
        data, ok = await _call_ollama_json(SYSTEM, user_prompt)
        ai_provider = "ollama" if ok else "none"

    if not ok:
        return EnrichBookMetadataResponse(
            success=False,
            mode=mode,
            ai_provider="none",
            qualityWarnings=["AI không khả dụng. Kiểm tra ANTHROPIC_API_KEY hoặc kết nối Ollama."],
        )

    keywords = _safe_list(data.get("keywords", []))[:15]

    return EnrichBookMetadataResponse(
        success=True,
        mode=mode,
        ai_provider=ai_provider,
        keywords=keywords,
        shortSummary=_safe_text(data.get("shortSummary")),
        normalizedDescription=_safe_text(data.get("normalizedDescription")),
        suggestedCategories=_safe_list(data.get("suggestedCategories", []))[:5],
        confidence=0.85,
    )


async def _generate_book_summary(req: BookSummaryRequest):
    if not req.title.strip():
        raise HTTPException(status_code=400, detail="Thiếu tên sách (title).")
    if not req.author.strip():
        raise HTTPException(status_code=400, detail="Thiếu tên tác giả (author).")

    # Tìm kiếm thông tin từ web (tùy chọn)
    web_context = _search_book_context(req.title.strip(), req.author.strip())

    context_block = (
        f"\n\nThông tin tham khảo từ internet:\n{web_context}"
        if web_context
        else ""
    )

    prompt = _build_legacy_book_description_prompt(
        req.title.strip(),
        req.author.strip(),
        context_block,
    )

    try:
        client = ollama.Client(host=OLLAMA_HOST)

        # Ưu tiên Anthropic trước
        summary_vi, keywords, anthropic_ok = await _call_anthropic({
            "title": req.title.strip(),
            "author": req.author.strip(),
            "description": web_context or "",
            "categories": [],
        })

        if anthropic_ok:
            description = _format_summary_description(summary_vi or "", {
                "title": req.title.strip(),
                "author": req.author.strip(),
            })
            return {"description": description, "web_context_used": bool(web_context), "ai_provider": "anthropic"}

        # Fallback Ollama local
        response = await asyncio.to_thread(
            _ollama_generate_with_summary_fallback,
            client,
            prompt,
            {"temperature": 0.7, "num_predict": 400},
        )
        description = _format_summary_description(
            response.get("response", ""),
            {
                "title": req.title.strip(),
                "author": req.author.strip(),
                "categories": [],
            },
        )
        return {"description": description, "web_context_used": bool(web_context), "ai_provider": "ollama"}

    except ollama.ResponseError as e:
        logger.error(f"Ollama ResponseError: {e.error}")
        raise HTTPException(status_code=502, detail=f"Ollama không disponible: {e.error}")
    except Exception as e:
        logger.error(f"Error calling LLM: {str(e)}")
        fallback_description = _generate_fallback_description(req.title, req.author, web_context)
        return {"description": fallback_description, "web_context_used": bool(web_context), "fallback": True}


# ────────────────────────────────────────────────────────────────────────────────
# AI Chat — Trợ lý ảo SmartBook
# ────────────────────────────────────────────────────────────────────────────────

CHAT_SYSTEM_PROMPT = (
    "Bạn là **SmartBook AI** — trợ lý ảo thông minh chuyên biệt cho hệ thống quản lý thư viện SmartBook.\n\n"

    "## Vai trò & năng lực\n"
    "- Bạn có quyền truy cập DỮ LIỆU THỜI GIAN THỰC của thư viện (được cung cấp trong mục [DỮ LIỆU HỆ THỐNG] bên dưới).\n"
    "- Bạn hỗ trợ: tra cứu sách, kiểm tra tồn kho, theo dõi mượn/trả, phạt quá hạn, gợi ý sách, phân tích xu hướng.\n"
    "- Bạn hiểu cấu trúc hệ thống: Catalog (danh mục sách), Inventory (kho), Borrow (mượn/trả), Fines (phạt).\n\n"

    "## Quy tắc trả lời\n"
    "1. **Luôn dùng dữ liệu thực** khi có trong [DỮ LIỆU HỆ THỐNG]. Trích dẫn con số cụ thể.\n"
    "2. Nếu người dùng hỏi về sách cụ thể, tìm trong danh sách sách được cung cấp. Nếu không tìm thấy, nói rõ.\n"
    "3. Khi phân tích, đưa ra nhận xét có giá trị (ví dụ: cảnh báo tồn kho thấp, sách quá hạn nhiều).\n"
    "4. Trả lời bằng **tiếng Việt**, ngắn gọn, thân thiện, chuyên nghiệp.\n"
    "5. Dùng **bold** cho số liệu quan trọng và tên sách. Dùng emoji nhẹ (📚 📊 ⚠️ ✅) làm điểm nhấn.\n"
    "6. Giới hạn 3-8 câu, trừ khi người dùng yêu cầu chi tiết.\n"
    "7. Khi gợi ý hành động, chỉ rõ người dùng nên vào trang nào (Dashboard, Catalog, Inventory, Borrow, Reports).\n"
    "8. Nếu dữ liệu không đủ để trả lời chính xác, nói rõ giới hạn và gợi ý cách kiểm tra.\n\n"

    "## Khả năng đặc biệt\n"
    "- Phân tích xu hướng mượn sách và gợi ý nhập thêm đầu sách.\n"
    "- Cảnh báo sách tồn kho thấp hoặc hết hàng.\n"
    "- Tổng hợp tình hình mượn quá hạn và phạt.\n"
    "- So sánh và xếp hạng sách theo lượt mượn.\n"
    "- Tư vấn quy trình nghiệp vụ thư viện (nhập kho, putaway, picking, xuất kho).\n"
)

ROLE_BASED_RULES = (
    "\n## Quy tắc theo vai trò người dùng\n"
    "- Luôn trả lời theo user hiện tại được xác định từ Authorization token. KHÔNG dùng thông tin user từ body request.\n"
    "- CUSTOMER: Chỉ dùng dữ liệu cá nhân của customer đó. Không tiết lộ dữ liệu người khác hay analytics toàn hệ thống.\n"
    "- WAREHOUSE_STAFF: Ưu tiên task được giao cho họ, không hiện task của người khác.\n"
    "- WAREHOUSE_MANAGER/ADMIN: Có thể trả lời dữ liệu tổng quan hệ thống.\n"
    "- LIBRARIAN: Tập trung nghiệp vụ mượn trả, reservation, loan, fine.\n"
    "- SUPPLIER: Chỉ xem dữ liệu liên quan supplier của họ.\n"
    "- Nếu người dùng hỏi ngoài phạm vi quyền của họ, giải thích ngắn gọn họ không có quyền xem dữ liệu đó.\n"
    "- Không bịa dữ liệu. Nếu không có dữ liệu từ endpoint, nói rõ là chưa có thông tin.\n"
)


def _build_context_block(system_context: dict | None) -> str:
    """Chuyển dữ liệu hệ thống thành đoạn text để inject vào prompt."""
    if not system_context:
        return "\n[DỮ LIỆU HỆ THỐNG]: Không có dữ liệu thời gian thực. Trả lời dựa trên kiến thức chung.\n"

    parts = ["\n[DỮ LIỆU HỆ THỐNG — Cập nhật tại thời điểm người dùng gửi tin nhắn]\n"]

    summary = system_context.get("summary")
    if summary:
        parts.append("### Tổng quan thư viện")
        parts.append(f"- Tổng đầu sách: **{summary.get('totalBooks', '?')}**")
        parts.append(f"- Tổng số bản (units): **{summary.get('totalUnits', '?')}**")
        parts.append(f"- Sách tồn kho thấp (≤10): **{summary.get('lowStock', '?')}**")
        parts.append(f"- Sách hết hàng: **{summary.get('outOfStock', '?')}**")
        parts.append(f"- Phiếu mượn đang mở: **{summary.get('activeLoans', '?')}**")
        parts.append(f"- Phiếu mượn quá hạn: **{summary.get('overdueLoans', '?')}**")
        parts.append(f"- Tổng tiền phạt chưa thu: **{summary.get('totalFines', '?')}**đ")
        parts.append("")

    books = system_context.get("books")
    if books and isinstance(books, list):
        parts.append(f"### Danh sách sách ({len(books)} đầu sách, sắp xếp theo tồn kho)")
        for b in books[:30]:
            title = b.get("title", "?")
            qty = b.get("quantity", 0)
            author = b.get("author", "")
            flag = " ⚠️ TỒN THẤP" if 0 < qty <= 10 else (" 🔴 HẾT HÀNG" if qty == 0 else "")
            author_str = f" — {author}" if author else ""
            parts.append(f"- **{title}**{author_str}: {qty} bản{flag}")
        if len(books) > 30:
            parts.append(f"  ... và {len(books) - 30} đầu sách khác")
        parts.append("")

    loans = system_context.get("recentLoans")
    if loans and isinstance(loans, list):
        parts.append(f"### Phiếu mượn gần đây ({len(loans)} phiếu)")
        for l in loans[:15]:
            num = l.get("loan_number", "?")
            cust = l.get("customer_name", "?")
            status = l.get("status", "?")
            due = l.get("due_date", "")[:10] if l.get("due_date") else "?"
            flag = " ⚠️ QUÁ HẠN" if status == "OVERDUE" else ""
            parts.append(f"- {num}: {cust} — {status} — hạn trả: {due}{flag}")
        parts.append("")

    fines = system_context.get("recentFines")
    if fines and isinstance(fines, list) and len(fines) > 0:
        parts.append(f"### Phạt gần đây ({len(fines)} khoản)")
        for f in fines[:10]:
            cust = f.get("customer_name", "?")
            amount = f.get("amount", 0)
            status = f.get("status", "?")
            ftype = f.get("fine_type", "?")
            parts.append(f"- {cust}: {ftype} — {amount:,}đ — {status}")
        parts.append("")

    movements = system_context.get("recentMovements")
    if movements and isinstance(movements, list) and len(movements) > 0:
        parts.append(f"### Biến động kho gần đây ({len(movements)} dòng)")
        for m in movements[:10]:
            mtype = m.get("movement_type", "?")
            book = m.get("book_title", "?")
            qty = m.get("quantity", 0)
            wh = m.get("warehouse_name", "?")
            parts.append(f"- {mtype}: {book} x{qty} @ {wh}")
        parts.append("")

    return "\n".join(parts)


class ChatMessage(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    message: str
    conversation_history: list[ChatMessage] = []
    system_context: dict | None = None


async def _chat_with_anthropic(messages: list[dict]) -> tuple[str | None, bool]:
    if not ANTHROPIC_API_KEY:
        return None, False
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(CHAT_LLM_TIMEOUT_SECONDS)) as http_client:
            system_prompt, filtered = _split_anthropic_messages(messages)
            payload: dict = {
                "model": ANTHROPIC_MODEL,
                "messages": filtered,
                "temperature": 0.4,
                "max_tokens": 800,
            }
            if system_prompt:
                payload["system"] = system_prompt
            resp = await http_client.post(
                f"{ANTHROPIC_BASE_URL}/messages",
                headers={
                    "Content-Type": "application/json",
                    "x-api-key": ANTHROPIC_API_KEY,
                    "anthropic-version": "2023-06-01",
                },
                json=payload,
            )
            resp.raise_for_status()
            reply = _anthropic_extract_text(resp.json())
            return reply.strip() or None, bool(reply.strip())
    except Exception as exc:
        logger.warning("Anthropic chat failed: %s", exc)
        return None, False


async def _chat_with_ollama(messages: list[dict]) -> tuple[str | None, bool]:
    try:
        client = ollama.Client(host=OLLAMA_HOST)
        prompt_parts = []
        for msg in messages:
            role_label = "User" if msg["role"] == "user" else "Assistant"
            if msg["role"] == "system":
                role_label = "System"
            prompt_parts.append(f"{role_label}: {msg['content']}")
        prompt_parts.append("Assistant:")
        full_prompt = "\n".join(prompt_parts)

        response = await asyncio.wait_for(
            asyncio.to_thread(
                _ollama_generate_with_summary_fallback,
                client,
                full_prompt,
                {"temperature": 0.4, "num_predict": 800},
            ),
            timeout=CHAT_LLM_TIMEOUT_SECONDS,
        )
        reply = (response.get("response") or "").strip()
        return reply or None, bool(reply)
    except Exception as exc:
        logger.warning("Ollama chat failed: %s", exc)
        return None, False


_AGENT_ACTION_KEYWORDS = [
    "tao", "lap", "sinh", "xuat", "canh bao", "nhac", "task",
    "create", "generate", "reserve", "assign", "bao cao", "report",
    "de xuat", "dat sach", "giu sach", "giao viec",
]


def _wants_agent_action(message: str) -> bool:
    normalized = normalize_text(message)
    return any(kw in normalized for kw in _AGENT_ACTION_KEYWORDS)


_PERSONAL_QUERY_KEYWORDS = [
    # General "of mine" / "I have"
    "cua toi", "cua minh", "toi co", "toi dang", "toi can", "toi phai",
    "cho toi biet", "voi toi",
    # Loan / borrow variations
    "sach muon", "dang muon", "muon sach", "sach chua tra", "sach tra",
    "han tra", "qua han", "lich su muon", "muon bao nhieu", "sach cua toi",
    "loan cua toi",
    # Fine variations
    "khoan phat", "phat chua", "tien phat", "no phat", "con no",
    "phi phat", "chua thanh toan", "phat muon tra", "phat cua toi",
    "con phat", "phat gi khong",
    # Reservation variations
    "dat sach", "dang dat", "cho dat", "trang thai dat", "lich dat",
    "reservation cua toi", "don dat cua toi",
    # Membership / card
    "the thu vien", "membership", "the muon sach", "han the", "gia han the",
    "thanh vien", "membership cua toi",
    # Staff task variations
    "task", "viec hom nay", "phan cong", "duoc giao", "giao viec",
    "nhiem vu", "lam gi hom nay", "can lam", "viec gi hom nay",
    "hom nay lam gi", "toi phai lam", "co viec gi", "viec cua toi",
    # Picking / putaway specific
    "picking", "putaway", "phieu cua toi", "don picking",
    "phieu putaway", "don hang cua toi",
    # Exception reports
    "ngoai le cua toi", "bao cao cua toi", "exception cua toi",
    # English personal terms
    "my tasks", "my loans", "my fines", "my reservations", "my membership",
    "my picking", "my putaway",
]


def _is_personal_query(message: str) -> bool:
    normalized = normalize_text(message)
    return any(kw in normalized for kw in _PERSONAL_QUERY_KEYWORDS)


def _make_temp_action_for_check(planned: dict):
    """Build a minimal object for can_confirm_action without hitting agent_store."""
    from agent_schemas import PendingAction
    config = get_action_config(planned["type"]) or {}
    return PendingAction(
        id="temp",
        type=planned["type"],
        status=PENDING_CONFIRMATION,
        summary=planned.get("summary", ""),
        payload=planned.get("payload", {}),
        risk=planned.get("risk", "MEDIUM"),
        requires_confirmation=True,
        allowed_roles=config.get("allowed_roles", []),
        allowed_permissions=config.get("allowed_permissions", []),
        created_from_message="",
        created_at="",
        expires_at="",
    )


@app.post("/chat")
async def chat(request: Request, req: ChatRequest):
    if not req.message.strip():
        raise HTTPException(status_code=400, detail="Message không được để trống.")

    # Rate limiting - use the client IP as the limiter key.
    client_ip = request.client.host if request.client else "unknown"
    allowed, reason = await rate_limiter.acquire(key=client_ip)
    if not allowed:
        raise HTTPException(status_code=429, detail=reason)

    auth_header = request.headers.get("authorization")

    # Resolve user identity early so persona and personal context can be built
    # before retrieval. Never fail the chat on auth errors.
    user_ctx = None
    if auth_header:
        try:
            user_ctx = await get_user_context(auth_header)
        except Exception:
            pass

    intent_info = detect_intent(req.message.strip())

    # Build personal context (role-aware data) in parallel with system analytics.
    personal = await build_user_personal_context(user_ctx, intent_info, auth_header)

    # CUSTOMER and SUPPLIER must not see system-wide analytics; their personal
    # context (loans, fines, tasks) already comes from build_user_personal_context.
    # Exception: allow BOOK_SEARCH_QUERY so customers can still look up catalog books.
    _blocked = personal.get("role") in ANALYTICS_BLOCKED_ROLES
    _is_book_search = intent_info.get("intent") == _BOOK_SEARCH_INTENT
    if _blocked and not _is_book_search:
        retrieval: dict = {"summary": "", "raw": {}, "sources": [], "warnings": [], "retrieved_at": ""}
    else:
        retrieval = await retrieve_context(intent_info, auth_header)
    warnings = list(retrieval.get("warnings") or [])
    sources = list(retrieval.get("sources") or [])
    ok_sources = any(source.get("status") == "ok" for source in sources)
    missing_auth = any("Missing Authorization" in warning for warning in warnings)
    used_legacy_context = False

    # RAG is the primary path. Legacy frontend system_context remains only as a
    # compatibility fallback when backend retrieval fails for non-auth reasons.
    if not ok_sources and warnings and req.system_context and not missing_auth:
        legacy_context = _build_context_block(req.system_context)
        retrieval = {
            **retrieval,
            "summary": legacy_context,
            "raw": {"legacy_system_context": req.system_context},
            "sources": [
                {
                    "name": "Legacy Frontend System Context",
                    "endpoint": "system_context",
                    "status": "ok",
                }
            ],
            "warnings": warnings + ["RAG retrieval failed; using legacy system_context fallback."],
        }
        used_legacy_context = True

    if retrieval.get("summary") or retrieval.get("raw") or retrieval.get("sources"):
        context_block = build_rag_context(intent_info, retrieval)
    else:
        context_block = build_no_data_context(intent_info)

    metadata = {
        "intent": intent_info.get("intent"),
        "context_sources": retrieval.get("sources") or [],
        "retrieval_warnings": retrieval.get("warnings") or [],
    }

    # Include auth and intent in the cache key so RAG answers do not leak across users.
    history_hash = ""
    if req.conversation_history:
        hist_text = "|".join(m.content[:100] for m in req.conversation_history[-3:])
        history_hash = hashlib.md5(hist_text.encode()).hexdigest()[:8]
    auth_hash = hashlib.md5((auth_header or "anonymous").encode()).hexdigest()[:8]
    history_hash = f"{history_hash}:{auth_hash}:{intent_info.get('intent') or 'unknown'}"

    # Bypass cache for action requests and personal queries (data is user-specific).
    is_action_request = _wants_agent_action(req.message)
    is_personal_query = _is_personal_query(req.message)
    skip_cache = is_action_request or is_personal_query
    cached_reply = None if skip_cache else response_cache.get(req.message, history_hash)
    if cached_reply:
        return {"reply": cached_reply, "ai_provider": "cached", **metadata}

    # Build persona block from personal context.
    persona_block = f"\n## Người dùng hiện tại\n{personal['persona']}\n"
    if personal.get("summary"):
        persona_block += f"\n## Dữ liệu cá nhân người dùng\n{personal['summary']}\n"

    system_content = CHAT_SYSTEM_PROMPT + ROLE_BASED_RULES + persona_block + RAG_SYSTEM_RULES + context_block
    messages = [{"role": "system", "content": system_content}]

    for msg in req.conversation_history[-10:]:
        messages.append({"role": msg.role, "content": msg.content})

    messages.append({"role": "user", "content": req.message.strip()})

    async def _apply_agent_layer(reply_text: str) -> tuple[str, dict | None]:
        """Try to plan an agent action and append a confirmation hint to the reply."""
        pending_action_data = None

        if is_action_request and user_ctx is None:
            reply_text += "\n\nĐể tạo hành động, bạn cần đăng nhập hoặc gửi Authorization token."
            return reply_text, None

        if user_ctx is not None:
            try:
                planned = await plan_agent_action(req.message, intent_info, retrieval, user_ctx, auth_header=auth_header)
                if planned is not None:
                    temp_action = _make_temp_action_for_check(planned)
                    if not can_confirm_action(user_ctx, temp_action):
                        reply_text += "\n\nBạn chưa đủ quyền để xác nhận hành động này."
                    else:
                        action = create_pending_action(
                            action_type=planned["type"],
                            summary=planned["summary"],
                            payload=planned["payload"],
                            risk=planned["risk"],
                            sources=planned.get("sources", []),
                            intent=planned.get("intent"),
                            created_from_message=req.message,
                            warnings=planned.get("warnings", []),
                            requires_review=planned.get("requires_review", False),
                            user_context=user_ctx,
                        )
                        pending_action_data = action.model_dump()
                        reply_text += "\n\nTôi đã chuẩn bị một hành động cần xác nhận. Vui lòng kiểm tra thẻ hành động bên dưới trước khi bấm Xác nhận."
                        asyncio.ensure_future(push_ai_action_event(
                            "ai_action:created",
                            action.action_id,
                            action.type,
                            user_ctx.user_id if user_ctx else None,
                            {"summary": action.summary, "risk": action.risk},
                        ))
            except Exception as exc:
                logger.warning("Agent planning failed (non-fatal): %s", exc)

        return reply_text, pending_action_data

    reply, anthropic_ok = await _chat_with_anthropic(messages)
    if anthropic_ok and reply:
        reply_with_sources = ensure_source_line(reply, retrieval.get("sources") or [])
        reply_with_sources, pending_action_data = await _apply_agent_layer(reply_with_sources)
        if not pending_action_data and not skip_cache:
            response_cache.set(req.message, reply_with_sources, history_hash)
        result = {"reply": reply_with_sources, "ai_provider": "anthropic", **metadata}
        if pending_action_data:
            result["pending_action"] = pending_action_data
        return result

    reply, ollama_ok = await _chat_with_ollama(messages)
    if ollama_ok and reply:
        reply_with_sources = ensure_source_line(reply, retrieval.get("sources") or [])
        reply_with_sources, pending_action_data = await _apply_agent_layer(reply_with_sources)
        if not pending_action_data and not skip_cache:
            response_cache.set(req.message, reply_with_sources, history_hash)
        result = {"reply": reply_with_sources, "ai_provider": "ollama", **metadata}
        if pending_action_data:
            result["pending_action"] = pending_action_data
        return result

    fallback_reply = build_fallback_reply(intent_info, retrieval, used_legacy_context)
    fallback_reply, pending_action_data = await _apply_agent_layer(fallback_reply)
    result = {"reply": fallback_reply, "ai_provider": "fallback", **metadata}
    if pending_action_data:
        result["pending_action"] = pending_action_data
    return result


# ── Agent Action Endpoints ────────────────────────────────────────────────────

@app.post("/actions/confirm", response_model=ConfirmActionResponse)
async def confirm_action(request: Request, req: ConfirmActionRequest):
    cleanup_expired_actions()

    auth_header = request.headers.get("authorization")
    if not auth_header:
        raise HTTPException(status_code=401, detail="Authorization header required to confirm actions.")

    action = get_pending_action(req.action_id)
    if not action:
        raise HTTPException(status_code=404, detail="Action not found.")

    if action.status == CANCELLED:
        raise HTTPException(status_code=400, detail="This action was already cancelled.")

    if action.status == EXECUTED:
        stored_result = ACTION_RESULTS.get(req.action_id)
        return ConfirmActionResponse(
            success=True,
            action_id=req.action_id,
            status=EXECUTED,
            message="Action was already executed (idempotent).",
            result=stored_result,
        )

    if is_expired(action) or action.status == ACTION_EXPIRED:
        raise HTTPException(status_code=410, detail="Action has expired. Please ask AI to create a new one.")

    if not req.confirm:
        cancel_pending_action(req.action_id)
        asyncio.ensure_future(push_ai_action_event(
            "ai_action:cancelled",
            req.action_id,
            action.type,
            action.created_by_user_id,
        ))
        return ConfirmActionResponse(
            success=True,
            action_id=req.action_id,
            status=CANCELLED,
            message="Action cancelled by user.",
        )

    user_ctx = await get_user_context(auth_header)
    require_can_confirm_action(user_ctx, action)

    # Merge user-supplied overrides (e.g. warehouse_id chosen in UI) into payload
    if req.override_payload:
        merged_payload = {**action.payload, **req.override_payload}
        action = action.model_copy(update={"payload": merged_payload})

    user_id_for_emit = action.created_by_user_id
    asyncio.ensure_future(push_ai_action_event(
        "ai_action:confirmed",
        req.action_id,
        action.type,
        user_id_for_emit,
    ))

    try:
        result = await execute_agent_action(action, auth_header, user_ctx)
        mark_action_executed(req.action_id, result)
        asyncio.ensure_future(push_ai_action_event(
            "ai_action:executed",
            req.action_id,
            action.type,
            user_id_for_emit,
            {"result_summary": str(result)[:200] if result else None},
        ))
        return ConfirmActionResponse(
            success=True,
            action_id=req.action_id,
            status=EXECUTED,
            message="Action executed successfully.",
            result=result,
        )
    except HTTPException:
        raise
    except Exception as exc:
        mark_action_failed(req.action_id, str(exc))
        asyncio.ensure_future(push_ai_action_event(
            "ai_action:failed",
            req.action_id,
            action.type,
            user_id_for_emit,
            {"error": str(exc)[:200]},
        ))
        raise HTTPException(status_code=500, detail=f"Action execution failed: {exc}")


@app.post("/actions/cancel")
async def cancel_action(request: Request, req: CancelActionRequest):
    auth_header = request.headers.get("authorization")
    if not auth_header:
        raise HTTPException(status_code=401, detail="Authorization header required to cancel actions.")

    action = get_pending_action(req.action_id)
    if not action:
        raise HTTPException(status_code=404, detail="Action not found.")

    user_ctx = await get_user_context(auth_header)
    if not user_ctx.user_id:
        raise HTTPException(status_code=401, detail="Could not resolve user identity.")

    if action.created_by_user_id and not user_ctx.is_superuser:
        if user_ctx.user_id != action.created_by_user_id:
            raise HTTPException(status_code=403, detail="You can only cancel your own actions.")

    cancel_pending_action(req.action_id)
    asyncio.ensure_future(push_ai_action_event(
        "ai_action:cancelled",
        req.action_id,
        action.type,
        action.created_by_user_id,
    ))
    return {"success": True, "action_id": req.action_id, "status": CANCELLED}


@app.get("/actions/pending/{action_id}")
async def get_action(request: Request, action_id: str):
    auth_header = request.headers.get("authorization")
    if not auth_header:
        raise HTTPException(status_code=401, detail="Authorization header required.")

    action = get_pending_action(action_id)
    if not action:
        raise HTTPException(status_code=404, detail="Action not found.")

    user_ctx = await get_user_context(auth_header)
    if not user_ctx.user_id:
        raise HTTPException(status_code=401, detail="Could not resolve user identity.")

    if action.created_by_user_id and not user_ctx.is_superuser:
        if user_ctx.user_id != action.created_by_user_id:
            raise HTTPException(status_code=403, detail="Forbidden.")

    return action.model_dump()


@app.get("/actions/stats")
async def actions_stats(request: Request):
    auth_header = request.headers.get("authorization")
    if not auth_header:
        raise HTTPException(status_code=401, detail="Authorization header required.")
    user_ctx = await get_user_context(auth_header)
    if not user_ctx.is_superuser and "ADMIN" not in {r.upper() for r in user_ctx.roles}:
        raise HTTPException(status_code=403, detail="Admin access required.")
    return {
        "pending": sum(1 for a in PENDING_ACTIONS.values() if a.status == PENDING_CONFIRMATION),
        "executed": len(ACTION_RESULTS),
        "total": len(PENDING_ACTIONS),
    }


@app.post("/cache/clear")
async def clear_cache(request: Request):
    """Xóa response cache (admin only)."""
    auth_header = request.headers.get("authorization")
    if not auth_header:
        raise HTTPException(status_code=401, detail="Authorization header required.")
    user_ctx = await get_user_context(auth_header)
    if not user_ctx.is_superuser and "ADMIN" not in {r.upper() for r in user_ctx.roles}:
        raise HTTPException(status_code=403, detail="Admin access required.")
    response_cache.clear()
    return {"status": "ok", "message": "Cache đã được xóa"}


@app.get("/cache/stats")
async def cache_stats(request: Request):
    """Xem thống kê cache (admin only)."""
    auth_header = request.headers.get("authorization")
    if not auth_header:
        raise HTTPException(status_code=401, detail="Authorization header required.")
    user_ctx = await get_user_context(auth_header)
    if not user_ctx.is_superuser and "ADMIN" not in {r.upper() for r in user_ctx.roles}:
        raise HTTPException(status_code=403, detail="Admin access required.")
    return {
        "cached_responses": len(response_cache._cache),
        "max_size": response_cache.max_size,
        "ttl_seconds": response_cache.ttl,
    }


# ────────────────────────────────────────────────────────────────────────────────
# AI Recommendations — Gợi ý sách cá nhân hóa
# ────────────────────────────────────────────────────────────────────────────────

RECOMMENDATION_SYSTEM_PROMPT = (
    "Bạn là hệ thống gợi ý sách thông minh của thư viện SmartBook.\n\n"
    "## Nhiệm vụ\n"
    "Dữ liệu đầu vào là xu hướng mượn sách của toàn thư viện. "
    "Dựa trên xu hướng đó và danh mục sách hiện có, hãy gợi ý các đầu sách phù hợp.\n\n"
    "## Quy tắc bắt buộc\n"
    "- CHỈ gợi ý sách có trong [DANH MỤC SÁCH]. KHÔNG bịa ra sách không tồn tại.\n"
    "- LUÔN trả về ít nhất 1 gợi ý, ngay cả khi tất cả sách đều hết hàng.\n"
    "- Trả về ĐÚNG JSON array, KHÔNG có text giải thích hay markdown bên ngoài.\n"
    "- Tối đa 6 gợi ý.\n\n"
    "## Ghi chú\n"
    "- Sách có qty > 0 được ưu tiên hơn, nhưng sách hết hàng (qty=0) vẫn có thể được gợi ý.\n"
    "- Mỗi gợi ý phải có: book_id, title, author, category, reason (tiếng Việt), score.\n\n"
    "## Định dạng output — chỉ trả về JSON array này, không có gì khác:\n"
    '[{"book_id":"...","title":"...","author":"...","category":"...","reason":"...","score":0.95}]\n'
)


class RecommendationRequest(BaseModel):
    borrow_history: list[dict] = []
    catalog_books: list[dict] = []


def _build_recommendation_prompt(req: RecommendationRequest) -> str:
    parts = []

    if req.borrow_history:
        parts.append("[LỊCH SỬ MƯỢN SÁCH]")
        for b in req.borrow_history[:30]:
            title = b.get("title", "?")
            author = b.get("author", "")
            category = b.get("category", "")
            parts.append(f"- {title} | {author} | {category}")
    else:
        parts.append("[LỊCH SỬ MƯỢN SÁCH]: Không có — hãy gợi ý sách phổ biến nhất.")

    parts.append("")

    if req.catalog_books:
        parts.append(f"[DANH MỤC SÁCH] ({len(req.catalog_books)} đầu sách)")
        for b in req.catalog_books[:60]:
            bid = b.get("id", "?")
            title = b.get("title", "?")
            author = b.get("author", "")
            category = b.get("category", "")
            qty = b.get("quantity", 0)
            flag = " (HẾT HÀNG)" if qty == 0 else ""
            parts.append(f"- [{bid}] {title} | {author} | {category} | qty={qty}{flag}")

    parts.append("\nHãy trả về JSON array gợi ý sách.")
    return "\n".join(parts)


def _parse_recommendation_json(text: str) -> list[dict]:
    text = text.strip()
    if text.startswith("```"):
        lines = text.split("\n")
        lines = [l for l in lines if not l.strip().startswith("```")]
        text = "\n".join(lines).strip()

    start = text.find("[")
    end = text.rfind("]")
    if start != -1 and end != -1:
        text = text[start : end + 1]

    try:
        data = json.loads(text)
        if isinstance(data, list):
            return data[:6]
    except json.JSONDecodeError:
        pass
    return []


async def _chat_with_anthropic_long(messages: list[dict]) -> tuple[str | None, bool]:
    """Like _chat_with_anthropic but with a 45s timeout for heavy prompts (e.g. recommendations)."""
    if not ANTHROPIC_API_KEY:
        return None, False
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(45.0)) as http_client:
            system_prompt, filtered = _split_anthropic_messages(messages)
            payload: dict = {
                "model": ANTHROPIC_MODEL,
                "messages": filtered,
                "temperature": 0.4,
                "max_tokens": 800,
            }
            if system_prompt:
                payload["system"] = system_prompt
            resp = await http_client.post(
                f"{ANTHROPIC_BASE_URL}/messages",
                headers={
                    "Content-Type": "application/json",
                    "x-api-key": ANTHROPIC_API_KEY,
                    "anthropic-version": "2023-06-01",
                },
                json=payload,
            )
            resp.raise_for_status()
            reply = _anthropic_extract_text(resp.json())
            return reply.strip() or None, bool(reply.strip())
    except Exception as exc:
        logger.warning("Anthropic long chat failed: type=%s msg=%r", type(exc).__name__, str(exc))
        return None, False


@app.post("/recommendations")
async def get_recommendations(req: RecommendationRequest):
    user_prompt = _build_recommendation_prompt(req)

    messages = [
        {"role": "system", "content": RECOMMENDATION_SYSTEM_PROMPT},
        {"role": "user", "content": user_prompt},
    ]

    reply, anthropic_ok = await _chat_with_anthropic_long(messages)
    if anthropic_ok and reply:
        recs = _parse_recommendation_json(reply)
        if recs:
            return {"recommendations": recs, "ai_provider": "anthropic"}

    reply, ollama_ok = await _chat_with_ollama(messages)
    if ollama_ok and reply:
        recs = _parse_recommendation_json(reply)
        if recs:
            return {"recommendations": recs, "ai_provider": "ollama"}

    return {"recommendations": [], "ai_provider": "fallback"}


# ────────────────────────────────────────────────────────────────────────────────
# Reading Analytics — Thống kê đọc sách
# ────────────────────────────────────────────────────────────────────────────────

class ReadingStatsRequest(BaseModel):
    loans: list[dict] = []
    reviews: list[dict] = []


@app.post("/reading-stats")
async def get_reading_stats(req: ReadingStatsRequest):
    """Aggregate reading statistics from loan data."""
    total_books = 0
    categories: dict[str, int] = {}
    authors: dict[str, int] = {}
    monthly: dict[str, int] = {}
    total_days = 0
    returned_count = 0

    from datetime import datetime

    for loan in req.loans:
        items = loan.get("loan_items") or []
        if not isinstance(items, list):
            items = []
        total_books += len(items)
        raw_borrow = loan.get("borrow_date") or ""
        borrow_date = str(raw_borrow)[:10] if raw_borrow else ""
        if borrow_date:
            month_key = borrow_date[:7]
            monthly[month_key] = monthly.get(month_key, 0) + len(items)

        for item in items:
            if not isinstance(item, dict):
                continue
            cat = item.get("category") or ""
            if cat:
                categories[cat] = categories.get(cat, 0) + 1
            author = item.get("author") or ""
            if author:
                authors[author] = authors.get(author, 0) + 1
            raw_return = item.get("return_date")
            if raw_return and borrow_date:
                try:
                    rd_str = str(raw_return)[:10]
                    bd = datetime.fromisoformat(borrow_date.replace("Z", "+00:00"))
                    rd = datetime.fromisoformat(rd_str.replace("Z", "+00:00"))
                    total_days += max(0, (rd - bd).days)
                    returned_count += 1
                except Exception:
                    pass

    sorted_months = sorted(monthly.items())[-12:]
    streak = 0
    for _, count in reversed(sorted_months):
        if count > 0:
            streak += 1
        else:
            break

    avg_days = round(total_days / returned_count, 1) if returned_count > 0 else 0

    top_categories = sorted(categories.items(), key=lambda x: -x[1])[:8]
    top_authors = sorted(authors.items(), key=lambda x: -x[1])[:5]

    badges = []
    if total_books >= 50:
        badges.append({"id": "bookworm", "name": "Mọt sách", "icon": "📚", "description": "Đã đọc 50+ sách"})
    elif total_books >= 20:
        badges.append({"id": "reader", "name": "Người đọc chăm chỉ", "icon": "📖", "description": "Đã đọc 20+ sách"})
    elif total_books >= 10:
        badges.append({"id": "starter", "name": "Khởi đầu tốt", "icon": "🌱", "description": "Đã đọc 10+ sách"})
    if avg_days > 0 and avg_days <= 7:
        badges.append({"id": "speed", "name": "Đọc nhanh", "icon": "⚡", "description": "Trung bình trả sách trong 7 ngày"})
    if streak >= 6:
        badges.append({"id": "streak6", "name": "Nửa năm không nghỉ", "icon": "🔥", "description": "6 tháng liên tục mượn sách"})
    elif streak >= 3:
        badges.append({"id": "streak3", "name": "Đều đặn", "icon": "✨", "description": "3 tháng liên tục mượn sách"})
    if len(categories) >= 5:
        badges.append({"id": "diverse", "name": "Đa dạng", "icon": "🌈", "description": "Đọc 5+ thể loại khác nhau"})

    return {
        "total_books": total_books,
        "avg_borrow_days": avg_days,
        "streak_months": streak,
        "monthly_data": [{"month": m, "count": c} for m, c in sorted_months],
        "top_categories": [{"name": n, "count": c} for n, c in top_categories],
        "top_authors": [{"name": n, "count": c} for n, c in top_authors],
        "badges": badges,
    }


# ────────────────────────────────────────────────────────────────────────────────
# AI Storage Suggestion Explanation — Gợi ý vị trí lưu trữ sách
# ────────────────────────────────────────────────────────────────────────────────

STORAGE_SUGGESTION_PROMPT = """Bạn là chuyên gia quản lý kho sách cho thư viện SmartBook.
Nhiệm vụ của bạn là giải thích ngắn gọn lý do nên đặt sách tại các vị trí được gợi ý.

Dữ liệu đầu vào:
- Thông tin sách: tiêu đề, thể loại, tác giả
- Danh sách vị trí được gợi ý với điểm số và lý do rule-based

YÊU CẦU:
1. Với mỗi vị trí, viết 1 câu giải thích ngắn gọn (1-2 dòng) bằng tiếng Việt
2. Giải thích phải TỰ NHIÊN, không copy lý do rule-based
3. Ưu tiên lý do thực tế: thuận tiện picking, gom hàng cùng loại, tránh phân tán
4. Độ dài mỗi câu: 30-80 ký tự
5. Trả về JSON array, mỗi phần tử là một câu giải thích

Ví dụ:
Input: {"location_code": "IT-A01-S02-B03", "score": 92, "reasons": ["Cùng variant", "Đủ sức chứa"]}
Output: ["Nên đặt tại kệ IT-A01-S02-B03 vì đây là khu IT, hiện có sách cùng chủ đề và còn trống."]

CHỈ trả về JSON array, không có markdown, không giải thích thêm."""


class StorageSuggestionRequest(BaseModel):
    book: dict
    suggestions: list[dict]


@app.post("/explain-storage-suggestion")
async def explain_storage_suggestion(req: StorageSuggestionRequest):
    """
    Tạo câu giải thích tự nhiên cho các gợi ý vị trí lưu trữ sách.
    Dùng Ollama hoặc Anthropic để sinh text tự nhiên.
    """
    if not req.suggestions:
        return {"explanations": []}

    book_info = req.book or {}
    book_title = book_info.get("title", "cuốn sách")
    categories = book_info.get("categories", [])
    authors = book_info.get("authors", [])

    category_text = ", ".join(categories[:3]) if categories else "nhiều thể loại"
    author_text = ", ".join(authors[:2]) if authors else "tác giả"

    prompt = f"""Bạn là chuyên gia quản lý kho sách SmartBook.

Sách cần xếp: "{book_title}" của {author_text}
Thể loại: {category_text}

Các vị trí được gợi ý:
{json.dumps(req.suggestions, ensure_ascii=False, indent=2)}

Hãy viết câu giải thích ngắn gọn cho TỪNG vị trí (1 câu mỗi vị trí, 30-80 ký tự).
Giải thích phải tự nhiên, không liệt kê rules.

Trả về JSON array với đúng {len(req.suggestions)} câu:
["câu giải thích 1", "câu giải thích 2", ...]

CHỈ trả về JSON, không markdown."""

    # Thử Anthropic trước
    explanations = await _get_ai_explanations(prompt, len(req.suggestions))
    
    if explanations and len(explanations) == len(req.suggestions):
        return {"explanations": explanations, "ai_provider": "anthropic"}

    # Fallback: dùng rule-based explanation
    explanations = _generate_rule_based_explanation(book_title, req.suggestions)
    return {"explanations": explanations, "ai_provider": "fallback"}


async def _get_ai_explanations(prompt: str, expected_count: int) -> list[str] | None:
    """Gọi Anthropic hoặc Ollama để sinh explanations."""
    # Thử Anthropic
    if ANTHROPIC_API_KEY:
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(15.0)) as http_client:
                resp = await http_client.post(
                    f"{ANTHROPIC_BASE_URL}/messages",
                    headers={
                        "Content-Type": "application/json",
                        "x-api-key": ANTHROPIC_API_KEY,
                        "anthropic-version": "2023-06-01",
                    },
                    json={
                        "model": ANTHROPIC_MODEL,
                        "system": "Bạn là chuyên gia kho sách. Viết câu giải thích ngắn gọn 1-2 dòng. Chỉ trả về JSON array.",
                        "messages": [{"role": "user", "content": prompt}],
                        "temperature": 0.3,
                        "max_tokens": 300,
                    },
                )
                resp.raise_for_status()
                raw = _anthropic_extract_text(resp.json())
                
                explanations = _parse_json_array(raw)
                if explanations and len(explanations) >= expected_count // 2:
                    return explanations[:expected_count]
        except Exception as exc:
            logger.warning(f"Anthropic storage explanation failed: {exc}")

    # Thử Ollama
    try:
        client = ollama.Client(host=OLLAMA_HOST)
        response = client.generate(
            model=OLLAMA_MODEL,
            prompt=prompt,
            options={"temperature": 0.3, "num_predict": 200},
        )
        raw = response.get("response", "")
        explanations = _parse_json_array(raw)
        if explanations and len(explanations) >= expected_count // 2:
            return explanations[:expected_count]
    except Exception as exc:
        logger.warning(f"Ollama storage explanation failed: {exc}")

    return None


def _parse_json_array(text: str) -> list[str]:
    """Parse JSON array từ response text."""
    text = text.strip()
    
    # Thử parse trực tiếp
    try:
        data = json.loads(text)
        if isinstance(data, list):
            return [str(item) for item in data if item]
    except json.JSONDecodeError:
        pass

    # Tìm JSON array trong text
    start = text.find("[")
    end = text.rfind("]")
    if start != -1 and end != -1:
        try:
            data = json.loads(text[start:end + 1])
            if isinstance(data, list):
                return [str(item) for item in data if item]
        except json.JSONDecodeError:
            pass

    return []


def _generate_rule_based_explanation(book_title: str, suggestions: list[dict]) -> list[str]:
    """Fallback: tạo giải thích đơn giản từ rules."""
    explanations = []
    
    for suggestion in suggestions:
        score = suggestion.get("score", 0)
        reasons = suggestion.get("reasons", [])
        location_code = suggestion.get("location_code", "vị trí này")
        
        if score >= 80:
            explanations.append(f"Nên đặt '{book_title}' tại {location_code} - vị trí rất phù hợp với điểm số cao.")
        elif score >= 50:
            explanations.append(f"Đặt '{book_title}' tại {location_code} - có đủ sức chứa và thuận tiện quản lý.")
        else:
            explanations.append(f"Có thể đặt '{book_title}' tại {location_code} nếu các vị trí khác đã đầy.")
    
    return explanations
