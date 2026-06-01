from __future__ import annotations

import logging
import os
import re
import unicodedata
from datetime import datetime, timezone

import httpx

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
    # Vietnamese "create purchase request" phrases
    "phieu nhap", "tao phieu nhap", "phieu yeu cau nhap", "nhap sach", "yeu cau nhap",
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


_GATEWAY_URL = os.getenv("SMARTBOOK_GATEWAY_URL", "http://api-gateway:3000").rstrip("/")
_planner_logger = logging.getLogger("uvicorn.error")

# Abbreviation → normalized expansion keywords for Vietnamese cities
_WAREHOUSE_ABBREV_MAP: dict[str, list[str]] = {
    "hn": ["ha noi", "hanoi"],
    "hni": ["ha noi", "hanoi"],
    "hcm": ["ho chi minh", "saigon", "sai gon", "tphcm"],
    "dn": ["da nang"],
    "ct": ["can tho"],
    "hp": ["hai phong"],
    "hue": ["hue", "thua thien"],
    "bd": ["binh duong"],
    "bn": ["bac ninh"],
    "vt": ["vung tau"],
    "dl": ["da lat"],
}


def _norm_wh(text: str) -> str:
    """Normalize for warehouse matching: lowercase, strip Vietnamese diacritics, collapse separators."""
    t = unicodedata.normalize("NFD", text.lower().strip())
    t = "".join(c for c in t if unicodedata.category(c) != "Mn")
    # đ/Đ doesn't decompose in NFD — handle explicitly
    t = t.replace("đ", "d")  # đ → d
    return re.sub(r"[-_.\s]+", " ", t).strip()


def _word_match(needle: str, haystack: str) -> bool:
    """True if needle appears as a whole word in haystack or vice versa."""
    return f" {needle} " in f" {haystack} " or f" {haystack} " in f" {needle} "


def _resolve_warehouse_hint_against_db(hint: str, warehouses: list[dict]) -> dict:
    """Match user warehouse hint against actual warehouse list from DB.

    Returns {"status": "RESOLVED"|"AMBIGUOUS"|"NOT_FOUND", "warehouse": dict|None, "candidates": list}
    """
    if not hint or not warehouses:
        return {"status": "NOT_FOUND", "warehouse": None, "candidates": []}

    norm_hint = _norm_wh(hint)

    # 1. Exact code match (highest priority — e.g. user typed "WH-HN" exactly)
    exact = [w for w in warehouses if _norm_wh(w.get("code", "")) == norm_hint]
    if len(exact) == 1:
        return {"status": "RESOLVED", "warehouse": exact[0], "candidates": []}

    # 2. Expand abbreviations so "hn" also matches "ha noi" etc.
    expanded: set[str] = {norm_hint}
    for abbrev, expansions in _WAREHOUSE_ABBREV_MAP.items():
        if norm_hint == abbrev or norm_hint in expansions:
            expanded.update(expansions)
            expanded.add(abbrev)

    # 3. Check code, name, province, district of each warehouse using whole-word matching
    #    to avoid false positives (e.g. "ct" matching "district").
    matches: list[dict] = []
    for w in warehouses:
        wh_texts = [
            t for t in [
                _norm_wh(w.get("code", "")),
                _norm_wh(w.get("name", "")),
                _norm_wh(w.get("province", "") or ""),
                _norm_wh(w.get("district", "") or ""),
            ] if t
        ]
        for h in expanded:
            if any(_word_match(h, t) for t in wh_texts):
                matches.append(w)
                break

    if len(matches) == 1:
        return {"status": "RESOLVED", "warehouse": matches[0], "candidates": []}
    if len(matches) > 1:
        return {"status": "AMBIGUOUS", "warehouse": None, "candidates": matches}
    return {"status": "NOT_FOUND", "warehouse": None, "candidates": []}


async def _fetch_active_warehouses(auth_header: str | None) -> list[dict]:
    """Fetch active warehouses from Gateway /api/warehouses."""
    if not auth_header:
        return []
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(8.0)) as client:
            resp = await client.get(
                f"{_GATEWAY_URL}/api/warehouses",
                headers={"Authorization": auth_header},
            )
            if resp.status_code == 200:
                data = resp.json()
                all_wh = data if isinstance(data, list) else (data.get("data") or [])
                return [w for w in all_wh if isinstance(w, dict) and w.get("is_active", True)]
    except Exception as exc:
        _planner_logger.warning("Failed to fetch warehouses for hint resolution: %s", exc)
    return []


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


def _detect_warehouse_hint(normalized_msg: str) -> str | None:
    """Extract a warehouse name/code hint from the user message (normalized).
    Returns the extracted hint string (for fuzzy matching), or None if not found.

    Examples:
      "tao phieu nhap kho ha noi"   → "ha noi"
      "kho hcm can nhap them sach"  → "hcm"
      "nha cung cap o kho hn"       → "hn"
    """
    # Common warehouse-related stop words to remove before matching
    _WAREHOUSE_STOPWORDS = [
        "kho", "tai", "cho", "o", "theo", "trong", "cua", "thuoc",
        "tao", "phieu", "nhap", "sach", "nha", "cung", "cap",
        "nhà", "cung", "cấp", "phiếu", "nhập", "sách",
    ]
    # Try to find the word after "kho" in message
    words = normalized_msg.split()
    for i, word in enumerate(words):
        if word == "kho" and i + 1 < len(words):
            # The word(s) after "kho" are likely the warehouse name/code
            # Take up to 3 words after "kho"
            hint_words = []
            for j in range(i + 1, min(i + 4, len(words))):
                if words[j] in _WAREHOUSE_STOPWORDS:
                    break
                hint_words.append(words[j])
            if hint_words:
                return " ".join(hint_words)

    # Fallback: look for known warehouse code patterns (2–6 uppercase-like chars)
    import re
    codes = re.findall(r'\b(wh[-_]?\w+|hcm|hn|hni|can\s*tho|da\s*nang|branch\s*\w*)\b', normalized_msg)
    if codes:
        return codes[0].strip()

    return None


def _filter_items_by_warehouse_hint(
    items: list[dict],
    hint: str | None,
) -> tuple[list[dict], str | None]:
    """Filter items with warehouse_id to only those matching the warehouse hint.
    Returns (filtered_items, matched_warehouse_name).
    If hint is None or no match found, returns original items unchanged.
    """
    if not hint or not items:
        return items, None

    normalized_hint = normalize_text(hint)
    if len(normalized_hint) < 2:
        return items, None

    items_with_wh = [it for it in items if it.get("warehouse_id")]
    items_no_wh = [it for it in items if not it.get("warehouse_id")]

    matched = []
    matched_name = None
    for it in items_with_wh:
        wh_text = normalize_text(
            (it.get("warehouse_name") or "") + " " +
            (it.get("warehouse_code") or "")
        )
        if normalized_hint in wh_text or any(w in wh_text for w in normalized_hint.split() if len(w) >= 2):
            matched.append(it)
            if not matched_name:
                matched_name = it.get("warehouse_name") or it.get("warehouse_code")

    if not matched:
        # No items matched the hint — return all items unchanged
        return items, None

    # Return only matching warehouse items + items without warehouse (need fallback)
    return matched + items_no_wh, matched_name


# ── Builder helpers ────────────────────────────────────────────────────────────

async def _build_reorder_draft(
    message: str,
    intent_info: dict,
    raw: dict,
    sources: list[dict],
    warnings: list[str],
    user_context: UserContext | None,
    auth_header: str | None = None,
) -> dict | None:
    # Priority 1: Per-warehouse low-stock data (has variant_id + warehouse_id per item)
    low_stock_by_wh = raw.get("low_stock_by_warehouse") or []
    if not isinstance(low_stock_by_wh, list):
        low_stock_by_wh = []

    # Priority 2: Reorder suggestions from analytics (has variant_id but no warehouse_id)
    reorder_data = raw.get("Reorder Suggestions") or {}
    if isinstance(reorder_data, dict):
        items_raw = reorder_data.get("items") or []
    else:
        items_raw = reorder_data if isinstance(reorder_data, list) else []

    # Priority 3: Catalog low-stock books (may have variant_id but no warehouse)
    low_stock = raw.get("low_stock_books") or []
    if not isinstance(low_stock, list):
        low_stock = []

    items = []

    # Build from per-warehouse data first (best quality: has variant_id + warehouse_id)
    seen_variant_warehouse = set()
    for row in low_stock_by_wh[:20]:
        if not isinstance(row, dict):
            continue
        variant_id = row.get("variant_id")
        warehouse_id = row.get("warehouse_id")
        # Deduplicate by (variant_id, warehouse_id)
        key = (str(variant_id), str(warehouse_id))
        if key in seen_variant_warehouse:
            continue
        seen_variant_warehouse.add(key)
        items.append({
            "book_id": row.get("book_id"),
            "book_variant_id": variant_id,
            "title": row.get("title") or "Unknown",
            "isbn": row.get("isbn"),
            "current_stock": _int_safe(row.get("available_qty")),
            "reorder_point": _int_safe(row.get("reorder_point")),
            "suggested_quantity": _int_safe(row.get("suggested_quantity")) or 1,
            "priority": row.get("priority") or "MEDIUM",
            "reason": row.get("reason") or "LOW_STOCK",
            # Per-item warehouse — executor uses this directly
            "warehouse_id": warehouse_id,
            "warehouse_name": row.get("warehouse_name"),
            "warehouse_code": row.get("warehouse_code"),
            # Suggested supplier from supplier_variants lookup (null if no record)
            "suggested_supplier_id": row.get("suggested_supplier_id"),
            "suggested_supplier_name": row.get("suggested_supplier_name"),
            "suggested_supplier_code": row.get("suggested_supplier_code"),
        })

    # Supplement from reorder suggestions if needed (adds variant_id, no warehouse)
    if len(items) < 10:
        seen_variants = {it.get("book_variant_id") for it in items if it.get("book_variant_id")}
        for row in items_raw:
            if not isinstance(row, dict):
                continue
            variant_id = _get_item_field(row, "book_variant_id", "variant_id")
            if variant_id in seen_variants:
                continue  # already have per-warehouse entry
            seen_variants.add(variant_id)
            items.append({
                "book_id": _get_item_field(row, "book_id", "id"),
                "book_variant_id": variant_id,
                "title": _get_item_field(row, "title", "book_title") or "Unknown",
                "current_stock": _int_safe(_get_item_field(row, "available_qty", "current_stock")),
                "forecast_30d": _int_safe(_get_item_field(row, "forecast_30d")),
                "suggested_quantity": _int_safe(_get_item_field(row, "suggested_reorder_qty", "suggested_quantity")) or 1,
                "priority": _get_item_field(row, "priority") or "LOW",
                "reason": _get_item_field(row, "reason") or "LOW_STOCK",
                # No warehouse_id — user must select fallback warehouse
                "warehouse_id": None,
            })
            if len(items) >= 10:
                break

    # Last resort: catalog low_stock_books
    if not items:
        for book in low_stock[:10]:
            if not isinstance(book, dict):
                continue
            items.append({
                "book_id": _get_item_field(book, "id", "book_id"),
                "book_variant_id": _get_item_field(book, "variant_id"),
                "title": book.get("title") or "Unknown",
                "current_stock": _int_safe(_get_item_field(book, "quantity", "available_qty")),
                "suggested_quantity": max(5, 10 - _int_safe(_get_item_field(book, "quantity", "available_qty"))),
                "priority": "HIGH" if _int_safe(_get_item_field(book, "quantity", "available_qty")) == 0 else "MEDIUM",
                "reason": "LOW_STOCK",
                "warehouse_id": None,
            })

    if not items:
        return None

    # ── Warehouse resolution via DB API ──────────────────────────────────────────
    normalized_msg = normalize_text(message)
    warehouse_hint = _detect_warehouse_hint(normalized_msg)

    warehouse_resolution_status: str = "NONE"   # no hint → no DB lookup needed
    resolved_warehouse: dict | None = None
    warehouse_candidates: list[dict] = []

    if warehouse_hint:
        db_warehouses = await _fetch_active_warehouses(auth_header)
        resolution = _resolve_warehouse_hint_against_db(warehouse_hint, db_warehouses)
        warehouse_resolution_status = resolution["status"]
        resolved_warehouse = resolution.get("warehouse")
        warehouse_candidates = resolution.get("candidates") or []

        if warehouse_resolution_status == "RESOLVED":
            # Override ALL items to the warehouse the user explicitly asked for
            rw_id = resolved_warehouse["id"]
            rw_code = resolved_warehouse.get("code", "")
            rw_name = resolved_warehouse.get("name", "")
            items = [
                {**it, "warehouse_id": rw_id, "warehouse_code": rw_code, "warehouse_name": rw_name}
                for it in items
            ]
        # AMBIGUOUS / NOT_FOUND: keep items as-is; executor will block creation
    else:
        # No warehouse hint — apply the original per-item filter (no-op when hint is None)
        filtered_items, _ = _filter_items_by_warehouse_hint(items, None)

    action_warnings = list(warnings or [])
    payload_warnings = []

    items_with_variant = [it for it in items if it.get("book_variant_id")]
    items_with_warehouse = [it for it in items if it.get("warehouse_id")]
    items_missing_warehouse = [it for it in items if not it.get("warehouse_id")]
    items_missing_variant = [it for it in items if not it.get("book_variant_id")]

    requires_review = bool(items_missing_warehouse) or warehouse_resolution_status in ("AMBIGUOUS", "NOT_FOUND")

    if warehouse_resolution_status == "RESOLVED":
        payload_warnings.append(
            f"Đã xác định kho: {resolved_warehouse.get('code')} — {resolved_warehouse.get('name')} "
            f"(từ yêu cầu '{warehouse_hint}')."
        )
    elif warehouse_resolution_status == "AMBIGUOUS":
        cand_names = ", ".join(
            f"{w.get('code')} ({w.get('name')})" for w in warehouse_candidates[:5]
        )
        payload_warnings.append(
            f"Tìm thấy {len(warehouse_candidates)} kho khớp với '{warehouse_hint}': {cand_names}. "
            "Vui lòng chọn đúng kho cần tạo phiếu."
        )
    elif warehouse_resolution_status == "NOT_FOUND":
        payload_warnings.append(
            f"Không tìm thấy kho phù hợp với '{warehouse_hint}'. "
            "Vui lòng chọn kho từ danh sách."
        )
    if items_missing_variant:
        payload_warnings.append(
            f"{len(items_missing_variant)} sách thiếu book_variant_id — sẽ bị bỏ qua khi tạo phiếu."
        )
    if items_missing_warehouse and warehouse_resolution_status not in ("AMBIGUOUS", "NOT_FOUND"):
        payload_warnings.append(
            f"{len(items_missing_warehouse)} sách chưa xác định được kho — "
            "vui lòng chọn kho dự phòng bên dưới để áp dụng cho các sách này."
        )

    warehouses_covered = list({it["warehouse_code"] for it in items_with_warehouse if it.get("warehouse_code")})

    return {
        "type": CREATE_REORDER_DRAFT,
        "summary": (
            f"Tạo đề xuất nhập {len(items)} dòng sách từ {len(set(it.get('warehouse_id') for it in items_with_warehouse))} kho"
            if items_with_warehouse
            else f"Tạo đề xuất nhập {len(items)} đầu sách từ dữ liệu tồn kho"
        ),
        "payload": {
            "items": items[:20],
            "warehouse_id": None,
            "supplier_id": None,
            "supplier_name": None,
            "warehouses_covered": warehouses_covered,
            "reason": "LOW_STOCK",
            "note": f"Tạo bởi SmartBook AI Agent từ intent {intent_info.get('intent')}.",
            "source_intent": intent_info.get("intent"),
            "sources": [s.get("name") for s in sources if s.get("status") == "ok"],
            "created_from_message": message,
            # Warehouse resolution metadata
            "warehouse_resolution_status": warehouse_resolution_status,
            "warehouse_resolution_source": "USER_MESSAGE" if warehouse_hint else "AUTO",
            "warehouse_hint": warehouse_hint,
            "warehouse_candidates": [
                {"id": w["id"], "code": w.get("code"), "name": w.get("name")}
                for w in warehouse_candidates[:10]
            ],
            "resolved_warehouse_id": resolved_warehouse["id"] if resolved_warehouse else None,
            "resolved_warehouse_code": resolved_warehouse.get("code") if resolved_warehouse else None,
            "resolved_warehouse_name": resolved_warehouse.get("name") if resolved_warehouse else None,
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
    # Priority 1: Per-warehouse data (has variant_id + warehouse_id per item) — best quality
    low_stock_by_wh = raw.get("low_stock_by_warehouse") or []
    if not isinstance(low_stock_by_wh, list):
        low_stock_by_wh = []

    # Priority 2: Catalog low_stock_books (variant_id but no warehouse_id)
    low_stock = raw.get("low_stock_books") or []
    if not isinstance(low_stock, list):
        low_stock = []

    items = []
    seen_variant_warehouse: set = set()

    # Build from per-warehouse data first
    for row in low_stock_by_wh[:20]:
        if not isinstance(row, dict):
            continue
        variant_id = row.get("variant_id")
        warehouse_id = row.get("warehouse_id")
        key = (str(variant_id), str(warehouse_id))
        if key in seen_variant_warehouse:
            continue
        seen_variant_warehouse.add(key)
        qty = _int_safe(row.get("available_qty"))
        items.append({
            "book_id": row.get("book_id"),
            "book_variant_id": variant_id,
            "title": row.get("title") or "Unknown",
            "current_stock": qty,
            "threshold": _int_safe(row.get("reorder_point")) or 10,
            "priority": row.get("priority") or ("HIGH" if qty == 0 else "MEDIUM"),
            "reason": "OUT_OF_STOCK" if qty == 0 else "LOW_STOCK",
            "suggested_action": "Tạo purchase request ngay" if qty == 0 else "Xem xét nhập thêm",
            # Per-item warehouse — executor uses this directly
            "warehouse_id": warehouse_id,
            "warehouse_name": row.get("warehouse_name"),
            "warehouse_code": row.get("warehouse_code"),
        })

    # Supplement from catalog low_stock_books if needed
    if len(items) < 10:
        seen_variants = {it.get("book_variant_id") for it in items if it.get("book_variant_id")}
        for book in low_stock[:10]:
            if not isinstance(book, dict):
                continue
            variant_id = _get_item_field(book, "variant_id")
            if variant_id and variant_id in seen_variants:
                continue
            if variant_id:
                seen_variants.add(variant_id)
            qty = _int_safe(_get_item_field(book, "quantity", "available_qty"))
            items.append({
                "book_id": _get_item_field(book, "id", "book_id"),
                "book_variant_id": variant_id,
                "title": book.get("title") or "Unknown",
                "current_stock": qty,
                "threshold": 10,
                "priority": "HIGH" if qty == 0 else "MEDIUM",
                "reason": "OUT_OF_STOCK" if qty == 0 else "LOW_STOCK",
                "suggested_action": "Tạo purchase request ngay" if qty == 0 else "Xem xét nhập thêm",
                # No warehouse_id from catalog data
                "warehouse_id": None,
            })
            if len(items) >= 10:
                break

    if not items:
        items = [{"message": "Không có dữ liệu tồn kho thấp trong context hiện tại."}]

    # Detect warehouse hint from user message and filter items
    _normalized_alert_msg = normalize_text(message)
    _alert_warehouse_hint = _detect_warehouse_hint(_normalized_alert_msg)
    _alert_filtered, _alert_matched_wh = _filter_items_by_warehouse_hint(
        [i for i in items if isinstance(i, dict) and i.get("title")],
        _alert_warehouse_hint,
    )
    if _alert_matched_wh:
        items = _alert_filtered + [i for i in items if not (isinstance(i, dict) and i.get("title"))]

    named_items = [i for i in items if isinstance(i, dict) and i.get("title")]
    items_with_warehouse = [i for i in named_items if i.get("warehouse_id")]
    items_missing_warehouse = [i for i in named_items if not i.get("warehouse_id")]
    high_count = sum(1 for it in named_items if it.get("priority") == "HIGH")
    severity = "HIGH" if high_count > 0 else "MEDIUM"

    warnings = []
    if _alert_matched_wh:
        warnings.append(f"Đã lọc theo kho: {_alert_matched_wh}.")
    elif _alert_warehouse_hint and not _alert_matched_wh:
        warnings.append(f"Không tìm thấy kho phù hợp với '{_alert_warehouse_hint}'. Hiển thị tất cả kho.")
    if items_missing_warehouse:
        warnings.append(
            f"{len(items_missing_warehouse)} sách chưa xác định được kho — "
            "chọn kho dự phòng bên dưới để tạo cảnh báo cho các sách này."
        )
    missing_variant = [i for i in named_items if not i.get("book_variant_id")]
    if missing_variant:
        warnings.append(f"{len(missing_variant)} sách thiếu book_variant_id — sẽ bị bỏ qua.")

    warehouses_covered = list({it["warehouse_code"] for it in items_with_warehouse if it.get("warehouse_code")})

    return {
        "type": CREATE_STOCK_ALERT,
        "summary": (
            f"Tạo cảnh báo tồn kho {len(named_items)} dòng sách từ {len({it.get('warehouse_id') for it in items_with_warehouse})} kho"
            if items_with_warehouse
            else f"Tạo cảnh báo tồn kho {len(named_items)} đầu sách"
        ),
        "payload": {
            "alert_type": "OUT_OF_STOCK" if severity == "HIGH" else "LOW_STOCK",
            "items": items,
            "severity": severity,
            "warehouse_id": None,  # global fallback — user selects if items missing warehouse
            "warehouses_covered": warehouses_covered,
            "sources": [s.get("name") for s in sources if s.get("status") == "ok"],
            "target_roles": ["WAREHOUSE_MANAGER", "WAREHOUSE_STAFF"],
        },
        "risk": RISK_LOW,
        "sources": sources,
        "intent": intent_info.get("intent"),
        "warnings": warnings,
        # requires_review only if some items still missing warehouse
        "requires_review": bool(items_missing_warehouse),
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

    # Internal task type key (used to look up title/route)
    _internal_type = "GENERAL_LIBRARY_TASK"
    if intent == LOW_STOCK_QUERY or intent == REORDER_SUGGESTION_QUERY:
        _internal_type = "REVIEW_LOW_STOCK"
    elif intent == OVERDUE_LOAN_QUERY:
        _internal_type = "REVIEW_OVERDUE"
    elif intent == FINE_SUMMARY_QUERY:
        _internal_type = "REVIEW_FINE"
    elif intent == RESERVATION_QUERY:
        _internal_type = "FOLLOW_UP_RESERVATION"
    elif _contains_any(normalized_msg, ["nhap", "nhap sach", "reorder"]):
        _internal_type = "REVIEW_REORDER"

    # Map to backend-valid task_type enum values (from staff-task.controller.js VALID_TASK_TYPES)
    _TASK_TYPE_MAP = {
        "REVIEW_LOW_STOCK":      "LOW_STOCK_REVIEW",
        "REVIEW_REORDER":        "REORDER_REVIEW",
        "FOLLOW_UP_RESERVATION": "RESERVATION_FOLLOW_UP",
        "REVIEW_OVERDUE":        "OTHER",
        "REVIEW_FINE":           "OTHER",
        "GENERAL_LIBRARY_TASK":  "GENERAL",
    }
    task_type = _TASK_TYPE_MAP.get(_internal_type, "GENERAL")

    task_title_map = {
        "REVIEW_LOW_STOCK":      "Kiểm tra và xử lý sách tồn kho thấp",
        "REVIEW_REORDER":        "Xem xét đề xuất nhập sách mới",
        "FOLLOW_UP_RESERVATION": "Theo dõi và xử lý đặt chỗ",
        "REVIEW_OVERDUE":        "Xử lý sách quá hạn trả",
        "REVIEW_FINE":           "Kiểm tra và thu phạt tồn đọng",
        "GENERAL_LIBRARY_TASK":  "Nhiệm vụ thư viện tổng quát",
    }

    related_items = []
    low_stock = raw.get("low_stock_books") or []
    if isinstance(low_stock, list):
        related_items = [
            {"title": b.get("title"), "quantity": _int_safe(_get_item_field(b, "quantity", "available_qty"))}
            for b in low_stock[:5]
            if isinstance(b, dict)
        ]

    task_title = task_title_map.get(_internal_type, "Nhiệm vụ thư viện")
    priority = "HIGH" if _internal_type in ("REVIEW_LOW_STOCK", "REVIEW_OVERDUE") else "MEDIUM"

    return {
        "type": CREATE_STAFF_TASK_DRAFT,
        "summary": f"Tạo task cho staff: {task_title}",
        "payload": {
            "task_title": task_title,
            "title": task_title,
            "task_type": task_type,
            "assignee_role": "WAREHOUSE_STAFF",
            "assignee_user_id": None,
            "priority": priority,
            "due_date": None,
            "related_action_type": intent,
            "related_items": related_items,
            "suggested_route": "/inventory/purchase-requests" if _internal_type in ("REVIEW_LOW_STOCK", "REVIEW_REORDER") else "/borrow/loans",
            "instructions": f"Kiểm tra và xử lý theo yêu cầu AI: {message[:200]}",
            "sources": [s.get("name") for s in sources if s.get("status") == "ok"],
        },
        "risk": RISK_MEDIUM,
        "sources": sources,
        "intent": intent,
        # assignee_user_id is always None from AI — user must select assignee in UI
        "warnings": ["Chưa có người thực hiện — vui lòng chọn nhân viên trước khi xác nhận."],
        "requires_review": True,
    }


# ── Main planner entry point ──────────────────────────────────────────────────

async def plan_agent_action(
    message: str,
    intent_info: dict,
    retrieval: dict,
    user_context: UserContext | None,
    auth_header: str | None = None,
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
        result = await _build_reorder_draft(
            message, intent_info, raw, sources, warnings, user_context,
            auth_header=auth_header,
        )
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
