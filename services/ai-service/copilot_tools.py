"""Read-only composite tools for the management copilot.

Each tool answers a question no single analytics endpoint answers - "sách mượn
nhiều nhưng tồn thấp", "kho A hay kho B rủi ro hơn", "tại sao kho X thiếu
sách", "nếu ngân sách còn 10 triệu" - by calling existing read-only gateway
endpoints with the caller's own token (so analytics/inventory RBAC still
applies) and doing the arithmetic HERE, deterministically. The LLM receives
the computed figures; it is never asked to join, sum or compare raw rows.

Joins are on business ids (variant_id, warehouse_id), never on titles.
No tool writes anything, and none accepts SQL or an endpoint from its caller.
"""
from __future__ import annotations

import asyncio
import time
from contextvars import ContextVar
from datetime import date, datetime
from typing import Any

from assistant_tools import _get
from copilot_plan import _wh_norm, normalize_query, resolve_warehouses
from intent import normalize_text

REORDER_FETCH_LIMIT = 100  # analytics caps reorder-suggestions at 100 rows
_CACHE_TTL_SECONDS = 60.0
_cache: dict[tuple, tuple[float, asyncio.Future]] = {}
# Copilot 3.2: who the cached data was read for. Set per request by the
# assistant (main._start_assistant_turn) to a fingerprint of the user, their
# roles/permissions and their CURRENT warehouse scope, so a result read before
# a scope or permission change is never served after it (the scope itself is
# re-read at most every warehouse_scope.TTL_SECONDS). None = do not cache.
CACHE_PARTITION: ContextVar[str | None] = ContextVar("copilot_cache_partition", default="")


async def _cached_get(endpoint: str, auth_header: str | None, params: dict | None = None) -> Any:
    """Coalesces identical reads issued by tools running concurrently in one
    turn (e.g. two explain_warehouse_shortage calls both needing the 100-row
    reorder list, the heaviest analytics query). Keyed by the auth header AND
    the request's partition (user + permissions + warehouse scope), so one
    user's result is never served to another, nor to the same user after
    their access changed."""
    partition = CACHE_PARTITION.get()
    if partition is None:
        return await _get(endpoint, auth_header, params, truncate=False)
    key = (endpoint, auth_header, partition, tuple(sorted((params or {}).items())))
    now = time.monotonic()
    hit = _cache.get(key)
    if hit and now - hit[0] < _CACHE_TTL_SECONDS:
        return await asyncio.shield(hit[1])
    future = asyncio.ensure_future(_get(endpoint, auth_header, params, truncate=False))
    _cache[key] = (now, future)
    for stale in [k for k, (ts, _f) in _cache.items() if now - ts >= _CACHE_TTL_SECONDS]:
        _cache.pop(stale, None)
    result = await asyncio.shield(future)
    if isinstance(result, dict) and result.get("error"):
        _cache.pop(key, None)
    return result


def _error(result: Any) -> str | None:
    if isinstance(result, dict) and result.get("error"):
        return str(result["error"])
    return None


def _pct(new: float, old: float) -> float | None:
    if not old:
        return None
    return round((new - old) / old * 100, 1)


def _now_iso() -> str:
    return datetime.now().astimezone().isoformat(timespec="seconds")


# ── warehouses ───────────────────────────────────────────────────────────────

async def _warehouses(auth_header: str | None) -> list[dict] | dict:
    data = await _cached_get("/api/warehouses", auth_header)
    if _error(data):
        return data
    rows = data if isinstance(data, list) else (data.get("items") if isinstance(data, dict) else []) or []
    return [w for w in rows if isinstance(w, dict) and w.get("id") and w.get("is_active", True)]


def match_warehouse(hint: str, warehouses: list[dict]) -> tuple[dict | None, list[dict]]:
    """One warehouse for a free-text hint ("Kho Ha Noi", "WH-HN-01", "hcm"), or
    (None, candidates) when it does not identify exactly one."""
    norm = _wh_norm(hint)
    for w in warehouses:
        if norm in (_wh_norm(w.get("name", "")), _wh_norm(w.get("code", ""))):
            return w, []
    text = norm if norm.startswith(("kho ", "chi nhanh ")) else f"kho {norm}"
    found = resolve_warehouses(text, warehouses)
    if len(found["warehouses"]) == 1:
        wid = found["warehouses"][0]["id"]
        return next(w for w in warehouses if w["id"] == wid), []
    candidates = found["ambiguous"] or [w for w in warehouses if norm and norm in _wh_norm(w.get("name", ""))]
    if len(candidates) == 1:
        return next(w for w in warehouses if w["id"] == candidates[0]["id"]), []
    return None, candidates


async def _resolve_or_error(auth_header: str | None, hint: str) -> tuple[dict | None, dict | None]:
    warehouses = await _warehouses(auth_header)
    if _error(warehouses):
        return None, {"error": f"không đọc được danh sách kho: {warehouses['error']}"}
    match, candidates = match_warehouse(hint or "", warehouses)
    if match is None:
        names = ", ".join(w.get("name", "?") for w in (candidates or warehouses))
        return None, {"error": f"không xác định được kho \"{hint}\"", "candidates": names}
    return match, None


def _wh_public(w: dict) -> dict:
    return {"warehouse_id": w.get("id"), "warehouse_name": w.get("name"), "warehouse_code": w.get("code")}


_STATUS_VI = {"OUT_OF_STOCK": "HẾT HÀNG", "LOW_STOCK": "DƯỚI NGƯỠNG", "OK": "ĐỦ HÀNG"}


async def get_warehouse_low_stock_items(auth_header: str | None = None, warehouse: str = "", limit: int | None = None) -> dict:
    """Books out of stock / at or under their reorder point in ONE warehouse,
    from analytics' /warehouse-stock-items - the same per-variant definition
    as /warehouse-stock-risk, so the list and the counts always agree."""
    w, err = await _resolve_or_error(auth_header, warehouse)
    if err:
        return err
    limit = max(1, min(int(limit or 30), 100))
    raw = await _cached_get("/analytics/warehouse-stock-items", auth_header, {"warehouseId": w["id"], "limit": limit})
    if _error(raw):
        return raw
    counts = raw.get("counts") or {}
    items = [{
        "variant_id": r.get("variant_id"), "title": r.get("title"), "status": _STATUS_VI.get(r.get("status"), r.get("status")),
        "available_qty": r.get("available_qty"), "on_hand_qty": r.get("on_hand_qty"),
        "reserved_qty": r.get("reserved_qty"), "borrowed_qty": r.get("borrowed_qty"), "reorder_point": r.get("reorder_point"),
    } for r in raw.get("items") or [] if isinstance(r, dict)]
    return {
        **_wh_public(w), "retrieved_at": _now_iso(),
        "total_items": counts.get("low_stock_including_out", len(items)),
        "out_of_stock_count": counts.get("out_of_stock", sum(1 for i in items if i["status"] == "HẾT HÀNG")),
        "items": items, "truncated": bool(raw.get("truncated")),
    }


_RISK_CRITERIA = ("Xếp hạng rủi ro theo thứ tự: (1) số đầu sách hết hàng, (2) số đầu sách dưới ngưỡng tồn tối "
                  "thiểu, (3) tổng tồn khả dụng thấp hơn thì rủi ro hơn.")


def _risk_key(row: dict) -> tuple:
    return (-(row.get("out_of_stock_variants") or 0), -(row.get("low_stock_variants") or 0),
            row.get("total_available_qty") or 0)


async def compare_warehouses(auth_header: str | None = None, warehouses: list[str] | None = None) -> dict:
    """Ranks warehouses by stock risk with an explicit, fixed rule; with two or
    more hints, compares only those (pairwise differences included)."""
    risk = await _cached_get("/analytics/warehouse-stock-risk", auth_header)
    if _error(risk):
        return risk
    rows = [r for r in (risk if isinstance(risk, list) else []) if isinstance(r, dict)]
    selected, unresolved = rows, []
    if warehouses:
        listing = await _warehouses(auth_header)
        if _error(listing):
            return {"error": f"không đọc được danh sách kho: {listing['error']}"}
        ids = []
        for hint in warehouses:
            match, _c = match_warehouse(hint, listing)
            if match is None:
                unresolved.append(hint)
            elif match["id"] not in ids:
                ids.append(match["id"])
        selected = [r for r in rows if r.get("warehouse_id") in ids]
    ranked = sorted(selected, key=_risk_key)
    ranking = [{
        "rank": i + 1, "warehouse_id": r.get("warehouse_id"), "warehouse_name": r.get("warehouse_name"),
        "out_of_stock_variants": r.get("out_of_stock_variants"), "low_stock_variants": r.get("low_stock_variants"),
        "total_available_qty": r.get("total_available_qty"), "total_reserved_qty": r.get("total_reserved_qty"),
        "total_borrowed_qty": r.get("total_borrowed_qty"),
    } for i, r in enumerate(ranked)]
    result: dict = {"criteria": _RISK_CRITERIA, "ranking": ranking, "unresolved": unresolved,
                    "retrieved_at": _now_iso()}
    if len(ranking) >= 2:
        a, b = ranking[0], ranking[1]
        tie = _risk_key(ranked[0]) == _risk_key(ranked[1])
        result["comparison"] = {
            "riskier": None if tie else a["warehouse_name"], "less_risky": None if tie else b["warehouse_name"],
            "tie": tie,
            "out_of_stock_diff": (a["out_of_stock_variants"] or 0) - (b["out_of_stock_variants"] or 0),
            "low_stock_diff": (a["low_stock_variants"] or 0) - (b["low_stock_variants"] or 0),
            "available_qty_diff": (a["total_available_qty"] or 0) - (b["total_available_qty"] or 0),
        }
    return result


# ── reorder data shared by several tools ─────────────────────────────────────

async def _reorder(auth_header: str | None, **params) -> dict:
    query = {"limit": REORDER_FETCH_LIMIT, **{k: v for k, v in params.items() if v is not None}}
    return await _cached_get("/analytics/reorder-suggestions", auth_header, query)


def _reorder_row(item: dict) -> dict:
    keys = ("variant_id", "book_id", "title", "available_qty", "reorder_point", "borrow_count", "previous_borrow_count",
            "demand_trend_pct", "reservation_count", "wishlist_count", "forecast_30d", "lead_time_demand",
            "estimated_days_until_stockout", "priority", "suggested_reorder_qty", "unit_cost", "estimated_cost",
            "lead_time_days", "lead_time_source", "lead_time_samples", "within_budget", "funded_qty", "funded_cost", "reason")
    return {k: item.get(k) for k in keys if k in item}


def data_confidence(item: dict) -> dict:
    """How much the DATA behind one reorder line can be trusted - a rule on
    sample sizes, never a model's self-reported confidence."""
    borrows = item.get("borrow_count") or 0
    source = item.get("lead_time_source")
    samples = item.get("lead_time_samples") or 0
    if source == "LEARNED" and samples >= 3 and borrows >= 10:
        level = "CAO"
    elif source in ("LEARNED", "SUPPLIER_DECLARED", "REQUESTED") and borrows >= 3:
        level = "TRUNG BÌNH"
    else:
        level = "THẤP"
    lead = {"LEARNED": f"thời gian chờ hàng học từ {samples} lần giao thực tế",
            "SUPPLIER_DECLARED": "thời gian chờ hàng theo cam kết nhà cung cấp (chưa có lịch sử giao)",
            "REQUESTED": "thời gian chờ hàng do người hỏi chỉ định",
            "DEFAULT": "thời gian chờ hàng là giá trị mặc định"}.get(source, "không rõ nguồn thời gian chờ hàng")
    return {"level": level, "basis": f"{borrows} lượt mượn trong kỳ; {lead}"}


async def explain_warehouse_shortage(auth_header: str | None = None, warehouse: str = "") -> dict:
    """Contributing factors behind a warehouse's shortage: what is out/low there
    (per variant), joined by variant_id with demand signals from the reorder
    model. Demand is library-wide - the analytics model has no per-warehouse
    demand - and the factors are correlations, which the result states."""
    w, err = await _resolve_or_error(auth_header, warehouse)
    if err:
        return err
    low, risk, reorder = await asyncio.gather(
        get_warehouse_low_stock_items(auth_header, w.get("name") or warehouse, 50),
        _cached_get("/analytics/warehouse-stock-risk", auth_header),
        _reorder(auth_header),
    )
    if _error(low):
        return low
    risk_row = next((r for r in (risk if isinstance(risk, list) else []) if r.get("warehouse_id") == w["id"]), None)
    demand = {i["variant_id"]: i for i in (reorder.get("items") or [])} if isinstance(reorder, dict) and not _error(reorder) else {}
    joined = []
    for item in low["items"]:
        d = demand.get(item["variant_id"]) or {}
        joined.append({**item, "borrow_count": d.get("borrow_count"), "previous_borrow_count": d.get("previous_borrow_count"),
                       "demand_trend_pct": d.get("demand_trend_pct"), "reservation_count": d.get("reservation_count"),
                       "lead_time_days": d.get("lead_time_days"), "lead_time_source": d.get("lead_time_source"),
                       "reorder_priority": d.get("priority"), "suggested_reorder_qty": d.get("suggested_reorder_qty")})
    with_demand = [j for j in joined if (j.get("borrow_count") or 0) > 0]
    rising = [j for j in with_demand if (j.get("demand_trend_pct") or 0) > 0]
    reserved = [j for j in joined if (j.get("reservation_count") or 0) > 0]
    no_signal = [j for j in joined if j["variant_id"] not in demand]
    long_lead = [j for j in joined if (j.get("lead_time_days") or 0) >= 21]
    factors = []
    if risk_row:
        factors.append({"factor": "Quy mô thiếu hàng tại kho", "value": {
            "het_hang": risk_row.get("out_of_stock_variants"), "duoi_nguong": risk_row.get("low_stock_variants"),
            "ton_kha_dung": risk_row.get("total_available_qty"), "dang_giu_dat_cho": risk_row.get("total_reserved_qty"),
            "dang_cho_muon": risk_row.get("total_borrowed_qty")}})
    if with_demand:
        factors.append({"factor": "Sách thiếu hàng vẫn đang có nhu cầu mượn (toàn hệ thống)", "count": len(with_demand),
                        "examples": [f"{j['title']}: {j['borrow_count']} lượt mượn" for j in
                                     sorted(with_demand, key=lambda j: -(j["borrow_count"] or 0))[:3]]})
    if rising:
        factors.append({"factor": "Nhu cầu đang tăng so với kỳ trước", "count": len(rising),
                        "examples": [f"{j['title']}: +{j['demand_trend_pct']}%" for j in
                                     sorted(rising, key=lambda j: -(j["demand_trend_pct"] or 0))[:3]]})
    if reserved:
        factors.append({"factor": "Có lượt đặt chỗ đang giữ hàng", "count": len(reserved)})
    if long_lead:
        factors.append({"factor": "Thời gian chờ hàng dài (≥ 21 ngày)", "count": len(long_lead),
                        "examples": [f"{j['title']}: {j['lead_time_days']} ngày ({j['lead_time_source']})" for j in long_lead[:3]]})
    if no_signal:
        factors.append({"factor": "Thiếu hàng nhưng không có tín hiệu nhu cầu gần đây (ưu tiên thấp hơn)",
                        "count": len(no_signal)})
    return {
        **_wh_public(w), "retrieved_at": _now_iso(),
        "summary": {"low_stock_items": low["total_items"], "out_of_stock_items": low["out_of_stock_count"],
                    "items_with_recent_demand": len(with_demand), "items_with_rising_demand": len(rising)},
        "factors": factors,
        "items": sorted(joined, key=lambda j: (j["status"] != "HẾT HÀNG", -(j.get("borrow_count") or 0)))[:15],
        "join_key": "variant_id",
        "limitations": [
            "Nhu cầu mượn lấy từ mô hình đề xuất nhập, tính trên toàn hệ thống, không tách riêng theo kho.",
            "Các yếu tố là tương quan quan sát được trong dữ liệu, không phải nguyên nhân đã được kiểm chứng.",
        ] + ([] if demand else ["Không lấy được dữ liệu nhu cầu (reorder-suggestions) nên thiếu phần nhu cầu."]),
    }


# ── periods ──────────────────────────────────────────────────────────────────

def _days_between(from_date: str, to_date: str) -> int:
    def d(value: str) -> date:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).date() if "T" in value else date.fromisoformat(value)
    return max(1, (d(to_date) - d(from_date)).days + 1)


def _period_totals(rows: list) -> dict:
    rows = [r for r in rows if isinstance(r, dict)]
    totals = {key: sum(r.get(key) or 0 for r in rows) for key in ("loans", "returns", "reservations")}
    peak = max(rows, key=lambda r: r.get("loans") or 0) if rows else None
    return {**totals, "buckets": len(rows), "peak_day": peak.get("date") if peak else None,
            "peak_loans": peak.get("loans") if peak else None}


async def compare_borrow_periods(
    auth_header: str | None = None, from_date: str = "", to_date: str = "",
    compare_from_date: str = "", compare_to_date: str = "",
) -> dict:
    """Loans/returns/reservations of two periods, with absolute and % changes
    and per-day averages (two periods of different length - month-to-date vs
    a full month - are only comparable per day)."""
    if not (from_date and to_date and compare_from_date and compare_to_date):
        return {"error": "cần đủ from_date, to_date, compare_from_date, compare_to_date"}
    cur, prev = await asyncio.gather(
        _cached_get("/analytics/borrow-trends", auth_header, {"from": from_date, "to": to_date, "granularity": "day"}),
        _cached_get("/analytics/borrow-trends", auth_header, {"from": compare_from_date, "to": compare_to_date, "granularity": "day"}),
    )
    for r in (cur, prev):
        if _error(r):
            return r
    a, b = _period_totals(cur), _period_totals(prev)
    days_a, days_b = _days_between(from_date, to_date), _days_between(compare_from_date, compare_to_date)
    metrics = {}
    for key in ("loans", "returns", "reservations"):
        avg_a, avg_b = round(a[key] / days_a, 2), round(b[key] / days_b, 2)
        metrics[key] = {"current": a[key], "previous": b[key], "change": a[key] - b[key],
                        "change_pct": _pct(a[key], b[key]), "current_per_day": avg_a, "previous_per_day": avg_b,
                        "per_day_change_pct": _pct(avg_a, avg_b)}
    return {
        "current_period": {"from": from_date[:10], "to": to_date[:10], "days": days_a, "peak_day": a["peak_day"],
                           "peak_loans": a["peak_loans"]},
        "previous_period": {"from": compare_from_date[:10], "to": compare_to_date[:10], "days": days_b,
                            "peak_day": b["peak_day"], "peak_loans": b["peak_loans"]},
        "metrics": metrics,
        "unequal_length": days_a != days_b,
        "note": ("Hai kỳ dài khác nhau; nên so sánh theo trung bình mỗi ngày." if days_a != days_b else None),
        "retrieved_at": _now_iso(),
    }


async def compare_top_books(
    auth_header: str | None = None, from_date: str = "", to_date: str = "",
    compare_from_date: str = "", compare_to_date: str = "", limit: int | None = None,
) -> dict:
    """Top borrowed books of two periods joined by variant_id: rank moves, new
    entries, books that dropped out."""
    if not (from_date and to_date and compare_from_date and compare_to_date):
        return {"error": "cần đủ from_date, to_date, compare_from_date, compare_to_date"}
    limit = max(1, min(int(limit or 10), 20))
    cur, prev = await asyncio.gather(
        _cached_get("/analytics/top-books", auth_header, {"from": from_date, "to": to_date, "limit": limit}),
        _cached_get("/analytics/top-books", auth_header, {"from": compare_from_date, "to": compare_to_date, "limit": limit}),
    )
    for r in (cur, prev):
        if _error(r):
            return r
    prev_rank = {row["variant_id"]: (i + 1, row) for i, row in enumerate(prev or [])}
    current = []
    for i, row in enumerate(cur or []):
        before = prev_rank.get(row["variant_id"])
        current.append({"rank": i + 1, "variant_id": row["variant_id"], "title": row.get("title"),
                        "borrow_count": row.get("borrow_count"),
                        "previous_rank": before[0] if before else None,
                        "previous_borrow_count": before[1].get("borrow_count") if before else None,
                        "status": "MỚI VÀO TOP" if not before else ("TĂNG HẠNG" if before[0] > i + 1 else
                                                                   ("GIẢM HẠNG" if before[0] < i + 1 else "GIỮ HẠNG"))})
    cur_ids = {row["variant_id"] for row in cur or []}
    dropped = [{"title": row.get("title"), "variant_id": row["variant_id"], "previous_rank": rank}
               for row_id, (rank, row) in prev_rank.items() if row_id not in cur_ids]
    return {"current_period": {"from": from_date[:10], "to": to_date[:10]},
            "previous_period": {"from": compare_from_date[:10], "to": compare_to_date[:10]},
            "current": current, "dropped_out": dropped, "join_key": "variant_id", "retrieved_at": _now_iso()}


# ── demand vs stock ─────────────────────────────────────────────────────────

async def analyze_demand_vs_stock(
    auth_header: str | None = None, from_date: str | None = None, to_date: str | None = None, limit: int | None = None,
) -> dict:
    """Most-borrowed books joined (variant_id) with their stock position and
    reorder need: answers "mượn nhiều nhưng tồn thấp, cần nhập thêm"."""
    limit = max(1, min(int(limit or 10), 20))
    top_params = {"limit": 20}
    reorder_params = {}
    if from_date and to_date:
        top_params.update({"from": from_date, "to": to_date})
        reorder_params.update({"from": from_date, "to": to_date})
    top, reorder = await asyncio.gather(
        _cached_get("/analytics/top-books", auth_header, top_params), _reorder(auth_header, **reorder_params))
    if _error(top):
        return top
    if _error(reorder):
        return reorder
    by_variant = {i["variant_id"]: i for i in reorder.get("items") or []}
    rows, not_candidates = [], []
    for rank, book in enumerate(top or [], start=1):
        item = by_variant.get(book["variant_id"])
        if item is None:
            not_candidates.append({"rank": rank, "title": book.get("title"), "borrow_count": book.get("borrow_count")})
            continue
        low = (item.get("available_qty") or 0) <= max(item.get("reorder_point") or 0, 0) or item.get("priority") == "HIGH"
        rows.append({"borrow_rank": rank, "variant_id": book["variant_id"], "title": book.get("title"),
                     "borrow_count": book.get("borrow_count"), "available_qty": item.get("available_qty"),
                     "reorder_point": item.get("reorder_point"), "priority": item.get("priority"),
                     "suggested_reorder_qty": item.get("suggested_reorder_qty"),
                     "estimated_days_until_stockout": item.get("estimated_days_until_stockout"),
                     "estimated_cost": item.get("estimated_cost"), "low_stock": low,
                     "needs_reorder": (item.get("suggested_reorder_qty") or 0) > 0,
                     "data_confidence": data_confidence(item)})
    flagged = [r for r in rows if r["low_stock"] and r["needs_reorder"]]
    return {
        "period": {"from": (from_date or reorder.get("range", {}).get("from") or "")[:10],
                   "to": (to_date or reorder.get("range", {}).get("to") or "")[:10]},
        "criteria": "Sách nằm trong top mượn nhiều VÀ (tồn khả dụng ≤ ngưỡng tồn tối thiểu hoặc ưu tiên nhập HIGH) VÀ có số lượng đề xuất nhập > 0.",
        "rows": flagged[:limit],
        "other_top_books_with_stock_data": [r for r in rows if r not in flagged][:5],
        "top_books_without_reorder_need": not_candidates[:5],
        "counts": {"top_books_checked": len(top or []), "matched_by_variant_id": len(rows), "flagged": len(flagged)},
        "join_key": "variant_id", "retrieved_at": _now_iso(),
    }


# ── budget what-if ───────────────────────────────────────────────────────────

def _shortfall(item: dict) -> float:
    return max(0.0, float(item.get("lead_time_demand") or 0) - float(item.get("available_qty") or 0))


def _covered(item: dict) -> float:
    """Shortfall a funded line covers. A whole funded line covers all of it; a
    3.3 line funded in part covers its funded copies plus the copies its budget
    position already counts on (incoming purchase orders, expected returns)."""
    if "funded_qty" not in item:
        return _shortfall(item)
    plan = item.get("budget_plan") or {}
    already = max(0.0, float(plan.get("inventory_position") or 0) - float(item.get("available_qty") or 0))
    return min(_shortfall(item), float(item.get("funded_qty") or 0) + already)


def _vnd(value: float) -> str:
    return f"{int(round(value)):,} ₫".replace(",", ".")


async def simulate_reorder_budget(
    auth_header: str | None = None, budgets_vnd: list[float] | None = None, budget_change_pct: float | None = None,
    lead_time_days: int | None = None, priority: str | None = None, lead_time_delay_days: int | None = None,
    priority_warehouse: str | None = None, keep_service: bool = False,
) -> dict:
    """What each budget buys, computed by the analytics service's own budget
    allocation. Without a budget, the scenarios are fractions of the full
    estimated need - labelled as such. Phase 6 what-ifs, all computed by
    analytics (never by the model): `lead_time_delay_days` (supplier N days
    later on every line), `priority_warehouse` (lines short at that warehouse
    funded first), `keep_service` (the least budgets that keep 99 / 95 / 90 % of
    the service the whole plan gives). `least_risk_scenario` is the scenario
    with the highest expected service - a deterministic ranking."""
    base_params = {"leadTimeDays": lead_time_days, "priority": priority if priority in ("HIGH", "MEDIUM", "LOW") else None}
    base = await _reorder(auth_header, **base_params)
    if _error(base):
        return base
    priority_wh = None
    if priority_warehouse:
        priority_wh, err = await _resolve_or_error(auth_header, priority_warehouse)
        if err:
            return err
    summary = base.get("summary") or {}
    total_need = float(summary.get("estimated_total_cost") or 0)
    scenarios_in: list[tuple[str, float]] = []
    for b in (budgets_vnd or [])[:3]:
        if b and b > 0:
            scenarios_in.append((f"Ngân sách {int(b):,} ₫".replace(",", "."), float(b)))
    if budget_change_pct is not None and total_need:
        reference = float(budgets_vnd[0]) if budgets_vnd else total_need
        changed = max(0.0, reference * (1 + budget_change_pct / 100))
        label = "nhu cầu đầy đủ" if not budgets_vnd else "ngân sách nêu"
        scenarios_in = [(f"{label} ({int(reference):,} ₫)".replace(",", "."), reference),
                        (f"Sau khi {'giảm' if budget_change_pct < 0 else 'tăng'} {abs(budget_change_pct):g}%", changed)]
    assumed = False
    what_if = bool(lead_time_delay_days or priority_wh or keep_service)
    if not scenarios_in and total_need and what_if:
        # a what-if without a budget: compare against funding the whole current need
        scenarios_in = [(f"Đủ nhu cầu hiện tại ({_vnd(total_need)})", total_need)]
    if not scenarios_in and total_need:
        assumed = True
        scenarios_in = [(f"{p}% nhu cầu ({int(total_need * p / 100):,} ₫)".replace(",", "."), round(total_need * p / 100))
                        for p in (100, 75, 50, 25)]
    calls: list[tuple[str, float, dict]] = [(label, value, {}) for label, value in scenarios_in]
    if scenarios_in and lead_time_delay_days:
        label, value = scenarios_in[0]
        calls.append((f"{label}, nhà cung cấp giao chậm thêm {int(lead_time_delay_days)} ngày", value,
                      {"leadTimeDelayDays": int(lead_time_delay_days)}))
    if scenarios_in and priority_wh:
        label, value = scenarios_in[0]
        calls.append((f"{label}, ưu tiên {priority_wh['name']}", value, {"priorityWarehouseId": priority_wh["id"]}))
    first_results = await asyncio.gather(*(_reorder(auth_header, budgetVnd=value, **base_params, **extra)
                                           for _l, value, extra in calls))
    curve = next(((r.get("budget") or {}).get("service_curve") for r in first_results
                  if not _error(r) and (r.get("budget") or {}).get("service_curve")), None)
    if keep_service and curve:
        # least budgets keeping 99 / 95 / 90 % of the whole plan's expected service
        points = curve.get("cost_for_service_pct") or {}
        extra_calls = [(f"Giữ {pct}% mức phục vụ của toàn bộ kế hoạch ({_vnd(points[str(pct)] if str(pct) in points else points.get(pct, 0))})",
                        float(points.get(str(pct), points.get(pct, 0)) or 0), {}) for pct in (99, 95, 90)]
        extra_calls = [c for c in extra_calls if c[1] > 0]
        calls += extra_calls
        first_results += await asyncio.gather(*(_reorder(auth_header, budgetVnd=value, **base_params)
                                                for _l, value, _e in extra_calls))
    scenarios_in = [(label, value) for label, value, _e in calls]
    results = first_results
    total_shortfall = sum(_shortfall(i) for i in base.get("items") or [])
    lines_with_shortfall = sum(1 for i in base.get("items") or [] if _shortfall(i) > 0)
    scenarios = []
    for (label, value), res in zip(scenarios_in, results):
        if _error(res):
            scenarios.append({"label": label, "budget_vnd": value, "error": res["error"]})
            continue
        items = res.get("items") or []
        funded = [i for i in items if i.get("within_budget")]
        # a 3.3 line re-sized to 0 (copies incoming / expected back cover it) needs no money
        needs_none = lambda i: (i.get("budget_plan") or {}).get("cap_qty") == 0 and (i.get("suggested_reorder_qty") or 0) > 0  # noqa: E731
        unfunded_high = [i for i in items if not i.get("within_budget") and i.get("priority") == "HIGH" and not needs_none(i)]
        # Since 3.3 a line can be funded in part (funded_qty); older responses
        # fund whole lines (suggested_reorder_qty).
        qty = lambda i: i.get("funded_qty", i.get("suggested_reorder_qty")) or 0  # noqa: E731
        covered = sum(_covered(i) for i in funded)
        budget_info = res.get("budget") or {}
        scenarios.append({
            "label": label, "budget_vnd": value,
            # "condition": a what-if about the world (supplier delay), not an option the manager chooses
            "kind": "condition" if budget_info.get("lead_time_delay_days") else "choice",
            # expected lead-time demand served, % of what the whole re-sized plan serves (analytics, Poisson model)
            "expected_service_pct": budget_info.get("expected_service_pct"),
            **({"lead_time_delay_days": budget_info["lead_time_delay_days"]} if budget_info.get("lead_time_delay_days") else {}),
            **({"priority_warehouse": priority_wh["name"], "priority_lines": budget_info.get("priority_lines"),
                "priority_lines_funded": budget_info.get("priority_lines_funded")}
               if budget_info.get("priority_warehouse_id") and priority_wh else {}),
            "funded_cost": budget_info.get("funded_cost"), "remaining_vnd": budget_info.get("remaining_vnd"),
            "funded_lines": len(funded), "funded_qty": sum(qty(i) for i in funded),
            "partially_funded_lines": budget_info.get("partially_funded_lines"),
            "covers_need_with_position": (budget_info.get("capped_need_cost") is not None
                                          and (budget_info.get("funded_cost") or 0) >= budget_info["capped_need_cost"] - 1),
            "lines_covered_by_position": sum(1 for i in items if needs_none(i)) if any("budget_plan" in i for i in items) else None,
            "funded_high_priority": sum(1 for i in funded if i.get("priority") == "HIGH"),
            "unfunded_high_priority": len(unfunded_high),
            "shortfall_covered_pct": round(covered / total_shortfall * 100, 1) if total_shortfall else None,
            # 0 here with funded lines > 0 means no shortfall line could be
            # funded with what the budget left when it was considered.
            "funded_shortfall_lines": sum(1 for i in funded if _shortfall(i) > 0),
            "funded_items": [{"variant_id": i.get("variant_id"), "title": i.get("title"), "priority": i.get("priority"),
                              "suggested_reorder_qty": i.get("suggested_reorder_qty"), "funded_qty": qty(i),
                              "estimated_cost": i.get("funded_cost", i.get("estimated_cost"))}
                             for i in funded[:8]],
            "unfunded_high_examples": [{"title": i.get("title"), "estimated_cost": i.get("estimated_cost")}
                                       for i in unfunded_high[:5]],
        })
    reference = next((s for s in scenarios if not s.get("error")), None)
    for s in scenarios:
        if reference is not None and s is not reference and not s.get("error"):
            # Differences against the first scenario, computed here so the answer
            # never has to subtract two budgets itself.
            s["vs_first_scenario"] = {
                "budget_vnd": round(s["budget_vnd"] - reference["budget_vnd"], 2),
                "funded_cost": round((s.get("funded_cost") or 0) - (reference.get("funded_cost") or 0), 2),
                "funded_lines": s["funded_lines"] - reference["funded_lines"],
                "funded_qty": s["funded_qty"] - reference["funded_qty"],
                "unfunded_high_priority": s["unfunded_high_priority"] - reference["unfunded_high_priority"],
                **({"expected_service_pct": round(s["expected_service_pct"] - reference["expected_service_pct"], 1)}
                   if s.get("expected_service_pct") is not None and reference.get("expected_service_pct") is not None else {}),
            }
    first_ok = next((s for s in scenarios if not s.get("error")), None)
    if what_if and first_ok and first_ok["label"].startswith("Đủ nhu cầu hiện tại") and first_ok.get("covers_need_with_position"):
        # funding the whole need costs only the position-based plan: say what it actually spends
        first_ok["label"] = f"Toàn bộ kế hoạch theo tồn dự kiến ({_vnd(first_ok.get('funded_cost') or 0)})"
    # only options the manager can choose are ranked - a supplier delay is a condition, not a choice
    ok = [s for s in scenarios if not s.get("error") and s.get("expected_service_pct") is not None and s.get("kind") != "condition"]
    least_risk = None
    if len(ok) >= 2:
        # less stockout risk = more of the expected lead-time demand served; ties: fewer HIGH titles left out
        best = max(ok, key=lambda s: (s["expected_service_pct"], -s["unfunded_high_priority"]))
        least_risk = {"label": best["label"], "expected_service_pct": best["expected_service_pct"],
                      "unfunded_high_priority": best["unfunded_high_priority"],
                      "rule": "Phương án đáp ứng được nhiều nhất nhu cầu dự kiến trong thời gian chờ hàng (mô hình Poisson của "
                              "analytics); hòa thì ít đầu sách ưu tiên cao bị bỏ lại hơn."}
    shown = len(base.get("items") or [])
    meta = next(((res.get("budget") or {}) for res in results if not _error(res) and res.get("budget")), {})
    marginal = meta.get("funding_order") == "MARGINAL_SERVICE_PER_COST"
    return {
        "full_need": {"total_candidates": summary.get("total_candidates"), "high_priority": summary.get("high_priority"),
                      "estimated_total_cost": summary.get("estimated_total_cost"),
                      "estimated_total_reorder_qty": summary.get("estimated_total_reorder_qty"),
                      # 3.3 budget mode: the same lines re-sized against available + incoming + expected returns
                      "need_with_position_vnd": meta.get("capped_need_cost")},
        "scenarios": scenarios,
        "scenarios_are_assumed": assumed,
        "least_risk_scenario": least_risk,
        "service_curve": ({"cost_for_service_pct": curve.get("cost_for_service_pct"),
                           "full_plan_cost": curve.get("full_plan_cost")} if curve else None),
        "funding_rule": ("Phân bổ của dịch vụ analytics: duyệt từng bản cho dòng tăng nhiều nhất khả năng đáp ứng nhu cầu "
                         "trong thời gian chờ hàng trên mỗi đồng; tồn tính cả bản đang về và bản đang mượn dự kiến trả; "
                         "một dòng có thể chỉ được duyệt một phần." if marginal else
                         "Phân bổ của dịch vụ analytics: ưu tiên dòng giảm được nhiều thiếu hụt dự kiến nhất trên mỗi đồng."),
        "budget_assumptions": meta.get("assumptions") or [],
        "shortfall_definition": "Thiếu hụt dự kiến = nhu cầu trong thời gian chờ hàng − tồn khả dụng (tính trên các dòng được liệt kê).",
        "items_counted": shown,
        "lines_with_shortfall": lines_with_shortfall,
        "items_not_listed": max(0, (summary.get("total_candidates") or 0) - shown),
        "limitations": ["Không tối ưu theo ràng buộc nhà cung cấp/số lượng tối thiểu; đơn giá là unit_cost hiện có trong danh mục."],
        "retrieved_at": _now_iso(),
    }


async def explain_reorder_item(
    auth_header: str | None = None, title: str | None = None, variant_id: str | None = None,
    rank: int | None = None, priority: str | None = None,
) -> dict:
    """Why one book is (or is not) suggested for reorder: its full reorder line,
    its rank in the list, and the data-confidence rule. Identified by
    variant_id when known, by rank in the current list, else by title."""
    params = {"priority": priority} if priority in ("HIGH", "MEDIUM", "LOW") else {}
    data = await _reorder(auth_header, **params)
    if _error(data):
        return data
    items = data.get("items") or []
    found, position = None, None
    if variant_id:
        found = next(((i, x) for i, x in enumerate(items) if x.get("variant_id") == variant_id), None)
    elif rank:
        index = int(rank) - 1
        found = (index, items[index]) if 0 <= index < len(items) else None
    elif title:
        query = normalize_query(title)
        exact = [(i, x) for i, x in enumerate(items) if normalize_text(x.get("title") or "") == normalize_text(title)]
        contained = sorted(((i, x) for i, x in enumerate(items)
                            if normalize_text(x.get("title") or "") and normalize_text(x.get("title") or "") in query),
                           key=lambda pair: -len(pair[1].get("title") or ""))
        found = (exact or contained or [None])[0]
    if found is None:
        return {"found": False, "query": title or variant_id or rank,
                "note": "Sách này không nằm trong danh sách đề xuất nhập hiện tại (không có tín hiệu nhu cầu hoặc tồn còn đủ).",
                "total_candidates": (data.get("summary") or {}).get("total_candidates"), "retrieved_at": _now_iso()}
    position, item = found
    return {"found": True, "rank_in_list": position + 1, "list_filter": params.get("priority", "ALL"),
            "total_candidates": (data.get("summary") or {}).get("total_candidates"),
            "item": _reorder_row(item), "data_confidence": data_confidence(item),
            "range": data.get("range"), "retrieved_at": _now_iso()}


# ── priorities ───────────────────────────────────────────────────────────────

_RANKING_RULE = ("Thứ tự cố định theo mức ảnh hưởng: (1) phục vụ bạn đọc bị gián đoạn ngay (sách hết hàng còn nhu cầu, "
                 "mã nhận sách sắp hết hạn), (2) rủi ro tài chính/tuân thủ (phiếu quá hạn, phạt chưa thu), "
                 "(3) phòng ngừa (đề xuất nhập ưu tiên cao, kho dưới ngưỡng). Trong cùng nhóm, số lượng lớn hơn đứng trước.")


async def rank_priority_tasks(auth_header: str | None = None) -> dict:
    """Today's work queue from live KPIs, ranked by a fixed, stated rule - a
    heuristic ordering, not an optimisation."""
    kpis, overdue, risk, reorder = await asyncio.gather(
        _cached_get("/analytics/dashboard/kpis", auth_header),
        _cached_get("/analytics/overdue-summary", auth_header),
        _cached_get("/analytics/warehouse-stock-risk", auth_header),
        _reorder(auth_header),
    )
    tasks, unavailable = [], []

    def add(tier: int, title: str, value, unit: str, why: str, next_step: str, source: str) -> None:
        if value:
            tasks.append({"tier": tier, "task": title, "value": value, "unit": unit, "why": why,
                          "next_step": next_step, "source": source})

    if _error(reorder):
        unavailable.append(f"đề xuất nhập: {reorder['error']}")
    else:
        items = reorder.get("items") or []
        stockout_demand = [i for i in items if (i.get("available_qty") or 0) <= 0 and (i.get("borrow_count") or 0) > 0]
        add(1, "Bổ sung sách đã hết hàng nhưng vẫn có người mượn", len(stockout_demand), "đầu sách",
            "Bạn đọc đang không mượn được những đầu sách có nhu cầu.",
            "Lập phiếu đề xuất nhập cho các đầu sách này (cần xác nhận trước khi tạo).", "reorder-suggestions")
        add(3, "Xem xét đề xuất nhập ưu tiên cao", (reorder.get("summary") or {}).get("high_priority"), "đầu sách",
            "Dự báo nhu cầu trong thời gian chờ hàng vượt tồn khả dụng.",
            "Duyệt danh sách đề xuất nhập ưu tiên HIGH.", "reorder-suggestions")
    if _error(kpis):
        unavailable.append(f"KPI: {kpis['error']}")
    else:
        add(1, "Nhắc bạn đọc nhận sách trước khi mã nhận hết hạn", kpis.get("pickup_codes_expiring_soon"), "mã",
            "Mã nhận sách sắp hết hạn sẽ làm hủy lượt đặt chỗ.", "Gửi nhắc nhận sách.", "dashboard/kpis")
        add(2, "Thu hồi khoản phạt chưa thu", kpis.get("unpaid_fine_amount"), "₫",
            "Công nợ phạt tồn đọng.", "Rà soát các khoản phạt lớn nhất và nhắc thanh toán.", "dashboard/kpis")
    if _error(overdue):
        unavailable.append(f"quá hạn: {overdue['error']}")
    else:
        add(2, "Xử lý phiếu mượn quá hạn", overdue.get("total_overdue_loans"), "phiếu",
            f"Trung bình quá hạn {overdue.get('average_overdue_days')} ngày, lâu nhất {overdue.get('oldest_overdue_days')} ngày.",
            "Liên hệ các phiếu quá hạn lâu nhất trước.", "overdue-summary")
    if _error(risk):
        unavailable.append(f"rủi ro kho: {risk['error']}")
    else:
        rows = [r for r in risk if isinstance(r, dict)] if isinstance(risk, list) else []
        worst = sorted(rows, key=_risk_key)[:1]
        add(3, "Kiểm tra kho có nhiều đầu sách dưới ngưỡng", sum(r.get("low_stock_variants") or 0 for r in rows),
            "đầu sách", f"Kho rủi ro nhất: {worst[0]['warehouse_name']}." if worst else "",
            "Đối chiếu tồn thực tế và điều chuyển giữa các kho nếu được.", "warehouse-stock-risk")
    tasks.sort(key=lambda t: (t["tier"], -(t["value"] if isinstance(t["value"], (int, float)) else 0)))
    for i, task in enumerate(tasks, start=1):
        task["rank"] = i
    return {"ranking_rule": _RANKING_RULE, "tasks": tasks, "unavailable": unavailable, "retrieved_at": _now_iso()}


COPILOT_TOOL_FUNCTIONS = {
    "get_warehouse_low_stock_items": get_warehouse_low_stock_items,
    "compare_warehouses": compare_warehouses,
    "explain_warehouse_shortage": explain_warehouse_shortage,
    "compare_borrow_periods": compare_borrow_periods,
    "compare_top_books": compare_top_books,
    "analyze_demand_vs_stock": analyze_demand_vs_stock,
    "simulate_reorder_budget": simulate_reorder_budget,
    "explain_reorder_item": explain_reorder_item,
    "rank_priority_tasks": rank_priority_tasks,
}

_DATE_PROPS = {
    "from_date": {"type": "string", "description": "Đầu kỳ hiện tại, ISO (YYYY-MM-DD hoặc có giờ)"},
    "to_date": {"type": "string", "description": "Cuối kỳ hiện tại, ISO"},
}
_COMPARE_PROPS = {
    **_DATE_PROPS,
    "compare_from_date": {"type": "string", "description": "Đầu kỳ so sánh, ISO"},
    "compare_to_date": {"type": "string", "description": "Cuối kỳ so sánh, ISO"},
}


def _schema(name: str, description: str, properties: dict | None = None, required: list | None = None) -> dict:
    return {"type": "function", "function": {"name": name, "description": description, "parameters": {
        "type": "object", "properties": properties or {}, "required": required or []}}}


COPILOT_TOOLS = [
    _schema("get_warehouse_low_stock_items",
            "Danh sách đầu sách hết hàng/dưới ngưỡng tồn tối thiểu tại MỘT kho cụ thể (theo tên hoặc mã kho).",
            {"warehouse": {"type": "string", "description": "Tên hoặc mã kho, ví dụ 'Kho Ha Noi', 'WH-HN-01'"},
             "limit": {"type": "integer", "description": "Số dòng tối đa, 1-100, mặc định 30"}}, ["warehouse"]),
    _schema("compare_warehouses",
            "So sánh/xếp hạng rủi ro tồn kho giữa các kho theo tiêu chí cố định (hết hàng, dưới ngưỡng, tồn khả dụng). "
            "Truyền 2 kho để so sánh cặp, bỏ trống để xếp hạng mọi kho.",
            {"warehouses": {"type": "array", "items": {"type": "string"}, "description": "Tên hoặc mã các kho"}}),
    _schema("explain_warehouse_shortage",
            "Phân tích các yếu tố góp phần khiến MỘT kho thiếu sách: sách hết/dưới ngưỡng tại kho, nối theo variant_id "
            "với nhu cầu mượn, xu hướng, đặt chỗ, thời gian chờ hàng. Dùng cho câu hỏi 'tại sao kho X thiếu sách'.",
            {"warehouse": {"type": "string", "description": "Tên hoặc mã kho"}}, ["warehouse"]),
    _schema("compare_borrow_periods",
            "So sánh lượt mượn/trả/đặt chỗ giữa hai kỳ: tổng, chênh lệch, % thay đổi và trung bình mỗi ngày.",
            _COMPARE_PROPS, ["from_date", "to_date", "compare_from_date", "compare_to_date"]),
    _schema("compare_top_books",
            "So sánh top sách được mượn nhiều giữa hai kỳ (nối theo variant_id): thứ hạng tăng/giảm, sách mới vào top, sách rơi khỏi top.",
            {**_COMPARE_PROPS, "limit": {"type": "integer", "description": "Số sách mỗi kỳ, 1-20"}},
            ["from_date", "to_date", "compare_from_date", "compare_to_date"]),
    _schema("analyze_demand_vs_stock",
            "Sách được mượn nhiều NHƯNG tồn kho thấp và cần nhập thêm: nối top sách mượn nhiều với dữ liệu tồn kho và "
            "đề xuất nhập theo variant_id.",
            {**_DATE_PROPS, "limit": {"type": "integer", "description": "Số sách tối đa, 1-20"}}),
    _schema("simulate_reorder_budget",
            "Mô phỏng 'nếu ngân sách nhập là X / giảm Y%': số dòng, số lượng, chi phí được duyệt, phần trăm thiếu hụt "
            "được đáp ứng, sách ưu tiên cao bị bỏ lại. Không có ngân sách thì mô phỏng 100/75/50/25% nhu cầu.",
            {"budgets_vnd": {"type": "array", "items": {"type": "number"}, "description": "Một đến ba mức ngân sách (VNĐ)"},
             "budget_change_pct": {"type": "number", "description": "Phần trăm thay đổi ngân sách, âm là giảm"},
             "lead_time_days": {"type": "integer", "description": "Ép thời gian chờ hàng (ngày)"},
             "priority": {"type": "string", "enum": ["HIGH", "MEDIUM", "LOW"]},
             "lead_time_delay_days": {"type": "integer", "description": "Nếu nhà cung cấp giao chậm thêm N ngày (cộng vào thời gian chờ của từng dòng)"},
             "priority_warehouse": {"type": "string", "description": "Tên kho được ưu tiên: dòng thiếu ở kho này được duyệt trước"},
             "keep_service": {"type": "boolean", "description": "Tìm ngân sách nhỏ nhất vẫn giữ 99/95/90% mức phục vụ của toàn bộ kế hoạch"}}),
    _schema("explain_reorder_item",
            "Giải thích vì sao một đầu sách được (hoặc không được) đề xuất nhập: số liệu, lý do, mức độ chắc chắn của dữ liệu.",
            {"title": {"type": "string", "description": "Tên sách"},
             "rank": {"type": "integer", "description": "Vị trí trong danh sách đề xuất hiện tại (1 = đầu tiên)"},
             "priority": {"type": "string", "enum": ["HIGH", "MEDIUM", "LOW"]}}),
    _schema("rank_priority_tasks",
            "Xếp hạng các việc cần ưu tiên xử lý hôm nay từ số liệu thật (hết hàng có nhu cầu, quá hạn, phạt chưa thu, "
            "đề xuất nhập, kho dưới ngưỡng) theo quy tắc cố định."),
]
