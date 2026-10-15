"""Evidence-grounded explanation layer for the management copilot.

build_explanation() turns one turn's tool results into structured claims, each
one of:
- FACT        read straight from a tool result (or plain arithmetic on it);
- INFERENCE   a conclusion drawn here by a stated rule, with a certainty level
              (CAO / TRUNG BÌNH / THẤP) and the basis for that level;
- ASSUMPTION  something the analysis takes as given (default lead time,
              assumed budget levels, even demand within a period...);
- UNKNOWN     something the data cannot tell (no permission, tool failed, no
              per-warehouse demand...), stated instead of guessed.
Each claim carries its evidence (label/value/unit/source) and what that
evidence means for a manager. Every number in it is a tool value or computed
here - none comes from the model.

The structure is used twice:
- explanation_brief(): the reasoning frame added to the prompt, so the model
  words each conclusion no stronger than the data allows and never has to
  compute anything itself;
- the API response (`explanation`), shown by the UI as "Vì sao AI đưa ra nhận
  định này?".

overclaims() is the post-generation check for wording that claims more than
the explanation supports: certainty, causation, optimality, full coverage.
"""
from __future__ import annotations

import re
from collections import Counter

from copilot_plan import ANALYSIS, CAUSAL, COMPARISON, DECISION, LOOKUP, RANKING, WHAT_IF, QueryPlan
from copilot_tools import _RISK_CRITERIA, _risk_key, data_confidence
from copilot_visualization import borrow_trend_points, trend_summary
from evidence import extract_evidence
from tool_context import _format_value

FACT, INFERENCE, ASSUMPTION, UNKNOWN = "FACT", "INFERENCE", "ASSUMPTION", "UNKNOWN"
HIGH, MEDIUM, LOW = "CAO", "TRUNG BÌNH", "THẤP"
_RANK = {LOW: 0, MEDIUM: 1, HIGH: 2}
_KIND_ORDER = {INFERENCE: 0, FACT: 1, ASSUMPTION: 2, UNKNOWN: 3}
_DIRECT = "Đọc trực tiếp từ dữ liệu hệ thống."
_ADVICE_MODES = (DECISION, WHAT_IF, RANKING)

TOOL_LABELS = {
    "get_overdue_summary": "phiếu quá hạn", "get_fine_summary": "tiền phạt", "get_borrow_trends": "xu hướng mượn",
    "get_reservation_funnel": "đặt chỗ", "compare_borrow_periods": "so sánh lượt mượn", "get_top_books": "top sách",
    "compare_top_books": "so sánh top sách", "get_reorder_suggestions": "đề xuất nhập",
    "get_warehouse_stock_risk": "rủi ro tồn kho", "get_dashboard_kpis": "KPI tổng quan",
    "get_warehouse_low_stock_items": "tồn thấp theo kho", "compare_warehouses": "so sánh kho",
    "explain_warehouse_shortage": "phân tích thiếu hàng", "analyze_demand_vs_stock": "nhu cầu so với tồn kho",
    "simulate_reorder_budget": "mô phỏng ngân sách", "explain_reorder_item": "đề xuất nhập của đầu sách",
    "rank_priority_tasks": "việc cần ưu tiên", "get_aging_inventory": "tồn kho lâu",
    "get_weeding_suggestions": "đề xuất thanh lý", "search_books": "tìm sách",
}
_LEAD_SOURCE = {"DEFAULT": "giá trị mặc định", "SUPPLIER_DECLARED": "cam kết của nhà cung cấp",
                "REQUESTED": "do bạn chỉ định"}


def _f(value, unit: str = "") -> str:
    return "—" if value is None else _format_value(value, unit)


def _ev(label: str, value, unit: str = "", source: str = "") -> dict:
    return {"label": label, "value": value, "unit": unit, "source": source}


def _claim(kind: str, statement: str, evidence: list | None = None, meaning: str = "",
           certainty: str | None = None, basis: str = "") -> dict:
    if kind == FACT:
        certainty, basis = HIGH, basis or _DIRECT
    elif kind in (ASSUMPTION, UNKNOWN):
        certainty = None
    return {"kind": kind, "statement": statement,
            "evidence": [e for e in evidence or [] if e.get("value") is not None],
            "meaning": meaning, "certainty": certainty, "basis": basis}


def _part(**kw) -> dict:
    return {"claims": kw.get("claims", []), "alternatives": kw.get("alternatives", []),
            "limits": kw.get("limits", []), "next_actions": kw.get("next_actions", []),
            "flags": set(kw.get("flags", ())), "headline": kw.get("headline")}


def _signed(value, unit: str = "") -> str:
    return ("+" if (value or 0) > 0 else "") + _f(value, unit)


def item_risks(x: dict) -> list[str]:
    """Risks of acting on one reorder line, from its own fields."""
    risks = []
    if x.get("lead_time_source") in ("DEFAULT", "SUPPLIER_DECLARED"):
        risks.append("Thời gian chờ hàng chưa được kiểm chứng bằng lịch sử giao thực tế.")
    trend = x.get("demand_trend_pct")
    if trend is not None and trend <= -20:
        risks.append(f"Nhu cầu đang giảm {abs(trend):g}% so với kỳ trước — cân nhắc nhập ít hơn đề xuất.")
    stockout, lead = x.get("estimated_days_until_stockout"), x.get("lead_time_days")
    if stockout is not None and lead is not None and stockout <= lead:
        risks.append(f"Có thể hết hàng sau {stockout:g} ngày, trước khi hàng về ({lead} ngày).")
    if not x.get("unit_cost"):
        risks.append("Thiếu đơn giá nên chi phí ước tính chưa phản ánh thực tế.")
    return risks


# ── warehouses ───────────────────────────────────────────────────────────────

_RISK_SRC = "analytics/warehouse-stock-risk"


def _wh_fact(row: dict) -> dict:
    name = row.get("warehouse_name")
    return _claim(FACT, f"{name}: {_f(row.get('out_of_stock_variants'))} đầu sách hết hàng, "
                        f"{_f(row.get('low_stock_variants'))} đầu sách dưới ngưỡng tồn tối thiểu, "
                        f"tồn khả dụng {_f(row.get('total_available_qty'))} bản.",
                  [_ev(f"{name} — hết hàng", row.get("out_of_stock_variants"), "đầu sách", _RISK_SRC),
                   _ev(f"{name} — dưới ngưỡng", row.get("low_stock_variants"), "đầu sách", _RISK_SRC),
                   _ev(f"{name} — tồn khả dụng", row.get("total_available_qty"), "bản", _RISK_SRC)])


def _ranking_part(ranking: list[dict], plan: QueryPlan, unresolved: list | None = None) -> dict:
    p = _part()
    for hint in unresolved or []:
        p["claims"].append(_claim(UNKNOWN, f"Không xác định được kho \"{hint}\" trong danh sách kho đang hoạt động."))
    if not ranking:
        p["claims"].append(_claim(UNKNOWN, "Không có dữ liệu tồn kho cho các kho được hỏi."))
        return p
    if len(ranking) == 1:
        p["claims"].append(_wh_fact(ranking[0]))
        return p
    a, b = ranking[0], ranking[1]
    p["claims"] += [_wh_fact(a), _wh_fact(b)]
    name_a, name_b = a.get("warehouse_name"), b.get("warehouse_name")
    if _risk_key(a) == _risk_key(b):
        p["claims"].insert(0, _claim(INFERENCE, f"{name_a} và {name_b} ngang nhau theo tiêu chí xếp hạng rủi ro.",
                                     certainty=MEDIUM, basis=_RISK_CRITERIA))
        return p
    for field, label, certainty in (("out_of_stock_variants", "số đầu sách hết hàng", HIGH),
                                    ("low_stock_variants", "số đầu sách dưới ngưỡng tồn tối thiểu", MEDIUM),
                                    ("total_available_qty", "tổng tồn khả dụng", LOW)):
        if (a.get(field) or 0) != (b.get(field) or 0):
            break
    unit = "bản" if field == "total_available_qty" else "đầu sách"
    meaning = f"Khác biệt quyết định là {label}: {_f(a.get(field))} so với {_f(b.get(field))} {unit}."
    if field == "out_of_stock_variants":
        meaning += " Hết hàng được xét trước vì bạn đọc không mượn được ngay."
    if (a.get("total_available_qty") or 0) > (b.get("total_available_qty") or 0):
        meaning += (f" {name_a} có tổng tồn khả dụng lớn hơn ({_f(a.get('total_available_qty'))} so với "
                    f"{_f(b.get('total_available_qty'))} bản), nhưng tổng tồn chỉ dùng để phân định khi hai tiêu chí "
                    "đầu bằng nhau — tổng tồn nhiều không có nghĩa là từng đầu sách đều đủ hàng.")
    statement = (f"{name_a} rủi ro thiếu sách cao hơn {name_b}." if len(ranking) == 2 else
                 f"{name_a} đang rủi ro thiếu sách cao nhất trong {len(ranking)} kho; xếp sau là {name_b}.")
    p["claims"].insert(0, _claim(INFERENCE, statement,
                                 [_ev(f"{name_a} — {label}", a.get(field), unit, _RISK_SRC),
                                  _ev(f"{name_b} — {label}", b.get(field), unit, _RISK_SRC)],
                                 meaning, certainty, _RISK_CRITERIA))
    if plan.answer_mode != LOOKUP:
        p["claims"].append(_claim(UNKNOWN, "Chưa có nhu cầu mượn tách theo từng kho, nên chưa đánh giá được mức ảnh "
                                           "hưởng tới bạn đọc của mỗi kho."))
    p["next_actions"].append(f"Xem danh sách đầu sách hết hàng tại {name_a} và kiểm tra {name_b} còn tồn các đầu sách "
                             "đó không trước khi điều chuyển.")
    return p


def _x_compare_warehouses(r: dict, plan: QueryPlan) -> dict:
    return _ranking_part(r.get("ranking") or [], plan, r.get("unresolved"))


def _x_stock_risk(r: list, plan: QueryPlan) -> dict:
    rows = sorted([x for x in r if isinstance(x, dict)], key=_risk_key)
    return _ranking_part(rows, plan)


def _x_low_items(r: dict, plan: QueryPlan) -> dict:
    name, src = r.get("warehouse_name"), "analytics/warehouse-stock-items"
    p = _part(claims=[_claim(FACT, f"{name}: {_f(r.get('total_items'))} đầu sách dưới ngưỡng tồn tối thiểu, trong đó "
                                   f"{_f(r.get('out_of_stock_count'))} đầu sách đã hết hàng.",
                             [_ev("Dưới ngưỡng (gồm hết hàng)", r.get("total_items"), "đầu sách", src),
                              _ev("Hết hàng", r.get("out_of_stock_count"), "đầu sách", src)],
                             "Ngưỡng tồn tối thiểu là mức tồn mà dưới đó hệ thống coi là cần nhập thêm.")])
    held = [x for x in r.get("items") or [] if (x.get("available_qty") or 0) <= 0 and (x.get("reserved_qty") or 0) > 0]
    if held:
        p["claims"].append(_claim(FACT, f"{len(held)} đầu sách hết tồn khả dụng nhưng vẫn có bản đang giữ cho đặt chỗ.",
                                  [_ev(x.get("title"), x.get("reserved_qty"), "bản giữ", src) for x in held[:3]],
                                  "Bản đang giữ đã có người đặt, nên không cho mượn mới được."))
    if r.get("truncated"):
        p["limits"].append("Danh sách tồn thấp dài nên chỉ một phần được trả về.")
    if plan.answer_mode in _ADVICE_MODES and r.get("out_of_stock_count"):
        p["next_actions"].append(f"Ưu tiên bổ sung các đầu sách đã hết hàng tại {name}.")
    return p


def _x_shortage(r: dict, plan: QueryPlan) -> dict:
    name, src = r.get("warehouse_name"), "warehouse-stock-items + reorder-suggestions (nối theo variant_id)"
    s = r.get("summary") or {}
    items = r.get("items") or []
    low = s.get("low_stock_items") or 0
    p = _part(flags={"causal"}, claims=[
        _claim(FACT, f"{name} có {_f(low)} đầu sách dưới ngưỡng tồn tối thiểu, trong đó {_f(s.get('out_of_stock_items'))} "
                     "đầu sách đã hết hàng.",
               [_ev("Dưới ngưỡng", low, "đầu sách", src), _ev("Hết hàng", s.get("out_of_stock_items"), "đầu sách", src)])])
    factors = 0
    demand = sorted([x for x in items if (x.get("borrow_count") or 0) > 0], key=lambda x: -(x.get("borrow_count") or 0))
    n_demand = s.get("items_with_recent_demand") or 0
    if n_demand:
        factors += 1
        p["claims"].append(_claim(
            INFERENCE, f"Thiếu hàng đi kèm nhu cầu mượn thực: {_f(n_demand)}/{_f(low)} đầu sách đang thiếu vẫn có lượt "
                       "mượn trong kỳ.",
            [_ev(x.get("title"), x.get("borrow_count"), "lượt mượn", src) for x in demand[:3]],
            "Đây là phần thiếu hụt ảnh hưởng trực tiếp tới bạn đọc; đầu sách không có lượt mượn ít cấp bách hơn.",
            MEDIUM if n_demand >= 3 else LOW,
            "Tương quan quan sát được; lượt mượn tính trên toàn hệ thống, chưa tách theo kho."))
    rising = sorted([x for x in items if (x.get("demand_trend_pct") or 0) > 0], key=lambda x: -(x.get("demand_trend_pct") or 0))
    if s.get("items_with_rising_demand"):
        factors += 1
        p["claims"].append(_claim(
            INFERENCE, f"{_f(s.get('items_with_rising_demand'))} đầu sách đang thiếu có nhu cầu tăng so với kỳ trước.",
            [_ev(x.get("title"), x.get("demand_trend_pct"), "%", src) for x in rising[:3]],
            "Nếu xu hướng này tiếp tục, thiếu hụt ở các đầu sách đó có thể lớn hơn.",
            LOW, "Xu hướng của một kỳ, chưa đủ để dự báo chắc chắn."))
    reserved = [x for x in items if (x.get("reservation_count") or 0) > 0]
    if reserved:
        factors += 1
        p["claims"].append(_claim(
            FACT, f"{len(reserved)} đầu sách đang thiếu có lượt đặt chỗ.",
            [_ev(x.get("title"), x.get("reservation_count"), "lượt đặt", src) for x in reserved[:3]],
            "Bản giữ cho đặt chỗ không cho mượn mới được, nên tồn khả dụng thấp hơn tồn thực tế."))
    long_lead = [x for x in items if (x.get("lead_time_days") or 0) >= 21]
    if long_lead:
        factors += 1
        p["claims"].append(_claim(
            INFERENCE, f"{len(long_lead)} đầu sách đang thiếu cần chờ hàng từ 21 ngày trở lên.",
            [_ev(x.get("title"), x.get("lead_time_days"), "ngày chờ", src) for x in long_lead[:3]],
            "Thời gian chờ dài khiến thiếu hụt kéo dài nếu không đặt hàng sớm.", MEDIUM,
            "Thời gian chờ hàng của từng đầu sách trong mô hình đề xuất nhập."))
        unverified = [x for x in long_lead if x.get("lead_time_source") in _LEAD_SOURCE]
        if unverified:
            p["claims"].append(_claim(ASSUMPTION, f"Thời gian chờ hàng của {len(unverified)}/{len(long_lead)} đầu sách này "
                                                  "là giá trị mặc định hoặc cam kết nhà cung cấp, chưa kiểm chứng."))
    p["claims"].append(_claim(UNKNOWN, f"Nhu cầu mượn riêng tại {name}: mô hình chỉ có nhu cầu toàn hệ thống."))
    p["claims"].append(_claim(UNKNOWN, "Lịch sử nhập, xuất và điều chuyển của kho chưa được phân tích, nên chưa biết "
                                       "thiếu hụt bắt đầu từ khi nào."))
    p["headline"] = (f"Thiếu sách ở {name} đi kèm {factors} yếu tố quan sát được trong dữ liệu; đây là tương quan, chưa đủ "
                     "để khẳng định nguyên nhân." if factors else
                     f"Dữ liệu chưa cho thấy yếu tố nào đi kèm tình trạng thiếu sách ở {name}.")
    p["limits"] += r.get("limitations") or []
    urgent = [x.get("title") for x in demand if x.get("status") == "HẾT HÀNG"][:3]
    if urgent:
        p["next_actions"].append(f"Ưu tiên bổ sung {', '.join(urgent)} — đã hết hàng tại {name} nhưng vẫn có lượt mượn.")
    return p


# ── borrowing ────────────────────────────────────────────────────────────────

def _x_compare_periods(r: dict, plan: QueryPlan) -> dict:
    a, b = r.get("current_period") or {}, r.get("previous_period") or {}
    loans = (r.get("metrics") or {}).get("loans") or {}
    src = "analytics/borrow-trends"
    p = _part(claims=[_claim(
        FACT, f"Lượt mượn: {_f(loans.get('current'))} trong kỳ hiện tại ({_f(a.get('days'))} ngày) so với "
              f"{_f(loans.get('previous'))} kỳ trước ({_f(b.get('days'))} ngày).",
        [_ev("Kỳ hiện tại", loans.get("current"), "lượt", src), _ev("Kỳ trước", loans.get("previous"), "lượt", src),
         _ev("Chênh lệch", loans.get("change"), "lượt", src)])])
    pct, per_day = loans.get("change_pct"), loans.get("per_day_change_pct")
    if r.get("unequal_length") and per_day is not None:
        p["claims"].insert(0, _claim(
            INFERENCE, f"Tính theo trung bình mỗi ngày, lượt mượn {'tăng' if per_day > 0 else 'giảm'} "
                       f"{_f(abs(per_day))}% ({_f(loans.get('current_per_day'))} so với "
                       f"{_f(loans.get('previous_per_day'))} lượt/ngày).",
            [_ev("Trung bình/ngày kỳ hiện tại", loans.get("current_per_day"), "lượt", src),
             _ev("Trung bình/ngày kỳ trước", loans.get("previous_per_day"), "lượt", src)],
            "Hai kỳ dài khác nhau nên tổng lượt mượn không so sánh trực tiếp được; trung bình mỗi ngày công bằng hơn.",
            MEDIUM, "So sánh trung bình mỗi ngày giữa hai kỳ dài khác nhau."))
        p["claims"].append(_claim(ASSUMPTION, "Nhu cầu mượn phân bố tương đối đều trong kỳ (điều kiện để so sánh theo "
                                              "trung bình mỗi ngày)."))
    elif pct is not None:
        p["claims"].insert(0, _claim(FACT, f"Lượt mượn {'tăng' if pct > 0 else 'giảm'} {_f(abs(pct))}% so với kỳ trước.",
                                     [_ev("Thay đổi", pct, "%", src)]))
    other = [(k, v) for k, v in (r.get("metrics") or {}).items() if k != "loans" and isinstance(v, dict)]
    if other:
        names = {"returns": "lượt trả", "reservations": "lượt đặt chỗ"}
        p["claims"].append(_claim(FACT, "; ".join(f"{names.get(k, k)}: {_f(v.get('current'))} so với {_f(v.get('previous'))}"
                                                  for k, v in other) + ".",
                                  [_ev(f"{names.get(k, k)} kỳ hiện tại", v.get("current"), "lượt", src) for k, v in other]))
    if a.get("peak_day"):
        y, m, d = str(a["peak_day"])[:10].split("-")
        p["claims"].append(_claim(FACT, f"Ngày cao điểm kỳ hiện tại: {d}/{m}/{y} với {_f(a.get('peak_loans'))} lượt mượn.",
                                  [_ev("Lượt mượn ngày cao điểm", a.get("peak_loans"), "lượt", src)]))
    if plan.answer_mode in (CAUSAL, ANALYSIS, COMPARISON):
        p["claims"].append(_claim(UNKNOWN, "Dữ liệu không cho biết lý do thay đổi (mùa vụ, sự kiện, tình trạng tồn kho...)."))
    return p


def _x_borrow_trends(r: list, plan: QueryPlan) -> dict:
    """Trend of a borrow-trends series. Uses the same buckets and arithmetic
    as the chart (copilot_visualization.trend_summary), so the chart and this
    explanation can never disagree on totals or direction."""
    trend = borrow_trend_points(r, plan)
    s = trend_summary(trend)
    if not s:
        return _x_generic("get_borrow_trends", r)
    src, unit = "analytics/borrow-trends", trend["unit_label"]
    partial = [p for p in trend["points"] if p["partial"]]
    p = _part(claims=[
        _claim(FACT, f"Tổng lượt mượn trong kỳ: {_f(s['total'])} lượt qua {s['buckets']} {unit}"
                     + (f" (gồm {len(partial)} {unit} chưa trọn kỳ)" if partial else "") + ".",
               [_ev("Tổng lượt mượn", s["total"], "lượt", src)]),
        _claim(FACT, f"Cao nhất là {s['peak_label']} với {_f(s['peak_value'])} lượt mượn.",
               [_ev(f"Lượt mượn {s['peak_label']}", s["peak_value"], "lượt", src)]),
    ])
    if s["low_label"] and s["low_label"] != s["peak_label"]:
        p["claims"].append(_claim(FACT, f"Thấp nhất trong các {unit} trọn kỳ là {s['low_label']} với "
                                        f"{_f(s['low_value'])} lượt mượn.",
                                  [_ev(f"Lượt mượn {s['low_label']}", s["low_value"], "lượt", src)]))
    if s["direction"]:
        change = s["change_pct"]
        span = f"từ {_f(s['first_value'])} lượt ({s['first_label']}) đến {_f(s['last_value'])} lượt ({s['last_label']})"
        statement = (f"Lượt mượn tương đối ổn định: {span}." if s["direction"] == "đi ngang" else
                     f"Lượt mượn có xu hướng {s['direction']}: {span}"
                     + (f", {_signed(change)}%." if change is not None else "."))
        p["claims"].insert(0, _claim(
            INFERENCE, statement,
            [_ev(f"Lượt mượn {s['first_label']}", s["first_value"], "lượt", src),
             _ev(f"Lượt mượn {s['last_label']}", s["last_value"], "lượt", src), _ev("Thay đổi", change, "%", src)],
            f"So sánh {unit} trọn kỳ đầu tiên và cuối cùng; {unit} chưa trọn kỳ không dùng để kết luận xu hướng.",
            MEDIUM if s["complete_buckets"] >= 4 else LOW,
            f"Điểm đầu và cuối của {s['complete_buckets']} {unit} trọn kỳ; chưa xét mùa vụ, chưa kiểm định thống kê."))
    else:
        p["claims"].append(_claim(UNKNOWN, f"Chưa đủ {unit} trọn kỳ để xác định xu hướng."))
    if partial:
        p["limits"].append(f"{len(partial)} {unit} chưa trọn kỳ ({', '.join(x['label'] for x in partial)}) chỉ được "
                           "tính vào tổng, không dùng để xác định xu hướng.")
    if plan.answer_mode in (CAUSAL, ANALYSIS, COMPARISON):
        p["claims"].append(_claim(UNKNOWN, "Dữ liệu không cho biết lý do thay đổi (mùa vụ, sự kiện, tình trạng tồn kho...)."))
    return p


def _period_days(period: dict) -> int | None:
    try:
        from datetime import date
        return (date.fromisoformat(period["to"][:10]) - date.fromisoformat(period["from"][:10])).days + 1
    except (KeyError, TypeError, ValueError):
        return None


def _x_compare_top(r: dict, plan: QueryPlan) -> dict:
    current = r.get("current") or []
    dropped = r.get("dropped_out") or []
    src = "analytics/top-books"
    p = _part()
    if not current:
        p["claims"].append(_claim(FACT, "Kỳ hiện tại chưa có lượt mượn nào."))
        return p
    lead = current[0]
    prev = f"kỳ trước hạng {lead['previous_rank']}" if lead.get("previous_rank") else "kỳ trước không có trong top"
    new = [x for x in current if x.get("status") == "MỚI VÀO TOP"]
    moved = [x for x in current if x.get("status") != "GIỮ HẠNG"]
    p["claims"] += [
        _claim(FACT, f"Dẫn đầu kỳ hiện tại: {lead.get('title')} với {_f(lead.get('borrow_count'))} lượt ({prev}).",
               [_ev(lead.get("title"), lead.get("borrow_count"), "lượt", src)]),
        _claim(FACT, f"{len(new)} đầu sách mới vào top, {len(dropped)} đầu sách rơi khỏi top.",
               [_ev("Mới vào top", len(new), "đầu sách", src), _ev("Rơi khỏi top", len(dropped), "đầu sách", src)]),
    ]
    if len(current) >= 3 and len(moved) / len(current) > 0.5:
        p["claims"].insert(0, _claim(
            INFERENCE, f"Thứ hạng biến động nhiều: {len(moved)}/{len(current)} đầu sách đổi hạng hoặc mới vào top.",
            [_ev("Đổi hạng hoặc mới vào top", len(moved), "đầu sách", src)],
            "Nhu cầu đang dịch chuyển giữa các đầu sách; top kỳ trước không còn là căn cứ tốt để nhập hàng.",
            LOW, "Chỉ dựa trên thứ hạng của hai kỳ; kỳ ngắn dễ biến động."))
    da, db = _period_days(r.get("current_period") or {}), _period_days(r.get("previous_period") or {})
    if da and db and da != db:
        p["limits"].append(f"Kỳ hiện tại dài {da} ngày, kỳ so sánh {db} ngày: số lượt tuyệt đối không so sánh trực tiếp được.")
    return p


# ── reorder ──────────────────────────────────────────────────────────────────

_REORDER_SRC = "analytics/reorder-suggestions"


def _why_after(first: dict, other: dict) -> str:
    p1, p2 = first.get("priority"), other.get("priority")
    if p1 != p2:
        return f"Xếp sau vì mức ưu tiên thấp hơn ({p2} so với {p1})."
    d1, d2 = first.get("demand_score"), other.get("demand_score")
    if isinstance(d1, (int, float)) and isinstance(d2, (int, float)) and d1 != d2:
        return f"Cùng mức ưu tiên {p1} nhưng điểm nhu cầu thấp hơn ({_f(d2)} so với {_f(d1)})."
    return f"Cùng mức ưu tiên {p1}; xếp sau theo thứ tự của hệ thống (điểm nhu cầu, rồi số lượng đề xuất)."


def _first_reason(x: dict) -> str:
    bits = [f"mức ưu tiên {x.get('priority')}",
            f"tồn khả dụng {_f(x.get('available_qty'))} bản so với ngưỡng {_f(x.get('reorder_point'))}"]
    if x.get("estimated_days_until_stockout") is not None:
        bits.append(f"dự kiến hết hàng sau {_f(x.get('estimated_days_until_stockout'))} ngày")
    if x.get("borrow_count") is not None:
        bits.append(f"{_f(x.get('borrow_count'))} lượt mượn trong kỳ")
    return "Đứng đầu danh sách: " + ", ".join(bits) + "."


def _x_reorder(r: dict, plan: QueryPlan) -> dict:
    s = r.get("summary") or {}
    p = _part(claims=[_claim(
        FACT, f"{_f(s.get('total_candidates'))} đầu sách cần xem xét nhập ({_f(s.get('high_priority'))} ưu tiên cao); "
              f"tổng {_f(s.get('estimated_total_reorder_qty'))} bản, ước tính {_f(s.get('estimated_total_cost'), 'đ')}.",
        [_ev("Đầu sách cần xem xét", s.get("total_candidates"), "đầu sách", _REORDER_SRC),
         _ev("Ưu tiên cao", s.get("high_priority"), "đầu sách", _REORDER_SRC),
         _ev("Chi phí ước tính", s.get("estimated_total_cost"), "đ", _REORDER_SRC)])])
    items = [x for x in r.get("items") or [] if isinstance(x, dict) and x.get("title")]
    if r.get("budget"):
        b = r["budget"]
        p["claims"].append(_claim(FACT, f"Ngân sách {_f(b.get('budget_vnd'), 'đ')}: duyệt {_f(b.get('funded_cost'), 'đ')}, "
                                        f"còn lại {_f(b.get('remaining_vnd'), 'đ')}.",
                                  [_ev("Đã duyệt", b.get("funded_cost"), "đ", _REORDER_SRC)]))
        items = [x for x in items if x.get("within_budget")]
    if not items:
        p["claims"].append(_claim(FACT, "Hiện không có đầu sách nào cần nhập thêm."))
        return p
    first = items[0]
    conf = data_confidence(first)
    p["claims"].insert(0, _claim(
        INFERENCE, f"Nên xem xét nhập {first['title']} trước.",
        [_ev("Tồn khả dụng", first.get("available_qty"), "bản", _REORDER_SRC),
         _ev("Ngưỡng tồn tối thiểu", first.get("reorder_point"), "bản", _REORDER_SRC),
         _ev("Dự kiến hết hàng sau", first.get("estimated_days_until_stockout"), "ngày", _REORDER_SRC)],
        _first_reason(first), conf["level"], conf["basis"] + ". Thứ tự: ưu tiên, rồi điểm nhu cầu, rồi số lượng đề xuất."))
    for x in items[1:3]:
        p["alternatives"].append({
            "option": x["title"],
            "outcome": f"Ưu tiên {x.get('priority')}, tồn {_f(x.get('available_qty'))}/ngưỡng {_f(x.get('reorder_point'))}, "
                       f"đề xuất {_f(x.get('suggested_reorder_qty'))} bản ≈ {_f(x.get('estimated_cost'), 'đ')}.",
            "tradeoff": _why_after(first, x)})
    top = items[:8]
    unverified = [x for x in top if x.get("lead_time_source") in ("DEFAULT", "SUPPLIER_DECLARED")]
    if unverified:
        p["claims"].append(_claim(ASSUMPTION, f"{len(unverified)}/{len(top)} đầu sách đầu danh sách dùng thời gian chờ "
                                              "hàng mặc định hoặc theo cam kết nhà cung cấp, chưa học từ lịch sử giao."))
    p["next_actions"].append("Duyệt các đầu sách ưu tiên cao và lập phiếu đề xuất nhập (hệ thống yêu cầu bạn xác nhận "
                             "trước khi tạo).")
    return p


def _x_reorder_item(r: dict, plan: QueryPlan) -> dict:
    if not r.get("found"):
        return _part(claims=[
            _claim(FACT, f"\"{r.get('query')}\" không nằm trong danh sách đề xuất nhập hiện tại "
                         f"({_f(r.get('total_candidates'))} đầu sách)."),
            _claim(INFERENCE, "Thường là vì tồn còn đủ so với nhu cầu dự báo, hoặc không có tín hiệu nhu cầu gần đây.",
                   certainty=LOW, basis="Quy tắc lập danh sách đề xuất; chưa tra cứu riêng đầu sách này."),
            _claim(UNKNOWN, "Tồn kho và lượt mượn của đầu sách này chưa được tra cứu trong lượt này."),
        ])
    x, conf = r.get("item") or {}, r.get("data_confidence") or data_confidence(r.get("item") or {})
    title = x.get("title")
    p = _part(claims=[
        _claim(FACT, f"{title} đứng thứ {r.get('rank_in_list')}/{_f(r.get('total_candidates'))} trong danh sách đề xuất "
                     f"nhập, mức ưu tiên {x.get('priority')}.",
               [_ev("Thứ hạng", r.get("rank_in_list"), "", _REORDER_SRC)]),
        _claim(FACT, f"Tồn khả dụng {_f(x.get('available_qty'))} bản so với ngưỡng tồn tối thiểu {_f(x.get('reorder_point'))} bản.",
               [_ev("Tồn khả dụng", x.get("available_qty"), "bản", _REORDER_SRC),
                _ev("Ngưỡng tồn tối thiểu", x.get("reorder_point"), "bản", _REORDER_SRC)],
               "Đã ở mức cần nhập thêm." if (x.get("available_qty") or 0) <= (x.get("reorder_point") or 0) else ""),
    ])
    if x.get("borrow_count") is not None:
        trend = x.get("demand_trend_pct")
        meaning = ("Nhu cầu đang giảm, nên cân nhắc nhập ít hơn đề xuất." if trend is not None and trend <= -20 else
                   "Nhu cầu đang tăng." if trend is not None and trend >= 20 else "")
        p["claims"].append(_claim(
            FACT, f"{_f(x.get('borrow_count'))} lượt mượn trong kỳ (kỳ trước {_f(x.get('previous_borrow_count'))}"
                  + (f", thay đổi {_f(trend)}%" if trend is not None else "") + ").",
            [_ev("Lượt mượn trong kỳ", x.get("borrow_count"), "lượt", _REORDER_SRC),
             _ev("Lượt mượn kỳ trước", x.get("previous_borrow_count"), "lượt", _REORDER_SRC)], meaning))
    stockout, lead = x.get("estimated_days_until_stockout"), x.get("lead_time_days")
    if stockout is not None and lead is not None:
        p["claims"].append(_claim(
            FACT, f"Dự kiến hết hàng sau {_f(stockout)} ngày; thời gian chờ hàng {_f(lead)} ngày.",
            [_ev("Dự kiến hết hàng sau", stockout, "ngày", _REORDER_SRC), _ev("Thời gian chờ hàng", lead, "ngày", _REORDER_SRC)],
            "Đặt hôm nay thì hàng vẫn về sau khi hết — bạn đọc có thể phải chờ." if stockout <= lead else ""))
    p["claims"].insert(0, _claim(
        INFERENCE, f"Đề xuất nhập {_f(x.get('suggested_reorder_qty'))} bản"
                   + (f" (≈ {_f(x.get('estimated_cost'), 'đ')})" if x.get("estimated_cost") is not None else "") + ".",
        [_ev("Đề xuất nhập", x.get("suggested_reorder_qty"), "bản", _REORDER_SRC)],
        x.get("reason") or "", conf.get("level"), conf.get("basis", "")))
    if x.get("lead_time_source") in _LEAD_SOURCE:
        p["claims"].append(_claim(ASSUMPTION, f"Thời gian chờ hàng {_f(lead)} ngày là "
                                              f"{_LEAD_SOURCE[x['lead_time_source']]}, chưa kiểm chứng bằng lịch sử giao."))
    p["limits"] += item_risks(x)
    p["next_actions"].append(f"Nếu đồng ý, lập phiếu đề xuất nhập {_f(x.get('suggested_reorder_qty'))} bản {title} "
                             "(cần xác nhận trước khi tạo).")
    return p


def _x_demand_vs_stock(r: dict, plan: QueryPlan) -> dict:
    c = r.get("counts") or {}
    src = "top-books + reorder-suggestions (nối theo variant_id)"
    rows = r.get("rows") or []
    p = _part(claims=[_claim(FACT, f"Đã đối chiếu {_f(c.get('top_books_checked'))} sách mượn nhiều nhất; "
                                   f"{_f(c.get('flagged'))} sách vừa mượn nhiều vừa tồn thấp cần nhập.",
                             [_ev("Sách đã đối chiếu", c.get("top_books_checked"), "đầu sách", src),
                              _ev("Thỏa tiêu chí", c.get("flagged"), "đầu sách", src)])],
              limits=["Lượt mượn tính trong kỳ; tồn kho tính trên toàn hệ thống, chưa tách theo kho."])
    if not rows:
        p["claims"][0]["meaning"] = "Các sách được mượn nhiều hiện vẫn đủ hàng so với ngưỡng."
        return p
    first = rows[0]
    conf = first.get("data_confidence") or {}
    p["claims"].insert(0, _claim(
        INFERENCE, f"Trong nhóm này, nên xem xét nhập {first['title']} trước.",
        [_ev("Lượt mượn", first.get("borrow_count"), "lượt", src), _ev("Tồn khả dụng", first.get("available_qty"), "bản", src),
         _ev("Ngưỡng tồn tối thiểu", first.get("reorder_point"), "bản", src)],
        f"Hạng {first.get('borrow_rank')} về lượt mượn nhưng tồn khả dụng chỉ {_f(first.get('available_qty'))} bản "
        f"(ngưỡng {_f(first.get('reorder_point'))}).", conf.get("level", MEDIUM), conf.get("basis", "")))
    for x in rows[1:3]:
        p["alternatives"].append({
            "option": x["title"],
            "outcome": f"Hạng {x.get('borrow_rank')} lượt mượn, tồn {_f(x.get('available_qty'))}/ngưỡng "
                       f"{_f(x.get('reorder_point'))}, ưu tiên {x.get('priority')}.",
            "tradeoff": f"Xếp sau vì ít lượt mượn hơn ({_f(x.get('borrow_count'))} so với {_f(first.get('borrow_count'))})."})
    p["next_actions"].append("Lập phiếu đề xuất nhập cho các đầu sách này (hệ thống yêu cầu bạn xác nhận trước khi tạo).")
    return p


def _x_simulation(r: dict, plan: QueryPlan) -> dict:
    need = r.get("full_need") or {}
    src = "analytics/reorder-suggestions?budgetVnd"
    rule = r.get("funding_rule") or ""
    p = _part(claims=[_claim(
        FACT, f"Nhu cầu nhập đầy đủ: {_f(need.get('total_candidates'))} đầu sách ({_f(need.get('high_priority'))} ưu tiên "
              f"cao), {_f(need.get('estimated_total_reorder_qty'))} bản, ước tính {_f(need.get('estimated_total_cost'), 'đ')}.",
        [_ev("Chi phí nhu cầu đầy đủ", need.get("estimated_total_cost"), "đ", src)])])
    if r.get("scenarios_are_assumed"):
        p["claims"].append(_claim(ASSUMPTION, "Chưa có mức ngân sách cụ thể; các kịch bản là mức giả định theo % tổng "
                                              "nhu cầu nhập."))
    ok = [s for s in r.get("scenarios") or [] if not s.get("error")]
    for s in r.get("scenarios") or []:
        if s.get("error"):
            p["claims"].append(_claim(UNKNOWN, f"Không mô phỏng được \"{s.get('label')}\" (lỗi truy xuất)."))
    incomplete = bool(r.get("items_not_listed"))
    for s in ok:
        label = s.get("label")
        pct = s.get("shortfall_covered_pct")
        meaning = ""
        if pct is not None and pct >= 100 and r.get("items_not_listed"):
            meaning = (f"Đủ thiếu hụt dự kiến của {_f(r.get('items_counted'))} dòng được liệt kê; "
                       f"{_f(r.get('items_not_listed'))} đầu sách ngoài danh sách chưa được tính, nên chưa thể nói là "
                       "đáp ứng toàn bộ nhu cầu.")
        p["claims"].append(_claim(
            FACT, f"{label}: duyệt {_f(s.get('funded_cost'), 'đ')} cho {_f(s.get('funded_lines'))} đầu sách / "
                  f"{_f(s.get('funded_qty'))} bản; {_f(s.get('unfunded_high_priority'))} đầu sách ưu tiên cao chưa được nhập"
                  + (f"; bù được {_f(pct)}% thiếu hụt dự kiến" if pct is not None else "") + ".",
            [_ev("Chi phí duyệt", s.get("funded_cost"), "đ", src), _ev("Đầu sách được duyệt", s.get("funded_lines"), "đầu sách", src),
             _ev("Ưu tiên cao chưa nhập", s.get("unfunded_high_priority"), "đầu sách", src)], meaning))
        if s.get("unfunded_high_priority"):
            incomplete = True
        if pct == 0 and s.get("funded_lines") and r.get("lines_with_shortfall"):
            p["claims"].append(_claim(
                INFERENCE, f"{label} chưa bù được phần thiếu hụt dự kiến nào, dù vẫn duyệt {_f(s.get('funded_lines'))} đầu sách.",
                [_ev("Dòng có thiếu hụt dự kiến", r.get("lines_with_shortfall"), "dòng", src),
                 _ev("Dòng có thiếu hụt được duyệt", s.get("funded_shortfall_lines"), "dòng", src)],
                f"{_f(r.get('lines_with_shortfall'))} dòng có thiếu hụt dự kiến đều cần chi phí lớn hơn phần ngân sách còn "
                "lại khi được xét, nên tiền được dùng cho các dòng bổ sung tồn an toàn.", HIGH, rule))
    if len(ok) >= 2:
        first, last = ok[0], ok[-1]
        diff = last.get("vs_first_scenario") or {}
        p["claims"].append(_claim(
            FACT, f"Từ \"{first.get('label')}\" sang \"{last.get('label')}\": chi phí duyệt {_signed(diff.get('funded_cost'), 'đ')}, "
                  f"số đầu sách {_signed(diff.get('funded_lines'))}, ưu tiên cao chưa nhập {_signed(diff.get('unfunded_high_priority'))}.",
            [_ev("Chênh lệch chi phí duyệt", diff.get("funded_cost"), "đ", src)]))
        p["claims"].insert(0, _claim(
            INFERENCE, "Không có kịch bản nào tối ưu tuyệt đối: ngân sách lớn hơn nhập được nhiều đầu sách ưu tiên cao "
                       "hơn, đổi lại chi phí cao hơn.",
            meaning="Chọn mức nào phụ thuộc vào việc chấp nhận để lại bao nhiêu đầu sách ưu tiên cao chưa được nhập.",
            certainty=MEDIUM, basis="Mô phỏng chỉ áp dụng quy tắc phân bổ; không có hàm mục tiêu để tối ưu."))
        for s in ok[1:]:
            d = s.get("vs_first_scenario") or {}
            p["alternatives"].append({
                "option": s.get("label"),
                "outcome": f"Duyệt {_f(s.get('funded_cost'), 'đ')}, {_f(s.get('funded_lines'))} đầu sách / "
                           f"{_f(s.get('funded_qty'))} bản; {_f(s.get('unfunded_high_priority'))} ưu tiên cao chưa nhập.",
                "tradeoff": f"So với \"{first.get('label')}\": chi phí {_signed(d.get('funded_cost'), 'đ')}, "
                            f"{_signed(d.get('funded_lines'))} đầu sách, {_signed(d.get('unfunded_high_priority'))} ưu tiên cao "
                            "chưa nhập."})
    p["claims"].append(_claim(ASSUMPTION, "Chi phí tính theo đơn giá hiện có trong danh mục; chưa tính chiết khấu hay phí "
                                          "vận chuyển."))
    p["claims"].append(_claim(UNKNOWN, "Ràng buộc nhà cung cấp (số lượng đặt tối thiểu, lịch giao) và ngân sách theo kho "
                                       "chưa có trong dữ liệu."))
    if incomplete:
        p["flags"].add("coverage_incomplete")
    if ok and not r.get("scenarios_are_assumed"):
        p["next_actions"].append(f"Nếu chọn \"{ok[0].get('label')}\": lập phiếu đề xuất nhập cho các đầu sách được duyệt "
                                 "(cần bạn xác nhận trước khi tạo).")
    return p


# ── other tools ──────────────────────────────────────────────────────────────

_TIER_NAMES = {1: "phục vụ bạn đọc bị gián đoạn ngay", 2: "rủi ro tài chính/tuân thủ", 3: "phòng ngừa"}


def _x_priorities(r: dict, plan: QueryPlan) -> dict:
    tasks = r.get("tasks") or []
    p = _part()
    for t in tasks[:3]:
        unit = "đ" if t.get("unit") == "₫" else t.get("unit", "")
        p["claims"].append(_claim(FACT, f"{t['task']}: {_f(t.get('value'), unit)}.",
                                  [_ev(t["task"], t.get("value"), unit, t.get("source", ""))]))
    if tasks:
        t1 = tasks[0]
        p["claims"].insert(0, _claim(INFERENCE, f"Nên xử lý trước: {t1['task']}.", meaning=t1.get("why", ""),
                                     certainty=MEDIUM, basis="Thứ tự theo quy tắc cố định theo mức ảnh hưởng, không phải mô "
                                                             "hình tối ưu."))
        p["next_actions"].append(t1.get("next_step", ""))
        for t in tasks[1:3]:
            unit = "đ" if t.get("unit") == "₫" else t.get("unit", "")
            p["alternatives"].append({
                "option": t["task"], "outcome": f"Quy mô {_f(t.get('value'), unit)}.",
                "tradeoff": (f"Thuộc nhóm {_TIER_NAMES.get(t.get('tier'), t.get('tier'))}, xếp sau nhóm "
                             f"{_TIER_NAMES.get(t1.get('tier'), t1.get('tier'))}." if t.get("tier") != t1.get("tier")
                             else "Cùng nhóm, quy mô nhỏ hơn nên xếp sau.")})
    for item in r.get("unavailable") or []:
        p["claims"].append(_claim(UNKNOWN, f"Chưa lấy được dữ liệu {item}."))
    return p


def _x_overdue(r: dict, plan: QueryPlan) -> dict:
    src = "analytics/overdue-summary"
    p = _part(claims=[_claim(
        FACT, f"{_f(r.get('total_overdue_loans'))} phiếu mượn quá hạn; trung bình trễ {_f(r.get('average_overdue_days'))} "
              f"ngày, lâu nhất {_f(r.get('oldest_overdue_days'))} ngày.",
        [_ev("Phiếu quá hạn", r.get("total_overdue_loans"), "phiếu", src),
         _ev("Trễ trung bình", r.get("average_overdue_days"), "ngày", src),
         _ev("Trễ lâu nhất", r.get("oldest_overdue_days"), "ngày", src)])])
    if plan.answer_mode != LOOKUP and (r.get("average_overdue_days") or 0) >= 30:
        p["claims"].insert(0, _claim(
            INFERENCE, "Quá hạn đang tồn đọng lâu, không chỉ là trễ vài ngày.",
            [_ev("Trễ trung bình", r.get("average_overdue_days"), "ngày", src)],
            "Phiếu trễ lâu khó thu hồi sách hơn và tiền phạt tích lũy lớn hơn.", MEDIUM,
            "Trung bình có thể bị kéo lên bởi một số phiếu rất cũ; chưa có phân bố theo nhóm số ngày trễ."))
    if plan.answer_mode in _ADVICE_MODES or plan.answer_mode == ANALYSIS:
        p["next_actions"].append("Liên hệ các phiếu quá hạn lâu nhất trước.")
    return p


def _x_generic(base: str, result) -> dict:
    items = extract_evidence(base, result)[:4]
    if not items:
        return _part()
    statement = "; ".join(f"{i['label']}: {_f(i.get('value'), i.get('unit', ''))}" for i in items[:3]) + "."
    return _part(claims=[_claim(FACT, statement, [_ev(i["label"], i.get("value"), i.get("unit", ""), i.get("tool_name", base))
                                                  for i in items])])


_EXPLAINERS = {
    "compare_warehouses": (_x_compare_warehouses, dict),
    "get_warehouse_stock_risk": (_x_stock_risk, list),
    "get_warehouse_low_stock_items": (_x_low_items, dict),
    "explain_warehouse_shortage": (_x_shortage, dict),
    "compare_borrow_periods": (_x_compare_periods, dict),
    "get_borrow_trends": (_x_borrow_trends, list),
    "compare_top_books": (_x_compare_top, dict),
    "get_reorder_suggestions": (_x_reorder, dict),
    "explain_reorder_item": (_x_reorder_item, dict),
    "analyze_demand_vs_stock": (_x_demand_vs_stock, dict),
    "simulate_reorder_budget": (_x_simulation, dict),
    "rank_priority_tasks": (_x_priorities, dict),
    "get_overdue_summary": (_x_overdue, dict),
}


def _explain_tool(base: str, result, plan: QueryPlan) -> dict:
    if isinstance(result, dict) and result.get("error"):
        label = TOOL_LABELS.get(base, base)
        if "403" in str(result["error"]):
            text = f"Tài khoản của bạn không có quyền xem dữ liệu {label}, nên phần này chưa được phân tích."
        else:
            text = f"Chưa lấy được dữ liệu {label} (lỗi truy xuất), nên phần này chưa được phân tích."
        return _part(claims=[_claim(UNKNOWN, text)])
    entry = _EXPLAINERS.get(base)
    if entry and isinstance(result, entry[1]):
        try:
            return entry[0](result, plan)
        except Exception:  # noqa: BLE001 - an explanation is never worth a failed turn
            pass
    try:
        return _x_generic(base, result)
    except Exception:  # noqa: BLE001
        return _part()


def _unique(values: list) -> list:
    seen, out = set(), []
    for v in values:
        key = v if isinstance(v, str) else repr(sorted(v.items())) if isinstance(v, dict) else repr(v)
        if v and key not in seen:
            seen.add(key)
            out.append(v)
    return out


def build_explanation(plan: QueryPlan | None, collected: dict) -> dict | None:
    """The structured explanation of one turn, or None when there is nothing
    to explain (clarification, refusal, no tool data)."""
    if plan is None or plan.clarification_needed or not collected:
        return None
    parts = [_explain_tool(key, result, plan) for key, result in collected.items() if "#" not in key]
    claims = [c for part in parts for c in part["claims"]]
    mode = plan.answer_mode or LOOKUP
    style = plan.style or {}
    if mode == LOOKUP:
        # A lookup is answered by the number itself; conclusions drawn for
        # analysis questions would only pad it.
        claims = [c for c in claims if c["kind"] != INFERENCE]
    claims = sorted(_unique(claims), key=lambda c: _KIND_ORDER[c["kind"]])
    if not claims:
        return None
    alternatives = _unique([a for part in parts for a in part["alternatives"]])
    if mode not in _ADVICE_MODES and not style.get("why_not"):
        alternatives = []
    if style.get("why_not") and not alternatives:
        claims.append(_claim(UNKNOWN, "Dữ liệu lượt này không có phương án thay thế để so sánh trực tiếp."))
    next_actions = _unique([a for part in parts for a in part["next_actions"]]) if mode in _ADVICE_MODES else []
    inferences = [c for c in claims if c["kind"] == INFERENCE]
    headline = next((part["headline"] for part in parts if part["headline"]), None) \
        or (inferences[0]["statement"] if inferences else claims[0]["statement"])
    certainty = min((c["certainty"] for c in inferences), key=lambda v: _RANK.get(v, 0)) if inferences else None
    counts = Counter(c["kind"] for c in claims)
    return {
        "mode": mode,
        "style": sorted(style),
        "headline": headline,
        "certainty": certainty,
        "claims": claims[:10],
        "alternatives": alternatives[:3],
        "limits": _unique([lim for part in parts for lim in part["limits"]])[:6],
        "next_actions": next_actions[:3],
        "counts": {k: counts.get(k, 0) for k in (FACT, INFERENCE, ASSUMPTION, UNKNOWN)},
        "flags": sorted(set().union(*(part["flags"] for part in parts))),
        # A plain lookup with nothing assumed or unknown needs no "why" panel.
        "display": mode != LOOKUP or bool(counts.get(ASSUMPTION) or counts.get(UNKNOWN)),
    }


# ── prompt brief ─────────────────────────────────────────────────────────────

_TAG = {FACT: "DỮ KIỆN", ASSUMPTION: "GIẢ ĐỊNH", UNKNOWN: "CHƯA BIẾT"}


def explanation_brief(expl: dict | None, card_titles: list[str] | None = None, limit: int = 3000) -> str:
    """The explanation as a reasoning frame for the prompt."""
    if not expl:
        return ""
    lines = ["## Bản giải thích có cấu trúc (hệ thống tính từ kết quả tool — khung lập luận cho câu trả lời)",
             f"- Kết luận chính gợi ý: {expl['headline']}"]
    for c in expl["claims"]:
        tag = f"SUY LUẬN, mức chắc chắn {c['certainty']}" if c["kind"] == INFERENCE else _TAG[c["kind"]]
        line = f"- [{tag}] {c['statement']}"
        if c.get("meaning"):
            line += f" Ý nghĩa: {c['meaning']}"
        if c["kind"] == INFERENCE and c.get("basis"):
            line += f" (Cơ sở: {c['basis']})"
        lines.append(line)
    for a in expl.get("alternatives") or []:
        lines.append(f"- [PHƯƠNG ÁN KHÁC] {a['option']}: {a['outcome']} {a['tradeoff']}")
    for step in expl.get("next_actions") or []:
        lines.append(f"- [BƯỚC TIẾP THEO] {step}")
    lines.append("- Cách dùng: dữ kiện nói thẳng; suy luận diễn đạt đúng mức chắc chắn (CAO: \"dữ liệu cho thấy\"; "
                 "TRUNG BÌNH: \"nhiều khả năng\"; THẤP: \"có thể\", \"chưa đủ để khẳng định\"); giả định phải nói là giả "
                 "định; điều chưa biết thì nói rõ là chưa có dữ liệu, không đoán thay. Viết lại bằng lời tự nhiên: không chép "
                 "nguyên văn các dòng trên, không dùng các nhãn [DỮ KIỆN], \"Ý nghĩa:\", \"Cơ sở:\", không nhắc \"tool\". "
                 "Không thêm lý do hay nhận định nào ngoài các dòng trên.")
    if card_titles:
        lines.append("- Giao diện đã hiển thị thẻ đề xuất kèm số liệu cho: " + "; ".join(card_titles)
                     + ". Không liệt kê lại số liệu của từng thẻ; chỉ dùng 1–2 số liệu quyết định để giải thích kết luận.")
    lines.append("- Giao diện hiển thị riêng danh sách giới hạn dữ liệu và bảng \"Vì sao\"; trong câu trả lời chỉ nêu tối "
                 "đa một giới hạn quan trọng nhất.")
    text = "\n".join(lines)
    if len(text) > limit:
        text = text[:text.rfind("\n", 0, limit)] + "\n- ... (đã rút gọn)"
    return text


def numbers_in(expl: dict | None) -> list:
    """Every value the explanation shows - grounded for the answer check."""
    if not expl:
        return []
    return [e.get("value") for c in expl["claims"] for e in c.get("evidence") or []]


# ── post-generation wording check ────────────────────────────────────────────

# A negation earlier in the same clause ("không phải phương án tối ưu", "chưa
# thể khẳng định ... là do") turns the phrase into the hedge we want.
_NEGATED = re.compile(r"\b(không|chưa|chẳng|khó)\b")
_CLAUSE_END = re.compile(r"[.;:!?\n,]")
# "mức (độ) chắc chắn: trung bình" names the certainty level - not a claim.
_CERTAIN = re.compile(r"\b(?<!mức )(?<!độ )(chắc chắn|rõ ràng là|hiển nhiên|không còn nghi ngờ)\b")
_CAUSAL_WORDS = re.compile(r"(chủ yếu (là )?do|nguyên nhân (chính|chủ yếu)|chính là do|\blà do\b|bắt nguồn từ|\bgây ra\b)")
_OPTIMAL = re.compile(r"(tối ưu(?! hóa| hoá)|tốt nhất)")
# "100% nhu cầu (68.375.250 ₫)", 'từ "100% nhu cầu" xuống "75%"' name a budget
# scenario - not a coverage claim.
_FULL = re.compile(r"(đáp ứng (toàn bộ|đầy đủ|đủ|hết|100%)|toàn bộ nhu cầu|(?<![\"“])100% nhu cầu(?!\s*\()|"
                   r"giải quyết (hoàn toàn|triệt để))")
_QUALIFIED = re.compile(r"(được liệt kê|trong danh sách|được tính|dòng đầu|dòng được chọn|dòng được duyệt)")


def _hits(pattern: re.Pattern, text: str, qualified: re.Pattern | None = None) -> list[str]:
    out = []
    for m in pattern.finditer(text):
        before = text[max(0, m.start() - 45):m.start()]
        clause = _CLAUSE_END.split(before)[-1]
        if _NEGATED.search(clause):
            continue
        if qualified and qualified.search(text[m.end():m.end() + 70]):
            continue
        out.append(m.group(0))
    return out


def overclaims(answer: str, expl: dict | None) -> list[dict]:
    """Wording in `answer` stronger than the explanation supports:
    [{"phrase", "reason"}]. Empty when there is no explanation to check against."""
    if not expl or not answer:
        return []
    text = re.sub(r"[*_`]+", "", answer.lower())  # "đáp ứng **100%**" is still "đáp ứng 100%"
    mode = expl.get("mode")
    flags = set(expl.get("flags") or [])
    found: list[dict] = []
    if expl.get("certainty") in (MEDIUM, LOW):
        found += [{"phrase": h, "reason": f"dữ liệu chỉ hỗ trợ mức chắc chắn {expl['certainty']}"}
                  for h in _hits(_CERTAIN, text)]
    elif mode in (CAUSAL, WHAT_IF):
        found += [{"phrase": h, "reason": "đây là suy luận/mô phỏng phụ thuộc giả định, không phải điều chắc chắn"}
                  for h in _hits(_CERTAIN, text)]
    if mode == CAUSAL or "causal" in flags:
        found += [{"phrase": h, "reason": "dữ liệu chỉ cho thấy tương quan, không chứng minh nguyên nhân"}
                  for h in _hits(_CAUSAL_WORDS, text)]
    if mode in _ADVICE_MODES:
        found += [{"phrase": h, "reason": "hệ thống không tối ưu hóa, chỉ áp dụng quy tắc xếp hạng/phân bổ"}
                  for h in _hits(_OPTIMAL, text)]
    if "coverage_incomplete" in flags:
        found += [{"phrase": h, "reason": "dữ liệu cho thấy vẫn còn nhu cầu chưa được đáp ứng hoặc chưa được tính"}
                  for h in _hits(_FULL, text, _QUALIFIED)]
    seen, unique = set(), []
    for f in found:
        if f["phrase"] not in seen:
            seen.add(f["phrase"])
            unique.append(f)
    return unique


def overclaim_warning(flags: list[dict]) -> str | None:
    if not flags:
        return None
    return ("Cách diễn đạt vượt quá mức dữ liệu cho phép: "
            + "; ".join(f"\"{f['phrase']}\" ({f['reason']})" for f in flags)
            + ". Hãy diễn đạt lại đúng mức chắc chắn trong bản giải thích có cấu trúc, giữ nguyên số liệu.")
