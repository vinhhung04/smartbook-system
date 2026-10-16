"""Confirm-time re-validation of an AI action (Copilot 3.2).

An action is proposed from one turn's data and confirmed later by a human.
Between the two, the user's scope may change, and the confirm request carries
an `override_payload` the client builds. Before an action is claimed for
execution, /actions/confirm re-checks here:

- the override only touches fields the confirm dialog legitimately edits
  (chosen warehouse, supplier, assignee; for a reorder draft the quantity of
  the proposed lines or dropping lines) - never the proposal's own decisions
  (which titles, resolution status, source intent...);
- every warehouse the action would write into is in the user's CURRENT write
  scope (auth-service, fail-closed: scope unreadable -> 503);
- quantities are positive integers within a sane bound.

Downstream services still enforce their own permissions and warehouse scope
with the user's token; this guard makes the AI layer refuse early, keeps the
action pending (not claimed and then failed), and never widens what the
human was shown.
"""
from __future__ import annotations

from fastapi import HTTPException

import warehouse_scope
from agent_actions import (
    CREATE_REORDER_DRAFT,
    CREATE_REPORT_DRAFT,
    CREATE_RESERVATION_DRAFT,
    CREATE_STAFF_TASK_DRAFT,
    CREATE_STOCK_ALERT,
)

_WAREHOUSE_CHOICE = {"warehouse_id", "warehouse_name", "warehouse_code"}
ALLOWED_OVERRIDES = {
    CREATE_REORDER_DRAFT: _WAREHOUSE_CHOICE | {"supplier_id", "supplier_name", "items"},
    CREATE_STOCK_ALERT: _WAREHOUSE_CHOICE,
    CREATE_RESERVATION_DRAFT: _WAREHOUSE_CHOICE,
    CREATE_STAFF_TASK_DRAFT: _WAREHOUSE_CHOICE | {"assignee_user_id"},
    CREATE_REPORT_DRAFT: set(),
}
MAX_LINE_QUANTITY = 1000
# Executors that write into a warehouse (reports are drafts with no warehouse).
_WRITES_WAREHOUSE = {CREATE_REORDER_DRAFT, CREATE_STOCK_ALERT, CREATE_RESERVATION_DRAFT, CREATE_STAFF_TASK_DRAFT}


def _line_key(item: dict) -> str:
    variant = item.get("book_variant_id") or item.get("variant_id")
    return f"v:{variant}" if variant else f"t:{item.get('title') or ''}"


def _quantity(value) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, float) and value.is_integer():
        return int(value)
    if isinstance(value, str) and value.strip().isdigit():
        return int(value.strip())
    return None


def validated_override(action_type: str, payload: dict, override: dict | None) -> dict:
    """The override the executor may apply, or HTTP 400."""
    if not override:
        return {}
    if not isinstance(override, dict):
        raise HTTPException(status_code=400, detail="override_payload không hợp lệ.")
    unknown = sorted(set(override) - ALLOWED_OVERRIDES.get(action_type, set()))
    if unknown:
        raise HTTPException(status_code=400, detail=f"Không được thay đổi các trường: {', '.join(unknown)}.")
    clean = {k: v for k, v in override.items() if k != "items"}
    for key in ("warehouse_id", "supplier_id", "assignee_user_id"):
        if key in clean and not (isinstance(clean[key], str) and clean[key].strip()):
            raise HTTPException(status_code=400, detail=f"{key} không hợp lệ.")
    if "items" in override:
        proposed = {_line_key(i): i for i in payload.get("items") or [] if isinstance(i, dict)}
        lines = override["items"]
        if not isinstance(lines, list) or not lines:
            raise HTTPException(status_code=400, detail="Cần giữ lại ít nhất một dòng đề xuất.")
        kept, seen = [], set()
        for line in lines:
            if not isinstance(line, dict) or _line_key(line) not in proposed or _line_key(line) in seen:
                raise HTTPException(status_code=400, detail="Chỉ được điều chỉnh các dòng mà hệ thống đã đề xuất.")
            seen.add(_line_key(line))
            base = proposed[_line_key(line)]
            qty = _quantity(line.get("suggested_quantity", base.get("suggested_quantity")))
            if qty is None or not 1 <= qty <= MAX_LINE_QUANTITY:
                raise HTTPException(status_code=400,
                                    detail=f"Số lượng mỗi dòng phải là số nguyên từ 1 đến {MAX_LINE_QUANTITY}.")
            # only the quantity comes from the client; the rest of the line is the proposal's
            kept.append({**base, "suggested_quantity": qty})
        clean["items"] = kept
    return clean


def target_warehouses(payload: dict) -> set[str]:
    """Every warehouse id the executor could write into for this payload."""
    ids = set()
    if isinstance(payload.get("warehouse_id"), str) and payload["warehouse_id"]:
        ids.add(payload["warehouse_id"])
    for item in payload.get("items") or []:
        if isinstance(item, dict) and isinstance(item.get("warehouse_id"), str) and item["warehouse_id"]:
            ids.add(item["warehouse_id"])
    return ids


async def require_write_scope(action_type: str, payload: dict, user_ctx) -> None:
    """403 when a target warehouse is outside the user's current write scope;
    503 when the scope cannot be read (fail-closed)."""
    if action_type not in _WRITES_WAREHOUSE:
        return
    ids = target_warehouses(payload)
    if not ids:
        return  # the executor itself refuses to write without a warehouse (draft_only)
    try:
        writable = await warehouse_scope.writable_warehouses(user_ctx)
    except warehouse_scope.ScopeUnavailable:
        raise HTTPException(status_code=503, detail="Chưa xác minh được quyền kho lúc này; đề xuất vẫn được giữ, hãy thử lại sau.")
    if writable is not None and not ids <= writable:
        raise HTTPException(status_code=403, detail="Bạn không có quyền ghi vào kho của đề xuất này.")
