"""Regression tests for the current reorder-request intent contract.

Direct CREATE_STOCK_REQUEST was retired in favour of a manager-reviewed
CREATE_REORDER_DRAFT. These tests prevent the old intent from being
accidentally reintroduced by natural-language matching changes.
"""

from intent import REORDER_SUGGESTION_QUERY, detect_intent
from agent_planner import _detect_warehouse_hint, _resolve_warehouse_hint_against_db


WAREHOUSES = [
    {"id": "wh-hn", "code": "WH-HN", "name": "Kho Hà Nội", "province": "Hanoi", "is_active": True},
    {"id": "wh-hcm", "code": "WH-HCM", "name": "Kho TP.HCM", "province": "Ho Chi Minh City", "is_active": True},
    {"id": "wh-hcm2", "code": "WH-HCM2", "name": "Kho HCM Chi Nhánh 2", "province": "Ho Chi Minh City", "is_active": True},
]


def test_explicit_purchase_request_uses_manager_review_reorder_intent():
    result = detect_intent("Tạo phiếu nhập 20 cuốn Clean Code vào kho Hà Nội")
    assert result["intent"] == REORDER_SUGGESTION_QUERY


def test_generic_reorder_request_remains_reorder_intent():
    result = detect_intent("gợi ý nhập thêm sách gì?")
    assert result["intent"] == REORDER_SUGGESTION_QUERY


def test_warehouse_hint_is_extracted_without_creating_stock_request():
    assert _detect_warehouse_hint("tao phieu nhap kho ha noi") == "ha noi"


def test_warehouse_resolution_is_safe_for_exact_and_ambiguous_hints():
    assert _resolve_warehouse_hint_against_db("ha noi", WAREHOUSES)["status"] == "RESOLVED"
    assert _resolve_warehouse_hint_against_db("hcm", WAREHOUSES)["status"] == "AMBIGUOUS"
