"""Answer checks for rebalancing turns found in the live run of 2026-11-20:
answers cut by the token budget, and a sentence saying a fully-controlled
warehouse needs another manager's approval."""
from __future__ import annotations

import unittest

import copilot_plan as cp
import copilot_rebalance_decision as rd
import main

COLLECTED = {"analyze_inventory_rebalancing": {"scope": [
    {"warehouse": "Kho HCM Chinh", "access": "WRITE"}, {"warehouse": "Kho Ha Noi", "access": "READ"},
    {"warehouse": "Kho Đà Nẵng", "access": "WRITE"}]}}


class PermissionWordingTests(unittest.TestCase):
    def test_full_warehouse_said_to_need_another_manager_is_caught(self):
        for wrong in ("Các dòng khác cần Manager kho Hà Nội/Dà Nẵng phê duyệt.",
                      "Bạn cần liên hệ trực tiếp với Quản lý kho Hà Nội và Đà Nẵng để xin phép."):
            self.assertEqual(rd.permission_issues(wrong, COLLECTED), [wrong])

    def test_read_only_warehouse_and_destination_are_not_flagged(self):
        for right in ("Cần Manager kho Hà Nội phối hợp để chuyển về Kho HCM Chinh.",
                      "Gửi thông báo cho Quản lý kho Hà Nội để xin chuyển 12 bản về HCM.",
                      "Kho Đà Nẵng: bạn tự tạo được."):
            self.assertEqual(rd.permission_issues(right, COLLECTED), [])

    def test_retry_instruction_and_strip(self):
        wrong = "Các dòng khác cần Manager kho Hà Nội/Dà Nẵng phê duyệt."
        self.assertIn("Kho Đà Nẵng", rd.permission_instruction([wrong], COLLECTED))
        self.assertEqual(rd.strip_sentences(f"Câu đúng.\n{wrong}\nCâu khác.", [wrong]), "Câu đúng.\n\nCâu khác.")
        self.assertEqual(rd.permission_issues("x", {"get_top_books": []}), [])


class TokenBudgetTests(unittest.TestCase):
    def test_rebalancing_turns_get_a_larger_budget(self):
        reb = cp.QueryPlan(intent="INVENTORY_REBALANCING_QUERY", entities={"rebalance": {"focus": []}})
        self.assertEqual(main._num_predict(reb), main.ASSISTANT_REBALANCE_NUM_PREDICT)
        self.assertGreater(main.ASSISTANT_REBALANCE_NUM_PREDICT, main.ASSISTANT_NUM_PREDICT)
        self.assertEqual(main._num_predict(cp.QueryPlan(intent="X")), main.ASSISTANT_NUM_PREDICT)


if __name__ == "__main__":
    unittest.main()


def _options(collected_pct):
    opts = {code: {"code": code, "label": code, "shortage_covered_pct": pct, "purchase_cost_vnd": 1}
            for code, pct in collected_pct.items()}
    return {"analyze_inventory_rebalancing": {"scope": [], "options": opts, "recommendation": {
        "best_business_option": "HYBRID", "executable_option": "HYBRID_EXECUTABLE"}}}


class OptionRecommendationTests(unittest.TestCase):
    def test_recommending_a_dominated_option_is_caught(self):
        c = _options({"TRANSFER_ONLY": 57.1, "PROCUREMENT_ONLY": 84.1, "HYBRID": 100, "HYBRID_EXECUTABLE": 100})
        wrong = "Với ngân sách hiện có, bạn nên tiến hành đặt mua 53 bản theo phương án PROCUREMENT_ONLY."
        self.assertEqual(rd.option_issues(wrong, c), [wrong])
        self.assertIn("HYBRID_EXECUTABLE", rd.answer_instruction([wrong], c))
        self.assertEqual(rd.option_issues("PROCUREMENT_ONLY chỉ đáp ứng 84,1%.", c), [])
        self.assertEqual(rd.option_issues("* **Chỉ mua mới (PROCUREMENT_ONLY):** Đáp ứng 84.1% với chi phí 9.833.000 ₫. Bạn "
                                          "tự thực hiện được toàn bộ nhưng vẫn còn thiếu 10 bản quan trọng.", c), [])
        # live run 2026-11-20: both slipped through the first version of the check
        for wrong in ("Với ngân sách 10.000.000 ₫, phương án **PROCUREMENT_ONLY (Chỉ mua mới)** là phương án bạn có thể tự "
                      "thực hiện được ngay lập tức mà không cần chờ phê duyệt từ kho khác.",
                      "Nhưng nếu ưu tiên sự độc lập, phương án PROCUREMENT_ONLY là giải pháp khả thi nhất với ngân sách 10 triệu ₫."):
            self.assertEqual(rd.option_issues(wrong, c), [wrong])

    def test_an_equally_good_option_is_not_flagged(self):
        c = _options({"PROCUREMENT_ONLY": 100, "HYBRID": 100, "HYBRID_EXECUTABLE": 100})
        self.assertEqual(rd.option_issues("Bạn nên chọn chỉ mua mới để không phụ thuộc kho khác.", c), [])


class DestinationTests(unittest.TestCase):
    def test_the_place_said_to_be_short_is_the_destination(self):
        import test_rebalance_planner as t
        plan = t.converse(["TP.HCM đang thiếu sách, xem thử kho nào có thể hỗ trợ và nếu không đủ thì cần mua thêm bao nhiêu."])[0][-1]
        self.assertEqual(plan.required_tools[0]["args"].get("destination_warehouses"), ["Kho HCM Chinh"])
        plan = t.converse(["Kho nào thiếu, kho nào dư sách?"])[0][-1]
        self.assertNotIn("destination_warehouses", plan.required_tools[0]["args"])


class RecommendationSentenceTests(unittest.TestCase):
    def test_states_best_and_executable_options(self):
        c = _options({"PROCUREMENT_ONLY": 84.1, "HYBRID": 100, "HYBRID_EXECUTABLE": 100})
        text = rd.recommendation_sentence(c)
        self.assertIn("**HYBRID**", text)
        self.assertIn("**HYBRID_EXECUTABLE**", text)
        self.assertIsNone(rd.recommendation_sentence({}))


class PurchaseDraftRequestTests(unittest.TestCase):
    def test_quantity_the_user_named(self):
        import agent_planner
        self.assertEqual(agent_planner.requested_quantity("Tạo phiếu đề xuất nhập 10 cuốn Dune - Xứ Cát cho kho HCM"), 10)
        self.assertEqual(agent_planner.requested_quantity("nhập 5 quyển"), 5)
        self.assertIsNone(agent_planner.requested_quantity("tạo phiếu cho kho 01"))
        note = agent_planner.draft_note({"type": "CREATE_REORDER_DRAFT", "payload": {"items": [
            {"title": "Dune", "suggested_quantity": 10, "quantity_source": "USER", "warehouse_name": "Kho HCM"}]}})
        self.assertIn("10 bản theo số lượng bạn yêu cầu", note)

    def test_warehouse_draft_request_fetches_that_warehouse(self):
        import test_rebalance_planner as t
        p = cp.build_plan("Tạo đề xuất phiếu nhập sách cho kho Đà Nẵng", None, t.WAREHOUSES)
        self.assertEqual(p.required_tools, [{"name": "get_reorder_suggestions", "args": {"limit": 100, "warehouse": "Kho Da Nang"}}])


class DraftWriteScopeTests(unittest.IsolatedAsyncioTestCase):
    async def test_draft_for_a_read_only_warehouse_is_not_offered(self):
        from unittest.mock import AsyncMock, patch
        planned = {"payload": {"items": [{"title": "Dune", "warehouse_id": "w-hn", "warehouse_name": "Kho Ha Noi"}]}}
        with patch("warehouse_scope.writable_warehouses", new=AsyncMock(return_value=frozenset({"w-hcm"}))):
            self.assertEqual(await main._unwritable_draft_warehouses(planned, None), ["Kho Ha Noi"])
        with patch("warehouse_scope.writable_warehouses", new=AsyncMock(return_value=frozenset({"w-hn"}))):
            self.assertEqual(await main._unwritable_draft_warehouses(planned, None), [])
        import warehouse_scope
        with patch("warehouse_scope.writable_warehouses", new=AsyncMock(side_effect=warehouse_scope.ScopeUnavailable())):
            self.assertEqual(await main._unwritable_draft_warehouses(planned, None), ["Kho Ha Noi"])  # fail-closed


class AnswerCleanupTests(unittest.TestCase):
    def test_removed_label_leaves_no_empty_bold(self):
        import copilot_faithfulness
        cleaned, _ = copilot_faithfulness.strip_internal_labels("**Ý nghĩa:** Kho Hà Nội đã đáp ứng đủ nhu cầu.\n**Lý do:** a")
        self.assertNotIn("****", cleaned)
        self.assertTrue(cleaned.startswith("Kho Hà Nội"))
        self.assertIn("**Lý do:**", cleaned)


class DraftNoteQuantityTests(unittest.TestCase):
    def test_note_compares_requested_and_system_quantity(self):
        import agent_planner
        def note(system):
            return agent_planner.draft_note({"type": "CREATE_REORDER_DRAFT", "payload": {"items": [
                {"title": "Dune", "suggested_quantity": 10, "quantity_source": "USER", "system_quantity": system,
                 "warehouse_name": "Kho HCM"}]}})
        self.assertIn("cần 14 bản; với 10 bản vẫn còn thiếu 4 bản", note(14))
        self.assertIn("nhập dư 2 bản", note(8))
        self.assertNotIn("Hệ thống tính", note(None))

    def test_model_lines_the_note_repeats_or_contradicts(self):
        import re
        for s in ("Việc bạn yêu cầu 10 bản là phù hợp với nhu cầu thực tế.", "Bước tiếp theo: hệ thống sẽ chuẩn bị bản nháp.",
                  "Bạn vui lòng xác nhận để tạo phiếu chính thức."):
            self.assertTrue(re.search(main._DRAFT_CONTRADICTIONS, s, re.I), s)
        self.assertFalse(re.search(main._DRAFT_CONTRADICTIONS, "Hệ thống đề xuất tổng cộng 14 bản với mức ưu tiên cao.", re.I))
