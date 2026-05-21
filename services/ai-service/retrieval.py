from __future__ import annotations

import asyncio
from datetime import datetime, timezone
import os
import re
from typing import Any

import httpx

from intent import (
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
    "/api/books": "Catalog Books",
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


async def retrieve_context(intent_info: dict, auth_header: str | None) -> dict:
    intent = intent_info.get("intent") or GENERAL_QUERY
    sources: list[dict] = []
    warnings: list[str] = []
    raw: dict[str, Any] = {}

    if intent == GENERAL_QUERY:
        return {
            "summary": "",
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
            stock = raw.get("Warehouse Stock Risk") or []
            lines = [f"- {book['title']} ({book['author'] or 'khong ro tac gia'}): con {book['quantity']} ban." for book in low_books]
            summary = "\n".join([
                f"Co {len(low_books)} sach trong nhom ton kho thap/het hang (quantity <= 10) trong 10 ket qua uu tien.",
                _limit_lines(lines, 10),
                f"Bao cao warehouse co {len(stock) if isinstance(stock, list) else 0} dong tong hop rui ro.",
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
            params = {"limit": 20, **_time_params(intent_info, default_30_days=True)}
            results = await asyncio.gather(
                _fetch(client, "/analytics/top-books", auth_header, params),
                _fetch(client, "/analytics/warehouse-stock-risk", auth_header),
                _fetch(client, "/api/books", auth_header),
            )
            for source, payload, warning in results:
                sources.append(source)
                if warning:
                    warnings.append(warning)
                if payload is not None:
                    raw[source["name"]] = _data(payload)

            top_books = _as_list(raw.get("Top Books"))
            books = [_compact_book(book) for book in _as_list(raw.get("Catalog Books"))]
            by_book_id = {str(book.get("id")): book for book in books if book.get("id")}
            by_title = {normalize_text(book.get("title", "")): book for book in books}
            suggestions = []
            for top in top_books:
                if not isinstance(top, dict):
                    continue
                book = by_book_id.get(str(top.get("book_id"))) or by_title.get(normalize_text(str(top.get("title") or "")))
                if not book:
                    continue
                quantity = _book_quantity(book)
                borrow_count = _int(top.get("borrow_count"))
                if quantity <= 5:
                    priority = "HIGH"
                    suggested_qty = max(5, borrow_count - quantity)
                elif quantity <= 10:
                    priority = "MEDIUM"
                    suggested_qty = 5 if borrow_count >= 5 else 3
                else:
                    continue
                suggestions.append({
                    "book_id": book.get("id"),
                    "title": book.get("title"),
                    "quantity": quantity,
                    "borrow_count": borrow_count,
                    "priority": priority,
                    "suggested_qty": suggested_qty,
                })

            raw["reorder_suggestions"] = suggestions[:10]
            lines = [
                f"- {row['title']}: {row['priority']}, con {row['quantity']} ban, {row['borrow_count']} luot muon/30 ngay, goi y nhap {row['suggested_qty']} ban."
                for row in suggestions[:10]
            ]
            summary = "\n".join([
                "Goi y nhap them la goi y ho tro, khong phai quyet dinh bat buoc.",
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
