from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import ollama
import httpx
import os
import json
import re
import logging
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
WORLDCAT_CLASSIFY_API_BASE_URL = os.getenv(
    "WORLDCAT_CLASSIFY_API_BASE_URL",
    "https://classify.oclc.org/classify2/Classify",
)
GOOGLE_BOOKS_API_KEY = os.getenv("GOOGLE_BOOKS_API_KEY", "").strip()
BOOK_LOOKUP_TIMEOUT_SECONDS = float(os.getenv("BOOK_LOOKUP_TIMEOUT_SECONDS", "8"))

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


def _generate_summary_vi_and_keywords(metadata: dict) -> tuple[str | None, list[str], bool]:
    if not _should_generate_summary(metadata):
        return None, [], False

    try:
        client = ollama.Client(host=OLLAMA_HOST)
        response = _ollama_generate_with_summary_fallback(
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

    timeout = httpx.Timeout(BOOK_LOOKUP_TIMEOUT_SECONDS)
    async with httpx.AsyncClient(timeout=timeout) as client:
        google_data, google_score = await _fetch_google_books_by_isbn(client, isbn13)
        open_data, open_score = await _fetch_open_library_by_isbn(client, isbn13, isbn10)
        worldcat_data, worldcat_score = await _fetch_worldcat_by_isbn(client, isbn13, isbn10)

    merged = _merge_lookup_metadata_with_fallbacks(google_data, open_data, worldcat_data)
    found = bool(merged.get("title") or merged.get("authors") or merged.get("description"))

    if not found:
        result = _manual_entry_response(raw_isbn, isbn13, "metadata not found from providers")
        result["isbn"] = isbn13
        result["source"]["googleBooks"] = bool(google_data)
        result["source"]["openLibrary"] = bool(open_data)
        result["source"]["worldCat"] = bool(worldcat_data)
        result["confidence"]["googleBooks"] = google_score
        result["confidence"]["openLibrary"] = open_score
        result["confidence"]["worldCat"] = worldcat_score
        result["confidence"]["overall"] = max(google_score, open_score, worldcat_score)
        return result

    summary_vi = None
    keywords = []
    ollama_summary = False
    if req.generateVietnameseSummary and _should_generate_summary(merged):
        summary_vi, keywords, ollama_summary = _generate_summary_vi_and_keywords(merged)

    overall_confidence = round(max(google_score, open_score, worldcat_score), 3)
    active_scores = [score for score in [google_score, open_score, worldcat_score] if score > 0]
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
            "worldCat": bool(worldcat_data),
            "ollamaSummary": ollama_summary,
        },
        "confidence": {
            "overall": overall_confidence,
            "googleBooks": google_score,
            "openLibrary": open_score,
            "worldCat": worldcat_score,
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
        response = _ollama_generate_with_summary_fallback(
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
        return {"description": description, "web_context_used": bool(web_context)}

    except ollama.ResponseError as e:
        logger.error(f"Ollama ResponseError: {e.error}")
        raise HTTPException(status_code=502, detail=f"Ollama không disponible: {e.error}")
    except Exception as e:
        logger.error(f"Error calling Ollama: {str(e)}")
        # Fallback: Return a simple description when Ollama is unavailable
        fallback_description = _generate_fallback_description(req.title, req.author, web_context)
        return {"description": fallback_description, "web_context_used": bool(web_context), "fallback": True}