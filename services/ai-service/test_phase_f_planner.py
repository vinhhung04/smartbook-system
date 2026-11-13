"""Phase F2 planner changes: the list of the previous turn ("trong số đó"),
"kho kia" after a comparison, ambiguous branch names, metric clarifications
routed to the semantic reading, analysis verbs no longer routed."""
import unittest
from datetime import datetime, timedelta, timezone

import copilot_plan as cp
import copilot_response
import copilot_semantic_planner as sp

NOW = datetime(2026, 10, 26, 10, 0, tzinfo=timezone(timedelta(hours=7)))
WAREHOUSES = [
    {"id": "w-hcm", "code": "WH-HCM-01", "name": "Kho HCM Chinh"},
    {"id": "w-hn", "code": "WH-HN-01", "name": "Kho Ha Noi"},
    {"id": "w-d1", "code": "BR-HCM-01", "name": "Chi Nhanh District 1"},
    {"id": "w-d3", "code": "BR-HCM-02", "name": "Chi Nhanh District 3"},
    {"id": "w-cg", "code": "BR-HN-01", "name": "Chi nhánh Hà Nội – Cầu Giấy"},
    {"id": "w-hk", "code": "BR-HN-02", "name": "Chi nhánh Hà Nội – Hoàn Kiếm"},
    {"id": "w-dnb", "code": "BR-DN-01", "name": "Chi nhánh Đà Nẵng"},
    {"id": "w-dn", "code": "WH-DN-01", "name": "Kho Đà Nẵng"},
    {"id": "w-ct", "code": "WH-CT-01", "name": "Kho Cần Thơ"},
]
LIST = [{"variant_id": f"v{i}", "title": t} for i, t in enumerate(["Số Đỏ", "Tắt Đèn", "Chí Phèo"], start=1)]


def plan(message, state=None):
    return cp.build_plan(message, state, WAREHOUSES, NOW)


def state_after(message, collected, previous=None):
    return cp.next_state(plan(message, previous), collected, previous)


class SubsetOfPreviousListTest(unittest.TestCase):
    def setUp(self):
        self.low_hn = state_after("Kho HCM có những đầu sách nào sắp hết?",
                                  {"get_warehouse_low_stock_items": {"items": LIST}})
        self.top = state_after("Top 5 sách mượn nhiều tháng này", {"get_top_books": LIST})

    def test_trong_so_do_carries_the_list_itself(self):
        p = plan("Trong số này cuốn nào được mượn nhiều nhất?", self.low_hn)
        self.assertEqual([i["title"] for i in p.entities["subset_items"]], ["Số Đỏ", "Tắt Đèn", "Chí Phèo"])
        self.assertIn("last_items", p.carried_over)
        top = [t for t in p.required_tools if t["name"] == "get_top_books"]
        self.assertEqual(top[0]["args"].get("limit"), 50)  # enough rows to place each listed title

    def test_stock_of_a_top_list_uses_the_per_title_join(self):
        p = plan("Trong số đó cuốn nào tồn ít?", self.top)
        self.assertEqual({t["name"] for t in p.required_tools}, {"analyze_demand_vs_stock"})
        self.assertTrue(p.entities["subset_items"])

    def test_the_list_reaches_the_prompt(self):
        note = copilot_response.plan_note(plan("Nhập thêm các cuốn này thì cần bao nhiêu tiền?", self.low_hn), NOW)
        self.assertIn("\"Số Đỏ\"", note)
        self.assertIn("Chỉ trả lời trong phạm vi danh sách này", note)

    def test_list_asked_in_the_same_question_is_not_the_previous_one(self):
        p = plan("Nhập sách gì với 15 triệu, và những sách đó có được mượn nhiều không?", self.low_hn)
        self.assertEqual(p.entities["subset_items"], [])

    def test_no_previous_list_means_no_subset(self):
        self.assertEqual(plan("Trong số này cuốn nào hết hàng?").entities.get("subset_items") or [], [])


class RemainingWarehouseTest(unittest.TestCase):
    def test_kho_kia_after_a_comparison_is_the_other_one(self):
        s1 = state_after("So sánh kho HCM với kho Hà Nội",
                         {"compare_warehouses": {"ranking": [], "comparison": {"riskier": "Kho HCM Chinh"}}})
        s2 = state_after("Kho nào thiếu sách nặng hơn?",
                         {"compare_warehouses": {"ranking": [], "comparison": {"riskier": "Kho HCM Chinh"}}}, s1)
        p = plan("Thế kho kia?", s2)
        self.assertEqual([w["code"] for w in p.entities["warehouses"]], ["WH-HN-01"])

    def test_which_more_keeps_both_warehouses_with_a_popularity_filter(self):
        s1 = state_after("So sánh kho HCM với kho Cần Thơ", {})
        p = plan("Nếu chỉ xét những sách được mượn nhiều thì kho nào thiếu hơn?", s1)
        self.assertEqual({w["code"] for w in p.entities["warehouses"]}, {"WH-HCM-01", "WH-CT-01"})


class AmbiguousBranchTest(unittest.TestCase):
    def test_city_with_two_branches_is_asked_about(self):
        p = plan("Chi nhánh Hà Nội còn đủ sách không?")
        self.assertTrue(p.clarification_needed)
        self.assertEqual(set(p.clarification_options), {"Chi nhánh Hà Nội – Cầu Giấy", "Chi nhánh Hà Nội – Hoàn Kiếm"})

    def test_city_matching_branch_codes_is_asked_about(self):
        self.assertTrue(plan("Chi nhánh HCM có thiếu sách không?").clarification_needed)

    def test_an_exact_branch_name_still_resolves(self):
        p = plan("Chi nhánh District 1 có đầu sách nào sắp hết không?")
        self.assertFalse(p.clarification_needed)
        self.assertEqual([w["code"] for w in p.entities["warehouses"]], ["BR-HCM-01"])
        self.assertEqual([w["code"] for w in plan("Chi nhánh Đà Nẵng có đầu sách nào hết hàng không?")
                          .entities["warehouses"]], ["BR-DN-01"])


class SemanticRoutingTest(unittest.TestCase):
    def test_metric_clarification_with_content_is_routed(self):
        p = plan("Mọi người dạo này có mượn sách nhiều hơn không?")
        if p.clarification_needed:  # the rules ask "chỉ số nào?" for this one
            self.assertIsNone(sp.guarded(p, p.normalized))
            self.assertEqual(sp.assess(p, p.normalized, WAREHOUSES), ["metric_clarification"])

    def test_bare_clarification_is_still_never_routed(self):
        for q in ("So sánh với kỳ trước", "Phân tích giúp tôi", "Kho đó còn bao nhiêu sách?"):
            p = plan(q)
            self.assertTrue(p.clarification_needed, q)
            self.assertEqual(sp.guarded(p, p.normalized), "rule_clarification", q)

    def test_analysis_verb_with_a_warehouse_is_not_an_uncovered_clause(self):
        self.assertEqual(sp.uncovered_clauses(cp.normalize_query("So sánh kho Hà Nội và kho HCM"), WAREHOUSES), [])

    def test_writes_and_personal_data_are_never_routed(self):
        for q in ("Xóa hết các phiếu quá hạn đi", "Duyệt luôn đề xuất nhập hàng giúp tôi",
                  "Cho tôi số điện thoại của độc giả đang nợ phạt nhiều nhất"):
            p = plan(q)
            self.assertEqual(sp.assess(p, p.normalized, WAREHOUSES), [], q)


if __name__ == "__main__":
    unittest.main()
