"""A purchase-request draft asked for ONE book at ONE warehouse ("Tạo đề xuất nhập
sách cho sách X ở kho Y") drafts that book at that warehouse.

Reproduced 2026-11-20 on /chat and /assistant: the draft was the generic top of the
reorder list (10-20 unrelated titles, the asked book absent), "kho Chi Nhanh
District 1" was cut to "chi nhanh district" (ambiguous) and "kho Ha Noi" to "ha noi"
(three matches), so lines spread over several warehouses."""
from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, patch

import agent_planner as ap

WAREHOUSES = [
    {"id": "w-d1", "code": "BR-HCM-01", "name": "Chi Nhanh District 1"},
    {"id": "w-d3", "code": "BR-HCM-02", "name": "Chi Nhanh District 3"},
    {"id": "w-hn", "code": "WH-HN-01", "name": "Kho Ha Noi"},
    {"id": "w-hk", "code": "BR-HN-02", "name": "Chi nhánh Hà Nội – Hoàn Kiếm"},
    {"id": "w-cg", "code": "BR-HN-01", "name": "Chi nhánh Hà Nội – Cầu Giấy"},
    {"id": "w-ct", "code": "WH-CT-01", "name": "Kho Cần Thơ"},
]
REORDER = {"items": [
    {"variant_id": "v-slt", "title": "Sắc Lời Đắc Thế", "suggested_reorder_qty": 3, "priority": "LOW"},
    {"variant_id": "v-nw", "title": "Norwegian Wood", "suggested_reorder_qty": 6, "priority": "LOW", "available_qty": 12},
    {"variant_id": "v-ngk", "title": "Nhà Giả Kim (Tái Bản 2025)", "suggested_reorder_qty": 4, "priority": "LOW"},
    {"variant_id": "v-kf", "title": "Kafka on the Shore", "suggested_reorder_qty": 2, "priority": "LOW"},
]}
ATOMIC_ROW = {"id": "b-ah", "variant_id": "v-ah", "title": "Atomic Habits",
              "locations": [{"warehouse_id": "w-hn", "available_quantity": 4}, {"warehouse_id": "w-d1", "available_quantity": 9}]}


def draft(message, raw=None, catalog=(), intent_info=None):
    with patch.object(ap, "_fetch_active_warehouses", new=AsyncMock(return_value=WAREHOUSES)), \
         patch.object(ap, "_catalog_search", new=AsyncMock(return_value=list(catalog))), \
         patch.object(ap, "_public_title", new=AsyncMock(return_value=None)):
        return asyncio.run(ap._build_reorder_draft(
            message, intent_info or {"intent": "REORDER_SUGGESTION_QUERY"},
            raw if raw is not None else {"Reorder Suggestions": REORDER}, [], [], None, auth_header="Bearer t"))


def titles(planned):
    return [it["title"] for it in planned["payload"]["items"]]


def test_named_book_in_the_suggestions_is_the_only_line_at_the_named_warehouse():
    planned = draft("Tạo đề xuất nhập sách cho sách Norwegian Wood ở kho Chi Nhanh District 1")
    assert titles(planned) == ["Norwegian Wood"]
    item = planned["payload"]["items"][0]
    assert (item["warehouse_id"], item["suggested_quantity"]) == ("w-d1", 6)
    assert planned["payload"]["warehouse_resolution_status"] == "RESOLVED"


def test_edition_suffix_and_unaccented_message_still_match():
    assert titles(draft("tao de xuat nhap sach cho sach nha gia kim o kho ha noi")) == ["Nhà Giả Kim (Tái Bản 2025)"]


def test_full_warehouse_name_wins_over_partial_matches():
    planned = draft("Tạo đề xuất nhập sách Norwegian Wood ở kho Kho Ha Noi")
    assert planned["payload"]["resolved_warehouse_id"] == "w-hn"
    planned = draft("tao de xuat nhap sach cho sach Norwegian Wood o kho Ha Noi")
    assert planned["payload"]["resolved_warehouse_id"] == "w-hn"  # "Kho Ha Noi", not the two Hà Nội branches


def test_warehouse_code_still_resolves():
    planned = draft("Tạo đề xuất nhập sách Norwegian Wood ở kho WH-CT-01")
    assert planned["payload"]["resolved_warehouse_id"] == "w-ct"


def test_named_book_outside_the_suggestions_is_drafted_from_the_catalog_for_review():
    planned = draft("Tạo đề xuất nhập sách cho sách Atomic Habits ở kho Kho Ha Noi", catalog=[ATOMIC_ROW])
    assert titles(planned) == ["Atomic Habits"]
    item = planned["payload"]["items"][0]
    assert (item["book_variant_id"], item["warehouse_id"], item["current_stock"], item["suggested_quantity"]) == \
        ("v-ah", "w-hn", 4, 1)
    assert planned["requires_review"] is True
    assert any("không nằm trong danh sách gợi ý" in w for w in planned["warnings"])


def test_stock_is_unknown_not_zero_when_the_catalog_row_lists_no_copies_at_that_warehouse():
    # /api/books lists only some locations: absent is "unknown" (shown as "—"), never "0 = hết hàng"
    planned = draft("Tạo đề xuất nhập sách cho sách Atomic Habits ở kho Kho Cần Thơ", catalog=[ATOMIC_ROW])
    assert planned["payload"]["items"][0]["current_stock"] is None


def test_named_book_found_nowhere_drafts_nothing_rather_than_other_books():
    assert draft("Tạo đề xuất nhập sách cho sách Sách Không Tồn Tại ở kho Kho Ha Noi", catalog=[]) is None


def test_nlu_book_title_is_used_when_given():
    planned = draft("Lập phiếu nhập giúp tôi ở kho Kho Ha Noi",
                    intent_info={"intent": "REORDER_SUGGESTION_QUERY", "entities": {"book_title": "Kafka on the Shore"}})
    assert titles(planned) == ["Kafka on the Shore"]


def test_no_book_named_keeps_the_suggestion_list():
    planned = draft("Tạo đề xuất nhập sách cho kho Kho Ha Noi")
    assert len(titles(planned)) == 4
    planned = draft("Tạo phiếu nhập sách đang thiếu ở kho Kho Ha Noi")
    assert len(titles(planned)) == 4


def test_requested_title_extraction():
    cases = {
        "Tạo đề xuất nhập sách cho sách Atomic Habits ở kho Kho HCM Chinh": "atomic habits",
        "tao de xuat nhap sach cho sach Truyen Kieu o kho Ha Noi": "truyen kieu",
        "Tạo đề xuất nhập sách Mắt Biếc tại chi nhánh Thủ Đức": "mat biec",
        "Lập phiếu nhập cuốn \"Dế Mèn Phiêu Lưu Ký\" cho kho Hà Nội": "de men phieu luu ky",
        "Tạo đề xuất nhập sách Norwegian Wood": "norwegian wood",
        "Tạo đề xuất nhập sách cho kho Hà Nội": None,
        "Tạo phiếu nhập sách đang thiếu ở kho Hà Nội": None,
        "Tạo đề xuất nhập sách bị hết hàng tại kho HCM": None,
        "tạo đề xuất nhập sách ưu tiên cao": None,
    }
    for message, expected in cases.items():
        assert ap._requested_title(message, {}) == expected, message


def test_draft_note_names_the_book_the_warehouse_and_the_quantity():
    planned = draft("Tạo đề xuất nhập sách cho sách Atomic Habits ở kho Kho Ha Noi", catalog=[ATOMIC_ROW])
    note = ap.draft_note(planned)
    assert "Atomic Habits" in note and "Kho Ha Noi" in note and "1 bản" in note
    assert "không gợi ý nhập" in note and "xác nhận" in note
    planned = draft("Tạo đề xuất nhập sách cho sách Norwegian Wood ở kho Chi Nhanh District 1")
    assert "6 bản theo gợi ý của hệ thống" in ap.draft_note(planned)
    assert ap.draft_note(draft("Tạo đề xuất nhập sách cho kho Kho Ha Noi")) is None  # several lines: the card says it
    assert ap.draft_note(None) is None


def test_assistant_drafts_a_named_book_even_when_no_suggestions_were_fetched():
    import main
    build = AsyncMock(return_value=None)
    with patch.object(main, "_build_reorder_draft", new=build):
        asyncio.run(main._build_assistant_pending_action(
            "tao de xuat nhap sach cho sach Truyen Kieu o kho Ha Noi", {"search_books": {}}, None, "Bearer t"))
        assert build.await_args.args[2] == {"Reorder Suggestions": {}}
        build.reset_mock()
        asyncio.run(main._build_assistant_pending_action("Tạo đề xuất nhập sách cho kho Kho Ha Noi", {}, None, "Bearer t"))
        build.assert_not_awaited()  # no book named and no suggestions: nothing to draft from
