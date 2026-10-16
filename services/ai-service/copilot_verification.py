"""Structured decision verification for copilot answers (AI Copilot 3.2).

Number grounding (rag.verify_numeric_grounding) asks "does this number appear
anywhere in the data?"; the 3.1 validator (copilot_faithfulness) asks "does
this sentence use words that contradict the trend / ranking / scope?". Neither
asks "is this number the RIGHT number for what the sentence says it is?" -
so "đề xuất nhập 5 đầu sách" passed while 9 titles were approved (5 was the
count of high-priority titles), and "tháng này mới qua 13 ngày" passed on day
15.

This module adds that check, on top of (not instead of) the existing ones:

1. build_sheet()  - an evidence sheet from the SAME tool results the
   explanation (XAI 2.0) and the charts (3.0) were built from: every value
   with its role (approved cost vs budget, titles vs copies, total vs
   available, current vs previous period, one warehouse vs all), unit, source
   tool, snapshot time, data scope, warehouse, period and entity. Missing data
   (a tool error, a null cost, a truncated list) is recorded as missing, never
   as 0.
2. verify()       - deterministic claim extraction (numbers with their unit and
   role words, months/days/periods, warehouses/titles, comparisons and
   rankings, recommendations, budget compliance, optimality and causality)
   and a verdict per claim decided ONLY from the sheet:
   SUPPORTED / CONTRADICTED / UNSUPPORTED / UNVERIFIABLE. UNVERIFIABLE is not
   an error: a claim the sheet cannot decide is left alone (no false alarm).
   No LLM call.
3. repair()       - deterministic, conservative: a contradicted number is
   replaced only when its role is resolved, the token occurs once in the
   answer, it is not the head of a list the text then enumerates, and the
   re-check finds nothing new.

main._finalize_assistant_turn combines the result with the 3.1 findings into
one status: PASSED / REPAIRED / WARNING / BLOCKED. A critical contradiction
that neither the repair nor the single retry removed is BLOCKED: the answer
is replaced by a conclusion built from the explanation, and no AI action is
proposed for it.
"""
from __future__ import annotations

import logging
import re
import time
from dataclasses import dataclass, field

import copilot_faithfulness as cf
from copilot_tools import _risk_key
from intent import normalize_text

logger = logging.getLogger(__name__)

PASSED, REPAIRED, WARNING, BLOCKED = "PASSED", "REPAIRED", "WARNING", "BLOCKED"
SUPPORTED, CONTRADICTED, UNSUPPORTED, UNVERIFIABLE = "SUPPORTED", "CONTRADICTED", "UNSUPPORTED", "UNVERIFIABLE"
MINOR, MAJOR, CRITICAL = "minor", "major", "critical"

# claim categories -> claim type
NUMERIC, TEMPORAL, ENTITY_T, COMPARATIVE, DECISION = "numeric", "temporal", "entity", "comparative", "decision"
CATEGORY_TYPE = {
    "COUNT": NUMERIC, "MONEY": NUMERIC, "PERCENT": NUMERIC, "BUDGET": DECISION, "PERIOD": TEMPORAL,
    "TREND": COMPARATIVE, "RANKING": COMPARATIVE, "ENTITY": ENTITY_T, "SCOPE": ENTITY_T,
    "RECOMMENDATION": DECISION, "COVERAGE": DECISION, "OPTIMALITY": DECISION, "CAUSALITY": DECISION,
    "CONSTRAINT": DECISION, "ASSUMPTION": DECISION, "FORECAST": TEMPORAL, "MISSING_DATA": NUMERIC,
    "ASSESSMENT": COMPARATIVE, "OVERCLAIM": DECISION, "LABEL": DECISION, "CHART": COMPARATIVE,
}
# Reader-facing label of each category (the UI shows these, never codes).
LABELS = {
    "COUNT": "số lượng không khớp dữ liệu", "MONEY": "số tiền không khớp dữ liệu",
    "PERCENT": "tỷ lệ thay đổi không khớp dữ liệu", "BUDGET": "nhận định về ngân sách không khớp dữ liệu",
    "PERIOD": "nhầm kỳ thời gian (ngày/tháng/kỳ so sánh)", "TREND": "xu hướng không khớp dữ liệu",
    "RANKING": "so sánh/xếp hạng ngược với dữ liệu", "ENTITY": "số liệu gán nhầm kho/đầu sách",
    "SCOPE": "nhầm phạm vi (toàn hệ thống và từng kho)", "RECOMMENDATION": "khuyến nghị khác với thứ tự của hệ thống",
    "COVERAGE": "nói đáp ứng toàn bộ nhu cầu khi dữ liệu cho thấy chưa đủ",
    "OPTIMALITY": "gọi một phương án là tối ưu khi hệ thống không tối ưu hóa",
    "CAUSALITY": "khẳng định nguyên nhân không có trong dữ liệu",
    "CONSTRAINT": "nhắc tới ràng buộc mà dữ liệu chưa có", "ASSUMPTION": "trình bày giả định như dữ kiện đã kiểm chứng",
    "FORECAST": "dự báo không có trong dữ liệu", "MISSING_DATA": "coi dữ liệu thiếu/lỗi là bằng 0 hoặc là ổn",
    "ASSESSMENT": "đánh giá trái với quy tắc của hệ thống", "OVERCLAIM": "diễn đạt chắc chắn hơn mức bằng chứng",
    "LABEL": "nhãn nội bộ của hệ thống", "CHART": "phần giải thích và biểu đồ không khớp nhau",
}
CRITICAL_CATEGORIES = frozenset({"COUNT", "MONEY", "PERCENT", "BUDGET", "PERIOD", "TREND", "RANKING", "ENTITY", "SCOPE",
                                 "RECOMMENDATION", "COVERAGE", "MISSING_DATA", "ASSESSMENT", "CHART"})
MAJOR_CATEGORIES = frozenset({"OPTIMALITY", "CAUSALITY", "CONSTRAINT", "ASSUMPTION", "FORECAST"})

# 3.1 findings folded into the same report (same sentence -> one claim)
_FROM_31 = {
    cf.CONTRADICTION: "TREND", cf.RANKING_INCONSISTENCY: "RANKING", cf.SCOPE_CONFUSION: "SCOPE",
    cf.UNSUPPORTED_CAUSAL: "CAUSALITY", cf.UNSUPPORTED_RECOMMENDATION: "OPTIMALITY",
    cf.REASONING_OVERCLAIM: "OVERCLAIM", cf.EXPLANATION_CHART_MISMATCH: "CHART", cf.INTERNAL_LABEL: "LABEL",
}


# ── evidence sheet ───────────────────────────────────────────────────────────

@dataclass
class Fact:
    """One backend value with what it means. `role` is the meaning the claim
    checks compare against (never shown to users)."""
    role: str
    value: float | None
    unit: str
    label: str
    source: str
    scope: str = "system"            # system | warehouse
    warehouse: str | None = None
    entity: str | None = None        # title / scenario label
    period: str | None = None
    as_of: str | None = None
    derived: bool = False

    def public(self) -> dict:
        out = {"label": self.label, "value": self.value, "unit": self.unit, "source": self.source, "scope": self.scope}
        for key in ("warehouse", "period", "as_of"):
            if getattr(self, key):
                out[key] = getattr(self, key)
        if self.derived:
            out["derived"] = True
        return out


@dataclass
class Sheet:
    facts: list[Fact] = field(default_factory=list)
    scenarios: list[dict] = field(default_factory=list)
    full_need: dict = field(default_factory=dict)
    coverage_incomplete: bool = False
    reorder_summary: dict = field(default_factory=dict)
    first_recommended: str | None = None
    titles: dict = field(default_factory=dict)            # norm title -> {"name", "system": {...}, "warehouse": {...}}
    periods: dict = field(default_factory=dict)            # current/previous -> {...}
    period_loans: dict = field(default_factory=dict)       # current/previous -> {"total", "per_day"}
    unequal_periods: bool = False
    loan_pcts: list[float] = field(default_factory=list)
    other_pcts: dict = field(default_factory=dict)          # returns/reservations -> [pct]
    monthly: dict = field(default_factory=dict)             # (year, month) -> loans
    monthly_other: dict = field(default_factory=dict)       # (year, month) -> {"returns", "reservations"}
    daily_peak: float | None = None
    warehouses: dict = field(default_factory=dict)          # name -> risk row
    ranking: list[str] = field(default_factory=list)
    tie: bool = False
    low_items: dict = field(default_factory=dict)           # warehouse name -> {total, oos, truncated}
    shortage: dict = field(default_factory=dict)            # warehouse name -> summary
    overdue: dict = field(default_factory=dict)
    errors: dict = field(default_factory=dict)              # tool -> message
    borrow_data: bool = False
    has_forecast: bool = False
    unknowns: list[str] = field(default_factory=list)
    trend: str | None = None
    trend_pct: float | None = None
    evidence: list[dict] = field(default_factory=list)      # public per-tool evidence records


def _num(value) -> float | None:
    return float(value) if isinstance(value, (int, float)) and not isinstance(value, bool) else None


def _title_key(title: str | None) -> str:
    return re.sub(r"\s+", " ", normalize_text(re.sub(r"\(.*?\)", "", title or ""))).strip()


def _as_of(result) -> str | None:
    if isinstance(result, dict):
        return result.get("retrieved_at") or result.get("generated_at")
    return None


def _add_title(sheet: Sheet, item: dict, scope: str, warehouse: str | None = None) -> None:
    key = _title_key(item.get("title"))
    if len(key) < 3:
        return
    entry = sheet.titles.setdefault(key, {"name": item.get("title"), "system": {}, "warehouse": {}})
    target = entry["warehouse" if scope == "warehouse" else "system"]
    for k in ("available_qty", "on_hand_qty", "reorder_point", "borrow_count", "previous_borrow_count",
              "demand_trend_pct", "lead_time_days", "lead_time_source", "lead_time_samples", "suggested_reorder_qty",
              "estimated_cost", "unit_cost", "priority", "estimated_days_until_stockout"):
        if k in item and k not in target:
            target[k] = item[k]
    if warehouse:
        target.setdefault("warehouse", warehouse)


def build_sheet(collected: dict | None, explanation: dict | None = None, visualizations: list | None = None) -> Sheet:
    """The evidence sheet of one turn. Pure, never raises on odd shapes."""
    sheet = Sheet()
    collected = collected or {}
    ctx = cf.build_context(collected, explanation, visualizations)
    sheet.trend, sheet.trend_pct = ctx.trend, ctx.trend_pct
    for claim in (explanation or {}).get("claims") or []:
        if claim.get("kind") == "UNKNOWN":
            sheet.unknowns.append(normalize_text(claim.get("statement") or ""))
    for key, result in collected.items():
        base = key.split("#")[0]
        try:
            _ingest(sheet, base, result)
        except Exception:  # noqa: BLE001 - an odd shape only means fewer checkable claims
            logger.debug("verification sheet: could not read %s", base, exc_info=True)
    if sheet.warehouses:
        rows = sorted(sheet.warehouses.values(), key=_risk_key)
        sheet.ranking = [r["warehouse_name"] for r in rows]
        sheet.tie = len(rows) >= 2 and _risk_key(rows[0]) == _risk_key(rows[1])
    return sheet


def _record(sheet: Sheet, base: str, result, scope: str, *, warehouse: str | None = None, time_range: dict | None = None,
            limitations: list[str] | None = None, entities: int | None = None) -> None:
    rec = {"source": base, "as_of": _as_of(result), "scope": scope}
    if warehouse:
        rec["warehouse"] = warehouse
    if time_range:
        rec["time_range"] = time_range
    if limitations:
        rec["limitations"] = limitations
    if entities is not None:
        rec["entities"] = entities
    sheet.evidence.append(rec)


def _ingest(sheet: Sheet, base: str, r) -> None:
    if isinstance(r, dict) and r.get("error"):
        sheet.errors[base] = str(r["error"])
        sheet.evidence.append({"source": base, "scope": "unknown", "error": True,
                               "limitations": ["Không lấy được dữ liệu (lỗi truy xuất) — không được coi là 0."]})
        return
    as_of = _as_of(r)
    F = sheet.facts.append
    if base in cf._BORROW_TOOLS:
        sheet.borrow_data = True
    if base == "simulate_reorder_budget" and isinstance(r, dict):
        need = r.get("full_need") or {}
        sheet.full_need = need
        for role, unit, label in (("need.titles", "đầu sách", "Đầu sách cần nhập (toàn bộ)"),
                                  ("need.high_priority", "đầu sách", "Ưu tiên cao (toàn bộ)"),
                                  ("need.cost", "đ", "Chi phí nhu cầu đầy đủ"), ("need.copies", "bản", "Bản cần nhập (toàn bộ)")):
            src = {"need.titles": "total_candidates", "need.high_priority": "high_priority",
                   "need.cost": "estimated_total_cost", "need.copies": "estimated_total_reorder_qty"}[role]
            F(Fact(role, _num(need.get(src)), unit, label, base, as_of=as_of))
        scenarios = [s for s in r.get("scenarios") or [] if isinstance(s, dict) and not s.get("error")]
        for s in scenarios:
            sheet.scenarios.append({
                "label": s.get("label"), "budget": _num(s.get("budget_vnd")), "cost": _num(s.get("funded_cost")),
                "remaining": _num(s.get("remaining_vnd")), "titles": _num(s.get("funded_lines")),
                "copies": _num(s.get("funded_qty")), "hp_funded": _num(s.get("funded_high_priority")),
                "hp_unfunded": _num(s.get("unfunded_high_priority")), "diff": s.get("vs_first_scenario") or {},
                "funded_titles": [_title_key(x.get("title")) for x in s.get("funded_items") or [] if isinstance(x, dict)],
            })
            for role, k, unit in (("scenario.cost", "funded_cost", "đ"), ("scenario.titles", "funded_lines", "đầu sách"),
                                  ("scenario.copies", "funded_qty", "bản"), ("scenario.remaining", "remaining_vnd", "đ")):
                F(Fact(role, _num(s.get(k)), unit, f"{s.get('label')} — {k}", base, entity=s.get("label"), as_of=as_of))
            if s.get("unfunded_high_priority"):
                sheet.coverage_incomplete = True
        if r.get("items_not_listed"):
            sheet.coverage_incomplete = True
        lim = list(r.get("limitations") or [])
        if r.get("items_not_listed"):
            lim.append(f"{r['items_not_listed']} đầu sách ngoài danh sách chưa được tính.")
        _record(sheet, base, r, "system", limitations=lim, entities=len(scenarios))
    elif base == "get_reorder_suggestions" and isinstance(r, dict):
        s = r.get("summary") or {}
        sheet.reorder_summary = s
        for role, k, unit in (("reorder.titles", "total_candidates", "đầu sách"), ("reorder.high", "high_priority", "đầu sách"),
                              ("reorder.copies", "estimated_total_reorder_qty", "bản"), ("reorder.cost", "estimated_total_cost", "đ")):
            F(Fact(role, _num(s.get(k)), unit, k, base, as_of=as_of))
        items = [x for x in r.get("items") or [] if isinstance(x, dict) and x.get("title")]
        if r.get("budget"):
            within = [x for x in items if x.get("within_budget")]
            sheet.first_recommended = within[0]["title"] if within else None
            b = r["budget"]
            sheet.scenarios.append({"label": "budget", "budget": _num(b.get("budget_vnd")), "cost": _num(b.get("funded_cost")),
                                    "remaining": _num(b.get("remaining_vnd")), "titles": _num(b.get("funded_lines")),
                                    "copies": _num(b.get("funded_qty")), "hp_funded": None, "hp_unfunded": None, "diff": {},
                                    "funded_titles": [_title_key(x.get("title")) for x in within]})
        elif items:
            sheet.first_recommended = items[0]["title"]
        for x in items:
            _add_title(sheet, x, "system")
            if x.get("forecast_30d") is not None:
                sheet.has_forecast = True
        tr = r.get("range") or {}
        _record(sheet, base, r, "system", time_range={"from": tr.get("from"), "to": tr.get("to")} if tr else None,
                limitations=["Tồn kho và lượt mượn tính trên toàn hệ thống, chưa tách theo kho."], entities=len(items))
    elif base == "explain_reorder_item" and isinstance(r, dict) and r.get("found"):
        item = r.get("item") or {}
        _add_title(sheet, item, "system")
        _record(sheet, base, r, "system", entities=1)
    elif base == "analyze_demand_vs_stock" and isinstance(r, dict):
        rows = [x for x in r.get("rows") or [] if isinstance(x, dict) and x.get("title")]
        if rows and not sheet.first_recommended:
            sheet.first_recommended = rows[0]["title"]
        for x in rows:
            _add_title(sheet, x, "system")
        _record(sheet, base, r, "system", entities=len(rows))
    elif base == "compare_borrow_periods" and isinstance(r, dict):
        sheet.unequal_periods = bool(r.get("unequal_length"))
        metrics = r.get("metrics") or {}
        loans = metrics.get("loans") or {}
        for name, period_key, total_key, per_day_key in (("current", "current_period", "current", "current_per_day"),
                                                          ("previous", "previous_period", "previous", "previous_per_day")):
            sheet.periods[name] = r.get(period_key) or {}
            sheet.period_loans[name] = {"total": _num(loans.get(total_key)), "per_day": _num(loans.get(per_day_key))}
            F(Fact(f"loans.{name}", _num(loans.get(total_key)), "lượt", f"Lượt mượn kỳ {name}", base, period=name, as_of=as_of))
        for k in ("change_pct", "per_day_change_pct"):
            if _num(loans.get(k)) is not None:
                sheet.loan_pcts.append(float(loans[k]))
        for metric in ("returns", "reservations"):
            m = metrics.get(metric) or {}
            sheet.other_pcts[metric] = [float(m[k]) for k in ("change_pct", "per_day_change_pct") if _num(m.get(k)) is not None]
        cur = sheet.periods.get("current") or {}
        _record(sheet, base, r, "system", time_range={"from": cur.get("from"), "to": cur.get("to")},
                limitations=["Lượt mượn tính trên toàn thư viện."] + ([r["note"]] if r.get("note") else []))
    elif base == "get_borrow_trends" and isinstance(r, list):
        rows = [x for x in r if isinstance(x, dict) and isinstance(x.get("date"), str)]
        if rows and len(rows[0]["date"]) == 7:
            for x in rows:
                key = (int(x["date"][:4]), int(x["date"][5:7]))
                sheet.monthly[key] = _num(x.get("loans"))
                sheet.monthly_other[key] = {"returns": _num(x.get("returns")), "reservations": _num(x.get("reservations"))}
        elif rows:
            peak = max((_num(x.get("loans")) or 0) for x in rows)
            sheet.daily_peak = max(sheet.daily_peak or 0, peak)
        _record(sheet, base, r, "system", time_range={"from": rows[0]["date"], "to": rows[-1]["date"]} if rows else None,
                limitations=["Lượt mượn tính trên toàn thư viện."])
    elif base == "get_warehouse_stock_risk" and isinstance(r, list):
        for row in r:
            if isinstance(row, dict) and row.get("warehouse_name"):
                sheet.warehouses[row["warehouse_name"]] = row
        _record(sheet, base, r, "warehouse", entities=len(sheet.warehouses))
    elif base == "compare_warehouses" and isinstance(r, dict):
        for row in r.get("ranking") or []:
            if isinstance(row, dict) and row.get("warehouse_name"):
                sheet.warehouses[row["warehouse_name"]] = row
        _record(sheet, base, r, "warehouse", entities=len(r.get("ranking") or []))
    elif base == "get_warehouse_low_stock_items" and isinstance(r, dict):
        name = r.get("warehouse_name")
        sheet.low_items[name] = {"total": _num(r.get("total_items")), "oos": _num(r.get("out_of_stock_count")),
                                 "truncated": bool(r.get("truncated")), "listed": len(r.get("items") or [])}
        for x in r.get("items") or []:
            if isinstance(x, dict):
                _add_title(sheet, x, "warehouse", name)
        _record(sheet, base, r, "warehouse", warehouse=name,
                limitations=["Danh sách bị rút gọn: số dòng trả về ít hơn tổng."] if r.get("truncated") else None,
                entities=len(r.get("items") or []))
    elif base == "explain_warehouse_shortage" and isinstance(r, dict):
        name = r.get("warehouse_name")
        sheet.shortage[name] = r.get("summary") or {}
        for x in r.get("items") or []:
            if isinstance(x, dict):
                _add_title(sheet, x, "warehouse", name)
        _record(sheet, base, r, "warehouse", warehouse=name, entities=len(r.get("items") or []),
                limitations=["Lượt mượn của từng đầu sách tính trên toàn hệ thống."])
    elif base == "get_overdue_summary" and isinstance(r, dict):
        sheet.overdue = r
        _record(sheet, base, r, "system")
    else:
        _record(sheet, base, r, "system")


# ── text parsing ─────────────────────────────────────────────────────────────

_NUM = re.compile(r"(?<![\w/])([+\-−]?\d[\d.,]*\d|[+\-−]?\d)(?![\w/]|/\d)")
_DATE = re.compile(r"\b(\d{1,2})/(\d{1,2})(?:/(\d{2,4}))?\b")
_SCALE = {"trieu": 1e6, "tr": 1e6, "ty": 1e9, "nghin": 1e3, "ngan": 1e3, "k": 1e3}
_UNIT = re.compile(
    r"\s*(?P<scale>trieu|ty|nghin|ngan|tr\b|k\b)?\s*(?P<unit>%|₫|vnd\b|vnđ\b|dong\b|d\b|dau sach|tua sach|tua\b|ban\b|"
    r"luot|ngay\b|phieu|cuon|quyen|kho\b|lan\b|thang\b|nam\b|tuan\b)?")
_APPROX = re.compile(r"\b(khoang|gan|xap xi|tam|chung|hon|tren|duoi|it nhat|toi da|gan nhu)\s*$")


@dataclass
class Mention:
    raw: str
    values: list[float]
    begin: int
    finish: int
    unit: str | None
    approx: bool
    sig_digits: int
    scale: float

    def start(self) -> int:
        return self.begin

    def end(self) -> int:
        return self.finish


def _parse_values(token: str) -> tuple[list[float], int]:
    t = token.replace("−", "-")
    sign = -1.0 if t.startswith("-") else 1.0
    t = t.lstrip("+-")
    digits = len(re.sub(r"\D", "", t).lstrip("0")) or 1
    vals: list[float] = []
    if "." in t and "," in t:
        vals.append(float(t.replace(".", "").replace(",", ".")))
    elif "." in t:
        groups = t.split(".")
        if all(len(g) == 3 for g in groups[1:]):
            vals.append(float(t.replace(".", "")))
        vals.append(float(t) if t.count(".") == 1 else float(t.replace(".", "")))
    elif "," in t:
        groups = t.split(",")
        vals.append(float(t.replace(",", ".")) if t.count(",") == 1 else float(t.replace(",", "")))
        if all(len(g) == 3 for g in groups[1:]):
            vals.append(float(t.replace(",", "")))
    else:
        vals.append(float(t))
    # significant digits written (trailing zeros of an integer are not precision)
    sig = len(re.sub(r"\D", "", t).strip("0")) or 1
    return [sign * v for v in dict.fromkeys(vals)], min(digits, sig)


def mentions(norm: str) -> list[Mention]:
    """Numbers in a normalized clause with their unit; dates are skipped."""
    dates = [(m.start(), m.end()) for m in _DATE.finditer(norm)]
    out = []
    for m in _NUM.finditer(norm):
        if any(a <= m.start() < b for a, b in dates):
            continue
        before = norm[max(0, m.start() - 8):m.start()]
        if re.search(r"(thang|quy|nam|ngay)\s*$", before) and not re.search(r"\d", norm[m.end():m.end() + 1]):
            # "tháng 9", "năm 2026", "ngày 6" are period references, not quantities
            if not re.match(r"\s*(luot|ban|dau sach)", norm[m.end():]):
                continue
        u = _UNIT.match(norm, m.end())
        scale_word = (u.group("scale") or "").strip() if u else ""
        unit = (u.group("unit") or "").strip() if u else ""
        scale = _SCALE.get(scale_word, 1.0)
        if scale_word in ("trieu", "ty", "nghin", "ngan", "tr", "k") and unit in ("", "₫", "vnd", "vnđ", "dong", "d"):
            unit = "money"
        unit_map = {"%": "%", "₫": "money", "vnd": "money", "vnđ": "money", "dong": "money", "d": "money",
                    "dau sach": "titles", "tua sach": "titles", "tua": "titles", "ban": "copies", "luot": "events",
                    "ngay": "days", "phieu": "tickets", "cuon": "books", "quyen": "books", "kho": "warehouses",
                    "lan": "times", "thang": "months", "nam": "years", "tuan": "weeks", "money": "money"}
        vals, sig = _parse_values(m.group(1))
        approx = bool(_APPROX.search(norm[max(0, m.start() - 14):m.start()]))
        out.append(Mention(m.group(1), [v * scale for v in vals], m.start(), (u.end() if u and unit else m.end()),
                           unit_map.get(unit), approx, sig, scale))
    return out


def _step(m: Mention) -> float:
    """Resolution of the number as written: "68,4 triệu" -> 100.000,
    "82,8" -> 0,1, "9.987.000" -> 1."""
    raw = m.raw.lstrip("+-−")
    decimals = 0
    if "," in raw and "." not in raw and raw.count(",") == 1 and len(raw.split(",")[1]) != 3:
        decimals = len(raw.split(",")[1])
    elif "." in raw and "," not in raw and raw.count(".") == 1 and len(raw.split(".")[1]) != 3:
        decimals = len(raw.split(".")[1])
    return m.scale * 10 ** -decimals


def _matches(m: Mention, target: float | None, rel: float = 0.0) -> bool:
    if target is None:
        return False
    tol = 0.5 * _step(m) + 1e-9
    if m.approx and m.sig_digits <= 3:
        tol = max(tol, abs(target) * 0.05)
    if rel:
        tol = max(tol, abs(target) * rel)
    return any(abs(abs(v) - abs(target)) <= tol for v in m.values)


def _fmt(value: float | None, unit: str = "") -> str:
    if value is None:
        return "không có dữ liệu"
    if float(value).is_integer():
        text = f"{int(value):,}".replace(",", ".")
    else:
        text = f"{value:,.2f}".rstrip("0").rstrip(".").replace(",", "X").replace(".", ",").replace("X", ".")
    return f"{text} {unit}".strip() if unit else text


def _sentences(text: str) -> list[tuple[str, int]]:
    """Sentences with the index of the source line (for list detection)."""
    out = []
    for i, line in enumerate((text or "").split("\n")):
        plain = re.sub(r"[*_`#>]+", "", line)
        for part in re.split(r"(?<=[.!?;])\s+", plain):
            part = part.strip(" -•\t")
            if part:
                out.append((part, i))
    return out


_CLAUSE_SPLIT = re.compile(r"[,;:](?=\s|$)|\s(?=(?:con|trong khi|nhung|trong do|so voi)\b)")  # "82,8" stays one number


def _clauses(norm: str) -> list[tuple[int, str]]:
    out, pos = [], 0
    for m in _CLAUSE_SPLIT.finditer(norm):
        out.append((pos, norm[pos:m.start()]))
        pos = m.end() if norm[m.start()] in ",;:" else m.start() + 1
    out.append((pos, norm[pos:]))
    return [(p, c) for p, c in out if c.strip()]


def _wh_mentions(norm: str, names: list[str]) -> list[tuple[int, str]]:
    return cf._mentions(norm, names) if names else []


def _all_wh_mentions(norm: str, names: list[str]) -> list[tuple[int, str]]:
    found = []
    for name in names:
        for alias in cf._alias(name):
            for m in re.finditer(rf"(?<!\w){re.escape(alias)}(?!\w)", norm):
                if not any(abs(m.start() - p) < 3 for p, _ in found):
                    found.append((m.start(), name))
            if any(n == name for _, n in found):
                break
    return sorted(found)


def _titles_in(norm: str, sheet: Sheet) -> list[str]:
    found = []
    for key in sheet.titles:
        if len(key) >= 4 and re.search(rf"(?<!\w){re.escape(key)}(?!\w)", norm):
            found.append(key)
    # a title contained in a longer matched title is the same mention
    return [k for k in found if not any(k != o and k in o for o in found)]


# ── claims ───────────────────────────────────────────────────────────────────

@dataclass
class Claim:
    text: str
    category: str
    verdict: str
    detail: str = ""
    expected: str | None = None
    evidence: list[dict] = field(default_factory=list)
    severity: str | None = None
    token: str | None = None          # the number as written (repair)
    replacement: str | None = None    # its correct value, written the same way
    line: int | None = None

    @property
    def type(self) -> str:
        return CATEGORY_TYPE.get(self.category, NUMERIC)

    def public(self) -> dict:
        out = {"text": self.text[:200], "type": self.type, "category": self.category, "label": LABELS[self.category],
               "verdict": self.verdict, "severity": self.severity, "detail": self.detail}
        if self.expected:
            out["expected"] = self.expected
        if self.evidence:
            out["evidence"] = self.evidence[:4]
        return out


def _severity(category: str, verdict: str) -> str | None:
    if verdict == CONTRADICTED:
        return CRITICAL if category in CRITICAL_CATEGORIES else MAJOR
    if verdict == UNSUPPORTED:
        if category in MAJOR_CATEGORIES or category == "SCOPE":
            return MAJOR
        return MINOR
    return None


def _claim(out: list, text: str, category: str, verdict: str, detail: str = "", *, expected: str | None = None,
           evidence: list | None = None, token: str | None = None, replacement: str | None = None, line=None) -> None:
    out.append(Claim(text[:200], category, verdict, detail, expected, evidence or [], _severity(category, verdict),
                     token, replacement, line))


def _replacement(token: str, value: float) -> str:
    """`value` written like `token` was (thousands dots, decimal comma)."""
    if "," in token and "." not in token and not float(value).is_integer():
        return f"{value:.{len(token.split(',')[1])}f}".replace(".", ",")
    if float(value).is_integer():
        v = int(value)
        return f"{v:,}".replace(",", ".") if ("." in token or v >= 10000) else str(v)
    return f"{value:g}".replace(".", ",")


_FUNDED = re.compile(r"\b(duyet|nhap duoc|cho phep nhap|duoc nhap|mua duoc|de xuat nhap|chon|nhap|cho)\s*(duoc|them|ngay)?\s*$")
_FUNDED_ANY = re.compile(r"\b(duyet|nhap duoc|cho phep nhap|duoc nhap|mua duoc|de xuat nhap)\b")
_DIFF = re.compile(r"\b(them|tang them|chi them|so voi|chenh lech|nhieu hon|tu .{1,30} len|chuyen tu|giam tu)\b")
_CANDIDATES = re.compile(r"^\s*(can (xem xet )?nhap|can bo sung|trong danh sach|duoc de xuat|de xuat nhap)")


def _scenario_refs(norm: str, sheet: Sheet) -> list[dict]:
    """Scenarios a sentence names by their budget ("10 triệu", "10.000.000 ₫");
    a budget amount after "thêm"/"tăng" is a difference, not a scenario."""
    refs = []
    for m in mentions(norm):
        if m.unit != "money":
            continue
        if re.search(r"(them|tang|giam|bot|cat)\s*$", norm[max(0, m.start() - 10):m.start()]):
            continue
        for s in sheet.scenarios:
            if s["budget"] and any(abs(abs(v) - s["budget"]) < 1 for v in m.values) and s not in refs:
                refs.append(s)
    return refs


_NEED = re.compile(r"\b(nhu cau (nhap )?(day du|thuc te|toan bo)|toan bo nhu cau|de dap ung (day du|toan bo|het)|tong nhu cau|"
                   r"nhu cau nhap hang)\b")


def _check_budget(sent: str, norm: str, sheet: Sheet, out: list, line: int, carry: dict) -> None:
    if not sheet.scenarios:
        return
    refs = _scenario_refs(norm, sheet)
    diff_ctx = bool(_DIFF.search(norm)) or len(refs) >= 2
    if len(refs) == 1:
        carry["scenario"] = refs[0]
    scenario = refs[0] if len(refs) == 1 else (carry.get("scenario") if not refs else None)
    explicit = len(refs) == 1
    pool = [scenario] if explicit else sheet.scenarios

    def diffs(field_: str) -> list[float]:
        vals = [s[field_] for s in sheet.scenarios if s.get(field_) is not None]
        return [abs(b - a) for i, a in enumerate(vals) for b in vals[i + 1:]]

    # budget compliance
    over = [s for s in sheet.scenarios if s["budget"] and s["cost"] is not None and s["cost"] > s["budget"]]
    if re.search(r"\bvuot (qua )?(muc )?ngan sach\b", norm) and not cf._negated(norm, norm.find("vuot")):
        if not over:
            _claim(out, sent, "BUDGET", CONTRADICTED, "Mọi phương án trong dữ liệu đều có chi phí duyệt không vượt ngân sách.",
                   expected="không vượt ngân sách",
                   evidence=[{"label": f"{s['label']}: chi phí duyệt", "value": s["cost"], "unit": "đ"} for s in sheet.scenarios[:3]],
                   line=line)
    elif re.search(r"\b(nam trong|khong vuot|trong pham vi) (muc )?ngan sach\b", norm):
        _claim(out, sent, "BUDGET", CONTRADICTED if over else SUPPORTED,
               "Có phương án vượt ngân sách." if over else "Chi phí duyệt không vượt ngân sách.", line=line)
    # coverage
    # word boundaries matter: "đáp ứng được 0%" must not read as "đáp ứng đủ"
    # "toàn bộ nhu cầu cần X ₫" alone is a cost, not a claim that it is met
    m = re.search(r"\b(dap ung|bu dap|bao phu) (duoc )?(toan bo|day du|het|du|100\s*%)(?!\w)( nhu cau)?", norm)
    if m and sheet.coverage_incomplete and not cf._negated(norm, m.start()) \
            and not re.search(r"(dong|dau sach) (duoc )?(liet ke|chon|duyet)|trong danh sach|cua (cac dong|danh sach)", norm) \
            and not re.search(r"\b(van con|con lai)\b[^.]{0,40}\bchua\b", norm) \
            and not re.search(r"\b(chi phi|can|tong)\b[^.]{0,30}\bde dap ung\b", norm):
        # (the last two: the sentence says what is left, or gives the COST of full coverage)
        unfunded = max((s["hp_unfunded"] or 0) for s in sheet.scenarios)
        _claim(out, sent, "COVERAGE", CONTRADICTED,
               f"Dữ liệu cho thấy vẫn còn đầu sách ưu tiên cao chưa được duyệt (tới {_fmt(unfunded)}) và nhu cầu đầy đủ "
               f"cần {_fmt(sheet.full_need.get('estimated_total_cost'), 'đ')}.",
               expected="chưa đáp ứng toàn bộ nhu cầu", line=line)

    if _NEED.search(norm) and not re.search(r"\b(duyet|ngan sach \d)", norm):
        # a sentence about the FULL need ("tổng chi phí để đáp ứng đầy đủ nhu cầu là …
        # cho 94 đầu sách"), not about what a scenario approves
        _check_full_need(sent, norm, sheet, out, line)
        return
    for c_start, clause in _clauses(norm):
        ms = mentions(clause)
        prev_end = 0
        for mm in ms:
            before = clause[prev_end:mm.start()]
            after = clause[mm.end():mm.end() + 45]
            prev_end = mm.end()
            role = None
            if mm.unit == "titles":
                if re.match(r"\s*uu tien cao", after):
                    role = "hp_unfunded" if re.search(r"chua (duoc )?(nhap|duyet)|bi bo lai|chua duoc", after) else (
                        "hp_funded" if (_FUNDED.search(before) or re.search(r"(duoc|da) (nhap|duyet)|vao danh sach duoc duyet",
                                                                             after)) else None)
                elif _CANDIDATES.match(after):
                    continue  # the full candidate list, checked by _check_counts
                elif _FUNDED.search(before) or re.match(r"\s*(duoc|da) (duyet|nhap|chon)", after) or _FUNDED_ANY.search(clause[:mm.start()]):
                    role = "titles"
            elif mm.unit == "copies":
                if _FUNDED.search(before) or re.search(r"dau sach\s*\(\s*$", clause[:mm.start()]) \
                        or re.search(r"\btong( cong)?\s*$", before) \
                        or (_FUNDED_ANY.search(clause[:mm.start()]) and not _titles_in(clause, sheet)):
                    role = "copies"
            elif mm.unit == "money":
                if re.search(r"(con (du|lai)|du ra|thua)\s*(la |chi |khoang |gan |chung )*$", before):
                    role = "remaining"
                elif re.search(r"(chi phi (duoc )?duyet|tong chi phi|ton|het|dung( het)?|chi|chi phi)\s*(la |khoang |gan |chi )?$",
                               before):
                    role = "cost"
                elif re.search(r"(chi them|tang them|them|chenh lech)\s*(khoang |gan )?$", before):
                    role = "diff_cost"
            if role is None:
                continue
            field_ = {"titles": "titles", "copies": "copies", "cost": "cost", "remaining": "remaining",
                      "hp_funded": "hp_funded", "hp_unfunded": "hp_unfunded", "diff_cost": "cost"}[role]
            unit = {"titles": "đầu sách", "copies": "bản"}.get(field_, "đầu sách" if field_.startswith("hp") else "đ")
            if role == "diff_cost":
                allowed = diffs("cost") + [_num((s["diff"] or {}).get("funded_cost")) for s in sheet.scenarios]
                allowed = [a for a in allowed if a is not None]
                if not allowed:
                    continue
                if any(_matches(mm, a) for a in allowed):
                    _claim(out, sent, "MONEY", SUPPORTED, "Chênh lệch chi phí khớp dữ liệu.", line=line)
                else:
                    good = allowed[-1]
                    _claim(out, sent, "MONEY", CONTRADICTED, f"Chênh lệch chi phí duyệt giữa các phương án là {_fmt(good, 'đ')}.",
                           expected=_fmt(good, "đ"), token=mm.raw, replacement=_replacement(mm.raw, good) if len(allowed) == 1 else None,
                           evidence=[{"label": "Chênh lệch chi phí duyệt", "value": good, "unit": "đ", "derived": True}], line=line)
                continue
            targets = [s[field_] for s in pool if s and s.get(field_) is not None]
            if diff_ctx and field_ in ("titles", "copies", "hp_funded", "hp_unfunded", "cost"):
                targets += diffs(field_)
            if not targets:
                continue
            if any(_matches(mm, t) for t in targets):
                _claim(out, sent, "MONEY" if unit == "đ" else "COUNT", SUPPORTED, "Khớp dữ liệu mô phỏng ngân sách.", line=line)
                continue
            if not explicit and not scenario:
                continue  # which scenario is meant cannot be told: leave it to the number check
            s = scenario
            truth = s.get(field_)
            confused = _confused_with(mm, s, field_)
            category = "MONEY" if unit == "đ" else "COUNT"
            detail = f"{s['label']}: {_ROLE_VI[field_]} là {_fmt(truth, unit)}"
            if confused:
                detail += f"; {_fmt(mm.values[0], unit if field_ not in ('titles',) else '')} là {confused}"
            _claim(out, sent, category, CONTRADICTED, detail + ".", expected=_fmt(truth, unit),
                   evidence=[{"label": f"{s['label']}: {_ROLE_VI[field_]}", "value": truth, "unit": unit,
                              "source": "simulate_reorder_budget"}],
                   token=mm.raw, replacement=_replacement(mm.raw, truth) if (explicit and not diff_ctx) else None, line=line)


def _check_full_need(sent: str, norm: str, sheet: Sheet, out: list, line: int) -> None:
    need = sheet.full_need or {}
    roles = {"titles": (need.get("total_candidates"), need.get("high_priority")), "copies": (need.get("estimated_total_reorder_qty"),),
             "money": (need.get("estimated_total_cost"),)}
    for m in mentions(norm):
        truths = [t for t in roles.get(m.unit, ()) if isinstance(t, (int, float))]
        if not truths:
            continue
        if any(_matches(m, t) for t in truths):
            _claim(out, sent, "MONEY" if m.unit == "money" else "COUNT", SUPPORTED, "Khớp nhu cầu nhập đầy đủ.", line=line)
        elif not any(_matches(m, s.get(k)) for s in sheet.scenarios for k in ("budget", "cost", "titles", "copies")):
            unit = {"money": "đ", "titles": "đầu sách", "copies": "bản"}[m.unit]
            _claim(out, sent, "MONEY" if m.unit == "money" else "COUNT", CONTRADICTED,
                   f"Nhu cầu nhập đầy đủ: {_fmt(truths[0], unit)}.", expected=_fmt(truths[0], unit), line=line)


_ROLE_VI = {"titles": "số đầu sách được duyệt", "copies": "số bản được duyệt", "cost": "chi phí được duyệt",
            "remaining": "ngân sách còn lại", "hp_funded": "số đầu sách ưu tiên cao được duyệt",
            "hp_unfunded": "số đầu sách ưu tiên cao chưa được duyệt", "budget": "ngân sách"}


def _confused_with(m: Mention, scenario: dict, field_: str) -> str | None:
    for other in ("titles", "copies", "hp_funded", "hp_unfunded", "cost", "remaining", "budget"):
        if other != field_ and _matches(m, scenario.get(other)):
            return _ROLE_VI[other]
    return None


def _check_counts(sent: str, norm: str, sheet: Sheet, out: list, line: int, carry: dict) -> None:
    """Counts with a role word: out of stock / below threshold per warehouse
    or system-wide, reorder candidates, overdue loans/items, shortage factors."""
    names = list(sheet.warehouses) or [n for n in list(sheet.low_items) + list(sheet.shortage) if n]
    sys_ctx = re.search(r"\b(toan he thong|toan thu vien|tat ca (cac )?kho|ca (\d+|hai|ba|bon|nam) kho|cong (ca|tat ca|lai))\b", norm)
    # A warehouse named earlier in the SAME sentence carries to its later
    # clauses ("Kho X có 12 dưới ngưỡng, trong đó 4 hết hàng"); never across
    # sentences - "kho này" two sentences later may be another warehouse.
    sentence_wh = None
    for c_start, clause in _clauses(norm):
        # a warehouse named in an aside "(trong khi Kho Hà Nội không có)" is not the
        # subject of the numbers around it
        outside = re.sub(r"\([^)]*\)", lambda g: " " * len(g.group(0)), clause)
        whs = _all_wh_mentions(outside, names)
        if len({n for _, n in whs}) == 1:
            sentence_wh = whs[0][1]
        warehouse = whs[0][1] if len({n for _, n in whs}) == 1 else (sentence_wh if not whs else None)
        if not whs and len(names) == 1:
            warehouse = names[0]
        zero = re.search(r"\b(khong|chua) co (dau sach|sach|tua) nao (bi |da )?(het hang|het|duoi nguong)", clause)
        values = [(m, m.values) for m in mentions(clause) if m.unit in ("titles", "tickets", "books", "copies")]
        if zero:
            values.append((None, [0.0]))
        for m, vals in values:
            tail = clause[m.end():][:45] if m else clause[zero.start():]
            role = ("oos" if re.search(r"\bhet( hang)?\b", tail) and not re.search(r"duoi nguong", tail[:12]) else
                    "low" if "duoi nguong" in tail else
                    "rising" if re.search(r"nhu cau (lai |dang )?tang", tail) else
                    "demand" if re.search(r"(co (nguoi|luot) muon|co nhu cau|duoc muon)", tail) else
                    "candidates" if _CANDIDATES.match(tail) else
                    "overdue_loans" if (m and m.unit == "tickets" and "qua han" in clause) else
                    "overdue_items" if (m and m.unit in ("books", "copies") and "qua han" in clause or
                                        m and m.unit in ("books", "copies") and "chua tra" in tail) else None)
            if role is None or (m and m.unit == "copies" and role not in ("overdue_items",)):
                continue
            unit = "phiếu" if role == "overdue_loans" else "cuốn" if role == "overdue_items" else "đầu sách"
            if role in ("oos", "low") and m and m.unit != "titles" and m.unit is not None:
                continue
            if role in ("oos", "low") and sys_ctx and sheet.warehouses:
                key = "out_of_stock_variants" if role == "oos" else "low_stock_variants"
                total = sum((r.get(key) or 0) for r in sheet.warehouses.values())
                ok = any(abs(v - total) < 0.5 for v in vals)
                single = [n for n, r in sheet.warehouses.items() if any(abs(v - (r.get(key) or 0)) < 0.5 for v in vals)]
                if ok:
                    _claim(out, sent, "COUNT", SUPPORTED, "Khớp tổng các kho.", line=line)
                elif single:
                    _claim(out, sent, "SCOPE", CONTRADICTED,
                           f"Cộng {len(sheet.warehouses)} kho trong dữ liệu là {_fmt(total)} đầu sách; "
                           f"{_fmt(vals[0])} là số của {single[0]}.", expected=_fmt(total, "đầu sách"),
                           evidence=[{"label": f"Tổng {len(sheet.warehouses)} kho", "value": total, "unit": "đầu sách",
                                      "derived": True}], line=line)
                else:
                    _claim(out, sent, "SCOPE", UNSUPPORTED,
                           f"Tổng các kho trong dữ liệu (theo phạm vi kho của bạn) là {_fmt(total)} đầu sách.", line=line)
                continue
            truth, label, others = _count_truth(role, warehouse, sheet)
            if truth is None:
                continue
            if any(abs(v - truth) < 0.5 for v in vals):
                _claim(out, sent, "COUNT", SUPPORTED, f"Khớp dữ liệu ({label}).", line=line)
                continue
            other_wh = [n for n, val in others if any(abs(v - val) < 0.5 for v in vals)]
            other_role = _other_role(vals, role, warehouse, sheet)
            category = "ENTITY" if other_wh else "COUNT"
            detail = f"{label}: {_fmt(truth, unit)}"
            if other_wh:
                detail += f"; {_fmt(vals[0])} là số của {other_wh[0]}"
            elif other_role:
                detail += f"; {_fmt(vals[0])} là {other_role}"
            _claim(out, sent, category, CONTRADICTED, detail + ".", expected=_fmt(truth, unit),
                   evidence=[{"label": label, "value": truth, "unit": unit, "scope": "warehouse" if warehouse else "system"}],
                   token=m.raw if m else None, replacement=_replacement(m.raw, truth) if m else None, line=line)


def _count_truth(role: str, warehouse: str | None, sheet: Sheet) -> tuple[float | None, str, list]:
    """(value, label, [(other warehouse, its value)]) for a count role."""
    if role in ("oos", "low"):
        key_risk = "out_of_stock_variants" if role == "oos" else "low_stock_variants"
        key_low = "oos" if role == "oos" else "total"
        key_short = "out_of_stock_items" if role == "oos" else "low_stock_items"
        word = "đầu sách hết hàng" if role == "oos" else "đầu sách dưới ngưỡng tồn tối thiểu"
        if warehouse:
            for source, key in ((sheet.low_items, key_low), (sheet.shortage, key_short)):
                if warehouse in source and _num(source[warehouse].get(key)) is not None:
                    return source[warehouse][key], f"{warehouse} — {word}", []
            if warehouse in sheet.warehouses:
                others = [(n, r.get(key_risk) or 0) for n, r in sheet.warehouses.items() if n != warehouse]
                return _num(sheet.warehouses[warehouse].get(key_risk)), f"{warehouse} — {word}", others
        return None, "", []
    if role in ("rising", "demand"):
        if warehouse and warehouse in sheet.shortage:
            key = "items_with_rising_demand" if role == "rising" else "items_with_recent_demand"
            label = "đầu sách đang thiếu có nhu cầu tăng" if role == "rising" else "đầu sách đang thiếu vẫn có lượt mượn"
            return _num(sheet.shortage[warehouse].get(key)), f"{warehouse} — {label}", []
        return None, "", []
    if role == "candidates":
        if sheet.reorder_summary:
            return _num(sheet.reorder_summary.get("total_candidates")), "Số đầu sách cần xem xét nhập", []
        if sheet.full_need:
            return _num(sheet.full_need.get("total_candidates")), "Số đầu sách cần nhập (toàn bộ)", []
        return None, "", []
    if role == "overdue_loans" and sheet.overdue:
        return _num(sheet.overdue.get("total_overdue_loans")), "Số phiếu mượn quá hạn", []
    if role == "overdue_items" and sheet.overdue:
        return _num(sheet.overdue.get("total_overdue_items")), "Số cuốn sách quá hạn chưa trả", []
    return None, "", []


def _other_role(vals: list[float], role: str, warehouse: str | None, sheet: Sheet) -> str | None:
    cands = []
    if warehouse in sheet.warehouses:
        r = sheet.warehouses[warehouse]
        cands += [("số đầu sách dưới ngưỡng", r.get("low_stock_variants")), ("số đầu sách hết hàng", r.get("out_of_stock_variants"))]
    if warehouse in sheet.shortage:
        s = sheet.shortage[warehouse]
        cands += [("số đầu sách đang thiếu vẫn có lượt mượn", s.get("items_with_recent_demand")),
                  ("số đầu sách dưới ngưỡng", s.get("low_stock_items"))]
    if warehouse in sheet.low_items:
        cands.append(("số dòng được liệt kê (danh sách bị rút gọn)", sheet.low_items[warehouse].get("listed")))
    if sheet.reorder_summary:
        cands.append(("số đầu sách ưu tiên cao", sheet.reorder_summary.get("high_priority")))
    if sheet.overdue:
        cands += [("số cuốn sách quá hạn", sheet.overdue.get("total_overdue_items")),
                  ("số phiếu quá hạn", sheet.overdue.get("total_overdue_loans"))]
    for label, value in cands:
        if value is not None and any(abs(v - value) < 0.5 for v in vals):
            return label
    return None


def _check_reorder_money(sent: str, norm: str, sheet: Sheet, out: list, line: int) -> None:
    """Total cost of the reorder list (no budget scenario): "cần khoảng 68,4 triệu"."""
    total = _num(sheet.reorder_summary.get("estimated_total_cost")) if sheet.reorder_summary else _num(
        sheet.full_need.get("estimated_total_cost"))
    if total is None or not re.search(r"\b(toan bo|nhap du|nhap het|tat ca|tong chi phi|tong cong)\b", norm):
        return
    if re.search(r"\b(rieng|moi) (dau sach|cuon|tua)\b|\b(dau sach|cuon) nay\b", norm):
        return
    if sheet.scenarios and re.search(r"\b(duyet|ngan sach)\b", norm):
        return
    for m in mentions(norm):
        if m.unit != "money":
            continue
        if _matches(m, total):
            _claim(out, sent, "MONEY", SUPPORTED, "Khớp chi phí ước tính của toàn bộ danh sách.", line=line)
        elif any(_matches(m, f.value) for f in sheet.facts if f.unit == "đ") or any(
                _matches(m, t[k].get("estimated_cost")) for t in sheet.titles.values() for k in ("system", "warehouse")):
            continue
        else:
            _claim(out, sent, "MONEY", CONTRADICTED, f"Chi phí ước tính của toàn bộ danh sách đề xuất là {_fmt(total, 'đ')}.",
                   expected=_fmt(total, "đ"), token=m.raw, replacement=_replacement(m.raw, total) if m.scale == 1 else None,
                   evidence=[{"label": "Chi phí ước tính toàn bộ", "value": total, "unit": "đ"}], line=line)


_PCT_VERB = re.compile(r"(tang|giam|sut giam|di len|di xuong|suy giam)\s*(manh |nhe |khoang |gan |toi |den |them )*$")
_PCT_SUBJECT = re.compile(r"\b(luot muon|muon sach|so luot|nhu cau muon|hoat dong muon|luot tra|dat cho|luot dat)\b")


def _check_percents(sent: str, norm: str, sheet: Sheet, out: list, line: int, carry: dict) -> None:
    for c_start, clause in _clauses(norm):
        if "ngan sach" in clause:
            continue
        titles = _titles_in(clause, sheet)
        for m in mentions(clause):
            if m.unit != "%":
                continue
            before = clause[max(0, m.start() - 22):m.start()]
            verb = _PCT_VERB.search(before)
            sign = -1 if m.raw.startswith(("-", "−")) else (1 if m.raw.startswith("+") else 0)
            if verb:
                sign = -1 if re.search(r"giam|xuong|sut", verb.group(1)) else 1
            if not sign:
                continue
            title = titles[0] if len(titles) == 1 else None
            if title:
                pct = (sheet.titles[title]["system"] or {}).get("demand_trend_pct")
                if pct is None:
                    pct = (sheet.titles[title]["warehouse"] or {}).get("demand_trend_pct")
                cands = [float(pct)] if isinstance(pct, (int, float)) else []
                subject = sheet.titles[title]["name"]
            elif _PCT_SUBJECT.search(clause) or _PCT_SUBJECT.search(norm):
                subjects = (("returns", r"luot tra|hoan tra"), ("reservations", r"dat cho|luot dat|dat sach"),
                            ("loans", r"luot muon|muon sach|nhu cau muon|hoat dong muon"))
                # the subject is in the clause, else in the sentence ("Lượt trả: … (-63%)")
                kinds = [k for k, pattern in subjects if re.search(pattern, clause)] \
                    or [k for k, pattern in subjects if re.search(pattern, norm)] or ["loans"]
                cands = []
                for kind in kinds:  # "lượt trả và lượt đặt chỗ giảm (-20% và -8,9%)": either subject's change
                    cands += sheet.other_pcts.get(kind, []) if kind != "loans" else list(sheet.loan_pcts)
                    if kind == "loans" and isinstance(sheet.trend_pct, (int, float)):
                        cands.append(float(sheet.trend_pct))  # first vs last complete bucket of the chart series
                subject = " / ".join({"loans": "lượt mượn", "returns": "lượt trả", "reservations": "lượt đặt chỗ"}[k] for k in kinds)
            else:
                continue
            if not cands:
                continue
            mag = abs(m.values[0])
            same = [c for c in cands if _pct_close(m, mag, c) and (c > 0) == (sign > 0)]
            flipped = [c for c in cands if _pct_close(m, mag, c) and (c > 0) != (sign > 0) and c != 0]
            if same:
                _claim(out, sent, "PERCENT", SUPPORTED, f"Khớp mức thay đổi của {subject}.", line=line)
            elif flipped:
                _claim(out, sent, "PERCENT", CONTRADICTED,
                       f"Dữ liệu: {subject} {'giảm' if flipped[0] < 0 else 'tăng'} {_fmt(abs(flipped[0]))}% — ngược chiều.",
                       expected=f"{'giảm' if flipped[0] < 0 else 'tăng'} {_fmt(abs(flipped[0]))}%",
                       evidence=[{"label": f"Thay đổi {subject}", "value": flipped[0], "unit": "%"}], line=line)
            else:
                good = cands[-1] if title is None and len(cands) > 1 and sheet.unequal_periods else cands[0]
                _claim(out, sent, "PERCENT", CONTRADICTED,
                       f"Mức thay đổi của {subject} trong dữ liệu: " + ", ".join(f"{_fmt(c)}%" for c in cands[:3]) + ".",
                       expected=f"{_fmt(good)}%", evidence=[{"label": f"Thay đổi {subject}", "value": c, "unit": "%"} for c in cands[:3]],
                       line=line)


def _pct_close(m: Mention, mag: float, c: float) -> bool:
    c = abs(c)
    if abs(mag - c) <= 0.06:
        return True
    if float(mag).is_integer() and abs(mag - c) < 1.0:   # "giảm 17%" for -16.6 / -17.0
        return True
    return m.approx and abs(mag - c) <= max(1.0, c * 0.05)


_MONTH = re.compile(r"\bthang\s+(\d{1,2})(?:\s*/\s*(\d{4}))?\b")
_PEAK_DAY = re.compile(r"\bngay\s+(\w+\s+){0,2}(cao diem|dong nhat|cao nhat|nhieu nhat|nhieu luot)")


def _check_periods(sent: str, norm: str, sheet: Sheet, out: list, line: int) -> None:
    cur = sheet.periods.get("current") or {}
    # (a) "tháng này mới qua 13 ngày" -> current period length
    m = re.search(r"\b(moi qua|da qua|qua duoc|moi duoc|chi moi qua|moi di qua)\s+(\d{1,3})\s+ngay\b|\b(\d{1,3}) ngay dau (thang|ky)\b", norm)
    if m and cur.get("days") and sheet.unequal_periods:
        token = m.group(2) or m.group(3)
        days = int(token)
        if days == int(cur["days"]):
            _claim(out, sent, "PERIOD", SUPPORTED, "Khớp số ngày của kỳ hiện tại.", line=line)
        else:
            _claim(out, sent, "PERIOD", CONTRADICTED,
                   f"Kỳ hiện tại tính từ {_vn(cur.get('from'))} đến {_vn(cur.get('to'))}: {cur['days']} ngày.",
                   expected=f"{cur['days']} ngày", token=token, replacement=str(int(cur["days"])),
                   evidence=[{"label": "Số ngày kỳ hiện tại", "value": cur["days"], "unit": "ngày"}], line=line)
    # (b) peak DAY
    if _PEAK_DAY.search(norm):
        loans = [mm for mm in mentions(norm) if mm.unit in ("events", None) and mm.values and mm.values[0] >= 1]
        month_vals = {v for v in sheet.monthly.values() if v is not None}
        date = _DATE.search(norm[_PEAK_DAY.search(norm).start():])
        if sheet.monthly and any(any(_matches(mm, v) for v in month_vals) for mm in loans) and not date:
            v = next(v for v in month_vals for mm in loans if _matches(mm, v))
            peak = sheet.periods.get("current", {}).get("peak_loans") or sheet.daily_peak
            _claim(out, sent, "PERIOD", CONTRADICTED,
                   f"{_fmt(v)} lượt là tổng của cả một tháng, không phải số lượt của một ngày"
                   + (f" (ngày cao điểm có {_fmt(peak)} lượt)." if peak else "."),
                   expected="tổng tháng, không phải một ngày", line=line)
        elif date:
            for name in ("current", "previous"):
                p = sheet.periods.get(name) or {}
                peak_day = str(p.get("peak_day") or "")[:10]
                if not peak_day:
                    continue
                y, mo, d = (int(x) for x in peak_day.split("-"))
                if int(date.group(2)) == mo:
                    if int(date.group(1)) == d:
                        _claim(out, sent, "PERIOD", SUPPORTED, "Khớp ngày cao điểm.", line=line)
                    else:
                        _claim(out, sent, "PERIOD", CONTRADICTED, f"Ngày cao điểm của kỳ là {d:02d}/{mo:02d}/{y}"
                               + (f" với {_fmt(p.get('peak_loans'))} lượt." if p.get("peak_loans") else "."),
                               expected=f"{d:02d}/{mo:02d}", line=line)
                    break
    # (c) month <-> value in a monthly series / a two-period comparison
    for c_start, clause in _clauses(norm):
        months = [(int(a), int(b) if b else None) for a, b in _MONTH.findall(clause)]
        refs = set()
        if re.search(r"\b(thang|ky|tuan) (nay|hien tai)\b", clause):
            refs.add("current")
        if re.search(r"\b(thang|ky|tuan) (truoc|so sanh)\b", clause):
            refs.add("previous")
        dates = [int(mo) for _d, mo, _y in _DATE.findall(clause)]
        values = [mm for mm in mentions(clause) if mm.unit == "events"]
        if not values:
            continue
        if sheet.monthly and len(set(mo for mo, _ in months)) == 1:
            mo, yr = months[0]
            key = next((k for k in sheet.monthly if k[1] == mo and (yr is None or k[0] == yr)), None)
            if key is None:
                continue
            for mm in values:
                after = clause[mm.end():mm.end() + 12]
                metric = ("returns" if re.match(r"\s*(tra|hoan tra)\b", after) or re.search(r"luot tra\s*$", clause[:mm.end()])
                          else "reservations" if re.match(r"\s*(dat|dat cho)\b", after) else "loans")
                if metric != "loans":
                    series = {k: (v or {}).get(metric) for k, v in sheet.monthly_other.items()}
                    truth = series.get(key)
                    if truth is None or _matches(mm, truth):
                        continue
                    word = "lượt trả" if metric == "returns" else "lượt đặt chỗ"
                    _claim(out, sent, "COUNT", CONTRADICTED, f"Tháng {mo:02d}/{key[0]} có {_fmt(truth)} {word}.",
                           expected=_fmt(truth, word), token=mm.raw, replacement=_replacement(mm.raw, truth),
                           evidence=[{"label": f"{word.capitalize()} tháng {mo:02d}/{key[0]}", "value": truth, "unit": "lượt"}],
                           line=line)
                    continue
                truth = sheet.monthly[key]
                if _matches(mm, truth):
                    _claim(out, sent, "PERIOD", SUPPORTED, "Khớp số lượt của tháng.", line=line)
                    continue
                other = [k for k, v in sheet.monthly.items() if k != key and _matches(mm, v)]
                if other:
                    oy, om = other[0]
                    _claim(out, sent, "PERIOD", CONTRADICTED,
                           f"Tháng {mo:02d}/{key[0]} có {_fmt(truth)} lượt; {_fmt(mm.values[0])} lượt là của tháng {om:02d}/{oy}.",
                           expected=_fmt(truth, "lượt"), token=mm.raw, replacement=_replacement(mm.raw, truth),
                           evidence=[{"label": f"Lượt mượn tháng {mo:02d}/{key[0]}", "value": truth, "unit": "lượt"}], line=line)
            continue
        if not sheet.period_loans:
            continue
        period = None
        cur_m = int(str(cur.get("from") or "0000-00")[5:7] or 0)
        prev = sheet.periods.get("previous") or {}
        prev_m = int(str(prev.get("from") or "0000-00")[5:7] or 0)
        month_set = {mo for mo, _ in months} | set(dates)
        if refs == {"current"} or (month_set and month_set <= {cur_m} and cur_m != prev_m):
            period = "current"
        elif refs == {"previous"} or (month_set and month_set <= {prev_m} and cur_m != prev_m):
            period = "previous"
        if period is None:
            continue
        other = "previous" if period == "current" else "current"
        truth, alt = sheet.period_loans[period], sheet.period_loans[other]
        for mm in values:
            if any(_matches(mm, v) for v in (truth["total"], truth["per_day"]) if v is not None):
                _claim(out, sent, "PERIOD", SUPPORTED, "Khớp số lượt của kỳ.", line=line)
            elif any(_matches(mm, v) for v in (alt["total"], alt["per_day"]) if v is not None):
                good = truth["total"] if _matches(mm, alt["total"]) else truth["per_day"]
                _claim(out, sent, "PERIOD", CONTRADICTED,
                       f"Kỳ {'hiện tại' if period == 'current' else 'trước'} có {_fmt(good)} lượt; "
                       f"{_fmt(mm.values[0])} là của kỳ {'trước' if period == 'current' else 'hiện tại'}.",
                       expected=_fmt(good, "lượt"), evidence=[{"label": f"Lượt mượn kỳ {period}", "value": good, "unit": "lượt"}],
                       line=line)


def _vn(iso) -> str:
    s = str(iso or "")[:10]
    return f"{s[8:10]}/{s[5:7]}/{s[:4]}" if len(s) == 10 else "?"


_STABLE = re.compile(r"\b(on dinh|deu dan|khong (he )?(suy )?giam|van giu (vung|duoc)|duy tri on dinh|"
                     r"khong thay doi|di ngang|giu nhip)\b")
_TREND_TITLE_HINT = re.compile(r"\b(cuon sach|dau sach nay|tua sach|suc hut|nhu cau|luot muon)\b")
# "không cho thấy lượt mượn giảm" - a denial of the direction the data shows
_DENIAL = re.compile(r"\bkhong (cho thay|co dau hieu|ghi nhan|the hien)( (su|viec))? (luot muon|nhu cau muon|hoat dong muon)?\s*"
                     r"(sut giam|giam|di xuong|tang|di len)\b")


def _check_trends(sent: str, norm: str, sheet: Sheet, out: list, line: int, carry: dict) -> None:
    titles = _titles_in(norm, sheet)
    previous = carry.get("titles") or []
    if titles:
        carry["titles"] = titles
    if len(titles) == 1:
        carry["title"] = titles[0]
    denial = _DENIAL.search(norm)
    if denial and sheet.trend in ("tăng", "giảm") and not titles and re.search(r"\b(luot muon|muon sach)\b", norm):
        denied = "giảm" if re.search(r"giam|xuong", denial.group(5)) else "tăng"
        if denied == sheet.trend:
            _claim(out, sent, "TREND", CONTRADICTED, f"Lượt mượn trong dữ liệu đang {sheet.trend}"
                   + (f" ({_fmt(sheet.trend_pct)}%)." if isinstance(sheet.trend_pct, (int, float)) else "."),
                   expected=sheet.trend, line=line)
            return
    m = _STABLE.search(norm)
    if not m or re.search(r"on dinh hon|it on dinh|kem on dinh", norm) or cf._negated(norm, m.start()) and "giam" not in m.group(0):
        return
    if cf._HEDGE.search(cf._clause_before(norm, m.start(), 40)):
        return
    plural = re.search(r"\b(ca hai|ca ba|cac dau sach (nay|tren)|nhung dau sach (nay|tren)|chung)\b", norm[:m.start()])
    group = titles if len(titles) >= 2 else (previous if plural and len(previous) >= 2 else [])
    if group:
        pcts = [(sheet.titles[t]["name"], (sheet.titles[t]["system"] or sheet.titles[t]["warehouse"]).get("demand_trend_pct"))
                for t in group]
        known = [(n, p) for n, p in pcts if isinstance(p, (int, float))]
        if known and all(abs(p) >= 20 for _n, p in known):
            _claim(out, sent, "TREND", CONTRADICTED,
                   "Lượt mượn của " + ", ".join(f"{n} {'giảm' if p < 0 else 'tăng'} {_fmt(abs(p))}%" for n, p in known)
                   + " so với kỳ trước.", expected="không ổn định",
                   evidence=[{"label": f"Thay đổi lượt mượn — {n}", "value": p, "unit": "%"} for n, p in known], line=line)
        return
    title = titles[0] if len(titles) == 1 else (carry.get("title") if not titles and _TREND_TITLE_HINT.search(norm) else None)
    if title:
        facts = sheet.titles[title]["system"] or sheet.titles[title]["warehouse"]
        pct = facts.get("demand_trend_pct")
        if isinstance(pct, (int, float)):
            if abs(pct) >= 20:
                _claim(out, sent, "TREND", CONTRADICTED,
                       f"Lượt mượn của {sheet.titles[title]['name']} {'giảm' if pct < 0 else 'tăng'} {_fmt(abs(pct))}% so với kỳ trước "
                       f"({_fmt(facts.get('previous_borrow_count'))} → {_fmt(facts.get('borrow_count'))}).",
                       expected=f"{'giảm' if pct < 0 else 'tăng'} {_fmt(abs(pct))}%",
                       evidence=[{"label": f"Thay đổi lượt mượn — {sheet.titles[title]['name']}", "value": pct, "unit": "%"}],
                       line=line)
            else:
                _claim(out, sent, "TREND", SUPPORTED, "Mức thay đổi nhỏ, khớp nhận định ổn định.", line=line)
        return
    # same bar as for a title: a 7 % rise may honestly be called "ổn định hoặc tăng nhẹ"
    if sheet.trend in ("tăng", "giảm") and re.search(r"\b(luot muon|muon sach|xu huong muon|hoat dong muon)\b", norm) \
            and (not isinstance(sheet.trend_pct, (int, float)) or abs(sheet.trend_pct) >= 20) \
            and not re.search(r"\b(tang|giam) nhe\b", norm):
        _claim(out, sent, "TREND", CONTRADICTED, f"Lượt mượn trong dữ liệu đang {sheet.trend}"
               + (f" ({_fmt(sheet.trend_pct)}%)." if isinstance(sheet.trend_pct, (int, float)) else "."),
               expected=sheet.trend, line=line)


_MORE = re.compile(r"\b((rui ro|nguy co)( thieu (sach|hang))? (cao|lon|nhieu) (hon|nhat)|dang lo( ngai)? (hon|nhat)|"
                   r"nghiem trong (hon|nhat)|rui ro (hon|nhat)|thieu (sach|hang) (nhieu|tram trong) (hon|nhat)|kem an toan hon|"
                   r"can uu tien (hon|nhat))\b")
_LESS = re.compile(r"\b((it|thap) rui ro (hon|nhat)|rui ro (thap|it) (hon|nhat)|an toan (hon|nhat)|it nguy co (hon|nhat)|"
                   r"kha quan hon|it (dang )?lo (ngai )?hon)\b")


def _check_ranking(sent: str, norm: str, sheet: Sheet, out: list, line: int) -> None:
    if len(sheet.ranking) < 2:
        return
    more, less = _MORE.search(norm), _LESS.search(norm)
    comp = min([x for x in (more, less) if x], key=lambda x: x.start(), default=None)
    if comp is None or cf._negated(norm, comp.start()):
        return
    whs = _all_wh_mentions(norm, sheet.ranking)
    if not whs:
        return
    is_more = comp is more
    superlative = comp.group(0).endswith("nhat")
    so_voi = [(p, n) for p, n in whs if re.search(r"so voi\s*$", norm[max(0, p - 9):p])]
    before = [(p, n) for p, n in whs if p < comp.start() and (p, n) not in so_voi]
    after = [(p, n) for p, n in whs if p > comp.start()]
    if not before:
        return
    subject = before[-1][1]
    obj = (so_voi[0][1] if so_voi else after[0][1] if after and not superlative else None)
    order = {n: i for i, n in enumerate(sheet.ranking)}
    if sheet.tie and (superlative or (obj and {subject, obj} <= set(sheet.ranking[:2]))):
        _claim(out, sent, "RANKING", CONTRADICTED, "Theo quy tắc xếp hạng, các kho đứng đầu đang ngang nhau.", line=line)
        return
    if superlative:
        truth = sheet.ranking[0] if is_more else sheet.ranking[-1]
        ok = subject == truth
    elif obj and obj != subject:
        ok = order[subject] < order[obj] if is_more else order[subject] > order[obj]
        truth = sheet.ranking[0]
    else:
        return
    if ok:
        _claim(out, sent, "RANKING", SUPPORTED, "Khớp thứ tự rủi ro của hệ thống.", line=line)
    else:
        _claim(out, sent, "RANKING", CONTRADICTED,
               f"Theo quy tắc xếp hạng (hết hàng → dưới ngưỡng → tồn khả dụng), thứ tự rủi ro là: {', '.join(sheet.ranking[:4])}.",
               expected=f"{truth} rủi ro hơn", evidence=[{"label": f"{n} — hết hàng / dưới ngưỡng", "value":
                                                          sheet.warehouses[n].get("out_of_stock_variants"), "unit": "đầu sách"}
                                                         for n in sheet.ranking[:3]], line=line)


def _check_recommendation(sent: str, norm: str, sheet: Sheet, out: list, line: int) -> None:
    if not sheet.first_recommended:
        return
    cue = re.search(r"\bnen (uu tien )?(xem xet )?nhap\b.{0,80}?\b(truoc|dau tien|truoc tien|truoc het)\b|"
                    r"\b(uu tien|lua chon) (so mot|hang dau|dau tien|so 1)\b|\bdung dau danh sach\b", norm)
    if not cue or cf._negated(norm, cue.start()):
        return
    titles = _titles_in(norm, sheet)
    if len(titles) != 1:
        return
    first = _title_key(sheet.first_recommended)
    if titles[0] == first:
        _claim(out, sent, "RECOMMENDATION", SUPPORTED, "Khớp đầu sách đứng đầu danh sách của hệ thống.", line=line)
    else:
        _claim(out, sent, "RECOMMENDATION", CONTRADICTED,
               f"Theo thứ tự của hệ thống (ưu tiên → điểm nhu cầu → số lượng đề xuất), đầu sách đứng đầu là "
               f"{sheet.first_recommended}.", expected=sheet.first_recommended, line=line)


_EXTERNAL = re.compile(r"\b(nhan su|nhan vien|thieu nguoi|nha cung cap (giao )?(hang )?cham|giao hang cham|marketing|quang cao|"
                       r"truyen thong|mua thi|ky nghi|nghi he|nghi tet|le tet|lich hoc|thoi tiet|sinh vien|hoc sinh|su kien|"
                       r"khuyen mai|xu huong doc|so thich|chat luong sach|gia sach|canh tranh|ngan sach bi cat)\b")
_CAUSE = re.compile(r"\b(vi|do|la do|boi|boi vi|nguyen nhan|xuat phat tu|bat nguon tu|khien|dan den|gay ra|tai vi)\b")


def _check_decision_language(sent: str, norm: str, sheet: Sheet, out: list, line: int, carry: dict) -> None:
    # causality outside the data (staff, supplier delays, seasons ...)
    for m in _EXTERNAL.finditer(norm):
        clause = cf._clause_before(norm, m.start(), 70)
        cause = _CAUSE.search(clause)
        if not cause or cf._HEDGE.search(clause + norm[m.start():m.end() + 25]) or cf._negated(norm, m.start()) \
                or re.search(r"\b(can kiem tra|chua co du lieu|du lieu chua|khong co du lieu)\b", norm):
            continue
        _claim(out, sent, "CAUSALITY", UNSUPPORTED,
               "Dữ liệu hệ thống không có thông tin về yếu tố này, nên không thể khẳng định đây là nguyên nhân.", line=line)
        break
    # optimality beyond the 3.1 vocabulary
    m = re.search(r"\b(khon ngoan nhat|dung dan nhat|hop ly nhat|sang suot nhat|loi nhat|phuong an duy nhat|chac chan dung|"
                  r"tot nhat|toi uu|hieu qua nhat)\b", norm)
    if m and not cf._negated(norm, m.start()) and not re.search(r"\bkhong co (phuong an|kich ban|lua chon) nao\b", norm) \
            and "toi uu hoa" not in norm:
        _claim(out, sent, "OPTIMALITY", UNSUPPORTED,
               "Hệ thống chỉ áp dụng quy tắc xếp hạng/phân bổ; không có hàm mục tiêu để chứng minh phương án tối ưu.", line=line)
    # supplier constraints the data does not have
    m = re.search(r"\b(so luong (dat )?toi thieu|moq|rang buoc (cua )?nha cung cap|lich giao)\b", norm)
    if m and re.search(r"\b(da tinh|da bao gom|da xet|dap ung|tinh du|phu hop voi|tuan thu)\b", norm) \
            and not cf._negated(norm, m.start()) and not re.search(r"\b(chua|khong) (tinh|co|xet|bao gom)\b", norm):
        _claim(out, sent, "CONSTRAINT", UNSUPPORTED, "Ràng buộc nhà cung cấp (số lượng tối thiểu, lịch giao) chưa có trong dữ liệu.",
               line=line)
    # lead time: assumption stated as verified / long lead called short
    titles = _titles_in(norm, sheet)
    title = titles[0] if len(titles) == 1 else carry.get("title")
    facts = (sheet.titles.get(title) or {}).get("system") or (sheet.titles.get(title) or {}).get("warehouse") or {} if title else {}
    m = re.search(r"(thoi gian cho|lead time|thoi gian giao).{0,60}?(da duoc kiem chung|da kiem chung|da xac minh|hoc tu lich su|"
                  r"dua tren lich su giao)|\b(giup|cho phep|co the)\b.{0,40}\bdu bao chinh xac", norm)
    if m and not cf._negated(norm, m.end() - 5) and facts.get("lead_time_source") in ("DEFAULT", "SUPPLIER_DECLARED"):
        _claim(out, sent, "ASSUMPTION", UNSUPPORTED,
               f"Thời gian chờ hàng là {'giá trị mặc định' if facts['lead_time_source'] == 'DEFAULT' else 'cam kết của nhà cung cấp'}, "
               "chưa được kiểm chứng bằng lịch sử giao.", line=line)
    m = re.search(r"\bthoi gian cho( hang)?( cua [^,.]{1,40})? (rat |kha |tuong doi )?(ngan|nhanh)\b", norm)
    if m and not cf._negated(norm, m.start(4)) and isinstance(facts.get("lead_time_days"), (int, float)) \
            and facts["lead_time_days"] >= 21:
        _claim(out, sent, "ASSESSMENT", CONTRADICTED,
               f"Thời gian chờ hàng {facts['lead_time_days']} ngày; hệ thống coi từ 21 ngày trở lên là dài.",
               expected="thời gian chờ dài", line=line)
    # a future borrow count the data never forecast
    m = re.search(r"\bse (co|dat|con|len toi|giam xuong|tang len)\b[^.]{0,40}?\d[\d.,]*\s*luot", norm)
    if m and not sheet.has_forecast:
        _claim(out, sent, "FORECAST", UNSUPPORTED, "Dữ liệu không có dự báo lượt mượn cho kỳ tới.", line=line)


_ACK_MISSING = re.compile(r"\b(chua lay duoc|khong lay duoc|loi truy xuat|chua co du lieu|khong co du lieu|chua the ket luan|"
                          r"chua xac dinh|khong truy xuat|du lieu .{0,20}(loi|thieu)|chua co thong tin)\b")
_DOMAIN = {
    "get_reorder_suggestions": r"\b(nhap|de xuat|mua)\b", "simulate_reorder_budget": r"\b(nhap|ngan sach|duyet)\b",
    "get_warehouse_stock_risk": r"\b(kho|het hang|thieu|duoi nguong)\b", "compare_warehouses": r"\b(kho|het hang|thieu)\b",
    "get_warehouse_low_stock_items": r"\b(het hang|duoi nguong|thieu)\b", "get_overdue_summary": r"\bqua han\b",
    "get_borrow_trends": r"\bluot muon\b", "compare_borrow_periods": r"\bluot muon\b", "get_fine_summary": r"\b(phat|tien)\b",
    "get_dashboard_kpis": r"\b(dau sach|ban|phieu)\b",
}
_NONE = re.compile(r"\b(khong|chua) (co|can) [^.]{0,40}?\bnao\b|\bkhong can nhap\b|\b(tat ca|ca|moi) (cac )?(kho|dau sach)[^.]{0,30}"
                   r"\b(deu )?(on|du|an toan|binh thuong)\b|\bdeu (on|du hang|an toan)\b|\bbang 0\b|\b0 (dau sach|kho|phieu)\b")


def _check_missing(sent: str, norm: str, sheet: Sheet, out: list, line: int, carry: dict) -> None:
    if _ACK_MISSING.search(norm):
        return
    for tool in sheet.errors:
        pattern = _DOMAIN.get(tool)
        if pattern and re.search(pattern, norm) and _NONE.search(norm):
            _claim(out, sent, "MISSING_DATA", CONTRADICTED,
                   "Công cụ dữ liệu cho phần này bị lỗi; thiếu dữ liệu không có nghĩa là bằng 0 hoặc là ổn.",
                   expected="chưa có dữ liệu", line=line)
            return
    m = re.search(r"\b0 (dong|d|₫|vnd)\b|\bmien phi\b|\bkhong (ton|mat) (chi phi|tien|dong nao)\b", norm)
    if m:
        titles = _titles_in(norm, sheet)
        title = titles[0] if len(titles) == 1 else carry.get("title")
        facts = (sheet.titles.get(title) or {}).get("system") or {} if title else {}
        if title and "estimated_cost" in facts and facts.get("estimated_cost") is None:
            _claim(out, sent, "MISSING_DATA", CONTRADICTED, "Đầu sách này chưa có đơn giá nên chi phí chưa xác định — không phải 0.",
                   expected="chưa xác định chi phí", line=line)


def _check_scope(sent: str, norm: str, sheet: Sheet, out: list, line: int, carry: dict) -> None:
    # library-wide borrowing attributed to one warehouse/branch
    if sheet.borrow_data and not re.search(r"\b(toan he thong|toan thu vien|tat ca cac kho|chua tach|khong tach)\b", norm):
        for c_start, clause in _clauses(norm):
            stat = re.search(r"\b(\d[\d.,]*)\s*luot( muon)?\b", clause)
            if not stat:
                continue
            head = clause[:stat.start()]
            if re.search(r"\b(kho|chi nhanh) [a-z0-9]+", head) and re.search(r"\b(ghi nhan|co|dat|cho muon|phuc vu)\b", head) \
                    and not re.search(r"het hang|duoi nguong|ton", head):
                _claim(out, sent, "SCOPE", CONTRADICTED, "Lượt mượn trong hệ thống được tính trên toàn thư viện, chưa tách theo kho.",
                       expected="số liệu toàn thư viện", line=line)
                return
    # a system-wide stock figure presented for a title where the warehouse figure differs
    titles = _titles_in(norm, sheet)
    if len(titles) != 1 or re.search(r"\b(toan he thong|toan thu vien|tat ca cac kho|tong cac kho)\b", norm):
        return
    entry = sheet.titles[titles[0]]
    sys_f, wh_f = entry["system"], entry["warehouse"]
    if not (sys_f and wh_f):
        return
    for m in mentions(norm):
        if m.unit != "copies" or not re.search(r"\b(ton|con|co san|kha dung)\b", norm[max(0, m.start() - 30):m.start()]):
            continue
        sys_vals = [v for v in (sys_f.get("available_qty"), sys_f.get("on_hand_qty")) if v is not None]
        wh_vals = [v for v in (wh_f.get("available_qty"), wh_f.get("on_hand_qty")) if v is not None]
        if any(_matches(m, v) for v in sys_vals) and not any(_matches(m, v) for v in wh_vals):
            _claim(out, sent, "SCOPE", UNSUPPORTED,
                   f"{_fmt(m.values[0])} bản là tồn trên toàn hệ thống; tại {wh_f.get('warehouse')} tồn khả dụng là "
                   f"{_fmt(wh_f.get('available_qty'))} bản.", expected=f"{_fmt(wh_f.get('available_qty'))} bản tại {wh_f.get('warehouse')}",
                   line=line)
            return


_BELOW = re.compile(r"\b(duoi|thap hon( nhieu)?( so voi)?)\s+(nguong|muc)( ton)?( toi thieu| an toan)?\b")
_THIS_TITLE = re.compile(r"\b(dau sach nay|cuon sach nay|sach nay|tua sach nay)\b")


def _check_stock_levels(sent: str, norm: str, sheet: Sheet, out: list, line: int, carry: dict) -> None:
    """A title's stock as stated vs the data: the number itself (another
    title's figure is an entity mix-up) and "below the threshold" claims,
    checked arithmetically."""
    titles = _titles_in(norm, sheet)
    title = titles[0] if len(titles) == 1 else (carry.get("title") if not titles and _THIS_TITLE.search(norm) else None)
    for c_start, clause in _clauses(norm) if len(_clauses(norm)) > 1 else [(0, norm)]:
        below = _BELOW.search(clause)
        copies = [m for m in mentions(clause) if m.unit == "copies"]
        # explicit "N bản … dưới ngưỡng M": plain arithmetic, no title needed
        if below and copies:
            after = [m for m in mentions(clause[below.end():]) if m.unit in ("copies", None) and m.values]
            n = copies[0]
            if after and n.start() < below.start() and not cf._negated(clause, below.start()):
                threshold = after[0].values[0]
                if n.values[0] >= threshold:
                    _claim(out, sent, "ASSESSMENT", CONTRADICTED,
                           f"{_fmt(n.values[0])} bản không thấp hơn ngưỡng {_fmt(threshold)} bản.", expected="không dưới ngưỡng",
                           line=line)
                    return
    if not title:
        return
    entry = sheet.titles[title]
    values = {v for scope in ("system", "warehouse") for v in (entry[scope].get("available_qty"), entry[scope].get("on_hand_qty"))
              if isinstance(v, (int, float))}
    for m in mentions(norm):
        if m.unit != "copies" or not re.search(r"\b(ton|con|co san|kha dung|hien co)\b", norm[max(0, m.start() - 30):m.end() + 20]):
            continue
        if re.search(r"\b(de xuat|nhap|dat|giu|muon)\s*(them )?$", norm[max(0, m.start() - 15):m.start()]):
            continue  # "đề xuất nhập 28 bản", "đang giữ 2 bản" are other quantities
        if re.search(r"\b(nguong|muc)\b[^\d]{0,25}$", norm[max(0, m.start() - 30):m.start()]):
            continue  # the threshold itself ("dưới ngưỡng 10 bản")
        if not values or any(_matches(m, v) for v in values):
            if values and _BELOW.search(norm) and not cf._negated(norm, _BELOW.search(norm).start()):
                facts = entry["system"] or entry["warehouse"]
                avail, point = facts.get("available_qty"), facts.get("reorder_point")
                if isinstance(avail, (int, float)) and isinstance(point, (int, float)) and _matches(m, avail) and avail > point:
                    _claim(out, sent, "ASSESSMENT", CONTRADICTED,
                           f"{entry['name']}: tồn khả dụng {_fmt(avail)} bản, cao hơn ngưỡng tồn tối thiểu {_fmt(point)} bản.",
                           expected="không dưới ngưỡng", line=line)
                    return
            continue
        owners = [t["name"] for k, t in sheet.titles.items() if k != title and any(
            _matches(m, t[s].get(f)) for s in ("system", "warehouse") for f in ("available_qty", "on_hand_qty"))]
        _claim(out, sent, "ENTITY" if owners else "COUNT", CONTRADICTED,
               f"{entry['name']}: tồn " + " / ".join(_fmt(v) for v in sorted(values)) + " bản"
               + (f"; {_fmt(m.values[0])} bản là số của {owners[0]}." if owners else "."),
               expected=f"{_fmt(min(values))} bản", line=line)
        return


def _warehouse_pairs(sheet: Sheet) -> list[tuple[str, float, float]]:
    """(warehouse, out of stock, below threshold incl. out of stock) from every source."""
    pairs = [(n, r.get("out_of_stock_variants"), r.get("low_stock_variants")) for n, r in sheet.warehouses.items()]
    pairs += [(n, v.get("oos"), v.get("total")) for n, v in sheet.low_items.items()]
    pairs += [(n, v.get("out_of_stock_items"), v.get("low_stock_items")) for n, v in sheet.shortage.items()]
    return [(n, a, b) for n, a, b in pairs if isinstance(a, (int, float)) and isinstance(b, (int, float)) and a > 0 and b >= a]


def _check_overlap(sent: str, norm: str, sheet: Sheet, out: list, line: int) -> None:
    """"3 hết hàng và 7 đầu sách KHÁC dưới ngưỡng" / "tổng cộng 1 + 1 = 2":
    the below-threshold count already includes the out-of-stock titles."""
    pairs = _warehouse_pairs(sheet)
    if not pairs:
        return
    oos = re.search(r"\b(\d+) dau sach (bi |da )?het( hang)?\b", norm)
    low = re.search(r"\b(\d+) dau sach (khac )?(dang |con )?duoi nguong", norm)
    if not low:
        return
    a = int(oos.group(1)) if oos else None
    b = int(low.group(1))
    extra = bool(low.group(2)) or bool(re.search(r"\bngoai (cac |nhung )?(dau sach )?(da )?het( hang)?\b", norm[:low.start()]))
    match = [(n, x, y) for n, x, y in pairs if y == b and (a is None or x == a)]
    if extra and match:
        n, x, y = match[0]
        _claim(out, sent, "COUNT", CONTRADICTED,
               f"{n}: {_fmt(y)} đầu sách dưới ngưỡng đã gồm {_fmt(x)} đầu sách hết hàng (chỉ {_fmt(y - x)} đầu sách khác).",
               expected=f"{_fmt(y - x)} đầu sách khác", line=line)
        return
    total = re.search(r"\b(tong cong|tong so|tat ca) (la )?(\d+) dau sach\b", norm)
    if total and a is not None:
        match = [(n, x, y) for n, x, y in pairs if x == a and y == b]
        if match and int(total.group(3)) == a + b:
            n, x, y = match[0]
            _claim(out, sent, "COUNT", CONTRADICTED,
                   f"{n}: {_fmt(y)} đầu sách dưới ngưỡng đã gồm {_fmt(x)} đầu sách hết hàng, tổng là {_fmt(y)}.",
                   expected=f"{_fmt(y)} đầu sách", line=line)


def _check_subtotal(sent: str, norm: str, sheet: Sheet, out: list, line: int, carry: dict) -> None:
    """"X ₫. Trong đó, … Y ₫" with Y > X: a part larger than its whole."""
    money = [m for m in mentions(norm) if m.unit == "money" and m.values]
    head = re.match(r"\s*(trong do|trong so do)\b", norm)
    whole = carry.get("last_money")
    if head and whole and money and money[0].values[0] > whole * 1.0001:
        _claim(out, sent, "MONEY", CONTRADICTED,
               f"Phần được nêu ({_fmt(money[0].values[0], 'đ')}) lớn hơn tổng vừa nêu ({_fmt(whole, 'đ')}); "
               "hai số không cùng phạm vi.", line=line)
    if money:
        carry["last_money"] = money[-1].values[0]


# ── entry points ─────────────────────────────────────────────────────────────

def extract_and_verify(answer: str, sheet: Sheet) -> list[Claim]:
    """Every structured claim of `answer` with its verdict."""
    out: list[Claim] = []
    carry: dict = {}
    for sent, line in _sentences(answer):
        norm = normalize_text(sent)
        if not norm:
            continue
        for check in (_check_missing, _check_budget, _check_counts, _check_trends, _check_decision_language, _check_scope,
                      _check_percents, _check_stock_levels, _check_subtotal, _check_reorder_money, _check_periods,
                      _check_ranking, _check_recommendation, _check_overlap):
            try:
                if check in (_check_reorder_money, _check_periods, _check_ranking, _check_recommendation, _check_overlap):
                    check(sent, norm, sheet, out, line)
                else:
                    check(sent, norm, sheet, out, line, carry)
            except Exception:  # noqa: BLE001 - one faulty rule skips its claims, never fails the answer
                logger.warning("verification rule %s failed; its claims are left unverified",
                               getattr(check, "__name__", "?"), exc_info=True)
    # one verdict per (category, sentence): a contradiction outranks support
    rank = {CONTRADICTED: 0, UNSUPPORTED: 1, UNVERIFIABLE: 2, SUPPORTED: 3}
    best: dict = {}
    for c in out:
        key = (c.category, c.text, c.token)
        if key not in best or rank[c.verdict] < rank[best[key].verdict]:
            best[key] = c
    return list(best.values())


def _from_31(issues: list, existing: list[Claim]) -> list[Claim]:
    out = []
    for i in issues:
        category = _FROM_31.get(i.type, "OVERCLAIM")
        if any(c.category == category and c.verdict in (CONTRADICTED, UNSUPPORTED) and (i.phrase[:60] in c.text or c.text[:60] in i.phrase)
               for c in existing):
            continue
        verdict = CONTRADICTED if i.blocking else UNSUPPORTED
        severity = CRITICAL if i.blocking else (MINOR if category in ("OVERCLAIM", "LABEL") else MAJOR)
        out.append(Claim(i.phrase[:200], category, verdict, i.detail, None, [], severity))
    return out


@dataclass
class Report:
    claims: list[Claim]
    sheet: Sheet

    @property
    def problems(self) -> list[Claim]:
        return [c for c in self.claims if c.verdict in (CONTRADICTED, UNSUPPORTED)]

    @property
    def critical(self) -> list[Claim]:
        return [c for c in self.claims if c.severity == CRITICAL]


def verify(answer: str, sheet: Sheet, semantic_31: list | None = None) -> Report:
    claims = extract_and_verify(answer, sheet)
    claims += _from_31(semantic_31 or [], claims)
    return Report(claims, sheet)


_LIST_LINE = re.compile(r"^\s*([-*•]|\d+[.)])\s+")


def repair(answer: str, report: Report) -> tuple[str, list[Claim]]:
    """Replace contradicted numbers whose correct value is certain. Returns
    (answer, the claims repaired). Conservative by design:
    - the claim's role was resolved (it carries a replacement);
    - the wrong token occurs exactly once in the whole answer (the same number
      in another context must not change);
    - the sentence does not introduce a list the text then enumerates ("5 đầu
      sách sau:" + five bullets): fixing the count would contradict the list;
    - re-verifying the repaired text finds no new problem."""
    lines = answer.split("\n")
    fixed, text = [], answer
    for c in report.claims:
        if c.verdict != CONTRADICTED or not c.token or not c.replacement or c.replacement == c.token:
            continue
        occurrences = re.findall(rf"(?<![\d.,]){re.escape(c.token)}(?![\d]|[.,]\d)", text)
        if len(occurrences) != 1:
            continue
        if c.line is not None and c.line + 1 < len(lines) and _LIST_LINE.match(lines[c.line + 1] or "") \
                and re.search(r"[:：]\s*$", lines[c.line].strip()):
            continue
        candidate = re.sub(rf"(?<![\d.,]){re.escape(c.token)}(?![\d]|[.,]\d)", c.replacement, text, count=1)
        before = {(x.category, x.verdict) for x in verify(text, report.sheet).problems}
        after_report = verify(candidate, report.sheet)
        new = [x for x in after_report.problems if (x.category, x.verdict) not in before]
        still = [x for x in after_report.claims if x.verdict == CONTRADICTED and x.token == c.token and x.category == c.category]
        if new or still:
            continue
        text = candidate
        fixed.append(c)
    return text, fixed


def fallback_answer(explanation: dict | None, sheet: Sheet) -> str:
    """A reply built only from backend data, used when a critical
    contradiction survives: the explanation's own conclusion, or - without
    one - the facts that were checked. Adds no claim of its own."""
    base = cf.fallback_answer(explanation)
    if base:
        return base.replace(
            "(Phần phân tích tự động đã được thay bằng kết luận tính trực tiếp từ dữ liệu vì bản phân tích của mô hình không "
            "khớp với số liệu.)",
            "(Không kiểm chứng được một nhận định an toàn từ bản trả lời tự động, nên câu trả lời được thay bằng kết luận tính "
            "trực tiếp từ dữ liệu.)")
    facts = [f for f in sheet.facts if f.value is not None][:4]
    lines = ["Không kiểm chứng được một khuyến nghị an toàn từ bản trả lời tự động."]
    if facts:
        lines.append("Số liệu đọc trực tiếp từ hệ thống:")
        lines += [f"- {f.label}: {_fmt(f.value, f.unit)}" for f in facts]
    if sheet.errors:
        lines.append("Một phần dữ liệu chưa lấy được, nên chưa thể kết luận cho phần đó.")
    return "\n".join(lines)


def retry_instruction(report: Report) -> str | None:
    """The structured contradictions as constraints for the one corrective retry,
    with the value the data actually holds."""
    bad = [c for c in report.claims if c.verdict == CONTRADICTED and c.category not in ("LABEL",)]
    if not bad:
        return None
    lines = [f"- \"{c.text[:120]}\": {c.detail}" + (f" (đúng: {c.expected})" if c.expected else "") for c in bad[:6]]
    return ("Một số con số/nhận định không khớp với dữ liệu đã truy xuất:\n" + "\n".join(lines)
            + "\nViết lại câu trả lời, dùng đúng các giá trị trên, không thêm số liệu mới.")


def status_of(report: Report, *, repaired: bool, fallback: bool) -> str:
    if fallback:
        return BLOCKED
    if any(c.verdict in (CONTRADICTED, UNSUPPORTED) and c.severity in (CRITICAL, MAJOR) for c in report.claims):
        return WARNING
    if any(c.verdict == UNSUPPORTED for c in report.claims if c.category != "LABEL"):
        return WARNING
    return REPAIRED if repaired else PASSED


def summarize(report: Report, status: str, *, repaired: list[Claim], retried: bool, started: float,
              labels_stripped: bool = False) -> dict:
    counts = {v: 0 for v in (SUPPORTED, CONTRADICTED, UNSUPPORTED, UNVERIFIABLE)}
    for c in report.claims:
        counts[c.verdict] += 1
    shown = [c for c in report.claims if c.verdict != SUPPORTED] + [c for c in report.claims if c.verdict == SUPPORTED]
    return {
        "status": status,
        "claims": [c.public() for c in shown[:12]],
        "counts": counts,
        "checked": sum(counts.values()),
        "repairs": [{"category": c.category, "label": LABELS[c.category], "from": c.token, "to": c.replacement}
                    for c in repaired],
        "labels_stripped": labels_stripped,
        "retried": retried,
        "safe_to_act": status != BLOCKED,
        "evidence": report.sheet.evidence[:8],
        "latency_ms": round((time.perf_counter() - started) * 1000, 2),
    }


def log_outcome(summary: dict) -> None:
    """Debug log without figures or text: only statuses and categories."""
    bad = sorted({c["category"] for c in summary["claims"] if c["verdict"] in (CONTRADICTED, UNSUPPORTED)})
    logger.info("copilot verification status=%s checked=%s contradicted=%s unsupported=%s categories=%s repairs=%s retried=%s",
                summary["status"], summary["checked"], summary["counts"][CONTRADICTED], summary["counts"][UNSUPPORTED],
                ",".join(bad) or "-", len(summary["repairs"]), summary["retried"])

