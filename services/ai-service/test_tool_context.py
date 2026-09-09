"""Unit tests for tool_context.py - the compact, evidence-based rendering of
a tool_result that replaced main.py's unbounded json.dumps() into the prompt.
"""
import unittest

import tool_context as tc


class FormatNumberTests(unittest.TestCase):
    def test_large_int_uses_vietnamese_thousands_separator(self):
        self.assertEqual(tc._format_number(16980000), "16.980.000")

    def test_float_trims_trailing_zero_and_uses_vietnamese_decimal_comma(self):
        self.assertEqual(tc._format_number(5.2), "5,2")

    def test_whole_number_float_has_no_trailing_decimal_marker(self):
        self.assertEqual(tc._format_number(45.0), "45")

    def test_large_float_gets_both_separators_correctly(self):
        self.assertEqual(tc._format_number(1234567.89), "1.234.567,89")

    def test_small_int_is_unaffected(self):
        self.assertEqual(tc._format_number(27), "27")


class FormatValueTests(unittest.TestCase):
    def test_currency_unit_d_is_displayed_as_dong_sign(self):
        self.assertEqual(tc._format_value(16980000, "đ"), "16.980.000 ₫")

    def test_non_currency_unit_passes_through(self):
        self.assertEqual(tc._format_value(27, "phiếu"), "27 phiếu")

    def test_no_unit_is_just_the_number(self):
        self.assertEqual(tc._format_value(27, ""), "27")

    def test_string_value_is_not_reformatted(self):
        self.assertEqual(tc._format_value("HIGH", ""), "HIGH")

    def test_bool_value_is_not_treated_as_a_number(self):
        # bool is a subclass of int in Python - must not format True as "1".
        self.assertEqual(tc._format_value(True, ""), "True")


class RenderToolResultTests(unittest.TestCase):
    def test_error_result_is_surfaced_as_a_short_error_line_not_dumped(self):
        rendered = tc.render_tool_result("get_fine_summary", {"error": "gateway timeout"})
        self.assertEqual(rendered, "Lỗi khi gọi get_fine_summary: gateway timeout")

    def test_known_tool_uses_evidence_extraction_not_raw_json(self):
        rendered = tc.render_tool_result("get_fine_summary", {"total_unpaid": 16980000, "total_paid": 500000})
        self.assertIn("16.980.000 ₫", rendered)
        self.assertIn("₫", rendered)
        self.assertNotIn("{", rendered)  # not a JSON dump

    def test_currency_amounts_never_render_with_a_dollar_sign(self):
        # Regression: assistant_answers_20260908_180847.md - the model wrote
        # "$16,980,000" for a VND fine total once this text reached the prompt
        # unformatted. The rendered tool text itself must never suggest USD.
        rendered = tc.render_tool_result("get_fine_summary", {"total_paid": 16980000})
        self.assertNotIn("$", rendered)

    def test_large_reorder_list_does_not_dump_every_item(self):
        many_items = [
            {"title": f"Sách {i}", "suggested_reorder_qty": i, "priority": "MEDIUM"}
            for i in range(50)
        ]
        result = {"summary": {"total_candidates": 50}, "items": many_items}
        rendered = tc.render_tool_result("get_reorder_suggestions", result)
        # evidence._evidence_reorder_suggestions caps at the top 3 titles -
        # the other 47 must not appear as raw JSON.
        self.assertNotIn("Sách 40", rendered)
        self.assertIn("50", rendered)  # total_candidates is still communicated
        self.assertLess(len(rendered), 1000)

    def test_tool_with_no_extractor_falls_back_to_length_capped_json(self):
        rendered = tc.render_tool_result("some_future_tool_without_an_extractor", {"a": 1, "b": 2})
        self.assertIn('"a": 1', rendered)

    def test_fallback_json_is_truncated_at_the_configured_char_budget(self):
        big_result = {"items": [{"id": i, "text": "x" * 50} for i in range(200)]}
        rendered = tc.render_tool_result("tool_with_no_extractor", big_result)
        self.assertLessEqual(len(rendered), tc.ASSISTANT_TOOL_CONTEXT_CHARS + len("\n... (đã rút gọn)"))
        self.assertTrue(rendered.endswith("... (đã rút gọn)"))

    def test_empty_list_result_for_a_known_tool_falls_back_gracefully(self):
        # get_aging_inventory's extractor returns [] when there are no rows -
        # must not crash and must still produce something, not a bare "[]".
        rendered = tc.render_tool_result("get_aging_inventory", {"items": []})
        self.assertTrue(rendered)


class TruncateTests(unittest.TestCase):
    def test_short_text_is_unchanged(self):
        self.assertEqual(tc._truncate("hello", 100), "hello")

    def test_long_text_cuts_at_a_line_boundary_not_mid_line(self):
        text = "line one\nline two\nline three is quite a bit longer than the others"
        truncated = tc._truncate(text, 18)
        self.assertTrue(truncated.startswith("line one"))
        self.assertNotIn("line three is quit", truncated)
        self.assertTrue(truncated.endswith("... (đã rút gọn)"))


if __name__ == "__main__":
    unittest.main()
