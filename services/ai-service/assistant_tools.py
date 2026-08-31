from __future__ import annotations

import asyncio
import os
import re
from typing import Any, Awaitable, Callable

import httpx

import book_index
from intent import normalize_text

GATEWAY_URL = os.getenv("SMARTBOOK_GATEWAY_URL", "http://api-gateway:3000").rstrip("/")
ASSISTANT_TOOL_TIMEOUT_SECONDS = float(os.getenv("ASSISTANT_TOOL_TIMEOUT_SECONDS", "8"))

# Caps how many rows a single tool call can return, so a large analytics
# response doesn't blow up the LLM's context window (and, on CPU-only Ollama,
# doesn't add minutes to the next round's prompt-processing time).
MAX_LIST_ITEMS = 12


def _data(payload: Any) -> Any:
    if isinstance(payload, dict) and "data" in payload:
        return payload.get("data")
    return payload


def _truncate(value: Any) -> Any:
    if isinstance(value, list):
        if len(value) > MAX_LIST_ITEMS:
            return value[:MAX_LIST_ITEMS] + [
                {"_truncated": f"... va {len(value) - MAX_LIST_ITEMS} dong khac, hay thu hep dieu kien de xem day du"}
            ]
        return value
    if isinstance(value, dict):
        return {key: _truncate(val) for key, val in value.items()}
    return value


async def _get(endpoint: str, auth_header: str | None, params: dict | None = None) -> dict:
    clean_params = {key: val for key, val in (params or {}).items() if val is not None}
    headers = {"Authorization": auth_header} if auth_header else {}
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(ASSISTANT_TOOL_TIMEOUT_SECONDS)) as client:
            response = await client.get(f"{GATEWAY_URL}{endpoint}", params=clean_params, headers=headers)
        if response.status_code >= 400:
            return {"error": f"{endpoint} tra ve HTTP {response.status_code}"}
        return _truncate(_data(response.json()))
    except httpx.TimeoutException:
        return {"error": f"{endpoint} het thoi gian cho phan hoi"}
    except Exception as exc:
        return {"error": f"{endpoint} that bai: {type(exc).__name__}"}


async def get_dashboard_kpis(auth_header: str | None = None) -> dict:
    return await _get("/analytics/dashboard/kpis", auth_header)


async def get_borrow_trends(
    auth_header: str | None = None,
    from_date: str | None = None,
    to_date: str | None = None,
    granularity: str | None = None,
) -> dict:
    return await _get(
        "/analytics/borrow-trends",
        auth_header,
        {"from": from_date, "to": to_date, "granularity": granularity},
    )


async def get_top_books(
    auth_header: str | None = None,
    limit: int | None = None,
    from_date: str | None = None,
    to_date: str | None = None,
) -> dict:
    return await _get(
        "/analytics/top-books",
        auth_header,
        {"limit": limit, "from": from_date, "to": to_date},
    )


async def get_overdue_summary(auth_header: str | None = None) -> dict:
    return await _get("/analytics/overdue-summary", auth_header)


async def get_fine_summary(auth_header: str | None = None) -> dict:
    return await _get("/analytics/fine-summary", auth_header)


async def get_warehouse_stock_risk(auth_header: str | None = None) -> dict:
    return await _get("/analytics/warehouse-stock-risk", auth_header)


async def get_reorder_suggestions(
    auth_header: str | None = None,
    days: int | None = None,
    limit: int | None = None,
    lead_time_days: int | None = None,
    priority: str | None = None,
) -> dict:
    return await _get(
        "/analytics/reorder-suggestions",
        auth_header,
        {"days": days, "limit": limit, "leadTimeDays": lead_time_days, "priority": priority},
    )


async def get_reservation_funnel(auth_header: str | None = None) -> dict:
    return await _get("/analytics/reservation-funnel", auth_header)


SEARCH_BOOKS_RESULT_LIMIT = 8
SEARCH_BOOKS_FIELD_CHAR_LIMIT = 250


def _truncate_field(value: Any, limit: int = SEARCH_BOOKS_FIELD_CHAR_LIMIT) -> str:
    text = str(value or "").strip()
    return text if len(text) <= limit else text[:limit].rstrip() + "…"


def _compact_book_with_content(book: dict) -> dict:
    return {
        "id": book.get("id"),
        "variant_id": book.get("variant_id"),
        "title": str(book.get("title") or "Chua co ten sach"),
        "author": str(book.get("author") or ""),
        "category": book.get("category") or "",
        "isbn": book.get("isbn") or "",
        "quantity": book.get("quantity", 0),
        "description": _truncate_field(book.get("description")),
        "summary_vi": _truncate_field(book.get("summary_vi")),
    }


def _keyword_score(compact: dict, normalized_query: str, tokens: list[str]) -> int:
    haystack = normalize_text(" ".join([
        compact["title"], compact["author"], str(compact["category"]),
        str(compact["isbn"]), compact["description"], compact["summary_vi"],
    ]))
    score = sum(1 for token in tokens if token in haystack)
    if normalized_query and normalized_query in haystack:
        score += 3
    return score


def _score_and_rank_books(books: list, query: str, limit: int, client=None) -> list[dict]:
    """Hybrid ranking: keyword overlap fused with cosine similarity over the
    book's own text.

    Keyword scoring alone cannot match a topical question ("sach day tre ky nang
    song") against a book whose description says the same thing in other words;
    embeddings alone are unreliable for exact identifiers like an ISBN. Both are
    scored, normalised to 0..1, and averaged. When embeddings are unavailable
    (Ollama down, model not pulled) the semantic half is simply absent and this
    degrades to exactly the previous keyword-only ranking.

    Blocking: calls Ollama. Callers on the event loop must use asyncio.to_thread.
    """
    normalized_query = normalize_text(query)
    tokens = [token for token in re.split(r"\s+", normalized_query) if len(token) >= 2]
    if not tokens:
        return []

    valid_books = [book for book in books if isinstance(book, dict)]
    if not valid_books:
        return []

    compacts = [_compact_book_with_content(book) for book in valid_books]
    keyword = [_keyword_score(compact, normalized_query, tokens) for compact in compacts]
    max_keyword = max(keyword)

    semantic = book_index.semantic_scores(valid_books, query, client=client)
    if len(semantic) != len(valid_books):
        semantic = [0.0] * len(valid_books)

    scored = []
    for compact, keyword_score, semantic_score in zip(compacts, keyword, semantic):
        # A book enters the result set on either signal: any keyword hit, or a
        # semantic score clearing the threshold.
        if keyword_score <= 0 and semantic_score < book_index.BOOK_SEMANTIC_THRESHOLD:
            continue
        keyword_norm = (keyword_score / max_keyword) if max_keyword else 0.0
        scored.append((0.5 * keyword_norm + 0.5 * semantic_score, compact))

    scored.sort(key=lambda item: (-item[0], item[1]["title"]))
    return [item[1] for item in scored[:limit]]


async def search_books(auth_header: str | None = None, query: str = "") -> dict:
    """Tìm sách theo từ khóa tự do, kể cả nội dung mô tả — không dùng /api/books?search=
    vì backend chỉ lọc theo title/author/category/publisher/isbn, không lọc description/
    summary_vi. Lấy toàn bộ catalog rồi chấm điểm cục bộ theo hai tín hiệu: trùng từ khóa
    (khớp chính xác ISBN/tên sách) và cosine similarity trên embedding của chính nội dung
    sách (câu hỏi theo chủ đề). Nếu Ollama không sẵn sàng, chỉ còn phần từ khóa."""
    query = (query or "").strip()
    if not query:
        return {"error": "query khong duoc de trong"}
    headers = {"Authorization": auth_header} if auth_header else {}
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(ASSISTANT_TOOL_TIMEOUT_SECONDS)) as client:
            response = await client.get(f"{GATEWAY_URL}/api/books", headers=headers)
        if response.status_code >= 400:
            return {"error": f"/api/books tra ve HTTP {response.status_code}"}
        books = _data(response.json())
        books = books if isinstance(books, list) else []
    except httpx.TimeoutException:
        return {"error": "/api/books het thoi gian cho phan hoi"}
    except Exception as exc:
        return {"error": f"/api/books that bai: {type(exc).__name__}"}
    # _score_and_rank_books embeds via Ollama (blocking network call), so it
    # must run off the event loop - same convention as main.py's _chat_with_ollama.
    results = await asyncio.to_thread(
        _score_and_rank_books, books, query, SEARCH_BOOKS_RESULT_LIMIT
    )
    return {"query": query, "results": results}


async def get_aging_inventory(
    auth_header: str | None = None,
    days: int | None = None,
    limit: int | None = None,
) -> dict:
    return await _get("/analytics/aging-inventory", auth_header, {"days": days, "limit": limit})


TOOL_FUNCTIONS: dict[str, Callable[..., Awaitable[dict]]] = {
    "get_dashboard_kpis": get_dashboard_kpis,
    "get_borrow_trends": get_borrow_trends,
    "get_top_books": get_top_books,
    "get_overdue_summary": get_overdue_summary,
    "get_fine_summary": get_fine_summary,
    "get_warehouse_stock_risk": get_warehouse_stock_risk,
    "get_reorder_suggestions": get_reorder_suggestions,
    "get_reservation_funnel": get_reservation_funnel,
    "search_books": search_books,
    "get_aging_inventory": get_aging_inventory,
}


ANALYTICS_TOOLS: list[dict] = [
    {
        "type": "function",
        "function": {
            "name": "get_dashboard_kpis",
            "description": (
                "KPI tổng quan thư viện: tổng đầu sách/bản sao, phiếu mượn đang mở/quá hạn, reservation "
                "theo trạng thái, pickup code sắp hết hạn, tổng tiền phạt chưa thu, tồn kho thấp, tỷ lệ "
                "chuyển đổi reservation→loan."
            ),
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_borrow_trends",
            "description": "Xu hướng số lượt mượn/trả/đặt sách theo ngày hoặc tháng trong một khoảng thời gian.",
            "parameters": {
                "type": "object",
                "properties": {
                    "from_date": {"type": "string", "description": "Ngày bắt đầu dạng ISO YYYY-MM-DD, mặc định 30 ngày trước"},
                    "to_date": {"type": "string", "description": "Ngày kết thúc dạng ISO YYYY-MM-DD, mặc định hôm nay"},
                    "granularity": {"type": "string", "enum": ["day", "month"], "description": "Đơn vị gộp nhóm, mặc định day"},
                },
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_top_books",
            "description": "Sách được mượn nhiều nhất trong một khoảng thời gian, sắp xếp giảm dần theo lượt mượn.",
            "parameters": {
                "type": "object",
                "properties": {
                    "limit": {"type": "integer", "description": "Số lượng sách muốn lấy, 1-50, mặc định 10"},
                    "from_date": {"type": "string", "description": "Ngày bắt đầu dạng ISO YYYY-MM-DD"},
                    "to_date": {"type": "string", "description": "Ngày kết thúc dạng ISO YYYY-MM-DD"},
                },
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_overdue_summary",
            "description": (
                "Tổng hợp mượn quá hạn: tổng item/phiếu quá hạn, số ngày quá hạn trung bình/lâu nhất, "
                "và danh sách chi tiết từng phiếu quá hạn."
            ),
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_fine_summary",
            "description": (
                "Tổng hợp tiền phạt: tổng chưa thu/đã thu/đã miễn (waived), số khoản theo trạng thái, "
                "phân loại theo loại phạt (OVERDUE quá hạn, LOST mất sách, DAMAGE hư hỏng)."
            ),
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_warehouse_stock_risk",
            "description": (
                "Rủi ro tồn kho theo từng kho: số đầu sách tồn thấp/hết hàng, tổng "
                "available_qty/reserved_qty/borrowed_qty mỗi kho, kèm lý do rủi ro (reasoning)."
            ),
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_reorder_suggestions",
            "description": (
                "Gợi ý nhập thêm sách theo dự báo nhu cầu (forecast_7d/30d), mức ưu tiên (HIGH/MEDIUM/LOW), "
                "số lượng đề xuất (suggested_reorder_qty) và lý do (reason) từng đầu sách. Mỗi sách còn có "
                "lead_time_days (thời gian chờ hàng dùng để tính toán), lead_time_source (LEARNED = trung vị "
                "lịch sử giao hàng thực tế, SUPPLIER_DECLARED = cam kết của nhà cung cấp, DEFAULT = giá trị "
                "mặc định, REQUESTED = do người hỏi chỉ định) và lead_time_samples (số lần giao đã đo). Công "
                "cụ chính cho câu hỏi nên nhập sách gì, kho nào cần ưu tiên."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "days": {"type": "integer", "description": "Số ngày lịch sử dùng để tính nhu cầu, 1-365, mặc định 30"},
                    "limit": {"type": "integer", "description": "Số lượng đầu sách tối đa muốn lấy, 1-100, mặc định 20"},
                    "lead_time_days": {"type": "integer", "description": "Ép thời gian chờ hàng (ngày) cho mọi sách. Bỏ trống để hệ thống tự học từ lịch sử giao hàng thực tế của từng sách/nhà cung cấp"},
                    "priority": {
                        "type": "string",
                        "enum": ["ALL", "HIGH", "MEDIUM", "LOW"],
                        "description": "Lọc theo mức độ ưu tiên, mặc định ALL",
                    },
                },
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_reservation_funnel",
            "description": (
                "Phễu chuyển đổi reservation: tổng số, số lượng theo trạng thái (pending, confirmed, "
                "ready_for_pickup, converted_to_loan, cancelled, expired) và tỷ lệ chuyển đổi sang loan."
            ),
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "search_books",
            "description": (
                "Tìm sách theo từ khóa tự do HOẶC theo ngữ nghĩa: tên sách, tác giả, thể loại, ISBN, "
                "hoặc chủ đề/nội dung mô tả sách. Tìm được cả khi câu hỏi diễn đạt khác từ ngữ trong mô tả "
                "(ví dụ hỏi 'sách dạy trẻ tự lập' vẫn ra sách có mô tả 'kỹ năng sống cho bé'). Trả về sách "
                "phù hợp nhất kèm mô tả/tóm tắt để trả lời câu hỏi về nội dung sách."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "Từ khóa tìm kiếm: tên sách, tác giả, hoặc chủ đề"},
                },
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_aging_inventory",
            "description": (
                "Sách tồn kho lâu ngày không có hoạt động xuất/nhập (aging/dead stock): tên sách, kho, "
                "số lượng tồn, số ngày không hoạt động. Dùng khi hỏi về sách tồn lâu, hàng ế, không ai mượn."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "days": {"type": "integer", "description": "Ngưỡng số ngày không hoạt động, 1-365, mặc định 90"},
                    "limit": {"type": "integer", "description": "Số lượng đầu sách tối đa, 1-200, mặc định 50"},
                },
                "required": [],
            },
        },
    },
]
