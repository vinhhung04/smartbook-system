"""AI Copilot 3.0 - Generative UI: visualization schema, chart selection,
data fidelity, Vietnamese chart requests and chart follow-ups, and the
/assistant + /assistant/stream integration (snapshot reuse, persistence)."""
from __future__ import annotations

import json
import math
import unittest
from datetime import datetime, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from pydantic import ValidationError

import copilot_visualization as cv
import main
from copilot_explain import build_explanation
from copilot_plan import VN_TZ, build_plan, detect_visualization, next_state, normalize_query
from main import AssistantRequest
from routes_conversations import _message_summary
from test_copilot_endpoints import ADMIN, FakeProvider, FakeStore, _request

NOW = datetime(2026, 10, 15, 10, 0, tzinfo=VN_TZ)
WAREHOUSES = [{"id": "w-hn", "code": "WH-HN-01", "name": "Kho Ha Noi"},
              {"id": "w-hcm", "code": "WH-HCM-01", "name": "Kho HCM Chinh"},
              {"id": "w-dn", "code": "WH-DN-01", "name": "Kho Da Nang"}]


class _FrozenDatetime(datetime):
    """datetime whose now() is NOW. MONTHLY's complete months (05-09/2026, -25%)
    only hold for "6 tháng gần đây" asked around mid-October 2026; with the real
    clock the window drifts and the endpoint tests read a different trend."""

    @classmethod
    def now(cls, tz=None):
        return NOW.astimezone(tz) if tz else NOW.replace(tzinfo=None)


def frozen_clock():
    """Patches pinning every module the /assistant pipeline reads the clock in to NOW."""
    return [patch(f"{module}.datetime", _FrozenDatetime)
            for module in ("main", "copilot_plan", "copilot_response", "copilot_semantic_planner", "copilot_tools",
                           "copilot_visualization")]

MONTHLY = [{"date": f"2026-{m:02d}", "loans": n, "returns": n - 5, "reservations": 3}
           for m, n in zip(range(4, 11), [40, 120, 130, 110, 100, 90, 45])]
STOCK_RISK = [
    {"warehouse_name": "Kho Ha Noi", "out_of_stock_variants": 0, "low_stock_variants": 2, "total_available_qty": 40,
     "total_reserved_qty": 3, "total_borrowed_qty": 10},
    {"warehouse_name": "Kho HCM Chinh", "out_of_stock_variants": 4, "low_stock_variants": 9, "total_available_qty": 150,
     "total_reserved_qty": 6, "total_borrowed_qty": 30},
]
COMPARE = {"ranking": [{"rank": 1, "warehouse_name": "Kho HCM Chinh", "out_of_stock_variants": 4, "low_stock_variants": 9,
                        "total_available_qty": 150, "total_reserved_qty": 6, "total_borrowed_qty": 30},
                       {"rank": 2, "warehouse_name": "Kho Ha Noi", "out_of_stock_variants": 0, "low_stock_variants": 2,
                        "total_available_qty": 40, "total_reserved_qty": 3, "total_borrowed_qty": 10}],
           "comparison": {"riskier": "Kho HCM Chinh", "less_risky": "Kho Ha Noi", "tie": False}, "unresolved": [],
           "criteria": "x", "retrieved_at": "2026-10-15T10:00:00+07:00"}
SIMULATION = {
    "full_need": {"total_candidates": 40, "high_priority": 12, "estimated_total_cost": 35_000_000,
                  "estimated_total_reorder_qty": 300},
    "scenarios": [
        {"label": "Ngân sách 5.000.000 ₫", "budget_vnd": 5e6, "funded_cost": 4.9e6, "remaining_vnd": 1e5, "funded_lines": 5,
         "funded_qty": 40, "funded_high_priority": 3, "unfunded_high_priority": 9, "shortfall_covered_pct": 20.5},
        {"label": "Ngân sách 10.000.000 ₫", "budget_vnd": 1e7, "funded_cost": 9.8e6, "remaining_vnd": 2e5, "funded_lines": 9,
         "funded_qty": 80, "funded_high_priority": 6, "unfunded_high_priority": 6, "shortfall_covered_pct": 41.0},
        {"label": "Ngân sách 20.000.000 ₫", "budget_vnd": 2e7, "funded_cost": 1.98e7, "remaining_vnd": 2e5,
         "funded_lines": 18, "funded_qty": 150, "funded_high_priority": 10, "unfunded_high_priority": 2,
         "shortfall_covered_pct": 77.5}],
    "scenarios_are_assumed": False, "items_not_listed": 0, "funding_rule": "rule",
    "limitations": ["Không tối ưu theo ràng buộc nhà cung cấp."], "retrieved_at": "2026-10-15T10:00:00+07:00"}


def plan(message, state=None):
    return build_plan(message, state, WAREHOUSES, NOW)


def viz(message, data, state=None):
    return cv.build_visualizations(plan(message, state), data, NOW)


def numbers(obj) -> set:
    out = set()
    if isinstance(obj, dict):
        for v in obj.values():
            out |= numbers(v)
    elif isinstance(obj, list):
        for v in obj:
            out |= numbers(v)
    elif isinstance(obj, (int, float)) and not isinstance(obj, bool):
        out.add(round(float(obj), 4))
    return out


def base_spec(**over):
    spec = dict(id="viz-0123456789ab", type="bar", title="t", x_key="x", x_kind="category",
                series=[{"key": "a", "label": "A", "unit": "lượt"}], data=[{"x": "k1", "a": 1}, {"x": "k2", "a": 2}],
                source={"tools": ["get_top_books"]}, scope={"level": "system", "label": "Toàn hệ thống"},
                data_as_of="2026-10-15T10:00:00+07:00", interactions={"allowed_types": ["bar", "table"]})
    spec.update(over)
    return spec


class SchemaTests(unittest.TestCase):
    def test_a_valid_spec_passes(self):
        self.assertEqual(cv.Visualization(**base_spec()).type, "bar")

    def test_unknown_types_are_rejected(self):
        with self.assertRaises(ValidationError):
            cv.Visualization(**base_spec(type="html", interactions={"allowed_types": ["html"]}))

    def test_nan_and_infinity_are_rejected(self):
        for bad in (math.nan, math.inf, -math.inf):
            with self.assertRaises(ValidationError):
                cv.Visualization(**base_spec(data=[{"x": "k1", "a": bad}, {"x": "k2", "a": 2}]))

    def test_series_with_different_units_cannot_share_a_chart(self):
        with self.assertRaises(ValidationError):
            cv.Visualization(**base_spec(series=[{"key": "a", "label": "A", "unit": "lượt"},
                                                 {"key": "b", "label": "B", "unit": "₫", "kind": "currency"}],
                                         data=[{"x": "k1", "a": 1, "b": 2}]))

    def test_series_with_different_scopes_cannot_share_a_chart(self):
        with self.assertRaises(ValidationError):
            cv.Visualization(**base_spec(series=[{"key": "a", "label": "A", "unit": "lượt"},
                                                 {"key": "b", "label": "B", "unit": "lượt", "scope_note": "Toàn hệ thống"}],
                                         data=[{"x": "k1", "a": 1, "b": 2}]))

    def test_a_mostly_missing_chart_is_not_drawn(self):
        with self.assertRaises(ValidationError):
            cv.Visualization(**base_spec(data=[{"x": "k1", "a": None}, {"x": "k2", "a": None}, {"x": "k3", "a": 1}]))

    def test_pie_needs_parts_of_one_whole(self):
        pie = dict(type="pie", interactions={"allowed_types": ["pie", "bar", "table"]})
        with self.assertRaises(ValidationError):
            cv.Visualization(**base_spec(**pie))  # no parts_of_whole
        with self.assertRaises(ValidationError):
            cv.Visualization(**base_spec(**pie, summary={"parts_of_whole": 1},
                                         data=[{"x": "k1", "a": None}, {"x": "k2", "a": 2}, {"x": "k3", "a": 2}]))
        self.assertEqual(cv.Visualization(**base_spec(**pie, summary={"parts_of_whole": 1})).type, "pie")

    def test_line_only_for_time_series(self):
        with self.assertRaises(ValidationError):
            cv.Visualization(**base_spec(interactions={"allowed_types": ["bar", "line"]}))

    def test_limits_on_rows_series_and_count(self):
        with self.assertRaises(ValidationError):
            cv.Visualization(**base_spec(data=[{"x": f"k{i}", "a": i} for i in range(cv.MAX_CHART_POINTS + 1)]))
        five = [{"key": f"s{i}", "label": f"S{i}", "unit": "lượt"} for i in range(cv.MAX_SERIES + 1)]
        with self.assertRaises(ValidationError):
            cv.Visualization(**base_spec(series=five, data=[{"x": "k", **{f"s{i}": 1 for i in range(5)}}]))
        table = dict(type="table", interactions={"allowed_types": ["table"]})
        with self.assertRaises(ValidationError):
            cv.Visualization(**base_spec(**table, data=[{"x": "k", "a": 1}] * (cv.MAX_TABLE_ROWS + 1)))

    def test_text_cannot_hide_in_a_numeric_series(self):
        with self.assertRaises(ValidationError):
            cv.Visualization(**base_spec(data=[{"x": "k1", "a": "<script>"}, {"x": "k2", "a": 2}]))


class BorrowTrendTests(unittest.TestCase):
    def setUp(self):
        self.specs, self.notes = viz("Vẽ biểu đồ lượt mượn 6 tháng gần đây và phân tích xu hướng",
                                     {"get_borrow_trends": MONTHLY})
        self.chart = next(v for v in self.specs if v["type"] == "line")
        self.kpi = next(v for v in self.specs if v["type"] == "kpi")

    def test_a_trend_question_gets_a_line_chart_with_month_labels(self):
        self.assertEqual(self.chart["x_key"], "period")
        self.assertEqual([r["period"] for r in self.chart["data"]][:2], ["04/2026", "05/2026"])
        self.assertEqual(self.chart["series"][0]["unit"], "lượt")
        self.assertEqual(self.chart["source"]["endpoints"], ["/analytics/borrow-trends"])
        self.assertIn("6 tháng", self.chart["time_range"]["label"])

    def test_chart_values_are_exactly_the_tool_values(self):
        self.assertEqual([r["loans"] for r in self.chart["data"]], [r["loans"] for r in MONTHLY])
        self.assertTrue(numbers(self.chart["data"]) <= numbers(MONTHLY))

    def test_partial_months_are_flagged_and_excluded_from_the_direction(self):
        self.assertTrue(self.chart["is_partial"])
        self.assertEqual({a["x"] for a in self.chart["annotations"]}, {"04/2026", "10/2026"})
        # 05/2026 (120) -> 09/2026 (90): the half months 04 and 10 are ignored.
        self.assertEqual(self.chart["summary"]["direction"], "giảm")
        self.assertEqual(self.chart["summary"]["change_pct"], -25.0)

    def test_kpis_are_sums_of_the_tool_rows(self):
        values = {k["key"]: k["value"] for k in self.kpi["kpis"]}
        self.assertEqual(values["total_loans"], sum(r["loans"] for r in MONTHLY))
        self.assertEqual(values["peak"], 130)
        self.assertEqual(values["average"], round(sum([120, 130, 110, 100, 90]) / 5, 1))

    def test_explanation_and_chart_tell_the_same_trend(self):
        expl = build_explanation(plan("Vẽ biểu đồ lượt mượn 6 tháng gần đây và phân tích xu hướng"),
                                 {"get_borrow_trends": MONTHLY})
        self.assertIn("giảm", expl["headline"])
        self.assertIn(-25.0, [e["value"] for c in expl["claims"] for e in c["evidence"]])
        self.assertEqual(cv.consistency_issues(self.specs, expl), [])

    def test_a_single_bucket_is_not_a_trend(self):
        specs, _ = viz("Vẽ biểu đồ lượt mượn hôm nay", {"get_borrow_trends": [MONTHLY[0]]})
        self.assertFalse([v for v in specs if v["type"] == "line"])

    def test_a_plain_count_question_gets_no_chart(self):
        specs, _ = viz("Hôm nay có bao nhiêu lượt mượn?", {"get_borrow_trends": MONTHLY[:2]})
        self.assertEqual(specs, [])


class SelectionTests(unittest.TestCase):
    def test_single_number_lookup_has_no_visualization(self):
        overdue = {"total_overdue_loans": 42, "total_overdue_items": 50, "average_overdue_days": 12, "oldest_overdue_days": 95,
                   "items": []}
        self.assertEqual(viz("Có bao nhiêu phiếu quá hạn?", {"get_overdue_summary": overdue})[0], [])

    def test_explicit_request_on_kpi_only_data_explains_why_no_chart(self):
        overdue = {"total_overdue_loans": 42, "total_overdue_items": 50, "average_overdue_days": 12, "oldest_overdue_days": 95,
                   "items": [{"overdue_days": 3}]}
        specs, notes = viz("Vẽ biểu đồ phiếu quá hạn", {"get_overdue_summary": overdue})
        self.assertEqual([v["type"] for v in specs], ["kpi"])
        self.assertTrue(any("1/42" in n for n in notes))

    def test_ranking_question_gets_a_bar_chart(self):
        top = [{"variant_id": f"v{i}", "title": f"Sách {i}", "borrow_count": 50 - i} for i in range(10)]
        specs, _ = viz("Thống kê top 10 sách bằng biểu đồ", {"get_top_books": top})
        bar = next(v for v in specs if v["type"] == "bar")
        self.assertEqual(len(bar["data"]), 10)
        self.assertEqual(bar["summary"]["leader"], "Sách 0")
        self.assertNotIn("pie", bar["interactions"]["allowed_types"])  # a ranking is not parts of a whole

    def test_truncated_tool_lists_are_marked_partial(self):
        top = [{"variant_id": "v", "title": "A", "borrow_count": 5}] * 3 + [{"_truncated": "... va 8 dong khac"}]
        bar = next(v for v in viz("Top sách mượn nhiều", {"get_top_books": top})[0] if v["type"] == "bar")
        self.assertTrue(bar["is_partial"])
        self.assertTrue(bar["limitations"])

    def test_a_table_request_returns_a_table(self):
        top = [{"variant_id": f"v{i}", "title": f"Sách {i}", "borrow_count": 9 - i} for i in range(5)]
        specs, _ = viz("Top 5 sách mượn nhiều hiển thị dưới dạng bảng", {"get_top_books": top})
        self.assertIn("table", [v["type"] for v in specs])

    def test_permission_denied_means_no_chart_and_a_note(self):
        specs, notes = viz("Vẽ biểu đồ lượt mượn 6 tháng gần đây",
                           {"get_borrow_trends": {"error": "/analytics/borrow-trends tra ve HTTP 403"}})
        self.assertEqual(specs, [])
        self.assertTrue(any("không có quyền" in n for n in notes))

    def test_requested_chart_type_is_applied_when_compatible(self):
        specs, notes = viz("Vẽ biểu đồ cột lượt mượn 6 tháng gần đây", {"get_borrow_trends": MONTHLY})
        self.assertIn("bar", [v["type"] for v in specs])
        self.assertEqual(notes, [])

    def test_incompatible_chart_type_is_refused_with_a_reason(self):
        specs, notes = viz("Vẽ biểu đồ tròn lượt mượn 6 tháng gần đây", {"get_borrow_trends": MONTHLY})
        self.assertIn("line", [v["type"] for v in specs])
        self.assertTrue(any("biểu đồ tròn" in n for n in notes))

    def test_proportion_question_can_get_a_pie_for_parts_of_a_whole(self):
        funnel = {"total": 10, "pending": 1, "confirmed": 2, "ready_for_pickup": 1, "converted_to_loan": 4,
                  "cancelled": 1, "expired": 1, "conversion_rate": 40.0}
        specs, _ = viz("Tỷ trọng các trạng thái đặt chỗ bằng biểu đồ tròn", {"get_reservation_funnel": funnel})
        pie = next(v for v in specs if v["type"] == "pie")
        self.assertEqual(sum(r["count"] for r in pie["data"]), 10)

    def test_never_more_than_the_limit(self):
        data = {"get_borrow_trends": MONTHLY, "simulate_reorder_budget": SIMULATION, "get_warehouse_stock_risk": STOCK_RISK}
        specs, _ = viz("Vẽ biểu đồ lượt mượn 6 tháng, tồn kho các kho và ngân sách 5 triệu 10 triệu", data)
        self.assertLessEqual(len(specs), cv.MAX_VISUALIZATIONS)
        self.assertLessEqual(sum(1 for v in specs if v["type"] == "kpi"), 1)


class BriefTests(unittest.TestCase):
    def test_the_model_is_told_what_was_not_drawn(self):
        # Seen live: a refused pie, a line drawn instead, and the text said
        # there was no monthly data to draw.
        specs, notes = viz("Vẽ biểu đồ tròn lượt mượn 6 tháng gần đây", {"get_borrow_trends": MONTHLY})
        brief = cv.visualization_brief(specs, notes)
        self.assertIn("biểu đồ tròn chỉ dùng", brief)
        self.assertIn("Biểu đồ đường", brief)
        self.assertIn("không tồn tại", cv.visualization_brief([], ["Không tạo biểu đồ xu hướng mượn: không có quyền."]))
        self.assertEqual(cv.visualization_brief([], []), "")


class WarehouseTests(unittest.TestCase):
    def test_two_warehouse_comparison_is_a_same_unit_bar_chart_matching_the_risk_rule(self):
        specs, _ = viz("So sánh tình hình tồn kho Hà Nội và HCM bằng biểu đồ", {"compare_warehouses": COMPARE})
        bar = specs[0]
        self.assertEqual(bar["type"], "bar")
        self.assertEqual({s["unit"] for s in bar["series"]}, {"đầu sách"})
        self.assertEqual(bar["summary"]["riskiest"], COMPARE["comparison"]["riskier"])
        self.assertEqual(bar["scope"]["level"], "warehouses")
        self.assertEqual([r["warehouse"] for r in bar["data"]], ["Kho HCM Chinh", "Kho Ha Noi"])

    def test_quantity_chart_never_mixes_titles_and_copies(self):
        specs, _ = viz("So sánh tình hình tồn kho Hà Nội và HCM bằng biểu đồ", {"compare_warehouses": COMPARE})
        for v in specs:
            if v["type"] in cv.CHART_TYPES:
                self.assertEqual(len({s["unit"] for s in v["series"]}), 1)

    def test_shortage_table_marks_system_wide_columns(self):
        shortage = {"warehouse_name": "Kho HCM Chinh", "summary": {"low_stock_items": 7, "out_of_stock_items": 3,
                                                                    "items_with_recent_demand": 6, "items_with_rising_demand": 1},
                    "items": [{"title": "A", "status": "HẾT HÀNG", "available_qty": 0, "borrow_count": 72}],
                    "limitations": ["Nhu cầu toàn hệ thống."]}
        specs, _ = viz("Vẽ biểu đồ vì sao kho HCM thiếu sách dưới dạng bảng", {"explain_warehouse_shortage": shortage})
        table = next(v for v in specs if v["type"] == "table")
        self.assertEqual(table["scope"]["label"], "Kho HCM Chinh")
        borrow = next(s for s in table["series"] if s["key"] == "borrow_count")
        self.assertEqual(borrow["scope_note"], "Toàn hệ thống")

    def test_two_shortage_results_become_one_comparison_chart(self):
        hn = {"warehouse_name": "Kho Ha Noi", "summary": {"low_stock_items": 2, "out_of_stock_items": 0,
                                                          "items_with_recent_demand": 1}, "items": []}
        hcm = {"warehouse_name": "Kho HCM Chinh", "summary": {"low_stock_items": 9, "out_of_stock_items": 4,
                                                              "items_with_recent_demand": 6}, "items": []}
        specs, _ = viz("Vì sao kho HCM rủi ro thiếu hàng hơn kho Hà Nội?",
                       {"compare_warehouses": COMPARE, "explain_warehouse_shortage": hcm, "explain_warehouse_shortage#2": hn})
        chart = next(v for v in specs if v["title"] == "Các yếu tố thiếu hàng theo kho")
        self.assertEqual([r["warehouse"] for r in chart["data"]], ["Kho HCM Chinh", "Kho Ha Noi"])


class SimulationTests(unittest.TestCase):
    def test_budget_scenarios_get_cost_and_title_charts_plus_a_table(self):
        specs, _ = viz("So sánh các phương án nhập sách 5 triệu, 10 triệu và 20 triệu bằng biểu đồ",
                       {"simulate_reorder_budget": SIMULATION})
        types = [v["type"] for v in specs]
        self.assertEqual(types.count("bar"), 2)
        self.assertIn("table", types)
        cost = next(v for v in specs if "chi phí" in v["title"].lower())
        self.assertEqual({s["unit"] for s in cost["series"]}, {"₫"})
        self.assertEqual(cost["interactions"]["budget"]["current"], [5e6, 1e7, 2e7])
        self.assertTrue(numbers([v["data"] for v in specs]) <= numbers(SIMULATION))

    def test_a_failed_scenario_is_a_gap_not_a_zero(self):
        broken = json.loads(json.dumps(SIMULATION))
        broken["scenarios"][1] = {"label": "Ngân sách 10.000.000 ₫", "budget_vnd": 1e7, "error": "timeout"}
        specs, _ = viz("So sánh ngân sách 5 triệu, 10 triệu và 20 triệu bằng biểu đồ", {"simulate_reorder_budget": broken})
        table = next(v for v in specs if v["type"] == "table")
        self.assertIsNone(table["data"][1]["funded_cost"])
        self.assertTrue(table["is_partial"])
        self.assertTrue(any("không tính là 0" in x for x in table["limitations"]))

    def test_budget_comparison_is_a_what_if_so_optimal_wording_is_checked(self):
        self.assertEqual(plan("So sánh các phương án nhập sách 5 triệu, 10 triệu và 20 triệu").requested_analysis, "what_if")


class InvalidValueTests(unittest.TestCase):
    def test_nan_infinity_and_text_become_flagged_gaps(self):
        rows = json.loads(json.dumps(MONTHLY))
        rows[2]["loans"], rows[3]["loans"], rows[4]["returns"] = float("nan"), float("inf"), "abc"
        specs, _ = viz("Vẽ biểu đồ lượt mượn 6 tháng gần đây", {"get_borrow_trends": rows})
        line = next(v for v in specs if v["type"] == "line")
        self.assertIsNone(line["data"][2]["loans"])
        self.assertIsNone(line["data"][3]["loans"])
        self.assertTrue(line["is_partial"])
        self.assertTrue(any("không phải số hợp lệ" in x for x in line["limitations"]))
        self.assertNotIn(0, [line["data"][i]["loans"] for i in (2, 3)])


class NullIsNotZeroTests(unittest.TestCase):
    def test_books_absent_from_the_previous_top_stay_empty(self):
        result = {"current_period": {"from": "2026-10-01", "to": "2026-10-15"},
                  "previous_period": {"from": "2026-09-01", "to": "2026-09-30"},
                  "current": [{"rank": 1, "title": "A", "variant_id": "a", "borrow_count": 9, "previous_rank": None,
                               "previous_borrow_count": None, "status": "MỚI VÀO TOP"},
                              {"rank": 2, "title": "B", "variant_id": "b", "borrow_count": 7, "previous_rank": 1,
                               "previous_borrow_count": 12, "status": "GIẢM HẠNG"}], "dropped_out": []}
        specs, _ = viz("Top sách tháng này so với tháng trước", {"compare_top_books": result})
        bar = next(v for v in specs if v["type"] == "bar")
        self.assertIsNone(bar["data"][0]["previous"])
        self.assertTrue(any("không tính là 0" in x for x in bar["limitations"]))


class PlannerVisualizationTests(unittest.TestCase):
    def test_chart_type_phrases_with_and_without_accents(self):
        cases = {"Vẽ lại bằng biểu đồ đường": "line", "Đổi sang biểu đồ cột": "bar", "doi sang bieu do cot": "bar",
                 "Hiển thị số liệu dưới dạng bảng": "table", "chuyen sang dang bang": "table",
                 "Đổi sang biểu đồ tròn": "pie", "ve bieu do mien": "area", "Đổi biểu đồ đường sang cột": "bar"}
        for text, expected in cases.items():
            self.assertEqual(detect_visualization(normalize_query(text))["chart_type"], expected, text)

    def test_bang_meaning_by_is_not_a_table(self):
        self.assertIsNone(detect_visualization(normalize_query("So sánh hai kho bằng biểu đồ"))["chart_type"])
        self.assertTrue(detect_visualization(normalize_query("So sánh hai kho bằng biểu đồ"))["requested"])

    def test_lap_bang_is_a_table_request_not_a_write(self):
        # Found by the eval: "lập" made this a write request with no tools.
        p = plan("Sách nào tồn kho lâu không ai mượn? Lập bảng số liệu")
        self.assertEqual([t["name"] for t in p.required_tools], ["get_aging_inventory"])
        self.assertEqual(p.visualization["chart_type"], "table")
        self.assertEqual(plan("Lập phiếu nhập cho sách A").required_tools, [])  # real writes keep their route

    def test_bieu_do_alone_is_not_a_borrow_question(self):
        p = plan("Cho tôi xem biểu đồ tồn kho")
        self.assertEqual(p.capabilities, ["warehouse_risk"])
        self.assertTrue(p.visualization["requested"])

    def test_scenario_requests_plan_the_right_tools(self):
        p = plan("Vẽ biểu đồ lượt mượn sách trong 6 tháng gần đây và phân tích xu hướng.")
        self.assertEqual(p.required_tools[0]["name"], "get_borrow_trends")
        self.assertEqual(p.required_tools[0]["args"]["granularity"], "month")
        self.assertEqual(p.time_range["token"], "last_6_months")
        p = plan("So sánh tình hình tồn kho Hà Nội và HCM bằng biểu đồ.")
        self.assertEqual(p.required_tools, [{"name": "compare_warehouses", "args": {"warehouses": ["Kho Ha Noi", "Kho HCM Chinh"]}}])
        p = plan("So sánh các phương án nhập sách 5 triệu, 10 triệu và 20 triệu bằng biểu đồ.")
        self.assertEqual(p.required_tools[0]["args"]["budgets_vnd"], [5_000_000, 10_000_000, 20_000_000])

    def test_period_rules_rolling_completed_calendar(self):
        # Unchanged meaning: last 6 x 30 days (first and last month partial).
        p = plan("Vẽ biểu đồ lượt mượn 6 tháng gần đây")
        self.assertEqual((p.time_range["token"], p.time_range["start"], p.time_range["end"]),
                         ("last_6_months", "2026-04-18", "2026-10-15"))
        # 6 completed months: Apr-Sep 2026, every bucket whole.
        p = plan("Vẽ biểu đồ lượt mượn 6 tháng trọn")
        self.assertEqual((p.time_range["start"], p.time_range["end"]), ("2026-04-01", "2026-09-30"))
        self.assertEqual(p.required_tools[0]["args"]["granularity"], "month")
        # 6 calendar months: May 1 to today (October month-to-date).
        p = plan("Lượt mượn 6 tháng theo lịch")
        self.assertEqual((p.time_range["start"], p.time_range["end"]), ("2026-05-01", "2026-10-15"))
        # month to date
        p = plan("Lượt mượn tháng này")
        self.assertEqual((p.time_range["start"], p.time_range["end"]), ("2026-10-01", "2026-10-15"))

    def test_completed_months_have_no_partial_bucket(self):
        p = plan("Vẽ biểu đồ lượt mượn 6 tháng trọn")
        rows = [{"date": f"2026-{m:02d}", "loans": n, "returns": 1, "reservations": 1}
                for m, n in zip(range(4, 10), [120, 130, 110, 100, 90, 80])]
        line = next(v for v in cv.build_visualizations(p, {"get_borrow_trends": rows}, NOW)[0] if v["type"] == "line")
        self.assertFalse(line["is_partial"])
        self.assertEqual(line["annotations"], [])

    def test_long_periods_are_charted_per_month(self):
        args = plan("Xu hướng mượn năm nay").required_tools[0]["args"]
        self.assertEqual(args.get("granularity"), "month")

    def test_chart_request_without_context_asks_back(self):
        for text in ("Đổi sang biểu đồ cột.", "Giải thích biểu đồ vừa rồi.", "Vẽ biểu đồ"):
            p = plan(text)
            self.assertTrue(p.clarification_needed, text)
            self.assertTrue(p.clarification_options)

    def test_clarification_keeps_the_requested_chart_in_the_options(self):
        p = plan("So sánh hai kho bằng biểu đồ cột")
        self.assertTrue(p.clarification_needed)
        self.assertTrue(all(o.endswith("bằng biểu đồ cột") for o in p.clarification_options))

    def _after_trend(self):
        first = plan("Thống kê lượt mượn 6 tháng gần đây.")
        line = [{"type": "line", "title": "Lượt mượn theo tháng"}]
        return first, next_state(first, {"get_borrow_trends": MONTHLY}, None, line)

    def test_retype_follow_up_keeps_the_data_scope(self):
        first, state = self._after_trend()
        p = plan("Vẽ lại bằng biểu đồ cột.", state)
        self.assertEqual(p.visualization["mode"], "retype")
        self.assertEqual(p.visualization["chart_type"], "bar")
        self.assertEqual(p.required_tools, first.required_tools)
        self.assertEqual(p.time_range, first.time_range)

    def test_explain_follow_up(self):
        _first, state = self._after_trend()
        for text in ("Giải thích biểu đồ vừa rồi.", "Biểu đồ này cho thấy điều gì?"):
            p = plan(text, state)
            self.assertEqual(p.visualization["mode"], "explain", text)
            self.assertEqual(p.capabilities, ["borrow_trend"])

    def test_scope_follow_up_keeps_showing_the_chart(self):
        _first, state = self._after_trend()
        p = plan("Chỉ lấy dữ liệu tháng này.", state)
        self.assertEqual(p.time_range["token"], "this_month")
        self.assertTrue(p.visualization["requested"])
        self.assertEqual(p.visualization["chart_type"], "line")
        self.assertNotIn("mode", p.visualization)

    def test_chart_of_data_smartbook_does_not_have_is_refused_not_redrawn(self):
        # Seen live: with a previous chart in the conversation this was planned
        # as "redraw the previous turn" and answered with the wrong data.
        _first, state = self._after_trend()
        for s in (None, state):
            p = plan("Vẽ biểu đồ doanh thu bán sách online theo quý.", s)
            self.assertTrue(p.clarification_needed)
            self.assertNotIn("mode", p.visualization)
            self.assertIn("chưa có dữ liệu", p.clarification_question)
            self.assertFalse(any("bằng biểu đồ bằng" in o or o.endswith("biểu đồ bằng biểu đồ")
                                 for o in p.clarification_options))

    def test_state_records_the_chart(self):
        _first, state = self._after_trend()
        self.assertEqual(state["viz"]["chart_type"], "line")
        self.assertTrue(state["viz"]["shown"])


class TextChartTests(unittest.TestCase):
    def test_character_drawn_charts_are_removed(self):
        # The live answer for scenario C, abridged.
        answer = ("Với 20 triệu nhập được nhiều đầu sách ưu tiên cao hơn.\n\n**Biểu đồ so sánh các phương án:**\n\n```\n"
                  "Ngân sách 5 triệu:\nChi phí duyệt: ████████ 4.947.000 ₫\n```\n\nKhông có phương án nào tối ưu tuyệt đối.")
        out = cv.strip_text_charts(answer)
        self.assertNotIn("█", out)
        self.assertNotIn("**Biểu đồ so sánh", out)
        self.assertIn("Với 20 triệu", out)
        self.assertIn("Không có phương án nào tối ưu", out)

    def test_markdown_tables_are_removed_but_bullets_kept(self):
        answer = "Kết luận.\n| Kho | Hết hàng |\n|---|---|\n| A | 3 |\n- Kho A có 3 đầu sách hết hàng."
        self.assertEqual(cv.strip_text_charts(answer), "Kết luận.\n- Kho A có 3 đầu sách hết hàng.")

    def test_plain_answers_are_untouched(self):
        answer = "Kho HCM Chinh rủi ro hơn.\n- 3 đầu sách hết hàng.\n- 7 dưới ngưỡng."
        self.assertEqual(cv.strip_text_charts(answer), answer)


class FakeStoreWithData(FakeStore):
    """FakeStore that also keeps data/tool_calls (the snapshot) and timestamps."""

    async def append_message(self, conversation_id, role, content=None, metadata=None, data=None, tool_calls=None, **_kw):
        self.messages.append(SimpleNamespace(conversation_id=conversation_id, role=role, content=content,
                                             msg_metadata=metadata, data=data, tool_calls=tool_calls,
                                             tool_results=None, pending_action_id=None, grounding_warning=None,
                                             sources=None, created_at=NOW))


class VisualizationEndpointTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.store = FakeStoreWithData()
        self.provider = FakeProvider("Lượt mượn có xu hướng giảm từ 120 lượt (05/2026) xuống 90 lượt (09/2026).")
        self.trend_calls = []

        async def borrow_trends(auth_header=None, from_date=None, to_date=None, granularity=None):
            self.trend_calls.append((from_date, granularity))
            return MONTHLY

        main.assistant_response_cache.clear()
        self._patches = [
            patch("main.rate_limiter.acquire", new=AsyncMock(return_value=(True, None))),
            patch("main.get_user_context", new=AsyncMock(return_value=ADMIN)),
            patch("main.conversation_store.get_or_create_conversation", new=self.store.get_or_create_conversation),
            patch("main.conversation_store.append_message", new=self.store.append_message),
            patch("main.conversation_store.get_recent_messages", new=self.store.get_recent_messages),
            patch("main.copilot_tools._warehouses", new=AsyncMock(return_value=WAREHOUSES)),
            patch("main._get_assistant_provider", return_value=self.provider),
            patch.dict(main.TOOL_FUNCTIONS, {"get_borrow_trends": borrow_trends}),
            *frozen_clock(),
        ]
        for p in self._patches:
            p.start()

    def tearDown(self):
        for p in self._patches:
            p.stop()

    async def ask(self, message, cid):
        return (await main.assistant(_request(), AssistantRequest(message=message, conversation_id=cid))).model_dump()

    async def stream(self, message, cid):
        response = await main.assistant_stream(_request(), AssistantRequest(message=message, conversation_id=cid))
        events = [chunk async for chunk in response.body_iterator]
        done = [e for e in events if e.startswith("event: done")][0]
        return json.loads(done.split("data: ", 1)[1])

    async def test_both_endpoints_return_the_same_visualizations(self):
        q = "Vẽ biểu đồ lượt mượn 6 tháng gần đây và phân tích xu hướng"
        body = await self.ask(q, "v1")
        done = await self.stream(q, "v2")
        self.assertTrue(body["visualizations"])
        strip = lambda specs: [{k: v for k, v in s.items() if k != "data_as_of"} for s in specs]  # noqa: E731
        self.assertEqual(strip(body["visualizations"]), strip(done["visualizations"]))
        self.assertIn("Trực quan hóa hiển thị kèm", self.provider.calls[0][0]["content"])

    async def test_kpi_figures_quoted_by_the_answer_are_grounded(self):
        self.provider.text = "Tổng 635 lượt mượn; trung bình 110 lượt mỗi tháng trọn kỳ, giảm 25%."
        body = await self.ask("Vẽ biểu đồ lượt mượn 6 tháng gần đây và phân tích xu hướng", "v3")
        self.assertIsNone(body["grounding_warning"])

    async def test_retype_follow_up_reuses_the_snapshot_without_tools_or_llm(self):
        await self.ask("Vẽ biểu đồ lượt mượn 6 tháng gần đây", "v4")
        llm_calls, tool_calls = len(self.provider.calls), len(self.trend_calls)
        first = self.store.messages[-1].msg_metadata["extras"]["visualizations"]
        body = await self.ask("Đổi sang biểu đồ cột", "v4")
        self.assertEqual(len(self.provider.calls), llm_calls)
        self.assertEqual(len(self.trend_calls), tool_calls)
        bar = next(v for v in body["visualizations"] if v["type"] == "bar")
        line = next(v for v in first if v["type"] == "line")
        self.assertEqual(bar["data"], line["data"])  # same rows, nothing recomputed
        self.assertIn("không thay đổi", body["answer"])
        self.assertEqual(body["plan"]["visualization"]["mode"], "retype")

    async def test_retype_through_the_stream_matches(self):
        await self.ask("Vẽ biểu đồ lượt mượn 6 tháng gần đây", "v5")
        done = await self.stream("Hiển thị số liệu dưới dạng bảng", "v5")
        self.assertIn("table", [v["type"] for v in done["visualizations"]])

    async def test_stale_snapshot_is_re_read_with_the_same_tool_calls(self):
        await self.ask("Vẽ biểu đồ lượt mượn 6 tháng gần đây", "v6")
        stale = (NOW - timedelta(hours=3)).isoformat(timespec="seconds")
        self.store.messages[-1].msg_metadata["extras"]["data_as_of"] = stale
        before = list(self.trend_calls)
        body = await self.ask("Đổi sang biểu đồ cột", "v6")
        self.assertEqual(len(self.trend_calls), len(before) + 1)
        self.assertEqual(self.trend_calls[-1], before[-1])  # same period, same granularity
        self.assertIn("truy vấn lại", body["answer"])

    async def test_explain_follow_up_uses_the_snapshot_data(self):
        await self.ask("Vẽ biểu đồ lượt mượn 6 tháng gần đây", "v7")
        tool_calls = len(self.trend_calls)
        body = await self.ask("Biểu đồ này cho thấy điều gì?", "v7")
        self.assertEqual(len(self.trend_calls), tool_calls)
        self.assertEqual(body["data"]["get_borrow_trends"], MONTHLY)
        self.assertIn("ảnh chụp", self.provider.calls[-1][0]["content"])
        self.assertTrue(body["visualizations"])

    async def test_conversation_history_rehydrates_the_same_snapshot(self):
        body = await self.ask("Vẽ biểu đồ lượt mượn 6 tháng gần đây", "v8")
        row = self.store.messages[-1]
        summary = _message_summary(row)
        self.assertEqual(summary["extras"]["visualizations"], body["visualizations"])
        self.assertEqual(summary["extras"]["visualizations"][0]["data_as_of"], body["visualizations"][0]["data_as_of"])
        self.assertEqual(row.msg_metadata["copilot_state"]["viz"]["chart_type"], "line")

    async def test_chart_requests_without_context_never_invent_a_chart(self):
        body = await self.ask("Đổi sang biểu đồ cột", "v9")
        self.assertEqual(body["visualizations"], [])
        self.assertTrue(body["plan"]["clarification_needed"])
        self.assertEqual(self.trend_calls, [])

    async def test_permission_denied_gives_no_chart(self):
        async def denied(auth_header=None, **_kw):
            return {"error": "/analytics/borrow-trends tra ve HTTP 403"}
        with patch.dict(main.TOOL_FUNCTIONS, {"get_borrow_trends": denied}):
            body = await self.ask("Vẽ biểu đồ lượt mượn 6 tháng gần đây", "v10")
        self.assertEqual(body["visualizations"], [])
        self.assertTrue(any("không có quyền" in n for n in body["visualization_notes"]))

    def test_only_planned_tools_are_charted(self):
        # Seen live: the model added compare_borrow_periods (May vs Sep) on its
        # own and it was charted. Its data informs the text, not the charts.
        p = plan("Vẽ biểu đồ lượt mượn 6 tháng gần đây")
        data = {"get_borrow_trends": MONTHLY, "compare_borrow_periods": {"metrics": {}}}
        self.assertEqual(list(main._viz_data(p, data)), ["get_borrow_trends"])
        self.assertEqual(main._viz_data(plan("Xin chào"), data), data)  # no plan: nothing filtered

    async def test_snapshots_never_cross_conversations(self):
        await self.ask("Vẽ biểu đồ lượt mượn 6 tháng gần đây", "v11")
        body = await self.ask("Đổi sang biểu đồ cột", "v12")
        self.assertEqual(body["visualizations"], [])
        self.assertTrue(body["plan"]["clarification_needed"])


if __name__ == "__main__":
    unittest.main()
