from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import ollama
import os
import json
import re

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
    "Hãy đóng vai một quản lý kho sách. "
    "Nhìn vào ảnh bìa này và trích xuất thông tin: Tên sách, Tác giả, ISBN, Nhà xuất bản. "
    "Trả về kết quả CHỈ gồm định dạng JSON chuẩn, không thêm bất kỳ chú thích hay markdown nào: "
    '{ "title": "...", "author": "...", "isbn": "...", "publisher": "..." }. '
    "Nếu không tìm thấy thông tin nào hãy để giá trị là null."
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