import unittest

from main import _fast_path_tool, _fast_path_tools, _multi_intent_tools


def _tool_names(picks):
    return [name for name, _args in picks]


class MultiIntentToolsTests(unittest.TestCase):
    def test_the_measured_eval_miss_now_resolves_to_both_tools(self):
        # eval/reports/assistant_tools_20260908_074216.md: this exact question
        # called only get_dashboard_kpis (recall 0.5). Both clauses on their
        # own clear the fast-path bar, so the fix is purely rule-based.
        message = "Cho tôi bức tranh tổng thể: KPI hiện tại và các khoản quá hạn cần xử lý gấp"
        self.assertEqual(
            set(_tool_names(_multi_intent_tools(message))),
            {"get_dashboard_kpis", "get_overdue_summary"},
        )

    def test_a_clause_below_the_confidence_bar_correctly_falls_through_rather_than_guessing(self):
        # This compound question from the eval dataset was already answered
        # correctly by the LLM (2/2 in the live run) - it doesn't need the
        # fast path. "tồn kho rủi ro" alone only clears LOW_STOCK_QUERY at the
        # generic-match confidence (0.78, deliberately below the 0.85 fast-path
        # bar per intent.py) - so only one of the two clauses qualifies, and
        # _multi_intent_tools correctly returns [] rather than a partial guess.
        message = "So sánh tình hình tồn kho rủi ro và gợi ý nhập hàng để tôi quyết định nhập thêm sách gì"
        self.assertEqual(_multi_intent_tools(message), [])

    def test_a_single_idea_sentence_split_by_a_comma_is_not_treated_as_compound(self):
        # Splitting on "," must not manufacture a false compound from one idea.
        self.assertEqual(_multi_intent_tools("Tình hình mượn quá hạn hôm nay, tuần này thế nào?"), [])

    def test_a_genuinely_single_topic_question_returns_empty(self):
        self.assertEqual(_multi_intent_tools("Top 10 sách được mượn nhiều nhất là gì?"), [])


class FastPathToolsTests(unittest.TestCase):
    def test_no_tool_dataset_questions_return_empty(self):
        for message in ["Xin chào, bạn có thể giúp tôi những việc gì?", "Cảm ơn bạn nhiều nhé", "1 cộng 1 bằng mấy?"]:
            with self.subTest(message=message):
                self.assertEqual(_fast_path_tools(message), [])

    def test_compound_question_returns_both_tools_in_the_full_entry_point(self):
        message = "Cho tôi bức tranh tổng thể: KPI hiện tại và các khoản quá hạn cần xử lý gấp"
        self.assertEqual(
            set(_tool_names(_fast_path_tools(message))),
            {"get_dashboard_kpis", "get_overdue_summary"},
        )

    def test_a_single_tool_question_behaves_exactly_like_the_original_fast_path(self):
        message = "Hiện có bao nhiêu phiếu mượn đang quá hạn?"
        single = _fast_path_tool(message)
        self.assertIsNotNone(single)
        self.assertEqual(_fast_path_tools(message), [single])

    def test_an_action_surface_message_never_takes_the_fast_path(self):
        self.assertEqual(_fast_path_tools("Tạo phiếu nhập cho kho Hà Nội"), [])


if __name__ == "__main__":
    unittest.main()
