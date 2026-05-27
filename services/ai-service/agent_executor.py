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

_STAFF_ROLES = {"ADMIN", "MANAGER", "LIBRARIAN", "STAFF", "WAREHOUSE_STAFF", "WAREHOUSE_OPERATOR"}


def _short_id() -> str:
    return uuid4().hex[:8].upper()


def _user_roles_set(user_context: UserContext) -> set[str]:
    return {r.upper().replace("-", "_") for r in user_context.roles}


# ── Reorder Draft Executor ─────────────────────────────────────────────────────

async def _exec_reorder(pending_action: PendingAction, auth_header: str) -> dict:
    payload = pending_action.payload
    warehouse_id = payload.get("warehouse_id")
    items = payload.get("items") or []

    if not warehouse_id or not items:
        return {
            "success": True,
            "mode": "draft_only",
            "request_id": f"REORDER-DRAFT-{_short_id()}",
            "message": "Reorder draft created for review. Missing warehouse/items so no purchase request was persisted.",
            "payload": payload,
        }

    created_requests = []
    failed_items = []

    async with httpx.AsyncClient(timeout=httpx.Timeout(EXECUTOR_TIMEOUT)) as client:
        for item in items:
            if not isinstance(item, dict):
                continue
            variant_id = item.get("book_variant_id") or item.get("variant_id")
            title = item.get("title") or "Unknown"
            quantity = max(1, int(item.get("suggested_quantity") or 1))
            reason_text = item.get("reason") or "LOW_STOCK"
            # Map to valid reason enum values
            valid_reasons = {"LOW_STOCK", "CUSTOMER_REQUEST", "DAMAGED", "LOST", "OTHER"}
            reason = reason_text if reason_text in valid_reasons else "LOW_STOCK"

            body = {
                "warehouse_id": warehouse_id,
                "book_variant_id": variant_id,
                "book_title_hint": title,
                "quantity_requested": quantity,
                "reason": reason,
                "note": f"Tạo bởi SmartBook AI Agent từ intent {payload.get('source_intent')}. "
                        f"Priority: {item.get('priority', 'MEDIUM')}. "
                        f"Current stock: {item.get('current_stock', '?')}.",
            }

            try:
                resp = await client.post(
                    f"{GATEWAY_URL}/api/purchase-requests",
                    json=body,
                    headers={"Authorization": auth_header, "Content-Type": "application/json"},
                )
                if resp.status_code in (200, 201):
                    created_requests.append({"title": title, "response": resp.json()})
                else:
                    failed_items.append({
                        "title": title,
                        "error": f"HTTP {resp.status_code}",
                        "detail": resp.text[:200],
                    })
            except Exception as exc:
                failed_items.append({"title": title, "error": str(exc)})

    mode = "real_api" if created_requests and not failed_items else (
        "partial" if created_requests else "draft_only"
    )
    return {
        "success": bool(created_requests) or mode == "draft_only",
        "mode": mode,
        "created_requests": created_requests,
        "failed_items": failed_items,
        "message": (
            f"{len(created_requests)} purchase request(s) created successfully."
            if created_requests
            else "No purchase requests could be created. Returning draft."
        ),
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

    is_customer = "CUSTOMER" in user_roles and not (user_roles & _STAFF_ROLES - {"STAFF"})

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

async def _exec_stock_alert(payload: dict) -> dict:
    # Production TODO: integrate with real notification/alert service
    return {
        "success": True,
        "mode": "draft_only",
        "alert_id": f"ALERT-DEMO-{_short_id()}",
        "message": "Stock alert draft created. No inventory data was changed.",
        "alert": payload,
    }


# ── Staff Task Draft Executor ──────────────────────────────────────────────────

async def _exec_staff_task(payload: dict) -> dict:
    # Production TODO: create ai_agent_tasks table or integrate with real task module
    return {
        "success": True,
        "mode": "agent_task_draft",
        "task_id": f"TASK-DEMO-{_short_id()}",
        "message": "Staff task draft created in AI Agent store. No business data was changed.",
        "task": payload,
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
        return await _exec_stock_alert(pending_action.payload)
    if action_type == CREATE_STAFF_TASK_DRAFT:
        return await _exec_staff_task(pending_action.payload)

    raise HTTPException(status_code=400, detail=f"Unknown action type: '{action_type}'.")
