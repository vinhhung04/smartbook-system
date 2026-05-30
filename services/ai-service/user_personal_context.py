from __future__ import annotations

import asyncio
import json
import os
from typing import Any

import httpx

GATEWAY_URL = os.getenv("SMARTBOOK_GATEWAY_URL", "http://api-gateway:3000").rstrip("/")
_TIMEOUT = float(os.getenv("RAG_RETRIEVAL_TIMEOUT_SECONDS", "8"))

# Legacy role codes mapped to their canonical replacements (backward compat).
_LEGACY_ROLE_MAP: dict[str, str] = {
    "MANAGER": "WAREHOUSE_MANAGER",
    "STAFF": "WAREHOUSE_STAFF",
    "WAREHOUSE_OPERATOR": "WAREHOUSE_STAFF",
    "CUSTOMER_SERVICE": "LIBRARIAN",
}

_ROLE_PRIORITY = [
    "ADMIN", "WAREHOUSE_MANAGER", "LIBRARIAN",
    "WAREHOUSE_STAFF", "SUPPLIER", "CUSTOMER",
]

_ROLE_ENDPOINTS: dict[str, list[str]] = {
    "CUSTOMER": [
        "/borrow/my/loans",
        "/borrow/my/reservations",
        "/borrow/my/fines",
        "/borrow/my/membership",
    ],
    "WAREHOUSE_STAFF": [
        "/api/my-warehouse-tasks",
        "/api/picking/tasks",
        "/api/putaway/receipts",
        "/api/my-exception-reports",
    ],
    "WAREHOUSE_MANAGER": [
        "/analytics/dashboard/kpis",
        "/analytics/warehouse-stock-risk",
        "/api/my-warehouse-tasks",
    ],
    "ADMIN": [
        "/analytics/dashboard/kpis",
        "/analytics/warehouse-stock-risk",
        "/api/my-warehouse-tasks",
    ],
    "LIBRARIAN": ["/borrow/loans", "/borrow/reservations", "/borrow/fines"],
    "SUPPLIER": [],
}

_ROLE_PERSONAS: dict[str, str] = {
    "CUSTOMER": (
        "Bạn đang hỗ trợ độc giả {name}. "
        "Chỉ dùng dữ liệu cá nhân của họ. "
        "Không hiện analytics toàn hệ thống hay dữ liệu người dùng khác."
    ),
    "WAREHOUSE_STAFF": (
        "Bạn đang hỗ trợ nhân viên kho {name}. "
        "Ưu tiên các task picking/putaway/receiving được giao cho họ."
    ),
    "WAREHOUSE_MANAGER": (
        "Bạn đang hỗ trợ quản lý kho {name}. "
        "Có thể xem tổng quan vận hành, tồn kho, task nhân viên và báo cáo."
    ),
    "ADMIN": (
        "Bạn đang hỗ trợ admin {name}. "
        "Có full quyền xem và thao tác toàn hệ thống."
    ),
    "LIBRARIAN": (
        "Bạn đang hỗ trợ thủ thư {name}. "
        "Tập trung nghiệp vụ mượn trả, reservation, loan, fine."
    ),
    "SUPPLIER": (
        "Bạn đang hỗ trợ nhà cung cấp {name}. "
        "Chỉ xem dữ liệu liên quan đến supplier của họ."
    ),
    "anonymous": (
        "Người dùng chưa đăng nhập. "
        "Chỉ trả lời chung, không truy xuất dữ liệu riêng tư."
    ),
}

# Roles that must NOT see system-wide analytics from retrieval.py.
ANALYTICS_BLOCKED_ROLES: frozenset[str] = frozenset({"CUSTOMER", "SUPPLIER"})


def get_primary_role(user_ctx: Any) -> str:
    """Return the highest-priority canonical role for the user context object."""
    raw = [r.upper() for r in (getattr(user_ctx, "roles", None) or [])]
    roles = [_LEGACY_ROLE_MAP.get(r, r) for r in raw]
    for role in _ROLE_PRIORITY:
        if role in roles:
            return role
    return roles[0] if roles else "CUSTOMER"


async def _fetch_one(
    client: httpx.AsyncClient,
    endpoint: str,
    auth_header: str,
) -> tuple[str, Any, str | None]:
    """Fetch one gateway endpoint. Returns (endpoint, data_or_None, error_or_None)."""
    headers = {"Authorization": auth_header}
    try:
        resp = await client.get(
            f"{GATEWAY_URL}{endpoint}",
            headers=headers,
            timeout=_TIMEOUT,
        )
        if resp.status_code >= 400:
            return endpoint, None, f"{endpoint} returned HTTP {resp.status_code}"
        return endpoint, resp.json(), None
    except httpx.TimeoutException:
        return endpoint, None, f"{endpoint} timed out"
    except Exception as exc:
        return endpoint, None, f"{endpoint} failed: {type(exc).__name__}"


def _normalise_to_items(data: Any) -> list:
    """Try to extract a list from various response shapes."""
    if isinstance(data, list):
        return data
    if isinstance(data, dict):
        for key in ("data", "items", "results", "loans", "reservations",
                    "fines", "tasks", "receipts", "reports"):
            candidate = data.get(key)
            if isinstance(candidate, list):
                return candidate
            if isinstance(candidate, dict):
                for sub_key in ("data", "items", "results"):
                    sub = candidate.get(sub_key)
                    if isinstance(sub, list):
                        return sub
    return []


def _n(val: Any, default: float = 0) -> float:
    try:
        return float(val or default)
    except (TypeError, ValueError):
        return default


def _fmt_loans(data: Any) -> str:
    items = _normalise_to_items(data)
    if not items:
        return "Bạn không có sách nào đang mượn."
    status_map = {"BORROWED": "đang mượn", "OVERDUE": "QUÁ HẠN ⚠️", "RETURNED": "đã trả", "PENDING": "chờ xử lý"}
    lines = [f"📚 Sách đang mượn ({len(items)} quyển):"]
    n_overdue = 0
    for loan in items[:15]:
        number = loan.get("loan_number") or loan.get("id", "")[:8]
        status = loan.get("status", "")
        due = loan.get("due_date") or loan.get("return_due_date") or ""
        book = loan.get("book") or loan.get("book_variant") or {}
        title = (book.get("title") if isinstance(book, dict) else None) or loan.get("book_title", "?")
        if status == "OVERDUE":
            n_overdue += 1
        status_vn = status_map.get(status, status)
        due_str = f" | Hạn: {due[:10]}" if due else ""
        lines.append(f"  - [{number}] \"{title}\"{due_str} → {status_vn}")
    if n_overdue:
        lines.append(f"⚠️ Có {n_overdue} sách QUÁ HẠN cần trả ngay.")
    return "\n".join(lines)


def _fmt_fines(data: Any) -> str:
    items = _normalise_to_items(data)
    unpaid = [f for f in items if str(f.get("status", "")).upper() not in ("PAID", "WAIVED")]
    if not unpaid:
        return "✅ Bạn không có khoản phạt nào chưa thanh toán."
    total = sum(_n(f.get("amount")) for f in unpaid)
    lines = [f"💸 Khoản phạt chưa thanh toán ({len(unpaid)} khoản — tổng {total:,.0f} VND):"]
    for fine in unpaid[:10]:
        fine_type = fine.get("fine_type") or fine.get("type", "?")
        amount = _n(fine.get("amount"))
        note = fine.get("note") or fine.get("description") or ""
        note_str = f" ({note})" if note else ""
        lines.append(f"  - {fine_type}: {amount:,.0f} VND{note_str}")
    return "\n".join(lines)


def _fmt_reservations(data: Any) -> str:
    items = _normalise_to_items(data)
    active_statuses = {"PENDING", "WAITING", "READY", "CONFIRMED", "ACTIVE"}
    active = [r for r in items if str(r.get("status", "")).upper() in active_statuses or
              str(r.get("status", "")).upper() not in ("CANCELLED", "COMPLETED", "EXPIRED", "DONE")]
    if not active:
        return "Bạn không có đặt sách nào đang chờ."
    lines = [f"📋 Đặt sách của bạn ({len(active)} đặt đang chờ):"]
    status_map = {"PENDING": "chờ xác nhận", "WAITING": "đang chờ", "READY": "sẵn sàng lấy ✅",
                  "CONFIRMED": "đã xác nhận", "ACTIVE": "đang hoạt động"}
    for res in active[:10]:
        book = res.get("book") or {}
        title = (book.get("title") if isinstance(book, dict) else None) or res.get("book_title", "?")
        status = str(res.get("status", "?")).upper()
        status_vn = status_map.get(status, status)
        created = (res.get("created_at") or "")[:10]
        lines.append(f"  - \"{title}\" → {status_vn}" + (f" (đặt {created})" if created else ""))
    return "\n".join(lines)


def _fmt_membership(data: Any) -> str:
    info = data
    if isinstance(data, dict):
        info = data.get("data") or data
    if not info or (isinstance(info, dict) and not any(info.values())):
        return "Bạn chưa có thẻ thư viện."
    if isinstance(info, dict):
        plan = info.get("plan") or info.get("membership_type") or info.get("type", "?")
        status = info.get("status", "?")
        exp = (info.get("expiry_date") or info.get("expires_at") or info.get("end_date") or "")[:10]
        status_map = {"ACTIVE": "còn hiệu lực ✅", "EXPIRED": "đã hết hạn ❌", "SUSPENDED": "bị tạm ngưng"}
        status_vn = status_map.get(str(status).upper(), status)
        return f"🪪 Thẻ thư viện: {plan} — {status_vn}" + (f" — Hết hạn: {exp}" if exp else "")
    return "Có thông tin thẻ thư viện nhưng không đọc được định dạng."


def _fmt_warehouse_tasks(data: Any) -> str:
    items = _normalise_to_items(data)
    done_statuses = {"COMPLETED", "CANCELLED", "DONE", "CLOSED"}
    pending = [t for t in items if str(t.get("status", "")).upper() not in done_statuses]
    if not pending:
        return "✅ Bạn không có task nào đang chờ thực hiện." if items else "Chưa có task nào được giao cho bạn."
    lines = [f"📦 Task được giao cho bạn ({len(pending)} tasks đang chờ):"]
    type_map = {"PICKING": "Picking", "PUTAWAY": "Putaway", "RECEIVING": "Nhận hàng",
                "OUTBOUND": "Xuất kho", "TRANSFER": "Chuyển kho", "AUDIT": "Kiểm kê"}
    for task in pending[:10]:
        task_id = (task.get("id") or "")[:8]
        task_type = str(task.get("task_type") or task.get("type") or "?").upper()
        status = task.get("status", "?")
        priority = str(task.get("priority") or "").upper()
        ref = task.get("reference_number") or task.get("order_number") or task.get("ref", "")
        type_vn = type_map.get(task_type, task_type)
        priority_str = f" [{priority}]" if priority and priority not in ("", "NORMAL") else ""
        ref_str = f" #{ref}" if ref else ""
        lines.append(f"  - [{task_id}] {type_vn}{ref_str}{priority_str} → {status}")
    return "\n".join(lines)


def _fmt_picking(data: Any) -> str:
    items = _normalise_to_items(data)
    done_statuses = {"COMPLETED", "CANCELLED", "DONE"}
    pending = [t for t in items if str(t.get("status", "")).upper() not in done_statuses]
    if not pending:
        return "✅ Không có đơn picking nào cần thực hiện."
    lines = [f"🔍 Đơn picking được giao ({len(pending)} đơn):"]
    for task in pending[:10]:
        order = task.get("order_number") or task.get("picking_number") or (task.get("id") or "")[:8]
        status = task.get("status", "?")
        priority = str(task.get("priority") or "")
        priority_str = f" [{priority}]" if priority else ""
        lines.append(f"  - Picking #{order}{priority_str} → {status}")
    return "\n".join(lines)


def _fmt_putaway(data: Any) -> str:
    items = _normalise_to_items(data)
    done_statuses = {"COMPLETED", "CANCELLED", "DONE", "PUTAWAY_DONE"}
    pending = [t for t in items if str(t.get("status", "")).upper() not in done_statuses]
    if not pending:
        return "✅ Không có phiếu putaway nào đang chờ."
    lines = [f"📥 Phiếu putaway được giao ({len(pending)} phiếu):"]
    for receipt in pending[:10]:
        number = receipt.get("receipt_number") or receipt.get("putaway_number") or (receipt.get("id") or "")[:8]
        status = receipt.get("status", "?")
        lines.append(f"  - Putaway #{number} → {status}")
    return "\n".join(lines)


def _fmt_exception_reports(data: Any) -> str:
    items = _normalise_to_items(data)
    if not items:
        return "Không có báo cáo ngoại lệ nào của bạn."
    open_reports = [r for r in items if str(r.get("status", "")).upper() not in ("RESOLVED", "CLOSED")]
    lines = [f"⚠️ Báo cáo ngoại lệ ({len(items)} tổng, {len(open_reports)} chưa giải quyết):"]
    for rep in items[:5]:
        rep_type = rep.get("exception_type") or rep.get("type", "?")
        status = rep.get("status", "?")
        note = (rep.get("description") or rep.get("note") or "")[:60]
        lines.append(f"  - {rep_type} [{status}]" + (f": {note}" if note else ""))
    return "\n".join(lines)


def _fmt_borrow_loans_all(data: Any) -> str:
    """For LIBRARIAN: all system loans."""
    items = _normalise_to_items(data)
    if not items:
        return "Không có dữ liệu loan trong hệ thống."
    n_overdue = sum(1 for l in items if str(l.get("status", "")).upper() == "OVERDUE")
    n_active = sum(1 for l in items if str(l.get("status", "")).upper() in ("BORROWED", "OVERDUE"))
    lines = [f"📚 Loan trong hệ thống (sample {len(items)}): {n_active} đang mượn, {n_overdue} quá hạn."]
    overdue_list = [l for l in items if str(l.get("status", "")).upper() == "OVERDUE"][:5]
    if overdue_list:
        lines.append("Quá hạn gần đây:")
        for loan in overdue_list:
            number = loan.get("loan_number") or loan.get("id", "")[:8]
            customer = (loan.get("customers") or {}).get("full_name") if isinstance(loan.get("customers"), dict) else loan.get("customer_name", "?")
            book = loan.get("book") or {}
            title = (book.get("title") if isinstance(book, dict) else None) or loan.get("book_title", "?")
            due = (loan.get("due_date") or "")[:10]
            lines.append(f"  - [{number}] \"{title}\" — KH: {customer} | Hạn: {due}")
    return "\n".join(lines)


def _fmt_borrow_fines_all(data: Any) -> str:
    """For LIBRARIAN: all system fines."""
    items = _normalise_to_items(data)
    if not items:
        return "Không có dữ liệu phạt trong hệ thống."
    unpaid = [f for f in items if str(f.get("status", "")).upper() not in ("PAID", "WAIVED")]
    total = sum(_n(f.get("amount")) for f in unpaid)
    return (f"💸 Phạt hệ thống: {len(items)} khoản tổng, "
            f"{len(unpaid)} chưa thanh toán (tổng {total:,.0f} VND).")


def _fmt_reservations_all(data: Any) -> str:
    """For LIBRARIAN: all system reservations."""
    items = _normalise_to_items(data)
    if not items:
        return "Không có dữ liệu đặt sách."
    pending = [r for r in items if str(r.get("status", "")).upper() in ("PENDING", "WAITING", "READY", "CONFIRMED")]
    return f"📋 Đặt sách hệ thống: {len(items)} tổng, {len(pending)} đang chờ xử lý."


_ENDPOINT_FORMATTERS: dict[str, Any] = {
    "/borrow/my/loans":         _fmt_loans,
    "/borrow/my/fines":         _fmt_fines,
    "/borrow/my/reservations":  _fmt_reservations,
    "/borrow/my/membership":    _fmt_membership,
    "/api/my-warehouse-tasks":  _fmt_warehouse_tasks,
    "/api/picking/tasks":       _fmt_picking,
    "/api/putaway/receipts":    _fmt_putaway,
    "/api/my-exception-reports": _fmt_exception_reports,
    "/borrow/loans":            _fmt_borrow_loans_all,
    "/borrow/fines":            _fmt_borrow_fines_all,
    "/borrow/reservations":     _fmt_reservations_all,
}


def _summarise_endpoint(endpoint: str, data: Any) -> str:
    """Format endpoint response as structured Vietnamese text for the LLM."""
    if data is None:
        return ""
    formatter = _ENDPOINT_FORMATTERS.get(endpoint)
    if formatter:
        try:
            return formatter(data)
        except Exception:
            pass
    # Fallback: compact JSON (analytics endpoints like dashboard/kpis handled by rag.py)
    items = _normalise_to_items(data)
    payload: Any = items[:15] if items else data
    compact = json.dumps(payload, ensure_ascii=False, default=str)[:2000]
    return f"[{endpoint}]:\n{compact}"


async def build_user_personal_context(
    user_ctx: Any,
    intent_info: dict,
    auth_header: str | None,
) -> dict:
    """
    Fetch role-appropriate personal data and return a context dict.

    Returns:
        {
            "role": str,
            "persona": str,     -- injected into the system prompt
            "summary": str,     -- compact endpoint data for the LLM
            "sources": list,
            "warnings": list,
        }
    """
    if not auth_header or user_ctx is None:
        return {
            "role": "anonymous",
            "persona": _ROLE_PERSONAS["anonymous"],
            "summary": "",
            "sources": [],
            "warnings": [],
        }

    role = get_primary_role(user_ctx)
    name = (
        getattr(user_ctx, "username", None)
        or getattr(user_ctx, "email", None)
        or "bạn"
    )
    persona = _ROLE_PERSONAS.get(role, _ROLE_PERSONAS["anonymous"]).format(name=name)

    endpoints = _ROLE_ENDPOINTS.get(role, [])
    if not endpoints:
        return {
            "role": role,
            "persona": persona,
            "summary": "",
            "sources": [],
            "warnings": [f"Role {role} chưa có endpoint cá nhân được cấu hình."],
        }

    sources: list[dict] = []
    warnings: list[str] = []
    summaries: list[str] = []

    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        results = await asyncio.gather(
            *[_fetch_one(client, ep, auth_header) for ep in endpoints],
        )

    for ep, data, err in results:
        if err:
            warnings.append(err)
            sources.append({"name": ep, "endpoint": ep, "status": "error"})
        else:
            sources.append({"name": ep, "endpoint": ep, "status": "ok"})
            text = _summarise_endpoint(ep, data)
            if text:
                summaries.append(text)

    return {
        "role": role,
        "persona": persona,
        "summary": "\n\n".join(summaries),
        "sources": sources,
        "warnings": warnings,
    }
