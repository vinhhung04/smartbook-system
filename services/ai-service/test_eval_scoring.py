from __future__ import annotations

import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "eval"))
import scoring  # noqa: E402


class FuzzyMatchTests(unittest.TestCase):
    def test_identical_strings_match(self):
        self.assertTrue(scoring.field_matches("Dế Mèn phiêu lưu ký", "Dế Mèn phiêu lưu ký"))

    def test_accent_and_case_differences_still_match(self):
        self.assertTrue(scoring.field_matches("Nguyễn Nhật Ánh", "nguyen nhat anh"))

    def test_unrelated_strings_do_not_match(self):
        self.assertFalse(scoring.field_matches("Dế Mèn phiêu lưu ký", "Harry Potter"))

    def test_empty_expected_is_always_considered_matched(self):
        self.assertTrue(scoring.field_matches(None, "anything"))
        self.assertTrue(scoring.field_matches("", "anything"))

    def test_empty_actual_against_real_expected_is_a_miss(self):
        self.assertFalse(scoring.field_matches("Dế Mèn phiêu lưu ký", None))
        self.assertFalse(scoring.field_matches("Dế Mèn phiêu lưu ký", ""))

    def test_minor_punctuation_difference_still_matches(self):
        self.assertTrue(scoring.field_matches("NXB Trẻ", "NXB Tre"))


class AuthorsMatchTests(unittest.TestCase):
    def test_all_expected_authors_found_regardless_of_order(self):
        self.assertTrue(scoring.authors_match(["Nguyễn Nhật Ánh"], ["J.K. Rowling", "Nguyen Nhat Anh"]))

    def test_missing_one_expected_author_fails(self):
        self.assertFalse(scoring.authors_match(["Nguyễn Nhật Ánh", "Tô Hoài"], ["Nguyen Nhat Anh"]))

    def test_no_expected_authors_always_matches(self):
        self.assertTrue(scoring.authors_match([], []))
        self.assertTrue(scoring.authors_match([], ["Someone"]))

    def test_expected_authors_with_no_actual_authors_fails(self):
        self.assertFalse(scoring.authors_match(["Nguyễn Nhật Ánh"], []))


class YearMatchTests(unittest.TestCase):
    def test_exact_year_string_matches(self):
        self.assertTrue(scoring.year_matches(2020, "2020"))

    def test_full_date_string_matches_on_year_only(self):
        self.assertTrue(scoring.year_matches(2020, "2020-03-15"))

    def test_wrong_year_fails(self):
        self.assertFalse(scoring.year_matches(2020, "2019-03-15"))

    def test_no_expected_year_always_matches(self):
        self.assertTrue(scoring.year_matches(None, None))

    def test_expected_year_with_missing_actual_fails(self):
        self.assertFalse(scoring.year_matches(2020, None))


class ExtractionAggregationTests(unittest.TestCase):
    def test_aggregates_field_accuracy_across_results(self):
        results = [
            {"title_match": True, "authors_match": True, "publisher_match": True, "year_match": True, "found": True},
            {"title_match": True, "authors_match": False, "publisher_match": True, "year_match": False, "found": True},
        ]
        summary = scoring.aggregate_extraction_scores(results)
        self.assertEqual(summary["total"], 2)
        self.assertEqual(summary["found_rate"], 1.0)
        self.assertEqual(summary["field_accuracy"]["title_match"], 1.0)
        self.assertEqual(summary["field_accuracy"]["authors_match"], 0.5)
        self.assertEqual(summary["all_fields_correct_rate"], 0.5)

    def test_empty_results_do_not_divide_by_zero(self):
        self.assertEqual(scoring.aggregate_extraction_scores([]), {"total": 0})


class ToolSelectionVerdictTests(unittest.TestCase):
    def test_exact_match(self):
        verdict = scoring.tool_selection_verdict(["get_reorder_suggestions"], ["get_reorder_suggestions"])
        self.assertTrue(verdict["exact_match"])
        self.assertEqual(verdict["precision"], 1.0)
        self.assertEqual(verdict["recall"], 1.0)

    def test_extra_unwanted_tool_call_hurts_precision_not_recall(self):
        verdict = scoring.tool_selection_verdict(["get_reorder_suggestions"], ["get_reorder_suggestions", "get_top_books"])
        self.assertFalse(verdict["exact_match"])
        self.assertEqual(verdict["precision"], 0.5)
        self.assertEqual(verdict["recall"], 1.0)

    def test_missed_required_tool_hurts_recall_not_precision(self):
        verdict = scoring.tool_selection_verdict(["get_reorder_suggestions", "get_top_books"], ["get_reorder_suggestions"])
        self.assertFalse(verdict["exact_match"])
        self.assertEqual(verdict["precision"], 1.0)
        self.assertEqual(verdict["recall"], 0.5)

    def test_no_tools_expected_and_none_called_is_a_perfect_match(self):
        verdict = scoring.tool_selection_verdict([], [])
        self.assertTrue(verdict["exact_match"])
        self.assertEqual(verdict["precision"], 1.0)
        self.assertEqual(verdict["recall"], 1.0)

    def test_unexpected_tool_call_when_none_expected_is_zero_precision(self):
        verdict = scoring.tool_selection_verdict([], ["get_top_books"])
        self.assertFalse(verdict["exact_match"])
        self.assertEqual(verdict["precision"], 0.0)


class ToolSelectionAggregationTests(unittest.TestCase):
    def test_aggregates_across_verdicts(self):
        verdicts = [
            {"exact_match": True, "precision": 1.0, "recall": 1.0},
            {"exact_match": False, "precision": 0.5, "recall": 1.0},
        ]
        summary = scoring.aggregate_tool_selection_scores(verdicts)
        self.assertEqual(summary["total"], 2)
        self.assertEqual(summary["exact_match_rate"], 0.5)
        self.assertEqual(summary["avg_precision"], 0.75)
        self.assertEqual(summary["avg_recall"], 1.0)

    def test_empty_verdicts_do_not_divide_by_zero(self):
        self.assertEqual(scoring.aggregate_tool_selection_scores([]), {"total": 0})


if __name__ == "__main__":
    unittest.main()
