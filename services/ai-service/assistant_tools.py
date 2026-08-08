from __future__ import annotations

import os
from typing import Any, Awaitable, Callable

import httpx

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


TOOL_FUNCTIONS: dict[str, Callable[..., Awaitable[dict]]] = {
    "get_dashboard_kpis": get_dashboard_kpis,
    "get_borrow_trends": get_borrow_trends,
    "get_top_books": get_top_books,
    "get_overdue_summary": get_overdue_summary,
    "get_fine_summary": get_fine_summary,
    "get_warehouse_stock_risk": get_warehouse_stock_risk,
    "get_reorder_suggestions": get_reorder_suggestions,
    "get_reservation_funnel": get_reservation_funnel,
}


ANALYTICS_TOOLS: list[dict] = [
    {
        "type": "function",
        "function": {
            "name": "get_dashboard_kpis",
            "description": (
                "Lấy KPI tổng quan thư viện: tổng đầu sách, tổng bản sao, số phiếu mượn đang mở, "
                "số phiếu quá hạn, số reservation theo trạng thái (pending/confirmed/ready for pickup), "
                "số pickup code sắp hết hạn, tổng tiền phạt chưa thu, số biến thể tồn kho thấp, "
                "tỷ lệ chuyển đổi reservation sang loan."
            ),
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_borrow_trends",
            "description": "Lấy xu hướng số lượt mượn/trả/đặt sách theo từng ngày hoặc từng tháng trong một khoảng thời gian.",
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
            "description": "Lấy danh sách sách được mượn nhiều nhất trong một khoảng thời gian, sắp xếp giảm dần theo số lượt mượn.",
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
                "Lấy tổng hợp các khoản mượn quá hạn: tổng số item quá hạn, tổng số phiếu mượn quá hạn, "
                "số ngày quá hạn trung bình, số ngày quá hạn lâu nhất, và danh sách chi tiết từng phiếu quá hạn."
            ),
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_fine_summary",
            "description": (
                "Lấy tổng hợp tiền phạt: tổng tiền chưa thu, đã thu, đã miễn (waived), số khoản theo từng trạng thái, "
                "và phân loại theo loại phạt (OVERDUE quá hạn, LOST mất sách, DAMAGE hư hỏng)."
            ),
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_warehouse_stock_risk",
            "description": (
                "Lấy rủi ro tồn kho theo từng kho: số đầu sách tồn kho thấp, số đầu sách hết hàng, "
                "tổng available_qty/reserved_qty/borrowed_qty của từng kho, kèm giải thích lý do rủi ro (reasoning)."
            ),
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_reorder_suggestions",
            "description": (
                "Lấy gợi ý nhập thêm sách dựa trên dự báo nhu cầu (forecast_7d, forecast_30d), mức độ ưu tiên "
                "(HIGH/MEDIUM/LOW), số lượng đề xuất nhập (suggested_reorder_qty) và lý do (reason) cho từng đầu sách. "
                "Đây là công cụ chính để trả lời câu hỏi về việc nên nhập thêm sách nào, kho nào cần ưu tiên."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "days": {"type": "integer", "description": "Số ngày lịch sử dùng để tính nhu cầu, 1-365, mặc định 30"},
                    "limit": {"type": "integer", "description": "Số lượng đầu sách tối đa muốn lấy, 1-100, mặc định 20"},
                    "lead_time_days": {"type": "integer", "description": "Thời gian chờ hàng về (lead time) tính bằng ngày, mặc định 14"},
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
                "Lấy phễu chuyển đổi reservation: tổng số reservation, số lượng theo từng trạng thái "
                "(pending, confirmed, ready_for_pickup, converted_to_loan, cancelled, expired) và tỷ lệ chuyển đổi sang loan."
            ),
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
]
