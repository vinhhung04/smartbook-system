from __future__ import annotations

from typing import Any

# Best-effort evidence extraction per tool, for the "Evidence-first" UI. Not meant to be
# exhaustive — a tool with no extractor (or a result shape that doesn't match what we
# expect, e.g. an {"error": ...} result from assistant_tools._get) simply yields no
# evidence items; it must never raise and never blocks the assistant's answer.


def _item(label: str, tool_name: str, metric: str, value: Any, unit: str = "", description: str = "") -> dict:
    return {
        "label": label,
        "source_type": "tool",
        "tool_name": tool_name,
        "metric": metric,
        "value": value,
        "unit": unit,
        "description": description,
    }


def _evidence_dashboard_kpis(result: dict) -> list[dict]:
    items = []
    if "total_titles" in result:
        items.append(_item("Tổng đầu sách", "get_dashboard_kpis", "total_titles", result["total_titles"], "đầu sách"))
    if "active_loans" in result:
        items.append(_item("Phiếu mượn đang mở", "get_dashboard_kpis", "active_loans", result["active_loans"], "phiếu"))
    if "overdue_loans" in result:
        items.append(_item("Phiếu mượn quá hạn", "get_dashboard_kpis", "overdue_loans", result["overdue_loans"], "phiếu"))
    if "unpaid_fine_amount" in result:
        items.append(_item(
            "Tổng tiền phạt chưa thu", "get_dashboard_kpis", "unpaid_fine_amount",
            result["unpaid_fine_amount"], "đ",
        ))
    return items


def _evidence_top_books(result: list) -> list[dict]:
    items = []
    for book in result[:3]:
        if not isinstance(book, dict) or "title" not in book:
            continue
        items.append(_item(
            f"Top sách được mượn: {book['title']}", "get_top_books", "borrow_count",
            book.get("borrow_count"), "lượt",
            description="Dựa trên dữ liệu mượn sách trong khoảng thời gian đã chọn",
        ))
    return items


def _evidence_overdue_summary(result: dict) -> list[dict]:
    items = []
    if "total_overdue_loans" in result:
        items.append(_item(
            "Số phiếu quá hạn", "get_overdue_summary", "total_overdue_loans",
            result["total_overdue_loans"], "phiếu",
        ))
    if "average_overdue_days" in result:
        items.append(_item(
            "Số ngày quá hạn trung bình", "get_overdue_summary", "average_overdue_days",
            result["average_overdue_days"], "ngày",
        ))
    return items


def _evidence_warehouse_stock_risk(result: list) -> list[dict]:
    items = []
    ranked = sorted(
        (row for row in result if isinstance(row, dict)),
        key=lambda row: (row.get("out_of_stock_variants") or 0, row.get("low_stock_variants") or 0),
        reverse=True,
    )
    for row in ranked[:3]:
        name = row.get("warehouse_name") or "Kho chưa rõ tên"
        if (row.get("out_of_stock_variants") or 0) > 0:
            items.append(_item(
                f"{name} — sách hết hàng", "get_warehouse_stock_risk", "out_of_stock_variants",
                row.get("out_of_stock_variants"), "đầu sách", description=row.get("reasoning", ""),
            ))
        elif (row.get("low_stock_variants") or 0) > 0:
            items.append(_item(
                f"{name} — sách tồn thấp", "get_warehouse_stock_risk", "low_stock_variants",
                row.get("low_stock_variants"), "đầu sách", description=row.get("reasoning", ""),
            ))
    return items


def _evidence_reorder_suggestions(result: dict) -> list[dict]:
    items = []
    summary = result.get("summary") or {}
    if "total_candidates" in summary:
        items.append(_item(
            "Số sách cần nhập", "get_reorder_suggestions", "total_candidates",
            summary["total_candidates"], "đầu sách",
        ))
    for entry in (result.get("items") or [])[:3]:
        if not isinstance(entry, dict) or "title" not in entry:
            continue
        items.append(_item(
            f"Đề xuất nhập: {entry['title']}", "get_reorder_suggestions", "suggested_reorder_qty",
            entry.get("suggested_reorder_qty"), "bản",
            description=f"Mức ưu tiên: {entry.get('priority', 'N/A')}",
        ))
        # A lead time measured from real deliveries is a fact worth showing; a
        # default or caller-supplied one is not evidence of anything.
        if entry.get("lead_time_source") == "LEARNED":
            items.append(_item(
                f"Thời gian chờ hàng thực tế: {entry['title']}", "get_reorder_suggestions",
                "lead_time_days", entry.get("lead_time_days"), "ngày",
                description=f"Trung vị của {entry.get('lead_time_samples', 0)} lần giao gần đây",
            ))
    return items


def _evidence_search_books(result: dict) -> list[dict]:
    items = []
    for book in (result.get("results") or [])[:3]:
        if not isinstance(book, dict) or "title" not in book:
            continue
        items.append(_item(
            book["title"], "search_books", "quantity", book.get("quantity"), "bản",
            description=book.get("author", ""),
        ))
    return items


def _evidence_borrow_trends(result: list) -> list[dict]:
    days = [row for row in result if isinstance(row, dict) and "date" in row]
    if not days:
        return []
    total_loans = sum(row.get("loans") or 0 for row in days)
    total_returns = sum(row.get("returns") or 0 for row in days)
    peak = max(days, key=lambda row: row.get("loans") or 0)
    items = [
        _item("Tổng lượt mượn trong khoảng thời gian", "get_borrow_trends", "total_loans", total_loans, "lượt"),
        _item("Tổng lượt trả trong khoảng thời gian", "get_borrow_trends", "total_returns", total_returns, "lượt"),
    ]
    if (peak.get("loans") or 0) > 0:
        items.append(_item(f"Ngày cao điểm: {peak['date']}", "get_borrow_trends", "loans", peak["loans"], "lượt"))
    return items


def _evidence_fine_summary(result: dict) -> list[dict]:
    items = []
    if "total_unpaid" in result:
        items.append(_item("Tổng tiền phạt chưa thu", "get_fine_summary", "total_unpaid", result["total_unpaid"], "đ"))
    if "total_paid" in result:
        items.append(_item("Tổng tiền phạt đã thu", "get_fine_summary", "total_paid", result["total_paid"], "đ"))
    by_type = [row for row in (result.get("by_type") or []) if isinstance(row, dict)]
    if by_type:
        largest = max(by_type, key=lambda row: row.get("amount") or 0)
        items.append(_item(
            f"Loại phạt lớn nhất: {largest.get('fine_type', 'N/A')}", "get_fine_summary", "amount",
            largest.get("amount"), "đ", description=f"{largest.get('count', 0)} khoản phạt",
        ))
    return items


def _evidence_reservation_funnel(result: dict) -> list[dict]:
    items = []
    if "total" in result:
        items.append(_item("Tổng số reservation", "get_reservation_funnel", "total", result["total"], "reservation"))
    if "converted_to_loan" in result:
        items.append(_item(
            "Đã chuyển thành phiếu mượn", "get_reservation_funnel", "converted_to_loan",
            result["converted_to_loan"], "reservation",
        ))
    if "conversion_rate" in result:
        items.append(_item("Tỷ lệ chuyển đổi", "get_reservation_funnel", "conversion_rate", result["conversion_rate"], "%"))
    return items


def _evidence_aging_inventory(result: dict) -> list[dict]:
    items = []
    rows = [row for row in (result.get("items") or []) if isinstance(row, dict) and "title" in row]
    if not rows:
        return []
    items.append(_item("Số sách tồn kho lâu không hoạt động", "get_aging_inventory", "count", len(rows), "đầu sách"))
    ranked = sorted(rows, key=lambda row: row.get("days_since_last_activity") or 0, reverse=True)
    for row in ranked[:2]:
        items.append(_item(
            f"Tồn lâu nhất: {row['title']}", "get_aging_inventory", "days_since_last_activity",
            row.get("days_since_last_activity"), "ngày", description=row.get("warehouse_name", ""),
        ))
    return items


def _evidence_weeding_suggestions(result: dict) -> list[dict]:
    items = []
    summary = result.get("summary") or {}
    if "total_items" in summary:
        items.append(_item(
            "Số sách nên xem xét thanh lý/chuyển kho", "get_weeding_suggestions", "total_items",
            summary["total_items"], "đầu sách",
        ))
    if "total_tied_up_value" in summary:
        items.append(_item(
            "Tổng giá trị tồn đọng", "get_weeding_suggestions", "total_tied_up_value",
            summary["total_tied_up_value"], "đ",
        ))
    rows = [row for row in (result.get("items") or []) if isinstance(row, dict) and "title" in row]
    ranked = sorted(rows, key=lambda row: row.get("tied_up_value") or 0, reverse=True)
    for row in ranked[:2]:
        items.append(_item(
            f"Giá trị tồn đọng lớn nhất: {row['title']}", "get_weeding_suggestions", "tied_up_value",
            row.get("tied_up_value"), "đ",
            description=f"{row.get('severity', 'N/A')} — đề xuất {row.get('suggested_action', 'N/A')}",
        ))
    return items


_EXTRACTORS = {
    "get_dashboard_kpis": (_evidence_dashboard_kpis, dict),
    "get_top_books": (_evidence_top_books, list),
    "get_overdue_summary": (_evidence_overdue_summary, dict),
    "get_warehouse_stock_risk": (_evidence_warehouse_stock_risk, list),
    "get_reorder_suggestions": (_evidence_reorder_suggestions, dict),
    "search_books": (_evidence_search_books, dict),
    "get_borrow_trends": (_evidence_borrow_trends, list),
    "get_fine_summary": (_evidence_fine_summary, dict),
    "get_reservation_funnel": (_evidence_reservation_funnel, dict),
    "get_aging_inventory": (_evidence_aging_inventory, dict),
    "get_weeding_suggestions": (_evidence_weeding_suggestions, dict),
}


def extract_evidence(tool_name: str, tool_result: Any) -> list[dict]:
    """Best-effort evidence extraction for one tool call result. Never raises —
    an unsupported tool, an {"error": ...} result, or an unexpected shape just
    yields no evidence."""
    entry = _EXTRACTORS.get(tool_name)
    if entry is None:
        return []
    extractor, expected_type = entry
    if not isinstance(tool_result, expected_type):
        return []
    try:
        return extractor(tool_result)
    except Exception:
        return []
