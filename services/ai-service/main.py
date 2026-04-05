from fastapi import FastAPI, UploadFile, File, Form, HTTPException
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

# Groq cloud LLM — free tier, không cần credit. Lấy key tại https://console.groq.com
GROQ_API_KEY = os.getenv("GROQ_API_KEY", "").strip()
GROQ_BASE_URL = "https://api.groq.com/openai/v1"
GROQ_SUMMARY_MODEL = os.getenv("GROQ_SUMMARY_MODEL", "llama-3.3-70b-versatile")

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
            "ollamaSummary": False,
        },
        "confidence": {
            "overall": 0.0,
            "googleBooks": 0.0,
            "openLibrary": 0.0,
            "worldCat": 0.0,
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


async def _call_groq(metadata: dict) -> tuple[str | None, list[str], bool]:
    """
    Gọi Groq cloud LLM (OpenAI-compatible) để sinh summaryVi + keywords.
    Trả về (summary_vi, keywords, success).
    Chỉ gọi khi GROQ_API_KEY đã được set.
    """
    if not GROQ_API_KEY:
        return None, [], False

    description_hint = (_safe_text(metadata.get("description")) or "")[:800]
    title = _safe_text(metadata.get("title")) or "Không rõ"
    authors = _safe_list(metadata.get("authors"))
    author_text = authors[0] if authors else "Không rõ"
    categories = _safe_list(metadata.get("categories"))
    category_text = ", ".join(categories[:3]) if categories else ""

    system_prompt = (
        "Bạn là chuyên gia biên mục sách cho thư viện. "
        "Chỉ được paraphrase từ ngữ cảnh được cung cấp. "
        "Không bịa đặt tên nhân vật, cốt truyện, giải thưởng cụ thể nếu không có trong ngữ cảnh. "
        "Nếu không đủ thông tin, viết mô tả an toàn, khái quát."
    )

    user_prompt = f"""Dựa trên thông tin sau, viết một đoạn mô tả sách tiếng Việt ngắn gọn (120-180 từ) cho hệ thống thư viện.

Thông tin sách:
- Tên sách: {title}
- Tác giả: {author_text}
- Chủ đề: {category_text or '(không có)'}
- Mô tả tham khảo: {description_hint or '(không có)'}

Yêu cầu:
- Viết 3-4 câu, văn phong trang trọng, ấm áp, hấp dẫn
- Có thể dùng emoji nhẹ (📘, 🧠, ✨) làm điểm nhấn, tối đa 3 emoji
- Xuống dòng hợp lý, không viết liền 1 đoạn
- Trả về DUY NHẤT JSON: {{"summaryVi": "...", "keywords": ["...", "..."]}}
- keywords: 3-5 từ khóa tiếng Việt, bám theo tên sách, tác giả, chủ đề"""

    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(20.0)) as http_client:
            resp = await http_client.post(
                f"{GROQ_BASE_URL}/chat/completions",
                headers={
                    "Authorization": f"Bearer {GROQ_API_KEY}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": GROQ_SUMMARY_MODEL,
                    "messages": [
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": user_prompt},
                    ],
                    "temperature": 0.3,
                    "max_tokens": 300,
                },
            )
            resp.raise_for_status()
            data = resp.json()
            raw = data.get("choices", [{}])[0].get("message", {}).get("content", "")
            parsed = _extract_json(raw)

            summary_vi = _safe_text(parsed.get("summaryVi")) or None
            keywords = _safe_list(parsed.get("keywords"))

            if not summary_vi:
                text = raw.strip()
                if text and not text.startswith("{"):
                    summary_vi = text

            return summary_vi, keywords, bool(summary_vi)
    except Exception as exc:
        logger.warning("Groq call failed: %s", exc)
        return None, [], False


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
    title = metadata.get("title") or "Không rõ"
    author_for_prompt = (metadata.get("authors") or ["Không rõ"])[0]
    description_hint = _safe_text(metadata.get("description")) or ""
    if len(description_hint) > 500:
        description_hint = description_hint[:500].rsplit(" ", 1)[0] + "..."

    context_block = ""
    if description_hint:
        context_block = f"\n\nThông tin tham khảo từ metadata:\n{description_hint}"

    base_prompt = _build_legacy_book_description_prompt(title, author_for_prompt, context_block)
    return (
        f"{base_prompt}\n\n"
        "Yêu cầu đầu ra cho API: "
        "Thay vì trả về văn bản thuần túy, hãy trả về DUY NHẤT một JSON hợp lệ theo định dạng "
        "{\"summaryVi\": \"...\", \"keywords\": [\"...\", \"...\"]}. "
        "summaryVi phải là nội dung mô tả theo đúng phong cách ở trên. "
        "keywords gồm 3-7 từ khóa ngắn tiếng Việt, ưu tiên bám theo tên sách, tác giả và chủ đề tổng quát. "
        "Không markdown, không code block, không giải thích thêm."
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
    title = _safe_text(metadata.get("title")) or "Tác phẩm"
    authors = _safe_list(metadata.get("authors"))
    author_text = ", ".join(authors[:2]) if authors else "tác giả chưa được cập nhật"
    publisher = _safe_text(metadata.get("publisher")) or "đơn vị xuất bản chưa được cập nhật"
    categories = _safe_list(metadata.get("categories"))
    category_text = ", ".join(categories[:3]) if categories else "chủ đề tổng hợp"

    raw_description = _safe_text(metadata.get("description")) or ""
    cleaned_description = re.sub(r"\s+", " ", raw_description).strip()
    if len(cleaned_description) > 280:
        cleaned_description = cleaned_description[:280].rsplit(" ", 1)[0] + "..."

    if cleaned_description:
        body_text = (
            f"Từ dữ liệu hiện có, cuốn sách tập trung vào nhóm chủ đề {category_text}, "
            f"đồng thời mở ra các góc nhìn có giá trị tham khảo cho bạn đọc. {cleaned_description}"
        )
    else:
        body_text = (
            f"Từ dữ liệu hiện có, cuốn sách tập trung vào nhóm chủ đề {category_text}, "
            "đồng thời mở ra các góc nhìn có giá trị tham khảo cho bạn đọc trong học tập và đời sống."
        )

    summary = (
        f"📘 Tổng quan\n"
        f"'{title}' của {author_text} là đầu sách đáng chú ý, được phát hành bởi {publisher}, "
        f"phù hợp để bổ sung vào danh mục đọc có định hướng rõ ràng.\n\n"
        f"🧠 Nội dung và chủ đề\n"
        f"{body_text}\n\n"
        f"✨ Điểm nổi bật\n"
        f"• Thông tin sách có cấu trúc rõ ràng, thuận tiện cho tra cứu và lựa chọn.\n"
        f"• Chủ đề {category_text} phù hợp nhiều nhu cầu đọc từ cơ bản đến mở rộng.\n"
        f"• Giá trị nội dung phù hợp để tham khảo, mượn đọc và khai thác theo mục tiêu cá nhân.\n\n"
        f"🎯 Gợi ý bạn đọc\n"
        f"Phù hợp với bạn đọc đang tìm tài liệu theo nhóm chủ đề {category_text}. "
        "Đặc biệt hữu ích cho người muốn tiếp cận nội dung theo hướng thực tế và dễ ứng dụng."
    )
    return summary


async def _generate_summary_vi_and_keywords(metadata: dict) -> tuple[str | None, list[str], bool]:
    if not _should_generate_summary(metadata):
        return None, [], False

    try:
        client = ollama.Client(host=OLLAMA_HOST)
        response = await asyncio.to_thread(
            _ollama_generate_with_summary_fallback,
            client,
            _build_summary_prompt(metadata),
            {"temperature": 0.4, "num_predict": 420},
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

        summary_vi = _format_summary_description(summary_vi or "", metadata) or None
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

    if validation_error:
        return _manual_entry_response(raw_isbn, None, validation_error)

    # ── Bước 1: Song song hóa 3 nguồn lookup ────────────────────────────────
    timeout = httpx.Timeout(BOOK_LOOKUP_TIMEOUT_SECONDS)
    async with httpx.AsyncClient(timeout=timeout) as client:
        tasks = [
            _fetch_google_books_by_isbn(client, isbn13),
            _fetch_open_library_by_isbn(client, isbn13, isbn10),
        ]
        if ENABLE_WORLDCAT_LOOKUP:
            tasks.append(_fetch_worldcat_by_isbn(client, isbn13, isbn10))

        results = await asyncio.gather(*tasks, return_exceptions=True)

    google_data, google_score = results[0] if not isinstance(results[0], Exception) else (None, 0.0)
    open_data, open_score = results[1] if not isinstance(results[1], Exception) else (None, 0.0)

    worldcat_data, worldcat_score = None, 0.0
    if ENABLE_WORLDCAT_LOOKUP and len(results) > 2:
        wc_result = results[2]
        worldcat_data, worldcat_score = wc_result if not isinstance(wc_result, Exception) else (None, 0.0)

    merged = _merge_lookup_metadata_with_fallbacks(google_data, open_data, worldcat_data)
    found = bool(merged.get("title") or merged.get("authors") or merged.get("description"))

    # ── Bước 2: Không tìm thấy → trả response rỗng ────────────────────────
    if not found:
        result = _manual_entry_response(raw_isbn, isbn13, "metadata not found from providers")
        result["isbn"] = isbn13
        result["source"]["googleBooks"] = bool(google_data)
        result["source"]["openLibrary"] = bool(open_data)
        result["source"]["worldCat"] = bool(worldcat_data) if ENABLE_WORLDCAT_LOOKUP else False
        result["confidence"]["googleBooks"] = google_score
        result["confidence"]["openLibrary"] = open_score
        result["confidence"]["worldCat"] = worldcat_score if ENABLE_WORLDCAT_LOOKUP else 0.0
        result["confidence"]["overall"] = max(google_score, open_score, worldcat_score if ENABLE_WORLDCAT_LOOKUP else 0.0)
        return result

    # ── Bước 3: Sinh summary tiếng Việt ───────────────────────────────────
    summary_vi = None
    keywords = []
    ai_provider = "none"
    if req.generateVietnameseSummary and _should_generate_summary(merged):
        # Ưu tiên Groq (nhanh, free) trước; fallback Ollama
        summary_vi, keywords, groq_ok = await _call_groq(merged)
        if groq_ok:
            ai_provider = "groq"
        else:
            # Fallback Ollama local
            summary_vi, keywords, ollama_ok = await _generate_summary_vi_and_keywords(merged)
            ai_provider = "ollama" if ollama_ok else "none"

    overall_confidence = round(max(google_score, open_score, worldcat_score if ENABLE_WORLDCAT_LOOKUP else 0.0), 3)
    active_scores = [s for s in [google_score, open_score, worldcat_score if ENABLE_WORLDCAT_LOOKUP else 0.0] if s > 0]
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
            "aiSummary": ai_provider,
        },
        "confidence": {
            "overall": overall_confidence,
            "googleBooks": google_score,
            "openLibrary": open_score,
            "worldCat": worldcat_score if ENABLE_WORLDCAT_LOOKUP else 0.0,
        },
        "summaryVi": summary_vi,
        "keywords": keywords,
        "manualEntryRequired": False,
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


def _build_dynamic_highlights_and_audience(context: dict | None = None) -> tuple[list[str], str]:
    ctx = context or {}
    title = _safe_text(ctx.get("title")) or "cuốn sách"
    categories = _safe_list(ctx.get("categories"))
    category_text = ", ".join(categories[:2]) if categories else "chủ đề chính của tác phẩm"

    authors = ctx.get("authors")
    author_name = ""
    if isinstance(authors, list) and authors:
        author_name = _safe_text(authors[0]) or ""
    if not author_name:
        author_name = _safe_text(ctx.get("author")) or ""

    highlights = [
        f"Mạch triển khai của '{title}' rõ ràng, giúp người đọc nắm nhanh trọng tâm nội dung.",
        f"Tác phẩm mở rộng góc nhìn về {category_text}, tạo chiều sâu khi tiếp cận và suy ngẫm.",
        (
            f"Dấu ấn kể chuyện của {author_name} tạo bản sắc riêng, tăng sức hút cho trải nghiệm đọc."
            if author_name
            else "Nội dung giàu tính gợi mở, phù hợp để đọc sâu và liên hệ với bối cảnh thực tế."
        ),
    ]
    audience = (
        f"Phù hợp với bạn đọc quan tâm đến {category_text} và muốn tìm một đầu sách có định hướng rõ ràng. "
        f"Nếu bạn muốn khám phá tinh thần của '{title}' theo cách mạch lạc và dễ tiếp cận, đây là lựa chọn đáng cân nhắc."
    )
    return highlights, audience


def _format_summary_description(text: str, context: dict | None = None) -> str:
    """Đảm bảo mô tả luôn theo đúng form 4 phần mong muốn."""
    cleaned = re.sub(r"\s+", " ", (text or "")).strip()
    if not cleaned:
        return ""

    # Nếu đã đúng 4 section thì giữ nguyên để tôn trọng output model.
    required_markers = ["📘 Tổng quan", "🧠 Nội dung và chủ đề", "✨ Điểm nổi bật", "🎯 Gợi ý bạn đọc"]
    if all(marker in text for marker in required_markers):
        return text.strip()

    sentences = [s.strip() for s in re.split(r"(?<=[.!?])\s+", cleaned) if s.strip()]
    if not sentences:
        sentences = [cleaned]

    overview = sentences[0]
    body = " ".join(sentences[1:4]).strip()
    highlights = sentences[4:7]
    audience = " ".join(sentences[7:]).strip()
    dynamic_highlights, dynamic_audience = _build_dynamic_highlights_and_audience(context)

    if not body:
        body = "Tác phẩm gợi mở nhiều lớp ý nghĩa và cho thấy giá trị đọc bền vững đối với người đọc hiện đại."

    if not highlights:
        highlights = dynamic_highlights
    elif len(highlights) < 3:
        while len(highlights) < 3:
            highlights.append(dynamic_highlights[len(highlights)])

    if not audience:
        audience = dynamic_audience

    highlight_lines = "\n".join(f"• {item}" for item in highlights[:3])
    return (
        f"📘 Tổng quan\n{overview}\n\n"
        f"🧠 Nội dung và chủ đề\n{body}\n\n"
        f"✨ Điểm nổi bật\n{highlight_lines}\n\n"
        f"🎯 Gợi ý bạn đọc\n{audience}"
    )


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
    description: str = ""
    categories: list[str] = []


@app.post("/generate-summary-vi")
async def generate_summary_vi(req: SummaryViRequest):
    """
    Endpoint nhẹ: chỉ sinh summaryVi + keywords.
    Ưu tiên Groq (nhanh, free), fallback Ollama local.
    Dùng cho bước 2 trên UI — user click nút riêng sau khi đã lookup metadata.
    """
    if not req.title.strip():
        raise HTTPException(status_code=400, detail="Thiếu tên sách (title).")

    metadata = {
        "title": req.title.strip(),
        "authors": [req.author] if req.author else [],
        "description": req.description,
        "categories": req.categories,
    }

    # Ưu tiên Groq
    summary_vi, keywords, groq_ok = await _call_groq(metadata)
    if groq_ok:
        description = _format_summary_description(summary_vi or "", metadata)
        return {"summaryVi": description, "keywords": keywords, "ai_provider": "groq"}

    # Fallback Ollama
    summary_vi, keywords, ollama_ok = await _generate_summary_vi_and_keywords(metadata)
    if ollama_ok:
        description = _format_summary_description(summary_vi or "", metadata)
        return {"summaryVi": description, "keywords": keywords, "ai_provider": "ollama"}

    raise HTTPException(status_code=503, detail="Không thể sinh summary. Vui lòng nhập tay.")


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

        # Ưu tiên Groq (nhanh, free) trước
        summary_vi, keywords, groq_ok = await _call_groq({
            "title": req.title.strip(),
            "author": req.author.strip(),
            "description": web_context or "",
            "categories": [],
        })

        if groq_ok:
            description = _format_summary_description(summary_vi or "", {
                "title": req.title.strip(),
                "author": req.author.strip(),
            })
            return {"description": description, "web_context_used": bool(web_context), "ai_provider": "groq"}

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


async def _chat_with_groq(messages: list[dict]) -> tuple[str | None, bool]:
    if not GROQ_API_KEY:
        return None, False
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(25.0)) as http_client:
            resp = await http_client.post(
                f"{GROQ_BASE_URL}/chat/completions",
                headers={
                    "Authorization": f"Bearer {GROQ_API_KEY}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": GROQ_SUMMARY_MODEL,
                    "messages": messages,
                    "temperature": 0.4,
                    "max_tokens": 800,
                },
            )
            resp.raise_for_status()
            data = resp.json()
            reply = data.get("choices", [{}])[0].get("message", {}).get("content", "")
            return reply.strip() or None, bool(reply.strip())
    except Exception as exc:
        logger.warning("Groq chat failed: %s", exc)
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

        response = await asyncio.to_thread(
            _ollama_generate_with_summary_fallback,
            client,
            full_prompt,
            {"temperature": 0.4, "num_predict": 800},
        )
        reply = (response.get("response") or "").strip()
        return reply or None, bool(reply)
    except Exception as exc:
        logger.warning("Ollama chat failed: %s", exc)
        return None, False


@app.post("/chat")
async def chat(req: ChatRequest):
    if not req.message.strip():
        raise HTTPException(status_code=400, detail="Message không được để trống.")

    context_block = _build_context_block(req.system_context)
    system_content = CHAT_SYSTEM_PROMPT + context_block

    messages = [{"role": "system", "content": system_content}]

    for msg in req.conversation_history[-10:]:
        messages.append({"role": msg.role, "content": msg.content})

    messages.append({"role": "user", "content": req.message.strip()})

    reply, groq_ok = await _chat_with_groq(messages)
    if groq_ok and reply:
        return {"reply": reply, "ai_provider": "groq"}

    reply, ollama_ok = await _chat_with_ollama(messages)
    if ollama_ok and reply:
        return {"reply": reply, "ai_provider": "ollama"}

    return {
        "reply": "Xin lỗi, tôi đang gặp sự cố kết nối. Vui lòng thử lại sau! 🙏",
        "ai_provider": "fallback",
    }


# ────────────────────────────────────────────────────────────────────────────────
# AI Recommendations — Gợi ý sách cá nhân hóa
# ────────────────────────────────────────────────────────────────────────────────

RECOMMENDATION_SYSTEM_PROMPT = (
    "Bạn là hệ thống gợi ý sách thông minh của thư viện SmartBook.\n\n"
    "## Nhiệm vụ\n"
    "Dựa trên lịch sử mượn sách và danh mục sách hiện có, hãy:\n"
    "1. Phân tích sở thích đọc (thể loại, tác giả ưa thích)\n"
    "2. Gợi ý sách phù hợp TỪ DANH MỤC HIỆN CÓ\n"
    "3. Giải thích ngắn gọn lý do gợi ý\n\n"
    "## Quy tắc\n"
    "- CHỈ gợi ý sách có trong [DANH MỤC SÁCH]. KHÔNG bịa ra sách không tồn tại.\n"
    "- KHÔNG gợi ý sách mà người dùng đã mượn.\n"
    "- Ưu tiên sách còn hàng (quantity > 0).\n"
    "- Mỗi gợi ý phải có: book_id, title, author, category, reason (lý do gợi ý tiếng Việt).\n"
    "- Trả về ĐÚNG JSON array, không có markdown hay text thừa.\n"
    "- Tối đa 6 gợi ý, tối thiểu 1.\n\n"
    "## Định dạng output (JSON array)\n"
    '[{"book_id":"...","title":"...","author":"...","category":"...","reason":"...","score":0.95}]\n'
    "score là độ phù hợp từ 0.0 đến 1.0.\n"
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


@app.post("/recommendations")
async def get_recommendations(req: RecommendationRequest):
    user_prompt = _build_recommendation_prompt(req)

    messages = [
        {"role": "system", "content": RECOMMENDATION_SYSTEM_PROMPT},
        {"role": "user", "content": user_prompt},
    ]

    reply, groq_ok = await _chat_with_groq(messages)
    if groq_ok and reply:
        recs = _parse_recommendation_json(reply)
        if recs:
            return {"recommendations": recs, "ai_provider": "groq"}

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