from evidence import extract_evidence


def test_dashboard_kpis_extracts_key_metrics():
    result = {
        "total_titles": 120, "active_loans": 34, "overdue_loans": 5,
        "unpaid_fine_amount": 250000,
    }
    items = extract_evidence("get_dashboard_kpis", result)
    metrics = {item["metric"] for item in items}
    assert metrics == {"total_titles", "active_loans", "overdue_loans", "unpaid_fine_amount"}


def test_top_books_extracts_top_entries():
    result = [
        {"title": "Sách A", "borrow_count": 42},
        {"title": "Sách B", "borrow_count": 30},
    ]
    items = extract_evidence("get_top_books", result)
    assert len(items) == 2
    assert items[0]["value"] == 42


def test_overdue_summary_extracts_totals():
    result = {"total_overdue_loans": 7, "average_overdue_days": 3.5}
    items = extract_evidence("get_overdue_summary", result)
    metrics = {item["metric"]: item["value"] for item in items}
    assert metrics["total_overdue_loans"] == 7
    assert metrics["average_overdue_days"] == 3.5


def test_warehouse_stock_risk_ranks_by_severity():
    result = [
        {"warehouse_name": "Kho A", "low_stock_variants": 2, "out_of_stock_variants": 0, "reasoning": "r1"},
        {"warehouse_name": "Kho B", "low_stock_variants": 1, "out_of_stock_variants": 5, "reasoning": "r2"},
    ]
    items = extract_evidence("get_warehouse_stock_risk", result)
    assert items[0]["label"].startswith("Kho B")


def test_reorder_suggestions_extracts_summary_and_items():
    result = {
        "summary": {"total_candidates": 3},
        "items": [{"title": "Sách C", "suggested_reorder_qty": 10, "priority": "HIGH"}],
    }
    items = extract_evidence("get_reorder_suggestions", result)
    assert any(item["metric"] == "total_candidates" for item in items)
    assert any(item["metric"] == "suggested_reorder_qty" and item["value"] == 10 for item in items)


def test_search_books_extracts_results():
    result = {"query": "python", "results": [{"title": "Sách D", "quantity": 4, "author": "Tác giả"}]}
    items = extract_evidence("search_books", result)
    assert items[0]["label"] == "Sách D"
    assert items[0]["value"] == 4


def test_unknown_tool_returns_empty():
    assert extract_evidence("some_unknown_tool", {"anything": 1}) == []


def test_error_result_returns_empty_not_raise():
    assert extract_evidence("get_dashboard_kpis", {"error": "boom"}) == []


def test_wrong_shape_returns_empty_not_raise():
    # get_top_books expects a list — a dict should be ignored, not crash.
    assert extract_evidence("get_top_books", {"error": "boom"}) == []


def test_empty_containers_return_empty():
    assert extract_evidence("get_top_books", []) == []
    assert extract_evidence("get_warehouse_stock_risk", []) == []
    assert extract_evidence("get_reorder_suggestions", {}) == []
