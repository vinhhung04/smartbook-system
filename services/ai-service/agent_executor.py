from __future__ import annotations

import logging
import os
from uuid import uuid4

import httpx
from fastapi import HTTPException

from agent_actions import (
    CREATE_REORDER_DRAFT,
    CREATE_REPORT_DRAFT,
    CREATE_RESERVATION_DRAFT,
    CREATE_STOCK_ALERT,
    CREATE_STAFF_TASK_DRAFT,
    is_dangerous_action,
)
from agent_schemas import PendingAction, UserContext

logger = logging.getLogger("uvicorn.error")

GATEWAY_URL = os.getenv("SMARTBOOK_GATEWAY_URL", "http://api-gateway:3000").rstrip("/")
EXECUTOR_TIMEOUT = float(os.getenv("EXECUTOR_TIMEOUT_SECONDS", "10"))

_STAFF_ROLES = {"ADMIN", "WAREHOUSE_MANAGER", "LIBRARIAN", "WAREHOUSE_STAFF"}


def _short_id() -> str:
    return uuid4().hex[:8].upper()


def _user_roles_set(user_context: UserContext) -> set[str]:
    return {r.upper().replace("-", "_") for r in user_context.roles}


# ── Reorder Draft Executor ─────────────────────────────────────────────────────

async def _exec_reorder(pending_action: PendingAction, auth_header: str) -> dict:
    payload = pending_action.payload

    # Global fallback warehouse_id (from user override or payload-level selection)
    global_warehouse_id = payload.get("warehouse_id")
    resolution_status = payload.get("warehouse_resolution_status")
    items = payload.get("items") or []

    # Block execution when warehouse was ambiguous/not-found AND user still hasn't chosen one.
    # Once user picks a warehouse via the confirm dialog, global_warehouse_id is set via override.
    if resolution_status in ("AMBIGUOUS", "NOT_FOUND") and not global_warehouse_id:
        hint = payload.get("warehouse_hint") or ""
        return {
            "success": True,
            "mode": "draft_only",
            "request_id": f"REORDER-DRAFT-{_short_id()}",
            "message": (
                f"Chưa thể tạo phiếu — kho '{hint}' chưa được xác định rõ. "
                "Vui lòng chọn kho cụ thể trong modal xác nhận rồi thử lại."
            ),
            "payload": payload,
        }

    if not items:
        return {
            "success": True,
            "mode": "draft_only",
            "request_id": f"REORDER-DRAFT-{_short_id()}",
            "message": "Không có danh sách sách để tạo phiếu nhập.",
            "payload": payload,
        }

    valid_items = []
    skipped_items = []
    no_warehouse_items = []

    for item in items:
        if not isinstance(item, dict):
            continue
        variant_id = item.get("book_variant_id") or item.get("variant_id")
        if not variant_id:
            skipped_items.append(item.get("title") or "Unknown")
            continue
        # For AMBIGUOUS resolution, user explicitly chose a warehouse — override per-item warehouses
        # so all items go to the single warehouse the user selected.
        if resolution_status == "AMBIGUOUS" and global_warehouse_id:
            effective_warehouse = global_warehouse_id
        else:
            # Per-item warehouse_id takes priority; fallback to global
            effective_warehouse = item.get("warehouse_id") or global_warehouse_id
        if not effective_warehouse:
            no_warehouse_items.append(item.get("title") or "Unknown")
            continue
        valid_items.append({**item, "_effective_warehouse_id": effective_warehouse})

    if not valid_items:
        reasons = []
        if skipped_items:
            reasons.append(f"Thiếu book_variant_id: {', '.join(skipped_items[:3])}")
        if no_warehouse_items:
            reasons.append(f"Thiếu warehouse_id: {', '.join(no_warehouse_items[:3])}")
        return {
            "success": True,
            "mode": "draft_only",
            "request_id": f"REORDER-DRAFT-{_short_id()}",
            "message": (
                "Không thể tạo phiếu thật — " + "; ".join(reasons) + ". "
                "Vui lòng chọn kho dự phòng và thử lại."
            ),
            "skipped_items": skipped_items,
            "no_warehouse_items": no_warehouse_items,
            "payload": payload,
        }

    created_requests: list[dict] = []
    failed_items: list[dict] = []

    # Global supplier override (from user selection in UI)
    global_supplier_id = payload.get("supplier_id")
    global_supplier_name = payload.get("supplier_name")

    async with httpx.AsyncClient(timeout=httpx.Timeout(EXECUTOR_TIMEOUT)) as client:
        for item in valid_items:
            variant_id = item.get("book_variant_id") or item.get("variant_id")
            effective_warehouse_id = item["_effective_warehouse_id"]
            title = item.get("title") or "Unknown"
            quantity = max(1, int(item.get("suggested_quantity") or 1))
            reason_text = item.get("reason") or "LOW_STOCK"
            valid_reasons = {"LOW_STOCK", "CUSTOMER_REQUEST", "DAMAGED", "LOST", "OTHER"}
            reason = reason_text if reason_text in valid_reasons else "LOW_STOCK"

            # Resolve effective supplier: global override takes priority over per-item suggestion
            if global_supplier_id:
                effective_supplier_name = global_supplier_name or global_supplier_id
            else:
                effective_supplier_name = item.get("suggested_supplier_name")

            wh_note = f"Kho: {item.get('warehouse_code') or item.get('warehouse_name') or effective_warehouse_id}. " if item.get("warehouse_id") else ""
            supplier_note = f"NCC đề xuất: {effective_supplier_name}. " if effective_supplier_name else ""
            wh_source_note = ""
            if payload.get("warehouse_resolution_source") == "USER_MESSAGE":
                wh_source_note = (
                    f"Kho theo yêu cầu người dùng: "
                    f"{payload.get('resolved_warehouse_code')} — {payload.get('resolved_warehouse_name')}. "
                )

            body = {
                "warehouse_id": effective_warehouse_id,
                "book_variant_id": variant_id,
                "book_title_hint": title,
                "quantity_requested": quantity,
                "reason": reason,
                "note": (
                    f"{wh_source_note}{wh_note}{supplier_note}"
                    f"Tạo bởi SmartBook AI Agent từ intent {payload.get('source_intent')}. "
                    f"Priority: {item.get('priority', 'MEDIUM')}. "
                    f"Current stock: {item.get('current_stock', '?')}."
                ),
            }

            try:
                resp = await client.post(
                    f"{GATEWAY_URL}/api/purchase-requests",
                    json=body,
                    headers={"Authorization": auth_header, "Content-Type": "application/json"},
                )
                if resp.status_code in (200, 201):
                    data = resp.json()
                    req_data = data.get("data") or data
                    created_requests.append({
                        "title": title,
                        "warehouse_name": item.get("warehouse_name") or item.get("warehouse_code") or effective_warehouse_id,
                        "request_number": req_data.get("request_number"),
                        "quantity": quantity,
                        "suggested_supplier_name": effective_supplier_name,
                    })
                else:
                    failed_items.append({
                        "title": title,
                        "error": f"HTTP {resp.status_code}",
                        "detail": resp.text[:200],
                    })
            except Exception as exc:
                failed_items.append({"title": title, "error": str(exc)})

    has_skipped = bool(skipped_items) or bool(no_warehouse_items)
    if created_requests and not failed_items and not has_skipped:
        mode = "real_api"
    elif created_requests:
        mode = "partial"
    else:
        mode = "draft_only"

    request_numbers = [r["request_number"] for r in created_requests if r.get("request_number")]
    message_parts = []
    if created_requests:
        message_parts.append(f"Đã tạo {len(created_requests)} phiếu yêu cầu nhập thật.")
        if request_numbers:
            message_parts.append(f"Mã phiếu: {', '.join(request_numbers)}.")
    if failed_items:
        message_parts.append(f"{len(failed_items)} sách thất bại.")
    if skipped_items:
        message_parts.append(
            f"{len(skipped_items)} sách bị bỏ qua do thiếu book_variant_id: "
            f"{', '.join(skipped_items[:3])}{'...' if len(skipped_items) > 3 else ''}."
        )
    if no_warehouse_items:
        message_parts.append(
            f"{len(no_warehouse_items)} sách bị bỏ qua do thiếu kho: "
            f"{', '.join(no_warehouse_items[:3])}{'...' if len(no_warehouse_items) > 3 else ''}."
        )
    if not created_requests:
        message_parts.append("Không có phiếu thật nào được tạo.")

    return {
        "success": bool(created_requests) or mode == "draft_only",
        "mode": mode,
        "created_requests": created_requests,
        "failed_items": failed_items,
        "skipped_items": skipped_items,
        "no_warehouse_items": no_warehouse_items,
        "message": " ".join(message_parts),
    }


# ── Report Draft Executor ──────────────────────────────────────────────────────

async def _exec_report(payload: dict) -> dict:
    return {
        "success": True,
        "mode": "generated",
        "report_markdown": payload.get("report_markdown", ""),
        "report_title": payload.get("report_title", "Báo cáo SmartBook AI"),
        "message": "Report draft generated. No database was modified.",
    }


# ── Reservation Draft Executor ─────────────────────────────────────────────────

async def _exec_reservation(
    pending_action: PendingAction,
    auth_header: str,
    user_context: UserContext,
) -> dict:
    payload = pending_action.payload
    variant_id = payload.get("book_variant_id") or payload.get("variant_id")
    warehouse_id = payload.get("warehouse_id")

    if not variant_id or not warehouse_id:
        return {
            "success": True,
            "mode": "draft_only",
            "reservation_id": f"RES-DRAFT-{_short_id()}",
            "message": "Reservation draft created for review. Missing variant_id or warehouse_id, so no reservation was persisted.",
            "payload": payload,
        }

    user_roles = _user_roles_set(user_context)
    idempotency_key = f"ai-reservation-{pending_action.id}"

    is_customer = "CUSTOMER" in user_roles and not (user_roles & _STAFF_ROLES)

    if is_customer or "CUSTOMER" in user_roles:
        # Customer self-service route
        body = {
            "variant_id": variant_id,
            "warehouse_id": warehouse_id,
            "pickup_location_id": payload.get("pickup_location_id"),
            "quantity": payload.get("quantity") or 1,
            "source_channel": "WEB",
            "notes": payload.get("notes"),
        }
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(EXECUTOR_TIMEOUT)) as client:
                resp = await client.post(
                    f"{GATEWAY_URL}/my/reservations",
                    json=body,
                    headers={
                        "Authorization": auth_header,
                        "Content-Type": "application/json",
                        "Idempotency-Key": idempotency_key,
                    },
                )
                if resp.status_code in (200, 201):
                    return {
                        "success": True,
                        "mode": "real_api",
                        "message": "Reservation created successfully via /my/reservations.",
                        "reservation": resp.json(),
                    }
                raise HTTPException(
                    status_code=resp.status_code,
                    detail=f"Reservation failed: {resp.text[:300]}",
                )
        except HTTPException:
            raise
        except Exception as exc:
            raise HTTPException(status_code=500, detail=f"Reservation error: {exc}")

    # Staff/manager/admin route — requires customer_id
    customer_id = payload.get("customer_id")
    if not customer_id:
        return {
            "success": True,
            "mode": "draft_only",
            "reservation_id": f"RES-DRAFT-{_short_id()}",
            "message": "Reservation draft created. Staff must select a customer before a real reservation can be created.",
            "payload": payload,
        }

    body = {
        "customer_id": customer_id,
        "variant_id": variant_id,
        "warehouse_id": warehouse_id,
        "pickup_location_id": payload.get("pickup_location_id"),
        "quantity": payload.get("quantity") or 1,
        "source_channel": "ADMIN",
        "notes": payload.get("notes"),
    }
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(EXECUTOR_TIMEOUT)) as client:
            resp = await client.post(
                f"{GATEWAY_URL}/borrow/reservations",
                json=body,
                headers={
                    "Authorization": auth_header,
                    "Content-Type": "application/json",
                    "Idempotency-Key": idempotency_key,
                },
            )
            if resp.status_code in (200, 201):
                return {
                    "success": True,
                    "mode": "real_api",
                    "message": "Reservation created successfully via /borrow/reservations.",
                    "reservation": resp.json(),
                }
            raise HTTPException(
                status_code=resp.status_code,
                detail=f"Reservation failed: {resp.text[:300]}",
            )
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Reservation error: {exc}")


# ── Stock Alert Executor ───────────────────────────────────────────────────────

async def _exec_stock_alert(payload: dict, auth_header: str) -> dict:
    items = payload.get("items") or []
    # Global fallback warehouse (from user selection for items without warehouse_id)
    global_warehouse_id = payload.get("warehouse_id")

    valid_items = []
    skipped_items: list[str] = []
    no_warehouse_items: list[str] = []

    for item in items:
        if not isinstance(item, dict):
            continue
        variant_id = item.get("book_variant_id") or item.get("variant_id")
        if not variant_id:
            skipped_items.append(item.get("title", "Unknown"))
            continue
        effective_warehouse = item.get("warehouse_id") or global_warehouse_id
        if not effective_warehouse:
            no_warehouse_items.append(item.get("title", "Unknown"))
            continue
        valid_items.append({**item, "_effective_warehouse_id": effective_warehouse})

    if not valid_items:
        reasons = []
        if skipped_items:
            reasons.append(f"Thiếu book_variant_id: {', '.join(skipped_items[:3])}")
        if no_warehouse_items:
            reasons.append(f"Thiếu warehouse_id: {', '.join(no_warehouse_items[:3])}")
        return {
            "success": True,
            "mode": "draft_only",
            "message": "Không thể tạo cảnh báo thật — " + "; ".join(reasons) + ". Vui lòng chọn kho dự phòng và thử lại.",
            "skipped_items": skipped_items,
            "no_warehouse_items": no_warehouse_items,
            "alert": payload,
        }

    created_alerts: list[dict] = []
    failed_items: list[dict] = []
    duplicate_items: list[str] = []

    async with httpx.AsyncClient(timeout=httpx.Timeout(EXECUTOR_TIMEOUT)) as client:
        for item in valid_items:
            variant_id = item.get("book_variant_id") or item.get("variant_id")
            effective_warehouse_id = item["_effective_warehouse_id"]
            title = item.get("title", "Unknown")
            current_stock = item.get("current_stock")
            alert_type = "OUT_OF_STOCK" if (current_stock is not None and int(current_stock) == 0) else "LOW_STOCK"
            alert_level = str(item.get("priority", "MEDIUM")).upper()
            if alert_level not in ("LOW", "MEDIUM", "HIGH"):
                alert_level = "MEDIUM"

            body = {
                "variant_id": variant_id,
                "warehouse_id": effective_warehouse_id,
                "alert_type": alert_type,
                "alert_level": alert_level,
                "current_value": current_stock,
                "threshold_value": item.get("threshold", 10),
                "payload": {
                    "title": title,
                    "source": "AI_ASSISTANT",
                    "warehouse_name": item.get("warehouse_name"),
                    "warehouse_code": item.get("warehouse_code"),
                    "suggested_action": item.get("suggested_action"),
                    "reason": item.get("reason"),
                },
            }

            try:
                resp = await client.post(
                    f"{GATEWAY_URL}/api/stock-alerts",
                    json=body,
                    headers={"Authorization": auth_header, "Content-Type": "application/json"},
                )
                if resp.status_code == 201:
                    data = resp.json()
                    created_alerts.append({
                        "title": title,
                        "warehouse_name": item.get("warehouse_name") or item.get("warehouse_code") or effective_warehouse_id,
                        "id": (data.get("data") or {}).get("id"),
                        "alert_type": alert_type,
                    })
                elif resp.status_code == 200:
                    duplicate_items.append(title)
                else:
                    failed_items.append({
                        "title": title,
                        "error": f"HTTP {resp.status_code}",
                        "detail": resp.text[:200],
                    })
            except Exception as exc:
                failed_items.append({"title": title, "error": str(exc)})

    has_skipped = bool(skipped_items) or bool(no_warehouse_items)
    if created_alerts and not failed_items and not has_skipped:
        mode = "real_api"
    elif created_alerts or duplicate_items:
        mode = "partial"
    else:
        mode = "draft_only"

    parts = []
    if created_alerts:
        parts.append(f"Đã tạo {len(created_alerts)} cảnh báo mới.")
    if duplicate_items:
        parts.append(f"{len(duplicate_items)} cảnh báo đã tồn tại (bỏ qua).")
    if failed_items:
        parts.append(f"{len(failed_items)} sách thất bại.")
    if skipped_items:
        parts.append(f"{len(skipped_items)} sách bỏ qua (thiếu variant_id).")
    if no_warehouse_items:
        parts.append(f"{len(no_warehouse_items)} sách bỏ qua (thiếu warehouse).")
    if not parts:
        parts.append("Không tạo được cảnh báo nào.")

    return {
        "success": bool(created_alerts) or bool(duplicate_items),
        "mode": mode,
        "created_alerts": created_alerts,
        "duplicate_items": duplicate_items,
        "failed_items": failed_items,
        "skipped_items": skipped_items,
        "no_warehouse_items": no_warehouse_items,
        "message": " ".join(parts),
    }


# ── Staff Task Draft Executor ──────────────────────────────────────────────────

async def _exec_staff_task(payload: dict, auth_header: str) -> dict:
    assignee_user_id = payload.get("assignee_user_id")
    if not assignee_user_id:
        return {
            "success": True,
            "mode": "draft_only",
            "message": (
                "Chưa tạo task thật vì thiếu người được giao (assignee_user_id). "
                "Vui lòng tạo task trực tiếp trong giao diện quản lý task và chỉ định nhân viên thực hiện."
            ),
            "task": payload,
        }

    body = {
        "title": payload.get("task_title") or payload.get("title") or "Task từ AI",
        "assignee_user_id": assignee_user_id,
        "task_type": payload.get("task_type", "GENERAL"),
        "priority": payload.get("priority", "MEDIUM"),
    }
    if payload.get("description"):
        body["description"] = payload["description"]
    if payload.get("warehouse_id"):
        body["warehouse_id"] = payload["warehouse_id"]
    if payload.get("due_date"):
        body["due_date"] = payload["due_date"]

    async with httpx.AsyncClient(timeout=httpx.Timeout(EXECUTOR_TIMEOUT)) as client:
        resp = await client.post(
            f"{GATEWAY_URL}/api/staff-tasks",
            json=body,
            headers={"Authorization": auth_header},
        )

    if resp.status_code not in (200, 201):
        raise HTTPException(status_code=resp.status_code, detail=f"Gateway error creating staff task: {resp.text[:200]}")

    data = resp.json()
    task = data.get("data", data)
    return {
        "success": True,
        "mode": "real_api",
        "message": f"Đã tạo staff task thành công.",
        "task": task,
    }


# ── Main executor entry point ─────────────────────────────────────────────────

async def execute_agent_action(
    pending_action: PendingAction,
    auth_header: str,
    user_context: UserContext,
) -> dict:
    """Execute a confirmed pending action.

    Always passes the original Authorization header to downstream services.
    Never logs the token.
    """
    action_type = pending_action.type

    if is_dangerous_action(action_type):
        raise HTTPException(
            status_code=403,
            detail=f"Action type '{action_type}' is in the dangerous action denylist and cannot be executed.",
        )

    if action_type == CREATE_REORDER_DRAFT:
        return await _exec_reorder(pending_action, auth_header)
    if action_type == CREATE_REPORT_DRAFT:
        return await _exec_report(pending_action.payload)
    if action_type == CREATE_RESERVATION_DRAFT:
        return await _exec_reservation(pending_action, auth_header, user_context)
    if action_type == CREATE_STOCK_ALERT:
        return await _exec_stock_alert(pending_action.payload, auth_header)
    if action_type == CREATE_STAFF_TASK_DRAFT:
        return await _exec_staff_task(pending_action.payload, auth_header)

    raise HTTPException(status_code=400, detail=f"Unknown action type: '{action_type}'.")
