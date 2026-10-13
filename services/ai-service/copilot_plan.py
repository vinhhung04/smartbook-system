"""Structured query planning for the management copilot (/assistant, /assistant/stream).

Turns one Vietnamese question - plus the structured state of the conversation
so far - into a QueryPlan: which data capabilities are needed, what kind of
answer is wanted (lookup / causal / comparison / decision / what-if / ranking),
the resolved entities (warehouses, periods, budget, limit), the read-only
tools to run with their arguments, and whether the right move is to ask back.

Deterministic and rule-based on purpose. The LLM still answers, and still may
call more tools in later rounds, but it never invents the tool list, endpoint,
or arguments for a question the rules already understood: every tool name a
plan emits is checked against PLANNABLE_TOOLS, and every argument is built
here from parsed values, never copied from model output.

Pure functions only - no I/O. The warehouse list (for resolving "kho HCM")
is passed in by the caller.
"""
from __future__ import annotations

import difflib
import re
from dataclasses import asdict, dataclass, field
from datetime import date, datetime, timedelta, timezone

from intent import normalize_text

VN_TZ = timezone(timedelta(hours=7))

# ── capabilities ─────────────────────────────────────────────────────────────

KPI = "kpi"
BORROW_TREND = "borrow_trend"
TOP_BORROWED = "top_borrowed"
OVERDUE = "overdue"
FINES = "fines"
RESERVATION = "reservation"
WAREHOUSE_RISK = "warehouse_risk"
LOW_STOCK_ITEMS = "low_stock_items"
REORDER = "reorder"
AGING = "aging"
WEEDING = "weeding"
BOOK_SEARCH = "book_search"
PRIORITY = "priority"

# Capabilities whose tools take a period / a warehouse - used to decide what a
# follow-up may inherit from the previous turn.
TIME_AWARE = {BORROW_TREND, TOP_BORROWED}
WAREHOUSE_AWARE = {WAREHOUSE_RISK, LOW_STOCK_ITEMS}

# Analysis types (requested_analysis).
LOOKUP, CAUSAL, COMPARISON, DECISION, WHAT_IF, RANKING = (
    "lookup", "causal", "comparison", "decision", "what_if", "ranking")
CLARIFICATION, OPEN = "clarification", "open"

# Every tool a plan may emit. Anything else is a bug, not a model choice.
PLANNABLE_TOOLS = frozenset({
    "get_dashboard_kpis", "get_borrow_trends", "get_top_books", "get_overdue_summary", "get_fine_summary",
    "get_warehouse_stock_risk", "get_reorder_suggestions", "get_reservation_funnel", "search_books",
    "get_aging_inventory", "get_weeding_suggestions",
    "get_warehouse_low_stock_items", "compare_warehouses", "explain_warehouse_shortage",
    "compare_borrow_periods", "compare_top_books", "analyze_demand_vs_stock", "simulate_reorder_budget",
    "explain_reorder_item", "rank_priority_tasks",
})

_SIMPLE_CAP_TOOL = {
    KPI: "get_dashboard_kpis",
    OVERDUE: "get_overdue_summary",
    FINES: "get_fine_summary",
    RESERVATION: "get_reservation_funnel",
    AGING: "get_aging_inventory",
    WEEDING: "get_weeding_suggestions",
}

# Keyword table, matched on normalize_query() output (accent-free, lowercase,
# abbreviations expanded, typos corrected). Plain strings are substring
# matches; compiled patterns are regex searches.
_R = re.compile
CAP_KEYWORDS: dict[str, list] = {
    KPI: ["kpi", "dashboard", "tong quan", "tinh hinh thu vien", "tinh hinh he thong", "thu vien minh",
          "so lieu chung", "dau sach trong thu vien", "tong so dau sach", "phieu muon dang mo", "dang mo",
          "tong so phieu muon", "thu vien dao nay", "can chu y"],
    BORROW_TREND: ["xu huong", "bieu do", "trend", "luot muon", "muon tra", "so luot", "thong ke muon",
                   "muon theo thang", "muon theo ngay", _R(r"\bmuon (nhieu|it) hon\b"), _R(r"\bmuon (giam|tang)\b")],
    TOP_BORROWED: [_R(r"\btop\b"), _R(r"\bhot\b"), "pho bien", _R(r"\bmuon nhieu(?! hon)"), "duoc muon nhieu",
                   "hut khach", "ban chay", "yeu thich nhat"],
    OVERDUE: ["qua han", "tre han", "tra tre", "tra sach tre", "chua tra", "overdue"],
    FINES: ["tien phat", "phi phat", "khoan phat", "phat chua thu", "thu phat", "tong phat", "no phat",
            "phat qua han", "phat mat sach", "loai phat", _R(r"\bfines?\b")],
    RESERVATION: ["dat cho", "dat sach", "giu sach", "reservation", "phieu dat", "chuyen doi dat", "dang cho lay",
                  "pickup", "cho lay sach"],
    WAREHOUSE_RISK: ["rui ro", "sap het", "het hang", "het sach", "ton kho thap", "ton thap", "ton it",
                     "thieu sach", "thieu hang", "duoi nguong", "nguong ton", "canh bao ton", "low stock",
                     "out of stock", "con nhieu sach hon", "con it sach", _R(r"\bkho nao\b"),
                     _R(r"\b(cac|tung|moi) kho\b")],
    REORDER: ["nhap them", "nhap gi", "nen nhap", "nhap sach", "nhap hang", "bo sung", "de xuat nhap",
              "goi y nhap", "mua them", "reorder", "can nhap", "ngan sach", "dat mua", "nhap bao nhieu",
              "luong nhap", "de xuat nhap", "nhap uu tien"],
    AGING: ["ton lau", "ton kho lau", "khong ai muon", "lau khong ai", "e ton", _R(r"\bsach e\b"), "hang chet",
            "dead stock", "nam kho", "khong ai dung", "khong hoat dong"],
    WEEDING: ["thanh ly", "chon von", "chuyen kho", "dieu chuyen", "weeding"],
    BOOK_SEARCH: [_R(r"\bco sach (?!nao)\S.* (khong|ko)\b"), "tim sach", "sach cua tac gia", "tac gia", "isbn", "sach ve chu de"],
    PRIORITY: ["uu tien xu ly", "viec gi", "thu tu uu tien", "uu tien cong viec", "nen lam gi truoc",
               "viec can lam", "cong viec tuan nay", "cong viec hom nay"],
}

_ANALYSIS_PATTERNS: list[tuple[str, re.Pattern]] = [
    (CAUSAL, _R(r"\b(tai sao|vi sao|nguyen nhan|ly do|do dau|vi dau)\b")),
    (WHAT_IF, _R(r"\b(neu|gia su|gia dinh|what if)\b|\b(cat|giam|tang|bot)\s*(ngan sach\s*)?\d{1,3}\s*%|so sanh ngan sach")),
    (COMPARISON, _R(r"\b(so sanh|so voi|vs|khac gi|chenh lech)\b|\b(nhieu|it|cao|thap|tot|rui ro|lon|nho) hon\b")),
    (RANKING, _R(r"\bxep hang\b|\bkho nao\b.*\bnhat\b|\bthu tu uu tien\b|\buu tien xu ly\b")),
    (DECISION, _R(r"\b(nen|co nen|de xuat|goi y|lam gi de|uu tien|chon)\b")),
]

# ── normalization: abbreviations, teen code, typos ──────────────────────────

_TOKEN_EXPANSIONS = {
    "ko": "khong", "k": "khong", "kg": "khong", "khg": "khong", "hok": "khong", "hong": "khong", "kh": "khong",
    "dc": "duoc", "dk": "duoc", "bn": "bao nhieu", "bnh": "bao nhieu", "sl": "so luong", "tk": "ton kho",
    "ds": "danh sach", "j": "gi", "z": "vay", "r": "roi", "ntn": "nhu the nao", "tn": "the nao",
    "sao r": "sao roi", "ns": "ngan sach", "nsach": "ngan sach", "tl": "thanh ly", "sp": "san pham",
    "hn": "ha noi", "hni": "ha noi", "sg": "hcm", "tphcm": "hcm", "dashbord": "dashboard",
}
_PHRASE_EXPANSIONS = [
    (_R(r"\btp\.? ?hcm\b"), "hcm"), (_R(r"\bsai gon\b"), "hcm"), (_R(r"\bho chi minh\b"), "hcm"),
    (_R(r"\btonkho\b"), "ton kho"), (_R(r"\bquahan\b"), "qua han"), (_R(r"\btienphat\b"), "tien phat"),
    (_R(r"\bnhapthem\b"), "nhap them"),
]
# English / domain words that must never be "corrected" into Vietnamese.
_PROTECTED = {
    "top", "hot", "kpi", "dashboard", "trend", "stock", "low", "out", "of", "fine", "fines", "reorder",
    "isbn", "api", "sql", "select", "from", "where", "json", "system", "prompt", "ignore", "previous",
    "instructions", "call", "the", "tool", "tell", "me", "a", "joke", "vs", "ok", "pickup", "dead",
    "weeding", "reservation", "overdue", "inventory", "what", "if", "users", "role", "admin", "drop", "table",
}
_ENGLISH_VOCAB = ["dashboard", "reorder", "inventory", "overdue", "reservation", "weeding", "pickup"]


def _build_vocab() -> set[str]:
    vocab: set[str] = set()
    for keywords in CAP_KEYWORDS.values():
        for kw in keywords:
            if isinstance(kw, str):
                vocab.update(kw.split())
    vocab.update("kho sach muon tra phat han nhap ton thap het thieu nao nhieu bao nhieu cuon dau qua"
                 " phieu tien dat cho giu xu huong thang tuan nam ngay quy hom nay truoc nay".split())
    return vocab


_VOCAB = _build_vocab()


def _correct_token(token: str) -> str:
    if token in _PROTECTED or token in _VOCAB or not token.isalpha():
        return token
    # Teen code: "f" for "ph" ("fat" -> "phat").
    if token.startswith("f") and ("ph" + token[1:]) in _VOCAB:
        return "ph" + token[1:]
    # Letters Vietnamese does not use, inserted by a slip ("hjan" -> "han").
    stripped = re.sub(r"[fjwz]", "", token)
    if stripped != token and stripped in _VOCAB:
        return stripped
    # Doubled letters ("khoo" -> "kho").
    collapsed = re.sub(r"(.)\1+", r"\1", token)
    if collapsed != token and collapsed in _VOCAB:
        return collapsed
    if len(token) >= 6:
        match = difflib.get_close_matches(token, _ENGLISH_VOCAB, n=1, cutoff=0.8)
        if match:
            return match[0]
    return token


def normalize_query(message: str) -> str:
    """normalize_text() plus abbreviation/teen-code expansion and conservative
    typo repair: a token is only rewritten when the rewrite lands on a word the
    domain vocabulary actually uses, so real words are never "fixed"."""
    text = normalize_text(message)
    text = re.sub(r"[^\w%./,:;\-\s?]", " ", text)
    for pattern, repl in _PHRASE_EXPANSIONS:
        text = pattern.sub(repl, text)
    # Decimal/grouped numbers ("1,5 tỷ", "10.000.000") stay one token.
    tokens = re.findall(r"\d+(?:[.,]\d+)+|[\w%]+|[.,;:?/\-]", text)
    out = []
    for token in tokens:
        if token in _TOKEN_EXPANSIONS:
            out.append(_TOKEN_EXPANSIONS[token])
        else:
            out.append(_correct_token(token))
    text = " ".join(out)
    text = re.sub(r"\s+([.,;:?])", r"\1", text)
    return re.sub(r"\s+", " ", text).strip()


def _matches(text: str, keyword) -> bool:
    if isinstance(keyword, str):
        return keyword in text
    return bool(keyword.search(text))


def detect_capabilities(text: str) -> list[str]:
    """All capabilities a normalized question touches, in table order."""
    # "phạt quá hạn" is a fine type, not a question about overdue loans.
    scan = re.sub(r"\bphat qua han\b", "phat loai tre", text)
    return [cap for cap, keywords in CAP_KEYWORDS.items() if any(_matches(scan, kw) for kw in keywords)]


def detect_analysis(text: str) -> str:
    for analysis, pattern in _ANALYSIS_PATTERNS:
        if pattern.search(text):
            return analysis
    return LOOKUP


# ── time periods ─────────────────────────────────────────────────────────────

@dataclass
class Period:
    token: str
    start: str  # ISO date
    end: str    # ISO date, inclusive
    label: str

    def dates(self) -> tuple[date, date]:
        return date.fromisoformat(self.start), date.fromisoformat(self.end)


def _period(token: str, start: date, end: date, label: str) -> Period:
    return Period(token, start.isoformat(), end.isoformat(), label)


def _month(year: int, month: int) -> tuple[date, date]:
    start = date(year, month, 1)
    nxt = date(year + (month == 12), month % 12 + 1, 1)
    return start, nxt - timedelta(days=1)


def _quarter_start(d: date) -> date:
    return date(d.year, 3 * ((d.month - 1) // 3) + 1, 1)


def previous_period(p: Period) -> Period:
    """The comparison period a single-period comparison implies."""
    start, end = p.dates()
    if p.token == "this_month" or p.token.startswith("month:") or p.token == "last_month":
        prev_end = start - timedelta(days=1)
        s, e = _month(prev_end.year, prev_end.month)
        return _period(f"month:{s.month}:{s.year}", s, e, f"tháng {s.month}/{s.year}")
    if p.token in ("this_week", "last_week"):
        s = start - timedelta(days=7)
        return _period("prev_week", s, s + timedelta(days=6), "tuần trước đó" if p.token == "last_week" else "tuần trước")
    if p.token in ("this_quarter", "last_quarter"):
        prev_end = start - timedelta(days=1)
        s = _quarter_start(prev_end)
        return _period("prev_quarter", s, prev_end, "quý trước")
    if p.token in ("this_year", "last_year"):
        return _period("prev_year", date(start.year - 1, 1, 1), date(start.year - 1, 12, 31), f"năm {start.year - 1}")
    length = (end - start).days
    return _period(f"prev_{p.token}", start - timedelta(days=length), start, f"{length} ngày trước đó")


def parse_periods(text: str, today: date) -> list[Period]:
    """Every period mentioned, in order of appearance (VN calendar)."""
    found: list[tuple[int, Period]] = []

    def add(match: re.Match, period: Period) -> None:
        found.append((match.start(), period))

    for m in re.finditer(r"\bhom nay\b", text):
        add(m, _period("today", today, today, "hôm nay"))
    for m in re.finditer(r"\bhom qua\b", text):
        d = today - timedelta(days=1)
        add(m, _period("yesterday", d, d, "hôm qua"))
    for m in re.finditer(r"\btuan nay\b", text):
        add(m, _period("this_week", today - timedelta(days=today.weekday()), today, "tuần này"))
    for m in re.finditer(r"\btuan (truoc|roi|vua roi)\b", text):
        s = today - timedelta(days=today.weekday() + 7)
        add(m, _period("last_week", s, s + timedelta(days=6), "tuần trước"))
    for m in re.finditer(r"\bthang nay\b", text):
        add(m, _period("this_month", today.replace(day=1), today, f"tháng {today.month}/{today.year} (đến hôm nay)"))
    for m in re.finditer(r"\bthang (truoc|roi|vua roi)\b", text):
        prev = today.replace(day=1) - timedelta(days=1)
        s, e = _month(prev.year, prev.month)
        add(m, _period("last_month", s, e, f"tháng {s.month}/{s.year}"))
    # "tháng 9" is a month; "6 tháng gần đây" / "theo tháng 6 tháng" is a window.
    for m in re.finditer(r"\bthang (\d{1,2})(?:\s*(?:nam|/)\s*(\d{4}))?\b(?! (thang|tuan|ngay)\b)", text):
        month = int(m.group(1))
        if not 1 <= month <= 12:
            continue
        year = int(m.group(2)) if m.group(2) else (today.year if month <= today.month else today.year - 1)
        s, e = _month(year, month)
        e = min(e, today)
        add(m, _period(f"month:{month}", s, e, f"tháng {month}/{year}"))
    for m in re.finditer(r"\bquy nay\b", text):
        add(m, _period("this_quarter", _quarter_start(today), today, "quý này"))
    for m in re.finditer(r"\bquy (truoc|roi)\b", text):
        prev_end = _quarter_start(today) - timedelta(days=1)
        add(m, _period("last_quarter", _quarter_start(prev_end), prev_end, "quý trước"))
    for m in re.finditer(r"\bnam nay\b", text):
        add(m, _period("this_year", date(today.year, 1, 1), today, f"năm {today.year}"))
    for m in re.finditer(r"\bnam (ngoai|truoc|roi)\b", text):
        add(m, _period("last_year", date(today.year - 1, 1, 1), date(today.year - 1, 12, 31), f"năm {today.year - 1}"))
    previous_window: Period | None = None
    for m in re.finditer(r"\b(\d{1,3}) ngay( truoc do| qua| gan day| vua qua| gan nhat)?\b", text):
        days = max(1, min(int(m.group(1)), 365))
        if (m.group(2) or "").strip() == "truoc do":
            base_start = (date.fromisoformat(previous_window.start) if previous_window else today - timedelta(days=days))
            p = _period(f"prev_{days}_days", base_start - timedelta(days=days), base_start, f"{days} ngày trước đó")
        else:
            p = _period(f"last_{days}_days", today - timedelta(days=days), today, f"{days} ngày qua")
            previous_window = p
        add(m, p)
    for m in re.finditer(r"\b(\d{1,2}) tuan (qua|gan day|gan nhat)\b", text):
        weeks = int(m.group(1))
        add(m, _period(f"last_{weeks}_weeks", today - timedelta(days=7 * weeks), today, f"{weeks} tuần qua"))
    for m in re.finditer(r"\b(\d{1,2}) thang (qua|gan day|gan nhat)\b", text):
        months = int(m.group(1))
        add(m, _period(f"last_{months}_months", today - timedelta(days=30 * months), today, f"{months} tháng qua"))
    found.sort(key=lambda item: item[0])
    seen, periods = set(), []
    for _pos, p in found:
        key = (p.start, p.end)
        if key not in seen:
            seen.add(key)
            periods.append(p)
    return periods


def period_args(p: Period, now: datetime, prefix: str = "") -> dict:
    """from/to tool arguments covering whole VN days (the analytics service
    compares timestamps, so a bare end date would drop that whole day)."""
    start, end = p.dates()
    today = now.astimezone(VN_TZ).date()
    to_value = now.astimezone(VN_TZ).isoformat(timespec="seconds") if end >= today else f"{end.isoformat()}T23:59:59+07:00"
    return {f"{prefix}from_date": f"{start.isoformat()}T00:00:00+07:00", f"{prefix}to_date": to_value}


# ── numbers: budget, limit, lead time ───────────────────────────────────────

def _num(text: str) -> float:
    return float(text.replace(",", "."))


def parse_budgets(text: str) -> list[float]:
    budgets: list[tuple[int, float]] = []
    for m in re.finditer(r"(\d+(?:[.,]\d+)?)\s*(ty|ti)\b", text):
        budgets.append((m.start(), _num(m.group(1)) * 1e9))
    for m in re.finditer(r"(\d+(?:[.,]\d+)?)\s*(trieu|tr|cu)\b", text):
        budgets.append((m.start(), _num(m.group(1)) * 1e6))
    for m in re.finditer(r"(\d+(?:[.,]\d+)?)\s*(nghin|ngan|k)\b", text):
        budgets.append((m.start(), _num(m.group(1)) * 1e3))
    if re.search(r"ngan sach|tien|chi phi|von|dong|vnd", text):
        for m in re.finditer(r"\b(\d{1,3}(?:[.,]\d{3}){2,}|\d{6,})\s*(d|dong|vnd)?\b", text):
            budgets.append((m.start(), float(re.sub(r"[.,]", "", m.group(1)))))
    budgets.sort()
    out: list[float] = []
    for _pos, value in budgets:
        if value > 0 and value not in out:
            out.append(round(value))
    return out


def parse_budget_change_pct(text: str) -> float | None:
    m = re.search(r"\b(cat|giam|bot|tang|them)\s*(?:ngan sach\s*(?:nhap\s*(?:hang\s*)?)?)?(\d{1,3})\s*%", text)
    if not m:
        m = re.search(r"(\d{1,3})\s*%\s*(?:ngan sach)?.*?\b(cat|giam|bot|tang)\b", text)
        if not m:
            return None
        pct, verb = float(m.group(1)), m.group(2)
    else:
        verb, pct = m.group(1), float(m.group(2))
    return -pct if verb in ("cat", "giam", "bot") else pct


def parse_limit(text: str) -> int | None:
    for pattern in (r"\btop\s*(\d{1,2})\b", r"\bchi lay\s*(\d{1,2})\b",
                    r"\b(\d{1,2})\s*(?:dau sach|cuon|quyen|sach|muc)\b"):
        m = re.search(pattern, text)
        if m and 0 < int(m.group(1)) <= 50:
            return int(m.group(1))
    return None


def parse_lead_time(text: str) -> int | None:
    m = re.search(r"(thoi gian (cho|giao) hang|lead ?time)\D{0,12}(\d{1,3})\s*ngay", text)
    return int(m.group(3)) if m else None


def parse_priority(text: str) -> str | None:
    if re.search(r"uu tien cao|muc cao|gap nhat|khan cap", text):
        return "HIGH"
    if "uu tien trung binh" in text:
        return "MEDIUM"
    if "uu tien thap" in text:
        return "LOW"
    return None


def parse_threshold_days(text: str) -> int | None:
    m = re.search(r"\b(?:tren|hon|qua|lau hon)?\s*(\d{2,3})\s*ngay\b", text)
    return int(m.group(1)) if m else None


# ── warehouses ───────────────────────────────────────────────────────────────

_DEICTIC_WAREHOUSE = _R(r"\bkho (nay|do|kia|ay|vua roi|tren)\b|\bhai kho\b|\b2 kho\b")
_DEICTIC_BOOK = _R(r"\b(cuon|quyen|sach|dau sach|tua) (do|nay|kia|ay|vua roi|tren)\b")
_DEICTIC_GENERIC = _R(r"\bcai (do|kia|nay|ay)\b")
# "cuốn đầu tiên" points at one item; "3 cuốn đầu" is a limit, not a reference.
_ORDINAL_BOOK = _R(r"(?<!\d )\b(cuon|quyen|sach|dau sach)\s*(dau tien|thu nhat|so 1|thu (\d|hai|ba))\b")
# Personal data the copilot never hands out, whatever the role.
_SENSITIVE = _R(r"so dien thoai|\bsdt\b|dia chi nha|\bemail\b|\bcccd\b|\bcmnd\b|mat khau|password|"
                r"so tai khoan|the tin dung")
_ALL_WAREHOUSES = _R(r"\b(tat ca|cac|tung|moi|nhung|toan bo) kho\b|\bkho nao\b")


def _wh_norm(text: str) -> str:
    return re.sub(r"[-_.\s]+", " ", normalize_query(text or "")).strip()


def _word_in(needle: str, haystack: str) -> int:
    m = re.search(rf"(?<!\w){re.escape(needle)}(?!\w)", haystack)
    return m.start() if m else -1


def resolve_warehouses(text: str, warehouses: list[dict]) -> dict:
    """Warehouses named in a normalized question, in order of mention.

    Exact names/codes first ("kho ha noi", "wh hn 01"); then "kho X" where X
    starts exactly one warehouse's name ("kho hcm" -> "Kho HCM Chinh", recorded
    as an assumption because other branches are in the same city). Several
    candidates for one hint -> `ambiguous`, which becomes a clarifying
    question instead of a guess."""
    resolved: list[tuple[int, dict]] = []
    assumptions: list[str] = []
    ambiguous: list[dict] = []
    taken: set[str] = set()
    covered: list[tuple[int, int]] = []

    aliases: list[tuple[str, dict]] = []
    for w in warehouses:
        name, code = _wh_norm(w.get("name", "")), _wh_norm(w.get("code", ""))
        for alias in {name, code}:
            if alias:
                aliases.append((alias, w))
        for prefix in ("kho ", "chi nhanh "):
            if name.startswith(prefix) and len(name) - len(prefix) >= 4:
                aliases.append((name[len(prefix):], w))
    aliases.sort(key=lambda item: -len(item[0]))
    for alias, w in aliases:
        pos = _word_in(alias, text)
        if pos < 0 or w["id"] in taken or any(s <= pos < e for s, e in covered):
            continue
        taken.add(w["id"])
        covered.append((pos, pos + len(alias)))
        resolved.append((pos, w))

    for m in re.finditer(r"\bkho ([a-z0-9]+(?: [a-z0-9]+)?)", text):
        if any(s <= m.start() < e for s, e in covered):
            continue
        hint_words = m.group(1).split()
        hint = hint_words[0]
        if hint in {"nay", "do", "kia", "ay", "nao", "thap", "cao", "lau", "hang", "sach", "va", "voi", "vs", "thi",
                    "co", "dang", "con", "it", "nhieu", "rui", "can", "duoc", "khong", "toan", "tren", "vua"}:
            continue
        candidates = [w for w in warehouses
                      if any(a.startswith(hint) or f" {hint}" in f" {a}" for a in (_wh_norm(w.get("name", "")),))
                      and w["id"] not in taken]
        if len(candidates) == 1:
            w = candidates[0]
            taken.add(w["id"])
            covered.append((m.start(), m.end()))
            resolved.append((m.start(), w))
            others = [x for x in warehouses if x is not w and hint in _wh_norm(x.get("code", ""))]
            note = f"Đã hiểu \"kho {hint.upper() if len(hint) <= 3 else hint}\" là {w.get('name')}"
            if others:
                note += f" (còn {len(others)} kho/chi nhánh khác có mã chứa \"{hint.upper()}\")"
            assumptions.append(note)
        elif len(candidates) > 1:
            ambiguous = candidates
    resolved.sort(key=lambda item: item[0])
    return {
        "warehouses": [{"id": w["id"], "name": w.get("name"), "code": w.get("code")} for _p, w in resolved],
        "ambiguous": [{"id": w["id"], "name": w.get("name"), "code": w.get("code")} for w in ambiguous],
        "assumptions": assumptions,
    }


# ── plan ─────────────────────────────────────────────────────────────────────

@dataclass
class QueryPlan:
    intent: str
    secondary_intents: list[str] = field(default_factory=list)
    requested_analysis: str = LOOKUP
    entities: dict = field(default_factory=dict)
    filters: dict = field(default_factory=dict)
    time_range: dict | None = None
    comparison_period: dict | None = None
    required_tools: list[dict] = field(default_factory=list)
    clarification_needed: bool = False
    clarification_question: str | None = None
    clarification_options: list[str] = field(default_factory=list)
    is_followup: bool = False
    carried_over: list[str] = field(default_factory=list)
    assumptions: list[str] = field(default_factory=list)
    capabilities: list[str] = field(default_factory=list)
    normalized: str = ""

    def to_dict(self) -> dict:
        return asdict(self)

    def public(self) -> dict:
        """What the API response carries (no internal normalized text)."""
        data = self.to_dict()
        data.pop("normalized", None)
        return data


_FOLLOWUP_START = _R(r"^(the|con|vay|the con|the thi|vay thi|thi|so voi|neu|trong so do|chi lay|chi|chi tiet|"
                     r"tai sao|vi sao|ly do|gio|bay gio|cung|vay con|con neu)\b")
_ACTION_SURFACE = _R(r"\b(tao|lap|giao viec|tao task|tao phieu|lap phieu|dat giup|giu giup|xuat bao cao|"
                     r"tao canh bao|nhac nho kho)\b")
_CAP_PRIMARY_INTENT = {
    KPI: "DASHBOARD_SUMMARY_QUERY", BORROW_TREND: "BORROW_TREND_QUERY", TOP_BORROWED: "TOP_BORROWED_BOOKS_QUERY",
    OVERDUE: "OVERDUE_LOAN_QUERY", FINES: "FINE_SUMMARY_QUERY", RESERVATION: "RESERVATION_QUERY",
    WAREHOUSE_RISK: "LOW_STOCK_QUERY", LOW_STOCK_ITEMS: "LOW_STOCK_QUERY", REORDER: "REORDER_SUGGESTION_QUERY",
    AGING: "AGING_INVENTORY_QUERY", WEEDING: "AGING_INVENTORY_QUERY", BOOK_SEARCH: "BOOK_SEARCH_QUERY",
    PRIORITY: "DASHBOARD_SUMMARY_QUERY",
}


def _intent_of(caps: list[str]) -> tuple[str, list[str]]:
    intents: list[str] = []
    for cap in caps:
        name = _CAP_PRIMARY_INTENT.get(cap)
        if name and name not in intents:
            intents.append(name)
    if not intents:
        return "GENERAL_QUERY", []
    return intents[0], intents[1:]


def _warehouse_names(warehouses: list[dict]) -> str:
    return ", ".join(w.get("name") or w.get("code") or "?" for w in warehouses)


def _book_title_in(text: str, original: str) -> str | None:
    """A book title quoted or named after "cuốn/quyển/sách" in the ORIGINAL
    message (accents kept, so catalog matching stays exact)."""
    m = re.search(r"[\"“'‘]([^\"”'’]{2,80})[\"”'’]", original)
    if m:
        return m.group(1).strip()
    m = re.search(r"(?:cuốn|quyển|sách|tựa)\s+([A-ZÀ-Ỹ0-9][^?,.;!]{1,80}?)(?:\s+(?:không|còn|được|có|thì|nên|bao)\b|[?,.;!]|$)",
                  original)
    if m and not re.match(r"(nào|đó|này|kia|ấy|đầu)\b", m.group(1).strip().lower()):
        return m.group(1).strip()
    m = re.search(r"(?:tại sao|vì sao|nên nhập bao nhiêu cuốn|nhập bao nhiêu)\s+([A-ZÀ-Ỹ][^?,.;!]{1,80}?)\s+(?:được|lại|có|bị|\?|$)",
                  original, re.IGNORECASE)
    if m and m.group(1)[0].isupper():
        return m.group(1).strip()
    return None


def build_plan(message: str, state: dict | None, warehouses: list[dict] | None, now: datetime | None = None) -> QueryPlan:
    """The deterministic plan for one turn. `state` is the previous turn's
    conversation state (see next_state), `warehouses` the active warehouse list
    visible to this user (may be empty - then warehouse names stay unresolved
    and the plan falls back to all-warehouse tools)."""
    now = (now or datetime.now(VN_TZ)).astimezone(VN_TZ)
    today = now.date()
    state = state or {}
    warehouses = warehouses or []
    text = normalize_query(message)
    words = text.replace("?", " ").split()

    caps = detect_capabilities(text)
    analysis = detect_analysis(text)
    periods = parse_periods(text, today)
    budgets = parse_budgets(text)
    budget_pct = parse_budget_change_pct(text)
    limit = parse_limit(text)
    lead_time = parse_lead_time(text)
    priority = parse_priority(text)
    wh = resolve_warehouses(text, warehouses)
    named_warehouses = wh["warehouses"]
    assumptions = list(wh["assumptions"])
    carried: list[str] = []
    deictic_warehouse = bool(_DEICTIC_WAREHOUSE.search(text))
    deictic_book = bool(_DEICTIC_BOOK.search(text))
    deictic_generic = bool(_DEICTIC_GENERIC.search(text))
    sensitive = bool(_SENSITIVE.search(text))
    ordinal_book = _ORDINAL_BOOK.search(text)
    book_title = _book_title_in(text, message)

    if lead_time is not None:
        periods = [p for p in periods if not p.token.startswith("last_") or str(lead_time) not in p.token]
    if budgets or budget_pct is not None or lead_time is not None:
        if REORDER not in caps:
            caps.append(REORDER)
    if analysis == WHAT_IF and not caps and "ngan sach" in text:
        caps.append(REORDER)
    if named_warehouses and not caps and re.search(r"\b(kho|chi nhanh|chuyen sach|ton)\b", text):
        # "Có nên chuyển sách từ kho A sang kho B?" names warehouses but no metric.
        # A bare city ("Thời tiết Hà Nội") is not a warehouse question.
        caps.append(WAREHOUSE_RISK)
    if named_warehouses and not re.search(r"\b(kho|chi nhanh|wh|br)\b", text) and not set(caps) & WAREHOUSE_AWARE:
        named_warehouses = []
    if PRIORITY in caps:
        analysis = RANKING if analysis in (LOOKUP, DECISION) else analysis

    plan = QueryPlan(intent="GENERAL_QUERY", requested_analysis=analysis, normalized=text)

    # ── follow-up resolution ────────────────────────────────────────────────
    has_state = bool(state.get("capabilities"))
    looks_followup = bool(_FOLLOWUP_START.search(text)) and len(words) <= 10
    entity_only = not caps and bool(periods or named_warehouses or budgets or limit or budget_pct is not None)
    referential = deictic_warehouse or deictic_book or deictic_generic or bool(ordinal_book) or "trong so do" in text
    bare_why = text.strip(" ?") in ("tai sao", "vi sao", "ly do", "tai sao vay", "vi sao vay", "sao vay")
    is_followup = has_state and (looks_followup or entity_only or referential or bare_why
                                 or (not caps and analysis in (CAUSAL, COMPARISON, WHAT_IF, DECISION)))
    plan.is_followup = is_followup

    if is_followup and not caps:
        caps = list(state.get("capabilities") or [])
        carried.append("capabilities")
        if limit is None and state.get("limit") and not budgets:
            limit = state["limit"]
            carried.append("limit")
        if analysis == LOOKUP and state.get("analysis") in (DECISION, WHAT_IF, RANKING) and (budgets or limit):
            analysis = state["analysis"]
    if is_followup and REORDER in caps and REORDER in (state.get("capabilities") or []):
        if budgets and state.get("budgets") and not budget_pct:
            budgets = budgets + [b for b in state["budgets"] if b not in budgets][:1]
            carried.append("budget_vnd(phương án trước)")
        if priority is None and state.get("priority"):
            priority = state["priority"]
            carried.append("priority")
        if limit is None and state.get("limit") and not budgets:
            limit = state["limit"]
            carried.append("limit")

    if is_followup and analysis == LOOKUP and state.get("analysis") in (DECISION, WHAT_IF) and (budgets or limit):
        analysis = WHAT_IF if budgets else state["analysis"]
    if is_followup and (set(caps) & WAREHOUSE_AWARE or (REORDER in caps and deictic_warehouse)):
        if not named_warehouses and state.get("warehouses") and (deictic_warehouse or bare_why or entity_only
                                                                 or analysis in (CAUSAL, COMPARISON)
                                                                 or not set(caps) - WAREHOUSE_AWARE - {REORDER}):
            named_warehouses = list(state["warehouses"])
            carried.append("warehouses")

    if is_followup and set(caps) & TIME_AWARE:
        prior = state.get("time_range")
        if analysis == COMPARISON and len(periods) == 1 and prior and _R(r"\bso voi\b").search(text):
            periods = [Period(**prior), periods[0]]
            carried.append("time_range")
        elif not periods and prior:
            periods = [Period(**prior)]
            carried.append("time_range")
            if state.get("comparison_period") and analysis in (COMPARISON, CAUSAL):
                periods.append(Period(**state["comparison_period"]))
    if is_followup and analysis == LOOKUP and bare_why:
        analysis = CAUSAL
    focus_item = None
    if ordinal_book and state.get("last_items"):
        index = 0
        word = ordinal_book.group(2)
        ordinals = {"thu hai": 1, "thu 2": 1, "thu ba": 2, "thu 3": 2}
        index = ordinals.get(word, 0)
        items = state["last_items"]
        if index < len(items):
            focus_item = items[index]
            carried.append("focus_item")
    elif (deictic_book or "trong so do" in text) and state.get("last_items"):
        carried.append("last_items")

    # ── clarification ───────────────────────────────────────────────────────
    question: str | None = None
    options: list[str] = []
    if wh["ambiguous"] and not named_warehouses:
        question = (f"Có nhiều kho khớp với tên bạn nêu: {_warehouse_names(wh['ambiguous'])}. "
                    "Bạn muốn xem kho nào?")
        options = [w["name"] for w in wh["ambiguous"]]
    elif deictic_warehouse and not named_warehouses:
        if "hai kho" in text or "2 kho" in text:
            question = "Bạn muốn so sánh hai kho nào?"
            if len(warehouses) >= 2:
                question += f" Các kho hiện có: {_warehouse_names(warehouses)}."
                options = [f"So sánh {warehouses[0]['name']} và {warehouses[1]['name']}"]
        else:
            question = "Bạn đang hỏi về kho nào?"
            if warehouses:
                question += f" Các kho hiện có: {_warehouse_names(warehouses)}."
                options = [re.sub(r"(?i)kho (này|đó|kia|ấy)", w["name"], message.strip()) for w in warehouses[:4]]
    elif (deictic_book or ordinal_book) and not focus_item and not state.get("last_items") and not book_title \
            and REORDER not in (state.get("capabilities") or []):
        question = "Bạn đang hỏi về cuốn sách nào? Hãy cho tôi biết tên sách hoặc ISBN."
    elif text.strip(" ?.") in ("kho nao", "sach nao", "cuon nao", "cai nao", "nao") and not has_state:
        question = ("Bạn muốn hỏi kho/sách nào, và về nội dung gì? Ví dụ: kho nào đang rủi ro thiếu sách nhất, "
                    "hoặc sách nào cần nhập thêm.")
        options = ["Kho nào đang rủi ro thiếu sách nhất?", "Tôi nên nhập sách nào trước?"]
    elif not caps and not has_state and (looks_followup or referential or analysis in (COMPARISON, CAUSAL)
                                         or re.fullmatch(r"(phan tich|kiem tra|xem|bao cao)( giup| cho)?( toi| minh)?",
                                                         text.strip(" ?.")) or text.strip(" ?") in ("kho nao",)):
        if analysis == COMPARISON or "ky truoc" in text:
            question = ("Bạn muốn so sánh chỉ số nào với kỳ trước? Ví dụ: lượt mượn, top sách được mượn, "
                        "hay tình hình quá hạn.")
            options = ["Lượt mượn tháng này so với tháng trước", "Top sách tháng này khác gì tháng trước"]
        else:
            question = ("Bạn muốn tôi phân tích nội dung nào? Ví dụ: tồn kho và rủi ro thiếu sách, nhu cầu mượn, "
                        "quá hạn và phí phạt, hoặc đề xuất nhập hàng.")
            options = ["Kho nào đang rủi ro thiếu sách nhất?", "Sách nào được mượn nhiều nhưng tồn kho thấp?",
                       "Tôi nên nhập sách nào trước?", "Nên ưu tiên xử lý việc gì hôm nay?"]
    elif COMPARISON == analysis and "kho" in text and len(named_warehouses) == 1 and not _ALL_WAREHOUSES.search(text) \
            and set(caps) <= WAREHOUSE_AWARE | {REORDER} and not is_followup:
        question = f"Bạn muốn so sánh {named_warehouses[0]['name']} với kho nào?"
        options = [f"So sánh {named_warehouses[0]['name']} và {w['name']}" for w in warehouses
                   if w["id"] != named_warehouses[0]["id"]][:3]
    if question:
        plan.clarification_needed = True
        plan.clarification_question = question
        plan.clarification_options = options
        plan.requested_analysis = CLARIFICATION
        plan.capabilities = caps
        plan.intent, plan.secondary_intents = _intent_of(caps)
        plan.carried_over = carried
        plan.assumptions = assumptions
        return plan

    # ── tools ───────────────────────────────────────────────────────────────
    current = periods[0] if periods else None
    comparison = periods[1] if len(periods) > 1 else None
    if analysis in (COMPARISON, CAUSAL) and current and not comparison and set(caps) & TIME_AWARE \
            and (analysis == COMPARISON or re.search(r"\b(giam|tang)\b", text)):
        comparison = previous_period(current)
        assumptions.append(f"So sánh {current.label} với {comparison.label}")

    tools: list[dict] = []

    def add(name: str, args: dict | None = None) -> None:
        assert name in PLANNABLE_TOOLS, name
        call = {"name": name, "args": dict(args or {})}
        if call not in tools:
            tools.append(call)

    action_surface = bool(_ACTION_SURFACE.search(text))
    capset = set(caps)
    if PRIORITY in capset:
        add("rank_priority_tasks")
        capset -= {PRIORITY, KPI}
    if TOP_BORROWED in capset and (REORDER in capset or WAREHOUSE_RISK in capset) and not named_warehouses \
            and not comparison:
        args = {"limit": limit} if limit else {}
        if current:
            args.update(period_args(current, now))
        add("analyze_demand_vs_stock", args)
        capset -= {TOP_BORROWED, REORDER, WAREHOUSE_RISK}
    if capset & WAREHOUSE_AWARE or (named_warehouses and capset & {REORDER} and not capset & {TOP_BORROWED}):
        names = [w["name"] for w in named_warehouses]
        if len(named_warehouses) >= 2:
            add("compare_warehouses", {"warehouses": names})
            if analysis == CAUSAL:
                for name in names[:2]:
                    add("explain_warehouse_shortage", {"warehouse": name})
        elif len(named_warehouses) == 1:
            if analysis == CAUSAL:
                add("explain_warehouse_shortage", {"warehouse": names[0]})
            else:
                add("get_warehouse_low_stock_items", {"warehouse": names[0]})
                if WAREHOUSE_RISK in capset or analysis in (COMPARISON, DECISION):
                    add("get_warehouse_stock_risk")
        elif WAREHOUSE_RISK in capset or LOW_STOCK_ITEMS in capset:
            add("get_warehouse_stock_risk")
        capset -= WAREHOUSE_AWARE
    if BORROW_TREND in capset:
        if current and comparison:
            add("compare_borrow_periods", {**period_args(current, now), **period_args(comparison, now, "compare_")})
        else:
            args = period_args(current, now) if current else {}
            if re.search(r"theo thang|hang thang|\d+ thang", text):
                args["granularity"] = "month"
            add("get_borrow_trends", args)
        capset.discard(BORROW_TREND)
    if TOP_BORROWED in capset:
        if current and comparison:
            add("compare_top_books", {**period_args(current, now), **period_args(comparison, now, "compare_")})
        else:
            args = period_args(current, now) if current else {}
            if limit:
                args["limit"] = limit
            add("get_top_books", args)
        capset.discard(TOP_BORROWED)
    if REORDER in capset:
        if budgets or budget_pct is not None or (analysis == WHAT_IF and "ngan sach" in text):
            args: dict = {}
            if budgets:
                args["budgets_vnd"] = budgets[:3]
            if budget_pct is not None:
                args["budget_change_pct"] = budget_pct
            if lead_time:
                args["lead_time_days"] = lead_time
            if priority:
                args["priority"] = priority
            add("simulate_reorder_budget", args)
        elif focus_item or (analysis == CAUSAL and book_title) or (book_title and re.search(r"bao nhieu|nen nhap", text)):
            add("explain_reorder_item", {"variant_id": focus_item.get("variant_id")} if focus_item
                else {"title": book_title})
        elif ordinal_book:
            ordinals = {"thu hai": 2, "thu 2": 2, "thu ba": 3, "thu 3": 3}
            args = {"rank": ordinals.get(ordinal_book.group(2), 1)}
            if priority:
                args["priority"] = priority
            add("explain_reorder_item", args)
        else:
            args = {}
            if limit:
                args["limit"] = limit
            if priority:
                args["priority"] = priority
            if lead_time:
                args["lead_time_days"] = lead_time
            add("get_reorder_suggestions", args)
        capset.discard(REORDER)
    if AGING in capset or WEEDING in capset:
        days = parse_threshold_days(text)
        for cap in (AGING, WEEDING):
            if cap in capset:
                add(_SIMPLE_CAP_TOOL[cap], {"days": days} if days and days >= 30 else {})
        capset -= {AGING, WEEDING}
    if BOOK_SEARCH in capset:
        query = book_title or re.sub(r"\b(co sach|tim sach|khong|ko|sach cua|tac gia)\b", " ", text).strip(" ?")
        if query:
            add("search_books", {"query": book_title or message.strip()})
        capset.discard(BOOK_SEARCH)
    for cap in (KPI, OVERDUE, FINES, RESERVATION):
        if cap in capset:
            add(_SIMPLE_CAP_TOOL[cap])

    if sensitive:
        # Phone numbers, home addresses, credentials: no tool returns them and
        # none should be called to "look" - the answer is a refusal.
        tools = []
        analysis = "out_of_scope"

    if action_surface:
        # Write requests ("tạo phiếu nhập...") keep the original route: the model
        # picks the tools and the agent layer builds a pending action that the
        # user must confirm. Seeding here would bypass nothing, but it would
        # change what data the action builder sees.
        tools = []

    plan.capabilities = caps
    plan.intent, plan.secondary_intents = _intent_of(caps)
    plan.requested_analysis = analysis
    plan.entities = {
        "warehouses": named_warehouses,
        "book_title": book_title,
        "focus_item": focus_item,
        "budgets_vnd": budgets,
        "budget_change_pct": budget_pct,
    }
    plan.filters = {"limit": limit, "priority": priority, "lead_time_days": lead_time}
    plan.time_range = asdict(current) if current else None
    plan.comparison_period = asdict(comparison) if comparison else None
    plan.required_tools = tools
    plan.carried_over = carried
    plan.assumptions = assumptions
    return plan


# ── conversation state ───────────────────────────────────────────────────────

_ITEM_SOURCES = (
    ("explain_reorder_item", lambda r: [r.get("item")] if isinstance(r.get("item"), dict) else []),
    ("simulate_reorder_budget", lambda r: (r.get("scenarios") or [{}])[0].get("funded_items") or []),
    ("analyze_demand_vs_stock", lambda r: r.get("rows") or []),
    ("get_reorder_suggestions", lambda r: r.get("items") or []),
    ("get_top_books", lambda r: r if isinstance(r, list) else []),
    ("compare_top_books", lambda r: r.get("current") or []),
    ("get_warehouse_low_stock_items", lambda r: r.get("items") or []),
    ("explain_warehouse_shortage", lambda r: r.get("items") or []),
    ("get_weeding_suggestions", lambda r: r.get("items") or []),
    ("get_aging_inventory", lambda r: r.get("items") or []),
)


def next_state(plan: QueryPlan, collected_data: dict, previous: dict | None = None) -> dict:
    """Structured memory carried to the next turn: topic, entities, period,
    filters, budget and the items just shown (so "cuốn đầu tiên" / "trong số
    đó" resolve to real variant_ids, not to titles guessed from prose).
    A clarification turn keeps the previous state - nothing was answered."""
    previous = previous or {}
    if plan.clarification_needed:
        return previous
    last_items: list[dict] = []
    for tool, extract in _ITEM_SOURCES:
        result = collected_data.get(tool)
        if not isinstance(result, (dict, list)) or (isinstance(result, dict) and result.get("error")):
            continue
        try:
            rows = extract(result)
        except Exception:  # noqa: BLE001 - state is best effort
            rows = []
        for row in rows[:10]:
            if isinstance(row, dict) and (row.get("variant_id") or row.get("title")):
                last_items.append({"variant_id": row.get("variant_id"), "title": row.get("title")})
        if last_items:
            break
    caps = plan.capabilities or previous.get("capabilities") or []
    return {
        "capabilities": caps,
        "intent": plan.intent,
        "analysis": plan.requested_analysis,
        "warehouses": plan.entities.get("warehouses") or previous.get("warehouses") or [],
        "time_range": plan.time_range or (previous.get("time_range") if set(caps) & TIME_AWARE else None),
        "comparison_period": plan.comparison_period,
        "budgets": plan.entities.get("budgets_vnd") or [],
        "priority": plan.filters.get("priority"),
        "limit": plan.filters.get("limit"),
        "last_items": last_items or (previous.get("last_items") or []),
        "tools": [t["name"] for t in plan.required_tools],
    }
