from __future__ import annotations

from datetime import datetime, timedelta, timezone
import re
import unicodedata


DASHBOARD_SUMMARY_QUERY = "DASHBOARD_SUMMARY_QUERY"
LOW_STOCK_QUERY = "LOW_STOCK_QUERY"
TOP_BORROWED_BOOKS_QUERY = "TOP_BORROWED_BOOKS_QUERY"
OVERDUE_LOAN_QUERY = "OVERDUE_LOAN_QUERY"
FINE_SUMMARY_QUERY = "FINE_SUMMARY_QUERY"
BORROW_TREND_QUERY = "BORROW_TREND_QUERY"
RESERVATION_QUERY = "RESERVATION_QUERY"
BOOK_SEARCH_QUERY = "BOOK_SEARCH_QUERY"
REORDER_SUGGESTION_QUERY = "REORDER_SUGGESTION_QUERY"
GENERAL_QUERY = "GENERAL_QUERY"


def normalize_text(value: str) -> str:
    text = unicodedata.normalize("NFD", value or "")
    text = "".join(ch for ch in text if unicodedata.category(ch) != "Mn")
    return text.lower().strip()


def _contains_any(text: str, keywords: list[str]) -> bool:
    return any(keyword in text for keyword in keywords)


def _iso_date(value: datetime) -> str:
    return value.date().isoformat()


def _iso_datetime(value: datetime) -> str:
    return value.isoformat().replace("+00:00", "Z")


def _detect_time_range(normalized: str) -> dict | None:
    now = datetime.now(timezone.utc)

    if _contains_any(normalized, ["hom nay", "today"]):
        return {"from": _iso_date(now), "to": _iso_datetime(now)}

    if _contains_any(normalized, ["thang nay", "this month"]):
        start = now.replace(day=1)
        return {"from": _iso_date(start), "to": _iso_datetime(now)}

    if _contains_any(normalized, ["7 ngay", "7 day", "tuan qua", "1 tuan"]):
        return {"from": _iso_date(now - timedelta(days=7)), "to": _iso_datetime(now)}

    if _contains_any(normalized, ["30 ngay", "30 day", "gan day", "vua qua"]):
        return {"from": _iso_date(now - timedelta(days=30)), "to": _iso_datetime(now)}

    day_match = re.search(r"(\d{1,3})\s*(ngay|day|days)", normalized)
    if day_match:
        days = max(1, min(int(day_match.group(1)), 365))
        return {"from": _iso_date(now - timedelta(days=days)), "to": _iso_datetime(now)}

    month_match = re.search(r"(\d{1,2})\s*(thang|month|months)", normalized)
    if month_match:
        months = max(1, min(int(month_match.group(1)), 24))
        return {"from": _iso_date(now - timedelta(days=months * 30)), "to": _iso_datetime(now)}

    return None


def _extract_book_query(message: str, normalized: str) -> str:
    patterns = [
        r"co sach\s+(.+?)\s+(khong|ko|khong\?)",
        r"tim sach\s+(?:ve|cua tac gia|tac gia)?\s*(.+)",
        r"sach cua tac gia\s+(.+)",
        r"sach ve chu de\s+(.+)",
    ]

    for pattern in patterns:
        match = re.search(pattern, normalized)
        if match:
            value = match.group(1).strip(" ?.!")
            return value or message.strip()

    cleaned = re.sub(
        r"\b(co sach|tim sach|sach ve|sach cua|khong|ko|khong\?)\b",
        " ",
        normalized,
    )
    cleaned = re.sub(r"\s+", " ", cleaned).strip(" ?.!")
    return cleaned or message.strip()


def detect_intent(message: str) -> dict:
    normalized = normalize_text(message)
    time_range = _detect_time_range(normalized)
    granularity = "month" if _contains_any(normalized, ["theo thang", "hang thang", "6 thang", "month"]) else "day"

    # More specific intents must be checked before broader stock/search rules.
    if _contains_any(normalized, ["nhap them", "bo sung", "mua them", "reorder", "suggest reorder", "goi y nhap"]):
        return {
            "intent": REORDER_SUGGESTION_QUERY,
            "confidence": 0.9,
            "time_range": time_range or _detect_time_range("30 ngay"),
            "query": message.strip(),
        }

    if _contains_any(normalized, ["qua han", "chua tra", "tre han", "overdue"]):
        return {
            "intent": OVERDUE_LOAN_QUERY,
            "confidence": 0.92,
            "time_range": time_range,
            "query": message.strip(),
        }

    if _contains_any(normalized, ["tien phat", "phi phat", "phat chua thu", "tong phat", "khoan phat", "fine"]):
        return {
            "intent": FINE_SUMMARY_QUERY,
            "confidence": 0.9,
            "time_range": time_range,
            "query": message.strip(),
        }

    if _contains_any(normalized, ["top sach", "hot", "pho bien", "muon nhieu", "borrowed book", "popular"]):
        return {
            "intent": TOP_BORROWED_BOOKS_QUERY,
            "confidence": 0.9,
            "time_range": time_range or _detect_time_range("30 ngay"),
            "query": message.strip(),
        }

    if _contains_any(normalized, ["xu huong", "bieu do", "trend", "muon tra", "thang nay muon"]):
        return {
            "intent": BORROW_TREND_QUERY,
            "confidence": 0.86,
            "time_range": time_range or _detect_time_range("30 ngay"),
            "query": message.strip(),
            "granularity": granularity,
        }

    if _contains_any(normalized, ["dat cho", "reservation", "giu sach", "dat sach"]):
        return {
            "intent": RESERVATION_QUERY,
            "confidence": 0.86,
            "time_range": time_range,
            "query": message.strip(),
        }

    if _contains_any(normalized, ["sap het hang", "ton kho thap", "het hang", "rui ro ton kho", "low stock", "out of stock"]):
        return {
            "intent": LOW_STOCK_QUERY,
            "confidence": 0.9,
            "time_range": time_range,
            "query": message.strip(),
        }

    if _contains_any(normalized, ["ton kho", "inventory", "stock"]):
        return {
            "intent": LOW_STOCK_QUERY,
            "confidence": 0.78,
            "time_range": time_range,
            "query": message.strip(),
        }

    if _contains_any(normalized, ["dashboard", "tong quan", "tinh hinh thu vien", "tinh hinh he thong", "system summary"]):
        return {
            "intent": DASHBOARD_SUMMARY_QUERY,
            "confidence": 0.84,
            "time_range": time_range,
            "query": message.strip(),
        }

    if _contains_any(normalized, ["co sach", "tim sach", "sach ve", "tac gia", "isbn", "book"]):
        return {
            "intent": BOOK_SEARCH_QUERY,
            "confidence": 0.82,
            "time_range": time_range,
            "query": _extract_book_query(message, normalized),
        }

    return {
        "intent": GENERAL_QUERY,
        "confidence": 0.35,
        "time_range": time_range,
        "query": message.strip(),
    }
