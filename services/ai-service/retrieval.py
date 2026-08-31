from __future__ import annotations

import asyncio
from datetime import datetime, timezone
import os
import re
from typing import Any

import httpx

import faq_retrieval
from intent import (
    AGING_INVENTORY_QUERY,
    BOOK_SEARCH_QUERY,
    BORROW_TREND_QUERY,
    DASHBOARD_SUMMARY_QUERY,
    FINE_SUMMARY_QUERY,
    GENERAL_QUERY,
    LOW_STOCK_QUERY,
    OVERDUE_LOAN_QUERY,
    REORDER_SUGGESTION_QUERY,
    RESERVATION_QUERY,
    TOP_BORROWED_BOOKS_QUERY,
    normalize_text,
)


GATEWAY_URL = os.getenv("SMARTBOOK_GATEWAY_URL", "http://api-gateway:3000").rstrip("/")
RETRIEVAL_TIMEOUT = float(os.getenv("RAG_RETRIEVAL_TIMEOUT_SECONDS", "8"))


SOURCE_NAMES = {
    "/analytics/dashboard/kpis": "Dashboard KPIs",
    "/analytics/warehouse-stock-risk": "Warehouse Stock Risk",
    "/analytics/fine-summary": "Fine Summary",
    "/analytics/top-books": "Top Books",
    "/analytics/overdue-summary": "Overdue Summary",
    "/analytics/borrow-trends": "Borrow Trends",
    "/analytics/reservation-funnel": "Reservation Funnel",
    "/analytics/reorder-suggestions": "Reorder Suggestions",
    "/analytics/aging-inventory": "Aging Inventory",
    "/api/books": "Catalog Books",
    "/api/stock-balances/low-stock": "Low Stock By Warehouse",
}


def _number(value: Any, default: float = 0) -> float:
    try:
        if value is None or value == "":
            return default
        return float(value)
    except (TypeError, ValueError):
        return default


def _int(value: Any, default: int = 0) -> int:
    return int(_number(value, default))


def _as_list(payload: Any) -> list:
    if isinstance(payload, list):
        return payload
    if isinstance(payload, dict):
        data = payload.get("data")
        if isinstance(data, list):
            return data
        if isinstance(data, dict):
            rows = data.get("data") or data.get("items") or data.get("rows")
            if isinstance(rows, list):
                return rows
    return []


def _data(payload: Any) -> Any:
    if isinstance(payload, dict) and "data" in payload:
        return payload.get("data")
    return payload


def _source_name(endpoint: str) -> str:
    path = endpoint.split("?")[0]
    return SOURCE_NAMES.get(path, path)


def _endpoint_with_params(endpoint: str, params: dict | None) -> str:
    if not params:
        return endpoint
    query = "&".join(f"{key}={value}" for key, value in params.items() if value is not None)
    return f"{endpoint}?{query}" if query else endpoint


async def _fetch(client: httpx.AsyncClient, endpoint: str, auth_header: str | None, params: dict | None = None) -> tuple[dict, Any, str | None]:
    source_endpoint = _endpoint_with_params(endpoint, params)
    source = {"name": _source_name(endpoint), "endpoint": source_endpoint, "status": "pending"}
    headers = {}
    if auth_header:
        headers["Authorization"] = auth_header

    try:
        response = await client.get(f"{GATEWAY_URL}{endpoint}", params=params, headers=headers)
        if response.status_code >= 400:
            source["status"] = f"error:{response.status_code}"
            return source, None, f"{source['name']} returned HTTP {response.status_code}"
        source["status"] = "ok"
        return source, response.json(), None
    except httpx.TimeoutException:
        source["status"] = "timeout"
        return source, None, f"{source['name']} timed out"
    except Exception as exc:
        source["status"] = "error"
        return source, None, f"{source['name']} retrieval failed: {type(exc).__name__}"


def _book_quantity(book: dict) -> int:
    for key in ["quantity", "available_qty", "availableQty", "stock", "stock_qty", "available"]:
        if key in book:
            return _int(book.get(key))

    locations = book.get("locations")
    if isinstance(locations, list):
        return sum(_int(item.get("quantity")) for item in locations if isinstance(item, dict))

    variants = book.get("variants") or book.get("book_variants")
    if isinstance(variants, list):
        total = 0
        for variant in variants:
            if not isinstance(variant, dict):
                continue
            balances = variant.get("stock_balances") or []
            if isinstance(balances, list):
                total += sum(_int(balance.get("available_qty")) for balance in balances if isinstance(balance, dict))
        return total

    return 0


def _book_title(book: dict) -> str:
    return str(book.get("title") or book.get("book_title") or "Chua co ten sach")


def _book_author(book: dict) -> str:
    return str(book.get("author") or book.get("authors") or "")


def _compact_book(book: dict) -> dict:
    return {
        "id": book.get("id") or book.get("book_id"),
        "variant_id": book.get("variant_id"),
        "title": _book_title(book),
        "author": _book_author(book),
        "category": book.get("category") or "",
        "isbn": book.get("isbn") or book.get("isbn13") or book.get("isbn10") or "",
        "quantity": _book_quantity(book),
    }


def _format_vnd(value: Any) -> str:
    return f"{_int(value):,} VND".replace(",", ".")


def _limit_lines(rows: list[str], limit: int = 12) -> str:
    if not rows:
        return "- Khong co du lieu phu hop."
    lines = rows[:limit]
    if len(rows) > limit:
        lines.append(f"- ... va {len(rows) - limit} dong khac.")
    return "\n".join(lines)


def _time_params(intent_info: dict, default_30_days: bool = False) -> dict:
    params = {}
    time_range = intent_info.get("time_range")
    if not time_range and default_30_days:
        from intent import _detect_time_range

        time_range = _detect_time_range("30 ngay")
    if isinstance(time_range, dict):
        if time_range.get("from"):
            params["from"] = time_range["from"]
        if time_range.get("to"):
            params["to"] = time_range["to"]
    return params


def _filter_books(books: list[dict], query: str, limit: int = 10) -> list[dict]:
    normalized_query = normalize_text(query)
    tokens = [token for token in re.split(r"\s+", normalized_query) if len(token) >= 2]
    if not tokens:
        return []

    scored = []
    for book in books:
        compact = _compact_book(book)
        haystack = normalize_text(" ".join([
            compact["title"],
            compact["author"],
            str(compact.get("category") or ""),
            str(compact.get("isbn") or ""),
        ]))
        score = sum(1 for token in tokens if token in haystack)
        if normalized_query and normalized_query in haystack:
            score += 3
        if score > 0:
            scored.append((score, compact))

    scored.sort(key=lambda item: (-item[0], item[1]["title"]))
    return [item[1] for item in scored[:limit]]


def _filter_by_warehouse_hint(wh_groups: dict, warehouse_hint: str | None) -> tuple[dict, str | None]:
    """Scope a warehouse-grouped dict down to the warehouse a follow-up question
    mentioned (e.g. "con kho Ha Noi thi sao?"). Falls back to all warehouses
    (with a warning) if the hint doesn't match anything in the data, rather than
    silently dropping data or guessing.
    """
    if not warehouse_hint:
        return wh_groups, None
    hint = normalize_text(str(warehouse_hint))
    matched = {}
    for wh_code, wh_items in wh_groups.items():
        wh_name = wh_items[0].get("warehouse_name") if wh_items else None
        haystack = normalize_text(f"{wh_name or ''} {wh_code}")
        if hint in haystack:
            matched[wh_code] = wh_items
    if matched:
        return matched, None
    return wh_groups, f"Khong tim thay kho khop voi '{warehouse_hint}' trong du lieu; hien thi tat ca cac kho."


async def retrieve_context(intent_info: dict, auth_header: str | None) -> dict:
    intent = intent_info.get("intent") or GENERAL_QUERY
    warehouse_hint = (intent_info.get("entities") or {}).get("warehouse_hint")
    sources: list[dict] = []
    warnings: list[str] = []
    raw: dict[str, Any] = {}

    if intent == GENERAL_QUERY:
        # Nothing in the 11 fixed intents matched. Instead of returning an empty
        # context (which leaves the LLM with nothing to ground on), look for
        # related entries in the static FAQ set.
        #
        # Ollama's embed() is a blocking network call, so it must run off the
        # event loop the same way main.py wraps ollama.Client calls in
        # _chat_with_ollama (main.py:3291-3309), since retrieve_context is async.
        empty_envelope = {
            "summary": "",
            "raw": raw,
            "sources": sources,
            "warnings": warnings,
            "retrieved_at": datetime.now(timezone.utc).isoformat(),
        }
        try:
            faq_matches = await asyncio.to_thread(
                faq_retrieval.find_relevant, intent_info.get("query") or ""
            )
        except Exception:
            # find_relevant is documented never to raise; belt-and-braces so a
            # bug in the embedding layer can never turn /chat into a 500.
            return empty_envelope
        if not faq_matches:
            return empty_envelope

        for match in faq_matches:
            sources.append({
                "name": f"FAQ: {match.entry['question']}",
                "endpoint": f"faq://{match.entry['id']}",
                "status": "ok",
            })
        raw["faq_matches"] = [
            {
                "id": match.entry["id"],
                "question": match.entry["question"],
                "answer": match.entry["answer"],
                "score": round(match.score, 3),
            }
            for match in faq_matches
        ]
        faq_lines = [
            f"- {match.entry['question']}: {match.entry['answer']}" for match in faq_matches
        ]
        summary = "Cau hoi thuong gap lien quan:\n" + "\n".join(faq_lines)

        return {
            "summary": summary,
            "raw": raw,
            "sources": sources,
            "warnings": warnings,
            "retrieved_at": datetime.now(timezone.utc).isoformat(),
        }

    if not auth_header:
        return {
            "summary": "Toi chua co quyen truy xuat du lieu he thong vi request khong co Authorization token.",
            "raw": raw,
            "sources": sources,
            "warnings": ["Missing Authorization header; real-time SmartBook retrieval was skipped."],
            "retrieved_at": datetime.now(timezone.utc).isoformat(),
        }

    async with httpx.AsyncClient(timeout=httpx.Timeout(RETRIEVAL_TIMEOUT)) as client:
        if intent == DASHBOARD_SUMMARY_QUERY:
            tasks = [
                _fetch(client, "/analytics/dashboard/kpis", auth_header),
                _fetch(client, "/analytics/warehouse-stock-risk", auth_header),
                _fetch(client, "/analytics/fine-summary", auth_header),
            ]
            results = await asyncio.gather(*tasks)
            for source, payload, warning in results:
                sources.append(source)
                if warning:
                    warnings.append(warning)
                if payload is not None:
                    raw[source["name"]] = _data(payload)

            kpis = raw.get("Dashboard KPIs") or {}
            stock = raw.get("Warehouse Stock Risk") or []
            fines = raw.get("Fine Summary") or {}
            high_risk = [row for row in stock if isinstance(row, dict) and (_int(row.get("low_stock_variants")) or _int(row.get("out_of_stock_variants")))]
            summary = "\n".join([
                "Tong quan thu vien:",
                f"- Tong dau sach: {_int(kpis.get('total_titles'))}; tong ban sao: {_int(kpis.get('total_copies'))}.",
                f"- Dang muon: {_int(kpis.get('active_loans'))}; qua han: {_int(kpis.get('overdue_loans'))}.",
                f"- Reservation pending/confirmed/ready: {_int(kpis.get('pending_reservations'))}/{_int(kpis.get('confirmed_reservations'))}/{_int(kpis.get('ready_for_pickup_reservations'))}.",
                f"- Pickup code sap het han: {_int(kpis.get('pickup_codes_expiring_soon'))}.",
                f"- Fine chua thu: {_format_vnd(kpis.get('unpaid_fine_amount') or fines.get('total_unpaid'))}.",
                f"- Warehouse co rui ro ton kho: {len(high_risk)}.",
            ])

        elif intent == LOW_STOCK_QUERY:
            results = await asyncio.gather(
                _fetch(client, "/analytics/warehouse-stock-risk", auth_header),
                _fetch(client, "/api/books", auth_header),
                _fetch(client, "/api/stock-balances/low-stock", auth_header, {"limit": 50}),
            )
            for source, payload, warning in results:
                sources.append(source)
                if warning:
                    warnings.append(warning)
                if payload is not None:
                    raw[source["name"]] = _data(payload)

            books = [_compact_book(book) for book in _as_list(raw.get("Catalog Books"))]
            low_books = sorted(
                [book for book in books if _book_quantity(book) <= 10],
                key=lambda book: (book["quantity"], book["title"]),
            )[:10]
            raw["low_stock_books"] = low_books

            # Per-warehouse low-stock items — already aggregated by (warehouse_id, variant_id)
            # by the backend SQL GROUP BY query. No client-side dedup needed.
            low_stock_by_wh = _as_list(raw.get("Low Stock By Warehouse"))
            raw["low_stock_by_warehouse"] = low_stock_by_wh

            # Build warehouse-grouped summary (primary source for AI reply)
            wh_groups: dict[str, list] = {}
            for it in low_stock_by_wh:
                key = it.get("warehouse_code") or it.get("warehouse_id") or "UNKNOWN"
                wh_groups.setdefault(key, []).append(it)
            wh_groups, hint_warning = _filter_by_warehouse_hint(wh_groups, warehouse_hint)
            if hint_warning:
                warnings.append(hint_warning)

            wh_section_lines: list[str] = []
            total_low_items = sum(len(items) for items in wh_groups.values())
            for wh_code, wh_items in list(wh_groups.items())[:5]:
                wh_name = wh_items[0].get("warehouse_name") or wh_code
                wh_section_lines.append(f"\n🏭 **{wh_name}** ({wh_code}) — {len(wh_items)} sách:")
                for it in wh_items[:5]:
                    total_qty = _int(it.get("available_qty"))   # on_hand total (shelf+receiving)
                    shelf_qty = _int(it.get("shelf_qty"))        # truly on-shelf
                    icon = "🔴" if total_qty == 0 else "🟡"
                    # Show shelf breakdown only when receiving stock is present
                    qty_str = (
                        f"{total_qty} (sẵn: {shelf_qty})"
                        if shelf_qty != total_qty and shelf_qty >= 0
                        else str(total_qty)
                    )
                    sup = f", NCC: {it['suggested_supplier_name']}" if it.get("suggested_supplier_name") else ""
                    wh_section_lines.append(
                        f"  {icon} **{it.get('title')}** — tồn {qty_str}, "
                        f"gợi ý nhập {_int(it.get('suggested_quantity'))}, {it.get('priority', 'MEDIUM')}{sup}"
                    )
                extra = len(wh_items) - 5
                if extra > 0:
                    wh_section_lines.append(f"  ...và {extra} sách khác")

            if wh_section_lines:
                summary = "\n".join([
                    f"📦 **Sách tồn kho thấp theo kho** ({total_low_items} dòng, {len(wh_groups)} kho):",
                    *wh_section_lines,
                ])
            else:
                # Fallback to catalog-level summary when no per-warehouse data
                out_of_stock = [b for b in low_books if b["quantity"] == 0]
                low = [b for b in low_books if b["quantity"] > 0]
                lines = [
                    f"{'🔴' if b['quantity'] == 0 else '🟡'} **{b['title']}** — tồn {b['quantity']} bản"
                    for b in low_books
                ]
                summary = "\n".join([
                    f"⚠️ **{len(low_books)} sách** tồn kho thấp (🔴 {len(out_of_stock)} hết hàng, 🟡 {len(low)} sắp hết):",
                    _limit_lines(lines, 8),
                ])

        elif intent == TOP_BORROWED_BOOKS_QUERY:
            params = {"limit": 10, **_time_params(intent_info, default_30_days=True)}
            source, payload, warning = await _fetch(client, "/analytics/top-books", auth_header, params)
            sources.append(source)
            if warning:
                warnings.append(warning)
            rows = _as_list(payload)
            raw["Top Books"] = rows
            lines = [f"- {idx + 1}. {row.get('title', 'Khong ro ten')}: {_int(row.get('borrow_count'))} luot muon." for idx, row in enumerate(rows[:10])]
            summary = "Top sach duoc muon nhieu:\n" + _limit_lines(lines, 10)

        elif intent == OVERDUE_LOAN_QUERY:
            source, payload, warning = await _fetch(client, "/analytics/overdue-summary", auth_header)
            sources.append(source)
            if warning:
                warnings.append(warning)
            data = _data(payload) or {}
            raw["Overdue Summary"] = data
            items = data.get("items") if isinstance(data, dict) else []
            lines = []
            if isinstance(items, list):
                lines = [
                    f"- {item.get('loan_number', '?')}: {item.get('customer_name', 'Khong ro khach')} qua han {_int(item.get('overdue_days'))} ngay, han tra {str(item.get('due_date') or '')[:10]}."
                    for item in items[:10]
                    if isinstance(item, dict)
                ]
            summary = "\n".join([
                f"Tong loan qua han: {_int(data.get('total_overdue_loans'))}; tong item qua han: {_int(data.get('total_overdue_items'))}.",
                f"Qua han trung binh: {_number(data.get('average_overdue_days')):.1f} ngay; lau nhat: {_int(data.get('oldest_overdue_days'))} ngay.",
                _limit_lines(lines, 10),
            ])

        elif intent == FINE_SUMMARY_QUERY:
            source, payload, warning = await _fetch(client, "/analytics/fine-summary", auth_header)
            sources.append(source)
            if warning:
                warnings.append(warning)
            data = _data(payload) or {}
            raw["Fine Summary"] = data
            by_type = data.get("by_type") if isinstance(data, dict) else []
            lines = []
            if isinstance(by_type, list):
                lines = [f"- {row.get('fine_type', '?')}: {_format_vnd(row.get('amount'))}, {row.get('count', 0)} khoan." for row in by_type[:8] if isinstance(row, dict)]
            summary = "\n".join([
                f"Fine chua thu: {_format_vnd(data.get('total_unpaid'))}; da thu: {_format_vnd(data.get('total_paid'))}; da waive: {_format_vnd(data.get('total_waived'))}.",
                f"So khoan chua thu: {_int(data.get('unpaid_count'))}; da thanh toan: {_int(data.get('paid_count'))}.",
                _limit_lines(lines, 8),
            ])

        elif intent == BORROW_TREND_QUERY:
            params = {
                "granularity": intent_info.get("granularity") or "day",
                **_time_params(intent_info, default_30_days=True),
            }
            source, payload, warning = await _fetch(client, "/analytics/borrow-trends", auth_header, params)
            sources.append(source)
            if warning:
                warnings.append(warning)
            rows = _as_list(payload)
            raw["Borrow Trends"] = rows
            total_loans = sum(_int(row.get("loans")) for row in rows if isinstance(row, dict))
            total_returns = sum(_int(row.get("returns")) for row in rows if isinstance(row, dict))
            total_reservations = sum(_int(row.get("reservations")) for row in rows if isinstance(row, dict))
            recent = rows[-6:] if isinstance(rows, list) else []
            lines = [f"- {row.get('date')}: muon {row.get('loans', 0)}, tra {row.get('returns', 0)}, dat {row.get('reservations', 0)}." for row in recent if isinstance(row, dict)]
            summary = "\n".join([
                f"Xu huong co {len(rows)} moc thoi gian: tong muon {total_loans}, tong tra {total_returns}, tong reservation {total_reservations}.",
                _limit_lines(lines, 6),
            ])

        elif intent == RESERVATION_QUERY:
            source, payload, warning = await _fetch(client, "/analytics/reservation-funnel", auth_header)
            sources.append(source)
            if warning:
                warnings.append(warning)
            data = _data(payload) or {}
            raw["Reservation Funnel"] = data
            summary = "\n".join([
                f"Tong reservation: {_int(data.get('total'))}; conversion rate: {_number(data.get('conversion_rate')):.1f}%.",
                f"Pending: {_int(data.get('pending'))}; confirmed: {_int(data.get('confirmed'))}; ready: {_int(data.get('ready_for_pickup'))}; converted: {_int(data.get('converted_to_loan'))}.",
                f"Cancelled: {_int(data.get('cancelled'))}; expired: {_int(data.get('expired'))}.",
            ])

        elif intent == BOOK_SEARCH_QUERY:
            query = (intent_info.get("query") or "").strip()
            source, payload, warning = await _fetch(client, "/api/books", auth_header, {"search": query} if query else None)
            sources.append(source)
            if warning:
                warnings.append(warning)
            books = _as_list(payload)
            if not books and query:
                fallback_source, fallback_payload, fallback_warning = await _fetch(client, "/api/books", auth_header)
                sources.append(fallback_source)
                if fallback_warning:
                    warnings.append(fallback_warning)
                books = _as_list(fallback_payload)
            matches = _filter_books(books, query, 10)
            raw["Catalog Books"] = matches
            lines = [f"- {book['title']} ({book['author'] or 'khong ro tac gia'}), ISBN {book['isbn'] or '-'}, con {book['quantity']} ban." for book in matches]
            summary = f"Ket qua tim sach cho '{query}':\n" + _limit_lines(lines, 10)

        elif intent == REORDER_SUGGESTION_QUERY:
            results = await asyncio.gather(
                _fetch(client, "/analytics/reorder-suggestions", auth_header, {"days": 30, "limit": 10}),
                _fetch(client, "/api/stock-balances/low-stock", auth_header, {"limit": 50}),
            )
            for source, payload, warning in results:
                sources.append(source)
                if warning:
                    warnings.append(warning)
                if payload is not None:
                    raw[source["name"]] = _data(payload)

            data = raw.get("Reorder Suggestions") or {}

            # Per-warehouse low-stock items — already aggregated by SQL GROUP BY.
            low_stock_by_wh = _as_list(raw.get("Low Stock By Warehouse"))
            raw["low_stock_by_warehouse"] = low_stock_by_wh

            summary_data = data.get("summary") if isinstance(data, dict) else {}
            if not isinstance(summary_data, dict):
                summary_data = {}

            high = _int(summary_data.get('high_priority'))
            med = _int(summary_data.get('medium_priority'))
            total = _int(summary_data.get('total_candidates'))
            total_qty = _int(summary_data.get('estimated_total_reorder_qty'))

            # Build warehouse-grouped summary from per-warehouse low-stock data (best quality)
            wh_groups: dict[str, list] = {}
            for it in low_stock_by_wh:
                key = it.get("warehouse_code") or it.get("warehouse_id") or "UNKNOWN"
                wh_groups.setdefault(key, []).append(it)
            wh_groups, hint_warning = _filter_by_warehouse_hint(wh_groups, warehouse_hint)
            if hint_warning:
                warnings.append(hint_warning)

            wh_section_lines: list[str] = []
            for wh_code, wh_items in list(wh_groups.items())[:5]:
                wh_name = wh_items[0].get("warehouse_name") or wh_code
                wh_section_lines.append(f"\n🏭 **{wh_name}** ({wh_code}) — {len(wh_items)} sách:")
                for it in wh_items[:5]:
                    total_qty2 = _int(it.get("available_qty"))
                    shelf_qty2 = _int(it.get("shelf_qty"))
                    icon = "🔴" if total_qty2 == 0 else "🟡"
                    qty_str2 = (
                        f"{total_qty2} (sẵn: {shelf_qty2})"
                        if shelf_qty2 != total_qty2 and shelf_qty2 >= 0
                        else str(total_qty2)
                    )
                    sup = f", NCC: {it['suggested_supplier_name']}" if it.get("suggested_supplier_name") else ""
                    wh_section_lines.append(
                        f"  {icon} **{it.get('title')}** — tồn {qty_str2}, "
                        f"gợi ý nhập {_int(it.get('suggested_quantity'))}, {it.get('priority', 'MEDIUM')}{sup}"
                    )
                extra = len(wh_items) - 5
                if extra > 0:
                    wh_section_lines.append(f"  ...và {extra} sách khác")

            if wh_section_lines:
                filtered_low_items = sum(len(items) for items in wh_groups.values())
                summary = "\n".join([
                    f"📦 **Gợi ý nhập thêm theo từng kho** ({filtered_low_items} dòng, {len(wh_groups)} kho):",
                    *wh_section_lines,
                    f"\n📊 Tổng analytics: {total} đầu sách (🔴 {high} HIGH, 🟡 {med} MEDIUM) — {total_qty} bản.",
                    "📋 Đây là gợi ý hỗ trợ ra quyết định, không phải lệnh bắt buộc.",
                ])
            else:
                # Fallback to analytics-only summary
                items_raw = data.get("items") if isinstance(data, dict) else []
                if not isinstance(items_raw, list):
                    items_raw = []

                def _priority_icon(p: str) -> str:
                    return {"HIGH": "🔴", "MEDIUM": "🟡", "LOW": "🟢"}.get(str(p).upper(), "⚪")

                lines = [
                    "{icon} **{title}** — còn {available} bản, gợi ý nhập {qty} bản".format(
                        icon=_priority_icon(row.get("priority", "LOW")),
                        title=row.get("title", "Khong ro ten"),
                        available=_int(row.get("available_qty")),
                        qty=_int(row.get("suggested_reorder_qty")),
                    )
                    for row in items_raw[:5]
                    if isinstance(row, dict)
                ]
                summary = "\n".join([
                    f"📦 **{total} đầu sách** cần xem xét nhập thêm (🔴 {high} HIGH, 🟡 {med} MEDIUM) — tổng {total_qty} bản.",
                    "📋 Đây là gợi ý hỗ trợ ra quyết định, không phải lệnh bắt buộc.",
                    "Top sách cần ưu tiên:",
                    _limit_lines(lines, 5),
                ])

        elif intent == AGING_INVENTORY_QUERY:
            params = {"days": 90, "limit": 20}
            source, payload, warning = await _fetch(client, "/analytics/aging-inventory", auth_header, params)
            sources.append(source)
            if warning:
                warnings.append(warning)
            data = _data(payload) or {}
            items = data.get("items") if isinstance(data, dict) else []
            if not isinstance(items, list):
                items = []
            raw["Aging Inventory"] = items

            lines = [
                f"- **{it.get('title', 'Khong ro ten')}** — kho {it.get('warehouse_name', '?')}, "
                f"tồn {_int(it.get('on_hand_qty'))} bản, {_int(it.get('days_since_last_activity'))} ngày không hoạt động."
                for it in items[:10]
                if isinstance(it, dict)
            ]
            summary = "\n".join([
                f"📦 **{len(items)} dòng tồn kho** không có hoạt động mượn/di chuyển trong 90 ngày gần đây:",
                _limit_lines(lines, 10),
            ])

        else:
            summary = ""

    return {
        "summary": summary,
        "raw": raw,
        "sources": sources,
        "warnings": warnings,
        "retrieved_at": datetime.now(timezone.utc).isoformat(),
    }
