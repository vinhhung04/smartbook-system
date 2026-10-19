"""copilot_tools: joins on business ids, deterministic arithmetic, explicit
ranking rules - with the gateway faked (no network)."""
from __future__ import annotations

import asyncio
import unittest
from unittest.mock import patch

import copilot_tools as ct

WAREHOUSES = [
    {"id": "w-hcm", "code": "WH-HCM-01", "name": "Kho HCM Chinh", "is_active": True},
    {"id": "w-hn", "code": "WH-HN-01", "name": "Kho Ha Noi", "is_active": True},
]
RISK = [
    {"warehouse_id": "w-hcm", "warehouse_name": "Kho HCM Chinh", "low_stock_variants": 7, "out_of_stock_variants": 3,
     "total_available_qty": 120, "total_reserved_qty": 6, "total_borrowed_qty": 4},
    {"warehouse_id": "w-hn", "warehouse_name": "Kho Ha Noi", "low_stock_variants": 1, "out_of_stock_variants": 1,
     "total_available_qty": 8, "total_reserved_qty": 2, "total_borrowed_qty": 0},
]


def reorder_item(variant_id, title, **kw):
    base = {"variant_id": variant_id, "title": title, "available_qty": 1, "reorder_point": 5, "borrow_count": 10,
            "priority": "HIGH", "suggested_reorder_qty": 4, "estimated_cost": 400_000, "lead_time_days": 14,
            "lead_time_source": "DEFAULT", "lead_time_samples": 0, "lead_time_demand": 6, "unit_cost": 100_000}
    base.update(kw)
    return base


class FakeGateway:
    def __init__(self, routes):
        self.routes = routes
        self.calls = []

    async def __call__(self, endpoint, auth_header, params=None):
        self.calls.append((endpoint, dict(params or {})))
        handler = self.routes.get(endpoint)
        if handler is None:
            return {"error": f"{endpoint} tra ve HTTP 404"}
        return handler(params or {}) if callable(handler) else handler


def run(coro):
    return asyncio.run(coro)


class DemandVsStockTests(unittest.TestCase):
    def test_join_is_on_variant_id_not_on_title(self):
        top = [
            {"variant_id": "v-1", "title": "Norwegian Wood", "borrow_count": 73},
            # Same title, different variant (another edition): must NOT pick up v-9's stock.
            {"variant_id": "v-2", "title": "Kafka on the Shore", "borrow_count": 26},
        ]
        reorder = {"items": [reorder_item("v-1", "Norwegian Wood (bìa mềm)", available_qty=5, reorder_point=10),
                             reorder_item("v-9", "Kafka on the Shore", available_qty=0)],
                   "range": {"from": "2026-09-13", "to": "2026-10-13"}}
        gw = FakeGateway({"/analytics/top-books": top, "/analytics/reorder-suggestions": reorder})
        with patch.object(ct, "_cached_get", gw):
            result = run(ct.analyze_demand_vs_stock("Bearer t"))
        self.assertEqual([r["variant_id"] for r in result["rows"]], ["v-1"])
        self.assertEqual(result["rows"][0]["borrow_count"], 73)
        self.assertEqual(result["rows"][0]["available_qty"], 5)
        self.assertEqual(result["top_books_without_reorder_need"][0]["title"], "Kafka on the Shore")
        self.assertEqual(result["join_key"], "variant_id")

    def test_dates_reach_both_sources(self):
        gw = FakeGateway({"/analytics/top-books": [], "/analytics/reorder-suggestions": {"items": []}})
        with patch.object(ct, "_cached_get", gw):
            run(ct.analyze_demand_vs_stock("Bearer t", "2026-10-01T00:00:00+07:00", "2026-10-13T15:00:00+07:00"))
        for _endpoint, params in gw.calls:
            self.assertEqual(params.get("from"), "2026-10-01T00:00:00+07:00")


class CompareWarehousesTests(unittest.TestCase):
    def test_pairwise_comparison_follows_the_stated_rule(self):
        gw = FakeGateway({"/analytics/warehouse-stock-risk": RISK, "/api/warehouses": WAREHOUSES})
        with patch.object(ct, "_cached_get", gw):
            result = run(ct.compare_warehouses("Bearer t", ["Kho Ha Noi", "Kho HCM Chinh"]))
        self.assertEqual(result["comparison"]["riskier"], "Kho HCM Chinh")
        self.assertEqual(result["comparison"]["out_of_stock_diff"], 2)
        self.assertEqual(result["comparison"]["low_stock_diff"], 6)
        self.assertIn("hết hàng", result["criteria"])

    def test_unknown_warehouse_is_reported_not_guessed(self):
        gw = FakeGateway({"/analytics/warehouse-stock-risk": RISK, "/api/warehouses": WAREHOUSES})
        with patch.object(ct, "_cached_get", gw):
            result = run(ct.compare_warehouses("Bearer t", ["Kho Da Nang", "Kho Ha Noi"]))
        self.assertEqual(result["unresolved"], ["Kho Da Nang"])
        self.assertNotIn("comparison", result)


class ComparePeriodsTests(unittest.TestCase):
    def test_totals_changes_and_per_day_rates(self):
        def trends(params):
            if params["from"].startswith("2026-10"):
                return [{"date": "2026-10-01", "loans": 10, "returns": 4, "reservations": 1},
                        {"date": "2026-10-02", "loans": 20, "returns": 6, "reservations": 1}]
            return [{"date": f"2026-09-{d:02d}", "loans": 3, "returns": 3, "reservations": 0} for d in range(1, 31)]
        gw = FakeGateway({"/analytics/borrow-trends": trends})
        with patch.object(ct, "_cached_get", gw):
            r = run(ct.compare_borrow_periods("Bearer t", "2026-10-01T00:00:00+07:00", "2026-10-02T23:59:59+07:00",
                                              "2026-09-01T00:00:00+07:00", "2026-09-30T23:59:59+07:00"))
        loans = r["metrics"]["loans"]
        self.assertEqual((loans["current"], loans["previous"], loans["change"]), (30, 90, -60))
        self.assertEqual(loans["change_pct"], -66.7)
        self.assertEqual((loans["current_per_day"], loans["previous_per_day"]), (15.0, 3.0))
        self.assertEqual(loans["per_day_change_pct"], 400.0)
        self.assertTrue(r["unequal_length"])
        self.assertEqual(r["current_period"]["peak_day"], "2026-10-02")

    def test_missing_dates_is_an_error_not_a_guess(self):
        self.assertIn("error", run(ct.compare_borrow_periods("Bearer t", "2026-10-01", "", "", "")))


class BudgetSimulationTests(unittest.TestCase):
    def _gateway(self):
        items = [reorder_item("v-1", "A", estimated_cost=600_000, lead_time_demand=10, available_qty=0),
                 reorder_item("v-2", "B", estimated_cost=300_000, lead_time_demand=4, available_qty=2),
                 reorder_item("v-3", "C", priority="LOW", estimated_cost=100_000, lead_time_demand=0, available_qty=3)]

        def reorder(params):
            budget = params.get("budgetVnd")
            result = {"summary": {"total_candidates": 3, "high_priority": 2, "estimated_total_cost": 1_000_000,
                                  "estimated_total_reorder_qty": 12}, "items": [dict(i) for i in items]}
            if budget is not None:
                remaining = budget
                for i in result["items"]:  # stand-in for the analytics allocation
                    i["within_budget"] = i["estimated_cost"] <= remaining
                    remaining -= i["estimated_cost"] if i["within_budget"] else 0
                result["budget"] = {"budget_vnd": budget, "funded_cost": budget - remaining, "remaining_vnd": remaining}
            return result
        return FakeGateway({"/analytics/reorder-suggestions": reorder})

    def test_each_stated_budget_is_a_scenario(self):
        gw = self._gateway()
        with patch.object(ct, "_cached_get", gw):
            r = run(ct.simulate_reorder_budget("Bearer t", budgets_vnd=[700_000]))
        s = r["scenarios"][0]
        self.assertEqual((s["funded_lines"], s["funded_cost"], s["remaining_vnd"]), (2, 700_000, 0))
        self.assertEqual(s["unfunded_high_priority"], 1)
        # shortfall = max(0, demand - available): A 10, B 2, C 0 -> funded A + C covers 10 of 12.
        self.assertEqual(s["shortfall_covered_pct"], 83.3)
        self.assertFalse(r["scenarios_are_assumed"])

    def test_no_budget_means_labelled_assumed_fractions_of_need(self):
        with patch.object(ct, "_cached_get", self._gateway()):
            r = run(ct.simulate_reorder_budget("Bearer t"))
        self.assertTrue(r["scenarios_are_assumed"])
        self.assertEqual([s["budget_vnd"] for s in r["scenarios"]], [1_000_000, 750_000, 500_000, 250_000])

    def test_percentage_cut_applies_to_the_full_need_when_no_budget_is_given(self):
        with patch.object(ct, "_cached_get", self._gateway()):
            r = run(ct.simulate_reorder_budget("Bearer t", budget_change_pct=-30))
        self.assertEqual([s["budget_vnd"] for s in r["scenarios"]], [1_000_000, 700_000])


class ExplainTests(unittest.TestCase):
    def test_reorder_item_by_rank_title_and_variant(self):
        data = {"summary": {"total_candidates": 2}, "items": [reorder_item("v-1", "Norwegian Wood"),
                                                               reorder_item("v-2", "Kafka on the Shore")]}
        gw = FakeGateway({"/analytics/reorder-suggestions": data})
        with patch.object(ct, "_cached_get", gw):
            self.assertEqual(run(ct.explain_reorder_item("t", rank=2))["item"]["variant_id"], "v-2")
            self.assertEqual(run(ct.explain_reorder_item("t", title="Tại sao Norwegian Wood được đề xuất nhập?"))["rank_in_list"], 1)
            self.assertEqual(run(ct.explain_reorder_item("t", variant_id="v-2"))["item"]["title"], "Kafka on the Shore")
            self.assertFalse(run(ct.explain_reorder_item("t", title="Sách không có"))["found"])

    def test_data_confidence_is_a_rule_on_sample_sizes(self):
        self.assertEqual(ct.data_confidence({"borrow_count": 20, "lead_time_source": "LEARNED", "lead_time_samples": 4})["level"], "CAO")
        self.assertEqual(ct.data_confidence({"borrow_count": 5, "lead_time_source": "SUPPLIER_DECLARED"})["level"], "TRUNG BÌNH")
        self.assertEqual(ct.data_confidence({"borrow_count": 50, "lead_time_source": "DEFAULT"})["level"], "THẤP")

    def test_warehouse_shortage_joins_stock_rows_with_demand_by_variant_id(self):
        items = {"counts": {"out_of_stock": 1, "low_stock_including_out": 2},
                 "items": [{"variant_id": "v-1", "title": "A", "status": "OUT_OF_STOCK", "available_qty": 0, "reorder_point": 3},
                           {"variant_id": "v-7", "title": "Z", "status": "LOW_STOCK", "available_qty": 1, "reorder_point": 3}]}
        gw = FakeGateway({
            "/api/warehouses": WAREHOUSES, "/analytics/warehouse-stock-risk": RISK,
            "/analytics/warehouse-stock-items": items,
            "/analytics/reorder-suggestions": {"items": [reorder_item("v-1", "A", demand_trend_pct=25.0)]},
        })
        with patch.object(ct, "_cached_get", gw):
            r = run(ct.explain_warehouse_shortage("Bearer t", "Kho HCM Chinh"))
        self.assertEqual(r["warehouse_name"], "Kho HCM Chinh")
        self.assertEqual(r["summary"], {"low_stock_items": 2, "out_of_stock_items": 1,
                                        "items_with_recent_demand": 1, "items_with_rising_demand": 1})
        factors = {f["factor"] for f in r["factors"]}
        self.assertIn("Nhu cầu đang tăng so với kỳ trước", factors)
        self.assertTrue(any("không có tín hiệu nhu cầu" in f for f in factors))
        self.assertTrue(any("toàn hệ thống" in x for x in r["limitations"]))

    def test_unknown_warehouse_is_an_error_listing_the_real_ones(self):
        gw = FakeGateway({"/api/warehouses": WAREHOUSES})
        with patch.object(ct, "_cached_get", gw):
            r = run(ct.explain_warehouse_shortage("Bearer t", "Kho Da Nang"))
        self.assertIn("error", r)
        self.assertIn("Kho Ha Noi", r["candidates"])


class PriorityTests(unittest.TestCase):
    def test_tiers_order_tasks_and_missing_permissions_are_listed(self):
        gw = FakeGateway({
            "/analytics/dashboard/kpis": {"pickup_codes_expiring_soon": 0, "unpaid_fine_amount": 5_000_000},
            "/analytics/overdue-summary": {"error": "/analytics/overdue-summary tra ve HTTP 403"},
            "/analytics/warehouse-stock-risk": RISK,
            "/analytics/reorder-suggestions": {"summary": {"high_priority": 9},
                                               "items": [reorder_item("v-1", "A", available_qty=0, borrow_count=3)]},
        })
        with patch.object(ct, "_cached_get", gw):
            r = run(ct.rank_priority_tasks("Bearer t"))
        self.assertEqual([t["tier"] for t in r["tasks"]], sorted(t["tier"] for t in r["tasks"]))
        self.assertEqual(r["tasks"][0]["task"], "Bổ sung sách đã hết hàng nhưng vẫn có người mượn")
        self.assertTrue(any("403" in u for u in r["unavailable"]))
        self.assertFalse(any(t["task"] == "Xử lý phiếu mượn quá hạn" for t in r["tasks"]))


class CacheTests(unittest.TestCase):
    def test_identical_reads_are_shared_but_never_across_users(self):
        calls = []

        async def fake_get(endpoint, auth_header, params=None, truncate=True):
            calls.append(auth_header)
            await asyncio.sleep(0)
            return {"user": auth_header}

        async def scenario():
            ct._cache.clear()
            a1, a2, b = await asyncio.gather(
                ct._cached_get("/analytics/x", "Bearer A"), ct._cached_get("/analytics/x", "Bearer A"),
                ct._cached_get("/analytics/x", "Bearer B"))
            return a1, a2, b

        with patch.object(ct, "_get", fake_get):
            a1, a2, b = run(scenario())
        self.assertEqual((a1["user"], a2["user"], b["user"]), ("Bearer A", "Bearer A", "Bearer B"))
        self.assertEqual(sorted(calls), ["Bearer A", "Bearer B"])


if __name__ == "__main__":
    unittest.main()


class BudgetDeltaTests(BudgetSimulationTests):
    def test_later_scenarios_carry_their_difference_to_the_first(self):
        with patch.object(ct, "_cached_get", self._gateway()):
            r = run(ct.simulate_reorder_budget("Bearer t", budget_change_pct=-30))
        diff = r["scenarios"][1]["vs_first_scenario"]
        self.assertEqual(diff["budget_vnd"], -300_000)
        self.assertNotIn("vs_first_scenario", r["scenarios"][0])


class MarginalBudgetTests(unittest.TestCase):
    """3.3 analytics budget mode: lines funded in part (funded_qty), position
    with incoming purchase orders and expected returns (budget_plan)."""

    def _gateway(self):
        items = [reorder_item("v-1", "A", suggested_reorder_qty=10, estimated_cost=1_000_000, lead_time_demand=12, available_qty=2),
                 reorder_item("v-2", "B", priority="MEDIUM", suggested_reorder_qty=3, estimated_cost=300_000,
                              lead_time_demand=3, available_qty=0)]

        def reorder(params):
            result = {"summary": {"total_candidates": 2, "high_priority": 1, "estimated_total_cost": 1_300_000,
                                  "estimated_total_reorder_qty": 13}, "items": [dict(i) for i in items]}
            if params.get("budgetVnd") is not None:
                funded = {"v-1": 4, "v-2": 0}
                for i in result["items"]:
                    i["funded_qty"] = funded[i["variant_id"]]
                    i["funded_cost"] = i["funded_qty"] * i["unit_cost"]
                    i["within_budget"] = i["funded_qty"] > 0
                    i["budget_plan"] = {"incoming_qty": 2, "expected_returns": 1, "inventory_position": i["available_qty"] + 3,
                                        "cap_qty": 7}
                result["budget"] = {"budget_vnd": params["budgetVnd"], "funded_cost": 400_000, "remaining_vnd": 100_000,
                                    "partially_funded_lines": 1, "funding_order": "MARGINAL_SERVICE_PER_COST",
                                    "assumptions": ["Tồn dùng cho ngân sách = khả dụng + đang về + dự kiến trả."]}
            return result
        return FakeGateway({"/analytics/reorder-suggestions": reorder})

    def test_partial_lines_report_funded_copies_not_the_full_suggestion(self):
        with patch.object(ct, "_cached_get", self._gateway()):
            r = run(ct.simulate_reorder_budget("Bearer t", budgets_vnd=[500_000]))
        s = r["scenarios"][0]
        self.assertEqual((s["funded_lines"], s["funded_qty"], s["partially_funded_lines"]), (1, 4, 1))
        self.assertEqual(s["funded_items"][0]["funded_qty"], 4)
        self.assertEqual(s["funded_items"][0]["estimated_cost"], 400_000)
        # shortfall A = 12 - 2 = 10, covered by 4 funded + 3 already counted on; B (3) unfunded
        self.assertEqual(s["shortfall_covered_pct"], round(7 / 13 * 100, 1))
        self.assertIn("một phần", r["funding_rule"])
        self.assertTrue(r["budget_assumptions"])


class BudgetDraftTests(unittest.TestCase):
    def test_a_budgeted_list_drafts_only_funded_lines_at_the_funded_quantity(self):
        import agent_planner
        reorder = {"budget": {"budget_vnd": 500_000}, "items": [
            {"variant_id": "v-1", "title": "A", "suggested_reorder_qty": 10, "funded_qty": 4, "within_budget": True},
            {"variant_id": "v-2", "title": "B", "suggested_reorder_qty": 3, "funded_qty": 0, "within_budget": False}]}
        planned = run(agent_planner._build_reorder_draft("Tạo phiếu đề xuất nhập", {}, {"Reorder Suggestions": reorder},
                                                         [], [], None))
        items = planned["payload"]["items"]
        self.assertEqual([(i["title"], i["suggested_quantity"]) for i in items], [("A", 4)])


class PositionCoveredLinesTests(unittest.TestCase):
    def test_a_line_the_position_covers_is_not_left_out(self):
        items = [reorder_item("v-1", "A", suggested_reorder_qty=5, estimated_cost=500_000),
                 reorder_item("v-2", "B", suggested_reorder_qty=5, estimated_cost=500_000)]

        def reorder(params):
            result = {"summary": {"total_candidates": 2, "high_priority": 2, "estimated_total_cost": 1_000_000,
                                  "estimated_total_reorder_qty": 10}, "items": [dict(i) for i in items]}
            if params.get("budgetVnd") is not None:
                for i, (funded, cap) in zip(result["items"], ((2, 2), (0, 0))):
                    i.update(funded_qty=funded, funded_cost=funded * 100_000, within_budget=funded > 0,
                             budget_plan={"incoming_qty": 0, "expected_returns": 3, "inventory_position": 4, "cap_qty": cap})
                result["budget"] = {"budget_vnd": params["budgetVnd"], "funded_cost": 200_000, "remaining_vnd": 800_000,
                                    "capped_need_cost": 200_000, "funding_order": "MARGINAL_SERVICE_PER_COST"}
            return result
        with patch.object(ct, "_cached_get", FakeGateway({"/analytics/reorder-suggestions": reorder})):
            r = run(ct.simulate_reorder_budget("Bearer t", budgets_vnd=[1_000_000]))
        s = r["scenarios"][0]
        self.assertEqual((s["unfunded_high_priority"], s["lines_covered_by_position"]), (0, 1))
        self.assertEqual(r["full_need"]["need_with_position_vnd"], 200_000)
