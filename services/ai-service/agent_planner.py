from __future__ import annotations

from datetime import datetime, timezone

from agent_actions import (
    CREATE_REORDER_DRAFT,
    CREATE_REPORT_DRAFT,
    CREATE_RESERVATION_DRAFT,
    CREATE_STOCK_ALERT,
    CREATE_STAFF_TASK_DRAFT,
    RISK_LOW,
    RISK_MEDIUM,
)
from agent_schemas import UserContext
from intent import (
    BOOK_SEARCH_QUERY,
    BORROW_TREND_QUERY,
    DASHBOARD_SUMMARY_QUERY,
    FINE_SUMMARY_QUERY,
    LOW_STOCK_QUERY,
    OVERDUE_LOAN_QUERY,
    REORDER_SUGGESTION_QUERY,
    RESERVATION_QUERY,
    normalize_text,
)

# ── Action-trigger keywords ────────────────────────────────────────────────────
_WANTS_ACTION_KEYWORDS = [
    "tao", "lap", "sinh", "tao giup", "lap giup", "lam giup", "dat giup",
    "xuat", "canh bao", "nhac staff", "giao viec", "tao task", "tao nhiem vu",
    "create", "generate", "reserve", "assign", "task",
    "de xuat", "nhap them", "bao cao", "report",
    # Reservation triggers
    "dat sach", "giu sach", "dat cho", "muon sach", "dang ky muon",
    "reservation", "reserve",
    # Alert triggers
    "canh bao", "alert", "nhac",
]

_REORDER_KEYWORDS = [
    "de xuat nhap", "tao de xuat", "purchase request", "nhap them", "dat mua",
    "tao don nhap", "can nhap", "nhan nhap",
]

_REPORT_KEYWORDS = [
    "bao cao", "report", "tong hop thanh bao cao", "xuat bao cao", "tong hop",
    "lap bao cao", "tao bao cao", "generate report",
]

_RESERVATION_KEYWORDS = [
    "dat sach", "giu sach", "reserve", "reservation", "dat giup",
    "dat cho", "dang ky muon", "muon sach",
]

_STOCK_ALERT_KEYWORDS = [
    "canh bao", "alert", "nhac", "thong bao", "ton kho thap", "het hang",
    "stock alert", "low stock alert", "bao dong", "out of stock",
]

_STAFF_TASK_KEYWORDS = [
    "tao task", "giao viec", "nhac staff", "tao nhiem vu", "assign staff",
    "staff task", "nhiem vu", "giao nhiem vu", "phan cong",
]

_INTENT_LABELS: dict[str, str] = {
    DASHBOARD_SUMMARY_QUERY: "Tổng quan thư viện",
    LOW_STOCK_QUERY: "Tồn kho thấp",
    REORDER_SUGGESTION_QUERY: "Gợi ý nhập thêm",
    OVERDUE_LOAN_QUERY: "Sách quá hạn",
    FINE_SUMMARY_QUERY: "Tổng hợp phạt",
    BORROW_TREND_QUERY: "Xu hướng mượn",
    RESERVATION_QUERY: "Đặt chỗ",
    BOOK_SEARCH_QUERY: "Tìm sách",
}


def _contains_any(text: str, keywords: list[str]) -> bool:
    return any(kw in text for kw in keywords)


def _wants_action(normalized: str) -> bool:
    return _contains_any(normalized, _WANTS_ACTION_KEYWORDS)


def _int_safe(value, default: int = 0) -> int:
    try:
        return int(float(value)) if value is not None else default
    except (TypeError, ValueError):
        return default


def _get_item_field(item: dict, *keys) -> object:
    for key in keys:
        if key in item and item[key] is not None:
            return item[key]
    return None


# ── Builder helpers ────────────────────────────────────────────────────────────

def _build_reorder_draft(
    message: str,
    intent_info: dict,
    raw: dict,
    sources: list[dict],
    warnings: list[str],
    user_context: UserContext | None,
) -> dict | None:
    reorder_data = raw.get("Reorder Suggestions") or {}
    if isinstance(reorder_data, dict):
        items_raw = reorder_data.get("items") or []
    else:
        items_raw = reorder_data if isinstance(reorder_data, list) else []

    low_stock = raw.get("low_stock_books") or []
    if not isinstance(low_stock, list):
        low_stock = []

    items = []
    for row in items_raw:
        if not isinstance(row, dict):
            continue
        item = {
            "book_id": _get_item_field(row, "book_id", "id"),
            "book_variant_id": _get_item_field(row, "book_variant_id", "variant_id"),
            "title": _get_item_field(row, "title", "book_title") or "Unknown",
            "current_stock": _int_safe(_get_item_field(row, "available_qty", "current_stock", "quantity", "stock")),
            "forecast_30d": _int_safe(_get_item_field(row, "forecast_30d")),
            "suggested_quantity": _int_safe(_get_item_field(row, "suggested_reorder_qty", "suggested_quantity", "reorder_qty")) or 1,
            "priority": _get_item_field(row, "priority") or "LOW",
            "reason": _get_item_field(row, "reason") or "LOW_STOCK",
        }
        items.append(item)

    # Fill from low_stock_books if no reorder items
    if not items:
        for book in low_stock[:10]:
            if not isinstance(book, dict):
                continue
            items.append({
                "book_id": _get_item_field(book, "id", "book_id"),
                "book_variant_id": _get_item_field(book, "variant_id"),
                "title": book.get("title") or "Unknown",
                "current_stock": _int_safe(_get_item_field(book, "quantity", "available_qty")),
                "forecast_30d": 0,
                "suggested_quantity": max(5, 10 - _int_safe(_get_item_field(book, "quantity", "available_qty"))),
                "priority": "HIGH" if _int_safe(_get_item_field(book, "quantity", "available_qty")) == 0 else "MEDIUM",
                "reason": "LOW_STOCK",
            })

    if not items:
        return None

    action_warnings = list(warnings or [])
    requires_review = False
    payload_warnings = []

    if not any(item.get("book_variant_id") for item in items):
        requires_review = True
        payload_warnings.append("Missing book_variant_id for most items. Staff must verify before executing real purchase request.")

    payload_warnings.append("Missing warehouse_id. User/staff must choose warehouse before executing real purchase request.")
    requires_review = True

    return {
        "type": CREATE_REORDER_DRAFT,
        "summary": f"Tạo đề xuất nhập {len(items)} đầu sách từ dữ liệu tồn kho",
        "payload": {
            "items": items[:10],
            "warehouse_id": None,
            "reason": "LOW_STOCK",
            "note": f"Tạo bởi SmartBook AI Agent từ intent {intent_info.get('intent')}.",
            "source_intent": intent_info.get("intent"),
            "sources": [s.get("name") for s in sources if s.get("status") == "ok"],
            "created_from_message": message,
        },
        "risk": RISK_MEDIUM,
        "sources": sources,
        "intent": intent_info.get("intent"),
        "warnings": action_warnings + payload_warnings,
        "requires_review": requires_review,
    }


def _build_report_draft(
    message: str,
    intent_info: dict,
    retrieval: dict,
    user_context: UserContext | None,
) -> dict | None:
    intent = intent_info.get("intent", "GENERAL_QUERY")
    intent_label = _INTENT_LABELS.get(intent, intent)
    now_str = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    sources = retrieval.get("sources") or []
    warnings = retrieval.get("warnings") or []
    summary_text = retrieval.get("summary") or "Không có dữ liệu retrieval."

    source_lines = "\n".join(
        f"- {s.get('name', '?')}: {s.get('status', '?')}"
        for s in sources
    ) or "- Không có nguồn dữ liệu."

    warning_lines = "\n".join(f"- {w}" for w in warnings) if warnings else "- Không có cảnh báo."

    report_markdown = f"""# Báo cáo SmartBook AI

## 1. Phạm vi
- Intent: {intent_label}
- Thời gian tạo: {now_str}
- Câu hỏi gốc: {message}

## 2. Nguồn dữ liệu
{source_lines}

## 3. Tóm tắt dữ liệu
{summary_text}

## 4. Cảnh báo
{warning_lines}

## 5. Đề xuất hành động
- Xem xét các số liệu trên và phối hợp với bộ phận liên quan để ra quyết định.
- Nếu có sách tồn kho thấp, cân nhắc tạo purchase request.
- Nếu có khoản phạt chưa thu, liên hệ khách hàng.
- Nếu có sách quá hạn, gửi nhắc nhở.
"""

    return {
        "type": CREATE_REPORT_DRAFT,
        "summary": f"Tạo báo cáo: {intent_label}",
        "payload": {
            "report_title": f"Báo cáo SmartBook AI — {intent_label}",
            "report_markdown": report_markdown,
            "intent": intent,
            "sources": sources,
            "retrieval_summary": summary_text,
            "retrieval_warnings": warnings,
            "generated_at": now_str,
        },
        "risk": RISK_LOW,
        "sources": sources,
        "intent": intent,
        "warnings": [],
        "requires_review": False,
    }


def _build_reservation_draft(
    message: str,
    intent_info: dict,
    raw: dict,
    sources: list[dict],
    user_context: UserContext | None,
) -> dict | None:
    query = intent_info.get("query") or message
    catalog = raw.get("Catalog Books") or []
    if not isinstance(catalog, list):
        catalog = []

    book_id = None
    variant_id = None
    warehouse_id = None
    found_title = query

    if catalog:
        first = catalog[0] if isinstance(catalog[0], dict) else {}
        book_id = first.get("id") or first.get("book_id")
        variant_id = first.get("variant_id")
        found_title = first.get("title") or query
        # warehouse_id may come from stock_balances
        variants = first.get("variants") or first.get("book_variants") or []
        if isinstance(variants, list) and variants:
            balances = variants[0].get("stock_balances") or [] if isinstance(variants[0], dict) else []
            if isinstance(balances, list) and balances and isinstance(balances[0], dict):
                warehouse_id = balances[0].get("warehouse_id")

    requires_review = not (variant_id and warehouse_id)
    warnings = []
    if not variant_id:
        warnings.append("Missing book_variant_id. Cannot confirm real reservation without variant_id.")
    if not warehouse_id:
        warnings.append("Missing warehouse_id. Cannot confirm real reservation without warehouse_id.")

    user_roles = {r.upper().replace("-", "_") for r in (user_context.roles if user_context else [])}
    requires_customer_selection = bool(
        user_roles & {"ADMIN", "WAREHOUSE_MANAGER", "LIBRARIAN", "WAREHOUSE_STAFF"} and not (user_context and user_context.user_id)
    )

    return {
        "type": CREATE_RESERVATION_DRAFT,
        "summary": f"Tạo đặt chỗ sách '{found_title}'",
        "payload": {
            "title_query": query,
            "book_id": book_id,
            "book_variant_id": variant_id,
            "variant_id": variant_id,
            "warehouse_id": warehouse_id,
            "quantity": 1,
            "pickup_location_id": None,
            "notes": f"Tạo bởi SmartBook AI Agent. Câu hỏi gốc: {message}",
            "source_channel": "AI_ASSISTANT",
            "requires_customer_selection": requires_customer_selection,
            "requires_review": requires_review,
        },
        "risk": RISK_MEDIUM,
        "sources": sources,
        "intent": intent_info.get("intent"),
        "warnings": warnings,
        "requires_review": requires_review,
    }


def _build_stock_alert(
    message: str,
    intent_info: dict,
    raw: dict,
    sources: list[dict],
    user_context: UserContext | None,
) -> dict | None:
    low_stock = raw.get("low_stock_books") or []
    if not isinstance(low_stock, list):
        low_stock = []

    stock_risk = raw.get("Warehouse Stock Risk") or []
    if not isinstance(stock_risk, list):
        stock_risk = []

    items = []
    for book in low_stock[:10]:
        if not isinstance(book, dict):
            continue
        qty = _int_safe(_get_item_field(book, "quantity", "available_qty"))
        items.append({
            "book_id": _get_item_field(book, "id", "book_id"),
            "book_variant_id": _get_item_field(book, "variant_id"),
            "title": book.get("title") or "Unknown",
            "current_stock": qty,
            "threshold": 10,
            "priority": "HIGH" if qty == 0 else "MEDIUM",
            "reason": "OUT_OF_STOCK" if qty == 0 else "LOW_STOCK",
            "suggested_action": "Tạo purchase request ngay" if qty == 0 else "Xem xét nhập thêm",
        })

    if not items and stock_risk:
        for row in stock_risk[:10]:
            if not isinstance(row, dict):
                continue
            items.append({
                "book_id": None,
                "book_variant_id": None,
                "title": row.get("book_title") or row.get("title") or "Unknown",
                "current_stock": _int_safe(_get_item_field(row, "available_qty", "quantity")),
                "threshold": 10,
                "priority": "HIGH",
                "reason": "LOW_STOCK",
                "suggested_action": "Kiểm tra và nhập thêm",
            })

    if not items:
        items = [{"message": "Không có dữ liệu tồn kho thấp trong context hiện tại."}]

    high_count = sum(1 for it in items if isinstance(it, dict) and it.get("priority") == "HIGH")
    severity = "HIGH" if high_count > 0 else "MEDIUM"

    return {
        "type": CREATE_STOCK_ALERT,
        "summary": f"Tạo cảnh báo tồn kho {len([i for i in items if isinstance(i, dict) and i.get('title')])} đầu sách",
        "payload": {
            "alert_type": "OUT_OF_STOCK" if severity == "HIGH" else "LOW_STOCK",
            "items": items,
            "severity": severity,
            "sources": [s.get("name") for s in sources if s.get("status") == "ok"],
            "target_roles": ["WAREHOUSE_MANAGER", "WAREHOUSE_STAFF"],
        },
        "risk": RISK_LOW,
        "sources": sources,
        "intent": intent_info.get("intent"),
        "warnings": [],
        "requires_review": False,
    }


def _build_staff_task_draft(
    message: str,
    intent_info: dict,
    raw: dict,
    sources: list[dict],
    user_context: UserContext | None,
) -> dict | None:
    intent = intent_info.get("intent", "")
    normalized_msg = normalize_text(message)

    task_type = "GENERAL_LIBRARY_TASK"
    if intent == LOW_STOCK_QUERY or intent == REORDER_SUGGESTION_QUERY:
        task_type = "REVIEW_LOW_STOCK"
    elif intent == OVERDUE_LOAN_QUERY:
        task_type = "REVIEW_OVERDUE"
    elif intent == FINE_SUMMARY_QUERY:
        task_type = "REVIEW_FINE"
    elif intent == RESERVATION_QUERY:
        task_type = "FOLLOW_UP_RESERVATION"
    elif _contains_any(normalized_msg, ["nhap", "nhap sach", "reorder"]):
        task_type = "REVIEW_REORDER"

    task_title_map = {
        "REVIEW_LOW_STOCK": "Kiểm tra và xử lý sách tồn kho thấp",
        "REVIEW_REORDER": "Xem xét đề xuất nhập sách mới",
        "FOLLOW_UP_RESERVATION": "Theo dõi và xử lý đặt chỗ",
        "REVIEW_OVERDUE": "Xử lý sách quá hạn trả",
        "REVIEW_FINE": "Kiểm tra và thu phạt tồn đọng",
        "GENERAL_LIBRARY_TASK": "Nhiệm vụ thư viện tổng quát",
    }

    related_items = []
    low_stock = raw.get("low_stock_books") or []
    if isinstance(low_stock, list):
        related_items = [
            {"title": b.get("title"), "quantity": _int_safe(_get_item_field(b, "quantity", "available_qty"))}
            for b in low_stock[:5]
            if isinstance(b, dict)
        ]

    return {
        "type": CREATE_STAFF_TASK_DRAFT,
        "summary": f"Tạo task cho staff: {task_title_map.get(task_type, task_type)}",
        "payload": {
            "task_title": task_title_map.get(task_type, "Nhiệm vụ thư viện"),
            "task_type": task_type,
            "assignee_role": "WAREHOUSE_STAFF",
            "assignee_user_id": None,
            "priority": "HIGH" if task_type in ("REVIEW_LOW_STOCK", "REVIEW_OVERDUE") else "MEDIUM",
            "due_date": None,
            "related_action_type": intent,
            "related_items": related_items,
            "suggested_route": "/inventory/purchase-requests" if "REORDER" in task_type or "STOCK" in task_type else "/borrow/loans",
            "instructions": f"Kiểm tra và xử lý theo yêu cầu AI: {message[:200]}",
            "sources": [s.get("name") for s in sources if s.get("status") == "ok"],
        },
        "risk": RISK_MEDIUM,
        "sources": sources,
        "intent": intent,
        "warnings": [],
        "requires_review": False,
    }


# ── Main planner entry point ──────────────────────────────────────────────────

def plan_agent_action(
    message: str,
    intent_info: dict,
    retrieval: dict,
    user_context: UserContext | None,
) -> dict | None:
    """Deterministically plan an agent action from message + intent + retrieval context.

    Returns a dict describing the planned action, or None if no action is needed.
    Never calls any LLM.
    """
    normalized = normalize_text(message)

    if not _wants_action(normalized):
        return None

    intent = intent_info.get("intent", "")
    raw = retrieval.get("raw") or {}
    sources = retrieval.get("sources") or []
    warnings = retrieval.get("warnings") or []

    # Staff task: check first so "tao task + low stock" doesn't accidentally become just a stock alert
    if _contains_any(normalized, _STAFF_TASK_KEYWORDS):
        return _build_staff_task_draft(message, intent_info, raw, sources, user_context)

    # Reorder draft: explicit reorder intent or keywords
    if intent == REORDER_SUGGESTION_QUERY or _contains_any(normalized, _REORDER_KEYWORDS):
        result = _build_reorder_draft(message, intent_info, raw, sources, warnings, user_context)
        if result:
            return result

    # Report draft
    if _contains_any(normalized, _REPORT_KEYWORDS):
        return _build_report_draft(message, intent_info, retrieval, user_context)

    # Reservation draft
    if _contains_any(normalized, _RESERVATION_KEYWORDS) or intent == RESERVATION_QUERY:
        result = _build_reservation_draft(message, intent_info, raw, sources, user_context)
        if result:
            return result

    # Stock alert
    if _contains_any(normalized, _STOCK_ALERT_KEYWORDS):
        return _build_stock_alert(message, intent_info, raw, sources, user_context)

    return None
