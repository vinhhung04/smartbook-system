"""Builds visualization_dataset.json - the AI Copilot 3.0 visualization eval set.

    python services/ai-service/eval/build_visualization_dataset.py

Each case is one conversation (1-3 turns) in one of ten categories: trend,
comparison, ranking, kpi, budget, followup, missing, permission, ambiguous,
invalid. Every turn carries the gold expectation (planned tools, primary
visualization type or none, clarification, follow-up mode, partial flag, null
cells, a note or limitation that must be shown...). `fixtures` are the tool
results the OFFLINE run feeds the planner-chosen tools (deterministic, no
network); the LIVE run asks the same questions against the running stack and
ignores them (cases with live=false only make sense with their fixture: NaN
values, timeouts, truncated lists).
"""
from __future__ import annotations

import json
import os

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "visualization_dataset.json")


def monthly(vals, start=4):
    return [{"date": f"2026-{m:02d}", "loans": v, "returns": (v - 5 if isinstance(v, int) else 50), "reservations": 3}
            for m, v in zip(range(start, start + len(vals)), vals)]


def daily(vals):
    return [{"date": f"2026-10-{d:02d}", "loans": v, "returns": max(v - 2, 0), "reservations": 1}
            for d, v in zip(range(1, len(vals) + 1), vals)]


def top(n):
    return [{"variant_id": f"v{i}", "title": f"Sách thử nghiệm số {i} với tên khá dài", "borrow_count": 60 - 3 * i}
            for i in range(n)]


def wh(name, out, low, available, reserved=2, borrowed=10):
    return {"warehouse_name": name, "out_of_stock_variants": out, "low_stock_variants": low,
            "total_available_qty": available, "total_reserved_qty": reserved, "total_borrowed_qty": borrowed}


def scen(label, budget, cost, lines, qty, funded_high, unfunded_high, pct):
    return {"label": label, "budget_vnd": budget, "funded_cost": cost, "remaining_vnd": budget - cost, "funded_lines": lines,
            "funded_qty": qty, "funded_high_priority": funded_high, "unfunded_high_priority": unfunded_high,
            "shortfall_covered_pct": pct}


NEED = {"total_candidates": 116, "high_priority": 95, "estimated_total_cost": 68375250, "estimated_total_reorder_qty": 563}
NAN, INF = float("nan"), float("inf")


def _periods():
    metrics = {}
    for key, cur, prev in (("loans", 433, 914), ("returns", 410, 998), ("reservations", 120, 333)):
        metrics[key] = {"current": cur, "previous": prev, "change": cur - prev, "change_pct": round((cur - prev) / prev * 100, 1),
                        "current_per_day": round(cur / 15, 2), "previous_per_day": round(prev / 30, 2),
                        "per_day_change_pct": round((cur / 15 - prev / 30) / (prev / 30) * 100, 1)}
    return {"current_period": {"from": "2026-10-01", "to": "2026-10-15", "days": 15, "peak_day": "2026-10-02", "peak_loans": 41},
            "previous_period": {"from": "2026-09-01", "to": "2026-09-30", "days": 30, "peak_day": "2026-09-12", "peak_loans": 50},
            "metrics": metrics, "unequal_length": True, "note": "Hai kỳ dài khác nhau; nên so sánh theo trung bình mỗi ngày."}


FIXTURES = {
    "MONTHLY_DOWN": monthly([457, 1095, 902, 908, 1097, 914, 72]),
    "MONTHLY_UP": monthly([30, 80, 95, 110, 130, 150, 20]),
    "MONTHLY_FLAT": monthly([50, 100, 101, 99, 100, 102, 30]),
    "MONTHLY_YEAR": monthly([300, 310, 290, 320, 330, 340, 350, 360, 370, 120], 1),
    "MONTHLY_NAN": [{"date": "2026-04", "loans": 40, "returns": 30, "reservations": 1},
                    {"date": "2026-05", "loans": NAN, "returns": 30, "reservations": 1},
                    {"date": "2026-06", "loans": 130, "returns": 30, "reservations": 1},
                    {"date": "2026-07", "loans": INF, "returns": 30, "reservations": 1},
                    {"date": "2026-08", "loans": 100, "returns": "abc", "reservations": 1},
                    {"date": "2026-09", "loans": 90, "returns": 30, "reservations": 1},
                    {"date": "2026-10", "loans": 20, "returns": 30, "reservations": 1}],
    "MONTHLY_MOSTLY_NAN": [{"date": f"2026-{m:02d}", "loans": NAN, "returns": NAN, "reservations": NAN} for m in range(4, 10)]
    + [{"date": "2026-10", "loans": 5, "returns": 4, "reservations": 1}],
    "DAILY_15": daily([30, 41, 25, 0, 18, 33, 29, 40, 22, 31, 35, 27, 24, 38, 12]),
    "DAILY_1": daily([17]),
    "TOP10": top(10), "TOP5": top(5), "TOP_EMPTY": [],
    "TOP_TRUNC": top(12) + [{"_truncated": "... va 8 dong khac, hay thu hep dieu kien de xem day du"}],
    "CMP_TOP": {
        "current_period": {"from": "2026-10-01", "to": "2026-10-15"}, "previous_period": {"from": "2026-09-01", "to": "2026-09-30"},
        "current": [
            {"rank": 1, "title": "Rừng Na Uy", "variant_id": "a", "borrow_count": 30, "previous_rank": 2, "previous_borrow_count": 41, "status": "TĂNG HẠNG"},
            {"rank": 2, "title": "Nhà Giả Kim", "variant_id": "b", "borrow_count": 25, "previous_rank": None, "previous_borrow_count": None, "status": "MỚI VÀO TOP"},
            {"rank": 3, "title": "Đắc Nhân Tâm", "variant_id": "c", "borrow_count": 21, "previous_rank": 1, "previous_borrow_count": 50, "status": "GIẢM HẠNG"}],
        "dropped_out": [{"title": "X", "variant_id": "x", "previous_rank": 3}], "join_key": "variant_id"},
    "CMP_PERIODS_UNEQUAL": _periods(),
    "STOCK_RISK_3": [wh("Kho Ha Noi", 0, 2, 40), wh("Kho HCM Chinh", 3, 7, 120), wh("Kho Da Nang", 1, 4, 60)],
    "STOCK_RISK_TIE": [wh("Kho Ha Noi", 1, 2, 40), wh("Kho HCM Chinh", 1, 2, 40)],
    "CMP_WH": {"ranking": [{"rank": 1, **wh("Kho HCM Chinh", 3, 7, 120)}, {"rank": 2, **wh("Kho Ha Noi", 0, 1, 8)}],
               "comparison": {"riskier": "Kho HCM Chinh", "less_risky": "Kho Ha Noi", "tie": False}, "unresolved": [], "criteria": "x"},
    "CMP_WH_DN": {"ranking": [{"rank": 1, **wh("Kho Da Nang", 1, 4, 60)}, {"rank": 2, **wh("Kho Ha Noi", 0, 1, 8)}],
                  "comparison": {"riskier": "Kho Da Nang", "less_risky": "Kho Ha Noi", "tie": False}, "unresolved": [], "criteria": "x"},
    "LOW_HCM": {"warehouse_id": "w-hcm", "warehouse_name": "Kho HCM Chinh", "warehouse_code": "WH-HCM-01", "total_items": 40,
                "out_of_stock_count": 3, "truncated": True,
                "items": [{"variant_id": f"v{i}", "title": f"Đầu sách {i}", "status": "HẾT HÀNG" if i < 3 else "DƯỚI NGƯỠNG",
                           "available_qty": 0 if i < 3 else i, "reorder_point": 10, "reserved_qty": 1, "borrowed_qty": 4}
                          for i in range(30)]},
    "SHORT_HCM": {"warehouse_name": "Kho HCM Chinh",
                  "summary": {"low_stock_items": 7, "out_of_stock_items": 3, "items_with_recent_demand": 5, "items_with_rising_demand": 1},
                  "items": [{"variant_id": "a", "title": "Rừng Na Uy", "status": "HẾT HÀNG", "available_qty": 0, "borrow_count": 61,
                             "demand_trend_pct": 12.0, "lead_time_days": 21}],
                  "factors": [], "limitations": ["Nhu cầu toàn hệ thống."]},
    "SHORT_HN": {"warehouse_name": "Kho Ha Noi",
                 "summary": {"low_stock_items": 1, "out_of_stock_items": 0, "items_with_recent_demand": 1, "items_with_rising_demand": 0},
                 "items": [], "factors": [], "limitations": []},
    "SIM_3": {"full_need": NEED, "funding_rule": "rule", "scenarios_are_assumed": False, "items_not_listed": 16,
              "limitations": ["Không tối ưu theo ràng buộc nhà cung cấp."],
              "scenarios": [scen("Ngân sách 5.000.000 ₫", 5e6, 4947000, 8, 64, 4, 91, 100.0),
                            scen("Ngân sách 10.000.000 ₫", 1e7, 9987000, 9, 92, 5, 90, 100.0),
                            scen("Ngân sách 20.000.000 ₫", 2e7, 19944000, 19, 155, 15, 80, 100.0)]},
    "SIM_FAIL": {"full_need": NEED, "funding_rule": "rule", "scenarios_are_assumed": False, "items_not_listed": 0, "limitations": [],
                 "scenarios": [scen("Ngân sách 5.000.000 ₫", 5e6, 4947000, 8, 64, 4, 91, 20.0),
                               {"label": "Ngân sách 10.000.000 ₫", "budget_vnd": 1e7, "error": "timeout"},
                               scen("Ngân sách 20.000.000 ₫", 2e7, 19944000, 19, 155, 15, 80, 70.0)]},
    "SIM_ASSUMED": {"full_need": NEED, "funding_rule": "rule", "scenarios_are_assumed": True, "items_not_listed": 16, "limitations": [],
                    "scenarios": [scen(f"{p}% nhu cầu", 68375250 * p / 100, 68375250 * p / 100 - 1000, 10 + p, p * 5, p // 2,
                                       95 - p // 2, float(p)) for p in (100, 75, 50, 25)]},
    "SIM_1": {"full_need": NEED, "funding_rule": "rule", "scenarios_are_assumed": False, "items_not_listed": 16, "limitations": [],
              "scenarios": [scen("Ngân sách 12.000.000 ₫", 1.2e7, 11950000, 11, 100, 7, 88, 100.0)]},
    "REORDER": {"summary": {"total_candidates": 116, "high_priority": 95, "medium_priority": 15, "low_priority": 6,
                            "estimated_total_reorder_qty": 563, "estimated_total_cost": 68375250},
                "items": [{"variant_id": f"r{i}", "title": f"Sách cần nhập {i}", "priority": "HIGH", "available_qty": i, "reorder_point": 10,
                           "suggested_reorder_qty": 5 + i, "estimated_cost": 500000 + i * 1000, "lead_time_source": "DEFAULT",
                           "borrow_count": 10} for i in range(8)],
                "range": {"from": "2026-09-15", "to": "2026-10-15"}},
    "OVERDUE_FULL": {"total_overdue_loans": 5, "total_overdue_items": 6, "average_overdue_days": 20.4, "oldest_overdue_days": 95,
                     "items": [{"overdue_days": d} for d in (3, 10, 15, 40, 95)]},
    "OVERDUE_TRUNC": {"total_overdue_loans": 40, "total_overdue_items": 52, "average_overdue_days": 12.0, "oldest_overdue_days": 95,
                      "items": [{"overdue_days": d} for d in range(1, 13)]},
    "FINES": {"total_unpaid": 3150000, "total_paid": 900000, "total_waived": 50000, "unpaid_count": 27, "paid_count": 9,
              "by_type": [{"fine_type": "OVERDUE", "amount": 2800000, "count": 30}, {"fine_type": "LOST", "amount": 1100000, "count": 4},
                          {"fine_type": "DAMAGE", "amount": 200000, "count": 2}]},
    "FUNNEL": {"total": 100, "pending": 5, "confirmed": 10, "ready_for_pickup": 5, "converted_to_loan": 60, "cancelled": 12,
               "expired": 8, "conversion_rate": 60.0},
    "KPIS": {"total_titles": 300, "total_copies": 4000, "low_stock_variants": 20, "active_loans": 210, "overdue_loans": 40,
             "pending_reservations": 5, "confirmed_reservations": 10, "ready_for_pickup_reservations": 5,
             "pickup_codes_expiring_soon": 2, "unpaid_fine_amount": 3150000, "reservation_conversion_rate": 60.0},
    "AGING": {"threshold_days": 90, "items": [
        {"variant_id": "a", "title": "Sách cũ A", "warehouse_name": "Kho Ha Noi", "on_hand_qty": 5, "days_since_last_activity": 200},
        {"variant_id": "b", "title": "Sách cũ B", "warehouse_name": "Kho Da Nang", "on_hand_qty": 2, "days_since_last_activity": None}]},
    "PRIORITIES": {"ranking_rule": "x", "unavailable": [], "tasks": [
        {"rank": 1, "tier": 1, "task": "Bổ sung sách hết hàng", "value": 12, "unit": "đầu sách", "why": "x", "next_step": "Lập phiếu", "source": "x"}]},
    "ERR403": {"error": "/analytics/borrow-trends tra ve HTTP 403"},
    "ERR_TIMEOUT": {"error": "/analytics/warehouse-stock-risk het thoi gian cho phan hoi"},
}

DEFAULTS = {
    "get_borrow_trends": "MONTHLY_DOWN", "get_top_books": "TOP10", "compare_top_books": "CMP_TOP",
    "compare_borrow_periods": "CMP_PERIODS_UNEQUAL", "get_warehouse_stock_risk": "STOCK_RISK_3", "compare_warehouses": "CMP_WH",
    "get_warehouse_low_stock_items": "LOW_HCM", "explain_warehouse_shortage": "SHORT_HCM", "simulate_reorder_budget": "SIM_3",
    "get_reorder_suggestions": "REORDER", "get_overdue_summary": "OVERDUE_FULL", "get_fine_summary": "FINES",
    "get_reservation_funnel": "FUNNEL", "get_dashboard_kpis": "KPIS", "get_aging_inventory": "AGING",
    "rank_priority_tasks": "PRIORITIES",
}


def t(q, **expect):
    return {"q": q, "expect": expect}


def case(cid, category, turns, fixtures=None, user="hung", live=True):
    return {"id": cid, "category": category, "user": user, "fixtures": fixtures or {}, "turns": turns, "live": live}


SIX_MONTHS = "Vẽ biểu đồ lượt mượn 6 tháng gần đây."
CASES = [
    # trend: time series -> line (or the requested form), partial months flagged
    case("tr-01", "trend", [t("Vẽ biểu đồ lượt mượn sách trong 6 tháng gần đây và phân tích xu hướng.", tools=["get_borrow_trends"],
                              primary="line", kpi=True, direction="giảm", partial=True)]),
    case("tr-02", "trend", [t("Thống kê lượt mượn 6 tháng gần đây.", tools=["get_borrow_trends"], primary="line")]),
    case("tr-03", "trend", [t("ve bieu do luot muon 6 thang gan day", tools=["get_borrow_trends"], primary="line")]),
    case("tr-04", "trend", [t("Xu hướng mượn sách năm nay thế nào?", tools=["get_borrow_trends"], primary="line", granularity="month")],
         {"get_borrow_trends": "MONTHLY_YEAR"}),
    case("tr-05", "trend", [t("Biểu đồ lượt mượn từng ngày trong tháng này", tools=["get_borrow_trends"], primary="line")],
         {"get_borrow_trends": "DAILY_15"}),
    case("tr-06", "trend", [t("Vẽ biểu đồ miền lượt mượn 6 tháng qua", tools=["get_borrow_trends"], primary="area")]),
    case("tr-07", "trend", [t("Trực quan hóa tình hình mượn sách 6 tháng gần đây", tools=["get_borrow_trends"], primary="line",
                              direction="tăng")], {"get_borrow_trends": "MONTHLY_UP"}, live=False),
    case("tr-08", "trend", [t("Xu hướng mượn 6 tháng gần đây có ổn định không? Vẽ biểu đồ", tools=["get_borrow_trends"],
                              primary="line", direction="đi ngang")], {"get_borrow_trends": "MONTHLY_FLAT"}, live=False),
    # comparison: categories -> bar with one unit, same risk rule as the explanation
    case("cp-01", "comparison", [t("So sánh tình hình tồn kho Hà Nội và HCM bằng biểu đồ.", tools=["compare_warehouses"], primary="bar",
                                   riskiest="Kho HCM Chinh", unit="đầu sách")]),
    case("cp-02", "comparison", [t("So sánh hai kho Hà Nội và Đà Nẵng bằng biểu đồ cột", tools=["compare_warehouses"], primary="bar")],
         {"compare_warehouses": "CMP_WH_DN"}),
    case("cp-03", "comparison", [t("Vì sao kho HCM rủi ro thiếu hàng hơn kho Hà Nội?",
                                   tools=["compare_warehouses", "explain_warehouse_shortage", "explain_warehouse_shortage"],
                                   primary="bar", riskiest="Kho HCM Chinh")], {"explain_warehouse_shortage#2": "SHORT_HN"}),
    case("cp-04", "comparison", [t("Lượt mượn tháng này so với tháng trước thế nào? Vẽ biểu đồ", tools=["compare_borrow_periods"],
                                   primary="bar", kpi=True, unit="lượt/ngày")]),
    case("cp-05", "comparison", [t("Top sách tháng này khác gì tháng trước? Hiển thị biểu đồ", tools=["compare_top_books"],
                                   primary="bar", null_cells=1)]),
    case("cp-06", "comparison", [t("Cho tôi xem biểu đồ tồn kho.", tools=["get_warehouse_stock_risk"], primary="bar",
                                   riskiest="Kho HCM Chinh")]),
    case("cp-07", "comparison", [t("Kho nào đang rủi ro thiếu sách nhất? Vẽ biểu đồ", tools=["get_warehouse_stock_risk"], primary="bar",
                                   riskiest="Kho HCM Chinh")]),
    case("cp-08", "comparison", [t("So sánh tồn kho các kho bằng biểu đồ", tools=["get_warehouse_stock_risk"], primary="bar", tie=True)],
         {"get_warehouse_stock_risk": "STOCK_RISK_TIE"}, live=False),
    # ranking
    case("rk-01", "ranking", [t("Thống kê top 10 sách bằng biểu đồ.", tools=["get_top_books"], primary="bar", rows=10)]),
    case("rk-02", "ranking", [t("Top 5 sách được mượn nhiều nhất tháng này", tools=["get_top_books"], primary="bar", rows=5)],
         {"get_top_books": "TOP5"}),
    case("rk-03", "ranking", [t("Top 10 sách mượn nhiều hiển thị dưới dạng bảng", tools=["get_top_books"], types_include=["table"])]),
    case("rk-04", "ranking", [t("Sách nào được mượn nhiều nhất 30 ngày qua? Vẽ biểu đồ", tools=["get_top_books"], primary="bar",
                                partial=True)], {"get_top_books": "TOP_TRUNC"}, live=False),
    case("rk-05", "ranking", [t("Nên ưu tiên xử lý việc gì hôm nay? Hiển thị dạng bảng", tools=["rank_priority_tasks"],
                                types_include=["table"])]),
    case("rk-06", "ranking", [t("Sách nào tồn kho lâu không ai mượn? Lập bảng số liệu", tools=["get_aging_inventory"],
                                types_include=["table"], null_cells=1)], live=False),
    # kpi: a single number gets no chart; an overview gets KPI cards
    case("kp-01", "kpi", [t("Có bao nhiêu phiếu quá hạn?", tools=["get_overdue_summary"], no_viz=True)]),
    case("kp-02", "kpi", [t("Tình hình quá hạn thế nào?", tools=["get_overdue_summary"], kpi=True, primary=None)]),
    case("kp-03", "kpi", [t("Tổng quan thư viện hiện nay ra sao?", tools=["get_dashboard_kpis"], kpi=True, primary=None)]),
    case("kp-04", "kpi", [t("Tổng tiền phạt chưa thu là bao nhiêu?", tools=["get_fine_summary"], no_viz=True)]),
    case("kp-05", "kpi", [t("Tỷ trọng tiền phạt theo loại bằng biểu đồ tròn", tools=["get_fine_summary"], primary="pie", kpi=True)]),
    case("kp-06", "kpi", [t("Phễu đặt chỗ đang thế nào? Vẽ biểu đồ", tools=["get_reservation_funnel"], primary="bar", kpi=True)]),
    # budget simulation (scenario C) - real simulation, no optimum claimed
    case("bd-01", "budget", [t("So sánh các phương án nhập sách 5 triệu, 10 triệu và 20 triệu bằng biểu đồ.",
                               tools=["simulate_reorder_budget"], primary="bar", types_include=["table", "kpi"], analysis="what_if",
                               partial=True, budget_slider=True)]),
    case("bd-02", "budget", [t("Nếu ngân sách nhập sách là 5 triệu, 10 triệu và 20 triệu thì phương án nào tốt hơn? Hiển thị biểu đồ.",
                               tools=["simulate_reorder_budget"], primary="bar", analysis="what_if")]),
    case("bd-03", "budget", [t("Nếu ngân sách nhập sách là 12 triệu thì sao? Hiển thị biểu đồ.", tools=["simulate_reorder_budget"],
                               primary="bar")], {"simulate_reorder_budget": "SIM_1"}),
    case("bd-04", "budget", [t("Mô phỏng ngân sách 5 triệu, 10 triệu, 20 triệu bằng bảng số liệu", tools=["simulate_reorder_budget"],
                               types_include=["table"], null_cells=7, partial=True)], {"simulate_reorder_budget": "SIM_FAIL"}, live=False),
    case("bd-05", "budget", [t("Nếu cắt ngân sách nhập 20% thì sao? Vẽ biểu đồ", tools=["simulate_reorder_budget"], primary="bar")],
         {"simulate_reorder_budget": "SIM_ASSUMED"}),
    case("bd-06", "budget", [t("Tôi nên nhập sách nào trước? Hiển thị bảng số liệu", tools=["get_reorder_suggestions"],
                               types_include=["table"])]),
    # follow-ups (scenario D): same data, new form; explain the chart shown
    case("fu-01", "followup", [t("Thống kê lượt mượn 6 tháng gần đây.", primary="line"),
                               t("Vẽ lại bằng biểu đồ cột.", mode="retype", primary="bar", same_rows=True, no_llm=True),
                               t("Hiển thị số liệu dưới dạng bảng.", mode="retype", primary="table", same_rows=True, no_llm=True)]),
    case("fu-02", "followup", [t("Thống kê top 10 sách bằng biểu đồ.", primary="bar"),
                               t("Đổi sang biểu đồ tròn.", mode="retype", primary="bar", note_contains="biểu đồ tròn", same_rows=True)]),
    case("fu-03", "followup", [t(SIX_MONTHS, primary="line"),
                               t("Chỉ lấy dữ liệu tháng này.", tools=["get_borrow_trends"], primary="line", period="this_month")],
         {"turn2:get_borrow_trends": "DAILY_15"}),
    case("fu-04", "followup", [t("So sánh tình hình tồn kho Hà Nội và HCM bằng biểu đồ.", primary="bar"),
                               t("Biểu đồ này cho thấy điều gì?", mode="explain", primary="bar", same_rows=True)]),
    case("fu-05", "followup", [t("Lượt mượn tháng này bao nhiêu?", no_viz=True), t("Vẽ biểu đồ", mode="render", primary="line")],
         {"get_borrow_trends": "DAILY_15"}),
    case("fu-06", "followup", [t("So sánh các phương án nhập sách 5 triệu, 10 triệu và 20 triệu bằng biểu đồ.", primary="bar"),
                               t("Đổi sang dạng bảng", mode="retype", primary="table", same_rows=True)]),
    case("fu-07", "followup", [t("Phễu đặt chỗ đang thế nào? Vẽ biểu đồ", primary="bar"),
                               t("chuyen sang bieu do tron", mode="retype", primary="pie", same_rows=True)]),
    case("fu-08", "followup", [t(SIX_MONTHS, primary="line"),
                               t("Giải thích biểu đồ vừa rồi.", mode="explain", primary="line", same_rows=True)]),
    case("fu-09", "followup", [t(SIX_MONTHS, primary="line"),
                               t("Đổi biểu đồ vừa rồi sang biểu đồ cột.", mode="retype", primary="bar", same_rows=True)]),
    case("fu-10", "followup", [t("Thống kê top 10 sách bằng biểu đồ.", primary="bar"),
                               t("Hiển thị số liệu dưới dạng bảng", mode="retype", primary="table", same_rows=True)]),
    # missing data (scenario E): no fake chart, a clear message
    case("md-01", "missing", [t("Vẽ biểu đồ doanh thu bán sách online theo quý.", clarification=True, no_viz=True)]),
    case("md-02", "missing", [t("Vẽ biểu đồ lượt truy cập website tháng này", clarification=True, no_viz=True)]),
    case("md-03", "missing", [t("Top sách được mượn hôm nay bằng biểu đồ", tools=["get_top_books"], no_viz=True,
                                note_contains="Không có lượt mượn")], {"get_top_books": "TOP_EMPTY"}, live=False),
    case("md-04", "missing", [t("Vẽ biểu đồ lượt mượn hôm nay", tools=["get_borrow_trends"], no_chart=True)],
         {"get_borrow_trends": "DAILY_1"}, live=False),
    case("md-05", "missing", [t("Vẽ biểu đồ tồn kho các kho", tools=["get_warehouse_stock_risk"], no_viz=True,
                                note_contains="chưa lấy được")], {"get_warehouse_stock_risk": "ERR_TIMEOUT"}, live=False),
    # permissions: a role without analytics.borrow.read gets no borrow chart
    case("pm-01", "permission", [t(SIX_MONTHS, tools=["get_borrow_trends"], no_viz=True, note_contains="không có quyền")],
         {"get_borrow_trends": "ERR403"}, user="manager01"),
    case("pm-02", "permission", [t("Tình hình quá hạn thế nào? Vẽ biểu đồ", tools=["get_overdue_summary"], no_viz=True,
                                   note_contains="không có quyền")], {"get_overdue_summary": "ERR403"}, user="manager01"),
    case("pm-03", "permission", [t("Cho tôi xem biểu đồ tồn kho.", tools=["get_warehouse_stock_risk"], primary="bar")], user="manager01"),
    case("pm-04", "permission", [t("Phễu đặt chỗ đang thế nào? Vẽ biểu đồ", tools=["get_reservation_funnel"], no_viz=True,
                                   note_contains="không có quyền")], {"get_reservation_funnel": "ERR403"}, user="manager01"),
    # ambiguous: ask back, never guess
    case("am-01", "ambiguous", [t("Vẽ biểu đồ", clarification=True, no_viz=True)]),
    case("am-02", "ambiguous", [t("So sánh hai kho bằng biểu đồ cột", clarification=True, no_viz=True, options_suffix="bằng biểu đồ cột")]),
    case("am-03", "ambiguous", [t("Đổi sang biểu đồ cột.", clarification=True, no_viz=True)]),
    case("am-04", "ambiguous", [t("Giải thích biểu đồ vừa rồi.", clarification=True, no_viz=True)]),
    case("am-05", "ambiguous", [t("Hiển thị số liệu dưới dạng bảng.", clarification=True, no_viz=True)]),
    # invalid / partial data
    case("iv-01", "invalid", [t(SIX_MONTHS, tools=["get_borrow_trends"], primary="line", partial=True, null_cells=2,
                                limit_contains="không phải số hợp lệ")], {"get_borrow_trends": "MONTHLY_NAN"}, live=False),
    case("iv-02", "invalid", [t(SIX_MONTHS, tools=["get_borrow_trends"], no_chart=True)], {"get_borrow_trends": "MONTHLY_MOSTLY_NAN"},
         live=False),
    case("iv-03", "invalid", [t("Vẽ biểu đồ phiếu quá hạn theo số ngày trễ", tools=["get_overdue_summary"], no_chart=True,
                                note_contains="12/40")], {"get_overdue_summary": "OVERDUE_TRUNC"}, live=False),
    case("iv-04", "invalid", [t("Vẽ biểu đồ phiếu quá hạn theo số ngày trễ", tools=["get_overdue_summary"], primary="bar")],
         {"get_overdue_summary": "OVERDUE_FULL"}, live=False),
    case("iv-05", "invalid", [t("Kho HCM có những sách nào sắp hết? Vẽ biểu đồ", tools=["get_warehouse_low_stock_items", "get_warehouse_stock_risk"],
                                primary="bar", partial=True)], {"get_warehouse_low_stock_items": "LOW_HCM"}, live=False),
    case("iv-06", "invalid", [t("Vẽ biểu đồ tròn lượt mượn 6 tháng gần đây", tools=["get_borrow_trends"], primary="line",
                                note_contains="biểu đồ tròn")]),
]


def main() -> None:
    turns = sum(len(c["turns"]) for c in CASES)
    data = {
        "version": 1,
        "description": (f"AI Copilot 3.0 visualization eval: {len(CASES)} cases / {turns} turns in 10 categories. Offline = "
                        "planner + builders on these fixtures (deterministic); live = the same questions against the running "
                        "stack (fixtures ignored; live=false cases are fixture-only)."),
        "now": "2026-10-15T10:00:00+07:00",
        "warehouses": [{"id": "w-hn", "code": "WH-HN-01", "name": "Kho Ha Noi"},
                       {"id": "w-hcm", "code": "WH-HCM-01", "name": "Kho HCM Chinh"},
                       {"id": "w-dn", "code": "WH-DN-01", "name": "Kho Da Nang"}],
        "default_fixtures": DEFAULTS, "fixtures": FIXTURES, "cases": CASES,
    }
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False, indent=1)  # NaN/Infinity kept on purpose (allow_nan)
    print(f"{OUT}: {len(CASES)} cases, {turns} turns")


if __name__ == "__main__":
    main()
