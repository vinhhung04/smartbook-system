"""Rebalancing drafts (Phase 5): from a computed plan to real requests.

Draft (no write): the lines of the plan's EXECUTABLE option that the user can
create now - transfer requests grouped by (source, destination) and purchase
requests per line - plus, as proposals only, what needs another manager
(collaborative transfers, purchases in READ warehouses). The lines are read
from analytics again with the turn's own arguments (same cache), never from
the model's text.

Execution (after the user's confirmation, through /actions/confirm):
- write scope re-read fresh from auth-service, role/permission re-checked per
  part; a part the user can no longer do is skipped, the rest goes ahead;
- each request carries the tag [AI-REB:<action id>#T<n>] / #P<n> in its note,
  and requests already created with that tag are reported, not created again;
- stock is checked by inventory-service itself (409 INSUFFICIENT_STOCK);
- transfers are created REQUESTED and purchase requests PENDING: approval,
  picking, shipping and receiving stay the existing workflow's own steps;
- an unknown outcome (timeout / 5xx) marks the action for reconciliation.
"""
from __future__ import annotations

import os

import httpx
from fastapi import HTTPException

import copilot_tools
import warehouse_scope
from agent_actions import (CREATE_REBALANCE_DRAFT, PURCHASE_REQUEST_POLICY, TRANSFER_REQUEST_POLICY, get_action_config,
                           policy_allows)

GATEWAY_URL = os.getenv("SMARTBOOK_GATEWAY_URL", "http://api-gateway:3000").rstrip("/")
EXECUTOR_TIMEOUT = float(os.getenv("EXECUTOR_TIMEOUT_SECONDS", "10"))
MAX_LINES = 60  # a draft larger than this is cut and says so

_REASON_VI = {
    "NO_WRITE_ON_SOURCE": "bạn chỉ có quyền xem kho nguồn; cần Manager kho nguồn tạo yêu cầu",
    "NO_TRANSFER_PERMISSION": "tài khoản không có quyền tạo yêu cầu điều chuyển",
    "NO_WRITE_ON_WAREHOUSE": "bạn chỉ có quyền xem kho này; cần Manager kho đó tạo phiếu nhập",
    "NO_PURCHASE_PERMISSION": "tài khoản không có quyền tạo phiếu yêu cầu nhập",
}


def _last_call_args(plan) -> dict | None:
    calls = [c for c in plan.required_tools if c.get("name") == "analyze_inventory_rebalancing"]
    return dict(calls[-1].get("args") or {}) if calls else None


def build_payload(data: dict, args: dict) -> dict | None:
    """The draft of the plan's executable option, or None when there is nothing
    the user can create now."""
    rec = data.get("recommendation") or {}
    options = data.get("options") or {}
    code = rec.get("executable_option")
    option = options.get(code) if code else None
    names = {w.get("warehouse_id"): w.get("name") or w.get("code")
             for w in (data.get("scope") or {}).get("warehouses") or []}
    best = options.get(rec.get("best_business_option")) or {}
    proposals = [{
        "kind": "TRANSFER", "title": t.get("title"), "quantity": t.get("quantity"),
        "from_warehouse": names.get(t.get("from_warehouse_id")), "to_warehouse": names.get(t.get("to_warehouse_id")),
        "reason": _REASON_VI.get(t.get("permission_reason"), t.get("permission_reason")),
    } for t in best.get("transfers") or [] if t.get("permission") != "EXECUTABLE"] + [{
        "kind": "PURCHASE", "title": p.get("title"), "quantity": p.get("quantity"), "warehouse": names.get(p.get("warehouse_id")),
        "reason": _REASON_VI.get(p.get("permission_reason"), p.get("permission_reason")),
    } for p in best.get("purchases") or [] if p.get("permission") != "EXECUTABLE"]
    if not option or option.get("transfer_lines", 0) + option.get("purchase_lines", 0) == 0:
        return None
    groups: dict[tuple, dict] = {}
    for t in option.get("transfers") or []:
        if t.get("permission") != "EXECUTABLE":
            continue
        k = (t["from_warehouse_id"], t["to_warehouse_id"])
        g = groups.setdefault(k, {"from_warehouse_id": k[0], "from_warehouse": names.get(k[0]),
                                  "to_warehouse_id": k[1], "to_warehouse": names.get(k[1]), "lines": []})
        g["lines"].append({"variant_id": t["variant_id"], "title": t.get("title"), "quantity": int(t["quantity"]),
                           "source_available_after": t.get("source_available_after")})
    purchases = [{"warehouse_id": p["warehouse_id"], "warehouse": names.get(p["warehouse_id"]), "variant_id": p["variant_id"],
                  "title": p.get("title"), "quantity": int(p["quantity"]), "unit_cost": p.get("unit_cost"),
                  "cost": p.get("cost")} for p in option.get("purchases") or [] if p.get("permission") == "EXECUTABLE"]
    transfers = list(groups.values())
    lines = sum(len(g["lines"]) for g in transfers) + len(purchases)
    truncated = lines > MAX_LINES
    if truncated:
        purchases = purchases[:max(0, MAX_LINES - sum(len(g["lines"]) for g in transfers))]
    return {
        "option": code,
        "option_metrics": {k: option.get(k) for k in (
            "total_shortage_qty", "transfer_qty", "purchase_qty", "remaining_shortage_qty", "shortage_covered_pct",
            "purchase_cost_vnd", "remaining_budget_vnd", "risk_level")},
        "scenario_args": args,
        "transfers": transfers,
        "purchases": purchases,
        "proposals": proposals[:20],
        "truncated": truncated,
        "source": "analytics/rebalancing-plan",
        "retrieved_at": data.get("generated_at"),
    }


def summary_of(payload: dict) -> str:
    t_lines = sum(len(g["lines"]) for g in payload["transfers"])
    t_qty = sum(line["quantity"] for g in payload["transfers"] for line in g["lines"])
    p_qty = sum(p["quantity"] for p in payload["purchases"])
    cost = sum(float(p.get("cost") or 0) for p in payload["purchases"])
    parts = []
    if payload["transfers"]:
        parts.append(f"{len(payload['transfers'])} yêu cầu điều chuyển ({t_lines} dòng, {t_qty} bản)")
    if payload["purchases"]:
        money = f"{int(cost):,}".replace(",", ".")
        parts.append(f"{len(payload['purchases'])} phiếu yêu cầu nhập ({p_qty} bản, ~{money} ₫)")
    text = "Bản nháp: " + " và ".join(parts)
    if payload["proposals"]:
        text += f"; {len(payload['proposals'])} việc cần Manager khác phối hợp (chỉ đề xuất)"
    return text + "."


async def plan_draft(plan, user_ctx, auth_header: str | None, conversation_id: str | None) -> tuple[dict | None, str | None]:
    """(pending action, note for the answer). Nothing is written here."""
    from agent_store import create_pending_action  # local: needs the database layer

    args = _last_call_args(plan)
    if args is None:
        return None, None
    data, _destinations = await copilot_tools.fetch_rebalancing_plan(auth_header, **args)
    if not isinstance(data, dict) or data.get("error"):
        return None, "Chưa tạo được bản nháp vì không đọc lại được kế hoạch từ hệ thống."
    payload = build_payload(data, args)
    if payload is None:
        return None, ("Không có hành động nào bạn tự thực hiện được trong phương án này; các việc cần Manager khác "
                      "phối hợp vẫn chỉ ở trạng thái đề xuất.")
    if not policy_allows(get_action_config(CREATE_REBALANCE_DRAFT)["policy"], user_ctx.roles, user_ctx.permissions,
                         user_ctx.is_superuser):
        return None, "Tài khoản của bạn không có quyền tạo yêu cầu điều chuyển hay phiếu nhập."
    action = await create_pending_action(
        action_type=CREATE_REBALANCE_DRAFT, summary=summary_of(payload), payload=payload, risk="MEDIUM",
        sources=[{"source": "analytics/rebalancing-plan", "retrieved_at": payload["retrieved_at"]}],
        intent="INVENTORY_REBALANCING_QUERY", created_from_message=plan.normalized, user_context=user_ctx,
        conversation_id=conversation_id,
        warnings=(["Bản nháp đã được rút gọn còn " + str(MAX_LINES) + " dòng."] if payload["truncated"] else []),
    )
    return action.model_dump(), None


def _tag(action_id: str, part: str) -> str:
    return f"[AI-REB:{action_id}#{part}]"


async def _notes(client: httpx.AsyncClient, url: str, auth_header: str, params: dict | None = None) -> list[dict]:
    resp = await client.get(f"{GATEWAY_URL}{url}", params=params, headers={"Authorization": auth_header})
    if resp.status_code >= 400:
        raise HTTPException(status_code=503, detail="Không kiểm tra được các yêu cầu đã tạo trước đó (chống trùng); "
                                                    "chưa thực hiện gì, có thể xác nhận lại sau.")
    rows = (resp.json() or {}).get("data") or []
    return [r for r in rows if isinstance(r, dict)]


def _number(row: dict) -> str | None:
    return row.get("order_number") or row.get("transfer_number") or row.get("request_number")


async def execute(action, auth_header: str, user_ctx) -> dict:
    payload = action.payload or {}
    try:
        writable = await warehouse_scope.writable_warehouses(user_ctx, fresh=True)
    except warehouse_scope.ScopeUnavailable:
        raise HTTPException(status_code=503, detail="Chưa xác minh được quyền kho lúc này; chưa thực hiện gì.")
    roles, perms, su = user_ctx.roles, user_ctx.permissions, user_ctx.is_superuser
    can_transfer = policy_allows(TRANSFER_REQUEST_POLICY, roles, perms, su)
    can_purchase = policy_allows(PURCHASE_REQUEST_POLICY, roles, perms, su)
    created_transfers, created_purchases, existing, skipped, failed = [], [], [], [], []
    headers = {"Authorization": auth_header, "Content-Type": "application/json"}
    async with httpx.AsyncClient(timeout=httpx.Timeout(EXECUTOR_TIMEOUT)) as client:
        done_transfers = [r for r in await _notes(client, "/api/order-requests", auth_header, {"view": "my"})
                          if str(r.get("status", "")).upper() not in ("CANCELLED", "REJECTED")]
        done_purchases = [r for r in await _notes(client, "/api/purchase-requests/my", auth_header)
                          if str(r.get("status", "")).upper() not in ("REJECTED", "WITHDRAWN")]
        for i, group in enumerate(payload.get("transfers") or [], 1):
            tag = _tag(action.id, f"T{i}")
            label = f"{group.get('from_warehouse')} → {group.get('to_warehouse')}"
            if not can_transfer:
                skipped.append({"kind": "TRANSFER", "label": label, "reason": _REASON_VI["NO_TRANSFER_PERMISSION"]})
                continue
            if writable is not None and group["from_warehouse_id"] not in writable:
                skipped.append({"kind": "TRANSFER", "label": label, "reason": "quyền ghi tại kho nguồn đã bị thu hồi"})
                continue
            prior = next((r for r in done_transfers if tag in str(r.get("note") or "")), None)
            if prior:
                existing.append({"kind": "TRANSFER", "label": label, "number": _number(prior), "status": prior.get("status")})
                continue
            body = {"from_warehouse_id": group["from_warehouse_id"], "to_warehouse_id": group["to_warehouse_id"],
                    "note": f"{tag} Tạo từ SmartBook AI theo phương án {payload.get('option')}; chờ duyệt theo quy trình.",
                    "lines": [{"variant_id": ln["variant_id"], "quantity": ln["quantity"]} for ln in group["lines"]]}
            try:
                resp = await client.post(f"{GATEWAY_URL}/api/order-requests/transfer", json=body, headers=headers)
            except httpx.HTTPError as exc:
                failed.append({"kind": "TRANSFER", "title": label, "error": str(exc), "outcome": "unknown"})
                continue
            if resp.status_code in (200, 201):
                data = (resp.json() or {}).get("data") or {}
                created_transfers.append({"label": label, "number": _number(data), "status": data.get("status"),
                                          "task_id": data.get("task_id"), "lines": len(group["lines"]),
                                          "quantity": sum(ln["quantity"] for ln in group["lines"])})
            elif resp.status_code == 409:
                skipped.append({"kind": "TRANSFER", "label": label,
                                "reason": "tồn khả dụng ở kho nguồn đã thay đổi, không còn đủ để điều chuyển",
                                "detail": resp.text[:200]})
            else:
                failed.append({"kind": "TRANSFER", "title": label, "error": f"HTTP {resp.status_code}",
                               "detail": resp.text[:200], "outcome": "unknown" if resp.status_code >= 500 else "refused"})
        for i, line in enumerate(payload.get("purchases") or [], 1):
            tag = _tag(action.id, f"P{i}")
            label = f"{line.get('title')} ({line.get('warehouse')})"
            if not can_purchase:
                skipped.append({"kind": "PURCHASE", "label": label, "reason": _REASON_VI["NO_PURCHASE_PERMISSION"]})
                continue
            if writable is not None and line["warehouse_id"] not in writable:
                skipped.append({"kind": "PURCHASE", "label": label, "reason": "quyền ghi tại kho đã bị thu hồi"})
                continue
            prior = next((r for r in done_purchases if tag in str(r.get("note") or "")), None)
            if prior:
                existing.append({"kind": "PURCHASE", "label": label, "number": _number(prior), "status": prior.get("status")})
                continue
            body = {"warehouse_id": line["warehouse_id"], "book_variant_id": line["variant_id"],
                    "book_title_hint": line.get("title"), "quantity_requested": line["quantity"], "reason": "LOW_STOCK",
                    "note": f"{tag} Tạo từ SmartBook AI theo phương án {payload.get('option')}."}
            try:
                resp = await client.post(f"{GATEWAY_URL}/api/purchase-requests", json=body, headers=headers)
            except httpx.HTTPError as exc:
                failed.append({"kind": "PURCHASE", "title": label, "error": str(exc), "outcome": "unknown"})
                continue
            if resp.status_code in (200, 201):
                data = (resp.json() or {}).get("data") or {}
                created_purchases.append({"label": label, "number": _number(data), "status": data.get("status"),
                                          "quantity": line["quantity"]})
            else:
                failed.append({"kind": "PURCHASE", "title": label, "error": f"HTTP {resp.status_code}",
                               "detail": resp.text[:200], "outcome": "unknown" if resp.status_code >= 500 else "refused"})
    needs_reconciliation = any(f.get("outcome") == "unknown" for f in failed)
    numbers = [c["number"] for c in created_transfers + created_purchases if c.get("number")]
    message = []
    if created_transfers:
        message.append(f"Đã tạo {len(created_transfers)} yêu cầu điều chuyển (trạng thái REQUESTED, chờ duyệt).")
    if created_purchases:
        message.append(f"Đã tạo {len(created_purchases)} phiếu yêu cầu nhập (chờ duyệt).")
    if numbers:
        message.append("Mã: " + ", ".join(numbers) + ".")
    if existing:
        message.append(f"{len(existing)} yêu cầu đã được tạo trước đó từ bản nháp này, không tạo lại.")
    if skipped:
        message.append(f"{len(skipped)} phần không thực hiện được (xem lý do).")
    if failed:
        message.append(f"{len(failed)} phần thất bại.")
    if needs_reconciliation:
        message.append("Một số phần không xác định được kết quả; cần đối chiếu trước khi tạo lại.")
    if not message:
        message.append("Không có phần nào được thực hiện.")
    return {
        "success": bool(created_transfers or created_purchases or existing),
        "mode": "real_api" if (created_transfers or created_purchases) and not (skipped or failed) else "partial",
        "created_transfers": created_transfers,
        "created_purchase_requests": created_purchases,
        "already_created": existing,
        "skipped": skipped,
        "failed_items": failed,
        "proposals": payload.get("proposals") or [],
        "next_steps": ["Người duyệt duyệt yêu cầu điều chuyển trên màn hình Yêu cầu xuất/chuyển kho.",
                       "Kho nguồn lấy hàng, xuất kho; kho đích nhận hàng theo quy trình hiện tại.",
                       "Phiếu yêu cầu nhập được duyệt và chuyển thành đơn mua theo quy trình mua hàng."],
        "needs_reconciliation": needs_reconciliation,
        "message": " ".join(message),
    }


def execution_answer(status: str | None, result: dict | None) -> str:
    """The reply to "Tôi xác nhận", built from the executor's result only."""
    result = result or {}
    lines = [result.get("message") or "Đã xử lý bản nháp."]
    for t in result.get("created_transfers") or []:
        lines.append(f"- Yêu cầu điều chuyển **{t.get('number')}** ({t.get('label')}, {t.get('quantity')} bản): "
                     f"{t.get('status')}, chờ duyệt.")
    for p in result.get("created_purchase_requests") or []:
        lines.append(f"- Phiếu yêu cầu nhập **{p.get('number')}** ({p.get('label')}, {p.get('quantity')} bản): "
                     f"{p.get('status') or 'PENDING'}.")
    for e in result.get("already_created") or []:
        lines.append(f"- Đã có từ trước: {e.get('number')} ({e.get('label')}), không tạo lại.")
    for s in result.get("skipped") or []:
        lines.append(f"- Không thực hiện: {s.get('label')} — {s.get('reason')}.")
    for f in result.get("failed_items") or []:
        lines.append(f"- Thất bại: {f.get('title')} ({f.get('error')}).")
    proposals = result.get("proposals") or []
    if proposals:
        lines.append("Cần Manager khác phối hợp (chỉ là đề xuất, chưa tạo gì):")
        for p in proposals[:8]:
            where = f"{p.get('from_warehouse')} → {p.get('to_warehouse')}" if p.get("kind") == "TRANSFER" else p.get("warehouse")
            lines.append(f"- {p.get('title')}: {p.get('quantity')} bản ({where}) — {p.get('reason')}.")
    if status == "RECONCILE_REQUIRED":
        lines.append("Một số phần chưa xác định được kết quả: vui lòng kiểm tra màn hình Yêu cầu trước khi tạo lại.")
    if result.get("next_steps") and (result.get("created_transfers") or result.get("created_purchase_requests")):
        lines.append("Bước tiếp theo theo quy trình hiện tại: " + " ".join(result["next_steps"]))
    return "\n".join(lines)


def draft_answer(payload: dict) -> str:
    """The reply to a draft request, built from the draft itself - so the text
    and the card below it can never show different lines or totals."""
    m = payload.get("option_metrics") or {}
    cost = f"{int(m.get('purchase_cost_vnd') or 0):,}".replace(",", ".")
    lines = [f"Tôi đã chuẩn bị bản nháp theo phương án bạn tự thực hiện được ({payload.get('option')}): đáp ứng "
             f"{m.get('shortage_covered_pct')}% thiếu hụt, chi phí mua mới khoảng {cost} ₫."]
    for g in payload.get("transfers") or []:
        qty = sum(line["quantity"] for line in g["lines"])
        lines.append(f"- Yêu cầu điều chuyển {g.get('from_warehouse')} → {g.get('to_warehouse')}: "
                     f"{len(g['lines'])} đầu sách, {qty} bản.")
    if payload.get("purchases"):
        qty = sum(p["quantity"] for p in payload["purchases"])
        lines.append(f"- {len(payload['purchases'])} phiếu yêu cầu nhập: {qty} bản.")
    for p in (payload.get("proposals") or [])[:6]:
        where = f"{p.get('from_warehouse')} → {p.get('to_warehouse')}" if p.get("kind") == "TRANSFER" else p.get("warehouse")
        lines.append(f"- Chỉ đề xuất (cần Manager khác): {p.get('title')}, {p.get('quantity')} bản ({where}) — {p.get('reason')}.")
    lines.append("Chưa có yêu cầu nào được tạo. Hãy kiểm tra thẻ bên dưới rồi xác nhận (hoặc nhắn \"Tôi xác nhận\"); khi "
                 "xác nhận, hệ thống kiểm tra lại quyền và tồn kho trước khi tạo, và không duyệt thay bạn.")
    return "\n".join(lines)
