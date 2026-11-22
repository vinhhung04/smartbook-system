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
# Inventory rebalancing & procurement decision (analytics /rebalancing-plan).
REBALANCE = "rebalance"

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
    "explain_reorder_item", "rank_priority_tasks", "analyze_inventory_rebalancing",
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
          "tong so phieu muon", "thu vien dao nay", "can chu y", _R(r"\b(cac )?chi so (chinh|chung|tong quan|quan trong)\b")],
    # "biểu đồ" alone is a presentation request (detect_visualization), not a
    # metric: "biểu đồ tồn kho" must not become a borrow-trend question.
    BORROW_TREND: ["xu huong", "trend", "luot muon", "muon tra", "so luot", "thong ke muon",
                   "muon theo thang", "muon theo ngay", _R(r"\bmuon (nhieu|it) hon\b"),
                   _R(r"\bmuon (co |dang |co dang |lai )?(giam|tang)\b"),
                   _R(r"\bluot tra\b"), _R(r"\b(hoan tra|tra sach) (\d+ ngay|tuan|thang|quy|nam|gan day|qua)\b"),
                   _R(r"\b(tinh hinh|so lieu|du lieu) muon( sach| tra)?\b")],
    TOP_BORROWED: [_R(r"\btop\b"), _R(r"\bhot\b"), "pho bien", _R(r"\bmuon nhieu(?! hon)"), "duoc muon nhieu",
                   "hut khach", "ban chay", "yeu thich nhat"],
    OVERDUE: ["qua han", "tre han", "tra tre", "tra sach tre", "chua tra", "overdue"],
    FINES: ["tien phat", "phi phat", "khoan phat", "phat chua thu", "thu phat", "tong phat", "no phat",
            "phat qua han", "phat mat sach", "loai phat", _R(r"\bfines?\b")],
    RESERVATION: ["dat cho", "dat sach", "giu sach", "reservation", "phieu dat", "chuyen doi dat", "dang cho lay",
                  "pickup", "cho lay sach"],
    WAREHOUSE_RISK: ["rui ro", "sap het", "het hang", "het sach", "ton kho thap", "ton thap", "ton it",
                     "thieu sach", "thieu hang", "duoi nguong", "nguong ton", "canh bao ton", "low stock",
                     _R(r"\b(duoi )?muc ton (toi thieu|an toan)\b"), "ton toi thieu",
                     "out of stock", "con nhieu sach hon", "con it sach", _R(r"\bkho nao\b"),
                     _R(r"\b(cac|tung|moi) kho\b"), _R(r"\b(tinh hinh|bieu do|so sanh|thong ke|so lieu) ton kho\b"),
                     _R(r"\bcon (bao nhieu|it|du) (ban|cuon|quyen)\b"),
                     _R(r"\bthieu (nhung |cac |may )?(sach|dau sach|cuon|hang)\b")],
    REORDER: ["nhap them", "nhap gi", "nen nhap", "nhap sach", "nhap hang", "bo sung", "de xuat nhap",
              "goi y nhap", "mua them", "reorder", "can nhap", "ngan sach", "dat mua", "nhap bao nhieu",
              "luong nhap", "de xuat nhap", "nhap uu tien", _R(r"\bnhap (du|het|toan bo)\b"),
              _R(r"\bsach (duoc )?de xuat\b"), _R(r"\b(dau sach|sach) (co )?uu tien (cao|trung binh|thap)\b")],
    AGING: ["ton lau", "ton kho lau", "khong ai muon", "lau khong ai", _R(r"\be ton\b"), _R(r"\bsach e\b"), "hang chet",
            "dead stock", "nam kho", "khong ai dung", "khong hoat dong", "chiem von", "ton dong von", "von ton dong"],
    # "điều chuyển" is rebalancing (REBALANCE), not weeding: thanh lý stays here.
    WEEDING: ["thanh ly", "chon von", "weeding"],
    BOOK_SEARCH: [_R(r"\bco sach (?!nao)\S.* (khong|ko)\b"), "tim sach", "sach cua tac gia", "tac gia", "isbn", "sach ve chu de"],
    # Moving stock between warehouses / transfer-vs-buy decisions. "dư" (surplus)
    # loses its accent to "du" = "đủ" (enough), so it is detected on the
    # original message instead (_SURPLUS_WORD); only unambiguous forms here.
    REBALANCE: ["dieu chuyen", "chuyen kho", "chuyen hang", "dieu phoi", "can bang ton", "can bang kho", "du thua",
                "thua sach", "nguon hang", "nguon sach", "noi bo", "phan con thieu",
                _R(r"\bchuyen (sach|ve|sang|qua|tu|bot)\b"), _R(r"\bton (qua|rat|kha) nhieu\b"),
                _R(r"\btan dung (hang|sach|nguon|ton|so)\b"),
                _R(r"\blay (sach|hang) (tu|o|cua) (kho|cac kho|noi khac|cho khac|chi nhanh)\b"),
                _R(r"\blay (hang|sach) o dau\b"), _R(r"\bbu (cho|sang|vao|lai cho) (kho|chi nhanh)\b"),
                _R(r"\bho tro (cho )?(kho|chi nhanh|hcm|ha noi|da nang|can tho)\b"),
                _R(r"\b(chuyen|dieu chuyen) hay (nhap|mua)\b|\b(nhap|mua)( them| moi)? hay (chuyen|dieu chuyen)\b"),
                "san se", _R(r"\bcan (doi|bang) (hang|ton|sach|kho|nguon)\b"), _R(r"\bom (nhieu|qua nhieu|rat nhieu) (sach|hang)\b"),
                _R(r"\b(mua|nhap)\b.{0,25}\bhay\b.{0,12}\b(chuyen|dieu chuyen)\b"),
                "so luong dieu chuyen", "kho nguon", _R(r"\bchuyen (duoc )?(toi da )?bao nhieu\b"),
                _R(r"\b(phan tich|danh gia|kiem tra)\b.{0,15}\bton kho\b.{0,25}\b(cac|tung|moi|nhung|tat ca) kho\b"),
                _R(r"\b(tinh trang|tinh hinh) (hang hoa|nguon hang|nguon sach)\b"),
                _R(r"\bkho nao (can|nen) (bo sung|nhap them|them hang)\b"), _R(r"\bkho nao\b.{0,30}\bho tro\b"),
                _R(r"\bnhu cau\b.{0,40}\b(tung|cac|moi) kho\b|\b(tung|cac|moi) kho\b.{0,40}\bnhu cau\b"),
                _R(r"\bnhu cau (du kien|du bao)\b.{0,30}\bkho\b"),
                _R(r"\bket hop\b.{0,40}\b(mua|nhap|ton|chuyen)\b"), _R(r"\b(chi|vua) (dieu chuyen|mua moi)\b")],
    PRIORITY: ["uu tien xu ly", "viec gi", "thu tu uu tien", "uu tien cong viec", "nen lam gi truoc",
               "viec can lam", "cong viec tuan nay", "cong viec hom nay"],
}

# Answer modes (QueryPlan.answer_mode): how the answer is shaped. Mostly the
# requested analysis, plus ANALYSIS for "tình hình / đánh giá" questions and
# multi-metric lookups that need interpretation, not just a number.
ANALYSIS = "analysis"
_ANALYSIS_WORDS = re.compile(r"\b(phan tich|danh gia|nhan xet|tinh hinh|ra sao|the nao|nhu the nao|bao cao|tong quan)\b")

# How the user wants it said - modifiers on top of the answer mode.
_STYLE_PATTERNS: dict[str, re.Pattern] = {
    "brief": re.compile(r"\b(ngan gon|tom tat|tom lai|noi ngan|gon thoi|gon lai|ngan thoi|ngan hon|mot cau|1 cau)\b"),
    "deep": re.compile(r"\b(ky hon|chi tiet hon|cu the hon|sau hon|giai thich ky|giai thich them|giai thich chi tiet|"
                       r"phan tich sau|noi them|(noi|giai thich|trinh bay) ro hon)\b"),
    "plain": re.compile(r"\b(de hieu|don gian hon|noi don gian|khong chuyen|nghia la gi|thuat ngu|binh dan)\b"),
    "why_not": re.compile(r"\b(sao|tai sao|vi sao) (lai )?khong (chon|nhap|uu tien|lay|dung|de xuat)\b|"
                          r"\b(phuong an|lua chon) (khac|thay the)\b|\bthay vi\b"),
}


def detect_style(text: str) -> dict:
    """{"brief"|"deep"|"plain"|"why_not": True} for every modifier asked for."""
    return {name: True for name, pattern in _STYLE_PATTERNS.items() if pattern.search(text)}


# ── visualization requests ──────────────────────────────────────────────────
# Matched on normalize_query() output. "bảng" and "bằng" both normalize to
# "bang", so a table is only recognised in table phrases ("dưới dạng bảng",
# "bảng số liệu", "bằng bảng"), never from "bằng biểu đồ".
_VIZ_WORDS = _R(r"\b(bieu do|do thi|chart|graph|truc quan( hoa)?|visuali[sz]e|"
                r"ve (lai|bieu do|do thi|chart|thanh|duoi dang|dang|giup|cho toi|ra))\b")
_VIZ_TYPE_PATTERNS: list[tuple[str, re.Pattern]] = [
    ("line", _R(r"\b(bieu do|do thi|dang) duong\b|\bline( chart)?\b|\bduong xu huong\b")),
    ("area", _R(r"\b(bieu do|do thi|dang) (mien|vung)\b|\barea( chart)?\b")),
    ("pie", _R(r"\b(bieu do|do thi|dang) (tron|banh|vanh khuyen|quat)\b|\b(pie|donut)( chart)?\b")),
    ("bar", _R(r"\b(bieu do|do thi|dang) cot\b|\bcot (ngang|doc|chong)\b|\b(bar|column)( chart)?\b")),
    ("table", _R(r"\b(duoi dang|dang|thanh|ra|xem|lap|ke|hien thi|bang) bang\b(?! bieu do| do thi)|"
                 r"\bbang (so lieu|du lieu|thong ke|tong hop|xep hang|chi tiet|doi chieu)\b|\btable\b")),
]
_VIZ_REF = _R(r"\b(bieu do|do thi|chart|bang)( nay| vua roi| vua xong| vua ve| vua hien thi| tren| do| ay| luc nay|"
              r" truoc( do)?)\b")
_VIZ_EXPLAIN = _R(r"\b(giai thich|phan tich|doc|y nghia|nhan xet|noi gi|noi len|cho thay|the hien)\b")
_VIZ_CHANGE = _R(r"\b(doi|chuyen|ve lai|hien thi lai|trinh bay lai|xem lai|doi lai|thay)\b")
_TREND_WORDS = _R(r"\b(xu huong|bien dong|dien bien|theo (thang|ngay|tuan|quy)|hang (thang|ngay|tuan)|thong ke)\b")
_PROPORTION = _R(r"\b(ty trong|ti trong|co cau|phan bo|chiem bao nhieu)\b")
# Words a pure presentation request is made of. "Vẽ biểu đồ doanh thu bán sách
# online" has content words left over - a new (unsupported) data question,
# not a redraw of the previous turn.
_VIZ_FILLER = set(
    "bieu do do thi ve lai doi chuyen sang thanh qua dang cot duong tron mien vung banh quat vanh khuyen bang hien thi "
    "so lieu du lieu giai thich cho thay dieu gi nay vua roi xong tren toi minh xem giup truc quan hoa chart table "
    "graph duoi nhu the nao the hien y nghia phan tich nhan xet doc noi len hay di nhe voi a luc truoc ay kia cua cai "
    "la va sao thi duoc khong ra lam ket qua trinh bay hinh anh tat ca ngang chong lai".split())
VIZ_TYPE_PHRASE = {"line": "bằng biểu đồ đường", "bar": "bằng biểu đồ cột", "area": "bằng biểu đồ miền",
                   "pie": "bằng biểu đồ tròn", "table": "dưới dạng bảng"}


def detect_visualization(text: str) -> dict:
    """What the user asked about presentation: a chart at all, a specific
    form, the chart just shown ("biểu đồ vừa rồi"), an explanation of it.
    The form named after "sang/thành" wins ("đổi biểu đồ đường sang cột")."""
    chart_type = None
    after = re.search(r"\b(sang|thanh|qua)\b", text)
    bare = re.match(r"\s*(cot|duong|tron|mien|bang)\b", text[after.end():]) if after else None
    if bare:  # "đổi biểu đồ đường sang cột"
        chart_type = {"cot": "bar", "duong": "line", "tron": "pie", "mien": "area", "bang": "table"}[bare.group(1)]
    for zone in [] if chart_type else ([text[after.end():]] if after else []) + [text]:
        hits = [(m.start(), name) for name, pattern in _VIZ_TYPE_PATTERNS for m in [pattern.search(zone)] if m]
        if hits:
            chart_type = min(hits)[1]
            break
    refers = bool(_VIZ_REF.search(text))
    return {
        "requested": bool(_VIZ_WORDS.search(text)) or chart_type is not None,
        "chart_type": chart_type,
        "table": chart_type == "table",
        "refers_previous": refers,
        "change": chart_type is not None and bool(_VIZ_CHANGE.search(text)),
        "explain": refers and bool(_VIZ_EXPLAIN.search(text)),
        "trend": bool(_TREND_WORDS.search(text)),
        "proportion": bool(_PROPORTION.search(text)),
    }


def answer_mode(analysis: str, caps: list[str], text: str) -> str:
    if analysis != LOOKUP:
        return analysis
    if _ANALYSIS_WORDS.search(text) or len(set(caps) - {BOOK_SEARCH}) >= 2:
        return ANALYSIS
    return LOOKUP


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
    "trc": "truoc", "hnay": "hom nay", "hqua": "hom qua", "thg": "thang", "nhiu": "nhieu", "bnhieu": "bao nhieu",
    "ktra": "kiem tra",
    # rebalancing typos seen in the semantic test set
    "chuyn": "chuyen", "chuyeb": "chuyen", "dieuchuyen": "dieu chuyen", "muamoi": "mua moi", "ngansach": "ngan sach",
}
_PHRASE_EXPANSIONS = [
    (_R(r"\btp\.? ?hcm\b"), "hcm"), (_R(r"\bsai gon\b"), "hcm"), (_R(r"\bho chi minh\b"), "hcm"),
    (_R(r"\btonkho\b"), "ton kho"), (_R(r"\bquahan\b"), "qua han"), (_R(r"\btienphat\b"), "tien phat"),
    (_R(r"\bnhapthem\b"), "nhap them"),
    # City codes only right after "kho / chi nhánh" ("dn" alone may mean "doanh nghiệp").
    (_R(r"\b(kho|chi nhanh) dn\b"), r"\1 da nang"), (_R(r"\b(kho|chi nhanh) ct\b"), r"\1 can tho"),
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
    # "không sinh ra lượt mượn nào" describes idle stock, it does not ask for borrow trends (audit E-18).
    scan = re.sub(r"\bkhong (sinh ra |phat sinh |co |tao ra )?(luot muon|ai muon)\b", "khong ai muon", scan)
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
    # "N tháng qua / gần đây" keeps its original meaning (the last N x 30 days,
    # first and last month partial) so earlier questions answer the same way.
    # Two explicit forms ask for whole months instead (Vietnam calendar):
    #  - "N tháng trọn / đã kết thúc": the N months before the current one;
    #  - "N tháng theo lịch": from the 1st of the month N-1 months ago to today.
    for m in re.finditer(r"\b(\d{1,2}) thang (qua|gan day|gan nhat)\b", text):
        months = int(m.group(1))
        add(m, _period(f"last_{months}_months", today - timedelta(days=30 * months), today, f"{months} tháng qua"))
    for m in re.finditer(r"\b(\d{1,2}) thang (tron( ven)?|da (ket thuc|tron)|day du)\b", text):
        months = max(1, min(int(m.group(1)), 24))
        last_end = today.replace(day=1) - timedelta(days=1)
        first = last_end.replace(day=1)
        for _ in range(months - 1):
            first = (first - timedelta(days=1)).replace(day=1)
        add(m, _period(f"complete_{months}_months", first, last_end,
                       f"{months} tháng trọn ({first.month:02d}/{first.year}–{last_end.month:02d}/{last_end.year})"))
    for m in re.finditer(r"\b(\d{1,2}) thang (theo lich|duong lich)\b", text):
        months = max(1, min(int(m.group(1)), 24))
        first = today.replace(day=1)
        for _ in range(months - 1):
            first = (first - timedelta(days=1)).replace(day=1)
        add(m, _period(f"calendar_{months}_months", first, today,
                       f"{months} tháng theo lịch (từ 01/{first.month:02d}/{first.year}, tháng hiện tại tính đến hôm nay)"))
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


_PRICE_CONTEXT = re.compile(r"\b(gia|don gia|gia tien|gia ban|gia moi ban|re hon|dat hon)\s*(duoi|tren|tu|khoang|hon|toi|"
                            r"chua|khong qua|it hon|nhieu hon|cao hon|thap hon)?\s*$")
_PER_COPY = re.compile(r"\s*(trieu|tr|nghin|ngan|k|ty|d|dong)?\s*(/|mot|moi|1)\s*(ban|cuon|quyen)\b")
_SHARED_UNIT = re.compile(r"((?:\b\d+(?:[.,]\d+)?\s*(?:,\s|\s(?:va|hoac)\s)\s*)+\d+(?:[.,]\d+)?\s*)(trieu|ty|ti|nghin|ngan)\b")
_MONEY_UNIT = {"trieu": 1e6, "tr": 1e6, "cu": 1e6, "ty": 1e9, "ti": 1e9, "nghin": 1e3, "ngan": 1e3, "k": 1e3}
_BUDGET_DELTA = re.compile(r"\b(tang|cong|them|giam|bot|cat)\s*(?:them|bot|di|ngan sach|ns)?\s*(?:them\s*)?"
                           r"(\d+(?:[.,]\d+)?)\s*(trieu|tr|cu|ty|ti|nghin|ngan|k)\b")


def parse_budget_delta(text: str) -> float | None:
    """Signed amount added to the PREVIOUS budget: "tăng thêm 5 triệu" (+5M),
    "giảm bớt 2 triệu" (-2M). "tăng lên 15 triệu" / "giảm xuống 8 triệu" name
    the new budget itself and are not deltas."""
    m = _BUDGET_DELTA.search(text)
    if not m:
        return None
    amount = _num(m.group(2)) * _MONEY_UNIT[m.group(3)]
    return -amount if m.group(1) in ("giam", "bot", "cat") else amount


def parse_budgets(text: str) -> list[float]:
    """Budget amounts in a normalized message. An amount that is a price
    ("giá dưới 100 nghìn một bản") is a filter, never a budget.
    A list that names its unit once ("5, 15 và 30 triệu") gives it to every
    number in the list; "1,5 tỷ" (no space after the comma) is one number."""
    text = _SHARED_UNIT.sub(lambda m: re.sub(r"(\d+(?:[.,]\d+)?)(?=\s*(?:,\s|\s(?:va|hoac)\s))",
                                             rf"\1 {m.group(2)}", m.group(1)) + m.group(2), text)
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
    budgets = [(pos, v) for pos, v in budgets if not _PRICE_CONTEXT.search(text[max(0, pos - 24):pos])
               and not _PER_COPY.match(re.sub(r"^\d+(?:[.,]\d+)?", "", text[pos:pos + 30]))]
    budgets.sort()
    out: list[float] = []
    for _pos, value in budgets:
        if value > 0 and value not in out:
            out.append(round(value))
    return out


def parse_budget_change_pct(text: str) -> float | None:
    """Signed % change of the budget. "giảm … xuống X%" is read literally as
    "down TO X%" (a change of X - 100); build_plan states that reading."""
    amount = r"(?:\d+(?:[.,]\d+)?\s*(?:trieu|tr|ty|ti|nghin|ngan|k)\s*)?"
    m = re.search(r"\b(cat|giam|bot)\s*(?:ngan sach\s*)?" + amount + r"xuong (?:con |muc |chi con )?(\d{1,3})\s*%", text)
    if m and 0 < float(m.group(2)) < 100:
        return float(m.group(2)) - 100
    m = re.search(r"\b(cat|giam|bot|tang|them)\s*(?:ngan sach\s*(?:nhap\s*(?:hang\s*)?)?)?" + amount
                  + r"(?:di |them |bot |len )?(\d{1,3})\s*%", text)
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


_DELAY = re.compile(r"\b(cham|tre|lui|keo dai)( giao)?( hang)?( them| hon| di)?\s*(\d{1,3})\s*(ngay|tuan)\b")


def parse_lead_time_delay(text: str) -> int | None:
    """Phase 6 what-if: "nhà cung cấp giao chậm thêm 7 ngày", "trễ 1 tuần" -> extra days
    on every item's own lead time (not a fixed lead time)."""
    m = _DELAY.search(text)
    if not m:
        return None
    n = int(m.group(5)) * (7 if m.group(6) == "tuan" else 1)
    return n if 0 < n <= 180 else None


_PRIORITY_WAREHOUSE = re.compile(r"\buu tien (nhap |cap |danh |cho )*(cho )?(kho|chi nhanh)\b")
_KEEP_SERVICE = re.compile(r"\b(giam|tiet kiem|cat|bot|it)\b.{0,25}\bchi phi\b.{0,50}\b(giu|dam bao|duy tri|khong (giam|anh huong))\b"
                           r".{0,25}\b(phuc vu|dap ung|muc do)\b")
_LEAST_RISK = re.compile(r"\b(phuong an|lua chon|muc|cach) nao\b.{0,20}\b(it|thap|an toan)\b.{0,10}\b(rui ro|hon|nhat)\b"
                         r"|\bit rui ro (hon|nhat)\b|\ban toan hon\b")


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

# "nằm kho trên 90 ngày" is a duration, not "kho trên" (the warehouse above).
_DEICTIC_WAREHOUSE = _R(r"\bkho (nay|do|kia|ay|vua roi|tren(?! \d))\b|\bhai kho\b|\b2 kho\b")
_TWO_WAREHOUSES = _R(r"\b(hai|2) kho( nay| do| tren| vua roi| ay)?\b")
_REMAINING_WAREHOUSE = _R(r"\b(kho|chi nhanh) con lai\b")
# "Kho nào đáng lo hơn?" right after two warehouses were discussed compares those two.
_WHICH_MORE = _R(r"\b(kho|chi nhanh) nao\b.*\bhon\b")
_TITLE_DEMAND = _R(r"\b(nhu cau|luot muon|ton kho|xu huong|duoc muon|it muon|muon it|muon nhieu|it duoc muon|nhap them)\b")
_TREND_QUESTION = _R(r"\b(tang hay giam|giam hay tang|co (dang )?(tang|giam)( khong| ko)?|dang (tang|giam) (khong|ko|ha))\b")
_DEICTIC_BOOK = _R(r"\b(cuon|quyen|sach|dau sach|tua) (do|nay|kia|ay|vua roi|tren)\b")
_DEICTIC_GENERIC = _R(r"\bcai (do|kia|nay|ay)\b")
# Phase F: "trong số đó", "những cuốn đó", "các sách này": the LIST shown last turn,
# not one book - the plan carries that list (entities.subset_items).
_SUBSET_REF = _R(r"\btrong (so|danh sach) (do|nay|tren|vua roi|ay)\b"
                 r"|\b(nhung|cac) (cuon|quyen|sach|dau sach|tua sach|tua) (do|nay|tren|vua roi|vua liet ke|ay|kia)\b")
_TOP_LIST_TOOLS = {"get_top_books", "compare_top_books", "analyze_demand_vs_stock"}
_LIST_QUESTION = _R(r"\b(sach|cuon|quyen|dau sach|tua sach) (gi|nao)\b|\b(nhung|cac) (sach|dau sach|cuon)\b")
# "cuốn đầu tiên" points at one item; "3 cuốn đầu" is a limit, not a reference.
_ORDINAL_BOOK = _R(r"(?<!\d )\b(cuon|quyen|sach|dau sach)\s*(dau tien|thu nhat|so 1|thu (\d|hai|ba))\b")
# Personal data the copilot never hands out, whatever the role.
_SENSITIVE = _R(r"so dien thoai|\bsdt\b|dia chi nha|\bemail\b|\bcccd\b|\bcmnd\b|mat khau|password|"
                r"so tai khoan|the tin dung")
# A database statement: never run, never a chart ("DROP TABLE" read as a table request, audit E-8).
_SQL = _R(r"\bsql\b|\bselect\b.{1,80}\bfrom\b|\b(drop|truncate|alter) table\b|\bdelete from\b|\binsert into\b|"
          r"\bupdate\s+\w+\s+set\b")
_ALL_WAREHOUSES = _R(r"\b(tat ca|cac|tung|moi|nhung|toan bo) kho\b|\bkho nao\b")
# Words after "kho" that are not a warehouse name.
_HINT_STOP = {"nay", "do", "kia", "ay", "nao", "thap", "cao", "lau", "hang", "sach", "va", "voi", "vs", "thi",
              "co", "dang", "con", "it", "nhieu", "rui", "can", "duoc", "khong", "toan", "tren", "vua", "bang",
              "bieu", "kho", "tinh", "so", "cac", "hai", "the", "nhu", "ra", "sao", "gi", "bao", "ton", "theo"}


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

    # Phase F: "chi nhánh <thành phố>" naming several branches (two in Hà Nội,
    # three in HCM) is asked about, not guessed - even when one warehouse's
    # short name equals the city ("Kho Ha Noi" for "chi nhánh Hà Nội").
    for m in re.finditer(r"\bchi nhanh ([a-z0-9]+(?: [a-z0-9]+){0,2})", text):
        words = m.group(1).split()
        for n in range(len(words), 0, -1):
            hint = " ".join(words[:n])
            if hint in _HINT_STOP:
                continue
            branches = [w for w in warehouses if _wh_norm(w.get("name", "")).startswith("chi nhanh ")
                        and (f" {hint} " in f" {_wh_norm(w.get('name', ''))} "
                             or f" {hint} " in f" {_wh_norm(w.get('code', ''))} ")]
            if not branches:
                continue
            if len(branches) >= 2 and not any(_wh_norm(w.get("name", "")) == f"chi nhanh {hint}" for w in branches):
                ambiguous = branches
                covered.append((m.start(), m.end()))
            break

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

    # Lookahead, so "tồn kho kho HCM" still sees "kho hcm" after "kho kho".
    for m in re.finditer(r"\bkho (?=([a-z0-9]+(?: [a-z0-9]+)?))", text):
        if any(s <= m.start() < e for s, e in covered):
            continue
        hint_words = m.group(1).split()
        hint = hint_words[0]
        if hint in _HINT_STOP:
            continue
        candidates = [w for w in warehouses
                      if any(a.startswith(hint) or f" {hint}" in f" {a}" for a in (_wh_norm(w.get("name", "")),))
                      and w["id"] not in taken]
        if len(candidates) == 1:
            w = candidates[0]
            taken.add(w["id"])
            covered.append((m.start(), m.end(1)))
            resolved.append((m.start(), w))
            others = [x for x in warehouses if x is not w and hint in _wh_norm(x.get("code", ""))]
            note = f"Đã hiểu \"kho {hint.upper() if len(hint) <= 3 else hint}\" là {w.get('name')}"
            if others:
                note += f" (còn {len(others)} kho/chi nhánh khác có mã chứa \"{hint.upper()}\")"
            assumptions.append(note)
        elif len(candidates) > 1:
            ambiguous = candidates
    if resolved:
        # "tồn kho Hà Nội và HCM": the second warehouse is named without its
        # own "kho". Accepted only when the bare word is a whole word of
        # exactly one other warehouse's name.
        for m in re.finditer(r"\b(?:va|voi|vs|hay|so voi)\s+(?:kho\s+)?([a-z0-9]+)\b", text):
            hint = m.group(1)
            if len(hint) < 2 or hint in _HINT_STOP or any(s <= m.start(1) < e for s, e in covered):
                continue
            candidates = [w for w in warehouses
                          if w["id"] not in taken and hint in _wh_norm(w.get("name", "")).split()]
            if len(candidates) == 1:
                w = candidates[0]
                taken.add(w["id"])
                covered.append((m.start(1), m.end(1)))
                resolved.append((m.start(1), w))
                assumptions.append(f"Đã hiểu \"{hint.upper() if len(hint) <= 3 else hint}\" là {w.get('name')}")
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
    answer_mode: str = LOOKUP
    style: dict = field(default_factory=dict)
    # Presentation request (detect_visualization) plus, for a follow-up about
    # the chart just shown, `mode`: "retype" / "render" / "explain" - those
    # reuse the previous turn's data snapshot instead of new tool calls.
    visualization: dict = field(default_factory=dict)
    # Phase 1: the question split into business sub-questions (one per
    # capability), each with the planned tool(s) that answer it - so a
    # multi-part question is answered part by part (see decompose()).
    sub_questions: list[dict] = field(default_factory=list)
    # Phase 1: how the plan was made - rules only, or rules plus a validated
    # semantic reading (copilot_semantic_planner); never model-chosen tools.
    semantic: dict = field(default_factory=dict)
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
    PRIORITY: "DASHBOARD_SUMMARY_QUERY", REBALANCE: "INVENTORY_REBALANCING_QUERY",
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


def _still_visible(carried: list | None, warehouses: list[dict]) -> list[dict]:
    """Warehouses from an earlier turn that this user can still see now (by id)."""
    visible = {w.get("id") for w in warehouses}
    return [w for w in carried or [] if isinstance(w, dict) and w.get("id") in visible]


def _remaining_warehouses(previous: list[dict], focus: dict | None, warehouses: list[dict]) -> list[dict]:
    """ "Kho còn lại": the compared warehouse that was not singled out, or the
    only other visible warehouse. Anything else is ambiguous (several or none)."""
    if focus and len(previous) >= 2:
        return [w for w in previous if w.get("id") != focus.get("id")]
    if len(previous) == 1:
        return [w for w in warehouses if w.get("id") != previous[0].get("id")]
    return []


def _money(value: float) -> str:
    if value >= 1e6 and value % 1e5 == 0:
        return f"{value / 1e6:g} triệu".replace(".", ",")
    return f"{int(value):,} ₫".replace(",", ".")


def _book_title_in(text: str, original: str) -> str | None:
    """A book title quoted or named after "cuốn/quyển/sách" in the ORIGINAL
    message (accents kept, so catalog matching stays exact)."""
    m = re.search(r"[\"“'‘]([^\"”'’]{2,80})[\"”'’]", original)
    if m:
        return m.group(1).strip()
    m = re.search(r"(?:cuốn|quyển|sách|tựa)\s+([A-ZÀ-Ỹ0-9][^?,.;!]{1,80}?)(?:\s+(?:không|còn|được|có|thì|nên|bao)\b|[?,.;!]|$)",
                  original)
    if m and m.group(1)[0].isupper() and not re.match(r"(nào|đó|này|kia|ấy|đầu)\b", m.group(1).strip().lower()):
        return m.group(1).strip()
    m = re.search(r"(?:tại sao|vì sao|nên nhập bao nhiêu cuốn|nhập bao nhiêu)\s+([A-ZÀ-Ỹ][^?,.;!]{1,80}?)\s+"
                  r"(?:được|lại|có|bị|ít|nhiều|không|chưa|\?|$)", original, re.IGNORECASE)
    if m and m.group(1)[0].isupper():
        return m.group(1).strip()
    m = re.search(r"(?i:nhu cầu|lượt mượn|tồn kho|xu hướng mượn)\s+(?i:của|đối với|cho|với)\s+([A-ZÀ-Ỹ][^?,.;!]{1,80}?)"
                  r"(?:\s+(?:đang|có|là|ra|thế|như|tăng|giảm|ở|tại|hiện)\b|[?,.;!]|$)", original)
    if m and m.group(1)[0].isupper():
        return m.group(1).strip()
    return None


# ── inventory rebalancing turns ──────────────────────────────────────────────
#
# One structured reading of a rebalancing turn (QueryPlan.entities["rebalance"]):
#   focus        every business intent the turn asks for, primary first (REB_FOCUS)
#   destinations warehouses to supply (resolved against the user's visible list)
#   sources      warehouses named as "từ <kho>" (kept for the what-if layer)
#   budget_vnd   purchase budget of THIS scenario, resolved deterministically
#                from the words, the previous scenario or a recovered one
#   scenario_ref the earlier scenario the turn goes back to, if any
# The planner never computes figures and never trusts warehouse ids from text:
# names are resolved against the visible list and analytics re-checks scope.

REB_FOCUS = ("CONFIRM_ACTION", "CREATE_DRAFT", "WHAT_IF", "BUDGET_OPTIMIZATION", "DECISION_EXPLANATION",
             "DECISION_COMPARISON", "HYBRID_DECISION", "PROCUREMENT_OPTIMIZATION", "TRANSFER_QUANTITY",
             "TRANSFER_OPPORTUNITY", "SURPLUS_DETECTION", "SHORTAGE_DETECTION", "DEMAND_ANALYSIS", "INVENTORY_DIAGNOSIS")
_REB_FOCUS_RULES = [
    ("CONFIRM_ACTION", _R(r"\b(toi |minh )?xac nhan\b|\b(hay |cu )?thuc hien\b.{0,40}\b(yeu cau|phuong an|ban nhap|hop le)\b")),
    ("CREATE_DRAFT", _R(r"\b(tao|lap|soan)\b.{0,30}\b(ban nhap|phieu|yeu cau|de xuat|don)\b|\bban nhap\b")),
    ("WHAT_IF", _R(r"\b(neu|gia su|gia dinh|what if)\b|\b(giam|tang|cat|bot) (tiep|them)\b")),
    ("BUDGET_OPTIMIZATION", _R(r"\bngan sach\b|\btoi uu chi phi\b|\bphan bo\b|\b\d+(?:[.,]\d+)? ?(trieu|tr|ty)\b")),
    ("DECISION_EXPLANATION", _R(r"\b(tai sao|vi sao|ly do|giai thich|can cu|phoi hop|manager khac|quan ly kho khac)\b")),
    ("DECISION_COMPARISON", _R(r"\b(so sanh|phuong an nao|cach nao|tot hon|hieu qua (nhat|hon)|nen chon|lua chon)\b")),
    ("HYBRID_DECISION", _R(r"\bket hop\b|\b(mua|nhap)\b.{0,25}\bhay\b.{0,12}\b(chuyen|dieu chuyen)\b|\b(chuyen|dieu chuyen)( hang| sach)? hay (nhap|mua)\b|\b(nhap|mua)( them| moi)? hay "
                           r"(chuyen|dieu chuyen)\b|\bphan con thieu\b|\b(khong|chua) du\b.{0,30}\b(mua|nhap)\b")),
    ("PROCUREMENT_OPTIMIZATION", _R(r"\b(mua|nhap) (them|moi|bao nhieu)\b|\bcan (mua|nhap)\b|\bdat mua\b")),
    ("TRANSFER_QUANTITY", _R(r"\bso luong (dieu )?chuyen\b|\bchuyen (duoc )?(toi da )?bao nhieu\b|"
                             r"\b(so luong|muc|la) an toan\b")),
    ("TRANSFER_OPPORTUNITY", _R(r"\b(dieu chuyen|chuyen kho|chuyen hang|dieu phoi|san se|can doi|nguon hang|nguon sach|noi bo)\b|"
                                r"\bchuyen (sach|ve|sang|qua|tu)\b|\btan dung\b|\blay (sach|hang)\b|\bbu (cho|sang|vao)\b|"
                                r"\bho tro\b")),
    ("SURPLUS_DETECTION", _R(r"\b(du thua|thua sach|om (nhieu|qua nhieu|rat nhieu) (sach|hang)|ton (qua|rat|kha) nhieu)\b")),
    ("SHORTAGE_DETECTION", _R(r"\b(thieu|het hang|het sach|can bo sung|bo sung hang)\b")),
    ("DEMAND_ANALYSIS", _R(r"\bnhu cau\b")),
    ("INVENTORY_DIAGNOSIS", _R(r"\b(phan tich|tinh hinh|kiem tra|tong quan|danh gia|xem)\b.{0,20}\b(ton kho|kho|hang hoa|"
                              r"nguon sach|nguon hang)\b")),
]
_SURPLUS_WORD = re.compile(r"(?<!\w)(dư|thừa)(?!\w)", re.IGNORECASE)
_REB_FOLLOWUP = _R(r"\b(phuong an|kich ban|ngan sach|ban dau|luc dau|luc nay|truoc do|vua roi|quay lai|dung lai|"
                   r"giu nguyen|kho dich|kho nguon|tot hon|hieu qua|ban nhap|xac nhan|dong y|thuc hien|tai sao|vi sao|"
                   r"phoi hop|quan ly kho|manager|con thieu|mua them|nhap them|mua moi|khong du|so sanh|lua chon|"
                   r"phe duyet|duyet|nhu cau|an toan|bao nhieu|thieu|het hang|bo sung|cham|tre|ngung hoat dong|ton an toan|uu tien|chi cho phep|gia dinh|ngung|dong cua)\b")
_REB_ALL = _R(r"\b(tat ca|cac|tung|moi|nhung|toan bo|hai|ba|bon|giua) kho\b|\b\d+ kho\b|\bkho nao\b|\b(toan )?he thong\b|\bnguon (hang|sach)\b")
_REB_APPROVE = _R(r"\b(phe duyet|duyet)\b")
_REB_SHORT_AT = _R(r"\b(?:kho |chi nhanh )?([a-z0-9]+(?: [a-z0-9]+)?) (?:dang |van |bi )?(?:thieu|can bo sung|het sach|het hang)\b")
_REB_DEMAND = _R(r"\bnhu cau\b.{0,25}\b(tang|giam)\s*(?:them\s*)?(\d{1,3})\s*%")
_SAFETY_WORDS = r"(?:ton an toan|safety stock|muc an toan|du phong)"
_REB_SAFETY_PCT = [_R(rf"\b{_SAFETY_WORDS}\b.{{0,20}}\b(tang|giam)\s*(?:len |them )?(\d{{1,3}})\s*%"),
                   _R(rf"\b(tang|giam)\b.{{0,12}}\b{_SAFETY_WORDS}\b.{{0,12}}?\b(\d{{1,3}})\s*%")]
_REB_SAFETY_DOUBLE = _R(rf"\b{_SAFETY_WORDS}\b.{{0,20}}\bgap doi\b|\bgap doi\b.{{0,20}}\b{_SAFETY_WORDS}\b")


def _safety_multiplier(text: str) -> float | None:
    """ "tăng tồn an toàn 50%" -> 1.5, "giảm mức an toàn 20%" -> 0.8, "gấp đôi tồn an toàn" -> 2."""
    if _REB_SAFETY_DOUBLE.search(text):
        return 2.0
    for pattern in _REB_SAFETY_PCT:
        if m := pattern.search(text):
            return round(1 + float(m.group(2)) / 100 * (1 if m.group(1) == "tang" else -1), 2)
    return None
_REB_HIGH = _R(r"\b(chi|uu tien)\b.{0,20}\b(high|uu tien cao|muc cao)\b|\bsach high\b")
_REB_ONLY_PAIR = _R(r"\bchi (cho phep |duoc )?(dieu )?chuyen (giua|tu)\b")
_REB_RESET = _R(r"\b(bo|xoa|huy) (cac |moi |het )?(gia dinh|dieu kien)\b")
_REB_CLOSED_AFTER = r"(ngung hoat dong|dong cua|tam dong|ngung)"
_REB_BLOCKED_AFTER = r"(khong (the |duoc )?(dieu )?chuyen|khong chuyen duoc|khong ho tro)"
_REB_BLOCKED_BEFORE = r"(tru|bo|loai|khong lay (sach |hang )?(tu |o )?|khong dung)"


def _wh_near(w: dict, text: str, after: str | None = None, before: str | None = None) -> bool:
    """The warehouse is named right before `after` or right after `before`."""
    name = _wh_norm(w.get("name", ""))
    for alias in {name, _wh_norm(w.get("code", "")), re.sub(r"^(kho|chi nhanh) ", "", name)}:
        if not alias:
            continue
        if after and re.search(rf"\b{re.escape(alias)}\b.{{0,15}}\b{after}", text):
            return True
        if before and re.search(rf"\b{before}\s*(kho |chi nhanh )?{re.escape(alias)}\b", text):
            return True
    return False
# "giảm tiếp 20%", "tăng thêm 10% nữa": a change of the CURRENT scenario's budget
_REB_PCT_AGAIN = _R(r"\b(giam|cat|bot|tang)\s*(tiep|them|nua)\s*(\d{1,3})\s*%")
_REB_ORIGINAL = _R(r"\b(ban dau|luc dau|dau tien|goc|ngay tu dau)\b")
_REB_PREVIOUS = _R(r"\b(phuong an|kich ban|ngan sach|lan)\b.{0,12}\b(truoc|truoc do|luc nay|vua roi|cu)\b|\bquay lai\b")
_REB_CROSS = _R(r"\bso (sanh )?voi\b.{0,20}\b(phuong an|kich ban|ngan sach|lan)\b")
_REB_DEST_AFTER = _R(r"\b(?:ve|sang|den|cho|ho tro|bu cho|tai)\s+(?:kho\s+|chi nhanh\s+)?([a-z0-9]+(?: [a-z0-9]+)?)")
_REB_ANALYSIS = {
    "CONFIRM_ACTION": DECISION, "CREATE_DRAFT": DECISION, "WHAT_IF": WHAT_IF, "BUDGET_OPTIMIZATION": DECISION,
    "DECISION_EXPLANATION": CAUSAL, "DECISION_COMPARISON": DECISION, "HYBRID_DECISION": DECISION,
    "PROCUREMENT_OPTIMIZATION": DECISION, "TRANSFER_QUANTITY": DECISION, "TRANSFER_OPPORTUNITY": DECISION,
}
_REB_EXTRA_TOOLS = {KPI: "get_dashboard_kpis", OVERDUE: "get_overdue_summary", FINES: "get_fine_summary",
                    RESERVATION: "get_reservation_funnel", AGING: "get_aging_inventory",
                    TOP_BORROWED: "get_top_books", BORROW_TREND: "get_borrow_trends"}


def rebalance_focus(text: str, original: str = "") -> list[str]:
    """Every rebalancing intent a normalized message asks for, primary first."""
    found = [name for name, pattern in _REB_FOCUS_RULES if pattern.search(text)]
    if original and _SURPLUS_WORD.search(original) and not re.search(r"(?i)số dư", original) \
            and "SURPLUS_DETECTION" not in found:
        found.append("SURPLUS_DETECTION")
    found = sorted(found, key=REB_FOCUS.index)
    return found or ["INVENTORY_DIAGNOSIS"]


def _named_after_from(w: dict, text: str) -> bool:
    """The warehouse is named as a source: "từ kho X", "lấy ... ở X"."""
    name = _wh_norm(w.get("name", ""))
    aliases = {name, _wh_norm(w.get("code", "")), re.sub(r"^(kho|chi nhanh) ", "", name)}
    return any(a and re.search(rf"\b(tu|o|cua) (kho |chi nhanh )?{re.escape(a)}\b", text) for a in aliases)


def _plan_rebalance(message: str, text: str, caps: list[str], budgets: list[float], budget_pct: float | None,
                    budget_delta: float | None, named: list[dict], wh: dict, state: dict, warehouses: list[dict],
                    assumptions: list[str], sensitive: bool) -> QueryPlan | None:
    """The plan of a rebalancing turn, or None when the turn is not one."""
    if sensitive:
        return None
    prev = state.get("rebalance") or {}
    in_topic = REBALANCE in (state.get("capabilities") or []) and bool(prev)
    if _SURPLUS_WORD.search(message) and not re.search(r"(?i)số dư", message) and REBALANCE not in caps \
            and re.search(r"\b(kho|sach|hang|ton)\b", text):
        caps = [*caps, REBALANCE]
    if budget_pct is None and (m := _REB_PCT_AGAIN.search(text)):
        budget_pct = float(m.group(3)) * (1 if m.group(1) == "tang" else -1)
    if BOOK_SEARCH in caps and in_topic and not _book_title_in(text, message):
        # "Tìm sách thiếu tại TP.HCM" during a rebalancing talk: no title, so not a catalog search
        caps = [c for c in caps if c != BOOK_SEARCH]
    other = set(caps) - {REBALANCE, REORDER, WAREHOUSE_RISK, LOW_STOCK_ITEMS}
    # A follow-up stays in the rebalancing talk only when it asks for nothing
    # else ("tiền phạt chưa thu?" mid-talk is a fines question).
    followup = in_topic and not other and bool(
        caps or budgets or budget_pct is not None or budget_delta is not None or _REB_FOLLOWUP.search(text) or named)
    if REBALANCE not in caps and not followup:
        return None
    caps = [REBALANCE, *[c for c in caps if c != REBALANCE]]
    focus = rebalance_focus(text, message)
    if (budget_pct is not None or (budget_delta is not None and in_topic)) and "WHAT_IF" not in focus:
        focus = sorted([*focus, "WHAT_IF"], key=REB_FOCUS.index)
    primary = focus[0]
    carried: list[str] = []
    assumptions = list(assumptions)

    sources = [w for w in named if _named_after_from(w, text)]
    dests = [w for w in named if w not in sources]
    # "Kho Đà Nẵng san sẻ sách cho HCM": the warehouse after "về / cho / sang"
    # is the one supplied; any other warehouse named is a source.
    m = _REB_DEST_AFTER.search(text)
    found = resolve_warehouses(f"kho {m.group(1)}", warehouses)["warehouses"] if m else []
    if len(found) == 1:
        sources = [*sources, *[w for w in named if w["id"] != found[0]["id"] and w not in sources]]
        dests = found
        if not any(w["id"] == found[0]["id"] for w in named):
            assumptions.append(f"Hiểu kho cần bổ sung là {found[0]['name']}")
    elif not dests and (m := _REB_SHORT_AT.search(text)):
        # "TP.HCM đang thiếu sách, kho nào hỗ trợ…": the place said to be short is the one to supply
        found = resolve_warehouses(f"kho {m.group(1)}", warehouses)["warehouses"]
        if len(found) == 1:
            dests = found
            assumptions.append(f"Hiểu kho cần bổ sung là {found[0]['name']}")
    # What-if conditions (Phase 4), read from the words; merged below into the
    # current scenario's conditions so only what the user changes moves.
    whatif: dict = {}
    if m := _REB_DEMAND.search(text):
        whatif["demand_change_pct"] = float(m.group(2)) * (1 if m.group(1) == "tang" else -1)
        if budget_pct is not None and abs(budget_pct) == float(m.group(2)) and "ngan sach" not in text:
            budget_pct = None  # "nhu cầu tăng 20%" changes demand, not the budget
    for w in named:
        if _wh_near(w, text, after=_REB_CLOSED_AFTER):
            whatif.setdefault("closed_warehouses", []).append(w["name"])
        elif _wh_near(w, text, after=_REB_BLOCKED_AFTER, before=_REB_BLOCKED_BEFORE):
            whatif.setdefault("exclude_source_warehouses", []).append(w["name"])
    if _REB_ONLY_PAIR.search(text) and len(named) >= 2:
        # "chỉ cho phép điều chuyển giữa Đà Nẵng và HCM": the warehouse already
        # being supplied stays the destination, the other is the only source
        prev_ids = {w.get("id") for w in prev.get("destinations") or []}
        pair_dest = [w for w in named if w["id"] in prev_ids] or [named[-1]]
        whatif["only_source_warehouses"] = [w["name"] for w in named if w not in pair_dest]
        dests, sources = pair_dest, [w for w in named if w not in pair_dest]
    if (multiplier := _safety_multiplier(text)) is not None:
        whatif["safety_stock_multiplier"] = multiplier
        if budget_pct is not None and "ngan sach" not in text:
            budget_pct = None  # the % belongs to the safety stock
    if _REB_HIGH.search(text):
        whatif["priority"] = "HIGH"
    if delay := parse_lead_time_delay(text):
        whatif["lead_time_delay_days"] = delay
    conditioned = {n for v in whatif.values() if isinstance(v, list) for n in v}
    if conditioned:  # a warehouse named in a condition is not a place to supply
        dests = [w for w in dests if w["name"] not in conditioned]
    if whatif and "WHAT_IF" not in focus:
        focus = sorted([*focus, "WHAT_IF"], key=REB_FOCUS.index)
        primary = focus[0]
    if in_topic and primary == "DECISION_EXPLANATION":
        # "Tại sao không chọn Hà Nội?": a warehouse named while asking about the
        # plan is a source being discussed, not a new place to supply.
        sources = [*sources, *[w for w in dests if w not in sources]]
        dests = []
    if _REB_ALL.search(text) and not found and not _REB_DEST_AFTER.search(text):
        dests = []  # "tất cả các kho tôi được xem": every readable warehouse, not a named list
    if not dests and in_topic and not _REB_ALL.search(text):
        dests = _still_visible(prev.get("destinations"), warehouses)
        if dests:
            carried.append("destinations")

    scenarios = [s for s in prev.get("scenarios") or [] if isinstance(s, dict)]
    current = prev.get("budget_vnd")
    referenced = None
    if in_topic and _REB_ORIGINAL.search(text) and scenarios:
        priced = [s for s in scenarios if s.get("budget_vnd") is not None]
        if budgets:
            referenced = next((s for s in scenarios if s.get("budget_vnd") == budgets[0]), None)
        else:
            referenced = priced[0] if priced else scenarios[0]
    elif in_topic and _REB_PREVIOUS.search(text) and len(scenarios) >= 2:
        referenced = scenarios[-2]
    # "So sánh với phương án lúc nãy": the referenced scenario is the one to
    # compare WITH; the current scenario stays the one being answered.
    compare_with = None
    if in_topic and _REB_CROSS.search(text) and scenarios:
        compare_with = referenced or (scenarios[-2] if len(scenarios) >= 2 else None)
        referenced = None
    selected = referenced
    if compare_with is None and selected is None and in_topic and scenarios and "WHAT_IF" in focus:
        # A what-if is answered against the scenario it changes, so the
        # difference (old vs new) is computed from two real results.
        compare_with = next((s for s in scenarios if s.get("id") == prev.get("selected_scenario_id")), scenarios[-1])
    question = None
    budget = None
    if selected:
        budget = selected.get("budget_vnd")
        if not named:
            dests = _still_visible(selected.get("destinations"), warehouses)
        carried.append(f"scenario#{selected.get('id')}")
        assumptions.append(f"Dùng lại kịch bản #{selected.get('id')}"
                           + (f" (ngân sách mua {_money(budget)})" if budget is not None else " (không giới hạn ngân sách)"))
    elif budget_delta is not None and current is not None and in_topic and budget_pct is None \
            and current + budget_delta > 0 and not re.search(r"\b(len|xuong|con)\b", text):
        # "giảm thêm 5 triệu" changes the current budget; "giảm xuống 8 triệu" names the new one
        budget = round(current + budget_delta)
        carried.append("budget_vnd")
        assumptions.append(f"Ngân sách mới = {_money(current)} {'+' if budget_delta > 0 else '−'} "
                           f"{_money(abs(budget_delta))} = {_money(budget)}")
    elif budgets:
        budget = budgets[0]
    elif budget_pct is not None:
        if current is None:
            question = (f"Bạn muốn {'tăng' if budget_pct > 0 else 'giảm'} {abs(budget_pct):g}% so với ngân sách mua nào? "
                        "Kịch bản hiện tại chưa có ngân sách mua.")
        else:
            budget = round(current * (1 + budget_pct / 100))
            carried.append("budget_vnd")
            assumptions.append(f"Ngân sách mới = {_money(current)} {'+' if budget_pct > 0 else '−'} {abs(budget_pct):g}% "
                               f"= {_money(budget)}")
    elif budget_delta is not None and current is not None and current + budget_delta > 0:
        budget = round(current + budget_delta)
        carried.append("budget_vnd")
        assumptions.append(f"Ngân sách mới = {_money(current)} {'+' if budget_delta > 0 else '−'} "
                           f"{_money(abs(budget_delta))} = {_money(budget)}")
    elif in_topic and current is not None:
        budget = current
        carried.append("budget_vnd")

    prev_whatif = (selected.get("whatif") if selected else (prev.get("whatif") if in_topic else None)) or {}
    if _REB_RESET.search(text):
        prev_whatif = {}
    visible_names = {w.get("name") for w in warehouses}
    merged = {}
    for k, v in {**prev_whatif, **whatif}.items():
        if isinstance(v, list):
            v = [n for n in v if n in visible_names]  # a condition never outlives the warehouse's visibility
            if not v:
                continue
        merged[k] = v
    if prev_whatif and any(k not in whatif for k in merged):
        carried.append("what_if")
    if question is None and wh.get("ambiguous") and not named:
        question = f"Có nhiều kho khớp với tên bạn nêu: {_warehouse_names(wh['ambiguous'])}. Bạn muốn bổ sung cho kho nào?"
    if question is None and primary in ("TRANSFER_OPPORTUNITY", "TRANSFER_QUANTITY") and not dests and not sources \
            and not _REB_ALL.search(text) and not in_topic and len(warehouses) > 1:
        question = "Bạn muốn bổ sung sách cho kho nào? Hoặc tôi có thể phân tích cơ hội điều chuyển giữa tất cả các kho bạn được xem."
    plan = QueryPlan(intent="INVENTORY_REBALANCING_QUERY", normalized=text, capabilities=caps,
                     is_followup=in_topic and followup and REBALANCE not in detect_capabilities(text))
    plan.secondary_intents = [i for i in _intent_of(caps)[1] if i != plan.intent]
    if question:
        plan.clarification_needed = True
        plan.clarification_question = question
        plan.clarification_options = ([f"Điều chuyển sách về {w['name']}" for w in (wh.get("ambiguous") or warehouses)[:3]]
                                      + ["Phân tích tất cả các kho"]) if "kho nào" in question else []
        plan.requested_analysis = CLARIFICATION
        plan.carried_over = carried
        plan.assumptions = assumptions
        return plan

    def call(dest_list: list[dict], amount, conditions: dict) -> dict:
        args: dict = {}
        if dest_list:
            args["destination_warehouses"] = [w["name"] for w in dest_list]
        if amount is not None:
            args["budget_vnd"] = amount
        args.update(conditions)
        return {"name": "analyze_inventory_rebalancing", "args": args}

    style = detect_style(text)
    tools = [call(dests, budget, merged)]
    if compare_with:
        back = call(_still_visible(compare_with.get("destinations"), warehouses), compare_with.get("budget_vnd"),
                    {k: v for k, v in (compare_with.get("whatif") or {}).items()
                     if not isinstance(v, list) or all(n in visible_names for n in v)})
        if back != tools[0]:
            tools.insert(0, back)  # the current scenario stays the last call (next_state reads it)
            carried.append(f"compare_scenario#{compare_with.get('id')}")
    for cap in caps:
        if cap in _REB_EXTRA_TOOLS and len(tools) < MAX_PLANNED_TOOLS:
            tools.append({"name": _REB_EXTRA_TOOLS[cap], "args": {}})
    analysis = _REB_ANALYSIS.get(primary, LOOKUP)
    if primary == "CONFIRM_ACTION":
        # Executing is the pending-action confirm step (fresh permission and
        # stock re-check there), never a side effect of reading the plan.
        tools = []
        style = {**style, "confirm_request": True}
    elif _REB_APPROVE.search(text) and primary not in ("CREATE_DRAFT",):
        # Approving a transfer / purchase is the approver's own step in its
        # workflow screen; the copilot neither approves nor implies it did.
        plan.clarification_needed = True
        plan.requested_analysis = CLARIFICATION
        plan.clarification_question = ("Tôi không phê duyệt giao dịch thay bạn. Tôi có thể tạo bản nháp yêu cầu điều chuyển / "
                                        "mua mới để bạn xác nhận; việc duyệt, xuất kho và nhận hàng vẫn làm theo quy trình "
                                        "hiện tại trên màn hình Yêu cầu.")
        plan.clarification_options = ["Tạo bản nháp cho phương án đang chọn"]
        plan.carried_over = carried
        plan.assumptions = assumptions
        return plan
    elif primary == "CREATE_DRAFT":
        style = {**style, "write_request": True, "rebalance_draft": True}
    if "DECISION_EXPLANATION" in focus and _R(r"\b(phoi hop|manager|quan ly kho|lien he)\b").search(text):
        style = {**style, "coordination": True}

    plan.requested_analysis = analysis
    plan.answer_mode = answer_mode(analysis, caps, text) if analysis != LOOKUP else ANALYSIS
    plan.style = style
    plan.entities = {
        "warehouses": [*dests, *sources],
        "budgets_vnd": [budget] if budget is not None else [],
        "budget_change_pct": budget_pct,
        "rebalance": {
            "focus": focus, "primary": primary,
            "destinations": dests, "sources": sources, "budget_vnd": budget, "whatif": merged,
            "scenario_ref": selected.get("id") if selected else None,
            "compare_scenario": compare_with.get("id") if compare_with else None,
        },
    }
    plan.required_tools = tools[:MAX_PLANNED_TOOLS]
    plan.carried_over = carried
    plan.assumptions = assumptions
    plan.sub_questions = decompose(caps, plan.required_tools, dests, None, None)
    return plan


@dataclass
class SemanticHint:
    """A validated semantic reading of the question (copilot_semantic_planner):
    registered capabilities, a registered analysis type, warehouses resolved
    against the user's visible list, parsed periods. Only build_plan turns it
    into tools and arguments."""
    capabilities: list[str] = field(default_factory=list)
    analysis: str | None = None
    warehouses: list[dict] = field(default_factory=list)
    periods: list[Period] = field(default_factory=list)
    references_previous: bool = False


def build_plan(message: str, state: dict | None, warehouses: list[dict] | None, now: datetime | None = None,
               hint: SemanticHint | None = None) -> QueryPlan:
    """The deterministic plan for one turn. `state` is the previous turn's
    conversation state (see next_state), `warehouses` the active warehouse list
    visible to this user (may be empty - then warehouse names stay unresolved
    and the plan falls back to all-warehouse tools). `hint` (Phase 1) adds a
    validated semantic reading on top of the rules - None keeps the purely
    rule-based plan."""
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
    lead_time_delay = parse_lead_time_delay(text)
    keep_service = bool(_KEEP_SERVICE.search(text))
    least_risk = bool(_LEAST_RISK.search(text))
    wh = resolve_warehouses(text, warehouses)
    named_warehouses = wh["warehouses"]
    assumptions = list(wh["assumptions"])
    carried: list[str] = []
    deictic_warehouse = bool(_DEICTIC_WAREHOUSE.search(text))
    deictic_book = bool(_DEICTIC_BOOK.search(text))
    deictic_generic = bool(_DEICTIC_GENERIC.search(text))
    sql = bool(_SQL.search(text))
    sensitive = bool(_SENSITIVE.search(text)) or sql
    ordinal_book = _ORDINAL_BOOK.search(text)
    book_title = _book_title_in(text, message)
    style = detect_style(text)
    viz = detect_visualization("" if sql else text)
    budget_delta = parse_budget_delta(text)
    book_ref = _DEICTIC_BOOK.search(text)
    subset_ref = _SUBSET_REF.search(text)
    if subset_ref and _LIST_QUESTION.search(text[:subset_ref.start()]):
        subset_ref = None  # "…nhập sách gì, và những sách đó…": the list asked for in THIS question
    if book_ref and detect_capabilities(text[:book_ref.start()]):
        # "Nhập sách gì với 15 triệu, và những sách đó có được mượn nhiều không?":
        # "đó" points back inside this question, not at the previous turn.
        deictic_book = False
    if hint is not None:
        # Phase 1: a validated semantic reading (copilot_semantic_planner) adds
        # what the keyword rules missed; it never replaces what they found in
        # the user's own words. Entities only fill slots the rules left empty.
        caps += [c for c in hint.capabilities if c not in caps]
        if analysis == LOOKUP and hint.analysis:
            analysis = hint.analysis
        if not named_warehouses and hint.warehouses:
            named_warehouses = list(hint.warehouses)
        if not periods and hint.periods:
            periods = list(hint.periods)
    rebalance = _plan_rebalance(message, text, caps, budgets, budget_pct, budget_delta, named_warehouses, wh, state,
                                warehouses, assumptions, sensitive)
    if rebalance is not None:
        return rebalance
    # "Giải thích kỹ hơn", "nói ngắn gọn", "vì sao không chọn phương án khác":
    # a request about HOW to say the previous answer, not a new data question.
    no_new_scope = not caps and not periods and not named_warehouses and not budgets \
        and budget_pct is None and limit is None and not book_title and not ordinal_book
    style_only = bool(style) and no_new_scope
    # "Đổi sang biểu đồ cột", "hiển thị dưới dạng bảng", "biểu đồ này cho thấy
    # điều gì?": about the data already shown, not a new question.
    content_words = [w for w in re.findall(r"[a-z0-9]+", text) if w not in _VIZ_FILLER]
    viz_only = (viz["requested"] or viz["refers_previous"]) and no_new_scope \
        and not deictic_warehouse and not deictic_book and len(content_words) <= 1

    if lead_time is not None:
        periods = [p for p in periods if not p.token.startswith("last_") or str(lead_time) not in p.token]
    if budgets or budget_pct is not None or lead_time is not None or lead_time_delay or keep_service:
        if REORDER not in caps:
            caps.append(REORDER)
    if lead_time_delay or keep_service:
        analysis = WHAT_IF
    prev_reorder = REORDER in (state.get("capabilities") or [])
    if least_risk and prev_reorder and not budgets:
        # "Phương án nào ít rủi ro hơn?" about the scenarios just shown - "rủi ro"
        # here is not the warehouse stock-risk metric
        caps = [c for c in caps if c != WAREHOUSE_RISK]
    if _PRIORITY_WAREHOUSE.search(text) and named_warehouses and (budgets or prev_reorder):
        # "Nếu ưu tiên kho Hà Nội thì sao?" after a budget question: a funding what-if
        if REORDER not in caps:
            caps.append(REORDER)
        analysis = WHAT_IF
    if book_title and not caps and _TITLE_DEMAND.search(text):
        # "Nhu cầu đối với X đang tăng hay giảm?", "Tại sao X ít được mượn hơn?":
        # the title's own demand/stock figures live in the reorder analysis.
        caps.append(REORDER)
    if RESERVATION in caps and BORROW_TREND not in caps and _TREND_QUESTION.search(text):
        # "Lượt đặt chỗ có đang tăng không?" is a trend over time, not the funnel totals
        caps.append(BORROW_TREND)
    if budget_pct is not None and re.search(r"\bxuong (con |muc |chi con )?\d{1,3}\s*%", text):
        assumptions.append(f"Hiểu “xuống {int(100 + budget_pct)}%” là ngân sách còn {int(100 + budget_pct)}% mức ban đầu")
    if analysis == WHAT_IF and not caps and "ngan sach" in text:
        caps.append(REORDER)
    if len(budgets) >= 2 and analysis in (LOOKUP, COMPARISON):
        # "So sánh các phương án 5, 10 và 20 triệu": comparing budget
        # scenarios is a what-if - no scenario may be called optimal.
        analysis = WHAT_IF
    if len(budgets) >= 2 and WAREHOUSE_RISK in caps and not named_warehouses and not re.search(r"\bkho\b", text):
        # "Mức nào giảm rủi ro thiếu sách nhất trong 5, 15, 30 triệu?": the risk of
        # a budget scenario (simulate_reorder_budget ranks it), not the warehouse metric
        caps.remove(WAREHOUSE_RISK)
    if named_warehouses and not caps and re.search(r"\b(kho|chi nhanh|chuyen sach|ton)\b", text):
        # "Có nên chuyển sách từ kho A sang kho B?" names warehouses but no metric.
        # A bare city ("Thời tiết Hà Nội") is not a warehouse question.
        caps.append(WAREHOUSE_RISK)
    if named_warehouses and not re.search(r"\b(kho|chi nhanh|wh|br)\b", text) and not set(caps) & WAREHOUSE_AWARE:
        named_warehouses = []
    if PRIORITY in caps:
        analysis = RANKING if analysis in (LOOKUP, DECISION) else analysis

    plan = QueryPlan(intent="GENERAL_QUERY", requested_analysis=analysis, normalized=text)
    has_state = bool(state.get("capabilities"))

    # ── follow-up resolution ────────────────────────────────────────────────
    looks_followup = bool(_FOLLOWUP_START.search(text)) and len(words) <= 10
    entity_only = not caps and bool(periods or named_warehouses or budgets or limit or budget_pct is not None)
    entity_only = entity_only or (REORDER in caps and has_state and not budgets and set(caps) == {REORDER}
                                  and bool(budget_pct is not None or lead_time_delay or keep_service or least_risk))
    referential = deictic_warehouse or deictic_book or deictic_generic or bool(ordinal_book) or "trong so do" in text \
        or bool(subset_ref)
    bare_why = text.strip(" ?") in ("tai sao", "vi sao", "ly do", "tai sao vay", "vi sao vay", "sao vay")
    # Warehouses carried from earlier turns must still be visible to this user
    # NOW (scope may have been revoked since): the previous state is a pointer,
    # never a permission.
    prev_whs = _still_visible(state.get("warehouses"), warehouses)
    recent_whs = _still_visible(state.get("recent_warehouses") or state.get("warehouses"), warehouses)
    two_back = not named_warehouses and bool(_TWO_WAREHOUSES.search(text)) and len(recent_whs) >= 2
    remaining = not named_warehouses and bool(_REMAINING_WAREHOUSE.search(text))
    if not named_warehouses and not remaining and re.search(r"\b(kho|chi nhanh) kia\b", text) \
            and len(prev_whs) == 2 and state.get("focus_warehouse"):
        # "Còn kho kia thì sao?" right after one of two warehouses was singled out: the other one
        remaining = True
    which_more = not named_warehouses and bool(_WHICH_MORE.search(text)) and len(prev_whs) >= 2 \
        and set(caps) <= WAREHOUSE_AWARE | {TOP_BORROWED, REORDER} and bool(set(caps) & WAREHOUSE_AWARE)
    is_followup = has_state and (looks_followup or entity_only or referential or bare_why or style_only or viz_only
                                 or (not caps and analysis in (CAUSAL, COMPARISON, WHAT_IF, DECISION))
                                 or (least_risk and not caps) or two_back or remaining or which_more
                                 or bool(hint and hint.references_previous))
    plan.is_followup = is_followup
    restyle = style_only and is_followup
    prev_viz = state.get("viz") or {}
    viz_followup = viz_only and is_followup and bool(state.get("tool_calls") or prev_viz.get("shown"))
    if restyle or viz_followup:
        # Same question, same data, different presentation: inherit the whole
        # previous turn so the re-explanation is about exactly what was shown.
        caps = list(state.get("capabilities") or [])
        if state.get("analysis") not in (None, CLARIFICATION, "out_of_scope"):
            analysis = state["analysis"]
        named_warehouses = prev_whs
        periods = [Period(**p) for p in (state.get("time_range"), state.get("comparison_period")) if p]
        budgets = list(state.get("budgets") or [])
        priority = state.get("priority")
        limit = state.get("limit")
        carried.append("visualization" if viz_followup and not restyle else "previous_turn")

    if is_followup and not caps:
        caps = list(state.get("capabilities") or [])
        carried.append("capabilities")
        if limit is None and state.get("limit") and not budgets:
            limit = state["limit"]
            carried.append("limit")
        if analysis == LOOKUP and state.get("analysis") in (DECISION, WHAT_IF, RANKING) and (budgets or limit):
            analysis = state["analysis"]
    if is_followup and REORDER in caps and REORDER in (state.get("capabilities") or []):
        if budget_delta is not None and state.get("budgets") and not budget_pct \
                and state["budgets"][0] + budget_delta > 0:
            # "Nếu tăng thêm 5 triệu?" is the previous budget plus 5 million, not a
            # new 5-million scenario ("tăng lên 15 triệu" names the new budget itself).
            base = state["budgets"][0]
            budgets = [round(base + budget_delta)]
            carried.append("budget_vnd(phương án trước)")
            assumptions.append(f"Hiểu “{'tăng' if budget_delta > 0 else 'giảm'} {_money(abs(budget_delta))}” là "
                               f"ngân sách mới = {_money(base)} {'+' if budget_delta > 0 else '−'} "
                               f"{_money(abs(budget_delta))} = {_money(budgets[0])}")
        elif budgets and state.get("budgets") and not budget_pct:
            budgets = budgets + [b for b in state["budgets"] if b not in budgets][:1]
            carried.append("budget_vnd(phương án trước)")
        elif not budgets and state.get("budgets") and not least_risk and (
                budget_pct is not None or lead_time_delay or keep_service or _PRIORITY_WAREHOUSE.search(text)):
            # "Nếu giảm 20% thì…", "nếu nhà cung cấp chậm 7 ngày", "ưu tiên kho Hà Nội":
            # the budget of the previous turn, not the full need (Phase 3 test c33-mt-08#1)
            budgets = list(state["budgets"])[:1]
            carried.append("budget_vnd(phương án trước)")
        if priority is None and state.get("priority"):
            priority = state["priority"]
            carried.append("priority")
        if limit is None and state.get("limit") and not budgets:
            limit = state["limit"]
            carried.append("limit")

    if is_followup and analysis == LOOKUP and state.get("analysis") in (DECISION, WHAT_IF) and (budgets or limit):
        analysis = WHAT_IF if budgets else state["analysis"]
    remaining_unresolved: list[dict] = []
    if is_followup and not named_warehouses:
        if two_back:
            # "So sánh hai kho này": the last two warehouses discussed, even when
            # the previous turn was about only one of them.
            named_warehouses = recent_whs[:2]
            carried.append("warehouses(2 kho vừa nhắc)")
        elif remaining:
            rest = _remaining_warehouses(prev_whs, state.get("focus_warehouse"), warehouses)
            if len(rest) == 1:
                named_warehouses = rest
                carried.append("warehouses(kho còn lại)")
                assumptions.append(f"Hiểu “kho còn lại” là {rest[0].get('name')}")
            else:
                remaining_unresolved = rest or [w for w in warehouses if w not in prev_whs]
        elif which_more:
            # "Kho nào đáng lo hơn?" right after comparing two warehouses: between those two.
            named_warehouses = prev_whs
            carried.append("warehouses")
            if analysis in (LOOKUP, RANKING):
                analysis = COMPARISON
    if is_followup and (set(caps) & WAREHOUSE_AWARE or (REORDER in caps and deictic_warehouse)):
        if not named_warehouses and prev_whs and not remaining and (deictic_warehouse or bare_why or entity_only
                                                  or analysis in (CAUSAL, COMPARISON)
                                                  or not set(caps) - WAREHOUSE_AWARE - {REORDER}):
            named_warehouses = prev_whs
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
    elif (deictic_book or "trong so do" in text or subset_ref) and state.get("last_items"):
        carried.append("last_items")
    subset_items: list[dict] = []
    if subset_ref and not focus_item and state.get("last_items"):
        subset_items = [dict(i) for i in state["last_items"][:10] if isinstance(i, dict)]
        if WAREHOUSE_RISK in caps and TOP_BORROWED not in caps \
                and set(state.get("tools") or []) & _TOP_LIST_TOOLS:
            # "Những cuốn đó còn đủ tồn kho không?" after a top-borrowed list: the stock
            # position of THOSE titles (analyze_demand_vs_stock), not every warehouse's risk
            caps.append(TOP_BORROWED)

    # ── clarification ───────────────────────────────────────────────────────
    question: str | None = None
    options: list[str] = []
    if wh["ambiguous"] and not named_warehouses:
        question = (f"Có nhiều kho khớp với tên bạn nêu: {_warehouse_names(wh['ambiguous'])}. "
                    "Bạn muốn xem kho nào?")
        options = [w["name"] for w in wh["ambiguous"]]
    elif remaining and not named_warehouses:
        question = "Bạn muốn xem kho nào trong số các kho còn lại?"
        if remaining_unresolved:
            question += f" Các kho: {_warehouse_names(remaining_unresolved[:6])}."
            options = [f"{w['name']} thì sao?" for w in remaining_unresolved[:4]]
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
    elif style_only and not has_state:
        question = ("Bạn muốn tôi giải thích nội dung nào? Hãy hỏi một câu cụ thể trước, ví dụ: kho nào đang rủi ro "
                    "thiếu sách nhất, hoặc nên nhập sách nào trước.")
        options = ["Kho nào đang rủi ro thiếu sách nhất?", "Tôi nên nhập sách nào trước?"]
    elif viz_only and not viz_followup:
        question = ("Chưa có dữ liệu nào trong hội thoại để vẽ. Bạn muốn xem biểu đồ của số liệu nào? Ví dụ: lượt mượn "
                    "theo tháng, tồn kho giữa các kho, hoặc các phương án ngân sách nhập sách.")
        options = ["Vẽ biểu đồ lượt mượn 6 tháng gần đây", "So sánh tồn kho giữa các kho bằng biểu đồ",
                   "So sánh các phương án nhập sách 5 triệu, 10 triệu và 20 triệu bằng biểu đồ"]
    elif viz["requested"] and not caps and not deictic_warehouse:
        # A chart of data SmartBook does not have (revenue, web traffic...):
        # say so and list what can be drawn - never a chart of something else.
        question = ("Tôi chưa có dữ liệu cho số liệu bạn muốn vẽ, nên không tạo biểu đồ để tránh hiển thị số liệu không "
                    "có căn cứ. Hiện tôi vẽ được: lượt mượn theo thời gian, top sách được mượn, tồn kho và rủi ro thiếu "
                    "sách theo kho, đề xuất nhập và mô phỏng ngân sách, quá hạn, tiền phạt, đặt chỗ.")
        options = ["Vẽ biểu đồ lượt mượn 6 tháng gần đây", "So sánh tồn kho giữa các kho bằng biểu đồ",
                   "Thống kê top 10 sách bằng biểu đồ"]
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
    if question and viz["requested"] and not viz_only:
        # Keep the presentation the user asked for in the suggested answers.
        phrase = VIZ_TYPE_PHRASE[viz["chart_type"]] if viz.get("chart_type") else "bằng biểu đồ"
        options = [o if re.search(r"biểu đồ|bảng", o) else f"{o.rstrip('?')} {phrase}" for o in options]
    if question:
        plan.visualization = viz
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
    trend_question = bool(_TREND_QUESTION.search(text)) and BORROW_TREND in caps
    if trend_question and not current:
        current = parse_periods("30 ngay qua", today)[0]
        assumptions.append(f"Không nêu kỳ: dùng {current.label}")
    if (analysis in (COMPARISON, CAUSAL) or trend_question) and current and not comparison and set(caps) & TIME_AWARE \
            and (analysis == COMPARISON or re.search(r"\b(giam|tang)\b", text)):
        comparison = previous_period(current)
        assumptions.append(f"So sánh {current.label} với {comparison.label}")

    tools: list[dict] = []

    def add(name: str, args: dict | None = None) -> None:
        assert name in PLANNABLE_TOOLS, name
        call = {"name": name, "args": dict(args or {})}
        if call not in tools:
            tools.append(call)

    # A book title is data, not a verb: "Lập Trình Lượng Tử" must not read as
    # "lập (phiếu)" and turn a lookup into a write request with no tools.
    action_text = text.replace(normalize_query(book_title), " ") if book_title else text
    # "Lập bảng số liệu", "tạo biểu đồ": a presentation request, not a write.
    action_text = re.sub(r"\b(lap|tao|ve|ke) (bang|bieu do|do thi)\b", " ", action_text)
    action_surface = bool(_ACTION_SURFACE.search(action_text))
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
            span = (current.dates()[1] - current.dates()[0]).days if current else 0
            # Daily buckets over months are unreadable as a chart (and exceed
            # its point limit): anything past ~2 months is shown per month.
            if re.search(r"theo thang|hang thang|\d+ thang", text) or span > 62:
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
            elif subset_items:
                args["limit"] = 50  # enough rows to place each listed title, not just the top 10
            add("get_top_books", args)
        capset.discard(TOP_BORROWED)
    if REORDER in capset:
        if budgets or budget_pct is not None or lead_time_delay or keep_service \
                or (analysis == WHAT_IF and "ngan sach" in text):
            args: dict = {}
            if budgets:
                args["budgets_vnd"] = budgets[:3]
            if budget_pct is not None:
                args["budget_change_pct"] = budget_pct
            if lead_time:
                args["lead_time_days"] = lead_time
            if priority:
                args["priority"] = priority
            if lead_time_delay:
                args["lead_time_delay_days"] = lead_time_delay
            if keep_service:
                args["keep_service"] = True
            if len(named_warehouses) == 1 and _PRIORITY_WAREHOUSE.search(text):
                args["priority_warehouse"] = named_warehouses[0]["name"]
            add("simulate_reorder_budget", args)
        elif focus_item or (analysis == CAUSAL and book_title) or (book_title and re.search(r"bao nhieu|nen nhap", text)) \
                or (book_title and _TITLE_DEMAND.search(text)):
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
            if len(named_warehouses) == 1:
                # the cards and the list must be about the books short at THAT warehouse
                args["warehouse"] = named_warehouses[0]["name"]
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

    if least_risk and is_followup and not budgets and any(
            isinstance(c, dict) and c.get("name") == "simulate_reorder_budget" for c in state.get("tool_calls") or []):
        # "Phương án nào ít rủi ro hơn?": the same scenarios again; the tool ranks
        # them by expected service (least_risk_scenario), the model never does
        tools = [{"name": "simulate_reorder_budget", "args": dict(c.get("args") or {})}
                 for c in state["tool_calls"] if isinstance(c, dict) and c.get("name") == "simulate_reorder_budget"][:1]
        analysis = DECISION
        carried.append("scenarios")
    if restyle or viz_followup:
        # Replay the previous turn's planner-built calls (never model-chosen
        # ones): the re-explanation must rest on the same evidence. A chart
        # follow-up normally reuses the stored snapshot instead (main.py);
        # these calls are the fallback when that snapshot is too old.
        replay = [{"name": c["name"], "args": dict(c.get("args") or {})} for c in state.get("tool_calls") or []
                  if isinstance(c, dict) and c.get("name") in PLANNABLE_TOOLS]
        if replay:
            tools = replay
    # A bounded turn: however many sub-questions, at most this many tool calls
    # (they run concurrently and none of them feeds back into planning).
    tools = tools[:MAX_PLANNED_TOOLS]

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
        if REORDER in caps:
            style = {**style, "write_request": True}  # the draft is the system's, after the answer (plan_note)
        if REORDER in caps and budgets:
            # Phase 6: "Lập phiếu đề xuất nhập nháp với ngân sách X" (the decision
            # card's button) must rest on the same budget allocation the decision
            # showed - seeded, not left to the model (which may call nothing).
            # The draft still only becomes a pending action the user confirms.
            tools = [{"name": "get_reorder_suggestions", "args": {"budget_vnd": budgets[0], "limit": 100}}]
            style = {**style, "draft_request": True}
        elif REORDER in caps:
            # "Tạo đề xuất phiếu nhập sách cho kho Đà Nẵng": left to the model, it once
            # called no tool and answered with invented generalities (live run
            # 2026-11-20). The same data the model picks when it does call a tool.
            args = {"limit": 100}
            if len(named_warehouses) == 1:
                args["warehouse"] = named_warehouses[0]["name"]
            if priority:
                args["priority"] = priority
            tools = [{"name": "get_reorder_suggestions", "args": args}]

    plan.capabilities = caps
    plan.intent, plan.secondary_intents = _intent_of(caps)
    plan.requested_analysis = analysis
    plan.answer_mode = (state.get("answer_mode") if (restyle or viz_followup) and state.get("answer_mode")
                        else answer_mode(analysis, caps, text))
    if viz_followup and viz["explain"] and plan.answer_mode == LOOKUP:
        plan.answer_mode = ANALYSIS  # "biểu đồ này cho thấy gì" asks for a reading, not a number
    plan.style = style
    request = dict(viz)
    if viz_followup:
        request.update(requested=True, mode="explain" if viz["explain"] else "retype" if viz["chart_type"] else "render")
        if not viz["chart_type"] and prev_viz.get("chart_type"):
            request.update(chart_type=prev_viz["chart_type"], inherited_type=True)
    elif is_followup and prev_viz.get("shown") and not viz["requested"] and caps \
            and set(caps) == set(state.get("capabilities") or []):
        # "Chỉ lấy dữ liệu tháng này" after a chart: same data shape, new
        # scope - keep showing it the way the user last saw it.
        request["requested"] = True
        if prev_viz.get("chart_type"):
            request.update(chart_type=prev_viz["chart_type"], inherited_type=True)
        carried.append("visualization")
    plan.visualization = request
    plan.entities = {
        "warehouses": named_warehouses,
        "book_title": book_title,
        "focus_item": focus_item,
        "subset_items": subset_items,
        "budgets_vnd": budgets,
        "budget_change_pct": budget_pct,
    }
    plan.filters = {"limit": limit, "priority": priority, "lead_time_days": lead_time}
    plan.time_range = asdict(current) if current else None
    plan.comparison_period = asdict(comparison) if comparison else None
    plan.required_tools = tools
    plan.carried_over = carried
    plan.assumptions = assumptions
    plan.sub_questions = decompose(caps, tools, named_warehouses, current, comparison)
    return plan


# ── multi-intent decomposition ───────────────────────────────────────────────

MAX_PLANNED_TOOLS = 6

# What each planned tool answers (a composite tool answers several parts).
TOOL_CAPABILITIES: dict[str, set[str]] = {
    "get_dashboard_kpis": {KPI}, "get_borrow_trends": {BORROW_TREND}, "compare_borrow_periods": {BORROW_TREND},
    "get_top_books": {TOP_BORROWED}, "compare_top_books": {TOP_BORROWED}, "get_overdue_summary": {OVERDUE},
    "get_fine_summary": {FINES}, "get_reservation_funnel": {RESERVATION},
    "get_warehouse_stock_risk": {WAREHOUSE_RISK, LOW_STOCK_ITEMS}, "compare_warehouses": {WAREHOUSE_RISK},
    "get_warehouse_low_stock_items": {LOW_STOCK_ITEMS, WAREHOUSE_RISK},
    "explain_warehouse_shortage": {WAREHOUSE_RISK, LOW_STOCK_ITEMS},
    "get_reorder_suggestions": {REORDER}, "simulate_reorder_budget": {REORDER}, "explain_reorder_item": {REORDER},
    "analyze_demand_vs_stock": {TOP_BORROWED, WAREHOUSE_RISK, LOW_STOCK_ITEMS, REORDER},
    "get_aging_inventory": {AGING}, "get_weeding_suggestions": {WEEDING}, "search_books": {BOOK_SEARCH},
    "rank_priority_tasks": {PRIORITY},
    "analyze_inventory_rebalancing": {REBALANCE, WAREHOUSE_RISK, LOW_STOCK_ITEMS, REORDER},
}
_CAP_GOAL = {
    KPI: "Tổng quan các chỉ số chính", BORROW_TREND: "Lượt mượn theo thời gian (tăng hay giảm)",
    TOP_BORROWED: "Sách được mượn nhiều nhất", OVERDUE: "Tình hình phiếu quá hạn", FINES: "Tiền phạt",
    RESERVATION: "Đặt chỗ / giữ sách", WAREHOUSE_RISK: "Tồn kho thấp, rủi ro thiếu sách",
    LOW_STOCK_ITEMS: "Đầu sách dưới ngưỡng tồn", REORDER: "Đề xuất nhập (số lượng, chi phí)",
    AGING: "Sách tồn lâu, ít được mượn", WEEDING: "Đề xuất thanh lý", BOOK_SEARCH: "Tìm sách trong danh mục",
    PRIORITY: "Việc cần ưu tiên xử lý", REBALANCE: "Điều chuyển giữa các kho và mua mới phần còn thiếu",
}
# (part, the part it builds on): "sắp hết" / "cần nhập bao nhiêu" asked about
# the most-borrowed books are answered for THOSE books.
_BUILDS_ON = {(WAREHOUSE_RISK, TOP_BORROWED), (LOW_STOCK_ITEMS, TOP_BORROWED), (REORDER, TOP_BORROWED),
              (REORDER, WAREHOUSE_RISK), (REORDER, LOW_STOCK_ITEMS), (WEEDING, AGING)}


def decompose(caps: list[str], tools: list[dict], warehouses: list[dict], current: Period | None,
              comparison: Period | None) -> list[dict]:
    """One sub-question per capability, in the order asked, with the planned
    tool(s) that answer it, the data it builds on and whether it can be
    answered. Built from the plan, never from model output; tools are already
    deduplicated (a composite tool appears once and answers several parts)."""
    parts: list[dict] = []
    for cap in caps:
        if cap == LOW_STOCK_ITEMS and WAREHOUSE_RISK in caps:
            continue
        answered_by = [t["name"] for t in tools if cap in TOOL_CAPABILITIES.get(t["name"], set())]
        part = {"id": len(parts) + 1, "goal": _CAP_GOAL.get(cap, cap), "capability": cap, "tools": answered_by,
                "status": "planned" if answered_by else "unsupported"}
        if cap in WAREHOUSE_AWARE and warehouses:
            part["warehouses"] = [w.get("name") for w in warehouses]
        if cap in TIME_AWARE and current:
            part["period"] = current.label + (f" so với {comparison.label}" if comparison else "")
        if cap == BORROW_TREND and warehouses:
            part["status"] = "partial"
            part["note"] = "Số liệu mượn tính gộp trên các kho bạn được xem, chưa tách riêng từng kho/chi nhánh."
        part["depends_on"] = [p["id"] for p in parts if (cap, p["capability"]) in _BUILDS_ON]
        parts.append(part)
    return parts


# ── conversation state ───────────────────────────────────────────────────────

_ITEM_SOURCES = (
    ("analyze_inventory_rebalancing", lambda r: r.get("top_shortages") or []),
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


def _viz_state(visualizations: list[dict] | None, previous: dict) -> dict:
    if visualizations is None:
        return previous.get("viz") or {}
    charts = [v for v in visualizations if v.get("type") in ("line", "bar", "area", "pie", "table")]
    primary = next((v for v in charts if v.get("type") != "table"), charts[0] if charts else None)
    return {"shown": bool(visualizations), "chart_type": primary.get("type") if primary else None,
            "types": [v.get("type") for v in visualizations], "titles": [v.get("title") for v in visualizations][:4]}


MAX_SCENARIOS = 8


def _rebalance_state(plan: QueryPlan, collected_data: dict, previous: dict) -> dict | None:
    """Scenario memory of the rebalancing conversation: every scenario that was
    actually computed (its budget, destinations and the options' ranking), so
    "phương án 15 triệu ban đầu", "quay lại phương án trước" and "giảm tiếp 20%"
    resolve to real earlier parameters. Kept across other topics; only a
    computed result adds a scenario."""
    prev = previous.get("rebalance") or None
    reb = (plan.entities or {}).get("rebalance")
    if not reb:
        return prev
    calls = [c for c in plan.required_tools if c.get("name") == "analyze_inventory_rebalancing"]
    key = "analyze_inventory_rebalancing" + (f"#{len(calls)}" if len(calls) > 1 else "")
    result = collected_data.get(key)
    if not isinstance(result, dict) or result.get("error"):
        return prev
    scenarios = [s for s in (prev or {}).get("scenarios") or [] if isinstance(s, dict)]
    dests = [{"id": w.get("id"), "name": w.get("name"), "code": w.get("code")} for w in reb.get("destinations") or []]
    ids = sorted(d["id"] for d in dests)
    budget = reb.get("budget_vnd")
    whatif = reb.get("whatif") or {}
    same = next((s for s in scenarios if s.get("budget_vnd") == budget and sorted(s.get("destination_ids") or []) == ids
                 and (s.get("whatif") or {}) == whatif), None)
    rec = result.get("recommendation") or {}
    if same is None:
        same = {"id": (scenarios[-1]["id"] + 1) if scenarios else 1, "budget_vnd": budget, "destinations": dests,
                "destination_ids": ids, "whatif": whatif, "best_option": rec.get("best_business_option"),
                "executable_option": rec.get("executable_option")}
        scenarios = (scenarios + [same])[-MAX_SCENARIOS:]
    return {"destinations": dests, "budget_vnd": budget, "whatif": whatif, "scenarios": scenarios,
            "selected_scenario_id": same["id"],
            "focus": reb.get("focus")}


def next_state(plan: QueryPlan, collected_data: dict, previous: dict | None = None,
               visualizations: list[dict] | None = None) -> dict:
    """Structured memory carried to the next turn: topic, entities, period,
    filters, budget and the items just shown (so "cuốn đầu tiên" / "trong số
    đó" resolve to real variant_ids, not to titles guessed from prose), and
    which chart was shown (so "đổi sang biểu đồ cột" knows what to redraw).
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
    warehouses = plan.entities.get("warehouses") or previous.get("warehouses") or []
    # Most recent first, distinct: "so sánh hai kho này" after two single-warehouse turns.
    recent: list[dict] = []
    for w in list(plan.entities.get("warehouses") or []) + list(previous.get("recent_warehouses") or []):
        if isinstance(w, dict) and w.get("id") and all(w["id"] != r["id"] for r in recent):
            recent.append(w)
    # The warehouse the comparison singled out ("kho nào đáng lo hơn" -> X), so
    # "kho còn lại" can mean the other one; kept only while the same warehouses
    # stay in focus.
    compared = collected_data.get("compare_warehouses")
    riskier = ((compared.get("comparison") or {}).get("riskier") if isinstance(compared, dict) else None)
    focus = next((w for w in warehouses if riskier and w.get("name") == riskier), None)
    if focus is None and warehouses == previous.get("warehouses"):
        focus = previous.get("focus_warehouse")
    rebalance = _rebalance_state(plan, collected_data, previous)
    return {
        "rebalance": rebalance,
        "capabilities": caps,
        "intent": plan.intent,
        "analysis": plan.requested_analysis,
        "warehouses": warehouses,
        "recent_warehouses": recent[:4],
        "focus_warehouse": focus,
        "time_range": plan.time_range or (previous.get("time_range") if set(caps) & TIME_AWARE else None),
        "comparison_period": plan.comparison_period,
        # a turn that only re-ranked the previous scenarios keeps their budgets
        "budgets": plan.entities.get("budgets_vnd") or (previous.get("budgets") or [] if "scenarios" in plan.carried_over
                                                        else []),
        "priority": plan.filters.get("priority"),
        "limit": plan.filters.get("limit"),
        "last_items": last_items or (previous.get("last_items") or []),
        "tools": [t["name"] for t in plan.required_tools],
        "tool_calls": plan.required_tools,
        "answer_mode": plan.answer_mode,
        "viz": _viz_state(visualizations, previous),
    }
