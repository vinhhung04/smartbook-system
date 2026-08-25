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


_EXTRACTORS = {
    "get_dashboard_kpis": (_evidence_dashboard_kpis, dict),
    "get_top_books": (_evidence_top_books, list),
    "get_overdue_summary": (_evidence_overdue_summary, dict),
    "get_warehouse_stock_risk": (_evidence_warehouse_stock_risk, list),
    "get_reorder_suggestions": (_evidence_reorder_suggestions, dict),
    "search_books": (_evidence_search_books, dict),
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
