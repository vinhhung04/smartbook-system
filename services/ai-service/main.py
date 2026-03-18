from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import ollama
import os
import json
import re
import logging

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
    if not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="File phải là ảnh (image/*).")

    image_bytes = await file.read()
    if len(image_bytes) == 0:
        raise HTTPException(status_code=400, detail="File ảnh rỗng.")

    try:
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
            "isbn":  data.get("isbn")  or None,
            "price": data.get("price") or None,
            "raw":   raw_text,
        }
    except ollama.ResponseError as e:
        raise HTTPException(status_code=502, detail=f"Ollama lỗi: {e.error}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/recognize-book")
async def recognize_book(file: UploadFile = File(...)):
    # Validate content type
    if not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="File phải là ảnh (image/*).")

    image_bytes = await file.read()
    if len(image_bytes) == 0:
        raise HTTPException(status_code=400, detail="File ảnh rỗng.")

    try:
        client = ollama.Client(host=OLLAMA_HOST)
        response = client.generate(
            model=OLLAMA_MODEL,
            prompt=PROMPT,
            images=[image_bytes],
            options={"temperature": 0},   # output ổn định hơn
        )
        raw_text: str = response.get("response", "")
        book_data = _extract_json(raw_text)

        # Chuẩn hoá các key trả về để khớp với frontend
        return {
            "title":     book_data.get("title")     or None,
            "author":    book_data.get("author")    or None,
            "isbn":      book_data.get("isbn")      or None,
            "publisher": book_data.get("publisher") or None,
            "raw":       raw_text,   # giữ lại để debug
        }

    except ollama.ResponseError as e:
        raise HTTPException(status_code=502, detail=f"Ollama lỗi: {e.error}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


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


@app.post("/api/ai/generate-book-summary")
async def generate_book_summary(req: BookSummaryRequest):
    """
    Tạo mô tả sách bằng Tiếng Việt sử dụng Ollama.
    Nhập: title (tên sách), author (tác giả)
    Xuất: description (mô tả 150-200 từ), web_context_used (có sử dụng web search hay không)
    """
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

    prompt = (
        f"Bạn là một chuyên gia phê bình sách. "
        f"Dựa trên tên sách '{req.title.strip()}' của tác giả '{req.author.strip()}', "
        f"hãy viết một đoạn tóm tắt nội dung ngắn gọn, hấp dẫn và chuyên nghiệp bằng Tiếng Việt "
        f"(khoảng 150-200 từ) để đưa vào hệ thống thư viện. "
        f"Trả về văn bản thuần túy, không dùng markdown, không bullet points."
        f"{context_block}"
    )

    summary_model = os.getenv("SUMMARY_MODEL", os.getenv("OLLAMA_MODEL", "llava"))

    try:
        client = ollama.Client(host=OLLAMA_HOST)
        response = client.generate(
            model=summary_model,
            prompt=prompt,
            options={"temperature": 0.7, "num_predict": 400},
        )
        description: str = response.get("response", "").strip()
        return {"description": description, "web_context_used": bool(web_context)}

    except ollama.ResponseError as e:
        raise HTTPException(status_code=502, detail=f"Ollama lỗi: {e.error}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))