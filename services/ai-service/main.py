from fastapi import FastAPI, UploadFile, File, Form, HTTPException
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


def _format_summary_description(text: str) -> str:
    """Đảm bảo mô tả có bố cục nhiều dòng và ký tự trang trí nhẹ."""
    cleaned = re.sub(r"\s+", " ", (text or "")).strip()
    if not cleaned:
        return ""

    # Nếu đã có bố cục nhiều dòng kèm ký tự trang trí thì giữ nguyên.
    if "\n" in text and any(ch in text for ch in ["📘", "✨", "🎯", "•"]):
        return text.strip()

    sentences = [s.strip() for s in re.split(r"(?<=[.!?])\s+", cleaned) if s.strip()]
    if not sentences:
        sentences = [cleaned]

    overview = sentences[0]
    highlights = sentences[1:3]
    audience = " ".join(sentences[3:]).strip()

    if not highlights:
        highlights = ["Nội dung được diễn đạt súc tích, dễ tiếp cận với nhiều nhóm bạn đọc."]

    if not audience:
        audience = "Phù hợp với bạn đọc muốn khám phá chủ đề chính của cuốn sách một cách rõ ràng và thực tế."

    highlight_lines = "\n".join(f"• {item}" for item in highlights)
    return (
        f"📘 Tổng quan\n{overview}\n\n"
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
        f"✨ Điểm nổi bật\n"
        f"• Tác phẩm được viết bởi tác giả nổi tiếng {author}\n"
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

    prompt = (
    f"Bạn là một biên tập viên nội dung sách cao cấp và chuyên gia giới thiệu sách cho hệ thống thư viện số. "
    f"Nhiệm vụ của bạn là viết phần mô tả sách bằng tiếng Việt thật cuốn hút, giàu hình ảnh, chuyên nghiệp, dễ đọc, "
    f"nhưng vẫn tự nhiên và đáng tin cậy. "
    f"Dựa trên tên sách '{req.title.strip()}' của tác giả '{req.author.strip()}', "
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

    summary_model = os.getenv("SUMMARY_MODEL", os.getenv("OLLAMA_MODEL", "llava"))

    try:
        client = ollama.Client(host=OLLAMA_HOST)
        response = client.generate(
            model=summary_model,
            prompt=prompt,
            options={"temperature": 0.7, "num_predict": 400},
        )
        description = _format_summary_description(response.get("response", ""))
        return {"description": description, "web_context_used": bool(web_context)}

    except ollama.ResponseError as e:
        logger.error(f"Ollama ResponseError: {e.error}")
        raise HTTPException(status_code=502, detail=f"Ollama không disponible: {e.error}")
    except Exception as e:
        logger.error(f"Error calling Ollama: {str(e)}")
        # Fallback: Return a simple description when Ollama is unavailable
        fallback_description = _generate_fallback_description(req.title, req.author, web_context)
        return {"description": fallback_description, "web_context_used": bool(web_context), "fallback": True}