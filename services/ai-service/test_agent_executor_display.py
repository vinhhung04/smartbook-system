"""Result messages must name the warehouse that was actually used, not show its id."""
from agent_executor import _warehouse_display


def test_item_warehouse_used_shows_item_name():
    item = {"warehouse_id": "w1", "warehouse_name": "Kho Ha Noi", "warehouse_code": "WH-HN-01"}
    assert _warehouse_display(item, "w1", {}) == "Kho Ha Noi"


def test_fallback_warehouse_chosen_at_confirm_shows_chosen_name():
    item = {"warehouse_id": None}
    payload = {"warehouse_id": "w2", "warehouse_name": "Kho HCM Chinh", "warehouse_code": "WH-HCM-01"}
    assert _warehouse_display(item, "w2", payload) == "Kho HCM Chinh"


def test_ambiguous_override_does_not_reuse_the_items_old_warehouse_name():
    item = {"warehouse_id": "w1", "warehouse_name": "Kho Ha Noi"}
    payload = {"warehouse_id": "w2", "warehouse_code": "WH-HCM-01"}
    assert _warehouse_display(item, "w2", payload) == "WH-HCM-01"


def test_id_is_the_last_resort():
    assert _warehouse_display({}, "w9", {}) == "w9"
