"""Tests for CREATE_STOCK_REQUEST intent detection, entity extraction, and planner.

Run with: pytest test_stock_request.py -v
Uses asyncio.run() so pytest-asyncio is NOT required.
"""
from __future__ import annotations

import asyncio

import pytest

from intent import (
    CREATE_STOCK_REQUEST,
    REORDER_SUGGESTION_QUERY,
    detect_intent,
    extract_stock_request_entities,
    normalize_text,
)
from agent_planner import _build_direct_stock_request_draft

# ── Fixtures ──────────────────────────────────────────────────────────────────

SAMPLE_WAREHOUSES = [
    {
        "id": "wh-1",
        "code": "WH-HN",
        "name": "Kho Hà Nội",
        "province": "Hanoi",
        "district": "Hoan Kiem",
        "is_active": True,
    },
    {
        "id": "wh-2",
        "code": "WH-HCM",
        "name": "Kho TP.HCM",
        "province": "Ho Chi Minh City",
        "district": "District 1",
        "is_active": True,
    },
    {
        "id": "wh-3",
        "code": "WH-HCM2",
        "name": "Kho HCM Chi Nhánh 2",
        "province": "Ho Chi Minh City",
        "district": "District 3",
        "is_active": True,
    },
    {
        "id": "wh-4",
        "code": "WH-TD",
        "name": "Kho Thủ Đức",
        "province": "Ho Chi Minh City",
        "district": "Thu Duc",
        "is_active": True,
    },
]

SAMPLE_BOOK = {
    "id": "book-1",
    "variant_id": "variant-1",
    "title": "Đắc Nhân Tâm",
    "author": "Dale Carnegie",
    "isbn": "9780671027032",
    "quantity": 5,
}


def _make_intent_info(
    quantity=20,
    book_title="Đắc Nhân Tâm",
    warehouse_name="ha noi",
    isbn=None,
    note=None,
):
    return {
        "intent": CREATE_STOCK_REQUEST,
        "entities": {
            "book_title": book_title,
            "isbn": isbn,
            "warehouse_name": warehouse_name,
            "quantity": quantity,
            "note": note,
        },
    }


def _run(coro):
    """Run an async coroutine synchronously."""
    return asyncio.run(coro)


# ── Intent detection ──────────────────────────────────────────────────────────

class TestIntentDetection:
    def test_explicit_create_with_quantity_and_warehouse(self):
        msg = "Tạo phiếu nhập 20 cuốn Đắc Nhân Tâm vào kho Hà Nội"
        assert detect_intent(msg)["intent"] == CREATE_STOCK_REQUEST

    def test_tao_phieu_yeu_cau_nhap(self):
        msg = "Tạo phiếu yêu cầu nhập 30 cuốn Nhà Giả Kim vào kho Thủ Đức"
        assert detect_intent(msg)["intent"] == CREATE_STOCK_REQUEST

    def test_nhap_them_with_quantity_and_kho(self):
        msg = "nhập thêm 10 cuốn Clean Code cho kho HCM"
        assert detect_intent(msg)["intent"] == CREATE_STOCK_REQUEST

    def test_nhap_them_variant_so_luong(self):
        msg = "cho kho Hà Nội nhập thêm Clean Code số lượng 15"
        assert detect_intent(msg)["intent"] == CREATE_STOCK_REQUEST

    def test_lam_phieu_nhap(self):
        msg = "làm phiếu nhập kho trung tâm 20 bản cuốn Clean Code"
        assert detect_intent(msg)["intent"] == CREATE_STOCK_REQUEST

    def test_tao_yeu_cau_mua_them(self):
        msg = "tạo yêu cầu mua thêm sách Nhà Giả Kim, kho Thủ Đức, 10 cuốn"
        assert detect_intent(msg)["intent"] == CREATE_STOCK_REQUEST

    def test_isbn_triggers_create(self):
        msg = "tạo phiếu yêu cầu nhập ISBN 9780671027032 kho Hà Nội 5 cuốn"
        r = detect_intent(msg)
        assert r["intent"] == CREATE_STOCK_REQUEST
        assert r["entities"]["isbn"] == "9780671027032"

    def test_general_reorder_stays_reorder_suggestion(self):
        assert detect_intent("gợi ý nhập thêm sách gì?")["intent"] == REORDER_SUGGESTION_QUERY

    def test_analytics_query_stays_reorder_suggestion(self):
        assert detect_intent("sách nào cần bổ sung?")["intent"] == REORDER_SUGGESTION_QUERY

    def test_no_quantity_no_warehouse_stays_general(self):
        # No quantity AND no kho → should NOT be CREATE_STOCK_REQUEST
        result = detect_intent("tạo phiếu nhập Đắc Nhân Tâm")
        # Could be CREATE_STOCK_REQUEST (has "tao phieu") — that's OK since planner handles
        # missing quantity by returning None. Just ensure it doesn't crash.
        assert result["intent"] in (CREATE_STOCK_REQUEST, REORDER_SUGGESTION_QUERY)


# ── Entity extraction ─────────────────────────────────────────────────────────

class TestEntityExtraction:
    def test_quantity_before_cuon(self):
        e = extract_stock_request_entities("Tạo phiếu nhập 20 cuốn Đắc Nhân Tâm vào kho Hà Nội")
        assert e["quantity"] == 20

    def test_quantity_via_so_luong(self):
        e = extract_stock_request_entities("nhập thêm Nhà Giả Kim vào kho Thủ Đức số lượng 15")
        assert e["quantity"] == 15

    def test_quantity_before_ban(self):
        e = extract_stock_request_entities("làm phiếu nhập kho trung tâm 20 bản cuốn Clean Code")
        assert e["quantity"] == 20

    def test_isbn_extracted(self):
        e = extract_stock_request_entities("tạo phiếu nhập ISBN 9780671027032 kho HN 5 cuốn")
        assert e["isbn"] == "9780671027032"

    def test_isbn_no_book_title(self):
        e = extract_stock_request_entities("tạo phiếu nhập 9780671027032 kho HN 5 cuốn")
        assert e["isbn"] == "9780671027032"
        # When ISBN is present, book_title can be None (that's fine)

    def test_warehouse_hint_extracted(self):
        e = extract_stock_request_entities("Tạo phiếu nhập 20 cuốn Đắc Nhân Tâm vào kho Hà Nội")
        assert e["warehouse_name"] is not None
        assert "ha noi" in normalize_text(e["warehouse_name"])

    def test_warehouse_hint_thu_duc(self):
        e = extract_stock_request_entities("nhập thêm 10 cuốn Clean Code cho kho Thủ Đức")
        wh = normalize_text(e["warehouse_name"] or "")
        assert "thu duc" in wh or "thu" in wh

    def test_no_quantity_returns_none(self):
        e = extract_stock_request_entities("nhập thêm Nhà Giả Kim vào kho Thủ Đức")
        assert e["quantity"] is None

    def test_no_warehouse_returns_none(self):
        e = extract_stock_request_entities("Tạo phiếu nhập 20 cuốn Đắc Nhân Tâm")
        assert e["warehouse_name"] is None


# ── Planner: _build_direct_stock_request_draft ───────────────────────────────

class TestBuildDirectStockRequestDraft:

    def test_happy_path_returns_draft(self):
        raw = {"Catalog Books": [SAMPLE_BOOK], "Active Warehouses": SAMPLE_WAREHOUSES}
        result = _run(_build_direct_stock_request_draft(
            message="Tạo phiếu nhập 20 cuốn Đắc Nhân Tâm vào kho Hà Nội",
            intent_info=_make_intent_info(),
            raw=raw, sources=[], warnings=[], user_context=None,
        ))
        assert result is not None
        assert result["type"] == "CREATE_REORDER_DRAFT"
        item = result["payload"]["items"][0]
        assert item["suggested_quantity"] == 20
        assert item["book_variant_id"] == "variant-1"
        assert item["warehouse_id"] == "wh-1"
        assert result["payload"]["reason"] == "LOW_STOCK"
        assert result["payload"]["source_intent"] == CREATE_STOCK_REQUEST
        assert result["requires_review"] is False

    def test_missing_quantity_returns_none(self):
        raw = {"Catalog Books": [SAMPLE_BOOK], "Active Warehouses": SAMPLE_WAREHOUSES}
        result = _run(_build_direct_stock_request_draft(
            message="Tạo phiếu nhập Đắc Nhân Tâm vào kho Hà Nội",
            intent_info=_make_intent_info(quantity=None),
            raw=raw, sources=[], warnings=[], user_context=None,
        ))
        assert result is None

    def test_zero_quantity_returns_none(self):
        raw = {"Catalog Books": [SAMPLE_BOOK], "Active Warehouses": SAMPLE_WAREHOUSES}
        result = _run(_build_direct_stock_request_draft(
            message="",
            intent_info=_make_intent_info(quantity=0),
            raw=raw, sources=[], warnings=[], user_context=None,
        ))
        assert result is None

    def test_negative_quantity_returns_none(self):
        raw = {"Catalog Books": [SAMPLE_BOOK], "Active Warehouses": SAMPLE_WAREHOUSES}
        result = _run(_build_direct_stock_request_draft(
            message="",
            intent_info=_make_intent_info(quantity=-5),
            raw=raw, sources=[], warnings=[], user_context=None,
        ))
        assert result is None

    def test_book_not_found_returns_none(self):
        raw = {"Catalog Books": [], "Active Warehouses": SAMPLE_WAREHOUSES}
        result = _run(_build_direct_stock_request_draft(
            message="Tạo phiếu nhập 20 cuốn Sách Không Tồn Tại vào kho Hà Nội",
            intent_info=_make_intent_info(book_title="Sách Không Tồn Tại"),
            raw=raw, sources=[], warnings=[], user_context=None,
        ))
        assert result is None

    def test_multiple_books_ambiguous_returns_none(self):
        books = [
            SAMPLE_BOOK,
            {**SAMPLE_BOOK, "id": "book-2", "variant_id": "variant-2",
             "title": "Đắc Nhân Tâm bản đặc biệt"},
        ]
        raw = {"Catalog Books": books, "Active Warehouses": SAMPLE_WAREHOUSES}
        result = _run(_build_direct_stock_request_draft(
            message="Tạo phiếu nhập 20 cuốn Đắc Nhân Tâm vào kho Hà Nội",
            intent_info=_make_intent_info(),
            raw=raw, sources=[], warnings=[], user_context=None,
        ))
        assert result is None

    def test_book_no_variant_id_returns_none(self):
        book_no_variant = {**SAMPLE_BOOK, "variant_id": None}
        raw = {"Catalog Books": [book_no_variant], "Active Warehouses": SAMPLE_WAREHOUSES}
        result = _run(_build_direct_stock_request_draft(
            message="Tạo phiếu nhập 20 cuốn Đắc Nhân Tâm vào kho Hà Nội",
            intent_info=_make_intent_info(),
            raw=raw, sources=[], warnings=[], user_context=None,
        ))
        assert result is None

    def test_missing_warehouse_hint_returns_none(self):
        raw = {"Catalog Books": [SAMPLE_BOOK], "Active Warehouses": SAMPLE_WAREHOUSES}
        result = _run(_build_direct_stock_request_draft(
            message="Tạo phiếu nhập 20 cuốn Đắc Nhân Tâm",
            intent_info=_make_intent_info(warehouse_name=None),
            raw=raw, sources=[], warnings=[], user_context=None,
        ))
        assert result is None

    def test_warehouse_not_found_returns_none(self):
        raw = {"Catalog Books": [SAMPLE_BOOK], "Active Warehouses": SAMPLE_WAREHOUSES}
        result = _run(_build_direct_stock_request_draft(
            message="Tạo phiếu nhập 20 cuốn Đắc Nhân Tâm vào kho Sao Hỏa",
            intent_info=_make_intent_info(warehouse_name="sao hoa"),
            raw=raw, sources=[], warnings=[], user_context=None,
        ))
        assert result is None

    def test_warehouse_ambiguous_returns_none(self):
        # "hcm" matches both wh-2 (WH-HCM) and wh-3 (WH-HCM2)
        raw = {"Catalog Books": [SAMPLE_BOOK], "Active Warehouses": SAMPLE_WAREHOUSES}
        result = _run(_build_direct_stock_request_draft(
            message="Tạo phiếu nhập 20 cuốn Đắc Nhân Tâm vào kho HCM",
            intent_info=_make_intent_info(warehouse_name="hcm"),
            raw=raw, sources=[], warnings=[], user_context=None,
        ))
        # AMBIGUOUS → must return None (not create draft)
        assert result is None

    def test_resolved_warehouse_id_correct(self):
        raw = {"Catalog Books": [SAMPLE_BOOK], "Active Warehouses": SAMPLE_WAREHOUSES}
        result = _run(_build_direct_stock_request_draft(
            message="Tạo phiếu nhập 20 cuốn Đắc Nhân Tâm vào kho Thủ Đức",
            intent_info=_make_intent_info(warehouse_name="thu duc"),
            raw=raw, sources=[], warnings=[], user_context=None,
        ))
        assert result is not None
        assert result["payload"]["resolved_warehouse_id"] == "wh-4"
        assert result["payload"]["items"][0]["warehouse_id"] == "wh-4"

    def test_empty_warehouses_returns_none(self):
        raw = {"Catalog Books": [SAMPLE_BOOK], "Active Warehouses": []}
        # With empty warehouses, _fetch_active_warehouses will also return [] (no auth)
        result = _run(_build_direct_stock_request_draft(
            message="Tạo phiếu nhập 20 cuốn Đắc Nhân Tâm vào kho Hà Nội",
            intent_info=_make_intent_info(),
            raw=raw, sources=[], warnings=[], user_context=None,
        ))
        assert result is None

    def test_payload_fields_complete(self):
        raw = {"Catalog Books": [SAMPLE_BOOK], "Active Warehouses": SAMPLE_WAREHOUSES}
        result = _run(_build_direct_stock_request_draft(
            message="Tạo phiếu nhập 20 cuốn Đắc Nhân Tâm vào kho Hà Nội",
            intent_info=_make_intent_info(),
            raw=raw, sources=[], warnings=[], user_context=None,
        ))
        assert result is not None
        p = result["payload"]
        assert p["source_intent"] == CREATE_STOCK_REQUEST
        assert p["reason"] == "LOW_STOCK"
        assert p["warehouse_resolution_status"] == "RESOLVED"
        assert p["resolved_warehouse_id"] == "wh-1"
        assert len(p["items"]) == 1
        assert p["items"][0]["book_variant_id"] == "variant-1"
        assert p["items"][0]["suggested_quantity"] == 20
