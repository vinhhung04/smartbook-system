"""Unit tests for warehouse hint resolution logic in agent_planner.py."""

from __future__ import annotations

import pytest

from agent_planner import _norm_wh, _resolve_warehouse_hint_against_db

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
        "code": "WH-DN",
        "name": "Kho Đà Nẵng",
        "province": "Da Nang",
        "district": "",
        "is_active": True,
    },
    {
        "id": "wh-4",
        "code": "WH-HCM2",
        "name": "Kho HCM Chi Nhánh 2",
        "province": "Ho Chi Minh City",
        "district": "District 3",
        "is_active": True,
    },
]


def test_norm_wh_removes_diacritics():
    assert _norm_wh("Hà Nội") == "ha noi"
    assert _norm_wh("TP.Hồ Chí Minh") == "tp ho chi minh"
    assert _norm_wh("Đà Nẵng") == "da nang"
    assert _norm_wh("WH-HN") == "wh hn"


def test_exact_code_match():
    result = _resolve_warehouse_hint_against_db("WH-HN", SAMPLE_WAREHOUSES)
    assert result["status"] == "RESOLVED"
    assert result["warehouse"]["id"] == "wh-1"


def test_exact_code_match_case_insensitive():
    result = _resolve_warehouse_hint_against_db("wh-hn", SAMPLE_WAREHOUSES)
    assert result["status"] == "RESOLVED"
    assert result["warehouse"]["id"] == "wh-1"


def test_exact_code_match_hcm2():
    result = _resolve_warehouse_hint_against_db("WH-HCM2", SAMPLE_WAREHOUSES)
    assert result["status"] == "RESOLVED"
    assert result["warehouse"]["id"] == "wh-4"


def test_name_match_ha_noi():
    result = _resolve_warehouse_hint_against_db("ha noi", SAMPLE_WAREHOUSES)
    assert result["status"] == "RESOLVED"
    assert result["warehouse"]["id"] == "wh-1"


def test_name_match_with_diacritics():
    result = _resolve_warehouse_hint_against_db("Hà Nội", SAMPLE_WAREHOUSES)
    assert result["status"] == "RESOLVED"
    assert result["warehouse"]["id"] == "wh-1"


def test_abbreviation_hn():
    result = _resolve_warehouse_hint_against_db("hn", SAMPLE_WAREHOUSES)
    assert result["status"] == "RESOLVED"
    assert result["warehouse"]["id"] == "wh-1"


def test_ambiguous_hcm():
    # "hcm" expands to ho chi minh which matches both wh-2 and wh-4
    result = _resolve_warehouse_hint_against_db("hcm", SAMPLE_WAREHOUSES)
    assert result["status"] == "AMBIGUOUS"
    assert len(result["candidates"]) == 2
    ids = {c["id"] for c in result["candidates"]}
    assert "wh-2" in ids
    assert "wh-4" in ids


def test_da_nang_resolved():
    result = _resolve_warehouse_hint_against_db("Đà Nẵng", SAMPLE_WAREHOUSES)
    assert result["status"] == "RESOLVED"
    assert result["warehouse"]["id"] == "wh-3"


def test_da_nang_no_diacritics():
    result = _resolve_warehouse_hint_against_db("da nang", SAMPLE_WAREHOUSES)
    assert result["status"] == "RESOLVED"
    assert result["warehouse"]["id"] == "wh-3"


def test_abbreviation_dn():
    result = _resolve_warehouse_hint_against_db("dn", SAMPLE_WAREHOUSES)
    assert result["status"] == "RESOLVED"
    assert result["warehouse"]["id"] == "wh-3"


def test_not_found():
    result = _resolve_warehouse_hint_against_db("can tho", SAMPLE_WAREHOUSES)
    assert result["status"] == "NOT_FOUND"
    assert result["warehouse"] is None
    assert result["candidates"] == []


def test_not_found_with_diacritics():
    result = _resolve_warehouse_hint_against_db("Cần Thơ", SAMPLE_WAREHOUSES)
    assert result["status"] == "NOT_FOUND"


def test_empty_hint():
    result = _resolve_warehouse_hint_against_db("", SAMPLE_WAREHOUSES)
    assert result["status"] == "NOT_FOUND"


def test_none_hint():
    result = _resolve_warehouse_hint_against_db(None, SAMPLE_WAREHOUSES)  # type: ignore[arg-type]
    assert result["status"] == "NOT_FOUND"


def test_empty_warehouse_list():
    result = _resolve_warehouse_hint_against_db("hn", [])
    assert result["status"] == "NOT_FOUND"


def test_province_match():
    # Province "Hanoi" should match warehouse "Kho Hà Nội"
    result = _resolve_warehouse_hint_against_db("Hanoi", SAMPLE_WAREHOUSES)
    assert result["status"] == "RESOLVED"
    assert result["warehouse"]["id"] == "wh-1"


def test_saigon_matches_hcm_ambiguous():
    # "saigon" is in the HCM expansion, both wh-2 and wh-4 have HCM province
    result = _resolve_warehouse_hint_against_db("saigon", SAMPLE_WAREHOUSES)
    assert result["status"] == "AMBIGUOUS"
    ids = {c["id"] for c in result["candidates"]}
    assert "wh-2" in ids
    assert "wh-4" in ids
