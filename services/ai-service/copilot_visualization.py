"""Generative UI for the management copilot: validated visualization specs.

User question -> copilot_plan (incl. the visualization request) -> tools ->
structured tool data -> HERE -> validated `Visualization` specs -> the React
renderer (apps/web/src/components/ai-copilot-visualization.tsx).

Rules this module enforces - the LLM is never involved:
- Every number in a spec is read from a tool result, or is plain arithmetic on
  it done here (a total, an average over complete buckets, a % change). The
  model neither picks the chart nor supplies a single value.
- A spec is data, never code: a whitelisted `type`, plain rows of numbers and
  short strings. No HTML, no JS, no formatter strings.
- Each chart keeps one unit and one scope (system-wide vs one warehouse). A
  quantity, a rate and an amount of money never share an axis.
- Missing stays missing: a null is drawn as a gap and labelled, never as 0.
  NaN/Infinity are rejected. Truncated, paginated or partial-period data is
  flagged (`is_partial` + `limitations`) and a chart whose data is mostly
  missing is not drawn at all.
- Every spec says where its data came from (`source`), what it covers
  (`scope`, `time_range`) and when it was read (`data_as_of`): a reopened
  conversation shows the snapshot as it was, labelled with that time.

Which visualization (if any) a turn gets is decided by fixed rules on the
query plan (answer mode, explicit "vẽ biểu đồ / dạng bảng / biểu đồ cột"
requests, trend wording) and on the data itself - not every answer needs a
chart, and a single number never gets one unless asked.
"""
from __future__ import annotations

import hashlib
import json
import logging
import math
import re
from calendar import monthrange
from datetime import date, datetime
from typing import Literal, Union

from pydantic import BaseModel, Field, ValidationError, field_validator, model_validator

from copilot_plan import ANALYSIS, CAUSAL, COMPARISON, DECISION, LOOKUP, RANKING, VN_TZ, WHAT_IF, QueryPlan
from copilot_tools import _RISK_CRITERIA, _risk_key

logger = logging.getLogger(__name__)

# ── limits ───────────────────────────────────────────────────────────────────

MAX_VISUALIZATIONS = 4
MAX_CHART_POINTS = 60
MAX_TABLE_ROWS = 50
MAX_SERIES = 4
MAX_PIE_SLICES = 8
MAX_KPIS = 6
MAX_TEXT = 200
# A chart where more than this share of the plotted cells is missing says
# more about the gaps than about the data - it is not drawn.
MAX_MISSING_SHARE = 0.5

VizType = Literal["line", "bar", "area", "pie", "kpi", "table"]
VIZ_TYPES: tuple[str, ...] = ("line", "bar", "area", "pie", "kpi", "table")
CHART_TYPES = frozenset({"line", "bar", "area", "pie"})
ValueKind = Literal["count", "currency", "percent", "days", "rate", "rank", "text", "date"]
NUMERIC_KINDS = frozenset({"count", "currency", "percent", "days", "rate", "rank"})
TYPE_LABELS = {"line": "biểu đồ đường", "bar": "biểu đồ cột", "area": "biểu đồ miền", "pie": "biểu đồ tròn",
               "kpi": "thẻ chỉ số", "table": "bảng số liệu"}

# Units (Vietnamese labels, shown as-is by the UI).
U_LUOT, U_DAU, U_BAN, U_VND, U_PCT, U_DAY = "lượt", "đầu sách", "bản", "₫", "%", "ngày"
U_PER_DAY, U_PHIEU = "lượt/ngày", "phiếu"

Cell = Union[str, int, float, None]

# ── schema ───────────────────────────────────────────────────────────────────

_KEY = r"^[a-z][a-z0-9_]{0,40}$"


class VizField(BaseModel):
    """A plotted series (charts) or a column (tables)."""
    key: str = Field(pattern=_KEY)
    label: str = Field(min_length=1, max_length=MAX_TEXT)
    unit: str = Field(default="", max_length=20)
    kind: ValueKind = "count"
    # Set only when this field's scope differs from the visualization's own
    # (e.g. a system-wide demand column in a one-warehouse table).
    scope_note: str = Field(default="", max_length=MAX_TEXT)
    hidden: bool = False  # series hidden until the user toggles it on


class KpiItem(BaseModel):
    key: str = Field(pattern=_KEY)
    label: str = Field(min_length=1, max_length=MAX_TEXT)
    value: Union[int, float, None]
    unit: str = Field(default="", max_length=20)
    kind: ValueKind = "count"
    note: str = Field(default="", max_length=MAX_TEXT)
    delta: Union[int, float, None] = None
    delta_unit: str = Field(default="", max_length=20)
    delta_label: str = Field(default="", max_length=MAX_TEXT)

    @field_validator("value", "delta")
    @classmethod
    def _finite(cls, v):
        if v is not None and (isinstance(v, bool) or not math.isfinite(v)):
            raise ValueError("KPI values must be finite numbers or null")
        return v


class VizScope(BaseModel):
    level: Literal["system", "warehouse", "warehouses", "item"]
    label: str = Field(max_length=MAX_TEXT)


class VizTimeRange(BaseModel):
    label: str = Field(max_length=MAX_TEXT)
    start: str | None = None
    end: str | None = None


class VizSource(BaseModel):
    tools: list[str] = Field(min_length=1)
    endpoints: list[str] = Field(default_factory=list)


class VizAnnotation(BaseModel):
    x: str = Field(max_length=MAX_TEXT)
    note: str = Field(max_length=MAX_TEXT)


class BudgetControl(BaseModel):
    """What-if slider: every change is sent back as a chat turn and recomputed
    by simulate_reorder_budget - the UI never interpolates a result."""
    min: float
    max: float
    step: float
    current: list[float] = Field(default_factory=list)


class VizInteractions(BaseModel):
    allowed_types: list[VizType]
    can_toggle_series: bool = False
    sortable: bool = False
    filterable: bool = False
    followups: list[str] = Field(default_factory=list, max_length=3)
    budget: BudgetControl | None = None


class Visualization(BaseModel):
    id: str = Field(pattern=r"^viz-[0-9a-f]{12}$")
    type: VizType
    title: str = Field(min_length=1, max_length=MAX_TEXT)
    description: str = Field(default="", max_length=400)
    x_key: str | None = None
    x_label: str = Field(default="", max_length=MAX_TEXT)
    x_kind: Literal["time", "category"] | None = None
    y_label: str = Field(default="", max_length=MAX_TEXT)
    series: list[VizField] = Field(default_factory=list)
    data: list[dict[str, Cell]] = Field(default_factory=list)
    kpis: list[KpiItem] = Field(default_factory=list)
    source: VizSource
    scope: VizScope
    time_range: VizTimeRange | None = None
    data_as_of: str
    is_partial: bool = False
    limitations: list[str] = Field(default_factory=list, max_length=6)
    annotations: list[VizAnnotation] = Field(default_factory=list, max_length=12)
    # Deterministic headline facts (trend direction, riskier warehouse...):
    # the same values the explanation layer states, used to check that the
    # chart and the text never say different things.
    summary: dict[str, Cell] = Field(default_factory=dict)
    interactions: VizInteractions
    # A visualization is always a snapshot of the data at data_as_of; a
    # reopened conversation shows it unchanged, never refreshed silently.
    snapshot: bool = True

    @model_validator(mode="after")
    def _check(self) -> "Visualization":
        if self.type not in self.interactions.allowed_types:
            raise ValueError("type must be one of interactions.allowed_types")
        for t in self.interactions.allowed_types:
            if t != self.type and not _type_compatible(self, t):
                raise ValueError(f"allowed type {t} is not compatible with the data")
        if self.type == "kpi":
            if not 1 <= len(self.kpis) <= MAX_KPIS or self.data:
                raise ValueError("a KPI visualization carries 1..MAX_KPIS kpis and no rows")
            return self
        if not self.data or not self.series:
            raise ValueError("charts and tables need rows and fields")
        keys = [f.key for f in self.series]
        if len(set(keys)) != len(keys):
            raise ValueError("duplicate field keys")
        if self.type == "table":
            if len(self.data) > MAX_TABLE_ROWS:
                raise ValueError("too many table rows")
        else:
            _check_chart(self)
        for row in self.data:
            for key, value in row.items():
                if isinstance(value, bool):
                    raise ValueError("booleans are not cell values")
                if isinstance(value, float) and not math.isfinite(value):
                    raise ValueError("NaN/Infinity are not allowed")
                if isinstance(value, str) and len(value) > MAX_TEXT:
                    raise ValueError("cell text too long")
            for f in self.series:
                value = row.get(f.key)
                if f.kind in NUMERIC_KINDS and value is not None and not isinstance(value, (int, float)):
                    raise ValueError(f"field {f.key} must be numeric")
        return self


def _numeric_fields(v: Visualization) -> list[VizField]:
    return [f for f in v.series if f.kind in NUMERIC_KINDS and f.kind != "rank"]


def _check_chart(v: Visualization) -> None:
    if not v.x_key or any(v.x_key not in row or row[v.x_key] in (None, "") for row in v.data):
        raise ValueError("every chart row needs its x value")
    if len(v.data) > MAX_CHART_POINTS:
        raise ValueError("too many chart points")
    if not 1 <= len(v.series) <= MAX_SERIES:
        raise ValueError("charts plot 1..MAX_SERIES series")
    units = {(f.unit, f.kind) for f in v.series}
    if len(units) != 1 or next(iter(units))[1] not in NUMERIC_KINDS:
        raise ValueError("all series of a chart share one numeric unit")
    if len({f.scope_note for f in v.series}) != 1:
        raise ValueError("all series of a chart share one scope")
    cells = [row.get(f.key) for row in v.data for f in v.series]
    missing = sum(1 for c in cells if c is None)
    if missing / len(cells) > MAX_MISSING_SHARE:
        raise ValueError("too much missing data to draw")
    if v.type == "pie":
        _check_pie(v)


def _check_pie(v: Visualization) -> None:
    if len(v.series) != 1 or v.series[0].kind not in ("count", "currency"):
        raise ValueError("a pie has one count/currency series")
    values = [row.get(v.series[0].key) for row in v.data]
    if any(x is None or x < 0 for x in values) or sum(values) <= 0 or len(values) > MAX_PIE_SLICES:
        raise ValueError("a pie needs complete, non-negative parts of a positive whole")
    if not v.summary.get("parts_of_whole"):
        raise ValueError("a pie is only drawn for parts of one whole")


def _type_compatible(v: Visualization, target: str) -> bool:
    """Whether `v`'s data can honestly be shown as `target`."""
    if target == v.type:
        return True
    if v.type == "kpi" or target == "kpi":
        return False
    if target == "table":
        return True
    if v.type == "table" and v.x_kind is None:
        return False  # a table built as a table mixes units; never auto-plotted
    if target == "pie":
        try:
            _check_pie(v)
        except ValueError:
            return False
        return v.x_kind == "category"
    if target in ("line", "area"):
        return v.x_kind == "time"
    return target == "bar"


# ── small helpers ────────────────────────────────────────────────────────────

# Values that were present but not a finite number (NaN, Infinity, "abc"),
# counted per builder call so the spec can say so - a gap is drawn, never a 0,
# and never silently.
_INVALID = [0]


def _num(value) -> int | float | None:
    """A finite number or None - never a coerced 0."""
    if isinstance(value, bool) or value is None or value == "":
        return None
    if isinstance(value, (int, float)):
        if math.isfinite(value):
            return value
        _INVALID[0] += 1
        return None
    try:
        parsed = float(str(value))
    except (TypeError, ValueError):
        _INVALID[0] += 1
        return None
    if not math.isfinite(parsed):
        _INVALID[0] += 1
        return None
    return parsed


def _text(value, limit: int = 120) -> str:
    text = " ".join(str(value or "").split())
    return text if len(text) <= limit else text[: limit - 1] + "…"


def _vn_date(iso: str | None) -> str:
    if not iso or len(iso) < 10:
        return iso or ""
    y, m, d = iso[:10].split("-")
    return f"{d}/{m}/{y}"


def _pct(new, old) -> float | None:
    if new is None or old in (None, 0):
        return None
    return round((new - old) / old * 100, 1)


def _today(now: datetime) -> date:
    return now.astimezone(VN_TZ).date()


def _retrieved_at(result, fallback: str) -> str:
    if isinstance(result, dict) and isinstance(result.get("retrieved_at"), str):
        return result["retrieved_at"]
    return fallback


def _plan_range(plan: QueryPlan | None) -> VizTimeRange | None:
    tr = plan.time_range if plan else None
    if not tr:
        return None
    return VizTimeRange(label=f"{tr['label']} ({_vn_date(tr['start'])}–{_vn_date(tr['end'])})",
                        start=tr["start"], end=tr["end"])


class _Ctx:
    def __init__(self, plan: QueryPlan | None, now: datetime, request: dict):
        self.plan = plan
        self.now = now
        self.now_iso = now.isoformat(timespec="seconds")
        self.mode = (plan.answer_mode if plan else None) or LOOKUP
        self.request = request
        self.explicit = bool(request.get("requested"))
        self.trend = bool(request.get("trend"))
        self.analytic = self.mode != LOOKUP


def _cand(role: str, auto: bool, **spec) -> dict:
    return {"role": role, "auto": auto, "spec": spec}


def _system() -> VizScope:
    return VizScope(level="system", label="Toàn hệ thống")


def _interactions(kind: str, fields: int = 1, followups: list[str] | None = None, **extra) -> VizInteractions:
    """allowed_types per data shape; filtered again against the real data
    when the spec is finalised (pie only for parts of a whole)."""
    allowed = {"time": ["line", "area", "bar", "table"], "category": ["bar", "pie", "table"],
               "table": ["table"], "kpi": ["kpi"]}[kind]
    return VizInteractions(allowed_types=allowed, can_toggle_series=kind in ("time", "category") and fields > 1,
                           sortable=kind == "table" or kind == "category", filterable=kind == "table",
                           followups=followups or [], **extra)


# ── borrow trends ────────────────────────────────────────────────────────────

def borrow_trend_points(result, plan: QueryPlan | None, now: datetime | None = None) -> dict | None:
    """The buckets of a get_borrow_trends result with their completeness:
    which first/last bucket covers only part of its month (or day), so a
    trend is never read off a half month. Shared with copilot_explain."""
    if not isinstance(result, list):
        return None
    now = (now or datetime.now(VN_TZ)).astimezone(VN_TZ)
    rows = [r for r in result if isinstance(r, dict) and isinstance(r.get("date"), str) and len(r["date"]) >= 7]
    if not rows:
        return None
    monthly = len(rows[0]["date"]) == 7
    today = _today(now)
    tr = plan.time_range if plan else None
    start = date.fromisoformat(tr["start"]) if tr else None
    end = min(date.fromisoformat(tr["end"]), today) if tr else today
    points = []
    for r in rows:
        if monthly:
            y, m = int(r["date"][:4]), int(r["date"][5:7])
            label = f"{m:02d}/{y}"
            first_day, last_day = date(y, m, 1), date(y, m, monthrange(y, m)[1])
        else:
            d = date.fromisoformat(r["date"][:10])
            label = f"{d.day:02d}/{d.month:02d}"
            first_day = last_day = d
        partial = None
        if monthly and start and first_day < start <= last_day:
            partial = f"Chỉ tính từ {start.day:02d}/{start.month:02d}/{start.year}"
        if last_day >= end >= first_day and (monthly and end < last_day or (not monthly and end == today)):
            partial = (f"Chỉ tính đến {end.day:02d}/{end.month:02d}/{end.year}" if monthly
                       else "Hôm nay, chưa hết ngày")
        points.append({"label": label, "date": r["date"], "partial": partial,
                       "loans": _num(r.get("loans")), "returns": _num(r.get("returns")),
                       "reservations": _num(r.get("reservations"))})
    return {"granularity": "month" if monthly else "day", "points": points,
            "unit_label": "tháng" if monthly else "ngày"}


def trend_summary(trend: dict | None, key: str = "loans") -> dict | None:
    """Total, peak, low and the change between the first and the last COMPLETE
    bucket of a series. Partial buckets count toward the total but never set
    the direction or the low point (half a month always looks like a drop)."""
    if not trend:
        return None
    pts = [p for p in trend["points"] if p.get(key) is not None]
    if not pts:
        return None
    full = [p for p in pts if not p["partial"]]
    peak = max(pts, key=lambda p: p[key])
    low = min(full, key=lambda p: p[key]) if full else None
    out = {
        "total": sum(p[key] for p in pts), "buckets": len(pts), "complete_buckets": len(full),
        "granularity": trend["granularity"], "peak_label": peak["label"], "peak_value": peak[key],
        "low_label": low["label"] if low else None, "low_value": low[key] if low else None,
        "average_complete": round(sum(p[key] for p in full) / len(full), 1) if full else None,
        "first_label": None, "first_value": None, "last_label": None, "last_value": None,
        "change_pct": None, "direction": None,
    }
    if len(full) >= 2:
        first, last = full[0], full[-1]
        out.update(first_label=first["label"], first_value=first[key], last_label=last["label"], last_value=last[key])
        change = _pct(last[key], first[key])
        out["change_pct"] = change
        if change is None:
            out["direction"] = "tăng" if last[key] > first[key] else "đi ngang"
        else:
            out["direction"] = "tăng" if change >= 5 else "giảm" if change <= -5 else "đi ngang"
    return out


def _b_borrow_trends(result, ctx: _Ctx, key: str) -> list[dict]:
    trend = borrow_trend_points(result, ctx.plan, ctx.now)
    if not trend:
        return []
    pts = trend["points"]
    summary = trend_summary(trend) or {}
    monthly = trend["granularity"] == "month"
    time_range = _plan_range(ctx.plan) or VizTimeRange(
        label=f"30 ngày gần nhất (mặc định) ({_vn_date(pts[0]['date'])}–{_vn_date(pts[-1]['date'])})"
        if not monthly else f"{pts[0]['label']}–{pts[-1]['label']}",
        start=pts[0]["date"][:10] if not monthly else None, end=pts[-1]["date"][:10] if not monthly else None)
    partial_points = [p for p in pts if p["partial"]]
    limitations = []
    if partial_points:
        limitations.append(f"{len(partial_points)} {trend['unit_label']} chưa trọn kỳ ("
                           + ", ".join(p["label"] for p in partial_points)
                           + ") - không dùng để xác định xu hướng.")
    limitations.append("Lượt mượn tính theo ngày lập phiếu mượn, trên toàn hệ thống.")
    src = {"source": VizSource(tools=[key], endpoints=["/analytics/borrow-trends"]), "scope": _system(),
           "time_range": time_range, "data_as_of": ctx.now_iso}
    cands = []
    if len(pts) >= 2:
        if len(pts) > MAX_CHART_POINTS:
            return [{"note": f"Không vẽ biểu đồ xu hướng: {len(pts)} điểm dữ liệu vượt giới hạn {MAX_CHART_POINTS}; "
                             "hãy hỏi theo tháng hoặc thu hẹp khoảng thời gian."}]
        title = "Lượt mượn theo " + ("tháng" if monthly else "ngày")
        direction = summary.get("direction")
        desc = ""
        if direction and summary.get("first_label"):
            desc = (f"Từ {summary['first_label']} đến {summary['last_label']} (các {trend['unit_label']} trọn kỳ), "
                    f"lượt mượn {direction}")
            desc += f" {abs(summary['change_pct'])}%." if summary.get("change_pct") is not None else "."
        cands.append(_cand(
            "chart", ctx.explicit or ctx.trend or ctx.analytic, type="line", title=title, description=desc,
            x_key="period", x_label="Tháng" if monthly else "Ngày", x_kind="time", y_label="Số lượt",
            series=[VizField(key="loans", label="Lượt mượn", unit=U_LUOT),
                    VizField(key="returns", label="Lượt trả", unit=U_LUOT, hidden=True),
                    VizField(key="reservations", label="Lượt đặt chỗ", unit=U_LUOT, hidden=True)],
            data=[{"period": p["label"], "date": p["date"], "loans": p["loans"], "returns": p["returns"],
                   "reservations": p["reservations"]} for p in pts],
            annotations=[VizAnnotation(x=p["label"], note=p["partial"]) for p in partial_points],
            is_partial=bool(partial_points), limitations=limitations,
            summary={"metric": "loans", "direction": direction, "change_pct": summary.get("change_pct"),
                     "peak_label": summary.get("peak_label"), "peak_value": summary.get("peak_value"),
                     "total": summary.get("total")},
            interactions=_interactions("time", 3, ["Biểu đồ này cho thấy điều gì?",
                                                   "So với kỳ trước thì sao?"]), **src))
    if summary:
        unit_avg = U_LUOT + ("/tháng" if monthly else "/ngày")
        kpis = [KpiItem(key="total_loans", label="Tổng lượt mượn trong kỳ", value=summary["total"], unit=U_LUOT,
                        note=f"{summary['buckets']} {trend['unit_label']}"
                             + (f", gồm {len(partial_points)} chưa trọn kỳ" if partial_points else "")),
                KpiItem(key="peak", label=f"Cao nhất ({summary['peak_label']})", value=summary["peak_value"],
                        unit=U_LUOT)]
        if summary.get("average_complete") is not None:
            kpis.append(KpiItem(key="average", label=f"Trung bình mỗi {trend['unit_label']} trọn kỳ",
                                value=summary["average_complete"], unit=unit_avg, kind="rate"))
        if summary.get("change_pct") is not None:
            kpis.append(KpiItem(key="change", label=f"Thay đổi {summary['first_label']} → {summary['last_label']}",
                                value=summary["change_pct"], unit=U_PCT, kind="percent",
                                note=f"{summary['first_value']} → {summary['last_value']} lượt"))
        cands.append(_cand("kpi", (ctx.explicit or ctx.trend or ctx.analytic) and len(pts) >= 2, type="kpi",
                           title="Tổng hợp lượt mượn", kpis=kpis, is_partial=bool(partial_points),
                           limitations=limitations[:1], summary={"direction": summary.get("direction")},
                           interactions=_interactions("kpi"), **src))
    return cands


def _b_compare_periods(result, ctx: _Ctx, key: str) -> list[dict]:
    if not isinstance(result, dict) or not isinstance(result.get("metrics"), dict):
        return []
    a, b = result.get("current_period") or {}, result.get("previous_period") or {}
    unequal = bool(result.get("unequal_length"))
    names = {"loans": "Lượt mượn", "returns": "Lượt trả", "reservations": "Lượt đặt chỗ"}
    cur_label = f"Kỳ hiện tại ({_vn_date(a.get('from'))}–{_vn_date(a.get('to'))})"
    prev_label = f"Kỳ so sánh ({_vn_date(b.get('from'))}–{_vn_date(b.get('to'))})"
    rows = []
    for metric, label in names.items():
        m = result["metrics"].get(metric)
        if not isinstance(m, dict):
            continue
        cur, prev = ("current_per_day", "previous_per_day") if unequal else ("current", "previous")
        rows.append({"metric": label, "current": _num(m.get(cur)), "previous": _num(m.get(prev))})
    if not rows:
        return []
    unit, kind = (U_PER_DAY, "rate") if unequal else (U_LUOT, "count")
    limitations = [result["note"]] if result.get("note") else []
    loans = result["metrics"].get("loans") or {}
    src = {"source": VizSource(tools=[key], endpoints=["/analytics/borrow-trends"]), "scope": _system(),
           "time_range": VizTimeRange(label=f"{cur_label} so với {prev_label}", start=a.get("from"), end=a.get("to")),
           "data_as_of": _retrieved_at(result, ctx.now_iso)}
    pct_key = "per_day_change_pct" if unequal else "change_pct"
    chart = _cand("chart", True, type="bar",
                  title="Trung bình mỗi ngày: kỳ hiện tại so với kỳ trước" if unequal else "Kỳ hiện tại so với kỳ trước",
                  description=("Hai kỳ dài khác nhau nên so sánh theo trung bình mỗi ngày." if unequal else ""),
                  x_key="metric", x_label="Chỉ số", x_kind="category", y_label=unit,
                  series=[VizField(key="current", label=cur_label, unit=unit, kind=kind),
                          VizField(key="previous", label=prev_label, unit=unit, kind=kind)],
                  data=rows, limitations=limitations,
                  summary={"metric": "loans", "change_pct": _num(loans.get(pct_key)),
                           "direction": _direction(_num(loans.get(pct_key)))},
                  interactions=_interactions("category", 2, ["Biểu đồ này cho thấy điều gì?"]), **src)
    kpis = [KpiItem(key="current_loans", label="Lượt mượn kỳ hiện tại", value=_num(loans.get("current")), unit=U_LUOT,
                    note=f"{a['days']} ngày" if a.get("days") else ""),
            KpiItem(key="previous_loans", label="Lượt mượn kỳ so sánh", value=_num(loans.get("previous")), unit=U_LUOT,
                    note=f"{b['days']} ngày" if b.get("days") else "")]
    if _num(loans.get(pct_key)) is not None:
        kpis.append(KpiItem(key="change", label="Thay đổi " + ("theo trung bình/ngày" if unequal else "tổng lượt mượn"),
                            value=_num(loans.get(pct_key)), unit=U_PCT, kind="percent"))
    kpi = _cand("kpi", True, type="kpi", title="Lượt mượn hai kỳ", kpis=kpis, limitations=limitations,
                interactions=_interactions("kpi"), **src)
    return [kpi, chart]


def _direction(pct) -> str | None:
    if pct is None:
        return None
    return "tăng" if pct >= 5 else "giảm" if pct <= -5 else "đi ngang"


# ── top books ────────────────────────────────────────────────────────────────

def _b_top_books(result, ctx: _Ctx, key: str) -> list[dict]:
    if not isinstance(result, list):
        return []
    truncated = any(isinstance(r, dict) and "_truncated" in r for r in result)
    rows = [r for r in result if isinstance(r, dict) and r.get("title") and "_truncated" not in r]
    if not rows:
        return [{"note": "Không có lượt mượn nào trong kỳ đã chọn nên không có dữ liệu để vẽ."}]
    data = [{"rank": i, "title": _text(r["title"]), "borrow_count": _num(r.get("borrow_count"))}
            for i, r in enumerate(rows, start=1)]
    limitations = ["Chỉ hiển thị 12 dòng đầu của kết quả."] if truncated else []
    src = {"source": VizSource(tools=[key], endpoints=["/analytics/top-books"]), "scope": _system(),
           "time_range": _plan_range(ctx.plan) or VizTimeRange(label="30 ngày gần nhất (mặc định)"),
           "data_as_of": ctx.now_iso, "is_partial": truncated, "limitations": limitations}
    top = data[0]
    chart = _cand("chart", ctx.explicit or ctx.analytic or len(data) >= 3, type="bar",
                  title=f"Top {len(data)} sách được mượn nhiều nhất", x_key="title", x_label="Đầu sách",
                  x_kind="category", y_label="Lượt mượn",
                  series=[VizField(key="borrow_count", label="Lượt mượn", unit=U_LUOT)], data=data,
                  summary={"leader": top["title"], "leader_value": top["borrow_count"]},
                  interactions=_interactions("category", 1, ["Sách nào trong số này đang tồn kho thấp?",
                                                             "Biểu đồ này cho thấy điều gì?"]), **src)
    table = _cand("table", False, type="table", title="Bảng xếp hạng sách được mượn nhiều",
                  series=[VizField(key="rank", label="Hạng", kind="rank"), VizField(key="title", label="Đầu sách", kind="text"),
                          VizField(key="borrow_count", label="Lượt mượn", unit=U_LUOT)], data=data,
                  interactions=_interactions("table"), **src)
    return [chart, table]


def _b_compare_top(result, ctx: _Ctx, key: str) -> list[dict]:
    if not isinstance(result, dict) or not isinstance(result.get("current"), list):
        return []
    rows = [r for r in result["current"] if isinstance(r, dict) and r.get("title")]
    if not rows:
        return [{"note": "Kỳ hiện tại chưa có lượt mượn nào nên không có dữ liệu để vẽ."}]
    a, b = result.get("current_period") or {}, result.get("previous_period") or {}
    cur_label = f"Kỳ hiện tại ({_vn_date(a.get('from'))}–{_vn_date(a.get('to'))})"
    prev_label = f"Kỳ so sánh ({_vn_date(b.get('from'))}–{_vn_date(b.get('to'))})"
    data = [{"rank": r.get("rank"), "title": _text(r["title"]), "current": _num(r.get("borrow_count")),
             "previous": _num(r.get("previous_borrow_count")), "previous_rank": r.get("previous_rank"),
             "status": r.get("status")} for r in rows]
    missing_prev = sum(1 for r in data if r["previous"] is None)
    limitations = []
    if missing_prev:
        limitations.append(f"{missing_prev} đầu sách không có trong top kỳ so sánh: để trống, không tính là 0 lượt.")
    src = {"source": VizSource(tools=[key], endpoints=["/analytics/top-books"]), "scope": _system(),
           "time_range": VizTimeRange(label=f"{cur_label} so với {prev_label}", start=a.get("from"), end=a.get("to")),
           "data_as_of": _retrieved_at(result, ctx.now_iso), "limitations": limitations}
    chart = _cand("chart", True, type="bar", title="Lượt mượn của top sách: kỳ hiện tại so với kỳ trước",
                  x_key="title", x_label="Đầu sách", x_kind="category", y_label="Lượt mượn",
                  series=[VizField(key="current", label=cur_label, unit=U_LUOT),
                          VizField(key="previous", label=prev_label, unit=U_LUOT)],
                  data=[{k: r[k] for k in ("title", "current", "previous")} for r in data],
                  summary={"leader": data[0]["title"]},
                  interactions=_interactions("category", 2, ["Biểu đồ này cho thấy điều gì?"]), **src)
    table = _cand("table", ctx.explicit, type="table", title="Thay đổi thứ hạng top sách",
                  series=[VizField(key="rank", label="Hạng", kind="rank"), VizField(key="title", label="Đầu sách", kind="text"),
                          VizField(key="current", label="Lượt mượn kỳ này", unit=U_LUOT),
                          VizField(key="previous_rank", label="Hạng kỳ trước", kind="rank"),
                          VizField(key="previous", label="Lượt mượn kỳ trước", unit=U_LUOT),
                          VizField(key="status", label="Biến động", kind="text")],
                  data=data, interactions=_interactions("table"), **src)
    return [chart, table]


# ── warehouses ───────────────────────────────────────────────────────────────

def _warehouse_rows(rows: list[dict]) -> list[dict]:
    return [{"warehouse": _text(r.get("warehouse_name") or r.get("warehouse_code") or "?"),
             "out_of_stock": _num(r.get("out_of_stock_variants")), "low_stock": _num(r.get("low_stock_variants")),
             "available": _num(r.get("total_available_qty")), "reserved": _num(r.get("total_reserved_qty")),
             "borrowed": _num(r.get("total_borrowed_qty"))} for r in rows]


def _warehouse_cands(rows: list[dict], ctx: _Ctx, key: str, endpoint: str, scope: VizScope, auto: bool,
                     data_as_of: str, extra_limits: list[str]) -> list[dict]:
    if not rows:
        return [{"note": "Không có dữ liệu tồn kho cho các kho được hỏi nên không vẽ biểu đồ."}]
    ranked = sorted(rows, key=_risk_key)
    data = _warehouse_rows(ranked)
    summary: dict = {"riskiest": data[0]["warehouse"], "criteria": "het_hang>duoi_nguong>ton_kha_dung"}
    if len(ranked) >= 2 and _risk_key(ranked[0]) == _risk_key(ranked[1]):
        summary["riskiest"] = None
        summary["tie"] = 1
    src = {"source": VizSource(tools=[key], endpoints=[endpoint]), "scope": scope,
           "time_range": VizTimeRange(label=f"Tồn kho tại thời điểm truy xuất ({_vn_date(data_as_of[:10])})"),
           "data_as_of": data_as_of, "limitations": extra_limits}
    title_suffix = ""  # the scope (which warehouses) is shown under every chart
    chart = _cand("chart", auto, type="bar", title="Đầu sách hết hàng và dưới ngưỡng theo kho" + title_suffix,
                  description=_RISK_CRITERIA, x_key="warehouse", x_label="Kho", x_kind="category", y_label="Đầu sách",
                  series=[VizField(key="out_of_stock", label="Hết hàng", unit=U_DAU),
                          VizField(key="low_stock", label="Dưới ngưỡng tồn tối thiểu", unit=U_DAU)],
                  data=[{k: r[k] for k in ("warehouse", "out_of_stock", "low_stock")} for r in data], summary=summary,
                  interactions=_interactions("category", 2, [
                      f"Tại sao {data[0]['warehouse']} thiếu sách?" if summary.get("riskiest") else
                      "Biểu đồ này cho thấy điều gì?", "Hiển thị số liệu dưới dạng bảng"]), **src)
    qty = _cand("chart", ctx.explicit and len(data) >= 2, type="bar", title="Số bản theo trạng thái tồn ở mỗi kho" + title_suffix,
                x_key="warehouse", x_label="Kho", x_kind="category", y_label="Bản",
                series=[VizField(key="available", label="Tồn khả dụng", unit=U_BAN),
                        VizField(key="reserved", label="Đang giữ cho đặt chỗ", unit=U_BAN),
                        VizField(key="borrowed", label="Đang cho mượn", unit=U_BAN)],
                data=[{k: r[k] for k in ("warehouse", "available", "reserved", "borrowed")} for r in data],
                summary={"note": "Tổng tồn nhiều không có nghĩa từng đầu sách đều đủ hàng."},
                interactions=_interactions("category", 3), **src)
    table = _cand("table", False, type="table", title="Bảng đối chiếu tồn kho theo kho" + title_suffix,
                  series=[VizField(key="warehouse", label="Kho", kind="text"),
                          VizField(key="out_of_stock", label="Hết hàng", unit=U_DAU),
                          VizField(key="low_stock", label="Dưới ngưỡng", unit=U_DAU),
                          VizField(key="available", label="Tồn khả dụng", unit=U_BAN),
                          VizField(key="reserved", label="Đang giữ", unit=U_BAN),
                          VizField(key="borrowed", label="Đang cho mượn", unit=U_BAN)],
                  data=data, interactions=_interactions("table"), **src)
    return [chart, qty, table]


def _b_stock_risk(result, ctx: _Ctx, key: str) -> list[dict]:
    if not isinstance(result, list):
        return []
    rows = [r for r in result if isinstance(r, dict) and (r.get("warehouse_name") or r.get("warehouse_code"))]
    named = len((ctx.plan.entities.get("warehouses") if ctx.plan else None) or [])
    auto = ctx.explicit or (ctx.mode in (COMPARISON, RANKING, CAUSAL, ANALYSIS, DECISION) and len(rows) >= 2 and named != 1)
    return _warehouse_cands(rows, ctx, key, "/analytics/warehouse-stock-risk",
                            VizScope(level="warehouses", label=f"Tất cả {len(rows)} kho đang hoạt động"), auto,
                            ctx.now_iso, [])


def _b_compare_warehouses(result, ctx: _Ctx, key: str) -> list[dict]:
    if not isinstance(result, dict) or not isinstance(result.get("ranking"), list):
        return []
    rows = [r for r in result["ranking"] if isinstance(r, dict)]
    limits = [f"Không xác định được kho: {', '.join(result['unresolved'])}"] if result.get("unresolved") else []
    names = ", ".join(_text(r.get("warehouse_name"), 40) for r in rows[:4])
    scope = VizScope(level="warehouses", label=names or "Các kho được hỏi")
    return _warehouse_cands(rows, ctx, key, "/analytics/warehouse-stock-risk", scope, True,
                            _retrieved_at(result, ctx.now_iso), limits)


_STATUS_ORDER = {"HẾT HÀNG": 0, "DƯỚI NGƯỠNG": 1}


def _b_low_items(result, ctx: _Ctx, key: str) -> list[dict]:
    if not isinstance(result, dict) or not isinstance(result.get("items"), list):
        return []
    name = _text(result.get("warehouse_name") or "kho", 60)
    scope = VizScope(level="warehouse", label=name)
    items = [x for x in result["items"] if isinstance(x, dict) and x.get("title")]
    truncated = bool(result.get("truncated"))
    limits = [f"Danh sách dài nên chỉ {len(items)}/{result.get('total_items')} đầu sách được trả về."] if truncated else []
    src = {"source": VizSource(tools=[key], endpoints=["/analytics/warehouse-stock-items"]), "scope": scope,
           "time_range": VizTimeRange(label="Tồn kho tại thời điểm truy xuất"),
           "data_as_of": _retrieved_at(result, ctx.now_iso), "is_partial": truncated, "limitations": limits}
    cands = [_cand("kpi", ctx.explicit or ctx.analytic, type="kpi", title=f"Tồn thấp tại {name}",
                   kpis=[KpiItem(key="low", label="Dưới ngưỡng (gồm hết hàng)", value=_num(result.get("total_items")), unit=U_DAU),
                         KpiItem(key="out", label="Đã hết hàng", value=_num(result.get("out_of_stock_count")), unit=U_DAU)],
                   interactions=_interactions("kpi"), **src)]
    if not items:
        return cands
    data = [{"title": _text(x["title"]), "status": x.get("status"), "available": _num(x.get("available_qty")),
             "reorder_point": _num(x.get("reorder_point")), "reserved": _num(x.get("reserved_qty")),
             "borrowed": _num(x.get("borrowed_qty"))} for x in items[:MAX_TABLE_ROWS]]
    cands.append(_cand("chart", ctx.explicit, type="bar", title=f"Tồn khả dụng so với ngưỡng tối thiểu tại {name}",
                       x_key="title", x_label="Đầu sách", x_kind="category", y_label="Bản",
                       series=[VizField(key="available", label="Tồn khả dụng", unit=U_BAN),
                               VizField(key="reorder_point", label="Ngưỡng tồn tối thiểu", unit=U_BAN)],
                       data=[{k: r[k] for k in ("title", "available", "reorder_point")} for r in data[:15]],
                       interactions=_interactions("category", 2), **src))
    cands.append(_cand("table", ctx.analytic and ctx.mode != CAUSAL, type="table", title=f"Đầu sách tồn thấp tại {name}",
                       series=[VizField(key="title", label="Đầu sách", kind="text"),
                               VizField(key="status", label="Trạng thái", kind="text"),
                               VizField(key="available", label="Tồn khả dụng", unit=U_BAN),
                               VizField(key="reorder_point", label="Ngưỡng tối thiểu", unit=U_BAN),
                               VizField(key="reserved", label="Đang giữ", unit=U_BAN),
                               VizField(key="borrowed", label="Đang cho mượn", unit=U_BAN)],
                       data=data, interactions=_interactions("table"), **src))
    return cands


def _b_shortage(result, ctx: _Ctx, key: str) -> list[dict]:
    if not isinstance(result, dict) or not isinstance(result.get("summary"), dict):
        return []
    name = _text(result.get("warehouse_name") or "kho", 60)
    s = result["summary"]
    src = {"source": VizSource(tools=[key.split("#")[0]], endpoints=["/analytics/warehouse-stock-items",
                                                                     "/analytics/reorder-suggestions"]),
           "scope": VizScope(level="warehouse", label=name),
           "time_range": VizTimeRange(label="Tồn kho tại thời điểm truy xuất; nhu cầu theo kỳ của mô hình đề xuất nhập"),
           "data_as_of": _retrieved_at(result, ctx.now_iso),
           "limitations": [x for x in result.get("limitations") or [] if isinstance(x, str)][:3]}
    cands = [_cand("kpi", True, type="kpi", title=f"Các yếu tố thiếu hàng tại {name}", kpis=[
        KpiItem(key="low", label="Dưới ngưỡng (gồm hết hàng)", value=_num(s.get("low_stock_items")), unit=U_DAU),
        KpiItem(key="out", label="Đã hết hàng", value=_num(s.get("out_of_stock_items")), unit=U_DAU),
        KpiItem(key="with_demand", label="Đang thiếu nhưng vẫn có lượt mượn", value=_num(s.get("items_with_recent_demand")),
                unit=U_DAU, note="Lượt mượn tính trên toàn hệ thống"),
        KpiItem(key="rising", label="Đang thiếu và nhu cầu tăng", value=_num(s.get("items_with_rising_demand")),
                unit=U_DAU, note="So với kỳ trước, toàn hệ thống")],
        summary={"warehouse": name}, interactions=_interactions("kpi"), **src)]
    items = [x for x in result.get("items") or [] if isinstance(x, dict) and x.get("title")]
    if items:
        cands.append(_cand("table", ctx.explicit, type="table", title=f"Đầu sách đang thiếu tại {name}",
                           series=[VizField(key="title", label="Đầu sách", kind="text"),
                                   VizField(key="status", label="Trạng thái", kind="text"),
                                   VizField(key="available", label="Tồn khả dụng tại kho", unit=U_BAN),
                                   VizField(key="borrow_count", label="Lượt mượn", unit=U_LUOT,
                                            scope_note="Toàn hệ thống"),
                                   VizField(key="trend", label="Xu hướng nhu cầu", unit=U_PCT, kind="percent",
                                            scope_note="Toàn hệ thống"),
                                   VizField(key="lead_time", label="Thời gian chờ hàng", unit=U_DAY, kind="days")],
                           data=[{"title": _text(x["title"]), "status": x.get("status"),
                                  "available": _num(x.get("available_qty")), "borrow_count": _num(x.get("borrow_count")),
                                  "trend": _num(x.get("demand_trend_pct")), "lead_time": _num(x.get("lead_time_days"))}
                                 for x in items[:MAX_TABLE_ROWS]],
                           interactions=_interactions("table"), **src))
    return cands


def _shortage_comparison(results: list[tuple[str, dict]], ctx: _Ctx) -> list[dict]:
    """Two or more explain_warehouse_shortage results: one grouped bar of the
    same per-warehouse counts, instead of one KPI block per warehouse."""
    rows = []
    for _key, r in results:
        s = r.get("summary") or {}
        rows.append({"warehouse": _text(r.get("warehouse_name") or "?", 60), "low": _num(s.get("low_stock_items")),
                     "out": _num(s.get("out_of_stock_items")), "with_demand": _num(s.get("items_with_recent_demand"))})
    names = ", ".join(r["warehouse"] for r in rows)
    return [_cand("chart", True, type="bar", title="Các yếu tố thiếu hàng theo kho",
                  description="Số đầu sách tại từng kho; 'vẫn có lượt mượn' dùng nhu cầu toàn hệ thống.",
                  x_key="warehouse", x_label="Kho", x_kind="category", y_label="Đầu sách",
                  series=[VizField(key="out", label="Hết hàng", unit=U_DAU),
                          VizField(key="low", label="Dưới ngưỡng (gồm hết hàng)", unit=U_DAU),
                          VizField(key="with_demand", label="Đang thiếu nhưng vẫn có lượt mượn", unit=U_DAU, hidden=True)],
                  data=rows, source=VizSource(tools=["explain_warehouse_shortage"],
                                              endpoints=["/analytics/warehouse-stock-items", "/analytics/reorder-suggestions"]),
                  scope=VizScope(level="warehouses", label=names), data_as_of=ctx.now_iso,
                  time_range=VizTimeRange(label="Tồn kho tại thời điểm truy xuất"),
                  limitations=["Nhu cầu mượn lấy từ mô hình đề xuất nhập, tính trên toàn hệ thống, không tách theo kho.",
                               "Các yếu tố là tương quan, không phải nguyên nhân đã được kiểm chứng."],
                  interactions=_interactions("category", 3))]


# ── reorder & budget simulation ──────────────────────────────────────────────

def _b_reorder(result, ctx: _Ctx, key: str) -> list[dict]:
    if not isinstance(result, dict) or not isinstance(result.get("items"), list):
        return []
    s = result.get("summary") or {}
    rng = result.get("range") or {}
    src = {"source": VizSource(tools=[key], endpoints=["/analytics/reorder-suggestions"]), "scope": _system(),
           "time_range": VizTimeRange(label=f"Nhu cầu tính từ {_vn_date(str(rng.get('from') or '')[:10])} đến "
                                            f"{_vn_date(str(rng.get('to') or '')[:10])}") if rng.get("from") else None,
           "data_as_of": ctx.now_iso}
    truncated = any(isinstance(x, dict) and "_truncated" in x for x in result["items"])
    items = [x for x in result["items"] if isinstance(x, dict) and x.get("title")]
    kpis = [KpiItem(key="candidates", label="Đầu sách cần xem xét nhập", value=_num(s.get("total_candidates")), unit=U_DAU),
            KpiItem(key="high", label="Ưu tiên cao", value=_num(s.get("high_priority")), unit=U_DAU),
            KpiItem(key="qty", label="Tổng số lượng đề xuất", value=_num(s.get("estimated_total_reorder_qty")), unit=U_BAN),
            KpiItem(key="cost", label="Tổng chi phí nhập dự kiến", value=_num(s.get("estimated_total_cost")), unit=U_VND,
                    kind="currency")]
    cands = [_cand("kpi", ctx.explicit or ctx.mode in (ANALYSIS, RANKING), type="kpi", title="Tổng quan đề xuất nhập",
                   kpis=kpis, interactions=_interactions("kpi"), **src)]
    if items:
        limits = ["Chỉ hiển thị 12 dòng đầu của danh sách."] if truncated else []
        cands.append(_cand("table", bool(ctx.request.get("table")), type="table", title="Danh sách đề xuất nhập",
                           series=[VizField(key="title", label="Đầu sách", kind="text"),
                                   VizField(key="priority", label="Ưu tiên", kind="text"),
                                   VizField(key="available", label="Tồn khả dụng", unit=U_BAN),
                                   VizField(key="reorder_point", label="Ngưỡng tối thiểu", unit=U_BAN),
                                   VizField(key="qty", label="Đề xuất nhập", unit=U_BAN),
                                   VizField(key="cost", label="Chi phí ước tính", unit=U_VND, kind="currency")],
                           data=[{"title": _text(x["title"]), "priority": x.get("priority"),
                                  "available": _num(x.get("available_qty")), "reorder_point": _num(x.get("reorder_point")),
                                  "qty": _num(x.get("suggested_reorder_qty")), "cost": _num(x.get("estimated_cost"))}
                                 for x in items[:MAX_TABLE_ROWS]],
                           is_partial=truncated, limitations=limits, interactions=_interactions("table"), **src))
    return cands


def _scenario_label(s: dict) -> str:
    """Short axis label ("10 triệu ₫") for a stated budget; the full label
    for assumed (% of need) and changed (-20%) scenarios, which say more."""
    budget = _num(s.get("budget_vnd"))
    if str(s.get("label", "")).startswith("Ngân sách") and budget and budget % 100_000 == 0:
        return f"{budget / 1_000_000:g} triệu ₫".replace(".", ",")
    return _text(s["label"], 60)


def _b_simulation(result, ctx: _Ctx, key: str) -> list[dict]:
    if not isinstance(result, dict) or not isinstance(result.get("scenarios"), list):
        return []
    scenarios = [s for s in result["scenarios"] if isinstance(s, dict) and s.get("label")]
    if not scenarios:
        return []
    failed = [s["label"] for s in scenarios if s.get("error")]
    need = result.get("full_need") or {}
    limitations = []
    if result.get("scenarios_are_assumed"):
        limitations.append("Chưa có mức ngân sách cụ thể: các kịch bản là mức giả định theo % tổng nhu cầu nhập.")
    if result.get("items_not_listed"):
        limitations.append(f"{result['items_not_listed']} đầu sách ngoài 100 dòng đầu không được đếm vào số đầu sách; "
                           "chi phí duyệt vẫn do hệ thống tính.")
    if failed:
        limitations.append("Không mô phỏng được: " + ", ".join(failed) + " (để trống, không tính là 0).")
    limitations += [x for x in result.get("limitations") or [] if isinstance(x, str)][:1]
    partial = bool(result.get("items_not_listed") or failed)
    rows = []
    for s in scenarios:
        ok = not s.get("error")
        rows.append({"scenario": _scenario_label(s), "budget": _num(s.get("budget_vnd")),
                     "funded_cost": _num(s.get("funded_cost")) if ok else None,
                     "remaining": _num(s.get("remaining_vnd")) if ok else None,
                     "funded_lines": _num(s.get("funded_lines")) if ok else None,
                     "funded_qty": _num(s.get("funded_qty")) if ok else None,
                     "funded_high": _num(s.get("funded_high_priority")) if ok else None,
                     "unfunded_high": _num(s.get("unfunded_high_priority")) if ok else None,
                     "covered_pct": _num(s.get("shortfall_covered_pct")) if ok else None})
    src = {"source": VizSource(tools=[key], endpoints=["/analytics/reorder-suggestions?budgetVnd"]), "scope": _system(),
           "time_range": VizTimeRange(label="Nhu cầu nhập tại thời điểm mô phỏng"),
           "data_as_of": _retrieved_at(result, ctx.now_iso), "is_partial": partial, "limitations": limitations}
    budgets = [r["budget"] for r in rows if r["budget"] is not None]
    total_need = _num(need.get("estimated_total_cost"))
    slider = None
    if budgets and not result.get("scenarios_are_assumed"):
        top = max(budgets + ([total_need] if total_need else []))
        slider = BudgetControl(min=1_000_000, max=float(max(5_000_000, math.ceil(top * 1.5 / 1_000_000) * 1_000_000)),
                               step=1_000_000, current=budgets)
    follow = ["Sách ưu tiên cao nào bị bỏ lại với ngân sách này?", "Biểu đồ này cho thấy điều gì?"]
    kpi = _cand("kpi", True, type="kpi", title="Nhu cầu nhập đầy đủ", kpis=[
        KpiItem(key="need_cost", label="Tổng chi phí nhập dự kiến (đủ nhu cầu)", value=total_need, unit=U_VND, kind="currency"),
        KpiItem(key="need_lines", label="Đầu sách cần nhập", value=_num(need.get("total_candidates")), unit=U_DAU),
        KpiItem(key="need_high", label="Trong đó ưu tiên cao", value=_num(need.get("high_priority")), unit=U_DAU)],
        interactions=_interactions("kpi"), **{**src, "is_partial": False, "limitations": []})
    cost = _cand("chart", True, type="bar", title="Ngân sách và chi phí được duyệt theo phương án",
                 description=result.get("funding_rule") or "", x_key="scenario", x_label="Phương án", x_kind="category",
                 y_label="VNĐ", series=[VizField(key="budget", label="Ngân sách", unit=U_VND, kind="currency"),
                                        VizField(key="funded_cost", label="Chi phí được duyệt", unit=U_VND, kind="currency")],
                 data=[{k: r[k] for k in ("scenario", "budget", "funded_cost")} for r in rows],
                 interactions=_interactions("category", 2, follow, budget=slider), **src)
    titles = _cand("chart", True, type="bar", title="Số đầu sách nhập được và ưu tiên cao bị bỏ lại",
                   x_key="scenario", x_label="Phương án", x_kind="category", y_label="Đầu sách",
                   series=[VizField(key="funded_lines", label="Đầu sách được duyệt", unit=U_DAU),
                           VizField(key="funded_high", label="Ưu tiên cao được duyệt", unit=U_DAU),
                           VizField(key="unfunded_high", label="Ưu tiên cao chưa được nhập", unit=U_DAU)],
                   data=[{k: r[k] for k in ("scenario", "funded_lines", "funded_high", "unfunded_high")} for r in rows],
                   summary={"no_optimum": 1, "scenarios": len(rows)},
                   interactions=_interactions("category", 3, follow), **src)
    table = _cand("table", True, type="table", title="So sánh các phương án ngân sách",
                  series=[VizField(key="scenario", label="Phương án", kind="text"),
                          VizField(key="budget", label="Ngân sách", unit=U_VND, kind="currency"),
                          VizField(key="funded_cost", label="Chi phí duyệt", unit=U_VND, kind="currency"),
                          VizField(key="remaining", label="Còn dư", unit=U_VND, kind="currency"),
                          VizField(key="funded_lines", label="Đầu sách duyệt", unit=U_DAU),
                          VizField(key="funded_qty", label="Số bản", unit=U_BAN),
                          VizField(key="unfunded_high", label="Ưu tiên cao bị bỏ lại", unit=U_DAU),
                          VizField(key="covered_pct", label="Bù thiếu hụt dự kiến", unit=U_PCT, kind="percent")],
                  data=rows, interactions=_interactions("table"), **src)
    return [kpi, cost, titles, table]


def _b_demand_vs_stock(result, ctx: _Ctx, key: str) -> list[dict]:
    if not isinstance(result, dict) or not isinstance(result.get("rows"), list):
        return []
    rows = [r for r in result["rows"] if isinstance(r, dict) and r.get("title")]
    c = result.get("counts") or {}
    p = result.get("period") or {}
    src = {"source": VizSource(tools=[key], endpoints=["/analytics/top-books", "/analytics/reorder-suggestions"]),
           "scope": _system(), "data_as_of": _retrieved_at(result, ctx.now_iso),
           "time_range": VizTimeRange(label=f"Lượt mượn từ {_vn_date(p.get('from'))} đến {_vn_date(p.get('to'))}",
                                      start=p.get("from"), end=p.get("to")) if p.get("from") else None}
    cands = [_cand("kpi", ctx.explicit, type="kpi", title="Đối chiếu nhu cầu và tồn kho", kpis=[
        KpiItem(key="checked", label="Sách mượn nhiều đã đối chiếu", value=_num(c.get("top_books_checked")), unit=U_DAU),
        KpiItem(key="flagged", label="Vừa mượn nhiều vừa tồn thấp", value=_num(c.get("flagged")), unit=U_DAU)],
        interactions=_interactions("kpi"), **src)]
    if rows:
        cands.append(_cand("table", ctx.explicit, type="table", title="Sách mượn nhiều nhưng tồn kho thấp",
                           series=[VizField(key="borrow_rank", label="Hạng lượt mượn", kind="rank"),
                                   VizField(key="title", label="Đầu sách", kind="text"),
                                   VizField(key="borrow_count", label="Lượt mượn", unit=U_LUOT),
                                   VizField(key="available", label="Tồn khả dụng", unit=U_BAN),
                                   VizField(key="reorder_point", label="Ngưỡng tối thiểu", unit=U_BAN),
                                   VizField(key="qty", label="Đề xuất nhập", unit=U_BAN),
                                   VizField(key="cost", label="Chi phí ước tính", unit=U_VND, kind="currency")],
                           data=[{"borrow_rank": r.get("borrow_rank"), "title": _text(r["title"]),
                                  "borrow_count": _num(r.get("borrow_count")), "available": _num(r.get("available_qty")),
                                  "reorder_point": _num(r.get("reorder_point")), "qty": _num(r.get("suggested_reorder_qty")),
                                  "cost": _num(r.get("estimated_cost"))} for r in rows],
                           interactions=_interactions("table"), **src))
    return cands


# ── borrowing KPIs ───────────────────────────────────────────────────────────

def _b_dashboard(result, ctx: _Ctx, key: str) -> list[dict]:
    if not isinstance(result, dict):
        return []
    spec = [("active_loans", "Phiếu mượn đang mở", U_PHIEU, "count"),
            ("overdue_loans", "Phiếu quá hạn", U_PHIEU, "count"),
            ("low_stock_variants", "Đầu sách tồn thấp", U_DAU, "count"),
            ("unpaid_fine_amount", "Tiền phạt chưa thu", U_VND, "currency"),
            ("reservation_conversion_rate", "Tỷ lệ đặt chỗ thành phiếu mượn", U_PCT, "percent"),
            ("total_titles", "Tổng đầu sách", U_DAU, "count")]
    kpis = [KpiItem(key=k, label=label, value=_num(result.get(k)), unit=unit, kind=kind)
            for k, label, unit, kind in spec if k in result]
    if not kpis:
        return []
    return [_cand("kpi", ctx.explicit or ctx.analytic, type="kpi", title="KPI tổng quan", kpis=kpis,
                  source=VizSource(tools=[key], endpoints=["/analytics/dashboard/kpis"]), scope=_system(),
                  time_range=VizTimeRange(label="Tại thời điểm truy xuất"), data_as_of=ctx.now_iso,
                  interactions=_interactions("kpi"))]


_OVERDUE_BUCKETS = [("1–7 ngày", 1, 7), ("8–30 ngày", 8, 30), ("31–90 ngày", 31, 90), ("Trên 90 ngày", 91, 10 ** 6)]


def _b_overdue(result, ctx: _Ctx, key: str) -> list[dict]:
    if not isinstance(result, dict) or "total_overdue_loans" not in result:
        return []
    src = {"source": VizSource(tools=[key], endpoints=["/analytics/overdue-summary"]), "scope": _system(),
           "time_range": VizTimeRange(label="Tại thời điểm truy xuất"), "data_as_of": ctx.now_iso}
    cands = [_cand("kpi", ctx.explicit or ctx.analytic, type="kpi", title="Tình hình quá hạn", kpis=[
        KpiItem(key="loans", label="Phiếu quá hạn", value=_num(result.get("total_overdue_loans")), unit=U_PHIEU),
        KpiItem(key="items", label="Cuốn sách quá hạn", value=_num(result.get("total_overdue_items")), unit=U_BAN),
        KpiItem(key="avg", label="Trễ trung bình", value=_num(result.get("average_overdue_days")), unit=U_DAY, kind="days"),
        KpiItem(key="max", label="Trễ lâu nhất", value=_num(result.get("oldest_overdue_days")), unit=U_DAY, kind="days")],
        interactions=_interactions("kpi"), **src)]
    listed = [x for x in result.get("items") or [] if isinstance(x, dict) and _num(x.get("overdue_days")) is not None]
    total = _num(result.get("total_overdue_loans")) or 0
    if listed and total and len(listed) / total >= 0.8:
        counts = [sum(1 for x in listed if lo <= x["overdue_days"] <= hi) for _l, lo, hi in _OVERDUE_BUCKETS]
        cands.append(_cand("chart", ctx.explicit, type="bar", title="Phân bố phiếu quá hạn theo số ngày trễ",
                           x_key="bucket", x_label="Số ngày trễ", x_kind="category", y_label="Phiếu",
                           series=[VizField(key="loans", label="Phiếu quá hạn", unit=U_PHIEU)],
                           data=[{"bucket": label, "loans": n} for (label, _lo, _hi), n in zip(_OVERDUE_BUCKETS, counts)],
                           summary={"parts_of_whole": 1 if len(listed) == total else 0},
                           is_partial=len(listed) < total,
                           limitations=[f"Tính trên {len(listed)}/{int(total)} phiếu được liệt kê."] if len(listed) < total else [],
                           interactions=_interactions("category", 1), **src))
    elif listed and ctx.explicit:
        cands.append({"note": f"Không vẽ phân bố số ngày trễ: hệ thống chỉ trả về {len(listed)}/{int(total)} phiếu quá hạn, "
                              "quá ít để đại diện cho toàn bộ."})
    return cands


_FINE_TYPES = {"OVERDUE": "Quá hạn", "LOST": "Mất sách", "DAMAGE": "Hư hỏng"}


def _b_fines(result, ctx: _Ctx, key: str) -> list[dict]:
    if not isinstance(result, dict) or "total_unpaid" not in result:
        return []
    src = {"source": VizSource(tools=[key], endpoints=["/analytics/fine-summary"]), "scope": _system(),
           "time_range": VizTimeRange(label="Toàn bộ lịch sử phạt, tại thời điểm truy xuất"), "data_as_of": ctx.now_iso}
    cands = [_cand("kpi", ctx.explicit or ctx.analytic, type="kpi", title="Tiền phạt", kpis=[
        KpiItem(key="unpaid", label="Chưa thu", value=_num(result.get("total_unpaid")), unit=U_VND, kind="currency"),
        KpiItem(key="paid", label="Đã thu", value=_num(result.get("total_paid")), unit=U_VND, kind="currency"),
        KpiItem(key="waived", label="Đã miễn", value=_num(result.get("total_waived")), unit=U_VND, kind="currency"),
        KpiItem(key="unpaid_count", label="Khoản chưa thu", value=_num(result.get("unpaid_count")), unit="khoản")],
        interactions=_interactions("kpi"), **src)]
    by_type = [x for x in result.get("by_type") or [] if isinstance(x, dict) and x.get("fine_type")]
    if by_type:
        data = [{"fine_type": _FINE_TYPES.get(x["fine_type"], _text(x["fine_type"], 30)), "amount": _num(x.get("amount"))}
                for x in by_type[:MAX_PIE_SLICES]]
        cands.append(_cand("chart", ctx.explicit or bool(ctx.request.get("proportion")),
                           type="pie" if ctx.request.get("proportion") else "bar",
                           title="Tổng số tiền phạt theo loại (gồm cả đã thu)", x_key="fine_type", x_label="Loại phạt",
                           x_kind="category", y_label="VNĐ",
                           series=[VizField(key="amount", label="Số tiền phạt", unit=U_VND, kind="currency")], data=data,
                           summary={"parts_of_whole": 1}, interactions=_interactions("category", 1), **src))
    return cands


_FUNNEL = [("pending", "Chờ xác nhận"), ("confirmed", "Đã xác nhận"), ("ready_for_pickup", "Chờ lấy sách"),
           ("converted_to_loan", "Đã thành phiếu mượn"), ("cancelled", "Đã hủy"), ("expired", "Hết hạn")]


def _b_reservations(result, ctx: _Ctx, key: str) -> list[dict]:
    if not isinstance(result, dict) or "total" not in result:
        return []
    data = [{"status": label, "count": _num(result.get(k))} for k, label in _FUNNEL if k in result]
    src = {"source": VizSource(tools=[key], endpoints=["/analytics/reservation-funnel"]), "scope": _system(),
           "time_range": VizTimeRange(label="Toàn bộ lượt đặt chỗ, tại thời điểm truy xuất"), "data_as_of": ctx.now_iso}
    cands = [_cand("kpi", ctx.explicit or ctx.analytic, type="kpi", title="Đặt chỗ", kpis=[
        KpiItem(key="total", label="Tổng lượt đặt chỗ", value=_num(result.get("total")), unit=U_LUOT),
        KpiItem(key="rate", label="Tỷ lệ chuyển thành phiếu mượn", value=_num(result.get("conversion_rate")),
                unit=U_PCT, kind="percent")], interactions=_interactions("kpi"), **src)]
    if data and sum(x["count"] or 0 for x in data) > 0:
        cands.append(_cand("chart", ctx.explicit or ctx.analytic or bool(ctx.request.get("proportion")),
                           type="pie" if ctx.request.get("proportion") else "bar",
                           title="Lượt đặt chỗ theo trạng thái", x_key="status", x_label="Trạng thái", x_kind="category",
                           y_label="Lượt", series=[VizField(key="count", label="Lượt đặt chỗ", unit=U_LUOT)], data=data,
                           summary={"parts_of_whole": 1}, interactions=_interactions("category", 1), **src))
    return cands


# ── other lists ──────────────────────────────────────────────────────────────

def _b_aging(result, ctx: _Ctx, key: str) -> list[dict]:
    if not isinstance(result, dict) or not isinstance(result.get("items"), list):
        return []
    items = [x for x in result["items"] if isinstance(x, dict) and x.get("title")]
    if not items:
        return []
    src = {"source": VizSource(tools=[key], endpoints=["/analytics/aging-inventory" if key == "get_aging_inventory"
                                                       else "/analytics/weeding-suggestions"]),
           "scope": _system(), "data_as_of": ctx.now_iso,
           "time_range": VizTimeRange(label=f"Không hoạt động từ {result.get('threshold_days')} ngày trở lên")}
    weeding = key == "get_weeding_suggestions"
    series = [VizField(key="title", label="Đầu sách", kind="text"), VizField(key="warehouse", label="Kho", kind="text"),
              VizField(key="on_hand", label="Tồn", unit=U_BAN),
              VizField(key="days", label="Số ngày không hoạt động", unit=U_DAY, kind="days")]
    if weeding:
        series += [VizField(key="action", label="Đề xuất", kind="text"),
                   VizField(key="value", label="Giá trị tồn", unit=U_VND, kind="currency")]
    actions = {"LIQUIDATE": "Thanh lý", "REDISTRIBUTE": "Chuyển kho"}
    data = [{"title": _text(x["title"]), "warehouse": _text(x.get("warehouse_name"), 60), "on_hand": _num(x.get("on_hand_qty")),
             "days": _num(x.get("days_since_last_activity")),
             **({"action": actions.get(x.get("suggested_action"), x.get("suggested_action")),
                 "value": _num(x.get("tied_up_value"))} if weeding else {})} for x in items[:MAX_TABLE_ROWS]]
    no_activity = sum(1 for r in data if r["days"] is None)
    limits = [f"{no_activity} dòng chưa từng có hoạt động ghi nhận (để trống số ngày)."] if no_activity else []
    return [_cand("table", ctx.explicit or ctx.analytic, type="table",
                  title="Đề xuất thanh lý / chuyển kho" if weeding else "Sách tồn kho lâu không hoạt động",
                  series=series, data=data, limitations=limits, interactions=_interactions("table"), **src)]


def _b_priorities(result, ctx: _Ctx, key: str) -> list[dict]:
    if not isinstance(result, dict) or not isinstance(result.get("tasks"), list):
        return []
    tasks = [t for t in result["tasks"] if isinstance(t, dict) and t.get("task")]
    if not tasks:
        return []
    return [_cand("table", ctx.explicit, type="table", title="Việc cần ưu tiên hôm nay",
                  description=result.get("ranking_rule") or "",
                  series=[VizField(key="rank", label="Thứ tự", kind="rank"), VizField(key="task", label="Việc", kind="text"),
                          VizField(key="size", label="Quy mô", kind="text"), VizField(key="next", label="Bước tiếp theo", kind="text")],
                  data=[{"rank": t.get("rank"), "task": _text(t["task"]),
                         "size": f"{_fmt(t.get('value'))} {t.get('unit') or ''}".strip(), "next": _text(t.get("next_step"))}
                        for t in tasks[:MAX_TABLE_ROWS]],
                  source=VizSource(tools=[key], endpoints=["/analytics/dashboard/kpis", "/analytics/overdue-summary",
                                                          "/analytics/warehouse-stock-risk", "/analytics/reorder-suggestions"]),
                  scope=_system(), time_range=VizTimeRange(label="Tại thời điểm truy xuất"),
                  data_as_of=_retrieved_at(result, ctx.now_iso), interactions=_interactions("table"))]


def _fmt(value) -> str:
    from tool_context import _format_value
    return "—" if value is None else _format_value(value, "")


_BUILDERS = {
    "get_borrow_trends": _b_borrow_trends,
    "compare_borrow_periods": _b_compare_periods,
    "get_top_books": _b_top_books,
    "compare_top_books": _b_compare_top,
    "get_warehouse_stock_risk": _b_stock_risk,
    "compare_warehouses": _b_compare_warehouses,
    "get_warehouse_low_stock_items": _b_low_items,
    "explain_warehouse_shortage": _b_shortage,
    "get_reorder_suggestions": _b_reorder,
    "simulate_reorder_budget": _b_simulation,
    "analyze_demand_vs_stock": _b_demand_vs_stock,
    "get_dashboard_kpis": _b_dashboard,
    "get_overdue_summary": _b_overdue,
    "get_fine_summary": _b_fines,
    "get_reservation_funnel": _b_reservations,
    "get_aging_inventory": _b_aging,
    "get_weeding_suggestions": _b_aging,
    "rank_priority_tasks": _b_priorities,
}
VISUALIZABLE_TOOLS = frozenset(_BUILDERS)


# ── selection ────────────────────────────────────────────────────────────────

def _digest(payload) -> str:
    return hashlib.sha1(json.dumps(payload, sort_keys=True, default=str, ensure_ascii=False).encode()).hexdigest()[:12]


def _finalise(cand: dict) -> Visualization | None:
    spec = dict(cand["spec"])
    spec["data"] = [dict(row) for row in spec.get("data") or []]
    interactions: VizInteractions = spec["interactions"]
    try:
        draft = Visualization.model_construct(**spec)
        allowed = [t for t in interactions.allowed_types if _type_compatible(draft, t)]
        if not allowed:
            return None
        if spec["type"] not in allowed:
            # e.g. a pie asked for data that turned out incomplete: fall back
            # to the first honest form (bar for categories, line for time).
            spec["type"] = allowed[0]
        spec["interactions"] = interactions.model_copy(update={"allowed_types": allowed})
        spec["id"] = "viz-" + _digest({k: spec.get(k) for k in ("type", "title", "data")} | {
            "kpis": [k.model_dump() for k in spec.get("kpis") or []], "tools": spec["source"].tools})
        return Visualization(**spec)
    except (ValidationError, ValueError, TypeError) as exc:
        logger.info("visualization %r rejected: %s", spec.get("title"), exc)
        return None


def _merge_kpis(cands: list[dict]) -> dict:
    """Several KPI blocks in one answer become one, keeping every source."""
    first = cands[0]["spec"]
    tools = [t for c in cands for t in c["spec"]["source"].tools]
    endpoints = [e for c in cands for e in c["spec"]["source"].endpoints]
    spec = {**first, "title": "Chỉ số chính" if len(cands) > 1 else first["title"],
            "kpis": [k for c in cands for k in c["spec"].get("kpis") or []][:MAX_KPIS],
            "source": VizSource(tools=_unique(tools), endpoints=_unique(endpoints)),
            "is_partial": any(c["spec"].get("is_partial") for c in cands),
            "limitations": _unique([x for c in cands for x in c["spec"].get("limitations") or []])[:6]}
    if len({c["spec"]["scope"].label for c in cands}) > 1:
        spec["scope"] = VizScope(level="system", label="Nhiều phạm vi - xem ghi chú từng chỉ số")
    return {"role": "kpi", "auto": True, "spec": spec}


def _retype(viz: Visualization, target: str) -> Visualization | None:
    if target == viz.type or target not in viz.interactions.allowed_types:
        return None
    try:
        return Visualization(**{**viz.model_dump(), "type": target, "id": "viz-" + _digest([viz.id, target])})
    except ValidationError:
        return None


def build_visualizations(plan: QueryPlan | None, collected: dict, now: datetime | None = None,
                         request: dict | None = None) -> tuple[list[dict], list[str]]:
    """(validated visualization dicts, notes) for one turn. `request` defaults
    to plan.visualization. Never raises: a spec that fails validation is
    dropped and said so in the notes."""
    now = (now or datetime.now(VN_TZ)).astimezone(VN_TZ)
    request = dict(request if request is not None else (getattr(plan, "visualization", None) or {}))
    if plan is not None and plan.clarification_needed:
        return [], []
    if not collected:
        return [], []
    ctx = _Ctx(plan, now, request)
    from copilot_explain import TOOL_LABELS  # local import: copilot_explain imports this module

    cands: list[dict] = []
    notes: list[str] = []
    shortages: list[tuple[str, dict]] = []
    for key, result in collected.items():
        base = key.split("#")[0]
        builder = _BUILDERS.get(base)
        if builder is None:
            continue
        if isinstance(result, dict) and result.get("error"):
            label = TOOL_LABELS.get(base, base)
            reason = "tài khoản không có quyền xem" if "403" in str(result["error"]) else "chưa lấy được"
            notes.append(f"Không tạo biểu đồ {label}: {reason} dữ liệu này.")
            continue
        if base == "explain_warehouse_shortage" and isinstance(result, dict) and result.get("summary"):
            shortages.append((key, result))
        if "#" in key and base != "explain_warehouse_shortage":
            continue  # a model re-call of the same tool; the planned call is drawn
        try:
            _INVALID[0] = 0
            built = builder(result, ctx, key)
            if _INVALID[0]:
                warning = (f"{_INVALID[0]} giá trị trong dữ liệu nguồn không phải số hợp lệ (NaN/Infinity/văn bản) nên "
                           "được để trống, không thay bằng 0.")
                for c in built:
                    if "spec" in c:
                        c["spec"]["is_partial"] = True
                        c["spec"]["limitations"] = [warning] + list(c["spec"].get("limitations") or [])
            for c in built:
                if "note" in c:
                    if ctx.explicit or ctx.analytic or ctx.trend:
                        notes.append(c["note"])
                else:
                    cands.append(c)
        except Exception:  # noqa: BLE001 - a chart is never worth a failed turn
            logger.exception("visualization builder %s failed", base)
    if len(shortages) >= 2:
        cands = [c for c in cands if "explain_warehouse_shortage" not in c["spec"]["source"].tools]
        cands = cands + _shortage_comparison(shortages, ctx)

    wanted_type = request.get("chart_type")
    want_table = bool(request.get("table")) or wanted_type == "table"
    chosen: list[dict] = []
    for c in cands:
        if c["auto"] or (ctx.explicit and c["role"] in ("chart", "kpi")) or (want_table and c["role"] == "table"):
            chosen.append(c)
    if ctx.explicit and not any(c["role"] == "chart" for c in chosen) and cands:
        if not any(c["role"] == "chart" for c in cands):
            notes.append("Dữ liệu của câu hỏi này không phù hợp để vẽ biểu đồ (không có chuỗi số cùng đơn vị); "
                         "hiển thị dạng thẻ chỉ số hoặc bảng.")
            chosen += [c for c in cands if c["role"] == "table" and c not in chosen][:1]

    order = {"kpi": 0, "chart": 1, "table": 2}
    chosen.sort(key=lambda c: order[c["role"]])
    kpi_cands = [c for c in chosen if c["role"] == "kpi"]
    if len(kpi_cands) > 1:  # one KPI block per answer
        chosen = [_merge_kpis(kpi_cands)] + [c for c in chosen if c["role"] != "kpi"]
    visualizations: list[Visualization] = []
    for c in chosen:
        viz = _finalise(c)
        if viz is None:
            notes.append(f"Bỏ qua \"{c['spec'].get('title')}\" vì dữ liệu không đủ hoặc không hợp lệ để hiển thị.")
            continue
        visualizations.append(viz)

    if wanted_type in CHART_TYPES or wanted_type == "table":
        visualizations, note = apply_chart_type(visualizations, wanted_type)
        if note and not request.get("inherited_type"):
            notes.append(note)

    out: list[Visualization] = []
    seen: set[str] = set()
    for v in visualizations:
        if v.id not in seen:
            seen.add(v.id)
            out.append(v)
    if len(out) > MAX_VISUALIZATIONS:
        notes.append(f"Chỉ hiển thị {MAX_VISUALIZATIONS} biểu đồ/bảng quan trọng nhất.")
        out = out[:MAX_VISUALIZATIONS]
    return [v.model_dump() for v in out], _unique(notes)[:4]


def _unique(items: list[str]) -> list[str]:
    seen, out = set(), []
    for x in items:
        if x not in seen:
            seen.add(x)
            out.append(x)
    return out


def apply_chart_type(visualizations: list, target: str) -> tuple[list, str | None]:
    """Re-render the primary chart as `target` when its data allows it - the
    same rows, nothing recomputed. Returns (visualizations, note)."""
    vizs = [v if isinstance(v, Visualization) else Visualization(**v) for v in visualizations]
    was_dicts = bool(visualizations) and not isinstance(visualizations[0], Visualization)
    if target == "table":
        primary = next((v for v in vizs if v.type in CHART_TYPES), None)
        if primary is None:
            if any(v.type == "table" for v in vizs):
                return (visualizations, None)
            return (visualizations, "Không có biểu đồ nào để chuyển sang dạng bảng.")
        retyped = _retype(primary, "table")
        if retyped is None:
            return (visualizations, "Không chuyển được biểu đồ sang dạng bảng.")
    else:
        primary = next((v for v in vizs if v.type in CHART_TYPES), None)
        if primary is None:
            return (visualizations, f"Dữ liệu này không vẽ được thành {TYPE_LABELS[target]}; giữ dạng bảng/thẻ chỉ số.")
        if primary.type == target:
            return (visualizations, None)
        retyped = _retype(primary, target)
        if retyped is None:
            return (visualizations, incompatible_reason(primary, target))
    vizs = [retyped if v is primary else v for v in vizs]
    return ([v.model_dump() for v in vizs] if was_dicts else vizs), None


def incompatible_reason(viz: Visualization, target: str) -> str:
    alternatives = ", ".join(TYPE_LABELS[t] for t in viz.interactions.allowed_types if t != viz.type)
    why = {"pie": "biểu đồ tròn chỉ dùng cho các phần cộng lại thành một tổng thể",
           "line": "biểu đồ đường chỉ dùng cho dữ liệu theo thời gian",
           "area": "biểu đồ miền chỉ dùng cho dữ liệu theo thời gian"}.get(target, "dữ liệu không phù hợp")
    return (f"Không thể hiển thị \"{viz.title}\" dưới dạng {TYPE_LABELS[target]}: {why}. Giữ {TYPE_LABELS[viz.type]}"
            + (f"; có thể chọn: {alternatives}." if alternatives else "."))


# ── prompt brief, grounding, consistency ────────────────────────────────────

def visualization_brief(visualizations: list[dict], notes: list[str] | None = None) -> str:
    """Tells the model what the UI will draw next to its answer, so it neither
    claims it cannot draw charts nor reads every data point back - and what
    was NOT drawn and why (a refused pie, no permission), so the text never
    contradicts the charts (seen live: "chưa có dữ liệu theo tháng để vẽ"
    next to a monthly line chart)."""
    if not visualizations and not notes:
        return ""
    if not visualizations:
        return ("## Trực quan hóa\n- Không hiển thị biểu đồ nào: " + " ".join(notes or [])
                + " Nói ngắn gọn lý do này nếu người dùng yêu cầu biểu đồ; không mô tả biểu đồ không tồn tại.")
    lines = ["## Trực quan hóa hiển thị kèm câu trả lời (hệ thống dựng từ kết quả tool)"]
    for v in visualizations:
        line = f"- {TYPE_LABELS[v['type']].capitalize()}: \"{v['title']}\""
        if v.get("time_range"):
            line += f"; kỳ: {v['time_range']['label']}"
        line += f"; phạm vi: {v['scope']['label']}"
        if v["type"] == "kpi":
            line += "; chỉ số: " + "; ".join(f"{k['label']} = {_fmt(k['value'])} {k['unit']}".strip() for k in v["kpis"])
        summary = v.get("summary") or {}
        if summary.get("direction"):
            line += f"; xu hướng (các kỳ trọn vẹn): {summary['direction']}"
        if v.get("is_partial"):
            line += "; DỮ LIỆU CHƯA ĐẦY ĐỦ: " + " ".join(v.get("limitations") or [])
        lines.append(line)
    for note in notes or []:
        lines.append(f"- Ghi chú hiển thị cho người dùng: {note}")
    lines.append("- Giao diện tự vẽ các biểu đồ/bảng trên từ dữ liệu hệ thống, xen giữa câu kết luận đầu tiên và phần phân "
                 "tích. Không viết \"biểu đồ ở trên/bên dưới\", không nói bạn không thể vẽ biểu đồ, không "
                 "vẽ bảng hay biểu đồ bằng ký tự, không chép lại toàn bộ số liệu: nêu nhận định chính và 2–3 số liệu "
                 "quan trọng nhất. Nhận định phải khớp với biểu đồ (cùng xu hướng, cùng kho rủi ro hơn). Nếu dữ liệu chưa "
                 "đầy đủ, nói rõ trong một câu.")
    return "\n".join(lines)


_TEXT_CHART = re.compile(r"[█▇▆▅▄▃▂▁■▌▐░▒▓]{3,}|^\s*\|.*\|\s*$|^\s*[-|: ]{6,}\s*$")


def strip_text_charts(answer: str) -> str:
    """Charts/tables the model drew with characters ("████ 4.947.000 ₫",
    markdown tables, code fences) despite the instructions. The UI already
    draws the validated chart; a hand-drawn one has no scale and can
    contradict it, so it is removed (with a heading left dangling above it)."""
    def fence(m: re.Match) -> str:
        drawn = _TEXT_CHART.search(m.group(0)) or re.search(r"[█|]", m.group(0))
        return "███" if drawn else m.group(0)  # a marker line, dropped below

    text = re.sub(r"```.*?(```|$)", fence, answer, flags=re.S)
    lines = text.split("\n")
    kept: list[str] = []
    for i, line in enumerate(lines):
        if _TEXT_CHART.search(line):
            continue
        nxt = next((x for x in lines[i + 1:] if x.strip()), "")
        if re.fullmatch(r"\s*\*\*[^*]*(biểu đồ|bảng)[^*]*\*\*:?\s*", line, re.I) and (not nxt or _TEXT_CHART.search(nxt)):
            continue
        kept.append(line)
    out = re.sub(r"\n{3,}", "\n\n", "\n".join(kept)).strip()
    return out or answer


def numbers_in_visualizations(visualizations: list[dict]) -> list:
    """Values the backend computed for the visualizations (totals, averages,
    changes) - shown to the model, so quoting them is grounded."""
    out: list = []
    for v in visualizations or []:
        out += [k.get("value") for k in v.get("kpis") or []]
        out += [x for x in (v.get("summary") or {}).values() if isinstance(x, (int, float)) and not isinstance(x, bool)]
    return [x for x in out if x is not None]


def data_values(viz: dict) -> list[float]:
    vals: list[float] = []
    for row in viz.get("data") or []:
        vals += [v for v in row.values() if isinstance(v, (int, float)) and not isinstance(v, bool)]
    vals += [k["value"] for k in viz.get("kpis") or [] if isinstance(k.get("value"), (int, float))]
    return vals


def consistency_issues(visualizations: list[dict], explanation: dict | None) -> list[str]:
    """Places where a chart and the explanation would say different things:
    a trend direction, or which warehouse is riskier. Empty = consistent."""
    if not visualizations or not explanation:
        return []
    text = " ".join([explanation.get("headline") or ""] + [c.get("statement") or "" for c in explanation.get("claims") or []
                                                          if c.get("kind") == "INFERENCE"])
    issues: list[str] = []
    for v in visualizations:
        s = v.get("summary") or {}
        if s.get("metric") == "loans" and s.get("direction") in ("tăng", "giảm"):
            opposite = "giảm" if s["direction"] == "tăng" else "tăng"
            if f"lượt mượn có xu hướng {opposite}" in text.lower() or f"lượt mượn {opposite}" in text.lower():
                issues.append(f"{v['title']}: biểu đồ {s['direction']}, giải thích nói {opposite}")
        if s.get("riskiest") and "rủi ro thiếu sách cao" in text:
            if s["riskiest"] not in text:
                issues.append(f"{v['title']}: biểu đồ xếp {s['riskiest']} rủi ro nhất, giải thích nêu kho khác")
    return issues
